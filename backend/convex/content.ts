import { v } from 'convex/values';
import { action, mutation, query, internalMutation, internalQuery } from './_generated/server';
import { api, internal } from './_generated/api';
import { buildSeeds, selectFormat, generateContentBody } from './lib/content';
import { TUNING } from './lib/tuning';
import { resolveUserId } from './users';
import { agreedAndCorrected } from './helpers';

const GRAN_CONF = TUNING.GRAN_CONF;

// 候補生成（Flash, action）。spec §5-1
export const buildCandidates = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const uid = await ctx.runMutation(api.users.ensureUser, {});
    const agreed = await ctx.runQuery(internal.content.loadAgreed, { uid });
    const out = await buildSeeds(agreed);
    await ctx.runMutation(internal.content.replaceCandidates, {
      uid, seeds: out.seeds.map((s) => ({ sourceFragmentIds: s.sourceFragmentIds, domain: s.domain, suggestedFormat: s.suggestedFormat, title: s.title, summary: s.summary })),
    });
    return { candidates: await ctx.runQuery(api.content.getCandidates, {}) };
  },
});

export const loadAgreed = internalQuery({
  args: { uid: v.id('users') },
  handler: async (ctx, { uid }) => (await agreedAndCorrected(ctx, uid)).map((f: any) => ({ id: f._id, text: f.text, domain: f.domain, type: f.type, reask: f.reask })),
});

export const replaceCandidates = internalMutation({
  args: { uid: v.id('users'), seeds: v.array(v.any()) },
  handler: async (ctx, { uid, seeds }) => {
    const old = await ctx.db.query('contentSeeds').withIndex('by_user_status', (q) => q.eq('userId', uid).eq('status', 'candidate')).collect();
    for (const o of old) await ctx.db.delete(o._id);
    for (const s of seeds) await ctx.db.insert('contentSeeds', { userId: uid, sourceFragmentIds: s.sourceFragmentIds || [], domain: s.domain || '日常', suggestedFormat: s.suggestedFormat || 'roughtext', title: s.title || '', summary: s.summary || '', status: 'candidate' });
  },
});

export const getCandidates = query({
  args: {},
  handler: async (ctx) => {
    const uid = await resolveUserId(ctx);
    if (!uid) return [];
    const seeds = await ctx.db.query('contentSeeds').withIndex('by_user_status', (q) => q.eq('userId', uid).eq('status', 'candidate')).collect();
    return seeds.map((s) => ({ id: s._id, title: s.title, summary: s.summary, suggestedFormat: s.suggestedFormat, domain: s.domain }));
  },
});

// 生成（フォーマット選定 Flash ＋ 本文 Pro, action）。spec §5-2。永続化はせず draft を返す（reviewステップ）。
export const generate = action({
  args: { seedId: v.id('contentSeeds'), granularity: v.optional(v.string()) },
  handler: async (ctx, { seedId, granularity }): Promise<any> => {
    const uid = await ctx.runMutation(api.users.ensureUser, {});
    const data = await ctx.runQuery(internal.content.seedWithFrags, { seedId });
    if (!data) throw new Error('seed not found');
    const fmt = data.seed.suggestedFormat && data.seed.suggestedFormat !== 'roughtext' ? data.seed.suggestedFormat : await selectFormat(data.frags);
    const content = await generateContentBody({ title: data.seed.title, summary: data.seed.summary, format: fmt as any, frags: data.frags });
    const gran = ((granularity as string) || 'normal') as 'detailed' | 'normal' | 'vague';
    return { seedId, format: content.format, title: content.title, payload: content.payload, body: content.bodies[gran], bodies: content.bodies, conf: GRAN_CONF[gran] };
  },
});

export const seedWithFrags = internalQuery({
  args: { seedId: v.id('contentSeeds') },
  handler: async (ctx, { seedId }) => {
    const seed = await ctx.db.get(seedId);
    if (!seed) return null;
    const frags: any[] = [];
    for (const fid of seed.sourceFragmentIds) { const f = await ctx.db.get(fid as any).catch(() => null); if (f) frags.push(f); }
    return { seed, frags };
  },
});

// 公開（mutation）。spec §5-4。closeOnly→close レイヤー。プレミアムは権利＋週2枠で制御。
export const publish = mutation({
  args: { seedId: v.optional(v.id('contentSeeds')), format: v.string(), title: v.string(), body: v.string(), payload: v.optional(v.any()), granularity: v.optional(v.string()), closeOnly: v.optional(v.boolean()), isPremium: v.optional(v.boolean()), cover: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const uid = await resolveUserId(ctx);
    if (!uid) throw new Error('not authenticated');

    if (a.isPremium) {
      const ent = await ctx.db.query('entitlements').withIndex('by_user', (q) => q.eq('userId', uid)).unique();
      if (!ent?.isPremium) throw new Error('premium subscription required');
      const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q) => q.eq('userId', uid)).unique();
      const quota = rel?.premiumQuota || { weekStartAt: new Date().toISOString(), used: 0 };
      if (Date.now() - Date.parse(quota.weekStartAt) >= 7 * 86400_000) { quota.weekStartAt = new Date().toISOString(); quota.used = 0; }
      if (quota.used >= TUNING.PREMIUM_PER_WEEK) throw new Error('premium weekly quota exhausted');
      quota.used += 1;
      if (rel) await ctx.db.patch(rel._id, { premiumQuota: quota });
    }

    const layers = a.closeOnly ? ['close'] : ['general'];
    const conf = GRAN_CONF[(a.granularity as any) || 'normal'];
    const cardId = await ctx.db.insert('contentCards', { userId: uid, seedId: a.seedId, format: a.format, title: a.title, body: a.body, payload: a.payload, conf, layers, isPremium: !!a.isPremium, cover: a.cover, pinned: false });
    if (a.seedId) await ctx.db.patch(a.seedId, { status: 'published' });
    return { id: cardId, layers, conf, isPremium: !!a.isPremium };
  },
});

export const patchCard = mutation({
  args: { id: v.id('contentCards'), title: v.optional(v.string()), pinned: v.optional(v.boolean()), closeOnly: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const uid = await resolveUserId(ctx);
    const card = await ctx.db.get(a.id);
    if (!uid || !card || card.userId !== uid) throw new Error('not found');
    const patch: any = {};
    if (a.title !== undefined) patch.title = a.title;
    if (a.pinned !== undefined) patch.pinned = a.pinned;
    if (a.closeOnly !== undefined) patch.layers = a.closeOnly ? ['close'] : ['general'];
    await ctx.db.patch(a.id, patch);
    return { ok: true };
  },
});

export const deleteCard = mutation({
  args: { id: v.id('contentCards') },
  handler: async (ctx, { id }) => {
    const uid = await resolveUserId(ctx);
    const card = await ctx.db.get(id);
    if (!uid || !card || card.userId !== uid) throw new Error('not found');
    await ctx.db.delete(id);
    return { ok: true };
  },
});
