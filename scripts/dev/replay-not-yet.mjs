// Replays "not yet" on the live agent (text in place of voice) and prints what it says and does.
const U = 'https://vqe7ihx8pe.execute-api.us-west-2.amazonaws.com';
const post = (p, b, m = 'POST') => fetch(U + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const replies = process.argv.slice(2);
const hh = await post('/api/households', { demo: true });
await post('/api/h/' + hh.id + '/ring', { slot: 'night' });
const started = await post('/api/h/' + hh.id + '/calls', {});
if (!started.secret?.value) throw new Error(JSON.stringify(started));
const ws = new WebSocket('wss://api.openai.com/v1/realtime', ['realtime', 'openai-insecure-api-key.' + started.secret.value]);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
const log = [];
let spoke = false;
const turn = () => new Promise(resolve => {
  ws.onmessage = m => {
    const e = JSON.parse(m.data);
    if (e.type === 'response.output_audio_transcript.done') { log.push('AGENT: ' + e.transcript); if (e.transcript.trim()) spoke = true; }
    if (e.type === 'response.done') {
      const calls = (e.response.output ?? []).filter(o => o.type === 'function_call');
      for (const c of calls) {
        log.push('  tool: ' + c.name + ' ' + c.arguments);
        // Mirror dist/realtime.mjs: waiting without having spoken asks for the line first.
        const out = c.name === 'wait_for_patient' && !spoke
          ? { ok: true, note: 'You have not said anything yet. Now say the "not taken yet" line out loud (can you take it now? I will stay on the line), in the patient\'s language. Do not call any tool. Then wait quietly.' }
          : { ok: true };
        ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) } }));
      }
      if (!calls.length) return resolve();
      const onlyWait = calls.every(c => c.name === 'wait_for_patient');
      if ((onlyWait && spoke) || calls.some(c => c.name === 'end_call')) return resolve();
      ws.send(JSON.stringify({ type: 'response.create' }));
    }
  };
});
ws.send(JSON.stringify({ type: 'response.create' }));
await turn();
for (const r of replies) {
  log.push('PATIENT: ' + r);
  spoke = false;
  ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: r }] } }));
  ws.send(JSON.stringify({ type: 'response.create' }));
  await Promise.race([turn(), new Promise(r => setTimeout(r, 25000))]);
}
ws.close();
console.log(log.join('\n'));
