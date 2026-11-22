import { writeFileSync } from 'node:fs';
import { english, telugu, targets } from './source.mjs';
const KEY = process.env.OPENAI_API_KEY;
const strings = keys => ({ type: 'object', additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map(k => [k, { type: 'string' }])) });
const schema = { type: 'object', additionalProperties: false, required: ['native', 'respect', 'honorific', 'addresses', 'listening', 'stops', 'phrases', 'ui'], properties: {
  native: { type: 'string' }, respect: { type: 'string' }, honorific: { type: 'string' },
  addresses: { type: 'array', items: { type: 'string' } }, listening: { type: 'array', items: { type: 'string' } }, stops: { type: 'array', items: { type: 'string' } },
  phrases: strings(Object.keys(english.phrases)), ui: strings(Object.keys(english.ui)),
} };
const placeholders = s => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

async function generate(code, { name, script, region }) {
  const prompt = `You write the exact words a warm, respectful voice assistant says on a short medicine check-in phone call to an elderly person in ${region}, and the words on that elder's phone screen. Language: spoken ${name}, written in ${script} script.

Rules:
- Simple, everyday SPOKEN ${name}, the way a caring grandchild talks to a grandparent at home. Not formal, bookish or Sanskritised. Short sentences.
- Respectful forms for elders (e.g. the plural/honorific "you").
- Keep common English medical words exactly as everyday ${name} speakers say them, written in Latin letters: tablet, strip, BP, sugar, doctor, call, On Time.
- Keep every placeholder exactly as written, e.g. {address}, {name}, {family}, {brand}, {strength}, {use}, {minutes}, {slot}. Do not translate or remove them.
- Meaning must match the English exactly. Questions stay questions.
- The assistant's voice is a WOMAN: wherever the language marks the speaker's gender (first-person verbs like "I am speaking", "I will tell", "I will call"), use the feminine form consistently.
- On the phone screen, "Answer" and "Decline" are the two buttons of an incoming phone call: use the words phones in this language use for picking up and rejecting a call.

Also give:
- native: the language's name in its own script
- respect: the key respectful words/forms you used (short)
- honorific: the respectful suffix used after an elder's name when addressing them, with a leading space (e.g. " जी"), or "" if the language normally uses none
- addresses: 6 to 8 respectful ways a family addresses elders (mother, father, grandmothers, grandfathers, aunt, uncle), in ${script} script
- listening: 10 to 16 short sounds/words a listener says while someone talks, meaning "I'm listening, go on" (yes, okay, hmm…), in ${script} script AND common romanized spellings
- stops: 8 to 14 short words/phrases meaning "stop", "wait", "enough", "one minute", in ${script} script AND common romanized spellings

For reference, here is the same content in Telugu, written by a native speaker. Match its tone and length:
${JSON.stringify({ phrases: telugu.phrases, ui: telugu.ui }, null, 1)}

English source to translate:
${JSON.stringify(english, null, 1)}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({
    model: 'gpt-5.2', reasoning: { effort: 'high' }, max_output_tokens: 16000, store: false,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    text: { format: { type: 'json_schema', name: 'language_pack', strict: true, schema } },
  }) }).then(r => r.json());
  const text = response.output?.flatMap(i => i.content ?? []).find(c => c.type === 'output_text')?.text;
  if (!text) throw new Error(code + ': ' + JSON.stringify(response.error ?? response.status));
  const pack = JSON.parse(text);
  const problems = [];
  for (const group of ['phrases', 'ui']) for (const [key, source] of Object.entries(english[group])) {
    if (!pack[group][key]?.trim()) problems.push(group + '.' + key + ' missing');
    else if (placeholders(pack[group][key]) !== placeholders(source)) problems.push(group + '.' + key + ' placeholders ' + placeholders(pack[group][key]) + ' vs ' + placeholders(source));
  }
  return { code, pack: { name, script, transcribe: code, region, ...pack }, problems };
}

const only = (process.env.ONLY || '').split(',').filter(Boolean);
const results = await Promise.all(Object.entries(targets).filter(([code]) => !only.length || only.includes(code)).map(([code, info]) => generate(code, info).catch(e => ({ code, error: e.message }))));
import { readFileSync, existsSync } from 'node:fs';
const out = existsSync('generated.json') ? JSON.parse(readFileSync('generated.json', 'utf8')) : {};
for (const r of results) {
  if (r.error) { console.log(r.code, 'ERROR', r.error); continue; }
  console.log(r.code, r.pack.native, '|', r.problems.length ? 'PROBLEMS: ' + r.problems.join('; ') : 'all ' + (Object.keys(english.phrases).length + Object.keys(english.ui).length) + ' strings OK', '| listening', r.pack.listening.length, '| stops', r.pack.stops.length);
  out[r.code] = r.pack;
}
writeFileSync('generated.json', JSON.stringify(out, null, 1));
