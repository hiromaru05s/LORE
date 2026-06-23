import { llm } from './llm';
import { SYS_BASE, SYS_STRIKE, MOVE_INSTRUCTION, buildContext } from './prompts';
import { TurnSchema, StrikeSchema, type TurnOut, type StrikeOut } from './schemas';
import type { Move, InputMode } from './types';

export interface GenInput {
  move: Move;
  inputMode: InputMode;
  recentTurns: { role: string; text: string }[];
  lastAnswer: string;
  fragments: { text: string; confidence: number; status: string }[];
  relation: string;
  memory: string[];
  reaskText?: string;
  struck: number;
  domain: string;
}

/** 非strikeの手を Flash で生成。 */
export async function generateTurn(g: GenInput): Promise<any> {
  const user = buildContext({
    relation: g.relation, recentTurns: g.recentTurns, memory: g.memory, lastAnswer: g.lastAnswer,
    reaskText: g.move === 'reask' ? g.reaskText : undefined,
    extra: `【今回の手: ${g.move}】${MOVE_INSTRUCTION[g.move] || ''}\n相手がワンタップで答えられる短い返答例を choices に必ず2個入れる。`,
  });
  return llm({ purpose: 'turn', model: 'flash', system: SYS_BASE, user, schema: TurnSchema, hints: { move: g.move, lastText: g.lastAnswer, inputMode: g.inputMode } });
}

/** 言い当て(strike)を Pro で生成。 */
export async function generateStrike(g: GenInput): Promise<any> {
  const user = buildContext({
    relation: g.relation, recentTurns: g.recentTurns, fragments: g.fragments, memory: g.memory, lastAnswer: g.lastAnswer,
    extra: `対象領域: ${g.domain}。まだ本人に言っていない読みを一文で刺せ。`,
  });
  return llm({ purpose: 'strike', model: 'pro', system: SYS_STRIKE, user, schema: StrikeSchema, hints: { struck: g.struck, domain: g.domain, lastText: g.lastAnswer } });
}

/** ハズレ回復の再strike を Pro で生成。 */
export async function generateRestrike(args: { missType: string; detail?: string; fragmentText: string; domain: string; recentTurns: { role: string; text: string }[] }): Promise<any> {
  const user = buildContext({
    recentTurns: args.recentTurns,
    extra: `直前の読み「${args.fragmentText}」は外した。ハズレ型=${args.missType}${args.detail ? `／本人の言葉「${args.detail}」` : ''}。この差分を燃料に、もう一度当て直す一文を出せ。`,
  });
  return llm({ purpose: 'restrike', model: 'pro', system: SYS_STRIKE, user, schema: StrikeSchema, hints: { missType: args.missType, detail: args.detail, fragmentText: args.fragmentText, domain: args.domain } });
}
