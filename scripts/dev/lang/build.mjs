import { readFileSync, writeFileSync } from 'node:fs';
import { english, telugu } from './source.mjs';
const generated = JSON.parse(readFileSync('generated.json', 'utf8'));
// Respectful greetings for elders, not "Hello".
const fixes = { hi: [/हैलो|हेलो/g, 'नमस्ते'], mr: [/हॅलो|हेलो/g, 'नमस्कार'], gu: [/હેલો/g, 'નમસ્તે'], kn: [/ಹಲೋ|ಹೆಲೋ/g, 'ನಮಸ್ಕಾರ'], ml: [/ഹലോ/g, 'നമസ്കാരം'], bn: [/হ্যালো|হেলো/g, 'নমস্কার'] };
for (const [code, [pattern, word]] of Object.entries(fixes)) for (const group of ['phrases', 'ui']) for (const k of Object.keys(generated[code][group])) generated[code][group][k] = generated[code][group][k].replace(pattern, word);
// "హాఁ (haan) / ji" style entries → individual words.
const flatten = list => [...new Set(list.flatMap(item => item.split(/[()\/,]/).map(s => s.trim().toLowerCase()).filter(Boolean)))];
const english_pack = {
  name: 'English', native: 'English', script: 'Latin', transcribe: 'en', region: 'India', respect: 'polite, warm', honorific: '',
  addresses: ['Amma', 'Appa', 'Mummy', 'Papa', 'Grandma', 'Grandpa', 'Aunty', 'Uncle'],
  listening: ['yes', 'yeah', 'okay', 'ok', 'hmm', 'mm', 'right', 'uh-huh', 'sure', 'go on', 'i see', 'haan', 'achha'],
  stops: ['stop', 'wait', 'one minute', 'one second', 'hold on', 'enough', 'just a minute', 'sorry'],
  phrases: english.phrases, ui: english.ui,
};
const all = { te: telugu, hi: generated.hi, ta: generated.ta, kn: generated.kn, ml: generated.ml, mr: generated.mr, bn: generated.bn, gu: generated.gu, en: english_pack };
// Hand-checked core listening sounds: the plain "yes / okay / hmm" of each language.
const core = {
  te: ['అవును', 'సరే', 'ఆ', 'హ్మ్', 'ఓకే'],
  hi: ['हाँ', 'हां', 'जी', 'हम्म', 'अच्छा', 'ठीक है', 'हाँ जी'],
  ta: ['ஆமா', 'ஆமாம்', 'சரி', 'ம்ம்', 'ஓகே', 'சரிங்க'],
  kn: ['ಹೌದು', 'ಸರಿ', 'ಹ್ಞೂ', 'ಓಕೆ', 'ಆಯ್ತು', 'ಹ್ಮ್'],
  ml: ['അതെ', 'ശരി', 'ഉം', 'ഓക്കെ', 'ആ', 'ആം'],
  mr: ['हो', 'हं', 'बरं', 'ठीक आहे', 'ओके', 'हो ना'],
  bn: ['হ্যাঁ', 'হুঁ', 'আচ্ছা', 'ঠিক আছে', 'ওকে', 'হুম'],
  gu: ['હા', 'હાં', 'હં', 'બરાબર', 'ઓકે', 'ઠીક છે'],
  en: ['yes', 'okay', 'hmm'],
};
for (const [code, pack] of Object.entries(all)) {
  pack.listening = [...new Set([...core[code], ...flatten(pack.listening)])];
  pack.stops = flatten(pack.stops);
}
// Hand-checked core stop words: "stop / wait / enough / one minute" in each language.
const coreStops = {
  te: ['ఆగండి', 'ఆపండి', 'చాలు', 'ఒక్క నిమిషం', 'ఆగు'],
  hi: ['रुकिए', 'रुको', 'बस', 'एक मिनट', 'ठहरिए'],
  ta: ['நில்லுங்க', 'போதும்', 'ஒரு நிமிஷம்', 'நிறுத்துங்க'],
  kn: ['ನಿಲ್ಲಿಸಿ', 'ಸಾಕು', 'ಒಂದು ನಿಮಿಷ', 'ನಿಲ್ಲಿ'],
  ml: ['നിർത്തൂ', 'മതി', 'ഒരു മിനിറ്റ്', 'നിൽക്കൂ'],
  mr: ['थांबा', 'पुरे', 'बस', 'एक मिनिट'],
  bn: ['থামুন', 'থাক', 'ব্যস', 'এক মিনিট'],
  gu: ['રોકો', 'બસ', 'એક મિનિટ', 'થોભો'],
  en: ['stop', 'wait', 'enough', 'hold on'],
};
for (const [code, words] of Object.entries(coreStops)) all[code].stops = [...new Set([...words, ...all[code].stops])];
// Reviewed by hand: generated "listening" words that actually mean stop, a question, or nothing.
const notListening = { ml: ['മതി', 'mathi', 'സരി സരി'], ta: ['இருக்கட்டும்', 'irukkattum'], mr: ['म्हणून?', 'mhanun?'], gu: ['હું', 'hun'] };
const extraStops = { ml: ['മതി', 'mathi'] };
for (const [code, words] of Object.entries(notListening)) all[code].listening = all[code].listening.filter(w => !words.includes(w));
for (const [code, words] of Object.entries(extraStops)) all[code].stops = [...new Set([...all[code].stops, ...words])];
// A stop word must never also be a listening sound (e.g. "ठीक है"), and must not be a bare "no".
const listeningAnywhere = new Set(Object.values(all).flatMap(p => p.listening));
for (const pack of Object.values(all)) pack.stops = pack.stops.filter(w => !listeningAnywhere.has(w) && !['na', 'না', 'no', 'nahi', 'नहीं'].includes(w));
writeFileSync(new URL('../../../dist/languages.mjs', import.meta.url),
`// The languages On Time calls in: English and eight Indian languages. Telugu was written by
// hand; the others were generated once with gpt-5.2 (high reasoning) from one English source,
// checked for every phrase and placeholder, set to a woman's voice where verbs mark gender, and
// reviewed. Placeholders: {address} {name} {family} {brand} {strength} {use} {minutes} {slot}.
export const LANGUAGES = ${JSON.stringify(all, null, 1)};

export const LANGUAGE_CODES = Object.keys(LANGUAGES);

export const languageOf = code => LANGUAGES[code] ?? LANGUAGES.te;

export function fill(text, values) {
  return String(text).replace(/\\{(\\w+)\\}/g, (_, key) => values[key] ?? '{' + key + '}');
}
`);
console.log(Object.entries(all).map(([c, p]) => c + ':' + p.native + '(' + p.listening.length + '/' + p.stops.length + ')').join('  '));
