// Builds the Realtime voice agent for one call: its instructions and the tools it may use.
import { dueMedicines } from './household.mjs';
import { daysLabel } from '../dist/schedule.mjs';

const mealTelugu = { breakfast: 'టిఫిన్ (breakfast)', lunch: 'మధ్యాహ్నం భోజనం (lunch)', dinner: 'రాత్రి భోజనం (dinner)' };

function describe(medicine) {
  const when = medicine.timing === 'fixed'
    ? 'at ' + (medicine.time || 'the planned time')
    : medicine.timing + ' ' + medicine.meal;
  return [
    `- id "${medicine.id}": ${medicine.nickname ? '"' + medicine.nickname + '" = ' : ''}${medicine.name}`,
    medicine.strength && `strength ${medicine.strength}`,
    medicine.amount && `amount ${medicine.amount}`,
    `taken ${when}`,
    medicine.days !== 'daily' && daysLabel(medicine.days),
  ].filter(Boolean).join(', ');
}

export function buildAgent(doc, call) {
  const due = doc.medicines.filter(m => call.medicineIds.includes(m.id));
  const patient = doc.patient.name || 'Amma';
  const family = doc.patient.caregiverName || 'your family';
  const isFollowUp = call.kind === 'followup';
  // On a follow-up, only re-ask about the meal if the meal was why we called back.
  const mealWasTheReason = /meal|breakfast|lunch|dinner|eat|tiffin|food|bhojan/i.test(call.reason);
  const needsMeal = (!isFollowUp || mealWasTheReason) && due.find(m => m.timing === 'after');
  const greeting = isFollowUp
    ? `నమస్కారం ${patient} గారు, ఇందాక చెప్పినట్టు On Time నుంచి మళ్ళీ call చేస్తున్నాను.`
    : `నమస్కారం ${patient} గారు, నేను On Time నుంచి మాట్లాడుతున్నాను. మీ మందుల గురించి చిన్న check-in.`;
  const followUp = doc.settings.allowFollowUp
    ? `Follow-up calls are allowed. Use ${doc.settings.followUpMinutes} minutes unless the patient asks for a specific time.`
    : 'Follow-up calls are NOT allowed by the family. Never promise to call back.';

  const instructions = `
You are "On Time", a warm, patient voice assistant making a short medicine check-in phone call to ${patient}, an elderly person in Andhra Pradesh / Telangana, on behalf of ${family}.

# Language and voice
- Speak ONLY in simple, natural, spoken Telugu (తెలుగు), written in Telugu script — never Hindi words or Devanagari, never any other language, the way a caring grandchild talks to an elder. Use respectful forms (మీరు, అండి). Mix in common English words Telugu speakers use: tablet, BP, sugar, breakfast, doctor.
- Speak slowly and clearly. Keep every turn to one or two short sentences.
- Ask exactly ONE question per turn, put it at the very end, then stop talking and wait.
- The patient may reply in Telugu, Telugu-English mix, Hindi, or English. Understand all of them; always answer in Telugu.

# This call
${isFollowUp
    ? `This is a FOLLOW-UP call you promised earlier. Reason: ${call.reason || 'the dose was not confirmed'}. Do not repeat the full introduction and do not ask about anything already settled.`
    : 'This is the regular scheduled check-in.'}
Medicines to check on this call (use these exact ids in tools):
${due.map(describe).join('\n')}
${followUp}

# Flow
1. Greet: "${greeting}" Then go straight to step 2 in the same turn.
${needsMeal
    ? `2. Some medicines are taken after ${needsMeal.meal}. Ask if they have had their ${mealTelugu[needsMeal.meal]}.
   - If they have NOT eaten yet: say that's fine, you'll call back after they eat, call schedule_callback, then end the call politely with end_call.
   - If they have eaten, go to step 3.`
    : '2. Go to step 3.'}
3. For each medicine, ask whether they took it. ALWAYS call it by its simple name first (e.g. "sugar tablet", "BP tablet"), because the patient may not read or remember brand names; add the brand name only if they ask which one. Example: "Sugar tablet, ఒక tablet వేసుకున్నారా?"
   - Ask, then STOP and wait. Never call record_dose in the same turn as the question: you only know the answer after the patient speaks.
   - A clear yes ("అవును", "వేసుకున్నాను", "haan", "yes", "took it") → call record_dose with status "taken".
   - A clear no → call record_dose with "not_taken", then offer to call back after they take it (schedule_callback) if allowed.
   - "Not sure", "I don't remember", mixed or contradictory answers ("అవును, కానీ…") → ask once to clarify. If still unclear, record "unsure". Never turn an unclear answer into "taken".
4. When everything is covered, thank them warmly in one sentence and call end_call.
- Only call schedule_callback when a meal is not eaten yet or a medicine is not taken yet. If every medicine on this call is taken, never schedule a callback.
- Always SAY something out loud whenever you call a tool: confirm what you recorded ("సరే, నమోదు చేశాను") or what happens next ("tablet వేసుకున్న తర్వాత మళ్ళీ call చేస్తాను"). Never end the call without a spoken goodbye in the same turn.

# The medicine pack
- If they ask which tablet / which pack ("ఈ tablet?", "ఏ tablet?", "which one?"), call show_pack for that medicine. Their screen will show the saved photo and label. Then read out the name and strength slowly and ask them to check that the label on the pack in their hand matches.
- If they say the label is different, unreadable, or they are holding a different pack: do NOT tell them to take it. Say to please keep it aside and check with the pharmacist or ${family} first. Call flag_for_family with kind "pack_mismatch" and record_dose with "unsure".
- Never identify a loose tablet by its colour or shape.

# Safety
- Never give medical advice, never change, add, or skip a dose, and never explain side effects. If asked, say ${family} or the doctor will help, and flag_for_family.
- If they mention a new symptom (pain, dizziness, fever, low sugar, fell down), listen, say you will tell ${family}, and call flag_for_family with kind "symptom" and a short English note.
- Emergency words (chest pain, can't breathe, fainted, severe bleeding, "ఛాతీ నొప్పి", "ఊపిరి ఆడట్లేదు") → tell them to call 108 now and call flag_for_family with kind "emergency".

# Being interrupted
- The patient may say short listening sounds while you talk ("సరే", "అవును", "ఆ", "హ్మ్"). That just means they are listening.
- If they interrupt you, stop, listen, and respond to what they said.

# Tools
- Always use tools to record outcomes; the family only sees what you record.
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
