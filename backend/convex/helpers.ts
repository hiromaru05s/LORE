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

/** 会話中にAIが「踏み込んでいい？」と1つずつ聞いていく境界テーマ（FEチップと同一）。 */
export const BOUNDARY_TOPICS = ['恋愛', '家族', '仕事', 'お金', '過去', 'コンプレックス'];

/** 初回インテークの自己申告を、会話で使える「既知の前提」行に変換（＝聞き直さない/当てない対象）。 */
export function intakeMemoryLines(intake: any): string[] {
  if (!intake || typeof intake !== 'object') return [];
  const L = (label: string, v: any) => (v && v !== '答えたくない' && v !== '答えない') ? `（本人申告・既知）${label}: ${Array.isArray(v) ? v.join('・') : v}` : '';
  const lines = [
    L('性別', intake.gender),
    typeof intake.age === 'number' ? `（本人申告・既知）年齢: ${intake.age}歳前後` : '',
    L('内向的になる場面', intake.introvert),
    L('外向的になれる場面', intake.extrovert),
    L('充電のしかた', intake.energy),
    L('決め方', intake.decision),
    L('休日の過ごし方', intake.weekend),
    L('悩みの抱え方', intake.worry),
    L('新しいことへの姿勢', intake.novelty),
    L('生活のペース', intake.pace),
    L('今いちばん大事にしたいもの', intake.value),
  ].filter(Boolean);
  return lines.length ? ['※ これらは本人が最初に自己申告した前提。聞き直さず、当てる対象にもしない。会話の土台として自然に踏まえる:', ...lines] : [];
}

/** 受信ダイヤル(preferences)を既定値付きで読む。 */
export async function prefsFor(ctx: any, uid: any) {
  const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q: any) => q.eq('userId', uid)).unique();
  const p = (rel && rel.preferences) || {};
  const ng: string[] = Array.isArray(p.boundariesNg) ? p.boundariesNg : [];
  const asked: string[] = Array.isArray(p.boundariesAsked) ? p.boundariesAsked : [];
  // 既に聞いた or 手動でNG設定済み のテーマは再質問しない。残りが聞く対象。
  const known = new Set<string>([...ng, ...asked]);
  const remaining = BOUNDARY_TOPICS.filter((t) => !known.has(t));
  return {
    strikeIntensity: p.strikeIntensity || 'gentle',
    boundariesNg: ng,
    boundariesAsked: asked,
    boundaryRemaining: remaining,
    tone: p.tone || null,
    depth: p.depth || null,
    intro: p.intro || {},
  };
}
