// Records the same Telugu phrasebook lines in every realtime voice, then scores each voice
// for clarity (transcribe back, character error rate) and naturalness (gpt-audio-1.5 rating).
import { writeFileSync } from 'node:fs';

const KEY = process.env.OPENAI_API_KEY;
const DIR = new URL('./', import.meta.url).pathname;
const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
const LINES = [
  'నమస్కారం Lakshmi గారు. నేను On Time నుంచి మాట్లాడుతున్నాను. మీ మందుల గురించి అడగడానికి call చేశాను.',
  'మంచిది అండి. ఇవాళ Antibiotic ఆఖరి రోజు. రేపటి నుంచి వేసుకోవాల్సిన అవసరం లేదు.',
  'అయ్యో, అలాగా అండి. Ravi గారికి వెంటనే చెప్తాను. ఇంకా ఏమైనా ఇబ్బంది ఉందా?',
];

const api = (path, body) => fetch('https://api.openai.com/v1' + path, {
  method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

function wav(pcm, rate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function record(voice) {
  const secret = await api('/realtime/client_secrets', { expires_after: { anchor: 'created_at', seconds: 300 }, session: {
    type: 'realtime', model: 'gpt-realtime-2.1', output_modalities: ['audio'],
    instructions: 'You read Telugu sentences aloud exactly as written, warmly and slowly, like a caring grandchild speaking to an elder in Andhra Pradesh. Say only the sentence you are given, nothing else.',
    audio: { input: { turn_detection: null }, output: { voice, speed: 0.9 } },
  } });
  if (!secret.value) throw new Error(voice + ': ' + JSON.stringify(secret.error ?? secret));
  const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + secret.value]);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(voice + ': websocket failed')); });
  const clips = [];
  for (const [i, line] of LINES.entries()) {
    const chunks = [];
    const done = new Promise((resolve, reject) => {
      ws.onmessage = m => {
        const e = JSON.parse(m.data);
        if (e.type === 'response.output_audio.delta') chunks.push(Buffer.from(e.delta, 'base64'));
        if (e.type === 'response.done') resolve();
        if (e.type === 'error') reject(new Error(voice + ': ' + e.error.message));
      };
    });
    ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say exactly this sentence: ' + line }] } }));
    ws.send(JSON.stringify({ type: 'response.create' }));
    await done;
    const file = DIR + voice + '-' + (i + 1) + '.wav';
    writeFileSync(file, wav(Buffer.concat(chunks)));
    clips.push(file);
  }
  ws.close();
  return clips;
}

const norm = s => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
function cer(ref, hyp) {
  const a = [...norm(ref)], b = [...norm(hyp)];
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] / a.length;
}

async function transcribe(file) {
  const form = new FormData();
  form.append('file', new Blob([(await import('node:fs')).readFileSync(file)], { type: 'audio/wav' }), 'clip.wav');
  form.append('model', 'gpt-transcribe');
  form.append('language', 'te');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY }, body: form }).then(r => r.json());
  return r.text ?? '';
}

async function rate(files) {
  const { readFileSync } = await import('node:fs');
  const r = await api('/chat/completions', {
    model: 'gpt-audio-1.5',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'You are a native Telugu speaker from Andhra Pradesh judging a voice for an elder-care phone call. For each of these three clips, rate 1-10 how natural it sounds to a Telugu elder: native-like pronunciation of Telugu words, natural Telugu intonation and rhythm (not foreign-accented), warmth, and clarity. Reply with only JSON: {"scores":[a,b,c],"comment":"one short sentence"}' },
      ...files.map(f => ({ type: 'input_audio', input_audio: { data: readFileSync(f).toString('base64'), format: 'wav' } })),
    ] }],
  });
  const text = r.choices?.[0]?.message?.content ?? JSON.stringify(r.error ?? r);
  try { return JSON.parse(text.replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch { return { scores: [], comment: text.slice(0, 160) }; }
}

const results = await Promise.all(VOICES.map(async voice => {
  try {
    const clips = await record(voice);
    const heard = await Promise.all(clips.map(transcribe));
    const clarity = heard.map((h, i) => cer(LINES[i], h));
    const judged = await rate(clips);
    const natural = judged.scores?.length ? judged.scores.reduce((a, b) => a + b, 0) / judged.scores.length : null;
    return { voice, cer: clarity.reduce((a, b) => a + b, 0) / clarity.length, natural, comment: judged.comment, sample: heard[1] };
  } catch (error) {
    return { voice, error: error.message };
  }
}));
results.sort((a, b) => (b.natural ?? -1) - (a.natural ?? -1) || (a.cer ?? 9) - (b.cer ?? 9));
for (const r of results) {
  if (r.error) { console.log(r.voice.padEnd(8), 'ERROR', r.error.slice(0, 120)); continue; }
  console.log(r.voice.padEnd(8), 'natural', String(r.natural?.toFixed(1)).padEnd(4), '| clarity error', (r.cer * 100).toFixed(1).padStart(5) + '%', '|', r.comment);
}
writeFileSync(DIR + 'results.json', JSON.stringify(results, null, 2));
