import { TUNING } from '../config';
import type { Move, InputMode, Scores } from '../types';

export interface ControllerContext {
  session: any;            // sessions row
  lastScore: Scores | null;
  contourMaterial: number; // 現 domain の素材蓄積
  reaskDueCount: number;
  totalTurns: number;
}

/**
 * 毎ターン「手」と「入力モード」を選ぶ（spec §3-2 / §3-3）。
 * スクリプト分岐を増やさず、有限の手から状態で1つ選ぶ。未対応会話は既定動作に吸収される。
 */
export function decideMove(ctx: ControllerContext): { move: Move; inputMode: InputMode } {
  const s = ctx.session;
  const sc = ctx.lastScore;
  const thin = sc ? (sc.specificity <= 1 || sc.emotionalDepth <= 1) : true;
  const strongEmotion = sc ? sc.emotionalDepth >= 3 : false;
  const highInsight = sc ? sc.selfInsight >= 2 : false;

  let move: Move;

  if (ctx.reaskDueCount > 0 && s.last_move !== 'reask' && s.turns_since_strike >= 1) {
    move = 'reask';
  } else if (strongEmotion && s.last_move !== 'reflect') {
    move = 'reflect';
  } else if (ctx.contourMaterial >= TUNING.STRIKE_THRESHOLD && s.turns_since_strike >= TUNING.STRIKE_PACE_TURNS) {
    move = 'strike';
  } else if (s.turn_count >= TUNING.SESSION_CLOSE_TURNS && s.last_move === 'strike') {
    move = 'close';
  } else if (s.domain_repeat >= TUNING.DOMAIN_REPEAT_MAX) {
    move = 'pivot';
  } else if (thin && s.last_move !== 'dig') {
    move = 'dig';
  } else {
    move = 'pivot';
  }

  return { move, inputMode: pickInputMode(move, { highInsight, strongEmotion }) };
}

/** ① 入力モード：浅い収集・反応は tap、核心は free（あえて選択肢を出さない）。 */
function pickInputMode(move: Move, f: { highInsight: boolean; strongEmotion: boolean }): InputMode {
  switch (move) {
    case 'strike': return 'tap';              // 3択リアクション
    case 'reflect': return 'free';            // 受け止め＝核心
    case 'reask': return 'free';              // 聞き直し＝深く考えさせる
    case 'dig': return (f.highInsight || f.strongEmotion) ? 'free' : 'choice_free';
    case 'open': return 'choice_free';
    case 'close': return 'choice_free';
    case 'pivot':
    default: return 'choice_free';
  }
}
