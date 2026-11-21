// A live voice call with the OpenAI Realtime API over WebRTC, wrapped in our own
// Telugu turn-taking layer. The server never auto-replies or auto-interrupts:
// this file decides when the agent keeps talking, yields, or answers.
import { classifyTurn } from './turns.mjs';

const DUCKED_VOLUME = 0.22;

// Keep only Telugu and Latin (plus Devanagari for what the caller says, who may speak
// Hindi), digits and punctuation, and repair doubled Telugu vowel signs ("ుు") that the
// voice model occasionally emits. The agent itself only ever speaks Telugu.
export function cleanText(text, { caller = false } = {}) {
  const keep = caller
    ? /[^\p{Script=Telugu}\p{Script=Latin}\p{Script=Devanagari}\p{N}\p{P}\p{Zs}₹%+/=-]/gu
    : /[^\p{Script=Telugu}\p{Script=Latin}\p{N}\p{P}\p{Zs}₹%+/=-]/gu;
  return String(text ?? '')
    .replace(keep, '')
    .replace(/([\u0C3E-\u0C4C])\1+/gu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
const LONG_SPEECH_MS = 1300; // talking this long over the agent is never just "hmm"

export class VoiceCall {
  /**
   * @param {object} options
   * @param {string} options.secret ephemeral client secret from our server
   * @param {MediaStream} options.microphone
   * @param {'ontime'|'standard'} options.mode turn-taking mode (standard = typical voice bot)
   * @param {(name: string, args: object) => Promise<object>} options.onTool
   * @param {(event: object) => void} options.onUpdate UI updates
   */
  constructor({ secret, microphone, mode = 'ontime', onTool, onUpdate }) {
    Object.assign(this, { secret, microphone, mode, onTool, onUpdate });
    this.audio = new Audio();
    this.audio.autoplay = true;
    this.agentSpeaking = false;
    this.responseActive = false;
    this.wantResponse = false;
    this.agentText = '';
    this.utterances = new Map(); // item_id -> { startedAt, agentSpeaking, yielded }
    this.current = null; // the caller utterance in progress
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
    this.requestResponse(); // the agent speaks first
  }

  send(event) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event));
  }

  update(event) {
    this.onUpdate?.(event);
  }

  requestResponse() {
    if (this.ending) return;
    if (this.responseActive) { this.wantResponse = true; return; }
    this.wantResponse = false;
    this.responseActive = true;
    this.send({ type: 'response.create' });
  }

  // The caller said something: the agent owes them a spoken reply.
  callerTurn() {
    this.spokeSinceCaller = false;
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
        this.clearIdle();
        break;

      case 'output_audio_buffer.started':
        this.agentSpeaking = true;
        this.update({ type: 'agent-speaking' });
        break;

      case 'output_audio_buffer.stopped':
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
        this.update({ type: 'agent-said', text: cleanText(event.transcript ?? this.agentText) });
        break;

      case 'input_audio_buffer.speech_started': {
        this.clearIdle();
        const utterance = { startedAt: performance.now(), agentSpeaking: this.agentSpeaking, yielded: false };
        this.utterances.set(event.item_id, utterance);
        this.current = utterance;
        this.update({ type: 'caller-speaking' });
        if (!utterance.agentSpeaking) break;
        if (this.mode === 'standard') {
          // A typical voice bot: any sound stops it.
          utterance.yielded = true;
          this.yieldFloor();
          break;
        }
        // On Time: lower the voice at once, like a person who hears you start to speak,
        // and decide what you meant when your words arrive.
        this.duck(true);
        utterance.timer = setTimeout(() => {
          if (this.current === utterance && this.agentSpeaking) {
            utterance.yielded = true;
            this.yieldFloor();
            this.logTurn('(still speaking)', 'yield', 'long speech', utterance);
          }
        }, LONG_SPEECH_MS);
        break;
      }

      case 'input_audio_buffer.speech_stopped': {
        const utterance = this.utterances.get(event.item_id);
        if (utterance) { utterance.stoppedAt = performance.now(); clearTimeout(utterance.timer); }
        if (this.current === utterance) this.current = null;
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

  decide(itemId, transcript) {
    const utterance = this.utterances.get(itemId) ?? { startedAt: performance.now(), agentSpeaking: false };
    this.utterances.delete(itemId);
    clearTimeout(utterance.timer);
    // If the agent has since finished on a question, a reply that overlapped its last
    // words ("అవును" said a beat early) is an answer, not a listening sound.
    const finishedOnQuestion = !this.agentSpeaking && /[?？]\s*$/u.test(this.agentText.trim());
    const speakingWhenStarted = utterance.agentSpeaking && !utterance.yielded && !finishedOnQuestion;

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
        if (call.name === 'record_dose' && askedJustNow) {
          output = { ok: false, error: 'Not recorded: you just asked the question. Wait for the patient to answer, then record what they say.' };
          blocked = true;
          this.update({ type: 'guard', message: 'Blocked a dose record before the patient answered' });
        } else {
          output = await this.onTool(call.name, args);
        }
      } catch (error) {
        output = { ok: false, error: error.message };
      }
      if (call.name === 'end_call') this.ending = true;
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) } });
    }
    // After a blocked record the question is already out loud: wait for the patient.
    if (!this.ending) { if (!blocked) this.requestResponse(); return; }
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
      instructions: 'Speak only Telugu, written in Telugu script (తెలుగు), never any other language. Say one short, warm goodbye sentence that mentions what happens next (for example the callback time, or that the family will be told). Do not ask a question.',
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
    try { this.channel?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.audio.srcObject = null;
    this.update({ type: 'closed', reason });
  }
}
