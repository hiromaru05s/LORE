import { v } from 'convex/values';
import { action } from './_generated/server';
import { llmConfig, isMockLLM } from './lib/tuning';

// ──────────────────────────────────────────────────────────────────
//  コンテンツ翻訳（X風）。プラグイン式:
//   - GOOGLE_TRANSLATE_API_KEY（Convex env）が有れば Google Cloud Translation を使用
//   - 無ければ既存の LLM(DeepSeek) で翻訳（新キー不要・今すぐ無料で動く）
//   - どちらも無ければ原文を返す
//  キーの差し替え:  npx convex env set GOOGLE_TRANSLATE_API_KEY <key>
// ──────────────────────────────────────────────────────────────────
const LANG_NAME: Record<string, string> = { ja: 'Japanese', en: 'English', ko: 'Korean' };

export const translate = action({
  args: { text: v.string(), target: v.string() },
  handler: async (_ctx, { text, target }): Promise<{ text: string; provider: string }> => {
    const t = (text || '').trim();
    if (!t) return { text: '', provider: 'none' };
    const tgt = LANG_NAME[target] ? target : 'en';

    // 1) Google Cloud Translation（任意・キーがあれば優先）
    const gkey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (gkey) {
      try {
        const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${gkey}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ q: t, target: tgt, format: 'text' }),
        });
        if (res.ok) {
          const j: any = await res.json();
          const out = j?.data?.translations?.[0]?.translatedText;
          if (out) return { text: String(out), provider: 'google' };
        }
      } catch (_) { /* fallthrough */ }
    }

    // 2) 既存 LLM(DeepSeek) でフォールバック（新キー不要）
    if (!isMockLLM()) {
      try {
        const cfg = llmConfig();
        const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.modelFlash,
            messages: [
              { role: 'system', content: `You are a professional translator. Translate the user's text into ${LANG_NAME[tgt]}. Output ONLY the translation — no quotes, no notes, no romanization. Preserve line breaks, tone and meaning.` },
              { role: 'user', content: t },
            ],
            temperature: 0.2,
          }),
        });
        if (res.ok) {
          const j: any = await res.json();
          const out = j?.choices?.[0]?.message?.content?.trim();
          if (out) return { text: out, provider: 'llm' };
        }
      } catch (_) { /* fallthrough */ }
    }

    // 3) どちらも無ければ原文
    return { text: t, provider: 'none' };
  },
});
