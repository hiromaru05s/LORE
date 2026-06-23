import { mutation } from './_generated/server';

// デモ用シード。`npx convex run seed:seedDemo` で実行。ALLOW_DEV_USER=1 と併用すると認証なしで会話できる。
export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    let u = await ctx.db.query('users').withIndex('by_handle', (q) => q.eq('userId', 'maruyama')).unique();
    if (!u) {
      const id = await ctx.db.insert('users', { userId: 'maruyama', displayName: '丸山', bio: 'だいたい一番後ろの席にいる。旅と、その帰り道が好き。', avatar: '丸', profilePrivate: true });
      await ctx.db.insert('relationshipState', { userId: id, totalSessions: 0, totalTurns: 0, knownDomains: [], inputModeRatio: { tap: 0, choice_free: 0, free: 0 }, premiumQuota: { weekStartAt: new Date().toISOString(), used: 0 }, memoryHighlights: [], reaskDue: [] });
      // 最小ともだち申請（受信表示の検証用）
      await ctx.db.insert('friendRequests', { toUser: id, fromUser: 'u_akari', fromName: '灯里', status: 'incoming' });
      return { created: true, userId: id };
    }
    return { created: false, userId: u._id };
  },
});
