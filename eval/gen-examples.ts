import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answerQuestion } from '../src/answer.js';
import { PreferencesSchema } from '../src/schemas.js';
import type { Profile } from '../src/schemas.js';

const seed = JSON.parse(await readFile(join(process.cwd(), 'data', 'seed-profiles.json'), 'utf8')) as {
  profiles: { ens: string; description: string; skills: string; availability: string }[];
};
const profiles: Profile[] = seed.profiles.map((p) => ({
  ens: p.ens.toLowerCase(),
  description: p.description,
  skills: p.skills,
  availability: p.availability,
  fetchedAt: new Date().toISOString(),
  resolver: 'seed',
}));

const question = 'Is anyone here good at Rust and free to mentor this month?';
const variants = [
  { label: 'A — strict (onlyAvailable=true, topK=3)', preferences: { onlyAvailable: true, topK: 3 } },
  { label: 'B — include busy (onlyAvailable=false, topK=5)', preferences: { onlyAvailable: false, topK: 5 } },
  { label: 'C — top 1 only (onlyAvailable=true, topK=1)', preferences: { onlyAvailable: true, topK: 1 } },
];

const out = [];
for (const v of variants) {
  const prefs = PreferencesSchema.parse(v.preferences);
  const answer = await answerQuestion(question, profiles, prefs);
  out.push({ label: v.label, question, preferences: v.preferences, answer });
  console.log(`\n## ${v.label}\n${JSON.stringify(answer, null, 2)}`);
}
await writeFile(join(process.cwd(), 'eval', 'examples.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('\nwrote eval/examples.json');
