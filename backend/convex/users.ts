import { v } from 'convex/values';
import { mutation, query, internalQuery } from './_generated/server';
import { computeResolution } from './lib/resolution';
import { prefsFor } from './helpers';

const DEV = () => (process.env.ALLOW_DEV_USER || '').trim() === '1';
const DEMO_HANDLE = 'maruyama';

/** Clerk identity → user。未認証で ALLOW_DEV_USER=1 ならデモユーザーにフォールバック。 */
async function resolveUserId(ctx: any): Promise<any | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const u = await ctx.db.query('users').withIndex('by_clerk', (q: any) => q.eq('clerkId', identity.subject)).unique();
    return u?._id ?? null;
  }
  if (DEV()) {
    const u = await ctx.db.query('users').withIndex('by_handle', (q: any) => q.eq('userId', DEMO_HANDLE)).unique();
    return u?._id ?? null;
  }
  return null;
}
export { resolveUserId };

/** ログイン時に呼ぶ：Clerk identity から users 行を get-or-create。返り値は user _id。 */
export const ensureUser = mutation({
  args: { displayName: v.optional(v.string()), handle: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      let u = await ctx.db.query('users').withIndex('by_clerk', (q) => q.eq('clerkId', identity.subject)).unique();
      if (!u) {
        const handle = (args.handle || identity.nickname || identity.email?.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '');
        const id = await ctx.db.insert('users', {
          clerkId: identity.subject, userId: handle,
          displayName: args.displayName || identity.name || handle, bio: '', avatar: (args.displayName || handle).slice(0, 1), profilePrivate: true,
        });
        await ctx.db.insert('relationshipState', emptyRel(id));
        return id;
      }
      return u._id;
    }
    // dev fallback: demo user
    if (DEV()) {
      let u = await ctx.db.query('users').withIndex('by_handle', (q) => q.eq('userId', DEMO_HANDLE)).unique();
      if (!u) {
        const id = await ctx.db.insert('users', { userId: DEMO_HANDLE, displayName: '丸山', bio: 'だいたい一番後ろの席にいる。', avatar: '丸', profilePrivate: true });
        await ctx.db.insert('relationshipState', emptyRel(id));
        return id;
      }
      return u._id;
    }
    throw new Error('not authenticated');
  },
});

function emptyRel(userId: any) {
  return { userId, totalSessions: 0, totalTurns: 0, knownDomains: [], inputModeRatio: { tap: 0, choice_free: 0, free: 0 }, premiumQuota: { weekStartAt: new Date().toISOString(), used: 0 }, memoryHighlights: [], reaskDue: [] };
}

/** 自分のプロフィール（cards/resolution/申請/プレミアム）。 */
export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const uid = await resolveUserId(ctx);
    if (!uid) return null;
    const u: any = await ctx.db.get(uid);
    const cards = await ctx.db.query('contentCards').withIndex('by_user', (q) => q.eq('userId', uid)).collect();
    const agreed = await ctx.db.query('fragments').withIndex('by_user_status', (q) => q.eq('userId', uid).eq('status', 'agreed')).collect();
    const corrected = await ctx.db.query('fragments').withIndex('by_user_status', (q) => q.eq('userId', uid).eq('status', 'corrected')).collect();
    const contours = await ctx.db.query('contours').withIndex('by_user_domain', (q) => q.eq('userId', uid)).collect();
    const ent = await ctx.db.query('entitlements').withIndex('by_user', (q) => q.eq('userId', uid)).unique();
    const reqs = await ctx.db.query('friendRequests').withIndex('by_to', (q) => q.eq('toUser', uid)).filter((q) => q.eq(q.field('status'), 'incoming')).collect();
    const resolution = computeResolution([...agreed, ...corrected].map((f) => ({ confidence: f.confidence })), contours.filter((c) => c.struck > 0).map((c) => c.domain));
    return {
      displayName: u!.displayName, userId: `@${u!.userId}`, bio: u!.bio, avatar: u!.avatar,
      profilePrivate: u!.profilePrivate, resolution, isPremium: !!ent?.isPremium,
      cards: cards.map((c) => ({ id: c._id, title: c.title, body: c.body, format: c.format, payload: c.payload, conf: c.conf, layers: c.layers, isPremium: c.isPremium, pinned: c.pinned })),
      incomingRequests: reqs.map((r) => ({ id: r._id, name: r.fromName, fromUser: r.fromUser })),
      preferences: await prefsFor(ctx, uid),
    };
  },
});

/** 受信ダイヤル(preferences)の更新。設定の軽トグルから呼ぶ。 */
export const setPreferences = mutation({
  args: { strikeIntensity: v.optional(v.string()), boundariesNg: v.optional(v.array(v.string())), tone: v.optional(v.string()), depth: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const uid = await resolveUserId(ctx);
    if (!uid) throw new Error('not authenticated');
    const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q) => q.eq('userId', uid)).unique();
    if (!rel) return { ok: false };
    const cur: any = rel.preferences || {};
    const next: any = { ...cur };
    if (a.strikeIntensity !== undefined) next.strikeIntensity = a.strikeIntensity;
    if (a.boundariesNg !== undefined) next.boundariesNg = a.boundariesNg;
    if (a.tone !== undefined) next.tone = a.tone;
    if (a.depth !== undefined) next.depth = a.depth;
    await ctx.db.patch(rel._id, { preferences: next });
    return { ok: true, preferences: next };
  },
});

export const setPrivate = mutation({
  args: { isPrivate: v.boolean() },
  handler: async (ctx, args) => {
    const uid = await resolveUserId(ctx);
    if (!uid) throw new Error('not authenticated');
    await ctx.db.patch(uid, { profilePrivate: args.isPrivate });
    return { ok: true };
  },
});

/** 内部：他関数から userId を引く用。 */
export const _resolve = internalQuery({ args: {}, handler: async (ctx) => await resolveUserId(ctx) });
