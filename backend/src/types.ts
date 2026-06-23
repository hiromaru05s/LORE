// LORE データモデル（lore_engine_design.md §1 / lore_implementation_spec.md §2）

export type Role = 'ai' | 'user';
export type TurnType =
  | 'question' | 'answer' | 'strike' | 'reaction' | 'miss' | 'reflection' | 'system';
export type InputMode = 'tap' | 'choice_free' | 'free';

export type Move = 'dig' | 'pivot' | 'strike' | 'reflect' | 'reask' | 'close' | 'open';

export type FragmentType =
  | 'trait' | 'event' | 'preference' | 'value' | 'relation' | 'pattern';
export type Valence = 'pos' | 'neg' | 'neu';
export type FragmentStatus =
  | 'proposed' | 'agreed' | 'unsure' | 'corrected' | 'retired';

export type MissType =
  | 'opposite' | 'degree' | 'object' | 'reason' | 'partial' | 'whole' | 'custom';

export type ContentFormat = 'timeline' | 'contrast' | 'constellation' | 'roughtext';
export type Granularity = 'detailed' | 'normal' | 'vague';
export type Layer = 'general' | 'close';

export interface Scores {
  specificity: number;     // 0-3
  emotionalDepth: number;  // 0-3
  selfInsight: number;     // 0-3
}

export interface Components {
  subject: string;
  claim: string;
  qualifier?: string;
  valence: Valence;
}

export interface Turn {
  id: string;
  user_id: string;
  session_id: string;
  role: Role;
  type: TurnType;
  text: string;
  input_mode: InputMode | null;
  refs: any;
  created_at: string;
}

export interface Fragment {
  id: string;
  user_id: string;
  text: string;
  type: FragmentType;
  domain: string;
  components: Components;
  confidence: number;
  status: FragmentStatus;
  evidence: string[];
  reactions: { type: string; at: string }[];
  scores: Scores | null;
  time_data: { when: string; label: string } | null;
  contour_id: string | null;
  recency: { lastConfirmedAt: string | null; halfLifeDays: number } | null;
  reask: {
    lastAskedAt: string | null;
    nextEligibleAt: string | null;
    version: number;
    history: { text: string; confidence: number; at: string }[];
  } | null;
  created_at: string;
  updated_at: string;
}

export interface Contour {
  id: string;
  user_id: string;
  label: string;
  domain: string;
  material: number;  // strike 判断を駆動する素材蓄積（採点の和）
  struck: number;    // この contour で撃った回数
  gaps: string[];
  updated_at: string;
}

export interface ContentSeed {
  id: string;
  user_id: string;
  source_fragment_ids: string[];
  domain: string;
  suggested_format: ContentFormat;
  title: string;
  summary: string;
  status: 'candidate' | 'deleted' | 'published';
}

export interface ContentCard {
  id: string;
  user_id: string;
  seed_id: string | null;
  format: ContentFormat;
  title: string;
  body: string;
  payload: any;
  conf: number;
  layers: Layer[];
  is_premium: boolean;
  cover: string | null;
  images: any;
  pinned: boolean;
  created_at: string;
}

export interface ShareLink {
  token: string;
  user_id: string;
  scope: 'profile' | 'content';
  content_id: string | null;
  layer: Layer;
  revoked: boolean;
  created_at: string;
}

export interface RelationshipState {
  user_id: string;
  total_sessions: number;
  total_turns: number;
  known_domains: string[];
  input_mode_ratio: Record<InputMode, number>;
  premium_quota: { weekStartAt: string; used: number };
  memory_highlights: string[];
  reask_due: string[];
}

/** 1ターン分の AI 応答（FE に返す形）。 */
export interface TurnResponse {
  move: Move;
  inputMode: InputMode;
  message: string;
  choices?: { label: string; value: string }[];
  strike?: {
    fragmentId: string;
    components: Components;
    confidence: number;
  };
  missCandidates?: { label: string; value: MissType }[];
  resolution: number;
  done?: boolean;   // onboarding 完了など
}
