// Household state: one patient, their reviewed medicines, calls, dose reports and alerts.
// Pure functions only, so the same rules run locally, on Lambda and in tests.
import { randomBytes } from 'node:crypto';
import { DAY_VALUES, takenOn, isDate } from '../dist/schedule.mjs';
import { LANGUAGE_CODES, languageOf, fill } from '../dist/languages.mjs';

export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const TIMINGS = ['before', 'after', 'fixed'];
export const DAYS = DAY_VALUES;
export const SLOTS = ['morning', 'afternoon', 'night'];
export const DOSE_STATUS = ['taken', 'not_taken', 'unsure'];
export const ALERT_KINDS = ['pack_mismatch', 'symptom', 'missed_dose', 'emergency', 'other'];
export const MAX_PHOTO = 160_000;
export const MAX_MEDICINES = 20;
export const isPhotoData = value => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);

export class InputError extends Error {}

const text = (value, max, field) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new InputError(field + ' must be text.');
  return value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
};
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function newId(bytes = 9) {
  return randomBytes(bytes).toString('base64url');
}

export function newHousehold(now = Date.now()) {
  return {
    id: newId(12),
    createdAt: now,
    updatedAt: now,
    patient: { name: 'Amma', callName: '', caregiverName: '', language: 'te' },
    caregivers: [],
    setupBy: 'family',
    onboarded: false,
    settings: { followUpMinutes: 30, allowFollowUp: true, shareWithFamily: true, autoCalls: true },
    medicines: [],
    doses: {},
    calls: [],
    alerts: [],
    ring: null,
    followUp: null,
  };
}

// India time helpers. Doses are grouped per local calendar day.
const ist = now => new Date(now + 5.5 * 3600_000);
export const istDate = now => ist(now).toISOString().slice(0, 10);
export const istWeekday = now => ist(now).getUTCDay();
export function currentSlot(now = Date.now()) {
  const d = ist(now);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes < 11 * 60 + 30 ? 'morning' : minutes < 17 * 60 ? 'afternoon' : 'night';
}

export function slotOf(medicine) {
  if (medicine.timing !== 'fixed' && medicine.meal) {
    return { breakfast: 'morning', lunch: 'afternoon', dinner: 'night' }[medicine.meal];
  }
  const hour = Number(String(medicine.time || '09').slice(0, 2));
  return hour < 11 ? 'morning' : hour < 17 ? 'afternoon' : 'night';
}

export function sanitizeMedicine(input, index) {
  if (!input || typeof input !== 'object') throw new InputError('Each medicine needs details.');
  const name = text(input.name, 60, 'Medicine name');
  if (!name) throw new InputError('Medicine ' + (index + 1) + ' needs a name.');
  // Photos are stored on their own; the plan keeps a link (or, for older plans, the image).
  const photo = input.photo ? text(input.photo, MAX_PHOTO + 100, 'Pack photo') : '';
  if (photo && !isPhotoData(photo) && !/^\/api\/h\/[A-Za-z0-9_-]{8,24}\/photo\/[A-Za-z0-9_-]{6,24}$/.test(photo)) {
    throw new InputError('Pack photo must be a JPEG, PNG or WebP image.');
  }
  if (photo.length > MAX_PHOTO) throw new InputError('Pack photo for ' + name + ' is too large.');
  const time = text(input.time, 5, 'Time');
  return {
    id: /^[A-Za-z0-9_-]{4,20}$/.test(input.id ?? '') ? input.id : newId(6),
    name,
    strength: text(input.strength, 40, 'Strength'),
    amount: text(input.amount, 40, 'Amount'),
    // The everyday name the patient knows it by, e.g. "Sugar tablet". Confirmed by the family.
    nickname: text(input.nickname ?? input.purpose, 40, 'Simple name'),
    // What it is generally used for, in plain words, e.g. "Blood sugar (diabetes)".
    use: text(input.use, 80, 'Used for'),
    meal: pick(input.meal, MEALS, 'breakfast'),
    timing: pick(input.timing, TIMINGS, 'after'),
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '',
    // Never guess a schedule: a weekly dose silently turned daily would be dangerous.
    days: DAYS.includes(input.days) ? input.days : (() => { throw new InputError('Choose which days ' + name + ' is taken.'); })(),
    // A course ("for 10 days, then stop"). Empty means ongoing.
    courseDays: Number.isInteger(Number(input.courseDays)) && Number(input.courseDays) >= 1 && Number(input.courseDays) <= 365 && input.courseDays !== '' && input.courseDays !== null
      ? Number(input.courseDays) : null,
    startDate: isDate(input.startDate) ? input.startDate : null,
    stock: Number.isFinite(Number(input.stock)) && input.stock !== '' && input.stock !== null
      ? Math.max(0, Math.min(9999, Number(input.stock))) : null,
    photo,
  };
}

