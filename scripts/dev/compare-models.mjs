// Runs one prescription image through extractPrescription with a given model and effort.
// Usage: VISION_MODEL=... VISION_EFFORT=... node rx-models.mjs <image>
import { readFileSync } from 'node:fs';
import { extractPrescription } from '../../lib/openai.mjs';

const data = readFileSync(process.argv[2]).toString('base64');
const t = Date.now();
try {
  const r = await extractPrescription([{ type: 'image/jpeg', data }], process.env.OPENAI_API_KEY);
  const rows = new Map();
  for (const m of r.medicines) {
    const k = m.name + ' ' + (m.strength ?? '');
    const row = rows.get(k) ?? { k, meals: [], nick: m.nickname, use: m.use };
    row.meals.push((m.meal ?? '?')[0]);
    rows.set(k, row);
  }
  const s = ((Date.now() - t) / 1000).toFixed(0);
  console.log(`=== ${s}s · notes: ${r.notes.slice(0, 260)}`);
  for (const row of rows.values()) console.log(`  ${row.k} [${row.meals.join('')}] → ${row.nick ?? '-'} / ${row.use ?? '-'}`);
} catch (e) {
  console.log(`=== ${process.env.VISION_MODEL} ${process.env.VISION_EFFORT} · ERROR ${e.message} ${e.detail ?? ""}`);
}
