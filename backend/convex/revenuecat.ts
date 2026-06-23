import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

// モバイル決済＝RevenueCat（App Store / Play をラップ）。権利の真実の源。
// RC ダッシュボードの Webhook に Authorization ヘッダ（共有シークレット）を設定し、ここで検証する。
// app_user_id は Clerk userId に揃える（クロスプラットフォーム権利の前提）。

const GRANT = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_EXTENDED']);
const REVOKE = new Set(['EXPIRATION', 'SUBSCRIPTION_PAUSED', 'BILLING_ISSUE']);

export const handleWebhook = internalAction({
  args: { authHeader: v.optional(v.string()), body: v.string() },
  handler: async (ctx, { authHeader, body }) => {
    const expected = (process.env.REVENUECAT_WEBHOOK_AUTH || '').trim();
    if (!expected) return { ok: false, reason: 'revenuecat not configured' };
    if (authHeader !== expected) return { ok: false, reason: 'unauthorized' };

    let payload: any;
    try { payload = JSON.parse(body); } catch { return { ok: false, reason: 'bad json' }; }
    const ev = payload?.event;
    if (!ev?.app_user_id) return { ok: false, reason: 'no app_user_id' };

    let isPremium: boolean | null = null;
    if (GRANT.has(ev.type)) isPremium = true;
    else if (REVOKE.has(ev.type)) isPremium = false;
    else if (ev.type === 'CANCELLATION') isPremium = true; // 期間終了までは有効、willRenew=false
    if (isPremium === null) return { ok: true, ignored: ev.type };

    const store = ev.store === 'APP_STORE' ? 'app_store' : ev.store === 'PLAY_STORE' ? 'play_store' : 'revenuecat';
    await ctx.runMutation(internal.entitlements.setEntitlement, {
      appUserId: ev.app_user_id, isPremium, store,
      productId: ev.product_id, expiresAt: ev.expiration_at_ms ? new Date(ev.expiration_at_ms).toISOString() : undefined,
      willRenew: ev.type !== 'CANCELLATION',
    });
    return { ok: true, type: ev.type };
  },
});
