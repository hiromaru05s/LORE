import { v } from 'convex/values';
import { query, internalMutation } from './_generated/server';
import { resolveUserId } from './users';

// 権利の真実の源は RevenueCat。Stripe(web) と RevenueCat(mobile) の webhook がここを更新する。
// content.publish は isPremium=true のとき entitlements.isPremium を要求する。

export const isPremium = query({
  args: {},
  handler: async (ctx) => {
    const uid = await resolveUserId(ctx);
    if (!uid) return { isPremium: false };
    const ent = await ctx.db.query('entitlements').withIndex('by_user', (q) => q.eq('userId', uid)).unique();
    return { isPremium: !!ent?.isPremium, store: ent?.store, expiresAt: ent?.expiresAt };
  },
});

/** webhook から呼ばれる内部更新。app_user_id(=Clerk userId)で users を引く。 */
export const setEntitlement = internalMutation({
  args: { appUserId: v.string(), isPremium: v.boolean(), store: v.optional(v.string()), productId: v.optional(v.string()), expiresAt: v.optional(v.string()), willRenew: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    // appUserId は Clerk subject。users.clerkId か handle で解決。
    let user = await ctx.db.query('users').withIndex('by_clerk', (q) => q.eq('clerkId', a.appUserId)).unique();
    if (!user) user = await ctx.db.query('users').withIndex('by_handle', (q) => q.eq('userId', a.appUserId)).unique();
    if (!user) return { ok: false, reason: 'user not found' };
    const existing = await ctx.db.query('entitlements').withIndex('by_user', (q) => q.eq('userId', user!._id)).unique();
    const fields = { userId: user._id, isPremium: a.isPremium, store: a.store, productId: a.productId, expiresAt: a.expiresAt, willRenew: a.willRenew, updatedAt: new Date().toISOString() };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert('entitlements', fields);
    return { ok: true };
  },
});
