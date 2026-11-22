// Builds lib/data/medicines.tsv.gz from the "Indian Medicine Dataset" CSV (MIT license,
// https://github.com/junioralive/Indian-Medicine-Dataset, about 250,000 medicines sold in India).
// Usage: node scripts/build-medicines.mjs <path to indian_medicine_data.csv>
// Keeps only what matching needs: the brand name and its ingredients. Discontinued and
// non-allopathy rows are dropped. One line per product: name<TAB>ingredients.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/build-medicines.mjs <indian_medicine_data.csv>'); process.exit(1); }

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines.
function* rows(text) {
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1) yield row;
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); yield row; }
}

const clean = s => String(s ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const lines = new Set();
let header = null;
let kept = 0, skipped = 0;
for (const row of rows(readFileSync(file, 'utf8'))) {
  if (!header) { header = Object.fromEntries(row.map((name, i) => [name.trim(), i])); continue; }
  const get = key => row[header[key]];
  if (get('Is_discontinued') === 'TRUE' || clean(get('type')).toLowerCase() !== 'allopathy') { skipped++; continue; }
  const name = clean(get('name'));
  const ingredients = [get('short_composition1'), get('short_composition2')].map(clean).filter(Boolean).join(' + ');
  if (!name || !ingredients) { skipped++; continue; }
  lines.add(name + '\t' + ingredients);
  kept++;
}
mkdirSync(new URL('../lib/data/', import.meta.url), { recursive: true });
const out = new URL('../lib/data/medicines.tsv.gz', import.meta.url);
const body = gzipSync([...lines].join('\n'), { level: 9 });
writeFileSync(out, body);
console.log(`kept ${kept} rows (${lines.size} unique), skipped ${skipped}; wrote ${(body.length / 1e6).toFixed(1)} MB`);
