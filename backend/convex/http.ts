import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';

// Webhook エンドポイント。デプロイ後の URL は https://<deployment>.convex.site/...
// Stripe: /stripe/webhook（署名検証）／ RevenueCat: /revenuecat/webhook（Authorizationヘッダ検証）
const http = httpRouter();

http.route({
  path: '/stripe/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get('stripe-signature') || '';
    const payload = await req.text();
    const r: any = await ctx.runAction(internal.stripe.handleWebhook, { payload, signature });
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 400, headers: { 'content-type': 'application/json' } });
  }),
});

http.route({
  path: '/revenuecat/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const authHeader = req.headers.get('authorization') || undefined;
    const body = await req.text();
    const r: any = await ctx.runAction(internal.revenuecat.handleWebhook, { authHeader, body });
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 401, headers: { 'content-type': 'application/json' } });
  }),
});

export default http;
