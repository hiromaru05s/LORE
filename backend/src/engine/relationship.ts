import { Fragments, Rel } from '../db/repo';
import type { Fragment } from '../types';

const REASKABLE = new Set(['value', 'preference', 'trait', 'pattern']);

/** 聞き直し対象（⑧）：変わりうる型で、半減期を過ぎた agreed/corrected。spec §6-2 */
export function getReaskDue(uid: string): Fragment[] {
  const frags = Fragments.byUser(uid, ['agreed', 'corrected']);
  const now = Date.now();
  return frags.filter(f => {
    if (!REASKABLE.has(f.type)) return false;
    const last = f.recency?.lastConfirmedAt ? Date.parse(f.recency.lastConfirmedAt) : null;
    const half = f.recency?.halfLifeDays || 0;
    if (!last || !half) return false;
    return now - last >= half * 86400_000;
  });
}

/** 「分かってる感」の素材（⑧）：最近 agreed の濃い読みを数件。spec §6-1 */
export function getMemoryHighlights(uid: string, n = 4): string[] {
  return Fragments.byUser(uid, ['agreed', 'corrected'])
    .sort((a, b) => (b.confidence - a.confidence))
    .slice(0, n)
    .map(f => f.text);
}

export function getRelationSummary(uid: string): string {
  const r = Rel.get(uid);
  const ratio = r.input_mode_ratio;
  const total = (ratio.tap + ratio.choice_free + ratio.free) || 1;
  const tapShare = Math.round((ratio.tap / total) * 100);
  return `セッション${r.total_sessions}回・総ターン${r.total_turns}・既知領域[${r.known_domains.join('/')}]・タップ比${tapShare}%`;
}

/** 入力モードの利用比率を更新（① 進行度の観測）。 */
export function recordInputMode(uid: string, mode: string) {
  const r = Rel.get(uid);
  (r.input_mode_ratio as any)[mode] = ((r.input_mode_ratio as any)[mode] || 0) + 1;
  r.total_turns += 1;
  Rel.save(r);
}
