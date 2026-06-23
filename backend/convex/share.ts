import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { shareToken } from './lib/ids';
import { resolveUserId } from './users';

// 共有リンク発行（spec §7）。token は推測困難（22文字）。
export const createShare = mutation({
  args: { scope: v.optional(v.string()), layer: v.optional(v.string()), contentId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const uid = await resolveUserId(ctx);
    if (!uid) throw new Error('not authenticated');
    const token = shareToken();
    const scope = a.scope === 'content' ? 'content' : 'profile';
    const layer = a.layer === 'close' ? 'close' : 'general';
    await ctx.db.insert('shareLinks', { token, userId: uid, scope, contentId: a.contentId, layer, revoked: false });
    const path = scope === 'content' ? `/c/${token}` : `/s/${token}`;
    return { token, url: `lore.app${path}`, scope, layer };
  },
});

export const revokeShare = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const uid = await resolveUserId(ctx);
    const link = await ctx.db.query('shareLinks').withIndex('by_token', (q) => q.eq('token', token)).unique();
    if (!uid || !link || link.userId !== uid) throw new Error('not found');
    await ctx.db.patch(link._id, { revoked: true });
    return { revoked: true };
  },
});

// 受け手 View（未認証で見れる公開クエリ）。token の layer で絞る。spec §7
export const receiverView = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db.query('shareLinks').withIndex('by_token', (q) => q.eq('token', token)).unique();
    if (!link || link.revoked) return { error: 'invalid or revoked link' };
    const user = await ctx.db.get(link.userId);
    if (!user) return { error: 'user not found' };
    const author = { displayName: user.displayName, userId: `@${user.userId}`, bio: user.bio, avatar: user.avatar };

    if (link.scope === 'content' && link.contentId) {
      const card = await ctx.db.get(link.contentId as any).catch(() => null);
      return { kind: 'content', author, card: card ? pubCard(card) : null };
    }
    const cards = await ctx.db.query('contentCards').withIndex('by_user', (q) => q.eq('userId', link.userId)).collect();
    const visible = cards.filter((c) => c.layers.includes(link.layer) || link.layer === 'close'); // close は general も見える
    return { kind: 'profile', author, layer: link.layer, cards: visible.map(pubCard) };
  },
});

const pubCard = (c: any) => ({ id: c._id, title: c.title, body: c.body, format: c.format, payload: c.payload, conf: c.conf, isPremium: c.isPremium, cover: c.cover });
