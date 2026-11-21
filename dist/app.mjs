import { classify, prescriptionDraft, refillDates } from './logic.mjs';
import { clips } from './audio-lines.mjs';

const get = id => document.getElementById(id);
const key = 'on-time-agent-v1';
const defaultPlan = {name:'Demo Medicine A', strength:'10 mg (sample)', amount:'½ tablet (sample)', meal:'breakfast', days:'daily', timing:'after', time:'09:00', delay:30, follow:true, share:true, photo:''};
const initial = () => ({plan:{...defaultPlan}, outcome:'No check-in yet', detail:'', events:[], due:null, reminders:{}});
function load() {
  try { return JSON.parse(localStorage.getItem(key)) ?? initial(); } catch { return initial(); }
}
const caregiverOnly = new URLSearchParams(location.search).get('view') === 'caregiver';
const views = {
  call:['Medication check-in','A Telugu reminder based on the reviewed care plan.'],
  plan:['Care plan','Review the prescription and link the labeled medicine pack.'],
  reminders:['Reminders','Set a refill lead time or add an upcoming appointment.'],
  family:['Caregiver dashboard','Dose reports, follow-ups, and reminders from this browser.'],
};
function showView() {
  const view = caregiverOnly ? 'family' : ({'#review-panel':'plan','#reminders-panel':'reminders'}[location.hash] ?? 'call');
  for (const name of ['call','plan','reminders','caregiver']) document.body.classList.remove('view-' + name);
  document.body.classList.add('view-' + (view === 'family' ? 'caregiver' : view));
  for (const name of Object.keys(views)) get('nav-' + name).removeAttribute('aria-current');
  get('nav-' + view).setAttribute('aria-current','page');
  [get('page-title').textContent,get('page-description').textContent] = views[view];
  get('open-caregiver').hidden = view !== 'call';
}
if (caregiverOnly) {
  get('nav-call').href = './#check-in';
  get('nav-plan').href = './#review-panel';
  get('nav-reminders').href = './#reminders-panel';
}
showView();
window.addEventListener('hashchange',showView);
let state = load();
let phase = 'ready';
let pendingReview = false;
let openai = false;
let phaseVersion = 0;
let interpretationSequence = 0;
if (location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname)) {
  fetch('/api/status').then(response => response.ok ? response.json() : {}).then(config => {
    openai = Boolean(config.openai);
    if (openai) get('audio-status').textContent = 'OpenAI interpretation enabled for this demo.';
  }).catch(() => {});
}
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
  phaseVersion++;
  get('phase').textContent = phaseNames[next];
  const active = !['ready','done','waiting'].includes(next);
  get('send').disabled = !active;
  get('no-answer').disabled = !active;
  get('mic').disabled = !active || !Recognition;
  get('end').disabled = !active;
  get('repeat').disabled = !active;
  get('start').disabled = active || state.due !== null || pendingReview;
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
const dateLabel = new Intl.DateTimeFormat(undefined,{dateStyle:'medium'});
const timeLabel = new Intl.DateTimeFormat(undefined,{dateStyle:'medium', timeStyle:'short'});
function renderReminders() {
  const reminders = state.reminders ?? {};
  const items = [];
  const now = Date.now();
  if (reminders.refill) {
    const {due, runOut} = reminders.refill;
    items.push((due <= now ? 'Refill reminder due' : 'Refill reminder ' + dateLabel.format(due)) +
      ' · ' + state.plan.name + ' · First dose without enough estimated stock: ' + dateLabel.format(runOut));
  }
  if (reminders.visit) {
    const {name, at, due} = reminders.visit;
    items.push(name + ' · ' + timeLabel.format(at) + ' · ' +
      (due <= now ? (at <= now ? 'Appointment time reached' : 'Reminder due') : 'Remind on ' + timeLabel.format(due)));
  }
  const visible = state.plan.share ? items : [];
  get('reminder-summary').replaceChildren(...(visible.length ? visible : ['No shared reminders']).map(line => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
  get('reminder-status').textContent = items.join(' | ');
}
function renderCaregiver() {
  const plan = state.plan;
  get('plan-line').textContent = plan.name + ' · ' + plan.amount + ' · ' +
    (plan.timing === 'fixed' ? plan.time : (plan.timing === 'before' ? 'Before ' : 'After ') + plan.meal);
  renderReminders();
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
function queueFollowUp(reason) {
  state.due = Date.now() + state.plan.delay * 60000;
  setPhase('waiting');
  report('Follow-up scheduled', reason + ' Dose unconfirmed. Check-in in ' + state.plan.delay + ' minutes.');
  say('సరే. మీ ప్లాన్ ప్రకారం మళ్ళీ కాల్ చేస్తాను.');
}
function start(callback = false) {
  if (caregiverOnly || pendingReview || (callback && state.due === null)) return;
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
async function hear(reply) {
  if (['ready','waiting','done'].includes(phase)) return;
  assist('Patient', reply);
  let result = classify(reply, phase);
  if (openai && !['continue','pack','mismatch','yield'].includes(result)) {
    const version = phaseVersion;
    const sequence = ++interpretationSequence;
    get('audio-status').textContent = 'Interpreting the reply…';
    try {
      const response = await fetch('/api/interpret', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({reply,phase}),signal:AbortSignal.timeout(8500)
      });
      if (!response.ok) throw new Error('Interpretation unavailable');
      const {action} = await response.json();
      if (version !== phaseVersion || sequence !== interpretationSequence) return;
      // Only a locally recognized, unambiguous final confirmation can record a dose.
      if (['not-taken','unconfirmed'].includes(result)) { /* keep explicit local negative or uncertainty */ }
      else result = action === 'taken' && result !== 'taken' ? 'unclear' : action;
      get('audio-status').textContent = 'Reply interpreted with OpenAI.';
    } catch {
      if (version !== phaseVersion || sequence !== interpretationSequence) return;
      get('audio-status').textContent = 'OpenAI unavailable. Using the local reply rules.';
    }
  } else {
    interpretationSequence++;
  }
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
        queueFollowUp('Meal delayed.');
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
    case 'not-taken':
      if (phase === 'dose' && state.plan.follow) {
        queueFollowUp('Patient reported the dose was not taken.');
        return;
      }
      // A negative report and uncertainty both remain unconfirmed.
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
get('no-answer').onclick = () => {
  stopAudio();
  recognition?.abort();
  if (state.plan.follow) {
    queueFollowUp('No answer.');
  } else {
    setPhase('done');
    report('Unconfirmed','No answer. The reviewed plan does not allow a follow-up.');
  }
};
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
  let photo = data.get('name') === state.plan.name && data.get('strength') === state.plan.strength ? state.plan.photo : '';
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
  const updated = { ...initial(), reminders:{visit:state.reminders?.visit, fields:Object.fromEntries(Object.entries(state.reminders?.fields ?? {}).filter(([name]) => name.startsWith('appointment')))}, plan:{name:data.get('name'), strength:data.get('strength'), amount:data.get('amount'), meal:data.get('meal'), days:data.get('days'), timing:data.get('timing'), time:data.get('time'), delay:Number(data.get('delay')), follow:data.has('follow'), share:data.has('share'), photo} };
  const former = state;
  state = updated;
  if (!persist()) { state = former; return; }
  pendingReview = false;
  stopAudio();
  recognition?.abort();
  get('pack').hidden = true;
  get('transcript').replaceChildren();
  setPhase('ready');
  get('reminders').elements.namedItem('stock').value = '';
  get('plan-call').hidden = false;
  get('plan-status').textContent = 'Reviewed demo care plan saved. Enter a fresh stock count to estimate a refill.';
  planForm.elements.namedItem('review').checked = false;
};
let previewUrl;
function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  for (const id of ['source-text','source-photo','source-pdf','source-link']) get(id).hidden = true;
}
function reviewDraft(text) {
  clearPreview();
  get('source-text').textContent = text;
  get('source-text').hidden = false;
  const draft = prescriptionDraft(text);
  for (const [name,value] of Object.entries(draft)) {
    const input = planForm.elements.namedItem(name);
    if (input instanceof HTMLSelectElement && !Array.from(input.options).some(option => option.value === value)) continue;
    if (input) input.value = value;
  }
  get('source-status').textContent = Object.keys(draft).length
    ? 'Draft populated from the text file. Compare every field with the source before saving.'
    : 'Enter the schedule manually, then review it against this source.';
}
function beginReview() {
  if (!['ready','done','waiting'].includes(phase)) {
    get('source-status').textContent = 'End this demo call before loading another prescription.';
    return false;
  }
  pendingReview = true;
  get('plan-call').hidden = true;
  planForm.elements.namedItem('review').checked = false;
  get('start').disabled = true;
  return true;
}
get('prescription').onchange = async () => {
  const file = get('prescription').files[0];
  if (!file) return;
  const isText = /\.txt$/i.test(file.name);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = ['image/png','image/jpeg','image/webp'].includes(file.type);
  if ((!isText && !isPdf && !isImage) || file.size > (isText ? 25000 : 5000000)) {
    get('source-status').textContent = 'Choose a small TXT file, PDF, JPEG, PNG, or WebP.';
    return;
  }
  if (!beginReview()) return;
  if (isText) {
    const text = await file.text();
    if (get('prescription').files[0] === file) reviewDraft(text);
    return;
  }
  clearPreview();
  previewUrl = URL.createObjectURL(file);
  if (isPdf) {
    get('source-pdf').data = previewUrl;
    get('source-pdf').hidden = false;
    get('source-link').href = previewUrl;
    get('source-link').hidden = false;
  } else {
    get('source-photo').src = previewUrl;
    get('source-photo').hidden = false;
  }
  get('source-status').textContent = 'File opened locally. Enter or confirm the fields below against the document.';
};
get('sample').onclick = async () => {
  if (!beginReview()) return;
  get('prescription').value = '';
  try {
    const response = await fetch('./sample-prescription.txt');
    if (!response.ok) throw new Error('sample unavailable');
    const text = await response.text();
    if (!get('prescription').files.length) reviewDraft(text);
  } catch {
    get('source-status').textContent = 'Couldn’t load the sample. You can still review and save the plan below.';
  }
};
get('reminders').onsubmit = event => {
  event.preventDefault();
  if (pendingReview) {
    get('reminder-status').textContent = 'Save the reviewed plan before estimating a refill.';
    return;
  }
  const data = new FormData(event.target);
  const stock = data.get('stock');
  const appointment = data.get('appointment').trim();
  const appointmentTime = data.get('appointmentTime');
  if (Boolean(appointment) !== Boolean(appointmentTime)) {
    get('reminder-status').textContent = 'Enter both an appointment name and a date and time.';
    return;
  }
  const dates = refillDates({stock, units:data.get('units'), days:state.plan.days ?? 'daily', lead:data.get('lead')}, new Date());
  if (stock && !dates) {
    get('reminder-status').textContent = 'Check the stock count and tablets per dose.';
    return;
  }
  const at = new Date(appointmentTime).getTime();
  state.reminders = {
    fields:Object.fromEntries(data),
    refill: dates ? {due:dates.reminder.getTime(), runOut:dates.runOut.getTime()} : null,
    visit: appointment ? {name:appointment, at, due:at - Number(data.get('appointmentLead')) * 3600000} : null,
  };
  persist();
  if (!stock && !appointment) get('reminder-status').textContent = 'Reminders cleared.';
};
setInterval(renderReminders, 30000);
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
  for (const [name,value] of Object.entries(state.reminders?.fields ?? {})) {
    const input = get('reminders').elements.namedItem(name);
    if (input) input.value = value;
  }
  scheduleTimer();
}
renderCaregiver();
