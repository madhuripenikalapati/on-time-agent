// Drives the real call engine with scripted Realtime events (no network, no audio).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Audio ??= class { constructor() { this.volume = 1; } };
const { VoiceCall, VoiceDetector } = await import('../dist/realtime.mjs');

function harness() {
  const sent = [];
  const tools = [];
  const call = new VoiceCall({
    secret: 'test',
    microphone: null,
    onTool: async (name, args) => { tools.push({ name, args }); return { ok: true }; },
    onUpdate: () => {},
  });
  call.channel = { readyState: 'open', send: data => sent.push(JSON.parse(data)), close() {} };
  return { call, sent, tools };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const said = text => ({ type: 'message', content: [{ type: 'output_audio', transcript: text }] });
const tool = (name, args, id = 'c1') => ({ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id });

test('a dose recorded in the same turn as the question is blocked, and the agent waits', async () => {
  const { call, sent, tools } = harness();
  call.responseActive = true;
  call.handle({ type: 'response.done', response: { output: [said('BP tablet వేసుకున్నారా?'), tool('record_dose', { medicine_id: 'a', status: 'taken' })] } });
  await settle();
  assert.equal(tools.length, 0, 'record_dose must not reach the server');
  const output = sent.find(e => e.type === 'conversation.item.create');
  assert.match(output.item.output, /Not recorded/);
  assert.equal(sent.some(e => e.type === 'response.create'), false, 'it must wait for the patient, not keep talking');
});

test('a dose recorded after the patient answered goes through and the agent continues', async () => {
  const { call, sent, tools } = harness();
  call.callerTurn();
  sent.length = 0;
  call.handle({ type: 'response.done', response: { output: [said('సరే, నమోదు చేశాను.'), tool('record_dose', { medicine_id: 'a', status: 'taken' })] } });
  await settle();
  assert.deepEqual(tools.map(t => t.name), ['record_dose']);
  assert.equal(sent.at(-1).type, 'response.create');
});

test('ending a call without having spoken asks for one Telugu goodbye with tools off', async () => {
  const { call, sent, tools } = harness();
  call.callerTurn();
  sent.length = 0;
  call.handle({ type: 'response.done', response: { output: [tool('end_call', { summary: 'All taken.' })] } });
  await settle();
  assert.deepEqual(tools.map(t => t.name), ['end_call']);
  const goodbye = sent.find(e => e.type === 'response.create');
  assert.equal(goodbye.response.tool_choice, 'none');
  assert.match(goodbye.response.instructions, /language of this call/);
  call.hangUp();
});

test('no extra goodbye when the agent already spoke since the patient last replied', async () => {
  const { call, sent } = harness();
  call.callerTurn();
  call.handle({ type: 'response.done', response: { output: [said('సరే, మళ్ళీ call చేస్తాను. ధన్యవాదాలు.'), tool('schedule_callback', { minutes: 30, reason: 'x' })] } });
  await settle();
  sent.length = 0;
  call.handle({ type: 'response.done', response: { output: [tool('end_call', { summary: 'Callback set.' }, 'c2')] } });
  await settle();
  assert.equal(sent.some(e => e.type === 'response.create'), false);
  call.hangUp();
});

test('silence after a closing statement wraps the call up after 7 seconds', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { call, sent } = harness();
    call.agentText = 'సరే, నమోదు చేశాను.';
    call.handle({ type: 'output_audio_buffer.stopped' });
    mock.timers.tick(6900);
    assert.equal(sent.some(e => e.type === 'response.create'), false);
    mock.timers.tick(200);
    const close = sent.find(e => e.type === 'response.create');
    assert.deepEqual(close.response.tool_choice, { type: 'function', name: 'end_call' });
  } finally {
    mock.timers.reset();
  }
});

test('an unanswered question waits 25 seconds, and a reply cancels the closer', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { call, sent } = harness();
    call.agentText = 'Sugar tablet వేసుకున్నారా?';
    call.handle({ type: 'output_audio_buffer.stopped' });
    mock.timers.tick(20000);
    assert.equal(sent.some(e => e.type === 'response.create'), false);
    call.speechStarted();
    mock.timers.tick(10000);
    assert.equal(sent.some(e => e.response?.tool_choice?.name === 'end_call'), false);
  } finally {
    mock.timers.reset();
  }
});

