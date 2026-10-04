import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetchProfiles } from './ens.js';
import { ProfileSchema, type Profile } from './schemas.js';

export const COMMUNITY_PATH = join(process.cwd(), 'data', 'community.json');
export const CACHE_PATH = join(process.cwd(), 'data', 'profiles.cache.json');

export async function loadCommunityList(
  path = COMMUNITY_PATH,
): Promise<string[]> {
  const raw = await readFile(path, 'utf8');
  const json = JSON.parse(raw);
  const names: string[] = Array.isArray(json)
    ? json
    : Array.isArray(json.names)
      ? json.names
      : Array.isArray(json.members)
        ? json.members
        : [];
  return names
    .map((n) => String(n).trim().toLowerCase())
    .filter(Boolean);
}

export async function loadCache(path = CACHE_PATH): Promise<Profile[]> {
  try {
    const raw = await readFile(path, 'utf8');
    const json = JSON.parse(raw);
    const arr = Array.isArray(json) ? json : (json.profiles ?? []);
    return arr
      .map((p: unknown) => ProfileSchema.safeParse(p))
      .filter((r: { success: boolean }) => r.success)
      .map((r: { data: Profile }) => r.data);
  } catch {
    return [];
  }
}

export async function saveCache(profiles: Profile[], path = CACHE_PATH) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(profiles, null, 2) + '\n', 'utf8');
}

/**
 * Build (or refresh) the retrieval index from LIVE ENS records.
 * Always re-reads the chain; the JSON cache is only a fallback for offline use.
 */
export async function refreshIndex(
  names?: string[],
  opts: { useCacheFallback?: boolean } = {},
): Promise<{ profiles: Profile[]; fromCache: boolean }> {
  const list = names ?? (await loadCommunityList());
  try {
    const profiles = await fetchProfiles(list);
    // Don't clobber a good cache with empty on-chain reads (e.g. before
    // `npm run seed -- --live` has been run, or when offline).
    const nonEmpty = profiles.filter((p) => p.skills || p.description);
    if (nonEmpty.length === 0) {
      const cached = await loadCache();
      if (cached.length > 0) return { profiles: cached, fromCache: true };
    } else {
      await saveCache(profiles);
    }
    return { profiles, fromCache: nonEmpty.length === 0 };
  } catch (err) {
    if (opts.useCacheFallback !== false) {
      const cached = await loadCache();
      if (cached.length > 0) return { profiles: cached, fromCache: true };
    }
    throw err;
  }
}

/** Load index: prefer live refresh, fall back to cache, then to seed-profiles (offline). */
export async function loadIndex(): Promise<Profile[]> {
  try {
    const { profiles } = await refreshIndex(undefined, {
      useCacheFallback: true,
    });
    const nonEmpty = profiles.filter((p) => p.skills || p.description);
    if (nonEmpty.length > 0) return profiles;
  } catch {
    // fall through to cache/seed below
  }
  const cached = await loadCache();
  if (cached.filter((p) => p.skills || p.description).length > 0) return cached;
  // Last resort (fresh clone / pre-seed): intended on-chain values.
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'seed-profiles.json'), 'utf8');
    const json = JSON.parse(raw) as { profiles: { ens: string; description: string; skills: string; availability: string }[] };
    return json.profiles.map((p) => ({
      ens: p.ens.trim().toLowerCase(),
      description: p.description,
      skills: p.skills,
      availability: p.availability,
      fetchedAt: new Date().toISOString(),
      resolver: 'seed-fallback',
    }));
  } catch {
    return cached;
  }
}
