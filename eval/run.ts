import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answerQuestion } from '../src/answer.js';
import { PreferencesSchema, TestCaseSchema } from '../src/schemas.js';
import { loadCache, loadCommunityList, loadIndex } from '../src/store.js';

function norm(s: string) {
  return s.trim().toLowerCase();
}

async function loadProfiles() {
  // Prefer live index; fall back to local seed-profiles for offline scoring.
  try {
    const live = await loadIndex();
    const nonEmpty = live.filter((p) => p.skills || p.description);
    if (nonEmpty.length >= 4) return live;
  } catch {
    // ignore, use fallback below
  }
  const cached = await loadCache();
  const cachedNonEmpty = cached.filter((p) => p.skills || p.description);
  if (cachedNonEmpty.length >= 4) return cached;
  const raw = await readFile(join(process.cwd(), 'data', 'seed-profiles.json'), 'utf8');
  const json = JSON.parse(raw);
  return (json.profiles as { ens: string; description: string; skills: string; availability: string }[]).map(
    (p) => ({
      ens: norm(p.ens),
      description: p.description,
      skills: p.skills,
      availability: p.availability,
      fetchedAt: new Date().toISOString(),
      resolver: 'offline-seed',
    }),
  );
}

async function main() {
  const raw = await readFile(join(process.cwd(), 'eval', 'queries.json'), 'utf8');
  const cases = (JSON.parse(raw) as unknown[]).map((c) => TestCaseSchema.parse(c));
  const community = (await loadCommunityList()).map(norm);
  const allowed = new Set(community);
  const profiles = await loadProfiles();

  console.log(`Scoring ${cases.length} cases against ${profiles.length} profiles (community: ${community.length} names)`);
  let total = 0;
  const rows: Record<string, unknown>[] = [];

  for (const tc of cases) {
    const prefs = PreferencesSchema.parse(tc.preferences ?? {});
    const ans = await answerQuestion(tc.query, profiles, prefs);
    const got = ans.matches.map((m) => norm(m.ens));
    const gotSet = new Set(got);

    // 10 points per case:
    //  +4 expected recall (all expected present; empty expected => empty got)
    //  +2 mustNotContain respected
    //  +2 grounding (every returned name is in community list)
    //  +2 reasons (every match has non-empty reason + ens)
    let pts = 0;
    const details: string[] = [];

    if (tc.expectEmpty) {
      if (got.length === 0) {
        pts += 4;
      } else {
        details.push(`expected empty but got [${got.join(', ')}]`);
      }
    } else {
      const missing = tc.expected.map(norm).filter((e) => !gotSet.has(e));
      if (missing.length === 0 && tc.expected.length > 0) {
        pts += 4;
      } else if (tc.expected.length === 0 && got.length > 0) {
        pts += 4;
      } else {
        details.push(`missing expected [${missing.join(', ')}]; got [${got.join(', ')}]`);
      }
    }

    const leaked = tc.mustNotContain.map(norm).filter((b) => gotSet.has(b));
    if (leaked.length === 0) pts += 2;
    else details.push(`forbidden returned [${leaked.join(', ')}]`);

    const hallucinated = got.filter((g) => !allowed.has(g));
    if (hallucinated.length === 0) pts += 2;
    else details.push(`hallucinated (not in community) [${hallucinated.join(', ')}]`);

    const reasonsOk =
      ans.matches.length === 0 ||
      ans.matches.every((m) => m.ens && m.reason && m.reason.trim().length >= 10);
    if (reasonsOk) pts += 2;
    else details.push('empty/short reasons');

    total += pts;
    const status = pts === 10 ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${tc.id}: ${pts}/10 — got [${got.join(', ') || '(none)'}]${details.length ? ' — ' + details.join('; ') : ''}`);
    rows.push({ id: tc.id, points: pts, max: 10, got, expected: tc.expected, details });
  }

  console.log(`\nTotal: ${total}/${cases.length * 10}`);
  await writeFile(join(process.cwd(), 'eval', 'last-run.json'), JSON.stringify({ total, max: cases.length * 10, rows }, null, 2));
  if (total < cases.length * 10) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
