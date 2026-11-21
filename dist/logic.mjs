export function classify(raw, phase, final = true) {
  const text = raw.toLowerCase().normalize('NFC').replace(/[.,?!…]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'wait';
  const stop = /ఆగండి|ఆపు|చాలు|\b(aagandi|agandi|aapu|chaalu|stop|wait)\b/u.test(text);
  if (!final) return stop ? 'yield' : 'wait';
  if (/మ్యాచ్ (అవ్వట్లేదు|కాలేదు)|తప్పు ప్యాక్|\b(wrong pack|does not match|doesn't match|match avvatledu)\b/u.test(text)) return 'mismatch';
  if (/ఏ (టాబ్లెట్|మందు)|ఈ టాబ్లెట్|\b(ee tablet|ye tablet|which (tablet|pack|medicine))\b/u.test(text)) return 'pack';
  if (/^(ఇంకా లేదు|ఇంక లేదు|లేదు|inka (ledu|ledhu)|not yet|no)$/u.test(text)) {
    if (phase === 'meal') return 'meal-late';
    if (phase === 'dose') return 'not-taken';
  }
  if (/తినలేదు|బ్రేక్.?ఫాస్ట్ కాలేదు|\b(inka (breakfast )?(cheyyaledu|tinaledu)|haven't eaten|not eaten|breakfast is late)\b/u.test(text)) return 'meal-late';
  if (/గుర్తు లేదు|తెలియదు|\b(unsure|not sure|don't remember)\b/u.test(text)) return 'unconfirmed';
  if (/వేసుకోలేదు|తీసుకోలేదు|\b(vesukoledu|teesukoledu|not taken|didn't take)\b/u.test(text)) return phase === 'dose' ? 'not-taken' : 'unconfirmed';
  if (stop) return 'yield';
  const yes = /^(అవును|avunu|yes)$/u.test(text);
  if (phase === 'dose' && (yes || /^(టాబ్లెట్ )?(వేసుకున్నాను|వేసుకున్నా|తీసుకున్నాను|తీసుకున్నా)$|^(tablet )?(vesukunnanu|vesukunna|teesukunnanu|i took (it|the tablet))$/u.test(text))) return 'taken';
  if (phase === 'meal' && (yes || /^(తిన్నాను|తిన్నా|తినేశాను|అయింది|i ate|ayindi|tinnanu)$/u.test(text))) return 'meal-done';
  if (/^(?:(?:సరే|అవును|హ్మ్|ఆ|sare|avunu|hmm+|aa+|okay|ok|yes)(?:\s+|$))+$/u.test(text)) return 'continue';
  return 'unclear';
}

export function prescriptionDraft(text) {
  const fields = new Map(text.split(/\r?\n/u).map(line => {
    const split = line.indexOf(':');
    return split < 0 ? ['', ''] : [line.slice(0, split).trim().toLowerCase(), line.slice(split + 1).trim()];
  }));
  const draft = {};
  for (const name of ['name', 'strength', 'amount', 'meal', 'timing', 'time', 'days']) {
    const value = fields.get(name);
    if (value) draft[name] = value;
  }
  return draft;
}

export function refillDates({ stock, units, days, lead }, today) {
  const stockCount = Number(stock);
  const unitsPerDose = Number(units);
  const leadDays = Number(lead);
  if (!String(stock).trim() || !Number.isFinite(stockCount) || stockCount < 0 ||
      !Number.isFinite(unitsPerDose) || unitsPerDose <= 0 || !Number.isInteger(leadDays) || leadDays < 0) return null;
  const schedule = days === 'daily' ? [0,1,2,3,4,5,6] : days === 'mon-thu' ? [1,4] : [];
  const count = Math.floor((stockCount + Number.EPSILON) / unitsPerDose);
  if (!schedule.length || count > 10000) return null;
  const date = new Date(today);
  date.setHours(0,0,0,0);
  let remaining = count;
  for (; !schedule.includes(date.getDay()) || remaining > 0; date.setDate(date.getDate() + 1)) {
    if (schedule.includes(date.getDay())) remaining--;
  }
  const reminder = new Date(date);
  reminder.setDate(reminder.getDate() - leadDays);
  return { runOut: date, reminder };
}
