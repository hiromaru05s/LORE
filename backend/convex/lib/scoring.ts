import { llm } from './llm';
import { SYS_SCORE } from './prompts';
import { ScoreSchema } from './schemas';
import type { Scores } from './types';

export interface ScoreResult { scores: Scores; domain: string; type: string; }

/** ユーザー回答を3軸採点し domain/type を推定（Flash）。spec §4-7 */
export async function scoreAnswer(text: string): Promise<ScoreResult> {
  const out = await llm({
    purpose: 'score', model: 'flash', system: SYS_SCORE,
    user: `次の回答を採点せよ。\n回答: ${text}`, schema: ScoreSchema, hints: { text },
  });
  return { scores: out.scores as Scores, domain: out.domain ?? '日常', type: out.type ?? 'trait' };
}

export function materialWeight(s: Scores): number {
  return s.specificity * 0.5 + s.emotionalDepth * 0.7 + s.selfInsight * 0.8;
}
export const isSubstantive = (s: Scores) => (s.specificity + s.emotionalDepth + s.selfInsight) >= 2;
