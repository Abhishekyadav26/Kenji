import { z } from 'zod';

// ---- Core domain schemas ----

export const ProfileSchema = z.object({
  ens: z.string().min(3), // e.g. yuki.kenji-builders.eth
  description: z.string().default(''),
  skills: z.string().default(''),
  availability: z.string().default(''),
  fetchedAt: z.string().default(''),
  resolver: z.string().default(''),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const PreferencesSchema = z.object({
  // When true (default), members whose availability does NOT look "free/available"
  // are filtered out for mentoring queries. Set false to include busy people.
  onlyAvailable: z.boolean().default(true),
  // Max results to return.
  topK: z.number().int().min(1).max(10).default(3),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const MatchSchema = z.object({
  ens: z.string(),
  reason: z.string(),
  evidence: z.string().default(''),
  score: z.number().default(0),
});
export type Match = z.infer<typeof MatchSchema>;

export const AnswerSchema = z.object({
  query: z.string(),
  matches: z.array(MatchSchema),
  message: z.string(),
});
export type Answer = z.infer<typeof AnswerSchema>;

// Recorded test query format (also used by eval/run.ts and tests).
export const TestCaseSchema = z.object({
  id: z.string(),
  query: z.string(),
  preferences: PreferencesSchema.partial().default({}),
  // ENS names we expect (order-insensitive unless `exactOrder` is true).
  expected: z.array(z.string()).default([]),
  // ENS names that must NOT appear (adversarial / hallucination guards).
  mustNotContain: z.array(z.string()).default([]),
  // If true, empty matches are expected (nobody-fits case).
  expectEmpty: z.boolean().default(false),
  notes: z.string().default(''),
});
export type TestCase = z.infer<typeof TestCaseSchema>;
