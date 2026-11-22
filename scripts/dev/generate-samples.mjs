// Generates a fictional sample prescription (laid out like a real Indian OPD record) and photos of
// matching medicine strips, for testing On Time end to end. Nothing here is a real person or brand.
import { writeFileSync, readFileSync } from 'node:fs';

const KEY = process.env.OPENAI_API_KEY;
const OUT = new URL('./', import.meta.url).pathname;
const MODEL = process.env.IMAGE_MODEL || 'gpt-image-2';
const only = process.argv.slice(2);

const RX = `A realistic photo, taken top-down with a phone, of a printed Indian hospital "OUT PATIENT ASSESSMENT RECORD" sheet on a table, filled in by a doctor with a blue ballpoint pen.
Layout like a typical Indian hospital OPD form: a header with a simple generic logo and the fictional name "ON TIME DEMO CLINIC" (with the line "Sample hospital for software testing" under it), a patient details box, a vitals row (BP 140/90 mmHg written by hand, pulse 82), a pain scale row of small faces, then two columns "Clinical Notes / Investigations" and "Treatment".
Printed patient details: Patient Name: Mrs. LAKSHMI DEVI · Age/Gender: 68Y/Female · Consultation Date: 21-Nov-2026 · Consultant: Dr. DEMO DOCTOR, MD (General Medicine) · Dept: GENERAL MEDICINE. No phone numbers, no address, no ID numbers.
In the Clinical Notes column, the doctor has written these lines by hand in neat but natural doctor handwriting (clearly readable, slightly slanted, like a careful doctor), each line starting with "Tab.":
Tab. Metformin 500mg   1-0-1   after food
Tab. Amlodipine 5mg   1-0-0
Tab. Atorvastatin 10mg   0-0-1
Tab. Thyroxine 50mcg   1-0-0   before breakfast
Tab. Pantoprazole 40mg   1-0-0   before breakfast
Tab. Amoxicillin 500mg   1-0-1   x 5 days
Tab. Vitamin D3 60000 IU   once a week (Sunday)
Then below: "Review after 1 month" and a doctor's scribbled signature. On the left margin a few handwritten notes: "FBS 132", "PPBS 190".
At the bottom in small print: "SAMPLE PRESCRIPTION FOR SOFTWARE TESTING · NOT VALID FOR DISPENSING". Natural lighting, slight paper curl, realistic.`;

const strip = (name, strength, color, extra) => `A realistic close-up photo, taken with a phone, of one medicine blister strip lying on a wooden kitchen table in an Indian home.
The foil back is not shown; the clear plastic front shows the tablets. The printed label on the strip reads clearly "${name}" and "${strength}" with the fictional maker "DEMO PHARMA LTD" and small text "For testing only".
${extra}
The tablets are ${color}. The whole strip is fully in the frame, sharp and well lit.`;

const PACKS = {
  'pack-metformin': strip('METFORMIN TABLETS IP', '500 mg', 'large white oval', 'It is a strip of 10 tablets in 2 rows of 5; 3 pockets are empty (pushed through and torn), 7 tablets remain.'),
  'pack-amlodipine': strip('AMLODIPINE TABLETS IP', '5 mg', 'small round white', 'It is a strip of 15 tablets in 3 rows of 5; all 15 tablets are still inside.'),
  'pack-atorvastatin': strip('ATORVASTATIN TABLETS IP', '10 mg', 'small white oval film-coated', 'It is a strip of 10 tablets in 2 rows of 5; 6 pockets are empty, 4 tablets remain.'),
  'pack-thyroxine': `A realistic phone photo of a small white plastic bottle of thyroid tablets on a kitchen table in an Indian home. The label clearly reads "THYROXINE SODIUM TABLETS IP 50 mcg", "100 tablets", maker "DEMO PHARMA LTD", "For testing only". The bottle is closed. Sharp, well lit.`,
  'pack-pantoprazole': strip('PANTOPRAZOLE GASTRO-RESISTANT TABLETS IP', '40 mg', 'yellow oval', 'It is a strip of 10 tablets in 2 rows of 5; 2 pockets are empty, 8 tablets remain.'),
  'pack-amoxicillin': strip('AMOXICILLIN CAPSULES IP', '500 mg', 'red and yellow capsules', 'It is a strip of 10 capsules in 2 rows of 5; all 10 capsules are still inside.'),
  'pack-vitamin-d3': strip('CHOLECALCIFEROL (VITAMIN D3) CAPSULES', '60000 IU', 'soft golden gel capsules', 'It is a small strip of 4 capsules in 1 row of 4; 1 pocket is empty, 3 capsules remain.'),
};

async function generate(name, prompt, size) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size, quality: 'high', n: 1 }),
  }).then(r => r.json());
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error(name + ': ' + JSON.stringify(r.error ?? r).slice(0, 300));
  writeFileSync(OUT + name + '.png', Buffer.from(b64, 'base64'));
  return name;
}

const jobs = [['rx-sample', RX, '1024x1536'], ...Object.entries(PACKS).map(([n, p]) => [n, p, '1024x1024'])]
  .filter(([n]) => !only.length || only.includes(n));
const results = await Promise.allSettled(jobs.map(([n, p, s]) => generate(n, p, s)));
for (const r of results) console.log(r.status === 'fulfilled' ? 'made ' + r.value : 'FAILED ' + r.reason.message);
