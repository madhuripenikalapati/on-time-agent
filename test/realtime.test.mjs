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
    doseQuestions: [{ medicineId: 'a', text: 'BP tablet వేసుకున్నారా?' }, { medicineId: 'b', text: 'Sugar tablet వేసుకున్నారా?' }],
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
  call.agentText = 'BP tablet వేసుకున్నారా?';
  call.handle({ type: 'output_audio_buffer.stopped' });
  call.speechStarted();
  call.utterances.set('reply', call.current);
  call.current = null;
  call.decide('reply', 'అవును');
  sent.length = 0;
  call.handle({ type: 'response.done', response: { output: [said('సరే, నమోదు చేశాను.'), tool('record_dose', { medicine_id: 'a', status: 'taken' })] } });
  await settle();
  assert.deepEqual(tools.map(t => t.name), ['record_dose']);
  assert.equal(sent.at(-1).type, 'response.create');
  call.hangUp();
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

test('an unanswered dose question repeats once with tools off, then closes unconfirmed', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { call, sent } = harness();
    call.agentText = 'మంచిది అండి. Sugar tablet వేసుకున్నారా?';
    call.handle({ type: 'output_audio_buffer.stopped' });
    mock.timers.tick(7900);
    assert.equal(sent.some(e => e.type === 'response.create'), false);
    mock.timers.tick(200);
    const retry = sent.find(e => e.type === 'response.create');
    assert.equal(retry.response.tool_choice, 'none');
    assert.match(retry.response.instructions, /Sugar tablet వేసుకున్నారా\?/);
    call.handle({ type: 'response.created' });
    call.agentText = 'Sugar tablet వేసుకున్నారా?';
    call.handle({ type: 'response.done' });
    call.handle({ type: 'output_audio_buffer.stopped' });
    mock.timers.tick(20100);
    assert.equal(sent.filter(e => e.type === 'response.create').length, 2);
    assert.deepEqual(sent.at(-1).response.tool_choice, { type: 'function', name: 'end_call' });
  } finally {
    mock.timers.reset();
  }
});

test('speech cancels the pending retry but unusable audio still gets a repeat', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { call, sent } = harness();
    call.agentText = 'BP tablet వేసుకున్నారా?';
    call.handle({ type: 'output_audio_buffer.stopped' });
    mock.timers.tick(7000);
    call.speechStarted();
    mock.timers.tick(3000);
    assert.equal(sent.some(e => e.type === 'response.create'), false);
    call.speechEnded();
    call.handle({ type: 'input_audio_buffer.committed', item_id: 'silent' });
    call.handle({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'silent' });
    mock.timers.tick(8100);
    assert.equal(sent.at(-1).response.tool_choice, 'none');
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

test('"not yet": the agent waits on the line instead of hanging up, then asks once after two minutes', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { call, sent, tools } = harness();
    call.callerTurn(); // the patient said "ఇంకా వేసుకోలేదు అండి"
    sent.length = 0;
    call.handle({ type: 'response.done', response: { output: [said('పర్వాలేదు అండి. ఇప్పుడే వేసుకుంటారా? నేను line లోనే ఉంటాను.'), tool('wait_for_patient', {})] } });
    await settle();
    assert.equal(tools.length, 0, 'waiting is handled in the call, not on the server');
    assert.equal(sent.some(e => e.type === 'response.create'), false, 'the agent stays quiet while the patient fetches the tablet');
    call.handle({ type: 'output_audio_buffer.stopped' });
    mock.timers.tick(30000);
    assert.equal(sent.some(e => e.type === 'response.create'), false, 'no hang-up after 25 seconds of quiet');
    mock.timers.tick(91000);
    const nudge = sent.find(e => e.type === 'response.create');
    assert.ok(nudge, 'after two minutes it asks once');
    assert.match(nudge.response.instructions, /ask once/);
    assert.equal(nudge.response.tool_choice, undefined, 'it does not force end_call');
  } finally {
    mock.timers.reset();
  }
});

test('waiting without having said anything first: the agent is asked to say the line', async () => {
  const { call, sent } = harness();
  call.callerTurn();
  sent.length = 0;
  call.handle({ type: 'response.done', response: { output: [tool('wait_for_patient', {})] } });
  await settle();
  const output = sent.find(e => e.type === 'conversation.item.create');
  assert.match(output.item.output, /not taken yet/);
  assert.equal(sent.at(-1).type, 'response.create', 'it speaks before waiting');
  call.clearIdle(); // don't leave the two-minute wait timer running
});

test('a split avunu cannot answer a new dose question or be reused for another medicine', async () => {
  const { call, sent, tools } = harness();
  call.agentText = 'Breakfast done?';
  call.handle({ type: 'output_audio_buffer.stopped' });
  call.decide('meal', 'హా అవును');
  call.handle({ type: 'response.created' });
  call.handle({ type: 'output_audio_buffer.started' });
  call.speechStarted();
  call.utterances.set('late', call.current);
  call.current = null;
  call.agentText = 'BP tablet వేసుకున్నారా?';
  call.handle({ type: 'response.done', response: { output: [said(call.agentText)] } });
  call.handle({ type: 'output_audio_buffer.stopped' });
  call.decide('late', 'అవును');
  await call.runTools([tool('record_dose', { medicine_id: 'a', status: 'taken' })], false);
  assert.equal(tools.length, 0);
  assert.ok(sent.some(e => e.type === 'conversation.item.delete' && e.item_id === 'late'));

  call.speechStarted();
  call.utterances.set('fresh', call.current);
  call.current = null;
  call.decide('fresh', 'అవును అవును');
  await call.runTools([
    tool('record_dose', { medicine_id: 'b', status: 'taken' }, 'wrong'),
    tool('record_dose', { medicine_id: 'a', status: 'taken' }, 'right'),
    tool('record_dose', { medicine_id: 'a', status: 'taken' }, 'duplicate'),
  ], false);
  assert.deepEqual(tools.map(entry => entry.args.medicine_id), ['a']);
  call.hangUp();
});

