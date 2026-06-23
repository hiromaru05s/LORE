// LORE 共有型（Convex非依存・純粋）。DBの行IDは Convex の _id を使うので、ここでは論理型のみ。

export type Role = 'ai' | 'user';
export type TurnType = 'question' | 'answer' | 'strike' | 'reaction' | 'miss' | 'reflection' | 'system';
export type InputMode = 'tap' | 'choice_free' | 'free';
export type Move = 'dig' | 'pivot' | 'strike' | 'reflect' | 'reask' | 'close' | 'open';
export type FragmentType = 'trait' | 'event' | 'preference' | 'value' | 'relation' | 'pattern';
export type Valence = 'pos' | 'neg' | 'neu';
export type FragmentStatus = 'proposed' | 'agreed' | 'unsure' | 'corrected' | 'retired';
export type MissType = 'opposite' | 'degree' | 'object' | 'reason' | 'partial' | 'whole' | 'custom';
export type ContentFormat = 'timeline' | 'contrast' | 'constellation' | 'roughtext';
export type Granularity = 'detailed' | 'normal' | 'vague';
export type Layer = 'general' | 'close';

export interface Scores { specificity: number; emotionalDepth: number; selfInsight: number; }
export interface Components { subject: string; claim: string; qualifier?: string; valence: Valence; }

/** decideMove に渡す状態（DBから組み立てて渡す。lib自体はDBを知らない）。 */
export interface ControllerCtx {
  lastMove: Move | string;
  lastScore: Scores | null;
  contourMaterial: number;
  reaskDueCount: number;
  turnsSinceStrike: number;
  domainRepeat: number;
  turnCount: number;
}

/** FE に返す1ターン分の AI 応答。 */
export interface TurnResponse {
  move: Move;
  inputMode: InputMode;
  message: string;
  choices?: { label: string; value: string }[];
  strike?: { fragmentId: string; components: Components; confidence: number };
  missCandidates?: { label: string; value: MissType }[];
  resolution: number;
  done?: boolean;
}
