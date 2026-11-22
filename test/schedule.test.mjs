import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDays, runsOn, takenOn, dosesPerWeek, daysLabel, daysSummary } from '../dist/schedule.mjs';
import { newHousehold, setPlan } from '../lib/household.mjs';

test('any set of weekdays is a valid schedule; all seven is every day', () => {
  assert.equal(normalizeDays('wed,mon,fri'), 'mon,wed,fri');
  assert.equal(normalizeDays('mon-thu'), 'mon,thu', 'older plans keep working');
  assert.equal(normalizeDays('sun'), 'sun');
  assert.equal(normalizeDays('alt'), 'alt');
  assert.equal(normalizeDays('sun,mon,tue,wed,thu,fri,sat'), 'daily');
  assert.equal(normalizeDays('weekly'), null);
  assert.equal(normalizeDays(''), null);
});

test('thrice weekly runs only on its days', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(d => runsOn('mon,wed,fri', d)), [false, true, false, true, false, true, false]);
  assert.equal(dosesPerWeek('mon,wed,fri'), 3);
  assert.equal(daysLabel('mon,wed,fri'), '3 days a week, on Monday, Wednesday and Friday only');
  assert.equal(daysSummary('mon,wed,fri'), '3 days a week: Mon, Wed, Fri');
  assert.equal(daysSummary('sun'), 'Once a week: Sun');
});

test('alternate days count from the first day', () => {
  const m = { days: 'alt', startDate: '2026-11-22' };
  assert.deepEqual(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'].map(d => takenOn(m, d)), [false, true, false, true, false]);
  assert.equal(dosesPerWeek('alt'), 3.5);
  assert.equal(daysLabel('alt'), 'every other day (alternate days)');
});

test('the plan accepts weekday sets and keeps the first day of an alternate-day medicine', () => {
  const doc = newHousehold({ demo: false });
  setPlan(doc, { medicines: [
    { name: 'Iron', meal: 'breakfast', timing: 'after', days: 'fri,mon,wed' },
    { name: 'Vitamin D3', meal: 'breakfast', timing: 'after', days: 'alt' },
  ] });
  assert.equal(doc.medicines[0].days, 'mon,wed,fri');
  assert.equal(doc.medicines[1].days, 'alt');
  assert.ok(doc.medicines[1].startDate, 'alternate days need a first day');
  assert.equal(doc.medicines[0].startDate, null);
});
