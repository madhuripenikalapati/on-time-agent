// A live voice call with the OpenAI Realtime API over WebRTC, wrapped in our own
// Telugu turn-taking layer. The server never auto-replies or auto-interrupts:
// this file decides when the agent keeps talking, yields, or answers.
import { classifyTurn, isListeningSound, normalize } from './turns.mjs';

const DUCKED_VOLUME = 0.22;

// Keep only Telugu and Latin (plus Devanagari for what the caller says, who may speak
// Hindi), digits and punctuation, and repair doubled Telugu vowel signs ("ుు") that the
// voice model occasionally emits. The agent itself only ever speaks Telugu.
export function cleanText(text, { caller = false } = {}) {
  const keep = /[^\p{Script=Telugu}\p{Script=Devanagari}\p{Script=Tamil}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Latin}\p{M}\p{N}\p{P}\p{Zs}₹%+/=-]/gu;
  return String(text ?? '')
    .replace(keep, '')
    .replace(/([\u0900-\u0DFF])(?=\1)(?<=[\u093E-\u094C\u09BE-\u09CC\u0ABE-\u0ACC\u0BBE-\u0BCC\u0C3E-\u0C4C\u0CBE-\u0CCC\u0D3E-\u0D4C])/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
const LONG_SPEECH_MS = 2000; // still talking this long over the agent is never just "hmm"

// Voice activity detection in the browser. OpenAI's own detector cuts the agent's audio the
// moment it hears any sound (over WebRTC, even with interrupt_response off), which makes
// "సరే while it talks" impossible. So the server's detector is off and this decides when
// the caller starts and stops; only finished utterances are sent for transcription.
export class VoiceDetector {
  constructor(stream, { context, onStart, onEnd }) {
    this.stream = stream;
    Object.assign(this, { context, onStart, onEnd });
    this.ownsContext = !context;
    this.speaking = false;
    this.voiced = 0;
    this.lastVoiceAt = 0;
    this.floor = 0.004;
  }
  async start() {
    this.context ??= new AudioContext();
    await this.context.resume();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source = this.context.createMediaStreamSource(this.stream);
    this.silentOutput = this.context.createGain();
    this.silentOutput.gain.value = 0;
    // Keep the microphone graph running without playing the caller's voice back.
    this.source.connect(this.analyser).connect(this.silentOutput).connect(this.context.destination);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => this.tick(), 20);
  }
  tick(now = performance.now()) {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const x of this.samples) sum += x * x;
    this.level(Math.sqrt(sum / this.samples.length), now);
  }
  // One 20 ms reading of the microphone level.
  level(rms, now) {
    const threshold = Math.max(0.012, this.floor * 3);
    if (rms > threshold) {
      this.lastVoiceAt = now;
      this.voiced += 20;
      if (!this.speaking && this.voiced >= 100) {
        this.speaking = true;
        this.onStart?.();
      }
    } else {
      if (!this.speaking) {
        this.voiced = Math.max(0, this.voiced - 20);
        this.floor = this.floor * 0.97 + rms * 0.03; // adapt to the room's background noise
      }
      if (this.speaking && now - this.lastVoiceAt > 850) { // elders pause mid-sentence
        this.speaking = false;
        this.voiced = 0;
        this.onEnd?.();
      }
    }
  }
  isVoicing(now = performance.now()) {
    return this.speaking && now - this.lastVoiceAt < 250;
  }
  stop() {
    clearInterval(this.timer);
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.silentOutput?.disconnect();
    if (this.ownsContext) this.context?.close().catch(() => {});
  }
}

export class VoiceCall {
  /**
   * @param {object} options
   * @param {string} options.secret ephemeral client secret from our server
   * @param {MediaStream} options.microphone
   * @param {'ontime'|'standard'} options.mode turn-taking mode (standard = typical voice bot)
   * @param {(name: string, args: object) => Promise<object>} options.onTool
   * @param {(event: object) => void} options.onUpdate UI updates
   */
  constructor({ secret, microphone, audioContext, mode = 'ontime', onTool, onUpdate, farewell, doseQuestions = [] }) {
    // farewell: the two goodbye lines in the patient's language, for the safety-net goodbye.
    Object.assign(this, { secret, microphone, audioContext, mode, onTool, onUpdate, farewell });
    this.doseQuestions = doseQuestions;
    this.audio = new Audio();
    this.audio.autoplay = true;
    this.agentSpeaking = false;
    this.responseActive = false;
    this.wantResponse = false;
    this.agentText = '';
    this.utterances = new Map(); // item_id -> { startedAt, agentSpeaking, yielded }
    this.current = null; // the caller utterance in progress
    this.awaitingCommit = []; // finished utterances waiting for their conversation item id
    this.ending = false;
    this.closed = false;
  }

