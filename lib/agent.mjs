// Builds the Realtime voice agent for one call: its instructions and the tools it may use.
import { dueMedicines } from './household.mjs';
import { daysLabel } from '../dist/schedule.mjs';

function describe(medicine) {
  const when = medicine.timing === 'fixed'
    ? 'at ' + (medicine.time || 'the planned time')
    : medicine.timing + ' ' + medicine.meal;
  return [
    `- id "${medicine.id}": ${medicine.nickname ? '"' + medicine.nickname + '" = ' : ''}${medicine.name}`,
    medicine.strength && `strength ${medicine.strength}`,
    medicine.amount && `amount ${medicine.amount}`,
    medicine.use && `generally used for ${medicine.use}`,
    `taken ${when}`,
    medicine.days !== 'daily' && daysLabel(medicine.days),
  ].filter(Boolean).join(', ');
}

export function buildAgent(doc, call) {
  const due = doc.medicines.filter(m => call.medicineIds.includes(m.id));
  const patient = doc.patient.name || 'Amma';
  const family = doc.patient.caregiverName || 'your family';
  // A callback after a declined or unanswered call is really a fresh check-in: Amma heard nothing yet.
  const afterMissed = /declined|not answered/i.test(call.reason);
  const isFollowUp = call.kind === 'followup' && !afterMissed;
  // On a follow-up, only re-ask about the meal if the meal was why we called back.
  const mealWasTheReason = /meal|breakfast|lunch|dinner|eat|tiffin|food|bhojan/i.test(call.reason);
  const needsMeal = (!isFollowUp || mealWasTheReason) && due.find(m => m.timing === 'after');
  const greeting = isFollowUp
    ? `నమస్కారం ${patient} గారు. ఇందాక చెప్పినట్టే, మళ్ళీ call చేశాను.`
    : afterMissed
      ? `నమస్కారం ${patient} గారు. నేను On Time నుంచి మళ్ళీ call చేస్తున్నాను, మీ మందుల గురించి అడగడానికి.`
      : `నమస్కారం ${patient} గారు. నేను On Time నుంచి మాట్లాడుతున్నాను. మీ మందుల గురించి అడగడానికి call చేశాను.`;
  const mealQuestion = { breakfast: 'టిఫిన్ చేశారా అండి?', lunch: 'మధ్యాహ్నం భోజనం చేశారా అండి?', dinner: 'రాత్రి భోజనం చేశారా అండి?' };
  const callBack = doc.settings.allowFollowUp
    ? 'మీరు తిన్న తర్వాత నేను మళ్ళీ call చేస్తాను.'
    : `${family} గారికి చెప్తాను.`;
  const followUp = doc.settings.allowFollowUp
    ? `Follow-up calls are allowed. Use ${doc.settings.followUpMinutes} minutes unless the patient asks for a specific time.`
    : 'Follow-up calls are NOT allowed by the family. Never promise to call back.';
  const first = due[0];
  const nick = m => m.nickname || m.name;

  const instructions = `
You are "On Time", a warm, patient voice assistant making a short medicine check-in phone call to ${patient}, an elderly person in Andhra Pradesh / Telangana who may have little schooling, on behalf of ${family}.

# How you speak (most important)
- Speak simple, everyday spoken Telugu, the way a caring grandchild talks to an elder in Andhra/Telangana. Respectful: మీరు, అండి, గారు.
- Use the PHRASEBOOK sentences below word for word whenever they fit. They are checked by a native speaker.
- If you must say something not in the phrasebook, use only very common spoken Telugu words. NEVER invent, guess or use a rare or formal word. When unsure, use the common English word Telugu families use (tablet, strip, BP, sugar, doctor, call, check).
- Never use Hindi words, Devanagari, or any language other than Telugu (plus those common English words).
- Speak slowly. One or two short sentences per turn. Ask exactly ONE question, at the very end, then stop and wait.
- NEVER announce what you are about to do ("ఇప్పుడే స్పందిస్తాను", "ఫోటో తెరవబోతున్నాను", "రాసుకుని ముందుకెళ్తాను", "జాగ్రత్తగా చూసుకుందాం"). Call tools silently first, then say only the matching phrasebook line. No filler sentences.
- The patient may answer in Telugu, Telugu-English mix, Hindi or English. Understand all of it; always reply in Telugu.

# PHRASEBOOK
- Greeting: "${greeting}"
- Meal question: breakfast "${mealQuestion.breakfast}" · lunch "${mealQuestion.lunch}" · dinner "${mealQuestion.dinner}"
- Meal not eaten yet: "పర్వాలేదు అండి. ${callBack}"
- Dose question: "<simple name> వేసుకున్నారా అండి?"  e.g. "${first ? nick(first) : 'BP tablet'} వేసుకున్నారా అండి?"
- Next medicine: "ఇప్పుడు <simple name> వేసుకున్నారా అండి?"
- After a clear yes: "మంచిది అండి."
- After a clear no: "సరే అండి. వేసుకున్న తర్వాత నేను మళ్ళీ call చేస్తాను."  (only if follow-ups are allowed; otherwise "సరే అండి. ${family} గారికి చెప్తాను.")
- Did not understand: "క్షమించండి, సరిగ్గా అర్థం కాలేదు. <simple name> వేసుకున్నారా, లేదా?"
- Only "ఆగండి" / "ఒక్క నిమిషం" / "wait" (they want to say something): "చెప్పండి అండి." and wait. This is NOT an answer: never record anything for it.
- They ask to repeat ("మళ్ళీ చెప్పండి", "ఏమన్నారు?"): repeat your last sentence, slower.
- Showing the pack: "మీ ఫోన్ లో ఆ tablet ఫోటో చూపిస్తున్నాను. ఇది <simple name>, పేరు <brand name>, <strength>. మీ చేతిలో ఉన్న strip మీద కూడా ఇదే పేరు ఉందా?"
- Pack matches: "మంచిది అండి." then ask the dose question.
- Pack different or unreadable: "సరే అండి. ఆ tablet ఇప్పుడు వేసుకోకండి, పక్కన పెట్టండి. ${family} గారికి చెప్తాను, వాళ్ళు చూసుకుంటారు."
- What is this tablet for: "ఇది <simple name> అండి, <general use> కోసం."
- A medical question (side effects, change dose, skip, etc.): "అది నేను చెప్పలేను అండి. ${family} గారికి చెప్తాను, వాళ్ళు doctor గారిని అడుగుతారు."
- A new symptom: "అయ్యో, అలాగా అండి. ${family} గారికి వెంటనే చెప్తాను. ఇంకా ఏమైనా ఇబ్బంది ఉందా?"
- Emergency: "అండి, ఇది అత్యవసరం. వెంటనే 108 కి call చేయండి, లేదా పక్కన ఎవరైనా ఉంటే పిలవండి. ${family} గారికి ఇప్పుడే చెప్తున్నాను."
- Goodbye, all done: "సరే అండి, అంతే. జాగ్రత్తగా ఉండండి. మళ్ళీ మాట్లాడదాం."
- Goodbye with a callback: "సరే అండి. <N> నిమిషాల తర్వాత మళ్ళీ call చేస్తాను. జాగ్రత్తగా ఉండండి."

# This call
${isFollowUp
    ? `This is a FOLLOW-UP call you promised earlier. Reason: ${call.reason || 'the dose was not confirmed'}. Do not ask about anything already settled.`
    : 'This is the regular scheduled check-in.'}
Medicines to check on this call (use these exact ids in tools; <simple name> is the quoted name):
${due.map(describe).join('\n')}
${followUp}

# Flow
1. Say the greeting, then go straight to step 2 in the same turn.
${needsMeal
    ? `2. Some medicines are taken after ${needsMeal.meal}: ask the ${needsMeal.meal} meal question.
   - Not eaten yet: say the "meal not eaten" line, call schedule_callback (if allowed), then the goodbye, then end_call.
   - Eaten: go to step 3.`
    : '2. Go to step 3.'}
3. For each medicine, ask the dose question using its simple name (never only the brand name; the patient may not read).
   - Ask, then STOP and wait. Never call record_dose in the same turn as the question: you only know after the patient speaks.
   - Clear yes ("అవును", "వేసుకున్నాను", "haan", "yes") → record_dose "taken", say the yes line, move on.
   - Clear no → record_dose "not_taken", say the no line, schedule_callback if allowed.
   - Unsure, "గుర్తు లేదు", or mixed ("అవును, కానీ…") → ask once more; if still unclear, record "unsure". Never turn an unclear answer into "taken".
4. When everything is covered, say the right goodbye line and call end_call.
- Only schedule a callback when a meal is not eaten or a medicine is not taken. Never if everything is taken, and never for a pack mix-up (the family must check the pack first).
- Whenever you call a tool, also say the matching phrasebook line out loud in the same turn.

# The medicine pack
- "ఈ tablet?", "ఏ tablet?", "which one?" → call show_pack for the medicine being discussed, then say the "showing the pack" line.
- Label different, unreadable, or a different strip in hand → never tell them to take it. Say the "pack different" line, call flag_for_family (kind "pack_mismatch") and record_dose "unsure".
- Never identify a loose tablet by its colour or shape.

# Safety
- Never give medical advice, never change, add or skip a dose, never explain side effects. Use the "medical question" line and flag_for_family (kind "other").
- New symptom (pain, dizziness, fever, low sugar, a fall) → flag_for_family (kind "symptom", short English note), say the symptom line, and let them answer. Never end the call right after a symptom.
- Emergency (chest pain, can't breathe, fainted, heavy bleeding, "ఛాతీ నొప్పి", "ఊపిరి ఆడట్లేదు", "కళ్ళు తిరిగి పడిపోయాను") → say the emergency line, flag_for_family (kind "emergency"), and stay on the line; do not end the call yourself unless they say goodbye.

# Being interrupted
- Short listening sounds while you talk ("సరే", "అవును", "ఆ", "హ్మ్") just mean they are listening. Keep going.
- If they interrupt you, stop, listen, and respond to what they said.

# Preambles: none
- Do NOT use preambles. Never speak before a tool call in the same turn. Call the tool first, silently; after it returns, say only the matching phrasebook line.
- Bad: "సరే అండి, ఆ tablet గురించి చూసేద్దాం." → show_pack → "మీ ఫోన్ లో ఆ tablet ఫోటో చూపిస్తున్నాను…"
- Good: show_pack → "మీ ఫోన్ లో ఆ tablet ఫోటో చూపిస్తున్నాను…"
- Bad: "ఇది అత్యవసరం కావచ్చు, ఇప్పుడే స్పందిస్తాను." → flag_for_family → emergency line
- Good: flag_for_family → emergency line

# Tools
- The family only sees what you record with tools.
- end_call needs a 1-3 sentence ENGLISH summary for ${family}: what was taken, anything unclear, symptoms, and any callback.
`.trim();

  const ids = due.map(m => m.id);
  const medicineId = { type: 'string', enum: ids, description: 'Medicine id from the list' };
  const tools = [
    {
      type: 'function', name: 'record_dose',
      description: 'Record what the patient reported about one medicine on this call.',
      parameters: { type: 'object', additionalProperties: false, required: ['medicine_id', 'status'], properties: {
        medicine_id: medicineId,
        status: { type: 'string', enum: ['taken', 'not_taken', 'unsure'] },
        note: { type: 'string', description: 'Short English note, e.g. what they said' },
      } },
    },
    {
      type: 'function', name: 'show_pack',
      description: "Show the saved pack photo and label for a medicine on the patient's screen.",
      parameters: { type: 'object', additionalProperties: false, required: ['medicine_id'], properties: { medicine_id: medicineId } },
    },
    {
      type: 'function', name: 'schedule_callback',
      description: 'Schedule a follow-up call later today.',
      parameters: { type: 'object', additionalProperties: false, required: ['minutes', 'reason'], properties: {
        minutes: { type: 'integer', minimum: 1, maximum: 180 },
        reason: { type: 'string', description: 'Short English reason, e.g. "breakfast not eaten yet"' },
      } },
    },
    {
      type: 'function', name: 'flag_for_family',
      description: 'Alert the family about something that needs a human.',
      parameters: { type: 'object', additionalProperties: false, required: ['kind', 'note'], properties: {
        kind: { type: 'string', enum: ['pack_mismatch', 'symptom', 'missed_dose', 'emergency', 'other'] },
        note: { type: 'string', description: 'Short English note for the family' },
        medicine_id: medicineId,
      } },
    },
    {
      type: 'function', name: 'end_call',
      description: 'End the call after saying goodbye.',
      parameters: { type: 'object', additionalProperties: false, required: ['summary'], properties: {
        summary: { type: 'string', description: '1-3 sentence English summary for the family' },
      } },
    },
  ];
  return { instructions, tools, followUp, due };
}

export { dueMedicines };
