import { llm } from './llm';
import { SYS_BASE, SYS_CONTENT } from './prompts';
import { SeedsSchema, FormatSchema, ContentSchema } from './schemas';
import type { ContentFormat, Granularity } from './types';

/** 同意済み fragment から候補(seed)を生成（Flash）。spec §5-1 */
export async function buildSeeds(agreed: { id: string; text: string; domain: string; type: string; reask?: any }[]) {
  return llm({
    purpose: 'seeds', model: 'flash', system: SYS_BASE,
    user: `同意済みの読み:\n${agreed.map(f => `- ${f.text}`).join('\n') || '(まだ無い)'}\nこれらからコンテンツ候補を最大3つ。`,
    schema: SeedsSchema, hints: { agreed },
  });
}

/** フォーマット選定（Flash）。spec §5-2 */
export async function selectFormat(frags: { type: string }[]): Promise<ContentFormat> {
  const out = await llm({
    purpose: 'format', model: 'flash', system: SYS_BASE,
    user: `素材の型: ${frags.map(f => f.type).join(',') || 'なし'}。最適なフォーマットを選べ（timeline/contrast/constellation/roughtext）。`,
    schema: FormatSchema, hints: { fragments: frags },
  });
  return out.format;
}

/** 本文生成（Pro）。3粒度＋payload。spec §5-2 */
export async function generateContentBody(args: {
  title: string; summary: string; format: ContentFormat; frags: any[];
}) {
  const events = args.frags.filter(f => f.type === 'event').map(f => ({ when: f.time_data?.when || '', label: f.time_data?.label || (f.text || '').slice(0, 12), body: f.text }));
  return llm({
    purpose: 'content', model: 'pro', system: SYS_CONTENT,
    user: `タイトル候補:「${args.title}」概要:「${args.summary}」フォーマット:${args.format}。本文を3粒度で。`,
    schema: ContentSchema, hints: { title: args.title, summary: args.summary, format: args.format, fragments: args.frags, events },
  });
}

export { type Granularity };
