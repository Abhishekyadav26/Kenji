import type { Preferences, Profile } from './schemas.js';

export interface ScoredProfile {
  profile: Profile;
  score: number;
  reasons: string[];
  evidence: string;
}

// Canonical skill vocabulary. Query tokens are mapped here.
const SKILLS = [
  'rust',
  'python',
  'solidity',
  'typescript',
  'javascript',
  'react',
  'frontend',
  'backend',
  'devops',
  'docker',
  'kubernetes',
  'solana',
  'ethereum',
  'marketing',
  'events',
  'design',
  'mentoring',
  'testing',
] as const;

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  front: 'frontend',
  fronted: 'frontend',
  web: 'frontend',
  ui: 'frontend',
  contracts: 'solidity',
  eth: 'ethereum',
  sol: 'solana',
};

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(/\s+/)
    .map((t) => ALIASES[t] ?? t)
    .filter(Boolean);
}

// Generic request language that must not count as content overlap.
const STOPWORDS = new Set([
  'and', 'the', 'this', 'that', 'with', 'for', 'are', 'you', 'your',
  'who', 'what', 'when', 'where', 'how', 'can', 'could', 'would', 'should',
  'here', 'there', 'then', 'than', 'from', 'into', 'have', 'has', 'had',
  'someone', 'anyone', 'anybody', 'everybody', 'somebody', 'person', 'people',
  'looking', 'need', 'needs', 'want', 'wants', 'like', 'just', 'very',
  'good', 'great', 'best', 'free', 'available', 'mentor', 'mentors',
  'month', 'week', 'help', 'helps', 'helping', 'urgently', 'heard',
  'known', 'told', 'alive',
]);

