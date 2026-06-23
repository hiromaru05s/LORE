'use node';
import { v } from 'convex/values';
import Stripe from 'stripe';
import { action, internalAction } from './_generated/server';
import { api, internal } from './_generated/api';

// Web決済＝Stripe（自前Billing）。権利は RevenueCat に集約するが、Stripeのwebhookでも entitlements を更新できる。
// 「案A」：自前Stripe購入を RevenueCat の Track External Purchases で取り込み、is_premium を一元化する想定。
// 下の webhook はその間（または RC未配線時）にも権利が効くようにする保険。

function client(): Stripe | null {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  return key ? new Stripe(key) : null;
}

/** Web のチェックアウト（サブスク）を作成。client_reference_id に Clerk userId を入れて webhook で名寄せ。 */
export const createCheckoutSession = action({
  args: { priceId: v.string() },
  handler: async (ctx, { priceId }) => {
    const stripe = client();
    if (!stripe) throw new Error('stripe not configured (set STRIPE_SECRET_KEY)');
    const identity = await ctx.auth.getUserIdentity();
    const appUserId = identity?.subject || 'dev_user';
    const base = (process.env.APP_WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: appUserId,
      subscription_data: { metadata: { appUserId } },
      success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing/cancel`,
    });
    return { url: session.url };
  },
});

/** http.ts から呼ばれる webhook 処理（署名検証は node ランタイムで）。 */
export const handleWebhook = internalAction({
  args: { payload: v.string(), signature: v.string() },
  handler: async (ctx, { payload, signature }) => {
    const stripe = client();
    const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!stripe || !secret) return { ok: false, reason: 'stripe not configured' };

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
    } catch (e: any) {
      return { ok: false, reason: `signature: ${e.message}` };
    }

    const set = (appUserId: string, isPremium: boolean, extra: any = {}) =>
      ctx.runMutation(internal.entitlements.setEntitlement, { appUserId, isPremium, store: 'stripe', ...extra });

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.client_reference_id) await set(s.client_reference_id, true, { productId: typeof s.subscription === 'string' ? s.subscription : undefined });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const appUserId = (sub.metadata as any)?.appUserId;
        if (appUserId) await set(appUserId, ['active', 'trialing'].includes(sub.status), { expiresAt: new Date(sub.current_period_end * 1000).toISOString(), willRenew: !sub.cancel_at_period_end });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const appUserId = (sub.metadata as any)?.appUserId;
        if (appUserId) await set(appUserId, false);
        break;
      }
    }
    return { ok: true, type: event.type };
  },
});