export const RELATIONS = ['son', 'daughter', 'spouse', 'grandchild', 'sibling', 'parent', 'relative', 'friend', 'neighbour', 'caretaker', 'other'];

function sanitizeCaregivers(list) {
  if (list.length > 6) throw new InputError('Add up to six family members.');
  const people = list.map((person, index) => {
    const name = text(person?.name, 40, 'Name');
    if (!name) throw new InputError('Family member ' + (index + 1) + ' needs a name.');
    return { id: /^[A-Za-z0-9_-]{4,20}$/.test(person.id ?? '') ? person.id : newId(5), name, relation: pick(person.relation, RELATIONS, 'other'), primary: Boolean(person.primary) };
  });
  // Exactly one main caretaker: the person the agent mentions ("I'll tell Ravi").
  const main = people.findIndex(p => p.primary);
  people.forEach((p, i) => { p.primary = i === (main < 0 ? 0 : main); });
  return people;
}

export const primaryCaregiver = doc => doc.caregivers?.find(p => p.primary) ?? doc.caregivers?.[0] ?? null;

// Onboarding: who the patient is, how to address them, and who in the family is involved.
export function setProfile(doc, input) {
  if (!input || typeof input !== 'object') throw new InputError('Missing profile.');
  const patient = input.patient ?? {};
  const name = text(patient.name, 40, 'Name');
  if (!name) throw new InputError('Add the name of the person taking the medicines.');
  doc.setupBy = pick(input.setupBy, ['family', 'caretaker', 'self'], 'family');
  doc.caregivers = sanitizeCaregivers(Array.isArray(input.caregivers) ? input.caregivers : []);
  if (doc.setupBy !== 'self' && !doc.caregivers.length) throw new InputError('Add yourself as a family member or caretaker.');
  doc.patient = {
    name,
    callName: text(patient.callName, 40, 'How to address'),
    caregiverName: primaryCaregiver(doc)?.name ?? '',
    language: LANGUAGE_CODES.includes(patient.language) ? patient.language : 'te',
  };
  doc.onboarded = true;
  return doc;
}

export function setPlan(doc, input) {
  if (!input || typeof input !== 'object') throw new InputError('Missing plan.');
  const medicines = Array.isArray(input.medicines) ? input.medicines : [];
  if (medicines.length > MAX_MEDICINES) throw new InputError('Add up to ' + MAX_MEDICINES + ' medicines.');
  doc.medicines = medicines.map(sanitizeMedicine);
  // A course with no start date starts today.
  for (const m of doc.medicines) if (m.courseDays && !m.startDate) m.startDate = istDate(Date.now());
  for (const m of doc.medicines) if (!m.courseDays) m.startDate = null;
  const patient = input.patient ?? {};
  if (Array.isArray(input.caregivers)) doc.caregivers = sanitizeCaregivers(input.caregivers);
  doc.patient = {
    name: text(patient.name, 40, 'Name') || doc.patient?.name || 'Amma',
    callName: patient.callName !== undefined ? text(patient.callName, 40, 'How to address') : (doc.patient?.callName ?? ''),
    caregiverName: primaryCaregiver(doc)?.name || text(patient.caregiverName, 40, 'Caregiver name'),
    language: LANGUAGE_CODES.includes(patient.language) ? patient.language : (doc.patient?.language ?? 'te'),
  };
  const settings = input.settings ?? {};
  const minutes = Math.round(Number(settings.followUpMinutes));
  doc.settings = {
    followUpMinutes: Number.isFinite(minutes) ? Math.max(1, Math.min(180, minutes)) : 30,
    autoCalls: settings.autoCalls !== false,
    allowFollowUp: settings.allowFollowUp !== false,
    shareWithFamily: settings.shareWithFamily !== false,
  };
  // A changed plan invalidates a pending follow-up that was based on the old one.
  doc.followUp = null;
  return doc;
}

export function dueMedicines(doc, slot, now = Date.now()) {
  const today = istDate(now);
  const weekday = istWeekday(now);
  const scheduledToday = m => takenOn(m, today);
  const notTaken = m => doc.doses?.[today]?.[m.id]?.status !== 'taken';
  const open = doc.medicines.filter(m => scheduledToday(m) && notTaken(m));
  const inSlot = open.filter(m => slotOf(m) === slot);
  return inSlot.length ? inSlot : open;
}

