// 信念ストアの「変換ロジック」を純粋関数で持つ（DB書き込みはConvex mutation側）。
// engine_design §1-3 / §1-7。Convex非依存。
import { TUNING } from './tuning';
import type { MissType } from './types';

export function halfLifeFor(type: string): number | null {
  return TUNING.HALFLIFE_DAYS[type] ?? null;
}

/** 反応を fragment へ適用するためのパッチを返す。 */
export function reactionPatch(frag: any, kind: 'agree' | 'unsure' | 'disagree', nowIso: string) {
  const reactions = [...(frag.reactions || []), { type: kind, at: nowIso }];
  if (kind === 'agree') {
    return {
      patch: {
        status: 'agreed', confidence: Math.max(frag.confidence || 0, 0.75), reactions,
        recency: { lastConfirmedAt: nowIso, halfLifeDays: frag.recency?.halfLifeDays ?? 0 },
      },
      markStruck: true,
    };
  }
  if (kind === 'unsure') return { patch: { status: 'unsure', confidence: 0.4, reactions }, markStruck: true };
  return { patch: { confidence: 0.15, reactions }, markStruck: true }; // disagree: proposed のまま
}

export type MissFollowup = 'restrike' | 'reason' | 'whole';

/** ハズレ型を fragment へ適用するためのパッチ＋次アクション種別を返す。 */
export function missPatch(frag: any, type: MissType): { patch: any; followup: MissFollowup } {
  const comp = { ...(frag.components || {}) };
  switch (type) {
    case 'opposite':
      comp.valence = comp.valence === 'pos' ? 'neg' : comp.valence === 'neg' ? 'pos' : 'neu';
      return { patch: { components: comp, status: 'retired' }, followup: 'restrike' };
    case 'reason':
      return { patch: { status: 'corrected', confidence: 0.6 }, followup: 'reason' };
    case 'partial':
      return { patch: { status: 'corrected', confidence: 0.55 }, followup: 'restrike' };
    case 'degree':
    case 'object':
    case 'custom':
      return { patch: { status: 'retired' }, followup: 'restrike' };
    case 'whole':
    default:
      return { patch: { status: 'retired' }, followup: 'whole' };
  }
}
