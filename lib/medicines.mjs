// Finds the real Indian medicine closest to what a reading of a handwritten prescription saw.
// Data: lib/data/medicines.tsv.gz, built by scripts/build-medicines.mjs from the Indian
// Medicine Dataset (MIT, about 240,000 brands with their ingredients).
//
// "Nifepine ER 20", "Nifecure ER 20" and "Nicardia R 20" are different spellings, but the
// question that matters is what the patient takes: nifedipine. Matching each reading to a real
// brand lets the vote compare ingredients instead of spellings.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const FORM = /\b(tablets?|tab|capsules?|cap|syrup|suspension|injection|inj|cream|gel|ointment|drops?|solution|powder|sachet|inhaler|respules?|lotion|spray|kit|softgels?|strip|granules|lozenges?|infusion|vial|oral)\b.*$/;
// Release words differ between how doctors write and how brands are listed.
const RELEASE = /\b(er|sr|cr|pr|xr|od|retard|ds|forte|plus|mr)\b/g;

/** The brand letters: "Glimy M 1 Tablet PR" → "glimym", "Met XL 50" → "metxl". */
export function brandKey(name) {
  const stem = String(name ?? '').toLowerCase().replace(/^(tab|cap|tablet|capsule|inj|syp)\.?\s+/, '').replace(FORM, '');
  const beforeNumber = stem.split(/\d/)[0];
  return beforeNumber.replace(RELEASE, ' ').replace(/[^a-z]/g, '');
}

/** Ingredient names without strengths, sorted: "glimepiride+metformin". */
export function ingredientKey(ingredients) {
  return String(ingredients ?? '').toLowerCase().split('+')
    .map(part => part.replace(/\(.*?\)/g, '').replace(/\b(hydrochloride|hcl|succinate|tartrate|sodium|potassium|calcium|besylate|besilate|maleate|ip|bp|usp)\b/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean).sort().join('+');
}

const numbers = text => (String(text ?? '').match(/\d+(\.\d+)?/g) ?? []).map(Number);

function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

let index = null;
function load() {
  if (index) return index;
  const text = gunzipSync(readFileSync(new URL('./data/medicines.tsv.gz', import.meta.url))).toString('utf8');
  const byKey = new Map();
  const uses = new Map();
  for (const line of text.split('\n')) {
    const [name, ingredients] = line.split('\t');
    for (const part of ingredientKey(ingredients).split('+')) if (part) uses.set(part, (uses.get(part) ?? 0) + 1);
    const key = brandKey(name);
    if (key.length < 3) continue;
    const list = byKey.get(key) ?? [];
    list.push({ name, ingredients });
    byKey.set(key, list);
  }
  // Keys grouped by length, so a query only compares against keys of similar length.
  const byLength = new Map();
  for (const key of byKey.keys()) {
    if (!byLength.has(key.length)) byLength.set(key.length, []);
    byLength.get(key.length).push(key);
  }
  // Generic names in real use ("metformin", "thyroxine", "vitamin d3").
  const generics = [...uses].filter(([, count]) => count > 3).map(([name]) => name);
  index = { byKey, byLength, generics };
  return index;
}

// Doctors' spellings of generic names that the data writes differently.
const SPELLINGS = { amoxicillin: 'amoxycillin', levothyroxine: 'thyroxine', 'vitamin d': 'vitamin d3', cholecalciferol: 'vitamin d3', acetaminophen: 'paracetamol' };

// A reading that is a generic name, or several ("Metformin + Glimepiride"), is the ingredient itself.
function genericMatch(name) {
  const { generics } = load();
  const parts = String(name ?? '').toLowerCase().replace(FORM, '').split(/\+|\/|\band\b|,/)
    .map(part => part.replace(/\(.*?\)/g, '').replace(/\d+(\.\d+)?\s*(mg|mcg|g|iu|ml|k)?\b/g, '').replace(RELEASE, ' ').replace(/^(tab|cap|tablet|capsule)\.?\s+/, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!parts.length) return null;
  let worst = 1;
  const found = [];
  for (const part of parts) {
    const target = SPELLINGS[part] ?? part;
    let best = null, bestScore = 0;
    for (const generic of generics) {
      if (Math.abs(generic.length - target.length) > 2) continue;
      const score = similarity(target, generic);
      if (score > bestScore) { best = generic; bestScore = score; }
    }
    if (!best || bestScore < 0.85) return null;
    found.push(best);
    worst = Math.min(worst, bestScore);
  }
  const key = [...new Set(found)].sort().join('+');
  return { name: String(name).trim(), ingredients: found.join(' + '), key, score: Number(worst.toFixed(2)), generic: true };
}

const memo = new Map();

/**
 * The closest real medicines to one reading, best first.
 * @param {string} name what the reading saw, e.g. "Glimy M1"
 * @param {string} [strength] e.g. "500 mg"
 * @returns {{ name: string, ingredients: string, key: string, score: number }[]}
 */
export function closestMedicines(name, strength = '', limit = 3) {
  const cacheKey = name + '|' + strength + '|' + limit;
  if (memo.has(cacheKey)) return memo.get(cacheKey);
  const result = search(name, strength, limit);
  if (memo.size > 5000) memo.clear();
  memo.set(cacheKey, result);
  return result;
}

function search(name, strength, limit) {
  const generic = genericMatch(name);
  if (generic) return [generic];
  const query = brandKey(name);
  if (query.length < 3) return [];
  const { byKey, byLength } = load();
  const scored = [];
  for (let length = query.length - 3; length <= query.length + 3; length++) {
    for (const key of byLength.get(length) ?? []) {
      const score = similarity(query, key);
      if (score >= 0.6) scored.push([key, score]);
    }
  }
  scored.sort((a, b) => b[1] - a[1]);
  // Within the best brands, prefer the product whose numbers fit the written strength ("Met XL 50").
  const wanted = numbers(name + ' ' + strength);
  const fits = product => {
    const have = numbers(product.name + ' ' + product.ingredients);
    return wanted.filter(n => have.includes(n)).length;
  };
  const out = [];
  for (const [key, score] of scored.slice(0, limit * 2)) {
    const products = byKey.get(key);
    const best = [...products].sort((a, b) => fits(b) - fits(a))[0];
    out.push({ name: best.name, ingredients: best.ingredients, key: ingredientKey(best.ingredients), score: Number(score.toFixed(2)) });
  }
  return out.slice(0, limit);
}
