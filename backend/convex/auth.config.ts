// Clerk 認証（Convex × Clerk 公式連携）。
// CLERK_FRONTEND_API_URL は Clerk ダッシュボードの Frontend API URL（例 https://verb-noun-00.clerk.accounts.dev）。
// JWT テンプレート名は "convex"（applicationID と一致させる）。
// CLERK_FRONTEND_API_URL が未設定の間は認証プロバイダ無し（dev は ALLOW_DEV_USER=1 のデモユーザーで動く）。
// env を設定すると自動で Clerk 認証が有効になる。
const clerkDomain = process.env.CLERK_FRONTEND_API_URL;

export default {
  providers: clerkDomain ? [{ domain: clerkDomain, applicationID: 'convex' }] : [],
};
