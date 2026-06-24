import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

// 調査用：各ユーザーのデータ状況を一覧（turns/sessions/totalSessions/intake有無）
export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect();
    const turns = await ctx.db.query('turns').collect();
    const sessions = await ctx.db.query('sessions').collect();
    const rels = await ctx.db.query('relationshipState').collect();
    return users.map((u) => {
      const rel = rels.find((r) => r.userId === u._id);
      return {
        userId: u.userId,
        clerkId: u.clerkId ?? null,
        intakeDone: !!u.intake,
        turns: turns.filter((t) => t.userId === u._id).length,
        sessions: sessions.filter((s) => s.userId === u._id).length,
        totalSessions: rel?.totalSessions ?? '(no rel)',
        totalTurns: rel?.totalTurns ?? '(no rel)',
      };
    });
  },
});

// ──────────────────────────────────────────────────────────────────
//  管理用：特定ユーザーのデータを完全削除（最初からやり直す用）。
//  公開クライアントからは呼べない internalMutation。CLI/ダッシュボードから:
//    npx convex run admin:wipeUser '{"handle":"maruru836818"}'
//    npx convex run admin:wipeUser '{"clerkId":"user_xxx"}'
//  users 行も消すので、次回ログイン時に ensureUser で作り直され、インテークも最初から走る。
// ──────────────────────────────────────────────────────────────────
export const wipeUser = internalMutation({
  args: { handle: v.optional(v.string()), clerkId: v.optional(v.string()) },
  handler: async (ctx, { handle, clerkId }) => {
    const all = await ctx.db.query('users').collect();
    const h = (handle || '').replace(/^@/, '').toLowerCase();
    const user = all.find(
      (u) =>
        (clerkId && u.clerkId === clerkId) ||
        (h && (u.userId || '').replace(/^@/, '').toLowerCase() === h)
    );
    if (!user) {
      return { ok: false, reason: 'user not found', existing: all.map((u) => u.userId) };
    }
    const uid = user._id;
    const counts: Record<string, number> = {};

    const wipe = async (table: any, pred: (r: any) => boolean) => {
      const rows = await ctx.db.query(table).collect();
      let n = 0;
      for (const r of rows) {
        if (pred(r)) {
          await ctx.db.delete(r._id);
          n++;
        }
      }
      counts[table] = n;
    };

    // misses は fragmentId 参照なので、対象ユーザーの fragment を先に把握して掃除
    const frags = (await ctx.db.query('fragments').collect()).filter((f) => f.userId === uid);
    const fragIds = new Set(frags.map((f) => String(f._id)));
    await wipe('misses', (r) => fragIds.has(String(r.fragmentId)));

    await wipe('turns', (r) => r.userId === uid);
    await wipe('fragments', (r) => r.userId === uid);
    await wipe('contours', (r) => r.userId === uid);
    await wipe('sessions', (r) => r.userId === uid);
    await wipe('contentSeeds', (r) => r.userId === uid);
    await wipe('contentCards', (r) => r.userId === uid);
    await wipe('shareLinks', (r) => r.userId === uid);
    await wipe('relationshipState', (r) => r.userId === uid);
    await wipe('entitlements', (r) => r.userId === uid);
    await wipe('friendRequests', (r) => r.toUser === uid || r.fromUser === user.userId);

    await ctx.db.delete(uid);
    counts['users'] = 1;

    return { ok: true, deletedUser: user.userId, clerkId: user.clerkId ?? null, counts };
  },
});
