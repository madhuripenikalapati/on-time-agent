import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newHousehold, setPlan, dueMedicines, startCall, callEvent, requestCall, advanceFollowUp, istDate, slotOf, unitsPerDose, missedCall,
} from '../lib/household.mjs';
import { buildAgent } from '../lib/agent.mjs';
import { demoPlan } from '../lib/api.mjs';

// 09:30 IST on a Saturday.
const morning = Date.parse('2026-11-21T04:00:00Z');

function household() {
  const doc = newHousehold(morning);
  setPlan(doc, structuredClone(demoPlan));
  return doc;
}

test('medicines map to the right part of the day', () => {
  assert.equal(slotOf({ meal: 'breakfast', timing: 'after' }), 'morning');
  assert.equal(slotOf({ meal: 'dinner', timing: 'before' }), 'night');
  assert.equal(slotOf({ timing: 'fixed', time: '14:00' }), 'afternoon');
});

test('a morning call covers only morning medicines not yet taken', () => {
  const doc = household();
  const due = dueMedicines(doc, 'morning', morning);
  assert.deepEqual(due.map(m => m.name), ['Telma 40', 'Glycomet 500']);
});

test('a reported dose is saved for today and the call stops asking about it', () => {
  const doc = household();
  requestCall(doc, { slot: 'morning' }, morning);
  const call = startCall(doc, {}, morning);
  assert.equal(doc.ring, null);
  const [telma] = doc.medicines;
  callEvent(doc, call.id, { type: 'dose', medicineId: telma.id, status: 'taken' }, morning);
  assert.equal(doc.doses[istDate(morning)][telma.id].status, 'taken');
  assert.equal(telma.stock, 13);
  assert.deepEqual(dueMedicines(doc, 'morning', morning).map(m => m.name), ['Glycomet 500']);
});

test('a follow-up becomes a ringing call when the demo clock advances', () => {
  const doc = household();
  const call = startCall(doc, { slot: 'morning' }, morning);
  const result = callEvent(doc, call.id, { type: 'followup', minutes: 30, reason: 'breakfast not eaten yet' }, morning);
  assert.equal(result.ok, true);
  assert.equal(doc.followUp.at, morning + 30 * 60_000);
  const ring = advanceFollowUp(doc, morning);
  assert.equal(ring.kind, 'followup');
  assert.equal(doc.followUp, null);
  const followUp = startCall(doc, {}, morning);
  assert.equal(followUp.kind, 'followup');
  assert.equal(followUp.reason, 'breakfast not eaten yet');
});

test('no callback once every medicine on the call is taken', () => {
  const doc = household();
  const call = startCall(doc, { slot: 'morning' }, morning);
  for (const id of call.medicineIds) callEvent(doc, call.id, { type: 'dose', medicineId: id, status: 'taken' }, morning);
  assert.equal(callEvent(doc, call.id, { type: 'followup', minutes: 30 }, morning).ok, false);
  assert.equal(doc.followUp, null);
});

test('follow-ups are refused when the family has not allowed them', () => {
  const doc = household();
  doc.settings.allowFollowUp = false;
  const call = startCall(doc, { slot: 'morning' }, morning);
  assert.equal(callEvent(doc, call.id, { type: 'followup', minutes: 10 }, morning).ok, false);
  assert.equal(doc.followUp, null);
});

test('changing the plan clears a stale follow-up', () => {
  const doc = household();
  const call = startCall(doc, { slot: 'morning' }, morning);
  callEvent(doc, call.id, { type: 'followup', minutes: 30 }, morning);
  setPlan(doc, structuredClone(demoPlan));
  assert.equal(doc.followUp, null);
});

test('the agent only gets tools for the medicines on this call', () => {
  const doc = household();
  const call = startCall(doc, { slot: 'morning' }, morning);
  const agent = buildAgent(doc, call);
  const ids = agent.tools.find(t => t.name === 'record_dose').parameters.properties.medicine_id.enum;
  assert.deepEqual(ids, call.medicineIds);
  assert.match(agent.instructions, /Telma 40/);
  assert.doesNotMatch(agent.instructions, /Shelcal/);
});

test('dose amounts parse into tablet counts', () => {
  assert.equal(unitsPerDose('½ tablet'), 0.5);
  assert.equal(unitsPerDose('1 tablet'), 1);
  assert.equal(unitsPerDose('2 tablets'), 2);
  assert.equal(unitsPerDose('as directed'), 1);
});

test('oversized pack photos are rejected', () => {
  const doc = newHousehold(morning);
  assert.throws(() => setPlan(doc, { medicines: [{ name: 'X', photo: 'data:image/jpeg;base64,' + 'A'.repeat(200_000) }] }));
});

test('the agent calls medicines by their simple name', () => {
  const doc = household();
  const call = startCall(doc, { slot: 'morning' }, morning);
  const agent = buildAgent(doc, call);
  assert.match(agent.instructions, /"Sugar tablet" = Glycomet 500/);
  assert.match(agent.instructions, /"BP tablet" = Telma 40/);
});

