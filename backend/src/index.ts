import express from 'express';
import cors from 'cors';
import { config, MOCK_MODE } from './config';
import { migrate } from './db/db';
import { Users, Cards, Rel, Friends } from './db/repo';
import {
  startSession, handleTurn, react, miss, nudge,
} from './engine/orchestrator';
import {
  buildCandidates, generateContent, publish, checkPremiumQuota, consumePremiumQuota,
} from './engine/content';
import { createShare, revokeShare, receiverView } from './engine/share';
import { computeResolution } from './engine/resolution';
import { getRelationSummary } from './engine/relationship';

migrate();

const DEMO_UID = 'u_maruyama';
const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

const uidOf = (req: any) => (req.header('x-user-id') || DEMO_UID);
const wrap = (fn: any) => (req: any, res: any) => Promise.resolve(fn(req, res)).catch((e: any) => {
  const status = e?.status || 500;
  if (status >= 500) console.error(e);
  res.status(status).json({ error: e?.message || 'internal error' });
});

// ── health / status ────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, mode: MOCK_MODE ? 'mock' : 'live', model: { pro: config.modelPro, flash: config.modelFlash } }));

// ── conversation ───────────────────────────────────────────────
app.post('/session', wrap(async (req: any, res: any) => {
  const mode = req.body?.mode === 'home' ? 'home' : 'onboarding';
  res.json(await startSession(uidOf(req), mode));
}));
app.post('/session/:id/turn', wrap(async (req: any, res: any) => {
  res.json(await handleTurn(uidOf(req), req.params.id, { text: req.body?.text, inputMode: req.body?.inputMode }));
}));
app.post('/session/:id/react', wrap(async (req: any, res: any) => {
  res.json(await react(uidOf(req), req.params.id, req.body?.fragmentId, req.body?.kind));
}));
app.post('/session/:id/miss', wrap(async (req: any, res: any) => {
  res.json(await miss(uidOf(req), req.params.id, req.body?.fragmentId, req.body?.type, req.body?.detail));
}));
app.post('/session/:id/firstlore', wrap((req: any, res: any) => {
  res.json({ ok: true, resolution: computeResolution(uidOf(req)) });
}));
app.post('/nudge', wrap((req: any, res: any) => res.json(nudge(uidOf(req)))));

// ── content ────────────────────────────────────────────────────
app.get('/candidates', wrap(async (req: any, res: any) => res.json({ candidates: await buildCandidates(uidOf(req)) })));
app.post('/content/generate', wrap(async (req: any, res: any) => {
  res.json(await generateContent(uidOf(req), req.body?.seedId, req.body?.granularity || 'normal'));
}));
app.post('/content/regenerate', wrap(async (req: any, res: any) => {
  res.json(await generateContent(uidOf(req), req.body?.seedId, req.body?.granularity || 'normal'));
}));
app.post('/content/publish', wrap((req: any, res: any) => {
  const uid = uidOf(req);
  if (req.body?.isPremium) {
    const q = checkPremiumQuota(uid);
    if (!q.ok) return res.status(429).json({ error: 'premium quota exhausted', ...q });
    consumePremiumQuota(uid);
  }
  res.json(publish(uid, req.body || {}));
}));
app.patch('/content/:id', wrap((req: any, res: any) => {
  const card = Cards.get(req.params.id);
  if (!card) return res.status(404).json({ error: 'not found' });
  const patch: any = {};
  if (req.body?.title !== undefined) patch.title = req.body.title;
  if (req.body?.pinned !== undefined) patch.pinned = !!req.body.pinned;
  if (req.body?.closeOnly !== undefined) patch.layers = req.body.closeOnly ? ['close'] : ['general'];
  Cards.update(req.params.id, patch);
  res.json(Cards.get(req.params.id));
}));
app.delete('/content/:id', wrap((req: any, res: any) => { Cards.remove(req.params.id); res.json({ deleted: true }); }));

// ── share / receiver view ──────────────────────────────────────
app.post('/share', wrap((req: any, res: any) => {
  res.json(createShare(uidOf(req), req.body?.scope === 'content' ? 'content' : 'profile', req.body?.layer || 'general', req.body?.contentId));
}));
app.post('/share/:token/revoke', wrap((req: any, res: any) => res.json(revokeShare(req.params.token))));
app.get('/s/:token', wrap((req: any, res: any) => res.json(receiverView(req.params.token))));
app.get('/c/:token', wrap((req: any, res: any) => res.json(receiverView(req.params.token))));

// ── profile (self) ─────────────────────────────────────────────
app.get('/me', wrap((req: any, res: any) => {
  const uid = uidOf(req);
  const u = Users.get(uid);
  if (!u) return res.status(404).json({ error: 'user not found' });
  res.json({
    displayName: u.display_name, userId: `@${u.user_id}`, bio: u.bio, avatar: u.avatar,
    profilePrivate: u.profile_private, resolution: computeResolution(uid),
    relation: getRelationSummary(uid),
    cards: Cards.byUser(uid).map(c => ({ id: c.id, title: c.title, body: c.body, format: c.format, payload: c.payload, conf: c.conf, layers: c.layers, isPremium: c.is_premium, pinned: c.pinned })),
    incomingRequests: Friends.incoming(uid).map((r: any) => ({ id: r.id, name: r.from_name, fromUser: r.from_user })),
  });
}));
app.patch('/me/private', wrap((req: any, res: any) => {
  Users.setPrivate(uidOf(req), !!req.body?.private);
  res.json({ ok: true, private: !!req.body?.private });
}));

// ── friends (最小: 受信表示＋承認のみ) ─────────────────────────
app.get('/friends/incoming', wrap((req: any, res: any) => {
  res.json({ incoming: Friends.incoming(uidOf(req)).map((r: any) => ({ id: r.id, name: r.from_name, fromUser: r.from_user })) });
}));
app.post('/friends/:id/accept', wrap((req: any, res: any) => { Friends.accept(req.params.id); res.json({ accepted: true }); }));

app.listen(config.port, () => {
  console.log(`LORE backend on :${config.port}  [${MOCK_MODE ? 'MOCK (APIキー未設定)' : 'LIVE: DeepSeek'}]`);
});
