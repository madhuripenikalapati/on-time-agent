import test from 'node:test';
import assert from 'node:assert/strict';
import { voteReadings, expandPatterns } from '../lib/openai.mjs';

const row = (name, strength, meal, nickname, use = null) => ({ name, strength, amount: '1 tablet', nickname, use, duration_days: '30', meal, timing: null, time: null, days: 'daily', source: name });
const read = (...medicines) => ({ medicines: medicines.flat(), notes: '' });

test('the majority wins a look-alike name and its simple name', () => {
  const a = read([row('Arkamin', '0.1 mg', 'breakfast', 'BP tablet'), row('Arkamin', '0.1 mg', 'dinner', 'BP tablet')], row('Glimy M1', null, 'breakfast', 'Sugar tablet'));
  const b = read([row('Azamun', '25 mg', 'breakfast', null), row('Azamun', '25 mg', 'dinner', null)], row('Cilny M', null, 'breakfast', 'BP tablet'));
  const c = read([row('Arkamin', '0.1 mg', 'breakfast', 'BP tablet'), row('Arkamin', '0.1 mg', 'dinner', 'BP tablet')], row('Glimy M1', null, 'breakfast', 'Sugar tablet'));
  const out = voteReadings([a, b, c, c, a]);
  assert.deepEqual(out.medicines.map(m => [m.name, m.strength, m.meal, m.nickname]), [
    ['Arkamin', '0.1 mg', 'breakfast', 'BP tablet'], ['Arkamin', '0.1 mg', 'dinner', 'BP tablet'], ['Glimy M1', null, 'breakfast', 'Sugar tablet'],
  ]);
  assert.equal(out.notes, '');
});

test('no majority: the line is flagged and its simple name left blank', () => {
  const out = voteReadings([read(row('Nifepine ER', '20 mg', 'breakfast', 'BP tablet')), read(row('Nifeduce ER', '20 mg', 'breakfast', 'BP tablet')), read(row('Nexpro', '20 mg', 'breakfast', 'Gas tablet'))]);
  assert.equal(out.medicines.length, 1);
  assert.equal(out.medicines[0].nickname, null);
  assert.match(out.notes, /Line 1 was read as "Nifepine ER 20 mg", "Nifeduce ER 20 mg", "Nexpro 20 mg"/);
});

test('a reading that found a different number of medicines is left out', () => {
  const one = read(row('Albendazole', '400 mg', null, 'Worm tablet'));
  const out = voteReadings([one, read(row('Albendazole', '400 mg', null, 'Worm tablet'), row('Extra', null, null, null)), one]);
  assert.deepEqual(out.medicines.map(m => m.name), ['Albendazole']);
});

test('morning and night doses follow the majority', () => {
  const both = read([row('Met-XL', '50 mg', 'breakfast', 'BP tablet'), row('Met-XL', '50 mg', 'dinner', 'BP tablet')]);
  const out = voteReadings([read(row('Met-XL', '50 mg', 'breakfast', 'BP tablet')), both, both]);
  assert.deepEqual(out.medicines.map(m => m.meal), ['breakfast', 'dinner']);
});

test('a spelling in doubt keeps its simple name only when every reading agrees on it', () => {
  const out = voteReadings([read(row('Nifeduce ER', '20 mg', 'breakfast', 'BP tablet')), read(row('Nifepine ER', '20 mg', 'breakfast', 'BP tablet')), read(row('Nifecor ER', '20 mg', 'breakfast', 'BP tablet'))]);
  assert.equal(out.medicines[0].nickname, 'BP tablet');
  assert.ok(out.medicines[0].doubt);
});

test('a written 1-0-1 becomes breakfast and dinner even if the reading wrote one row', () => {
  const out = expandPatterns({ notes: '', medicines: [{ ...row('Nifedipine ER', '20 mg', 'breakfast', 'BP tablet'), pattern: '1-0-1' }, { ...row('Ketogen DS', null, 'lunch', 'Kidney tablet'), pattern: '0-1-0' }, { ...row('Telma', '40 mg', 'breakfast', 'BP tablet'), pattern: '½-0-0' }] });
  assert.deepEqual(out.medicines.map(m => [m.name, m.meal, m.amount]), [
    ['Nifedipine ER', 'breakfast', '1 tablet'], ['Nifedipine ER', 'dinner', '1 tablet'], ['Ketogen DS', 'lunch', '1 tablet'], ['Telma', 'breakfast', '½ tablet'],
  ]);
});

test('rows without a written pattern are kept as the reading gave them', () => {
  const rows = [row('Lyncipro', '500 mg', null, 'Antibiotic'), row('Lyncipro', '500 mg', 'dinner', 'Antibiotic')];
  assert.equal(expandPatterns({ notes: '', medicines: rows }).medicines.length, 2);
});

test('a plausible misreading that wins only 3 of 5 is flagged, not trusted', () => {
  const right = read(row('Glimy M1', null, 'breakfast', 'Sugar tablet'));
  const wrong = read(row('Cilny M', null, 'breakfast', 'BP tablet'));
  const out = voteReadings([wrong, wrong, wrong, right, right]);
  assert.equal(out.medicines[0].nickname, null);
  assert.ok(out.medicines[0].doubt);
});

test('"Vitamin D₃" and "Vitamin D3" are the same reading', () => {
  const out = voteReadings([read(row('Vitamin D₃', '60000 IU', null, 'Vitamin D tablet')), read(row('Vitamin D3', '60000 IU', null, 'Vitamin D tablet')), read(row('Vitamin D3', '60000 IU', null, 'Vitamin D tablet'))]);
  assert.equal(out.medicines[0].doubt, null);
});
