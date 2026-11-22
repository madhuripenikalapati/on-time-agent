import { readFileSync } from 'node:fs';
const KEY = process.env.OPENAI_API_KEY;
const DIR = new URL('./', import.meta.url).pathname;
const CANDIDATES = ['marin', 'cedar', 'coral', 'ash', 'echo', 'verse', 'shimmer'];
const letters = 'ABCDEFG';
const points = Object.fromEntries(CANDIDATES.map(v => [v, 0]));
const firsts = Object.fromEntries(CANDIDATES.map(v => [v, 0]));
const shuffle = (a, seed) => a.map((v, i) => [v, Math.sin(seed * 997 + i * 31)]).sort((x, y) => x[1] - y[1]).map(x => x[0]);
const jobs = [];
for (const line of [1, 2, 3]) for (const round of [1, 2]) jobs.push({ line, order: shuffle(CANDIDATES, line * 10 + round) });
await Promise.all(jobs.map(async ({ line, order }) => {
  const content = [{ type: 'text', text: `You are a native Telugu speaker from Andhra Pradesh. Below are ${order.length} recordings (A to ${letters[order.length - 1]}) of different voices saying the same Telugu sentence to an elderly person. Rank them from most to least natural for a Telugu elder: native Telugu pronunciation, natural Telugu intonation and rhythm (no foreign accent), and warmth. Reply with only JSON: {"ranking":["letter", ...], "best_reason":"short"}` }];
  order.forEach((v, i) => { content.push({ type: 'text', text: 'Recording ' + letters[i] + ':' }); content.push({ type: 'input_audio', input_audio: { data: readFileSync(DIR + v + '-' + line + '.wav').toString('base64'), format: 'wav' } }); });
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-audio-1.5', messages: [{ role: 'user', content }] }) }).then(r => r.json());
  const text = r.choices?.[0]?.message?.content ?? '';
  let ranking = [];
  try { ranking = JSON.parse(text.replace(/^[^{]*/, '').replace(/[^}]*$/, '')).ranking; } catch { console.log('unparsed:', text.slice(0, 120) || JSON.stringify(r.error)); return; }
  ranking.map(l => order[letters.indexOf(String(l).trim().toUpperCase()[0])]).filter(Boolean).forEach((voice, place) => { points[voice] += CANDIDATES.length - place; if (place === 0) firsts[voice]++; });
}));
const res = JSON.parse(readFileSync(DIR + 'results.json', 'utf8'));
console.log('voice    rank-points  times-ranked-1st  clarity-error');
for (const [v, p] of Object.entries(points).sort((a, b) => b[1] - a[1])) console.log(v.padEnd(8), String(p).padStart(6), String(firsts[v]).padStart(12), String((res.find(r => r.voice === v).cer * 100).toFixed(1) + '%').padStart(16));
