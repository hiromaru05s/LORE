import OpenAI from 'openai';
import type { ZodSchema } from 'zod';
import { config, MOCK_MODE } from '../config';
import { mockGenerate } from './mock';

export type Purpose = 'score' | 'turn' | 'strike' | 'restrike' | 'seeds' | 'format' | 'content';

export interface LLMRequest<T> {
  purpose: Purpose;
  model: 'pro' | 'flash';
  system: string;
  user: string;
  schema: ZodSchema<T>;
  hints?: any;          // mock が現実的な出力を作るための構造化入力（real では無視）
  temperature?: number;
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  return client;
}

/** 統一LLM呼び出し。キー未設定なら mock、設定済みなら DeepSeek(OpenAI互換)。 */
export async function llm<T>(req: LLMRequest<T>): Promise<T> {
  if (MOCK_MODE) {
    const raw = mockGenerate(req.purpose, req.hints || {});
    return req.schema.parse(raw);
  }
  const model = req.model === 'pro' ? config.modelPro : config.modelFlash;
  const messages: any = [
    { role: 'system', content: req.system },
    { role: 'user', content: req.user + '\n\n必ず指定スキーマに沿った JSON オブジェクトのみを返してください。' },
  ];

  const call = async (extra?: string) => {
    const m = extra ? [...messages, { role: 'user', content: extra }] : messages;
    const res = await getClient().chat.completions.create({
      model,
      messages: m,
      temperature: req.temperature ?? (req.model === 'pro' ? 0.8 : 0.5),
      response_format: { type: 'json_object' },
    });
    return res.choices[0]?.message?.content || '{}';
  };

  // 1回目 → 失敗したら修復指示で1回だけ再試行
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const txt = await withRetry(() => call(attempt === 0 ? undefined : 'JSONが不正でした。指定スキーマの有効なJSONのみを返してください。'));
      const json = JSON.parse(extractJson(txt));
      return req.schema.parse(json);
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
  throw new Error('llm: unreachable');
}

function extractJson(s: string): string {
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

/** 429/5xx に指数バックオフ。 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e: any) {
      last = e;
      const status = e?.status || e?.response?.status;
      if (status && status !== 429 && status < 500) throw e;
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
    }
  }
  throw last;
}
