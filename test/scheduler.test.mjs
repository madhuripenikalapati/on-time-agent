import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify, createPublicKey } from 'node:crypto';
import { newHousehold, setPlan, startCall, callEvent, istDate } from '../lib/household.mjs';
import { planTick, nextAutoCall } from '../lib/scheduler.mjs';
import { demoPlan } from '../lib/api.mjs';
import { generateVapidKeys, isPushEndpoint } from '../lib/push.mjs';

// IST wall-clock time on Saturday 21 Nov 2026.
const at = hhmm => Date.parse('2026-11-21T' + hhmm + ':00+05:30');

function household() {
  const doc = newHousehold(at('06:00'));
  setPlan(doc, structuredClone(demoPlan));
  doc.push = [{ endpoint: 'https://fcm.googleapis.com/fcm/send/x', at: at('06:00') }];
  return doc;
}

test('no phone registered, no automatic calls', () => {
  const doc = household();
  doc.push = [];
  assert.equal(planTick(doc, at('09:00')), null);
});

test('rings at the first medicine time of the morning, once', () => {
  const doc = household();
  assert.equal(planTick(doc, at('08:59')), null);
  assert.equal(planTick(doc, at('09:00')), 'rang');
  assert.equal(doc.ring.slot, 'morning');
  doc.ring = null; // answered and finished
  assert.equal(planTick(doc, at('09:05')), null, 'does not ring the same slot twice');
});

test('an unanswered ring becomes a missed call with a follow-up', () => {
  const doc = household();
  planTick(doc, at('09:00'));
  assert.equal(planTick(doc, at('09:02')), null, 'still ringing');
  assert.equal(planTick(doc, at('09:04')), 'missed');
  assert.equal(doc.calls[0].status, 'missed');
  assert.equal(doc.followUp.at, at('09:34'));
  assert.equal(planTick(doc, at('09:34')), 'rang', 'the follow-up rings when due');
  assert.equal(doc.ring.kind, 'followup');
});

test('skips a slot whose medicines are already reported taken', () => {
  const doc = household();
  const call = startCall(doc, { slot: 'morning' }, at('08:30'));
  for (const id of call.medicineIds) callEvent(doc, call.id, { type: 'dose', medicineId: id, status: 'taken' }, at('08:31'));
  callEvent(doc, call.id, { type: 'end', summary: '' }, at('08:32'));
  assert.equal(planTick(doc, at('09:00')), null);
});

test('does not start a morning call late in the day', () => {
  const doc = household();
  assert.equal(planTick(doc, at('13:00')), null);
  assert.equal(planTick(doc, at('13:30')), 'rang');
  assert.equal(doc.ring.slot, 'afternoon');
});

test('automatic calls can be switched off', () => {
  const doc = household();
  doc.settings.autoCalls = false;
  assert.equal(planTick(doc, at('09:00')), null);
});

test('the dashboard shows the next automatic call', () => {
  const doc = household();
  assert.deepEqual(nextAutoCall(doc, at('07:00')), { slot: 'morning', time: '09:00' });
  planTick(doc, at('09:00'));
  assert.deepEqual(nextAutoCall(doc, at('10:00')), { slot: 'afternoon', time: '13:30' });
  assert.equal(istDate(at('23:59')), '2026-11-21');
});

test('VAPID keys sign tokens that verify, and only real push services are accepted', async () => {
  const keys = generateVapidKeys();
  assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65);
  const { sendPush } = await import('../lib/push.mjs');
  assert.equal(await sendPush('https://evil.example/collect', keys, 'https://x'), 'failed');
  assert.equal(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(isPushEndpoint('https://web.push.apple.com/abc'), true);
  assert.equal(isPushEndpoint('http://169.254.169.254/latest'), false);
  // Sign and verify a token the same way push services do.
  const point = Buffer.from(keys.publicKey, 'base64url');
  const pub = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  const { createPrivateKey, sign } = await import('node:crypto');
  const priv = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  const sig = sign('sha256', Buffer.from('a.b'), { key: priv, dsaEncoding: 'ieee-p1363' });
  assert.equal(verify('sha256', Buffer.from('a.b'), { key: pub, dsaEncoding: 'ieee-p1363' }, sig), true);
});
