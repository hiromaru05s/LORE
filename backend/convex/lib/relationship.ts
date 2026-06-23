// 関係エンジン(⑧)の純粋ヘルパ。DBアクセスは呼び出し側(Convex)で行い、配列を渡す。
import type { InputMode } from './types';

const REASKABLE = new Set(['value', 'preference', 'trait', 'pattern']);

/** 聞き直し対象（変わりうる型で半減期を過ぎた agreed/corrected）。spec §6-2 */
export function reaskDue(agreedFrags: any[], nowMs: number): any[] {
  return agreedFrags.filter(f => {
    if (!REASKABLE.has(f.type)) return false;
    const last = f.recency?.lastConfirmedAt ? Date.parse(f.recency.lastConfirmedAt) : null;
    const half = f.recency?.halfLifeDays || 0;
    if (!last || !half) return false;
    return nowMs - last >= half * 86400_000;
  });
}

/** 「分かってる感」の素材：濃い読みを数件。spec §6-1 */
export function memoryHighlights(agreedFrags: any[], n = 4): string[] {
  return [...agreedFrags].sort((a, b) => (b.confidence - a.confidence)).slice(0, n).map(f => f.text);
}

export function relationSummary(rel: { total_sessions: number; total_turns: number; known_domains: string[]; input_mode_ratio: Record<string, number> }): string {
  const r = rel.input_mode_ratio || { tap: 0, choice_free: 0, free: 0 };
  const total = (r.tap + r.choice_free + r.free) || 1;
  const tapShare = Math.round((r.tap / total) * 100);
  return `セッション${rel.total_sessions}回・総ターン${rel.total_turns}・既知領域[${(rel.known_domains || []).join('/')}]・タップ比${tapShare}%`;
}
