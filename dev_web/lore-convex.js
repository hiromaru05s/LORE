// ──────────────────────────────────────────────────────────────────
//  LORE 統合クライアント（FE ↔ Convex バックエンド）
//  - ConvexClient + Clerk 認証をラップし、window.LoreBackend として公開。
//  - 設定（Convex URL / Clerk key）が無ければ ready=false → FEはデモにフォールバック。
//  - no-build の dc-runtime HTML から使えるよう ESM(esm.sh) で読み込む。
//
//  使い方（HTMLの <head> 等に）:
//    <script>
//      window.LORE_CONVEX_URL = "https://<deployment>.convex.cloud";
//      window.LORE_CLERK_PUBLISHABLE_KEY = "pk_test_...";   // 任意（無ければ匿名/dev）
//    </script>
//    <script type="module" src="./lore-convex.js"></script>
// ──────────────────────────────────────────────────────────────────
import { ConvexClient } from 'https://esm.sh/convex@1.17.0/browser';
import { makeFunctionReference } from 'https://esm.sh/convex@1.17.0/server';

const CONVEX_URL = (typeof window !== 'undefined' && window.LORE_CONVEX_URL) || '';
const CLERK_PK = (typeof window !== 'undefined' && window.LORE_CLERK_PUBLISHABLE_KEY) || '';

const fn = (name) => makeFunctionReference(name);

