import { classify } from './logic.mjs';
import { clips } from './audio-lines.mjs';

const get = id => document.getElementById(id);
const key = 'on-time-agent-v1';
const defaultPlan = {name:'Demo Medicine A', strength:'10 mg (sample)', amount:'½ tablet (sample)', meal:'breakfast', timing:'after', time:'09:00', delay:30, follow:true, share:true, photo:''};
const initial = () => ({plan:{...defaultPlan}, outcome:'No check-in yet', detail:'', events:[], due:null});
function load() {
  try { return JSON.parse(localStorage.getItem(key)) ?? initial(); } catch { return initial(); }
}
const caregiverOnly = new URLSearchParams(location.search).get('view') === 'caregiver';
if (caregiverOnly) document.body.classList.add('caregiver-only');
let state = load();
let phase = 'ready';
let words = '';
let speechVersion = 0;
let recognition;
let callbackTimer;
let audioDone;
let playback;
const synth = window.speechSynthesis;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const meals = {breakfast:'బ్రేక్‌ఫాస్ట్', lunch:'మధ్యాహ్న భోజనం', dinner:'రాత్రి భోజనం'};
const phaseNames = {ready:'Ready', explaining:'Agent speaking', meal:'Meal check', pack:'Check label', dose:'Awaiting dose report', done:'Call ended', waiting:'Follow-up scheduled'};
const assist = (prefix, words) => {
  const entry = document.createElement('p');
  const label = document.createElement('strong');
  label.textContent = prefix + ' ';
  entry.append(label, words);
  get('transcript').append(entry);
  get('transcript').scrollTop = get('transcript').scrollHeight;
};
function setPhase(next) {
  phase = next;
  get('phase').textContent = phaseNames[next];
  const active = !['ready','done','waiting'].includes(next);
  get('send').disabled = !active;
  get('mic').disabled = !active || !Recognition;
  get('end').disabled = !active;
  get('repeat').disabled = !active;
  get('start').disabled = active || state.due !== null;
  get('examples').replaceChildren();
  const examples = {
    explaining:['Sare', 'Aagandi, ee tablet?', 'Continue to question'],
    meal:['Ayindi','Inka breakfast cheyyaledu','Aagandi, ee tablet?'],
    dose:['Avunu','Avunu, kaani tablet vesukoledu','Not sure','Aagandi, ee tablet?'],
  };
  for (const example of examples[next] ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = example;
    button.onclick = () => example === 'Continue to question' ? nextQuestion() : hear(example);
    get('examples').append(button);
  }
}
function stopAudio() {
  speechVersion++;
  audioDone = undefined;
  playback?.pause();
  playback = undefined;
  synth?.cancel();
}
function play(line, finished = undefined) {
  stopAudio();
  audioDone = finished;
  const version = speechVersion;
  const clip = clips.get(line);
  if (clip) {
    playback = new Audio('./audio/' + clip + '.m4a');
    playback.onended = () => { if (version === speechVersion) finished?.(); };
    playback.play().catch(() => {
      if (version === speechVersion) get('audio-status').textContent = 'Playback was blocked. Select Replay agent audio or use the text controls.';
    });
    return;
  }
  const speaker = synth?.getVoices().find(v => /^te([-_]|$)/i.test(v.lang));
  if (!speaker || !window.SpeechSynthesisUtterance) {
    get('audio-status').textContent = 'Telugu playback voice unavailable on this device. The dialogue and example replies still work.';
    return;
  }
  get('audio-status').textContent = '';
  const utterance = new SpeechSynthesisUtterance(line);
  utterance.voice = speaker;
  utterance.lang = speaker.lang;
  utterance.onend = () => { if (version === speechVersion) finished?.(); };
  utterance.onerror = () => { if (version === speechVersion) get('audio-status').textContent = 'Audio playback unavailable. Use the text controls.'; };
  synth.speak(utterance);
}
function say(line, finished) {
  words = line;
  assist('Agent', line);
  play(line, finished);
}
function renderCaregiver() {
  get('outcome').textContent = state.plan.share ? state.outcome : 'Sharing is off';
  get('detail').textContent = state.plan.share ? state.detail : 'The patient has not opted into caregiver updates.';
  get('activity').replaceChildren(...(state.plan.share ? state.events : []).map(event => {
    const item = document.createElement('li');
    item.textContent = event;
    return item;
  }));
}
function scheduleTimer() {
  clearTimeout(callbackTimer);
  get('advance').hidden = state.due === null;
  get('callback').textContent = state.due === null ? '' : 'Follow-up due at ' + new Date(state.due).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  if (state.due !== null && !caregiverOnly) {
    const due = state.due;
    callbackTimer = setTimeout(() => { if (load().due === due) start(true); }, Math.max(0, due - Date.now()));
  }
}
function persist() {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch {
    get('plan-status').textContent = 'This browser could not save the update. Try a smaller photo.';
    return false;
  }
  renderCaregiver();
  scheduleTimer();
  return true;
}
function report(outcome, detail) {
  state.outcome = outcome;
  state.detail = detail;
  state.events = [new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' · ' + outcome, ...state.events].slice(0,8);
  persist();
}
function start(callback = false) {
  if (caregiverOnly || (callback && state.due === null)) return;
  state.due = null;
  get('transcript').replaceChildren();
  get('pack').hidden = true;
  setPhase('explaining');
  report('Check-in in progress', callback ? 'Follow-up call started.' : 'Demo reminder call started.');
  say(callback ? 'నమస్కారం. ఇది ఆన్ టైమ్ ఏజెంట్ నుంచి ఫాలో అప్ కాల్.' : 'నమస్కారం. ఇది ఆన్ టైమ్ ఏజెంట్ నుంచి మీ మందు గురించి రిమైండర్ కాల్. మీ ప్లాన్ ఒకసారి చూసుకుందాం.', nextQuestion);
}
function nextQuestion() {
  if (phase === 'done' || phase === 'waiting') return;
  const { timing, meal } = state.plan;
  if (timing === 'after') {
    setPhase('meal');
    say(meals[meal] + ' అయిందా?');
  } else {
    askDose();
  }
}
function askDose() {
  setPhase('dose');
  say('మీరు మీ ప్లాన్‌లో ఉన్న టాబ్లెట్ వేసుకున్నారా?');
}
function showPack() {
  const plan = state.plan;
  get('pack-name').textContent = get('sample-name').textContent = plan.name;
  get('pack-strength').textContent = get('sample-strength').textContent = plan.strength;
  get('pack-amount').textContent = plan.amount;
  const photo = get('pack-photo');
  photo.hidden = !plan.photo;
  get('sample-pack').hidden = Boolean(plan.photo);
  if (plan.photo) photo.src = plan.photo;
  else photo.removeAttribute('src');
  get('pack').hidden = false;
  setPhase('pack');
  say('మీ స్క్రీన్ మీద సేవ్ చేసిన ప్యాక్ వివరాలు చూపిస్తున్నాను. పేరు, స్ట్రెంగ్త్ లేబుల్ మీద ఒకసారి చూడండి.');
}
function mismatched() {
  setPhase('done');
  get('match').disabled = get('mismatch').disabled = true;
  report('Needs help checking the pack', 'Dose unconfirmed. The patient said the label differs or is unreadable.');
  say('డోస్ తీసుకున్నట్టు నమోదు చేయలేదు. ఈ ప్యాక్ గురించి ఫార్మసిస్ట్‌ని అడగండి.');
}
function hear(reply) {
  if (['ready','waiting','done'].includes(phase)) return;
  assist('Patient', reply);
  const result = classify(reply, phase);
  switch (result) {
    case 'continue': return;
    case 'pack':
      get('match').disabled = get('mismatch').disabled = false;
      showPack();
      return;
    case 'mismatch': mismatched(); return;
    case 'meal-done': askDose(); return;
    case 'meal-late':
      if (phase === 'meal' && state.plan.timing === 'after' && state.plan.follow) {
        state.due = Date.now() + state.plan.delay * 60000;
        setPhase('waiting');
        report('Follow-up scheduled', 'Meal delayed. Dose unconfirmed. Check-in in ' + state.plan.delay + ' minutes.');
        say('సరే. మీ ప్లాన్ ప్రకారం మళ్ళీ కాల్ చేస్తాను.');
      } else {
        setPhase('done');
        report('Unconfirmed', 'Meal delayed. No automatic schedule change.');
        say('సరే. డోస్ తీసుకున్నట్టు నమోదు చేయలేదు.');
      }
      return;
    case 'taken':
      setPhase('done');
      report('Patient reported taking the dose', 'Self-reported during this Telugu check-in.');
      say('సరే. మీరు వేసుకున్నారని నమోదు చేశాను.');
      return;
    case 'unconfirmed':
      setPhase('done');
      report('Unconfirmed', 'No clear confirmation that the dose was taken.');
      say('సరే. డోస్ తీసుకున్నట్టు నమోదు చేయలేదు.');
      return;
    case 'yield':
      stopAudio();
      assist('Agent', 'Listening. Tell me what you need.');
      return;
    default:
      stopAudio();
      assist('Agent', 'I didn’t get a clear answer. Please say it again.');
  }
}
get('start').onclick = () => start();
get('advance').onclick = () => start(true);
get('repeat').onclick = () => play(words, audioDone);
get('end').onclick = () => {
  stopAudio();
  recognition?.abort();
  setPhase('done');
  report('Unconfirmed', 'The check-in ended before the patient confirmed this dose.');
};
get('match').onclick = () => { get('pack').hidden = true; nextQuestion(); };
get('mismatch').onclick = mismatched;
get('reply').onsubmit = event => {
  event.preventDefault();
  hear(get('words').value);
  get('words').value = '';
};
get('mic').onclick = () => {
  if (!Recognition || recognition) return;
  recognition = new Recognition();
  recognition.lang = 'te-IN';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onresult = event => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const reply = event.results[i];
      if (reply.isFinal) hear(reply[0].transcript);
      else if (classify(reply[0].transcript, phase, false) === 'yield') stopAudio();
    }
  };
  recognition.onerror = event => { get('audio-status').textContent = 'Microphone recognition: ' + event.error + '. You can use text replies.'; };
  recognition.onend = () => {
    recognition = undefined;
    get('mic').textContent = 'Listen in Telugu';
    get('mic').disabled = ['ready','waiting','done'].includes(phase);
  };
  try {
    recognition.start();
    get('mic').textContent = 'Listening…';
    get('mic').disabled = true;
  } catch {
    recognition = undefined;
    get('audio-status').textContent = 'Unable to start recognition. You can use text replies.';
  }
};

