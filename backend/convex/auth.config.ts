// Clerk 認証（Convex × Clerk 公式連携）。
// CLERK_FRONTEND_API_URL は Clerk ダッシュボードの Frontend API URL（例 https://verb-noun-00.clerk.accounts.dev）。
// JWT テンプレート名は "convex"（applicationID と一致させる）。
export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL,
      applicationID: 'convex',
    },
  ],
};
