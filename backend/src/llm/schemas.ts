import { z } from 'zod';

export const ScoreSchema = z.object({
  scores: z.object({
    specificity: z.number().min(0).max(3),
    emotionalDepth: z.number().min(0).max(3),
    selfInsight: z.number().min(0).max(3),
  }),
  domain: z.string().default('日常'),
  type: z.enum(['trait', 'event', 'preference', 'value', 'relation', 'pattern']).default('trait'),
});

export const TurnSchema = z.object({
  message: z.string(),
  choices: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
});

const Components = z.object({
  subject: z.string(),
  claim: z.string(),
  qualifier: z.string().optional().default(''),
  valence: z.enum(['pos', 'neg', 'neu']).default('neu'),
});

export const StrikeSchema = z.object({
  message: z.string(),
  components: Components,
  confidence: z.number().min(0).max(1).default(0.75),
  type: z.enum(['trait', 'event', 'preference', 'value', 'relation', 'pattern']).default('trait'),
  domain: z.string().default('日常'),
  missCandidates: z.array(z.object({
    label: z.string(),
    value: z.enum(['opposite', 'degree', 'object', 'reason', 'partial', 'whole']),
  })).default([]),
});

export const SeedsSchema = z.object({
  seeds: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    domain: z.string().default('日常'),
    suggestedFormat: z.enum(['timeline', 'contrast', 'constellation', 'roughtext']).default('roughtext'),
    sourceFragmentIds: z.array(z.string()).default([]),
  })),
});

export const FormatSchema = z.object({
  format: z.enum(['timeline', 'contrast', 'constellation', 'roughtext']),
  reason: z.string().default(''),
});

export const ContentSchema = z.object({
  title: z.string(),
  format: z.enum(['timeline', 'contrast', 'constellation', 'roughtext']),
  payload: z.any().nullable().default(null),
  bodies: z.object({
    detailed: z.string(),
    normal: z.string(),
    vague: z.string(),
  }),
});

export type ScoreOut = z.infer<typeof ScoreSchema>;
export type TurnOut = z.infer<typeof TurnSchema>;
export type StrikeOut = z.infer<typeof StrikeSchema>;
export type SeedsOut = z.infer<typeof SeedsSchema>;
export type FormatOut = z.infer<typeof FormatSchema>;
export type ContentOut = z.infer<typeof ContentSchema>;
