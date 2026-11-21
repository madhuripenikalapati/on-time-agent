export function classify(raw, phase, final = true) {
  const text = raw.toLowerCase().normalize('NFC').replace(/[.,?!…]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'wait';
  const stop = /ఆగండి|ఆపు|చాలు|\b(aagandi|agandi|aapu|chaalu|stop|wait)\b/u.test(text);
  if (!final) return stop ? 'yield' : 'wait';
  if (/మ్యాచ్ (అవ్వట్లేదు|కాలేదు)|తప్పు ప్యాక్|\b(wrong pack|does not match|doesn't match|match avvatledu)\b/u.test(text)) return 'mismatch';
  if (/ఏ (టాబ్లెట్|మందు)|ఈ టాబ్లెట్|\b(ee tablet|ye tablet|which (tablet|pack|medicine))\b/u.test(text)) return 'pack';
  if (/తినలేదు|బ్రేక్.?ఫాస్ట్ కాలేదు|\b(inka (breakfast )?(cheyyaledu|tinaledu)|haven't eaten|not eaten|breakfast is late)\b/u.test(text)) return 'meal-late';
  if (/వేసుకోలేదు|తీసుకోలేదు|గుర్తు లేదు|తెలియదు|\b(vesukoledu|teesukoledu|not taken|didn't take|unsure|not sure)\b/u.test(text)) return 'unconfirmed';
  if (stop) return 'yield';
  const yes = /^(అవును|avunu|yes)$/u.test(text);
  if (phase === 'dose' && (yes || /^(టాబ్లెట్ )?(వేసుకున్నాను|వేసుకున్నా|తీసుకున్నాను|తీసుకున్నా)$|^(tablet )?(vesukunnanu|vesukunna|teesukunnanu|i took (it|the tablet))$/u.test(text))) return 'taken';
  if (phase === 'meal' && (yes || /^(తిన్నాను|తిన్నా|తినేశాను|అయింది|i ate|ayindi|tinnanu)$/u.test(text))) return 'meal-done';
  if (/^(?:(?:సరే|అవును|హ్మ్|ఆ|sare|avunu|hmm+|aa+|okay|ok|yes)(?:\s+|$))+$/u.test(text)) return 'continue';
  return 'unclear';
}
