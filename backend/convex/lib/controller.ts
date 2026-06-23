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
  else if (ctx.domainRepeat >= TUNING.DOMAIN_REPEAT_MAX) move = 'pivot';
  else if (thin && ctx.lastMove !== 'dig') move = 'dig';
  else move = 'pivot';

  return { move, inputMode: pickInputMode(move, { highInsight, strongEmotion }) };
}

/** ① 浅い収集・反応は tap、核心は free（あえて選択肢を出さない）。 */
function pickInputMode(move: Move, f: { highInsight: boolean; strongEmotion: boolean }): InputMode {
  switch (move) {
    case 'strike': return 'tap';
    case 'reflect': return 'free';
    case 'reask': return 'free';
    case 'dig': return (f.highInsight || f.strongEmotion) ? 'free' : 'choice_free';
    default: return 'choice_free';
  }
}
