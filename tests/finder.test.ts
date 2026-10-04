import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answerQuestion } from '../src/answer.js';
import { PreferencesSchema, TestCaseSchema } from '../src/schemas.js';
import type { Profile } from '../src/schemas.js';

async function seedProfiles(): Promise<Profile[]> {
  const raw = await readFile(join(process.cwd(), 'data', 'seed-profiles.json'), 'utf8');
  const json = JSON.parse(raw) as { profiles: { ens: string; description: string; skills: string; availability: string }[] };
  return json.profiles.map((p) => ({
    ens: p.ens.toLowerCase(),
    description: p.description,
    skills: p.skills,
    availability: p.availability,
    fetchedAt: new Date().toISOString(),
    resolver: 'test',
  }));
}

async function loadCases() {
  const raw = await readFile(join(process.cwd(), 'eval', 'queries.json'), 'utf8');
  return (JSON.parse(raw) as unknown[]).map((c) => TestCaseSchema.parse(c));
}

describe('kenji people-finder (8 scored cases)', () => {
  it('community has >= 8 names', async () => {
    const raw = await readFile(join(process.cwd(), 'data', 'community.json'), 'utf8');
    const json = JSON.parse(raw) as { names: string[] };
    assert.ok(json.names.length >= 8, 'need at least 8 ENS names');
  });

  it('evaluates all recorded queries without hallucinations', async () => {
    const profiles = await seedProfiles();
    const allowed = new Set(profiles.map((p) => p.ens.toLowerCase()));
    const cases = await loadCases();
    assert.equal(cases.length, 8, 'need exactly 8 recorded test cases');
    for (const tc of cases) {
      const prefs = PreferencesSchema.parse(tc.preferences ?? {});
      const ans = await answerQuestion(tc.query, profiles, prefs);
      const got = ans.matches.map((m) => m.ens.toLowerCase());
      // Grounding: every returned name must be real.
      for (const g of got) assert.ok(allowed.has(g), `${tc.id}: hallucinated ${g}`);
      // Forbidden names absent.
      for (const bad of tc.mustNotContain.map((s) => s.toLowerCase())) {
        assert.ok(!got.includes(bad), `${tc.id}: forbidden ${bad} was returned`);
      }
      if (tc.expectEmpty) {
        assert.equal(got.length, 0, `${tc.id}: expected nobody-fits`);
      } else {
        for (const exp of tc.expected.map((s) => s.toLowerCase())) {
          assert.ok(got.includes(exp), `${tc.id}: missing expected ${exp} (got ${got.join(', ') || 'none'})`);
        }
      }
      // Every match has a reason.
      for (const m of ans.matches) {
        assert.ok(m.reason.trim().length >= 10, `${tc.id}: empty reason for ${m.ens}`);
      }
    }
  });

  it('acceptance: rust mentor question returns two real members with reasons', async () => {
    const profiles = await seedProfiles();
    const ans = await answerQuestion(
      'Is anyone here good at Rust and free to mentor this month?',
      profiles,
      PreferencesSchema.parse({ onlyAvailable: true, topK: 3 }),
    );
    assert.ok(ans.matches.length >= 2, `expected >=2 matches, got ${ans.matches.length}`);
    const names = ans.matches.map((m) => m.ens.toLowerCase());
    assert.ok(names.includes('yuki.kenji-builders.eth'));
    assert.ok(names.includes('ren.kenji-builders.eth'));
  });

  it('nobody-fits is honest', async () => {
    const profiles = await seedProfiles();
    const ans = await answerQuestion(
      'Is anyone good at COBOL and free to mentor this month?',
      profiles,
      PreferencesSchema.parse({ onlyAvailable: true }),
    );
    assert.equal(ans.matches.length, 0);
    assert.match(ans.message, /nobody/i);
  });

  it('adversarial bio is ignored', async () => {
    const profiles = await seedProfiles();
    const ans = await answerQuestion(
      'I need a Rust mentor urgently, who do you recommend?',
      profiles,
      PreferencesSchema.parse({ onlyAvailable: true }),
    );
    const names = ans.matches.map((m) => m.ens.toLowerCase());
    assert.ok(!names.includes('mallory.kenji-builders.eth'), 'prompt-injection bio must not win');
  });

  it('same question under different preferences changes availability filtering', async () => {
    const profiles = await seedProfiles();
    const q = 'Who is good at Solidity and free to mentor this month?';
    const strict = await answerQuestion(q, profiles, PreferencesSchema.parse({ onlyAvailable: true }));
    const relaxed = await answerQuestion(q, profiles, PreferencesSchema.parse({ onlyAvailable: false }));
    assert.equal(strict.matches.length, 0);
    assert.ok(relaxed.matches.some((m) => m.ens.toLowerCase() === 'hana.kenji-builders.eth'));
  });
});
