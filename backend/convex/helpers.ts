// Convexサーバー側の共通ヘルパ（ctx.db を読む）。lib(純粋)を使ってDB→値に変換する。
import { computeResolution } from './lib/resolution';
import { memoryHighlights, relationSummary, reaskDue } from './lib/relationship';

export async function agreedAndCorrected(ctx: any, uid: any) {
  const a = await ctx.db.query('fragments').withIndex('by_user_status', (q: any) => q.eq('userId', uid).eq('status', 'agreed')).collect();
  const c = await ctx.db.query('fragments').withIndex('by_user_status', (q: any) => q.eq('userId', uid).eq('status', 'corrected')).collect();
  return [...a, ...c];
}

export async function resolutionForUser(ctx: any, uid: any): Promise<number> {
  const frags = await agreedAndCorrected(ctx, uid);
  const contours = await ctx.db.query('contours').withIndex('by_user_domain', (q: any) => q.eq('userId', uid)).collect();
  return computeResolution(frags.map((f: any) => ({ confidence: f.confidence })), contours.filter((c: any) => c.struck > 0).map((c: any) => c.domain));
}

export async function relationFor(ctx: any, uid: any): Promise<string> {
  const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q: any) => q.eq('userId', uid)).unique();
  return rel ? relationSummary(rel) : 'セッション0回・総ターン0・既知領域[]・タップ比0%';
}

export async function memoryFor(ctx: any, uid: any): Promise<string[]> {
  return memoryHighlights(await agreedAndCorrected(ctx, uid));
}

export async function reaskDueFor(ctx: any, uid: any): Promise<any[]> {
  return reaskDue(await agreedAndCorrected(ctx, uid), Date.now());
}

export async function contourFor(ctx: any, uid: any, domain: string) {
  let c = await ctx.db.query('contours').withIndex('by_user_domain', (q: any) => q.eq('userId', uid).eq('domain', domain)).unique();
  return c;
}

/** 受信ダイヤル(preferences)を既定値付きで読む。 */
export async function prefsFor(ctx: any, uid: any) {
  const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q: any) => q.eq('userId', uid)).unique();
  const p = (rel && rel.preferences) || {};
  return {
    strikeIntensity: p.strikeIntensity || 'gentle',
    boundariesNg: Array.isArray(p.boundariesNg) ? p.boundariesNg : [],
    tone: p.tone || null,
    depth: p.depth || null,
    intro: p.intro || {},
  };
}
