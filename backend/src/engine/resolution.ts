import { Fragments, Contours } from '../db/repo';

/**
 * resolution を信念ストアから導出（spec §3-6）。
 * 固定式（react +0.05）ではなく、同意済み読みの蓄積＋領域の広がりから計算。
 * ⚠️ 数値はUIに出さない。肖像canvasの鮮明さだけを駆動する。
 */
export function computeResolution(uid: string): number {
  const agreed = Fragments.byUser(uid, ['agreed', 'corrected']);
  const confSum = agreed.reduce((a, f) => a + (f.confidence || 0), 0);
  // 飽和：confSum=6 で約0.6寄与
  const accum = 1 - Math.exp(-confSum / 4);

  const contours = Contours.byUser(uid);
  const domains = new Set(contours.filter(c => c.struck > 0).map(c => c.domain));
  const coverage = Math.min(1, domains.size / 5);

  const r = 0.12 + 0.6 * accum + 0.2 * coverage;
  return Math.max(0, Math.min(1, r));
}
