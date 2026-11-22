// Records short caller answers (Hindi, English) with a live call session, as 16 kHz mono WAV.
import { writeFileSync } from 'node:fs';
const U = 'https://vqe7ihx8pe.execute-api.us-west-2.amazonaws.com';
const OUT = new URL('./', import.meta.url).pathname;
const post = (p, b) => fetch(U + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const LINES = { 'hi-ate': 'हाँ, खाना खा लिया।', 'hi-took': 'हाँ, मैंने दवाई ले ली।', 'en-ate': 'Yes, I had my breakfast.', 'en-took': 'Yes, I took it.' };
const hh = await post('/api/households', { demo: true });
await post('/api/h/' + hh.id + '/ring', { slot: 'morning' });
const started = await post('/api/h/' + hh.id + '/calls', {});
const ws = new WebSocket('wss://api.openai.com/v1/realtime', ['realtime', 'openai-insecure-api-key.' + started.secret.value]);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
for (const [name, line] of Object.entries(LINES)) {
  const chunks = [];
  await new Promise(resolve => {
    ws.onmessage = m => { const e = JSON.parse(m.data); if (e.type === 'response.output_audio.delta') chunks.push(Buffer.from(e.delta, 'base64')); if (e.type === 'response.done') resolve(); };
    ws.send(JSON.stringify({ type: 'response.create', response: { tool_choice: 'none', conversation: 'none', input: [], instructions: 'You are an elderly patient answering a phone call. Say exactly this, naturally, and nothing else: ' + line } }));
  });
  // 24 kHz PCM16 → 16 kHz, then WAV.
  const pcm = Buffer.concat(chunks);
  const src = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const n = Math.floor(src.length * 2 / 3);
  const dst = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) dst.writeInt16LE(src[Math.floor(i * 1.5)], i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dst.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(dst.length, 40);
  writeFileSync(OUT + name + '.wav', Buffer.concat([h, dst]));
  console.log(name, (dst.length / 32000).toFixed(1) + ' s');
}
ws.close();
await post('/api/h/' + hh.id + '/cancel-ring', {});
