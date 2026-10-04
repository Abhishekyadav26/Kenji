import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { answerQuestion } from './answer.js';
import { PreferencesSchema } from './schemas.js';
import { loadIndex, refreshIndex, loadCommunityList } from './store.js';

const app = express();
app.use(cors());
app.use(express.json());

const AskBody = z.object({
  query: z.string().min(1),
  preferences: PreferencesSchema.partial().default({}),
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/community', async (_req, res) => {
  const names = await loadCommunityList();
  res.json({ parent: process.env.PARENT_NAME, members: names });
});

app.post('/refresh', async (_req, res) => {
  try {
    const { profiles, fromCache } = await refreshIndex();
    res.json({ ok: true, fromCache, count: profiles.length, profiles });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/ask', async (req, res) => {
  const parsed = AskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const prefs = PreferencesSchema.parse(parsed.data.preferences ?? {});
  const profiles = await loadIndex();
  const answer = await answerQuestion(parsed.data.query, profiles, prefs);
  res.json(answer);
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`kenji people-finder listening on :${port}`);
});