// バックエンド未設定ならデモのまま（readyをfalseに）
const Backend = {
  ready: false,
  authed: false,
  _client: null,
  _clerk: null,
  async init() {
    if (!CONVEX_URL) { console.info('[LORE] Convex URL 未設定 → デモモード'); return; }
    this._client = new ConvexClient(CONVEX_URL);

    // Clerk 認証（任意）。未設定なら ALLOW_DEV_USER=1 側のデモユーザーに乗る。
    if (CLERK_PK) {
      try {
        const { Clerk } = await import('https://esm.sh/@clerk/clerk-js@5');
        this._clerk = new Clerk(CLERK_PK);
        await this._clerk.load();
        // OAuth(Google)リダイレクトからの復帰を処理（authenticateWithRedirect の戻り）
        if (/__clerk|handshake|sign-in|sso/i.test(location.search + location.hash)) {
          try { await this._clerk.handleRedirectCallback({}); } catch (e) { console.warn('[LORE] redirect callback', e); }
        }
        this._client.setAuth(async () => {
          try { return (await this._clerk.session?.getToken({ template: 'convex' })) ?? null; }
          catch { return null; }
        });
        this.authed = !!this._clerk.user;
      } catch (e) { console.warn('[LORE] Clerk 初期化失敗（デモユーザーで継続）', e); }
    }
    this.ready = true;
    try { await this.ensureUser(); } catch (e) { console.warn('[LORE] ensureUser', e); }
    window.dispatchEvent(new CustomEvent('lore-backend-ready'));
    if (this.authed) window.dispatchEvent(new CustomEvent('lore-authed'));
    console.info('[LORE] バックエンド接続 ready' + (this.authed ? '（ログイン済み）' : ''));
  },
  // ── 認証フロー（独自UIから呼ぶ）──
  isConfigured() { return !!this._clerk; },
  // Google: OAuthリダイレクト。戻ってきたら init() の handleRedirectCallback がセッション確立。
  async startGoogle() {
    if (!this._clerk) throw new Error('clerk not configured');
    return this._clerk.client.signIn.authenticateWithRedirect({
      strategy: 'oauth_google',
      redirectUrl: location.origin + '/',
      redirectUrlComplete: location.origin + '/',
    });
  },
  // Email: パスワードレス。コードを送る（既存ユーザーはサインイン、無ければサインアップ）。
  async startEmail(email) {
    const c = this._clerk; if (!c) throw new Error('clerk not configured');
    this._mode = null; this._si = null; this._su = null;
    try {
      let si = await c.client.signIn.create({ identifier: email });
      const f = (si.supportedFirstFactors || []).find((x) => x.strategy === 'email_code');
      if (!f) throw new Error('email_code disabled');
      si = await si.prepareFirstFactor({ strategy: 'email_code', emailAddressId: f.emailAddressId });
      this._si = si; this._mode = 'signin';
    } catch (e) {
      // サインイン不可（未登録など）→ 新規サインアップに切り替え
      let su = await c.client.signUp.create({ emailAddress: email });
      su = await su.prepareEmailAddressVerification({ strategy: 'email_code' });
      this._su = su; this._mode = 'signup';
    }
    return true;
  },
  // 受け取った6桁コードで確定。成功でセッション確立。
  async verifyEmailCode(code) {
    const c = this._clerk; if (!c) throw new Error('clerk not configured');
    const res = this._mode === 'signup'
      ? await this._su.attemptEmailAddressVerification({ code })
      : await this._si.attemptFirstFactor({ strategy: 'email_code', code });
    if (res && res.status === 'complete') {
      await c.setActive({ session: res.createdSessionId });
      this.authed = true;
      try { await this.ensureUser(); } catch (e) { console.warn('[LORE] ensureUser', e); }
      window.dispatchEvent(new CustomEvent('lore-authed'));
      return true;
    }
    return false;
  },
  signOut() { return this._clerk?.signOut?.(); },

  // ── 薄いラッパ ──
  _q(name, args = {}) { return this._client.query(fn(name), args); },
  _m(name, args = {}) { return this._client.mutation(fn(name), args); },
  _a(name, args = {}) { return this._client.action(fn(name), args); },

  // ── ユーザー / プロフィール ──
  ensureUser(args = {}) { return this._m('users:ensureUser', args); },
  getMe() { return this._q('users:getMe', {}); },
  setPrivate(isPrivate) { return this._m('users:setPrivate', { isPrivate }); },
  setPreferences(prefs) { return this._m('users:setPreferences', prefs); },   // {strikeIntensity,boundariesNg,tone}
  isPremium() { return this._q('entitlements:isPremium', {}); },

  // ── 会話 ──
  startSession(mode = 'onboarding') { return this._a('conversation:startSession', { mode }); },
  sendTurn(sessionId, text, inputMode = 'choice_free') { return this._a('conversation:sendTurn', { sessionId, text, inputMode }); },
  react(sessionId, fragmentId, kind) { return this._a('conversation:react', { sessionId, fragmentId, kind }); },
  miss(sessionId, fragmentId, type, detail) { return this._a('conversation:miss', { sessionId, fragmentId, type, detail }); },
  nudge() { return this._q('conversation:nudge', {}); },

  // ── コンテンツ ──
  buildCandidates() { return this._a('content:buildCandidates', {}); },
  getCandidates() { return this._q('content:getCandidates', {}); },
  generate(seedId, granularity = 'normal') { return this._a('content:generate', { seedId, granularity }); },
  publish(draft) { return this._m('content:publish', draft); },
  patchCard(id, patch) { return this._m('content:patchCard', { id, ...patch }); },
  deleteCard(id) { return this._m('content:deleteCard', { id }); },

  // ── 共有 / 受け手View ──
  createShare(scope = 'profile', layer = 'general', contentId) { return this._m('share:createShare', { scope, layer, contentId }); },
  revokeShare(token) { return this._m('share:revokeShare', { token }); },
  receiverView(token) { return this._q('share:receiverView', { token }); },

  // ── ともだち（最小） ──
  incoming() { return this._q('friends:incoming', {}); },
  acceptFriend(id) { return this._m('friends:accept', { id }); },

  // ── 決済（Web=Stripe） ──
  checkout(priceId) { return this._a('stripe:createCheckoutSession', { priceId }); },
};

if (typeof window !== 'undefined') {
  window.LoreBackend = Backend;
  Backend.init();
}

export default Backend;
