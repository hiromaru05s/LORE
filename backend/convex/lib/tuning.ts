// 会話エンジンの調整パラメータ（lore_implementation_spec.md §3-2 の初期しきい値）。
// 実会話でチューニングする値。Convex非依存（純粋）。

export const TUNING = {
  STRIKE_THRESHOLD: 2.2,      // contour.material がこれを超えたら strike 候補
  STRIKE_PACE_TURNS: 2,       // 直近 strike からの最小ターン間隔
  DOMAIN_REPEAT_MAX: 3,       // 同 domain 連続でこれを超えたら pivot
  SESSION_CLOSE_TURNS: 10,    // セッションがこの長さを超え strike 直後なら close
  HALFLIFE_DAYS: { value: 180, preference: 90, trait: 120, pattern: 120 } as Record<string, number>,
  PREMIUM_PER_WEEK: 2,
  GRAN_CONF: { detailed: 0.75, normal: 0.6, vague: 0.4 } as Record<string, number>,
};

/** APIキー未設定なら mock モード（キーを挿せば実LLMに自動切替）。Convexのenv(process.env)を見る。 */
export const llmConfig = () => ({
  apiKey: (process.env.DEEPSEEK_API_KEY || '').trim(),
  baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim(),
  modelPro: (process.env.LLM_MODEL_PRO || 'deepseek-chat').trim(),
  modelFlash: (process.env.LLM_MODEL_FLASH || 'deepseek-chat').trim(),
});

export const isMockLLM = () => !(process.env.DEEPSEEK_API_KEY || '').trim();
