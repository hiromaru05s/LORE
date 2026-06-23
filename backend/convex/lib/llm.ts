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

// DeepSeek等に「どんなキーのJSONを返すか」を明示する形のスペック（mockは正しい形を直接返すので不要だが実LLMには必須）。
const SHAPES: Record<Purpose, string> = {
  score: `{"scores":{"specificity":0,"emotionalDepth":0,"selfInsight":0},"domain":"対人","type":"trait"}
  ※ specificity/emotionalDepth/selfInsight は各0〜3の整数。type は trait|event|preference|value|relation|pattern のいずれか。`,
  turn: `{"message":"AIの発話一文","choices":[{"label":"選択肢の表示文","value":"値"}]}
  ※ choices は0〜2個。自由記入させたい時は "choices":[] にする。`,
  strike: `{"message":"言い当ての一文","components":{"subject":"あなた","claim":"主張","qualifier":"限定（無ければ空文字）","valence":"pos"},"confidence":0.75,"type":"trait","domain":"対人","missCandidates":[{"label":"むしろ逆かも","value":"opposite"},{"label":"そこまでじゃない","value":"degree"},{"label":"相手や場面が違う","value":"object"},{"label":"当たってるけど理由が違う","value":"reason"}]}
  ※ valence は pos|neg|neu。confidence は0〜1。type は trait|event|preference|value|relation|pattern。missCandidates の value は opposite|degree|object|reason|partial|whole のいずれか。`,
  restrike: `{"message":"当て直しの一文","components":{"subject":"あなた","claim":"主張","qualifier":"","valence":"neu"},"confidence":0.7,"type":"trait","domain":"対人","missCandidates":[{"label":"むしろ逆かも","value":"opposite"}]}`,
  seeds: `{"seeds":[{"title":"コンテンツのタイトル","summary":"一文の概要","domain":"対人","suggestedFormat":"roughtext","sourceFragmentIds":[]}]}
  ※ suggestedFormat は timeline|contrast|constellation|roughtext。seeds は最大3つ。`,
  format: `{"format":"roughtext","reason":"選んだ理由"}
  ※ format は timeline|contrast|constellation|roughtext のいずれか。`,
  content: `{"title":"タイトル","format":"roughtext","payload":null,"bodies":{"detailed":"詳しい本文","normal":"普通の本文","vague":"ぼかした本文"}}
  ※ format は timeline|contrast|constellation|roughtext。bodies は3粒度すべて必須。`,
};

export async function llm<T>(req: LLMRequest<T>): Promise<T> {
  if (isMockLLM()) return req.schema.parse(mockGenerate(req.purpose, req.hints || {}));

  const cfg = llmConfig();
  const model = req.model === 'pro' ? cfg.modelPro : cfg.modelFlash;
  const body = {
    model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user + '\n\n出力は次の形のJSONオブジェクトだけを返す（キー名は完全一致、余計なキーや説明文は不要）:\n' + SHAPES[req.purpose] },
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