test('microphone analysis uses the already unlocked context and does not close it', async () => {
  const destination = {};
  const graph = [];
  const disconnected = [];
  const node = name => ({
    name,
    connect(target) { graph.push([name, target]); return target; },
    disconnect() { disconnected.push(name); },
  });
  const source = node('microphone');
  const analyser = node('analyser');
  const gain = { ...node('gain'), gain: { value: 1 } };
  const context = {
    destination,
    resume: async () => {},
    createMediaStreamSource: () => source,
    createAnalyser: () => analyser,
    createGain: () => gain,
    close: () => assert.fail('The phone owns the unlocked audio context'),
  };
  const detector = new VoiceDetector({}, { context });
  await detector.start();
  detector.stop();
  assert.deepEqual(graph, [['microphone', analyser], ['analyser', gain], ['gain', destination]]);
  assert.equal(gain.gain.value, 0);
  assert.deepEqual(disconnected, ['microphone', 'analyser', 'gain']);
});

test('a fresh Telugu reply can confirm its medicine after a question ending in లేదా', async () => {
  const { call, tools } = harness();
  call.doseQuestions = [
    { medicineId: 'a', text: 'Cholesterol tablet వేసుకున్నారా అండి?' },
    { medicineId: 'b', text: 'Antibiotic వేసుకున్నారా అండి?' },
  ];
  call.agentText = 'క్షమించండి, సరిగ్గా అర్థం కాలేదు. Cholesterol tablet వేసుకున్నారా, లేదా?';
  call.handle({ type: 'output_audio_buffer.stopped' });
  call.speechStarted();
  call.utterances.set('fresh', call.current);
  call.current = null;
  call.decide('fresh', 'హా వేసుకున్నాలే.');
  await call.runTools([
    tool('record_dose', { medicine_id: 'b', status: 'taken' }, 'wrong'),
    tool('record_dose', { medicine_id: 'a', status: 'taken' }, 'right'),
    tool('record_dose', { medicine_id: 'a', status: 'taken' }, 'duplicate'),
  ], false);
  assert.deepEqual(tools.map(entry => entry.args.medicine_id), ['a']);
  call.hangUp();
});

test('a structured question binds a fresh Telugu, Hindi or English reply to one medicine', async () => {
  for (const reply of ['హా తీసుకున్నాలే', 'हाँ जी, ले लिया था', 'Yep, I already had it']) {
    const { call, tools, sent } = harness();
    call.structuredDoseQuestions = true;
    await call.runTools([tool('ask_dose', { medicine_id: 'a' })], false);
    assert.equal(sent.at(-1).response.tool_choice, 'none');
    call.handle({ type: 'response.created', response: { id: 'question-a' } });
    call.handle({ type: 'output_audio_buffer.started', response_id: 'question-a' });
    call.speechStarted();
    call.utterances.set('too-early', call.current);
    call.current = null;
    call.handle({ type: 'output_audio_buffer.stopped', response_id: 'previous-audio' });
    assert.equal(call.openDoseQuestion, null);
    call.agentText = 'Different wording entirely';
    call.handle({ type: 'response.done', response: { id: 'question-a', status: 'completed' } });
    call.handle({ type: 'output_audio_buffer.stopped', response_id: 'question-a' });
    call.decide('too-early', reply);
    assert.equal(call.doseAnswer, null);
    call.speechStarted();
    call.utterances.set('fresh', call.current);
    call.current = null;
    call.decide('fresh', reply);
    await call.runTools([
      tool('record_dose', { medicine_id: 'b', status: 'taken' }, 'wrong'),
      tool('record_dose', { medicine_id: 'a', status: 'taken' }, 'right'),
      tool('record_dose', { medicine_id: 'a', status: 'taken' }, 'duplicate'),
    ], false);
    assert.deepEqual(tools.map(entry => entry.args.medicine_id), ['a']);
    call.hangUp();
  }
});

test('clearing a structured dose question prevents a partially played question from authorizing a dose', async () => {
  const { call } = harness();
  call.structuredDoseQuestions = true;
  await call.runTools([tool('ask_dose', { medicine_id: 'a' })], false);
  call.handle({ type: 'response.created', response: { id: 'cut-off' } });
  call.handle({ type: 'output_audio_buffer.started', response_id: 'cut-off' });
  call.handle({ type: 'output_audio_buffer.cleared', response_id: 'cut-off' });
  call.handle({ type: 'output_audio_buffer.stopped', response_id: 'cut-off' });
  assert.equal(call.openDoseQuestion, null);
  call.hangUp();
});
