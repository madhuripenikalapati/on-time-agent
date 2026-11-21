// Runs every minute on AWS. For each household with a registered phone: ring at medicine
// time, ring again when a follow-up is due, and turn an unanswered ring into a missed call.
import { SLOTS, slotOf, istDate, istWeekday, requestCall, advanceFollowUp, missedCall } from './household.mjs';
import { runsOn } from '../dist/schedule.mjs';
import { update } from './store.mjs';
import { notifyPhones } from './api.mjs';

const DEFAULT_TIME = { morning: '09:00', afternoon: '13:30', night: '20:30' };
const RING_TIMEOUT_MS = 3 * 60_000; // a ring nobody answers becomes a missed call
const LATE_WINDOW_MIN = 120;        // don't start a "morning" call in the evening

const istMinutes = now => { const d = new Date(now + 5.5 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const toMinutes = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

// The time to call for a part of the day: the earliest planned time among its medicines.
export function slotTime(doc, slot, now) {
  const weekday = istWeekday(now);
  const times = doc.medicines
    .filter(m => slotOf(m) === slot && runsOn(m.days, weekday))
    .map(m => m.time || DEFAULT_TIME[slot]);
  return times.length ? times.sort()[0] : null;
}

/** Decide what to do for one household right now. Mutates doc; returns 'rang' | 'missed' | null. */
export function planTick(doc, now = Date.now()) {
  if (!doc.push?.length || doc.settings?.autoCalls === false || !doc.medicines?.length) return null;

  if (doc.ring) {
    if (now - doc.ring.at > RING_TIMEOUT_MS) { missedCall(doc, { reason: 'no_answer' }, now); return 'missed'; }
    return null; // still ringing
  }
  const last = doc.calls?.[0];
  if (last?.status === 'live' && now - last.startedAt < 20 * 60_000) return null;

  if (doc.followUp && doc.followUp.at <= now) { advanceFollowUp(doc, now); return 'rang'; }

  const today = istDate(now);
  const minutes = istMinutes(now);
  doc.autoCalled = Object.fromEntries(Object.entries(doc.autoCalled ?? {}).filter(([day]) => day >= today));
  for (const slot of SLOTS) {
    const time = slotTime(doc, slot, now);
    if (!time) continue;
    const due = toMinutes(time);
    if (minutes < due || minutes > due + LATE_WINDOW_MIN) continue;
    if (doc.autoCalled[today]?.[slot]) continue;
    const open = doc.medicines.filter(m => slotOf(m) === slot && runsOn(m.days, istWeekday(now)) && doc.doses?.[today]?.[m.id]?.status !== 'taken');
    doc.autoCalled[today] = { ...(doc.autoCalled[today] ?? {}), [slot]: now };
    if (!open.length) continue; // already reported taken today
    requestCall(doc, { slot, kind: 'scheduled' }, now);
    return 'rang';
  }
  return null;
}

// The next automatic call the family can expect, for the dashboard.
export function nextAutoCall(doc, now = Date.now()) {
  const today = istDate(now);
  const minutes = istMinutes(now);
  for (const slot of SLOTS) {
    const time = slotTime(doc, slot, now);
    if (!time || doc.autoCalled?.[today]?.[slot]) continue;
    if (toMinutes(time) + LATE_WINDOW_MIN >= minutes) return { slot, time };
  }
  return null;
}

// One pass over every household. Returns how many phones were rung.
export async function runScheduler(store, { vapid, origin }, now = Date.now()) {
  let rang = 0;
  for (const id of await store.listIds()) {
    try {
      // Dry run first, so a quiet minute costs a read, not a write.
      const current = await store.get(id);
      if (!current?.push?.length) continue;
      const trial = structuredClone(current);
      if (planTick(trial, now) === null && JSON.stringify(trial) === JSON.stringify(current)) continue;
      const outcome = await update(store, id, doc => planTick(doc, now));
      if (outcome?.result === 'rang') rang += await notifyPhones(store, outcome.doc, { vapid, origin });
    } catch (error) {
      console.error('Scheduler failed for a household:', error.message);
    }
  }
  return rang;
}
