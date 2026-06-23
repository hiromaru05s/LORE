// PostHog サーバーサイド capture（fetch）。キー未設定なら no-op。
// 重要イベント（spec §10: 招待ループ/QA積み上げ/共有）の計測に使う。クライアントは別途 posthog-js / posthog-react-native。
export async function capture(event: string, distinctId: string, properties: Record<string, any> = {}) {
  const key = (process.env.POSTHOG_API_KEY || '').trim();
  if (!key) return; // 未設定なら計測しない
  const host = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, event, distinct_id: distinctId, properties, timestamp: new Date().toISOString() }),
    });
  } catch {
    // 計測失敗は本処理を止めない
  }
}

// LORE の主要イベント名（spec §10 の仮説検証）
export const EV = {
  STRIKE_SHOWN: 'strike_shown',
  STRIKE_REACTION: 'strike_reaction',     // {kind}
  FRAGMENT_AGREED: 'fragment_agreed',
  CONTENT_PUBLISHED: 'content_published', // {format, isPremium}
  SHARE_CREATED: 'share_created',         // {layer}
  RECEIVER_VIEW: 'receiver_view',         // 招待ループの入口
  ONBOARDING_DONE: 'onboarding_done',
  PREMIUM_GENERATED: 'premium_generated',
};
