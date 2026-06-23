import { Fragments, Seeds, Cards, Rel } from '../db/repo';
import { llm } from '../llm/provider';
import { SYS_BASE, SYS_CONTENT } from '../llm/prompts';
import { SeedsSchema, FormatSchema, ContentSchema } from '../llm/schemas';
import { TUNING } from '../config';
import { httpErr } from './orchestrator';
import type { Granularity, Layer, ContentFormat } from '../types';

const GRAN_CONF: Record<Granularity, number> = { detailed: 0.75, normal: 0.6, vague: 0.4 };

/** 同意済み fragment から候補(seed)を生成（Flash）。spec §5-1 */
export async function buildCandidates(uid: string) {
  const agreed = Fragments.byUser(uid, ['agreed', 'corrected']);
  const hint = agreed.map(f => ({ id: f.id, text: f.text, domain: f.domain, type: f.type, reask: f.reask }));
  const out = await llm({
    purpose: 'seeds', model: 'flash', system: SYS_BASE,
    user: `同意済みの読み:\n${agreed.map(f => `- ${f.text}`).join('\n') || '(まだ無い)'}\nこれらからコンテンツ候補を最大3つ。`,
    schema: SeedsSchema, hints: { agreed: hint },
  });
  return Seeds.replaceCandidates(uid, out.seeds.map(s => ({
    source_fragment_ids: s.sourceFragmentIds, domain: s.domain,
    suggested_format: s.suggestedFormat as ContentFormat, title: s.title, summary: s.summary,
  })));
}

/** 候補からコンテンツを生成：フォーマット選定(Flash)＋本文生成(Pro)。spec §5-2 */
export async function generateContent(uid: string, seedId: string, granularity: Granularity = 'normal') {
  const seed = Seeds.get(seedId);
  if (!seed) throw httpErr(404, 'seed not found');
  const frags = seed.source_fragment_ids.map(id => Fragments.get(id)).filter(Boolean) as any[];

  // 1. フォーマット選定（Flash）
  const fmtOut = await llm({
    purpose: 'format', model: 'flash', system: SYS_BASE,
    user: `素材の型: ${frags.map(f => f.type).join(',') || 'なし'}。最適なフォーマットを選べ。候補: timeline/contrast/constellation/roughtext。`,
    schema: FormatSchema, hints: { fragments: frags },
  });
  const format = (seed.suggested_format && seed.suggested_format !== 'roughtext' ? seed.suggested_format : fmtOut.format) as ContentFormat;

  // 2. 本文生成（Pro）
  const events = frags.filter(f => f.type === 'event').map(f => ({ when: f.time_data?.when || '', label: f.time_data?.label || f.text.slice(0, 12), body: f.text }));
  const content = await llm({
    purpose: 'content', model: 'pro', system: SYS_CONTENT,
    user: `タイトル候補:「${seed.title}」概要:「${seed.summary}」フォーマット:${format}。本文を3粒度で。`,
    schema: ContentSchema, hints: { title: seed.title, summary: seed.summary, format, fragments: frags, events },
  });

  return {
    seedId, format: content.format, title: content.title, payload: content.payload,
    body: content.bodies[granularity], bodies: content.bodies, conf: GRAN_CONF[granularity],
  };
}

/** 公開：content_card を確定（spec §5-4）。closeOnly→close レイヤー。 */
export function publish(uid: string, draft: {
  seedId?: string; format: ContentFormat; title: string; body: string; payload?: any;
  granularity?: Granularity; closeOnly?: boolean; isPremium?: boolean; cover?: string; images?: any;
}) {
  const layers: Layer[] = draft.closeOnly ? ['close'] : ['general'];
  const conf = GRAN_CONF[draft.granularity || 'normal'];
  const card = Cards.add({
    user_id: uid, seed_id: draft.seedId || null, format: draft.format, title: draft.title,
    body: draft.body, payload: draft.payload ?? null, conf, layers, is_premium: !!draft.isPremium,
    cover: draft.cover || null, images: draft.images || null,
  });
  if (draft.seedId) Seeds.setStatus(draft.seedId, 'published');
  return card;
}

/** プレミアム枠（週2）チェック。spec §5-3 */
export function checkPremiumQuota(uid: string): { ok: boolean; used: number; limit: number } {
  const rel = Rel.get(uid);
  const q = rel.premium_quota || { weekStartAt: new Date().toISOString(), used: 0 };
  const weekMs = 7 * 86400_000;
  if (Date.now() - Date.parse(q.weekStartAt) >= weekMs) { q.weekStartAt = new Date().toISOString(); q.used = 0; }
  const ok = q.used < TUNING.PREMIUM_PER_WEEK;
  return { ok, used: q.used, limit: TUNING.PREMIUM_PER_WEEK };
}

export function consumePremiumQuota(uid: string) {
  const rel = Rel.get(uid);
  const q = rel.premium_quota || { weekStartAt: new Date().toISOString(), used: 0 };
  q.used += 1; rel.premium_quota = q; Rel.save(rel);
}
