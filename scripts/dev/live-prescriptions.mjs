// Reads prescriptions on the live site and prints what each line became.
import { readFileSync } from 'node:fs';
const U = 'https://vqe7ihx8pe.execute-api.us-west-2.amazonaws.com';
async function read(label, file) {
  const t = Date.now();
  const r = await fetch(U + '/api/prescription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [{ type: 'image/jpeg', data: readFileSync(file).toString('base64') }] }) });
  const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
  const lines = [`== ${label} · ${((Date.now() - t) / 1000).toFixed(1)} s · HTTP ${r.status}${j.error ? ' · ' + j.error : ''}`];
  const seen = new Map();
  for (const m of j.medicines ?? []) {
    const k = m.name + '|' + (m.strength ?? '');
    const row = seen.get(k) ?? { m, meals: '' };
    row.meals += (m.meal ?? '?')[0];
    seen.set(k, row);
  }
  let flagged = 0;
  for (const { m, meals } of seen.values()) {
    if (m.doubt) flagged++;
    lines.push(`  ${m.doubt ? '⚠' : '✓'} ${m.name} ${m.strength ?? ''} [${meals}] → ${m.nickname ?? '-'}${m.contains ? ' · contains ' + m.contains : ''}${m.doubt ? ' · read as ' + m.doubt : ''}`);
  }
  lines.push(`  ${seen.size} medicines, ${flagged} flagged`);
  return lines.join('\n');
}
// Usage: node scripts/dev/live-prescriptions.mjs [label=path/to/image.jpg ...]
// Without arguments it reads the made-up sample prescription in dist/samples.
const ROOT = new URL('../../', import.meta.url).pathname;
const ONLY = null;
const args = process.argv.slice(2);
const jobs = args.length ? args.map(a => a.includes('=') ? a.split('=') : [a, a]) : [['Sample', ROOT + 'dist/samples/prescription.jpg']];
for (const out of await Promise.all(jobs.map(([l, f]) => read(l, f).catch(e => '== ' + l + ' FAILED ' + e.message)))) console.log(out);