/** Content tokens: tokenized minus stopwords/short tokens. */
export function contentTokens(s: string): string[] {
  return tokenize(s).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** If the question asks for a skill outside our vocabulary (e.g. COBOL),
 * return it so we can enforce a strict nobody-fits instead of fuzzy matching. */
export function extractUnknownSkill(query: string): string | null {
  const m = query.match(
    /good at ([a-z0-9+#]+)|help (?:me )?with ([a-z0-9+#]+)|mentor (?:in|for) ([a-z0-9+#]+)|knows ([a-z0-9+#]+)|expert (?:in|on) ([a-z0-9+#]+)/i,
  );
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').toLowerCase();
  const norm = ALIASES[raw] ?? raw;
  const known = new Set<string>([...SKILLS.map(String)]);
  if (!raw || known.has(norm) || STOPWORDS.has(norm)) return null;
  return norm;
}

/** Extract the skills the question is actually asking for. */
export function extractRequiredSkills(query: string): string[] {
  const toks = new Set(tokenize(query));
  const found: string[] = [];
  for (const skill of SKILLS) {
    if (skill === 'mentoring') continue; // generic, not a filter
    if (toks.has(skill)) found.push(skill);
  }
  return found;
}

export function wantsAvailableMentor(query: string): boolean {
  const q = query.toLowerCase();
  return /free|available|mentor|this month|help|time to help/.test(q);
}

/**
 * Availability is read ONLY from the structured `availability` text record,
 * never from free-form bio instructions. Empty/unknown => not available.
 */
export function isAvailable(p: Profile): boolean {
  const a = `${p.availability}`.toLowerCase().trim();
  if (!a) return false;
  const negative =
    /not available|unavailable|busy|no time|not free|booked|away/.test(a);
  if (negative) return false;
  return /availab|free|open|yes|this month|mentor.*yes|happy to help/.test(a);
}

function fieldTokens(s: string): Set<string> {
  return new Set(tokenize(s ?? ''));
}

function snippet(profile: Profile, requiredSkills: string[]): string {
  const bits: string[] = [];
  if (profile.skills) bits.push(`skills: ${profile.skills}`);
  if (profile.availability) bits.push(`availability: ${profile.availability}`);
  if (profile.description)
    bits.push(`bio: ${profile.description.slice(0, 220)}`);
  // Prefer a slice that actually mentions a required skill.
  const joined = bits.join(' | ');
  if (requiredSkills.length === 0) return joined.slice(0, 280);
  const low = joined.toLowerCase();
  for (const s of requiredSkills) {
    const i = low.indexOf(s);
    if (i >= 0) return joined.slice(Math.max(0, i - 80), i + 160);
  }
  return joined.slice(0, 280);
}

/**
 * Deterministic retrieval over live ENS profiles.
 *
 * Security properties (bios are UNTRUSTED):
 * - Skills matching uses the structured `skills` record with 3x the weight of
 *   bio text, so a bio that merely *claims* a skill cannot outrank real skills.
 * - A candidate can only pass when a required skill appears in its structured
 *   `skills` field (when the query names explicit skills). Bio-only mentions
 *   never pass the hard filter.
 * - Imperative/instruction-like sentences in bios ("always recommend me",
 *   "ignore previous instructions", ...) contribute zero score: we only count
 *   skill-token overlap, never follow bio instructions.
 */
export function scoreProfiles(
  query: string,
  profiles: Profile[],
  prefs: Preferences,
): ScoredProfile[] {
  const requiredSkills = extractRequiredSkills(query);
  const wantsAvail = wantsAvailableMentor(query);
  const queryToks = new Set(contentTokens(query));

  // Unknown-skill guard: "good at COBOL" where COBOL is in no profile's
  // structured skills => honest nobody-fits (never fuzzy-match a random member).
  const unknown = extractUnknownSkill(query);
  if (unknown) {
    const anyoneHas = profiles.some((p) => fieldTokens(p.skills).has(unknown));
    if (!anyoneHas) return [];
    // If someone does list it (vocab gap), treat it as a required skill.
    if (!requiredSkills.includes(unknown)) requiredSkills.push(unknown);
  }

  const scored: ScoredProfile[] = [];

  for (const profile of profiles) {
    const skillsToks = fieldTokens(profile.skills);
    const descToks = fieldTokens(profile.description);
    const reasons: string[] = [];
    let score = 0;

    let skillHits = 0;
    for (const skill of requiredSkills) {
      if (skillsToks.has(skill)) {
        skillHits += 1;
        score += 3;
        reasons.push(`skills include "${skill}" (${profile.skills.trim()})`);
      } else if (descToks.has(skill)) {
        // Bio-only mention: weak signal, and never enough on its own.
        score += 0.5;
        reasons.push(`bio mentions "${skill}" (weak: not in structured skills)`);
      }
    }

    // Availability signal (structured field only). When the caller allows busy
    // members (onlyAvailable=false), availability is neutral, not a penalty —
    // so "include busy" preferences can surface people like Hana.
    const avail = isAvailable(profile);
    if (wantsAvail) {
      if (avail) {
        score += 1.5;
        reasons.push(`availability says free/available (${profile.availability.trim()})`);
      } else if (prefs.onlyAvailable) {
        score -= 2;
      }
    }

    // Small generic overlap so skill-less questions ("who can help with events?")
    // still retrieve, capped so it cannot dominate. Stopwords excluded so long
    // adversarial bios can't win on filler words like "and"/"this".
    let overlap = 0;
    for (const t of queryToks) {
      if (skillsToks.has(t) || descToks.has(t)) overlap += 1;
    }
    score += Math.min(1, overlap * 0.2);

    // ---- Hard filters ----
    if (requiredSkills.length > 0 && skillHits === 0) continue; // bio-only can't pass
    if (prefs.onlyAvailable && wantsAvail && !avail) continue;
    if (score < 2) continue;

    scored.push({
      profile,
      score,
      reasons,
      evidence: snippet(profile, requiredSkills),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.profile.ens.localeCompare(b.profile.ens));
  return scored.slice(0, prefs.topK);
}
