import 'dotenv/config';

export const config = {
  apiKey: process.env.DEEPSEEK_API_KEY?.trim() || '',
  baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
  modelPro: process.env.LLM_MODEL_PRO?.trim() || 'deepseek-chat',
  modelFlash: process.env.LLM_MODEL_FLASH?.trim() || 'deepseek-chat',
  dbFile: process.env.DATABASE_FILE?.trim() || './lore.db',
  port: parseInt(process.env.PORT || '8787', 10),
  corsOrigin: process.env.CORS_ORIGIN?.trim() || '*',
};

/** APIキー未設定なら mock モード（キーを挿せば実LLMに自動切替）。 */
export const MOCK_MODE = config.apiKey === '';

/** 会話エンジンの調整パラメータ（spec §3-2 の初期しきい値）。 */
export const TUNING = {
  STRIKE_THRESHOLD: 2.2,      // contour.material がこれを超えたら strike 候補
  STRIKE_PACE_TURNS: 2,       // 直近 strike からの最小ターン間隔
  DOMAIN_REPEAT_MAX: 3,       // 同 domain 連続でこれを超えたら pivot
  SESSION_CLOSE_TURNS: 10,    // セッションがこの長さを超え strike 直後なら close
  // 聞き直し（⑧）: 型別の半減期（日）。デモは短めにして検証しやすく。
  HALFLIFE_DAYS: { value: 180, preference: 90, trait: 120, pattern: 120 } as Record<string, number>,
  PREMIUM_PER_WEEK: 2,
};