export function requestCall(doc, { kind = 'scheduled', slot, reason = '' } = {}, now = Date.now()) {
  if (!doc.medicines.length) throw new InputError('Add a medicine before calling.');
  doc.ring = {
    id: newId(6),
    kind: kind === 'followup' ? 'followup' : 'scheduled',
    slot: pick(slot, SLOTS, currentSlot(now)),
    reason: text(reason, 120, 'Reason'),
    at: now,
  };
  return doc.ring;
}

// "Advance demo clock": a pending follow-up becomes due immediately.
export function advanceFollowUp(doc, now = Date.now()) {
  if (!doc.followUp) throw new InputError('No follow-up is scheduled.');
  const { slot, reason } = doc.followUp;
  doc.followUp = null;
  return requestCall(doc, { kind: 'followup', slot, reason }, now);
}

// The patient declined or didn't pick up. The family sees a missed call, and a follow-up
// is scheduled when they allowed one.
export function missedCall(doc, { reason } = {}, now = Date.now()) {
  const ring = doc.ring;
  if (!ring) throw new InputError('Nothing is ringing.');
  const why = reason === 'declined' ? 'declined' : 'no_answer';
  doc.ring = null;
  doc.calls = [{
    id: newId(8), kind: ring.kind, slot: ring.slot, reason: ring.reason, startedAt: ring.at, endedAt: now,
    status: why === 'declined' ? 'declined' : 'missed', medicineIds: [], transcript: [], turns: [], outcomes: [],
    summary: '',
  }, ...doc.calls].slice(0, 15);
  if (doc.settings.allowFollowUp) {
    const minutes = doc.settings.followUpMinutes;
    doc.followUp = { at: now + minutes * 60_000, minutes, slot: ring.slot, reason: why === 'declined' ? 'the earlier call was declined' : 'the earlier call was not answered' };
  }
  return { status: why };
}

export function startCall(doc, { kind, slot } = {}, now = Date.now()) {
  const ring = doc.ring;
  const resolvedSlot = pick(slot ?? ring?.slot, SLOTS, currentSlot(now));
  const due = dueMedicines(doc, resolvedSlot, now);
  if (!due.length) throw new InputError('Every medicine is already reported taken today.');
  const call = {
    id: newId(8),
    kind: (kind ?? ring?.kind) === 'followup' ? 'followup' : 'scheduled',
    slot: resolvedSlot,
    reason: ring?.reason ?? '',
    startedAt: now,
    endedAt: null,
    status: 'live',
    medicineIds: due.map(m => m.id),
    transcript: [],
    turns: [],
    outcomes: [],
    summary: '',
  };
  doc.ring = null;
  doc.calls = [call, ...doc.calls].slice(0, 15);
  return call;
}