const planForm = get('plan');
function fillPlan() {
  for (const [name,value] of Object.entries(state.plan)) {
    const input = planForm.elements.namedItem(name);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
}
planForm.onsubmit = async event => {
  event.preventDefault();
  const data = new FormData(planForm);
  const file = get('photo-upload').files[0];
  let photo = state.plan.photo;
  if (file) {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 750000) {
      get('plan-status').textContent = 'Choose a PNG, JPEG, or WebP under 750 KB.';
      return;
    }
    photo = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (!photo) { get('plan-status').textContent = 'Could not read the photo.'; return; }
  }
  const updated = { ...initial(), plan:{name:data.get('name'), strength:data.get('strength'), amount:data.get('amount'), meal:data.get('meal'), timing:data.get('timing'), time:data.get('time'), delay:Number(data.get('delay')), follow:data.has('follow'), share:data.has('share'), photo} };
  const former = state;
  state = updated;
  if (!persist()) { state = former; return; }
  stopAudio();
  recognition?.abort();
  get('pack').hidden = true;
  get('transcript').replaceChildren();
  setPhase('ready');
  get('plan-status').textContent = 'Reviewed demo care plan saved.';
  planForm.elements.namedItem('review').checked = false;
};
window.addEventListener('storage', event => {
  if (event.key !== key) return;
  state = load();
  renderCaregiver();
  if (!caregiverOnly && ['ready','waiting','done'].includes(phase)) {
    setPhase(state.due === null ? 'ready' : 'waiting');
    scheduleTimer();
  }
});
if (!caregiverOnly) {
  setPhase(state.due === null ? 'ready' : 'waiting');
  fillPlan();
  scheduleTimer();
}
renderCaregiver();
