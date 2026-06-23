import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { resolveUserId } from './users';

// 最小ともだち申請（受信表示＋承認のみ）。フォロー/通知は作らない（ノイズ）。spec §8
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const uid = await resolveUserId(ctx);
    if (!uid) return { incoming: [] };
    const reqs = await ctx.db.query('friendRequests').withIndex('by_to', (q) => q.eq('toUser', uid)).filter((q) => q.eq(q.field('status'), 'incoming')).collect();
    return { incoming: reqs.map((r) => ({ id: r._id, name: r.fromName, fromUser: r.fromUser })) };
  },
});

export const accept = mutation({
  args: { id: v.id('friendRequests') },
  handler: async (ctx, { id }) => {
    const uid = await resolveUserId(ctx);
    const r = await ctx.db.get(id);
    if (!uid || !r || r.toUser !== uid) throw new Error('not found');
    await ctx.db.patch(id, { status: 'accepted' });
    return { accepted: true };
  },
});