export function callEvent(doc, callId, event, now = Date.now()) {
  const call = doc.calls.find(c => c.id === callId);
  if (!call) throw new InputError('Unknown call.');
  const type = event?.type;
  const medicine = id => {
    const found = doc.medicines.find(m => m.id === id);
    if (!found) throw new InputError('Unknown medicine.');
    return found;
  };
  switch (type) {
    case 'transcript': {
      const who = event.who === 'agent' ? 'agent' : 'patient';
      const line = text(event.text, 400, 'Transcript');
      if (line) call.transcript = [...call.transcript, { who, text: line, at: now }].slice(-80);
      return { ok: true };
    }
    case 'turn': {
      call.turns = [...call.turns, {
        heard: text(event.heard, 120, 'Heard'),
        decision: pick(event.decision, ['backchannel', 'yield', 'answer', 'noise'], 'answer'),
        ms: Math.max(0, Math.min(10000, Math.round(Number(event.ms) || 0))),
        at: now,
      }].slice(-40);
      return { ok: true };
    }
    case 'dose': {
      const med = medicine(event.medicineId);
      const today = istDate(now);
      if (doc.doses[today]?.[med.id]?.packMismatch || call.outcomes.some(o => o.medicineId === med.id && o.packMismatch)) {
        return { ok: false, recorded: 'unsure', reason: 'Pack mismatch. The dose remains unconfirmed.' };
      }
      const status = pick(event.status, DOSE_STATUS, 'unsure');
      const wasTaken = doc.doses[today]?.[med.id]?.status === 'taken';
      doc.doses[today] = { ...(doc.doses[today] ?? {}), [med.id]: {
        status, at: now, callId, note: text(event.note, 200, 'Note'),
      } };
      // Keep a short window of history.
      for (const day of Object.keys(doc.doses).sort().slice(0, -14)) delete doc.doses[day];
      call.outcomes = [...call.outcomes.filter(o => o.medicineId !== med.id), { medicineId: med.id, status, at: now }];
      // Each day's dose counts once: a second "taken" (a follow-up call, a repeated record) takes
      // nothing more off the strip, and a "taken" corrected to anything else puts the tablet back.
      const change = status === 'taken' && !wasTaken ? -1 : status !== 'taken' && wasTaken ? 1 : 0;
      if (change && med.stock !== null) {
        // Rows for the same medicine at different meals share one strip.
        const left = Math.min(9999, Math.max(0, med.stock + change * unitsPerDose(med.amount)));
        const samePack = m => m.name.toLowerCase() === med.name.toLowerCase() && m.strength === med.strength && m.stock !== null;
        for (const m of doc.medicines.filter(samePack)) m.stock = left;
      }
      return { ok: true, recorded: status, medicine: med.name };
    }
    case 'alert': {
      const mismatch = event.kind === 'pack_mismatch' && doc.medicines.find(m => m.id === event.medicineId);
      if (mismatch && doc.alerts.some(a => a.kind === 'pack_mismatch' && a.callId === callId && a.medicineId === mismatch.id)) {
        return { ok: true, recorded: 'unsure', alerted: doc.patient.caregiverName || 'family' };
      }
      const alert = {
        id: newId(6),
        kind: pick(event.kind, ALERT_KINDS, 'other'),
        note: text(event.note, 240, 'Note'),
        // Only pack and missed-dose alerts are about a specific medicine; chest pain is not "about" Glycomet.
        medicineId: ['pack_mismatch', 'missed_dose'].includes(event.kind) && doc.medicines.some(m => m.id === event.medicineId) ? event.medicineId : null,
        callId,
        at: now,
        resolved: false,
      };
      if (mismatch) {
        const today = istDate(now);
        doc.doses[today] ??= {};
        doc.doses[today][mismatch.id] = { status: 'unsure', at: now, callId, note: alert.note, packMismatch: true };
        call.outcomes = [...call.outcomes.filter(o => o.medicineId !== mismatch.id),
          { medicineId: mismatch.id, status: 'unsure', at: now, packMismatch: true }];
      }
      doc.alerts = [alert, ...doc.alerts].slice(0, 20);
      return { ok: true, alerted: doc.patient.caregiverName || 'family' };
    }
    case 'followup': {
      if (!doc.settings.allowFollowUp) return { ok: false, reason: 'The family has not allowed follow-up calls.' };
      const today = istDate(now);
      const open = call.medicineIds.filter(id => doc.doses[today]?.[id]?.status !== 'taken');
      if (!open.length) return { ok: false, reason: 'Every medicine on this call is already taken. No callback is needed.' };
      const minutes = Math.max(1, Math.min(180, Math.round(Number(event.minutes) || doc.settings.followUpMinutes)));
      doc.followUp = { at: now + minutes * 60_000, minutes, slot: call.slot, reason: text(event.reason, 120, 'Reason'), callId };
      return { ok: true, minutes };
    }
    case 'end': {
      call.status = 'ended';
      call.endedAt = now;
      call.summary = text(event.summary, 600, 'Summary');
      return { ok: true };
    }
    default:
      throw new InputError('Unknown call event.');
  }
}

export function unitsPerDose(amount) {
  const value = String(amount ?? '').trim();
  if (/^½|\bhalf\b|^0?\.5\b|^1\/2\b/i.test(value)) return 0.5;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 && number <= 20 ? number : 1;
}

// What the caregiver sees. Sharing off hides everything but the plan.
export function notifyText(doc) {
  const lang = languageOf(doc.patient?.language);
  const address = doc.patient?.callName || (doc.patient?.name ?? '') + lang.honorific;
  return { title: lang.ui.notifyTitle, body: fill(lang.ui.notifyBody, { address, slot: lang.ui[doc.ring?.slot] ?? '' }), answer: lang.ui.answer };
}

export function publicView(doc, now = Date.now()) {
  const today = istDate(now);
  const view = {
    ...doc,
    today,
    slot: currentSlot(now),
    todayDoses: doc.doses[today] ?? {},
    serverTime: now,
    // A push address is a capability: never send it back to browsers, only a count.
    phones: (doc.push ?? []).length,
    notify: doc.ring ? notifyText(doc) : null,
  };
  delete view.doses;
  delete view.push;
  delete view.autoCalled;
  return view;
}
