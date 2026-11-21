// Household state: one patient, their reviewed medicines, calls, dose reports and alerts.
// Pure functions only, so the same rules run locally, on Lambda and in tests.
import { randomBytes } from 'node:crypto';
import { DAY_VALUES, runsOn } from '../dist/schedule.mjs';

export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const TIMINGS = ['before', 'after', 'fixed'];
export const DAYS = DAY_VALUES;
export const SLOTS = ['morning', 'afternoon', 'night'];
export const DOSE_STATUS = ['taken', 'not_taken', 'unsure'];
export const ALERT_KINDS = ['pack_mismatch', 'symptom', 'missed_dose', 'emergency', 'other'];
const MAX_PHOTO = 160_000;

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
    patient: { name: 'Amma', caregiverName: '', language: 'te' },
    settings: { followUpMinutes: 30, allowFollowUp: true, shareWithFamily: true },
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
  const photo = input.photo ? text(input.photo, MAX_PHOTO + 100, 'Pack photo') : '';
  if (photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) {
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
    meal: pick(input.meal, MEALS, 'breakfast'),
    timing: pick(input.timing, TIMINGS, 'after'),
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '',
    // Never guess a schedule: a weekly dose silently turned daily would be dangerous.
    days: DAYS.includes(input.days) ? input.days : (() => { throw new InputError('Choose which days ' + name + ' is taken.'); })(),
    stock: Number.isFinite(Number(input.stock)) && input.stock !== '' && input.stock !== null
      ? Math.max(0, Math.min(9999, Number(input.stock))) : null,
    photo,
  };
}

export function setPlan(doc, input) {
  if (!input || typeof input !== 'object') throw new InputError('Missing plan.');
  const medicines = Array.isArray(input.medicines) ? input.medicines : [];
  if (medicines.length > 8) throw new InputError('Add up to eight medicines.');
  doc.medicines = medicines.map(sanitizeMedicine);
  const patient = input.patient ?? {};
  doc.patient = {
    name: text(patient.name, 40, 'Name') || 'Amma',
    caregiverName: text(patient.caregiverName, 40, 'Caregiver name'),
    language: 'te',
  };
  const settings = input.settings ?? {};
  const minutes = Math.round(Number(settings.followUpMinutes));
  doc.settings = {
    followUpMinutes: Number.isFinite(minutes) ? Math.max(1, Math.min(180, minutes)) : 30,
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
  const scheduledToday = m => runsOn(m.days, weekday);
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
      const status = pick(event.status, DOSE_STATUS, 'unsure');
      const today = istDate(now);
      doc.doses[today] = { ...(doc.doses[today] ?? {}), [med.id]: {
        status, at: now, callId, note: text(event.note, 200, 'Note'),
      } };
      // Keep a short window of history.
      for (const day of Object.keys(doc.doses).sort().slice(0, -14)) delete doc.doses[day];
      call.outcomes = [...call.outcomes.filter(o => o.medicineId !== med.id), { medicineId: med.id, status, at: now }];
      if (status === 'taken' && med.stock !== null) {
        // Rows for the same medicine at different meals share one strip.
        const left = Math.max(0, med.stock - unitsPerDose(med.amount));
        const samePack = m => m.name.toLowerCase() === med.name.toLowerCase() && m.strength === med.strength && m.stock !== null;
        for (const m of doc.medicines.filter(samePack)) m.stock = left;
      }
      return { ok: true, recorded: status, medicine: med.name };
    }
    case 'alert': {
      const alert = {
        id: newId(6),
        kind: pick(event.kind, ALERT_KINDS, 'other'),
        note: text(event.note, 240, 'Note'),
        medicineId: doc.medicines.some(m => m.id === event.medicineId) ? event.medicineId : null,
        callId,
        at: now,
        resolved: false,
      };
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
export function publicView(doc, now = Date.now()) {
  const today = istDate(now);
  const view = {
    ...doc,
    today,
    slot: currentSlot(now),
    todayDoses: doc.doses[today] ?? {},
    serverTime: now,
  };
  delete view.doses;
  return view;
}