test('a listening sound while the agent talks is removed and does not trigger a reply', async () => {
  const { call, sent } = harness();
  call.agentSpeaking = true;
  call.agentText = 'మీ BP tablet ఒకటి breakfast తర్వాత';
  call.speechStarted();
  assert.equal(call.audio.volume < 1, true, 'agent lowers its voice at once');
  call.speechEnded();
  assert.ok(sent.some(e => e.type === 'input_audio_buffer.commit'), 'the utterance is sent for transcription');
  call.handle({ type: 'input_audio_buffer.committed', item_id: 'u1' });
  call.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'సరే' });
  assert.ok(sent.some(e => e.type === 'conversation.item.delete' && e.item_id === 'u1'));
  assert.equal(sent.some(e => e.type === 'response.cancel' || e.type === 'response.create'), false);
  assert.equal(call.audio.volume, 1, 'voice comes back to full volume');
  call.hangUp();
});

test('"aagandi" while the agent talks cuts it off and gives the patient the floor', async () => {
  const { call, sent } = harness();
  call.agentSpeaking = true;
  call.responseActive = true;
  call.agentText = 'మీ BP tablet ఒకటి breakfast తర్వాత';
  call.speechStarted();
  assert.equal(call.audio.volume < 1, true, 'agent lowers its voice at once');
  call.speechEnded();
  call.handle({ type: 'input_audio_buffer.committed', item_id: 'u2' });
  call.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u2', transcript: 'ఆగండి, ఈ tablet?' });
  assert.ok(sent.some(e => e.type === 'response.cancel'));
  assert.ok(sent.some(e => e.type === 'output_audio_buffer.clear'));
  call.handle({ type: 'response.done', response: { output: [] } });
  assert.equal(sent.at(-1).type, 'response.create');
  call.hangUp();
});

test('standard-bot mode stops on any sound, which is the problem On Time fixes', () => {
  const { call, sent } = harness();
  call.mode = 'standard';
  call.agentSpeaking = true;
  call.responseActive = true;
  call.speechStarted();
  assert.ok(sent.some(e => e.type === 'output_audio_buffer.clear'));
  call.hangUp();
});

test('voice detector: a short sound is ignored, speech starts after 100 ms and ends after 850 ms of quiet', () => {
  const events = [];
  const vad = new VoiceDetector(null, { onStart: () => events.push('start'), onEnd: () => events.push('end') });
  let t = 0;
  const feed = (rms, ms) => { for (let i = 0; i < ms / 20; i++) { t += 20; vad.level(rms, t); } };
  feed(0.002, 400);                 // quiet room
  feed(0.08, 60); feed(0.002, 200); // a click: too short to count
  assert.deepEqual(events, []);
  feed(0.08, 600);                  // "సరే"
  assert.deepEqual(events, ['start']);
  feed(0.002, 800);
  assert.deepEqual(events, ['start'], 'a pause inside speech is not the end');
  feed(0.002, 100);
  assert.deepEqual(events, ['start', 'end']);
});

test('voice detector adapts to steady background noise', () => {
  const events = [];
  const vad = new VoiceDetector(null, { onStart: () => events.push('start') });
  let t = 0;
  for (let i = 0; i < 400; i++) { t += 20; vad.level(0.01, t); } // fan noise just under the floor
  assert.deepEqual(events, []);
  for (let i = 0; i < 10; i++) { t += 20; vad.level(0.09, t); }
  assert.deepEqual(events, ['start']);
});

test('the safety-net goodbye is in the patient\'s language', async () => {
  const sent = [];
  const call = new VoiceCall({ secret: 't', microphone: null, onTool: async () => ({ ok: true }), onUpdate: () => {},
    farewell: { language: 'Hindi', done: 'ठीक है, बस इतना ही. अपना ध्यान रखिए.', callback: '<N> मिनट बाद मैं फिर से call करूँगी.' } });
  call.channel = { readyState: 'open', send: d => sent.push(JSON.parse(d)), close() {} };
  call.callerTurn(); sent.length = 0;
  call.handle({ type: 'response.done', response: { output: [{ type: 'function_call', name: 'end_call', arguments: '{"summary":"x"}', call_id: 'c' }] } });
  await new Promise(r => setImmediate(r));
  const goodbye = sent.find(e => e.type === 'response.create');
  assert.match(goodbye.response.instructions, /Hindi/);
  assert.match(goodbye.response.instructions, /अपना ध्यान रखिए/);
  assert.doesNotMatch(goodbye.response.instructions, /[\u0C00-\u0C7F]/, 'no Telugu');
  call.hangUp();
});