  async connect() {
    this.pc = new RTCPeerConnection();
    this.pc.ontrack = event => { this.audio.srcObject = event.streams[0]; };
    for (const track of this.microphone.getAudioTracks()) this.pc.addTrack(track, this.microphone);
    this.channel = this.pc.createDataChannel('oai-events');
    this.channel.onmessage = message => this.handle(JSON.parse(message.data));
    const opened = new Promise((resolve, reject) => {
      this.channel.onopen = resolve;
      setTimeout(() => reject(new Error('The voice service did not answer.')), 15000);
    });
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(this.pc.connectionState) && !this.closed) {
        this.update({ type: 'error', message: 'The call connection dropped.' });
        this.hangUp('dropped');
      }
    };
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: 'Bearer ' + this.secret, 'Content-Type': 'application/sdp' },
    });
    if (!response.ok) throw new Error('Could not start the voice call (' + response.status + ').');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    await opened;
    this.detector = new VoiceDetector(this.microphone, { context: this.audioContext, onStart: () => this.speechStarted(), onEnd: () => this.speechEnded() });
    await this.detector.start();
    // Drop silence (and any echo) that piles up in the input buffer between utterances.
    this.hygiene = setInterval(() => {
      if (!this.current && !this.awaitingCommit.length) this.send({ type: 'input_audio_buffer.clear' });
    }, 1500);
    this.requestResponse(); // the agent speaks first
  }

  send(event) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event));
  }

  update(event) {
    this.onUpdate?.(event);
  }

  requestResponse(response) {
    if (this.ending) return;
    if (this.responseActive) { this.wantResponse = true; return; }
    this.wantResponse = false;
    this.responseActive = true;
    this.send({ type: 'response.create', ...(response ? { response } : {}) });
  }

  // The caller said something: the agent owes them a spoken reply.
  callerTurn() {
    this.spokeSinceCaller = false;
    this.waitingUntil = 0; // the patient is back
    this.requestResponse();
  }

  duck(on) {
    this.audio.volume = on ? DUCKED_VOLUME : 1;
    this.update({ type: 'duck', on });
  }

  // Stop the agent mid-sentence and give the caller the floor.
  yieldFloor() {
    if (this.responseActive) this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' });
    this.agentSpeaking = false;
    this.duck(false);
    this.update({ type: 'agent-stopped' });
  }

  handle(event) {
    switch (event.type) {
      case 'response.created':
        this.responseActive = true;
        this.agentText = '';
        this.openDoseQuestion = null;
        this.clearIdle();
        break;

      case 'output_audio_buffer.started':
        this.agentSpeaking = true;
        this.update({ type: 'agent-speaking' });
        break;

      case 'output_audio_buffer.stopped':
        this.openDoseQuestion = this.doseQuestionFor(this.agentText);
        // Fall through to the shared playback cleanup.
      case 'output_audio_buffer.cleared':
        this.agentSpeaking = false;
        this.duck(false);
        this.update({ type: 'agent-quiet' });
        if (this.ending) setTimeout(() => this.hangUp('ended'), 400);
        else this.armIdle();
        break;

      case 'response.output_audio_transcript.delta':
        this.agentText += event.delta;
        this.update({ type: 'agent-caption', text: cleanText(this.agentText) });
        break;

      case 'response.output_audio_transcript.done':
        this.agentText = cleanText(event.transcript ?? this.agentText);
        this.update({ type: 'agent-said', text: this.agentText });
        break;

      case 'input_audio_buffer.committed': {
        const utterance = this.awaitingCommit.shift();
        if (utterance && event.item_id) this.utterances.set(event.item_id, utterance);
        break;
      }

      case 'conversation.item.input_audio_transcription.completed':
        this.decide(event.item_id, event.transcript ?? '');
        break;

      case 'conversation.item.input_audio_transcription.failed':
        this.decide(event.item_id, '');
        break;

      case 'response.done': {
        this.responseActive = false;
        const output = event.response?.output ?? [];
        const calls = output.filter(item => item.type === 'function_call');
        const messages = output.filter(item => item.type === 'message');
        if (messages.length) this.spokeSinceCaller = true;
        // Did the agent end this very turn on a question? Then it has no answer yet.
        const said = messages.flatMap(m => m.content ?? []).map(c => c.transcript ?? c.text ?? '').join(' ').trim();
        const askedJustNow = /[?？]\s*$/u.test(said);
        if (askedJustNow) this.doseAnswer = null;
        if (calls.length) this.runTools(calls, this.spokeSinceCaller, askedJustNow);
        else if (this.wantResponse) this.requestResponse();
        break;
      }

      case 'error':
        if (!/cancel|no active response|not active/i.test(event.error?.message ?? '')) {
          console.warn('Realtime error', event.error);
        }
        break;
    }
  }

  doseQuestionFor(text) {
    if (!/[?？]\s*$/u.test(text)) return null;
    const said = normalize(text).replace(/？/gu, '?');
    const matches = this.doseQuestions.filter(question => said.endsWith(normalize(question.text).replace(/？/gu, '?')));
    return matches.length === 1 ? { medicineId: matches[0].medicineId } : null;
  }

  // The caller started speaking (from our voice detector).
  speechStarted() {
    this.clearIdle();
    const utterance = { startedAt: performance.now(), agentSpeaking: this.agentSpeaking, yielded: false, doseQuestion: this.openDoseQuestion };
    this.current = utterance;
    this.update({ type: 'caller-speaking' });
    if (!utterance.agentSpeaking) return;
    if (this.mode === 'standard') {
      // A typical voice bot: any sound stops it.
      utterance.yielded = true;
      this.yieldFloor();
      return;
    }
    // On Time: lower the voice at once, like a person who hears you start to speak,
    // and decide what you meant when your words arrive.
    this.duck(true);
    utterance.timer = setTimeout(() => {
      const stillTalking = this.detector ? this.detector.isVoicing() : this.current === utterance;
      if (this.current === utterance && stillTalking && this.agentSpeaking) {
        utterance.yielded = true;
        this.yieldFloor();
        this.logTurn('(still speaking)', 'yield', 'long speech', utterance);
      }
    }, LONG_SPEECH_MS);
  }

  // The caller stopped: send exactly this utterance for transcription.
  speechEnded() {
    const utterance = this.current;
    if (!utterance) return;
    utterance.stoppedAt = performance.now();
    clearTimeout(utterance.timer);
    this.current = null;
    this.awaitingCommit.push(utterance);
    this.send({ type: 'input_audio_buffer.commit' });
  }

  decide(itemId, transcript) {
    const utterance = this.utterances.get(itemId) ?? { startedAt: performance.now(), agentSpeaking: false };
    this.utterances.delete(itemId);
    clearTimeout(utterance.timer);
    // Bind the reply where speech began. A late transcript cannot borrow a question
    // that was still playing or wasn't even asked when the caller started speaking.
    const speakingWhenStarted = utterance.agentSpeaking && (!utterance.yielded || isListeningSound(transcript));
    const question = utterance.doseQuestion;
    const interrupt = classifyTurn(transcript, { agentSpeaking: true }).reason;
    if (question && this.openDoseQuestion === question && !utterance.agentSpeaking && transcript.trim()
      && !/[?？]/u.test(transcript) && !['stop word', 'question'].includes(interrupt)) {
      this.doseAnswer = question;
      this.openDoseQuestion = null;
    }

    if (this.mode === 'standard') {
      if (transcript.trim()) {
        this.update({ type: 'caller-said', text: cleanText(transcript, { caller: true }) });
        this.logTurn(transcript, utterance.agentSpeaking ? 'yield' : 'answer', 'standard bot', utterance);
        this.callerTurn();
      }
      return;
    }

    const { decision, reason } = classifyTurn(transcript, { agentSpeaking: speakingWhenStarted, agentText: this.agentText });
    if (transcript.trim() && decision !== 'noise') this.update({ type: 'caller-said', text: cleanText(transcript, { caller: true }) });

    if (decision === 'noise' || decision === 'backchannel') {
      this.duck(false);
      // Remove it so the model never treats "సరే" as the answer to a later question.
      this.send({ type: 'conversation.item.delete', item_id: itemId });
      if (decision === 'backchannel') this.logTurn(transcript, 'backchannel', reason, utterance);
      if (!speakingWhenStarted && decision === 'noise' && this.wantResponse) this.requestResponse();
      return;
    }
    if (decision === 'yield' && !utterance.yielded) {
      utterance.yielded = true;
      this.yieldFloor();
    }
    this.logTurn(transcript, decision, reason, utterance);
    this.callerTurn();
  }

  logTurn(heard, decision, reason, utterance) {
    const ms = Math.round(performance.now() - (utterance.stoppedAt ?? utterance.startedAt));
    this.update({ type: 'turn', heard, decision, reason, ms });
  }

  async runTools(calls, spoke, askedJustNow = false) {
    let blocked = false;
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.arguments || '{}'); } catch {}
      let output;
      try {
        // Guard: never record a dose the patient hasn't answered about yet.
        if (call.name === 'wait_for_patient') {
          // The patient went to take the tablet: keep the line open quietly for up to two minutes.
          this.waitingUntil = Date.now() + 120000;
          // Silence after "not yet" sounds like a dropped call: if nothing was said, say the line first.
          output = spoke
            ? { ok: true, note: 'Waiting quietly. Say nothing until the patient speaks.' }
            : { ok: true, note: 'You have not said anything yet. Now say the "not taken yet" line out loud (can you take it now? I will stay on the line), in the patient\'s language. Do not call any tool. Then wait quietly.' };
          if (!this.agentSpeaking) this.armIdle();
        } else if (call.name === 'record_dose' && (askedJustNow || args.medicine_id !== this.doseAnswer?.medicineId)) {
          output = { ok: false, error: 'Not recorded: a fresh answer to this medicine’s dose question is required. Ask the exact dose question if you have not just asked it, then wait.' };
          blocked = askedJustNow;
          this.update({ type: 'guard', message: 'Blocked a dose record before the patient answered' });
        } else {
          if (call.name === 'record_dose') this.doseAnswer = null;
          output = await this.onTool(call.name, args);
        }
      } catch (error) {
        output = { ok: false, error: error.message };
      }
      if (call.name === 'end_call') this.ending = true;
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) } });
    }
    // After a blocked record the question is already out loud: wait for the patient. While
    // waiting for the patient to fetch a tablet, don't prompt the agent to talk again.
    const onlyWaiting = calls.every(call => call.name === 'wait_for_patient');
    if (!this.ending) { if (!blocked && !(onlyWaiting && spoke)) this.requestResponse(); return; }
    setTimeout(() => this.hangUp('ended'), 15000); // safety net
    if (spoke) {
      // The agent already spoke since the caller's last reply; hang up once it has played.
      if (!this.agentSpeaking) setTimeout(() => this.hangUp('ended'), 800);
      return;
    }
    // Never end a call in silence: ask for one short spoken goodbye, with tools off.
    this.responseActive = true;
    this.send({ type: 'response.create', response: {
      tool_choice: 'none',
      instructions: this.farewell
        ? `Say goodbye in ${this.farewell.language} using exactly one of these lines and nothing else. If you scheduled a callback: "${this.farewell.callback}" (put the real number of minutes for <N>). Otherwise: "${this.farewell.done}"`
        : 'Say one short, warm goodbye in the language of this call. Do not ask a question.',
    } });
  }

  // Switch turn-taking modes mid-call to hear the difference.
  setMode(mode) {
    this.mode = mode;
  }

  // Something the patient did on screen (e.g. tapped "label matches"), told to the agent.
  // If nobody speaks after the agent finishes, wrap the call up instead of leaving the
  // line open: 7s after a closing statement, 25s after an unanswered question.
  armIdle() {
    this.clearIdle();
    if (this.waitingUntil > Date.now()) {
      // Waiting for the patient to take the tablet: after two minutes of quiet, ask once, kindly.
      this.idleTimer = setTimeout(() => {
        if (this.closed || this.ending || this.responseActive || this.agentSpeaking) return;
        this.waitingUntil = 0;
        this.requestResponse({ instructions: 'The patient went to take the medicine and has been quiet for two minutes. In their language, ask once, kindly, whether they took it. Do not call any tool yet.' });
      }, this.waitingUntil - Date.now());
      return;
    }
    const asked = /[?？]\s*$/u.test(this.agentText.trim());
    this.idleTimer = setTimeout(() => {
      if (this.closed || this.ending || this.responseActive || this.agentSpeaking) return;
      this.responseActive = true;
      this.send({ type: 'response.create', response: {
        tool_choice: { type: 'function', name: 'end_call' },
        instructions: asked
          ? 'The patient did not answer. Call end_call now with an English summary that says what is still unconfirmed.'
          : 'The conversation is over. Call end_call now with the English summary. Do not say anything more.',
      } });
    }, asked ? 25000 : 7000);
  }

  clearIdle() {
    clearTimeout(this.idleTimer);
  }

  tell(text) {
    this.clearIdle();
    if (this.agentSpeaking) this.yieldFloor();
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    this.callerTurn();
  }

  hangUp(reason = 'hung-up') {
    if (this.closed) return;
    this.closed = true;
    this.clearIdle();
    clearInterval(this.hygiene);
    this.detector?.stop();
    try { this.channel?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.audio.srcObject = null;
    this.update({ type: 'closed', reason });
  }
}
