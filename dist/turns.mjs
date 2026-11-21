// Avunu ≠ Aagandi: Telugu-aware turn-taking.
//
// While the agent is talking, a caller's short "సరే / అవును / హ్మ్" means "I'm listening, go on".
// The same "అవును" right after the agent asks a question is an answer. Anything with real
// content ("ఆగండి", "ఈ tablet?", "అవును, కానీ…") takes the floor. Standard voice bots treat all
// speech the same: they either stop on every "హ్మ్" or talk over a real "ఆగండి".

import { LANGUAGES } from './languages.mjs';

const LISTENING = new Set([
  ...Object.values(LANGUAGES).flatMap(l => l.listening),
  // Telugu script
  'సరే', 'సరి', 'సరేనండి', 'సరే అండి', 'అవును', 'అవునండి', 'ఔను', 'ఆ', 'ఆఁ', 'ఆహా', 'హా', 'హాఁ', 'హ్మ్', 'హ్మ్మ్', 'హమ్',
  'హూ', 'ఊ', 'ఊఁ', 'ఉమ్', 'మ్', 'మ్మ్', 'ఓకే', 'అలాగే', 'అలాగేనండి', 'అచ్చా', 'ఓ', 'ఓహో',
  // Romanized Telugu, Hindi and English
  'sare', 'sari', 'sarenandi', 'avunu', 'avnu', 'aunu', 'avunandi', 'aa', 'aaa', 'aah', 'ah', 'ha', 'haa', 'haan', 'han',
  'hmm', 'hm', 'hmmm', 'mm', 'mmm', 'umm', 'um', 'ok', 'okay', 'oke', 'alage', 'achha', 'accha', 'acha', 'ji', 'oh',
  'yes', 'yeah', 'yep', 'right', 'uh-huh', 'uhuh', 'andi',
  // Devanagari
  'हाँ', 'हां', 'हम्म', 'अच्छा', 'ठीक', 'जी', 'ओके',
]);

const STOP_WORDS = Object.values(LANGUAGES).flatMap(l => l.stops).filter(w => w.length > 1);
const escape = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STOP_ANY = new RegExp('(^|\\s)(' + STOP_WORDS.map(escape).join('|') + ')(\\s|$)', 'u');
const STOP = /ఆగండి|ఆగు|ఆపండి|ఆపు|చాలు|ఒక్క నిమిషం|ఉండండి|\b(aagandi|agandi|aagu|aapandi|aapu|chaalu|chalu|wait|stop|ruko|ruk|bas)\b|रुको|बस/u;
// A correction ("no, not that") must always take the floor, even as one short word.
const NEGATION = new Set(['కాదు', 'లేదు', 'వద్దు', 'kaadu', 'ledu', 'vaddu', 'नहीं', 'ना', 'nahi', 'nahin', 'இல்ல', 'இல்லை', 'வேண்டாம்', 'illa', 'illai', 'vendaam',
  'ಇಲ್ಲ', 'ಬೇಡ', 'beda', 'ഇല്ല', 'വേണ്ട', 'venda', 'नाही', 'नको', 'nako', 'না', 'na', 'ના', 'નહીં', 'no', 'nope', 'not']);
// "What?" on its own asks the agent to stop and repeat.
const WHAT = new Set(['ఏంటి', 'ఏమిటి', 'ఏమన్నారు', 'ఏమంటున్నారు', 'emiti', 'enti', 'क्या', 'kya', 'என்ன', 'enna', 'ಏನು', 'enu', 'എന്ത്', 'enthu', 'काय', 'kay',
  'কী', 'কি', 'ki', 'શું', 'shu', 'what', 'sorry', 'pardon']);
const QUESTION = /\?|ఏ |ఏది|ఏం|ఎందుకు|ఎప్పుడు|ఎలా|ఎంత|ఈ tablet|ee tablet|ye tablet|which|what|emiti|enti|endhuku|kya|kaun/iu;

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,!…।"'“”‘’()\-–—:;]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalize(text).replace(/\?/g, ' ').split(' ').filter(Boolean);
}

// True when every word is a listening sound ("సరే సరే", "hmm avunu", "అవునండి").
export function isListeningSound(text) {
  const words = tokens(text);
  if (!words.length || words.length > 5) return false;
  const joined = words.join(' ');
  return LISTENING.has(joined) || words.every(word => LISTENING.has(word) || /^(h?m+|a+h?|ha+|o+h?|u+m+)$/u.test(word));
}

// Echo guard: the microphone picked up the agent's own voice.
function looksLikeEcho(heard, agentText) {
  const said = new Set(tokens(agentText));
  const words = tokens(heard);
  if (words.length < 3 || said.size < 3) return false;
  const overlap = words.filter(word => said.has(word)).length;
  return overlap / words.length >= 0.7;
}

/**
 * Decide what a finished caller utterance means.
 * @param {string} heard transcript of the caller's utterance
 * @param {{agentSpeaking: boolean, agentText?: string}} context whether the agent was mid-sentence when the caller started
 * @returns {{decision: 'noise'|'backchannel'|'yield'|'answer', reason: string}}
 */
export function classifyTurn(heard, { agentSpeaking, agentText = '' }) {
  const text = normalize(heard);
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return { decision: 'noise', reason: 'no words' };
  if (agentSpeaking && looksLikeEcho(text, agentText)) return { decision: 'noise', reason: 'echo of the agent' };
  if (!agentSpeaking) return { decision: 'answer', reason: isListeningSound(text) ? 'reply to a question' : 'reply' };
  if (STOP.test(text) || STOP_ANY.test(text)) return { decision: 'yield', reason: 'stop word' };
  if (isListeningSound(text)) return { decision: 'backchannel', reason: 'listening sound' };
  const words = tokens(text);
  if (words.some(w => NEGATION.has(w))) return { decision: 'yield', reason: 'correction' };
  if (words.some(w => WHAT.has(w)) || text.includes('?')) return { decision: 'yield', reason: 'question' };
  // One short word we don't recognise, while the agent talks, is almost always a listening sound
  // that speech-to-text misheard ("సరే" came back as "సన్నీ" in real-audio tests). Keep talking.
  if (words.length === 1 && [...words[0]].length <= 6) return { decision: 'backchannel', reason: 'short sound' };
  if (QUESTION.test(text)) return { decision: 'yield', reason: 'question' };
  return { decision: 'yield', reason: 'new information' };
}
