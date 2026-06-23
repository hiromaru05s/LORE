import { TUNING } from './tuning';
import type { Move, InputMode, ControllerCtx } from './types';

/**
 * 毎ターン「手」と「入力モード」を選ぶ（spec §3-2 / §3-3）。純粋関数。
 * スクリプト分岐を増やさず、有限の手から状態で1つ選ぶ。
 */
export function decideMove(ctx: ControllerCtx): { move: Move; inputMode: InputMode } {
  const sc = ctx.lastScore;
  const thin = sc ? (sc.specificity <= 1 || sc.emotionalDepth <= 1) : true;
  const strongEmotion = sc ? sc.emotionalDepth >= 3 : false;
  const highInsight = sc ? sc.selfInsight >= 2 : false;

  let move: Move;
  if (ctx.reaskDueCount > 0 && ctx.lastMove !== 'reask' && ctx.turnsSinceStrike >= 1) move = 'reask';
  else if (strongEmotion && ctx.lastMove !== 'reflect') move = 'reflect';
  else if (ctx.turnCount >= TUNING.MIN_TURNS_BEFORE_STRIKE && ctx.contourMaterial >= TUNING.STRIKE_THRESHOLD && ctx.turnsSinceStrike >= TUNING.STRIKE_PACE_TURNS) move = 'strike';
  else if (ctx.turnCount >= TUNING.SESSION_CLOSE_TURNS && ctx.lastMove === 'strike') move = 'close';
  else if (ctx.domainRepeat >= TUNING.DOMAIN_REPEAT_MAX) move = 'pivot';   // 同じ話題が続きすぎた時だけ転換
  else move = 'dig';   // 基本は相手の話を深掘り（具体的な話に乗る。話題を勝手に変えない）

  return { move, inputMode: pickInputMode(move) };
}

/** 反応は tap、それ以外の質問は常にチップ付き(choice_free)。自由入力も併用できる。 */
function pickInputMode(move: Move): InputMode {
  return move === 'strike' ? 'tap' : 'choice_free';
}
