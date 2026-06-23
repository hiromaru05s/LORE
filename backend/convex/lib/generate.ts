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
  intensity?: string;       // 言い当ての攻め強度（gentle|bold）
  avoidTopics?: string[];   // 境界でNG設定されたテーマ（踏み込まない）
  tone?: string;            // 口調（friendly|polite）
  depth?: string;           // 返しの深さ（light|deep）
  boundaryTopic?: string;   // ask_boundary で許可を取りに行くテーマ
}

/** 境界質問の固定二択（LLMに作らせず routing を保証）。FEはlabelをそのまま送る→BEがpendingBoundaryで解釈。 */
export const BOUNDARY_CHOICES = [
  { label: 'うん、大丈夫', value: 'ok' },
  { label: 'そこは避けたい', value: 'ng' },
];

const avoidLine = (topics?: string[]) => (topics && topics.length) ? `\n次のテーマには踏み込まない（相手がNGと設定）: ${topics.join(' / ')}。` : '';
const styleLine = (tone?: string, depth?: string) => {
  const t = tone === 'polite' ? '口調はていねい目で。' : tone === 'friendly' ? '口調はフランク・タメ口寄りで。' : '';
  const d = depth === 'deep' ? '一歩踏み込んで、じっくり掘る。' : depth === 'light' ? 'あっさり軽め・短めに。深掘りしすぎない。' : '';
  return (t || d) ? `\n${t}${d}` : '';
};

/** 非strikeの手を Flash で生成。 */
export async function generateTurn(g: GenInput): Promise<any> {
  const user = buildContext({
    relation: g.relation, recentTurns: g.recentTurns, memory: g.memory, lastAnswer: g.lastAnswer,
    reaskText: g.move === 'reask' ? g.reaskText : undefined,
    extra: `【今回の手: ${g.move}】${MOVE_INSTRUCTION[g.move] || ''}${avoidLine(g.avoidTopics)}${styleLine(g.tone, g.depth)}\nchoices は、相手が自然に会話を続けられる返答例を必ず2個。機械的な確認の二択（「いい感じ／微妙」みたいな）にしない。話の方向を本人が選べるものを文脈に合わせて（例：実はいいことあった／実は嫌なことあった／別の話したい／君が話題ふってよ／いつものことだよ／特にない、等）。自由入力もできるので、選択肢で全部カバーしようとしない。`,
  });
  return llm({ purpose: 'turn', model: 'flash', system: SYS_BASE, user, schema: TurnSchema, hints: { move: g.move, lastText: g.lastAnswer, inputMode: g.inputMode } });
}

/** 境界の許可取り(ask_boundary)を Flash で生成。message のみLLM、choices は固定二択で routing 保証。 */
export async function generateBoundaryAsk(g: GenInput): Promise<any> {
  const user = buildContext({
    relation: g.relation, recentTurns: g.recentTurns, lastAnswer: g.lastAnswer,
    extra: `【今回の手: ask_boundary】今回確認したいテーマ＝「${g.boundaryTopic || ''}」。${MOVE_INSTRUCTION.ask_boundary}${styleLine(g.tone, g.depth)}`,
  });
  const out = await llm({ purpose: 'turn', model: 'flash', system: SYS_BASE, user, schema: TurnSchema, hints: { move: 'ask_boundary', topic: g.boundaryTopic } });
  return { message: out.message, choices: BOUNDARY_CHOICES };
}

/** 言い当て(strike)を Pro で生成。 */
export async function generateStrike(g: GenInput): Promise<any> {
  const user = buildContext({
    relation: g.relation, recentTurns: g.recentTurns, fragments: g.fragments, memory: g.memory, lastAnswer: g.lastAnswer,
    extra: `対象領域: ${g.domain}。攻め強度=${g.intensity || 'gentle'}（gentle=「〜なんじゃない？」とやんわり仮説で／bold=断定気味にズバッと）。${avoidLine(g.avoidTopics)}${styleLine(g.tone, g.depth)}\nまだ本人に言っていない読みを一文で刺せ。`,
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
