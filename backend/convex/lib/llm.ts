// 統一LLM呼び出し。DeepSeek(OpenAI互換)を fetch で叩く。キー未設定なら mock。
// Convexのactionランタイム(fetch可)でも、tsx(テスト)でも動く。Convex非依存。
import type { ZodSchema } from 'zod';
import { llmConfig, isMockLLM } from './tuning';
import { mockGenerate, type Purpose } from './mock';

export interface LLMRequest<T> {
  purpose: Purpose;
  model: 'pro' | 'flash';
  system: string;
  user: string;
  schema: ZodSchema<T>;
  hints?: any;          // mock用（realでは無視）
  temperature?: number;
}

export async function llm<T>(req: LLMRequest<T>): Promise<T> {
  if (isMockLLM()) return req.schema.parse(mockGenerate(req.purpose, req.hints || {}));

  const cfg = llmConfig();
  const model = req.model === 'pro' ? cfg.modelPro : cfg.modelFlash;
  const body = {
    model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user + '\n\n必ず指定スキーマに沿った JSON オブジェクトのみを返してください。' },
    ],
    temperature: req.temperature ?? (req.model === 'pro' ? 0.8 : 0.5),
    response_format: { type: 'json_object' },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const txt = await callChat(cfg.baseUrl, cfg.apiKey, attempt === 0 ? body : repair(body));
      return req.schema.parse(JSON.parse(extractJson(txt)));
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
  throw new Error('llm: unreachable');
}

async function callChat(baseUrl: string, apiKey: string, body: any): Promise<string> {
  // 429/5xx に指数バックオフ
  let last: any;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) { last = new Error(`LLM ${res.status}`); await sleep(400 * 2 ** i); continue; }
        throw new Error(`LLM ${res.status}: ${await res.text().catch(() => '')}`);
      }
      const json: any = await res.json();
      return json.choices?.[0]?.message?.content || '{}';
    } catch (e) { last = e; await sleep(400 * 2 ** i); }
  }
  throw last;
}

const repair = (body: any) => ({ ...body, messages: [...body.messages, { role: 'user', content: 'JSONが不正でした。指定スキーマの有効なJSONのみを返してください。' }] });
const extractJson = (s: string) => { const a = s.indexOf('{'), b = s.lastIndexOf('}'); return a >= 0 && b > a ? s.slice(a, b + 1) : s; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
