import { answerQuestion } from './answer.js';
import { PARENT_NAME } from './config.js';
import { PreferencesSchema } from './schemas.js';
import { loadCommunityList, loadIndex, refreshIndex } from './store.js';

function parsePrefs(args: string[]) {
  const prefs: Record<string, unknown> = {};
  for (const a of args) {
    if (a === '--include-busy') prefs.onlyAvailable = false;
    if (a.startsWith('--topK=')) prefs.topK = Number(a.split('=')[1]);
  }
  return PreferencesSchema.parse(prefs);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'refresh') {
    const names = await loadCommunityList();
    console.log(`Refreshing ${names.length} profiles from Sepolia ENS...`);
    const { profiles, fromCache } = await refreshIndex(names);
    console.log(
      fromCache ? 'Offline: served from cache.' : `Live index refreshed at ${new Date().toISOString()}`,
    );
    for (const p of profiles) {
      console.log(`- ${p.ens} | skills=${p.skills || '(none)'} | avail=${p.availability || '(unknown)'}`);
    }
    return;
  }
  if (cmd === 'list') {
    const names = await loadCommunityList();
    console.log(`Parent: ${PARENT_NAME}\nMembers (${names.length}):`);
    for (const n of names) console.log(`- ${n}`);
    return;
  }
  if (cmd === 'ask') {
    // usage: npm run ask -- "Is anyone good at Rust and free?" [--include-busy] [--topK=3]
    const queryParts = rest.filter((a) => !a.startsWith('--'));
    const flags = rest.filter((a) => a.startsWith('--'));
    const query = queryParts.join(' ').trim();
    if (!query) {
      console.error('Usage: npm run ask -- "your question" [--include-busy] [--topK=3]');
      process.exit(1);
    }
    const prefs = parsePrefs(flags);
    const profiles = await loadIndex();
    const answer = await answerQuestion(query, profiles, prefs);
    console.log(JSON.stringify(answer, null, 2));
    return;
  }
  console.error('Commands: refresh | list | ask "question" [--include-busy] [--topK=N]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