test('an old plan with purpose still gets a simple name', () => {
  const doc = newHousehold(morning);
  setPlan(doc, { medicines: [{ name: 'Thyronorm 50', purpose: 'Thyroid tablet', days: 'daily' }] });
  assert.equal(doc.medicines[0].nickname, 'Thyroid tablet');
});

test('a weekly dose is only due on its day, and an unknown schedule is refused', () => {
  const doc = newHousehold(morning);
  setPlan(doc, { medicines: [{ name: 'Uprise D3 60K', nickname: 'Vitamin D tablet', meal: 'breakfast', timing: 'after', days: 'mon' }] });
  assert.equal(dueMedicines(doc, 'morning', morning).length, 0); // 21 Nov 2026 is a Saturday
  const monday = Date.parse('2026-11-23T04:00:00Z');
  assert.equal(dueMedicines(doc, 'morning', monday).length, 1);
  assert.throws(() => setPlan(doc, { medicines: [{ name: 'Uprise D3 60K', days: 'weekly' }] }), /which days/);
});

test('a symptom alert is never pinned to a medicine, a pack alert is', () => {
  const doc = household();
  const call = startCall(doc, { slot: 'morning' }, morning);
  const [telma] = doc.medicines;
  callEvent(doc, call.id, { type: 'alert', kind: 'emergency', note: 'chest pain', medicineId: telma.id }, morning);
  callEvent(doc, call.id, { type: 'alert', kind: 'pack_mismatch', note: 'label differs', medicineId: telma.id }, morning);
  assert.equal(doc.alerts.find(a => a.kind === 'emergency').medicineId, null);
  assert.equal(doc.alerts.find(a => a.kind === 'pack_mismatch').medicineId, telma.id);
});

test('a declined call is logged and brings a follow-up when allowed', () => {
  const doc = household();
  requestCall(doc, { slot: 'morning' }, morning);
  missedCall(doc, { reason: 'declined' }, morning);
  assert.equal(doc.ring, null);
  assert.equal(doc.calls[0].status, 'declined');
  assert.equal(doc.followUp.at, morning + 30 * 60_000);
  doc.settings.allowFollowUp = false;
  doc.followUp = null;
  requestCall(doc, { slot: 'morning' }, morning);
  missedCall(doc, { reason: 'no_answer' }, morning);
  assert.equal(doc.calls[0].status, 'missed');
  assert.equal(doc.followUp, null);
});

test('a callback after a declined call greets afresh and still asks about the meal', () => {
  const doc = household();
  requestCall(doc, { slot: 'morning' }, morning);
  missedCall(doc, { reason: 'declined' }, morning);
  advanceFollowUp(doc, morning);
  const agent = buildAgent(doc, startCall(doc, {}, morning));
  assert.match(agent.instructions, /మళ్ళీ call చేస్తున్నాను/);
  assert.doesNotMatch(agent.instructions, /Greeting: "[^"]*ఇందాక/);
  assert.match(agent.instructions, /ask the breakfast meal question/);
});

test('"1-0-1" in the dose field becomes a tablet count for that meal', async () => {
  const { fixAmount } = await import('../lib/openai.mjs');
  assert.equal(fixAmount({ amount: '1-0-1', meal: 'dinner' }).amount, '1 tablet');
  assert.equal(fixAmount({ amount: '½-0-0', meal: 'breakfast' }).amount, '½ tablet');
  assert.equal(fixAmount({ amount: '0-2-0', meal: 'lunch' }).amount, '2 tablets');
  assert.equal(fixAmount({ amount: '1 tablet', meal: 'lunch' }).amount, '1 tablet');
});

test('onboarding saves who is who, and the agent greets them the way the family chose', async () => {
  const { setProfile } = await import('../lib/household.mjs');
  const doc = newHousehold(morning);
  setProfile(doc, { setupBy: 'family', patient: { name: 'Kamala', callName: 'అమ్మ' }, caregivers: [
    { name: 'Suresh', relation: 'son' }, { name: 'Priya', relation: 'daughter', primary: true },
  ] });
  assert.equal(doc.onboarded, true);
  assert.equal(doc.patient.caregiverName, 'Priya');
  assert.deepEqual(doc.caregivers.map(c => c.primary), [false, true]);
  setPlan(doc, structuredClone({ medicines: demoPlan.medicines }));
  assert.equal(doc.patient.callName, 'అమ్మ', 'saving medicines keeps the profile');
  assert.equal(doc.caregivers.length, 2);
  const agent = buildAgent(doc, startCall(doc, { slot: 'morning' }, morning));
  assert.match(agent.instructions, /నమస్కారం అమ్మ\./);
  assert.match(agent.instructions, /Priya గారికి/);
});

test('onboarding needs a patient name, and a family member unless it is for themselves', async () => {
  const { setProfile } = await import('../lib/household.mjs');
  assert.throws(() => setProfile(newHousehold(), { setupBy: 'family', patient: { name: '' }, caregivers: [] }), /name/);
  assert.throws(() => setProfile(newHousehold(), { setupBy: 'family', patient: { name: 'Kamala' }, caregivers: [] }), /yourself/);
  const self = setProfile(newHousehold(), { setupBy: 'self', patient: { name: 'Kamala' }, caregivers: [] });
  assert.equal(self.patient.caregiverName, '');
});
