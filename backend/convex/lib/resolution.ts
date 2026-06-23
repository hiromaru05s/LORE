// resolution を信念ストアのデータから導出（spec §3-6）。純粋関数。
// ⚠️ 数値はUIに出さない。肖像canvasの鮮明さだけを駆動する。

export function computeResolution(
  agreedFragments: { confidence: number }[],
  struckDomains: string[],
): number {
  const confSum = agreedFragments.reduce((a, f) => a + (f.confidence || 0), 0);
  const accum = 1 - Math.exp(-confSum / 4);
  const coverage = Math.min(1, new Set(struckDomains).size / 5);
  const r = 0.12 + 0.6 * accum + 0.2 * coverage;
  return Math.max(0, Math.min(1, r));
}
