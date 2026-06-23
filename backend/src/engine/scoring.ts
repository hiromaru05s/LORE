import { llm } from '../llm/provider';
import { SYS_SCORE } from '../llm/prompts';
import { ScoreSchema } from '../llm/schemas';
import type { Scores } from '../types';

export interface ScoreResult {
  scores: Scores;
  domain: string;
  type: string;
}

/** ユーザー回答を3軸採点し、domain と内面 type を推定（Flash）。spec §4-7 */
export async function scoreAnswer(text: string): Promise<ScoreResult> {
  const out = await llm({
    purpose: 'score',
    model: 'flash',
    system: SYS_SCORE,
    user: `次の回答を採点せよ。\n回答: ${text}`,
    schema: ScoreSchema,
    hints: { text },
  });
  return { scores: out.scores as Scores, domain: out.domain, type: out.type };
}

/** 採点から「素材の重み」を出す（strike 判断の駆動）。 */
export function materialWeight(s: Scores): number {
  return s.specificity * 0.5 + s.emotionalDepth * 0.7 + s.selfInsight * 0.8;
}

export const isSubstantive = (s: Scores) => (s.specificity + s.emotionalDepth + s.selfInsight) >= 2;
