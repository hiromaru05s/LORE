import { Turns, Sessions, Fragments, Contours, Rel } from '../db/repo';
import type { InputMode, TurnResponse, Move } from '../types';
import { scoreAnswer, isSubstantive } from './scoring';
import { ingestAnswer, saveStrike, applyReaction, applyMiss } from './beliefStore';
import { decideMove } from './controller';
import { generateTurn, generateStrike, generateRestrike } from './generate';
import { computeResolution } from './resolution';
import {
  getReaskDue, getMemoryHighlights, getRelationSummary, recordInputMode,
} from './relationship';

/** セッション開始（onboarding | home）。最初の AI ターンを返す。 */
export async function startSession(uid: string, mode: 'onboarding' | 'home'): Promise<{ sessionId: string } & TurnResponse> {
  const sess = Sessions.create(uid, mode);
  const rel = Rel.get(uid); rel.total_sessions += 1; Rel.save(rel);

  const turn = await generateTurn({
    move: 'open', inputMode: 'choice_free', recentTurns: [], lastAnswer: '',
    fragments: [], relation: getRelationSummary(uid), memory: getMemoryHighlights(uid),
    struck: 0, domain: '日常',
  });
  Turns.add({ user_id: uid, session_id: sess.id, role: 'ai', type: 'question', text: turn.message, input_mode: 'choice_free' });
  Sessions.update(sess.id, { last_move: 'open', turn_count: 1 });

  return {
    sessionId: sess.id, move: 'open', inputMode: 'choice_free',
    message: turn.message, choices: turn.choices as any, resolution: computeResolution(uid),
  };
}

/** ユーザー発話を受けて次の AI ターンを返す（メインループ。spec §3-1）。 */
export async function handleTurn(uid: string, sessionId: string, body: { text: string; inputMode?: InputMode }): Promise<TurnResponse> {
  const sess = Sessions.get(sessionId);
  if (!sess) throw httpErr(404, 'session not found');
  const text = (body.text || '').trim();
  if (!text) throw httpErr(400, 'empty text');

  // 1. ユーザー発話を保存
  const userTurn = Turns.add({ user_id: uid, session_id: sessionId, role: 'user', type: 'answer', text, input_mode: body.inputMode || 'choice_free' });
  recordInputMode(uid, body.inputMode || 'choice_free');

  // 2. 採点
  const score = await scoreAnswer(text);

  // 3. 内面モデルへ取り込み（contour に素材）
  const { contourId, domain } = ingestAnswer(uid, userTurn.id, score);
  const domainRepeat = domain === sess.last_domain ? (sess.domain_repeat + 1) : 0;

  // 4. コントローラ
  const reaskDue = getReaskDue(uid);
  const contour = Contours.forDomain(uid, domain);
  const { move, inputMode } = decideMove({
    session: { ...sess, domain_repeat: domainRepeat },
    lastScore: score.scores,
    contourMaterial: contour.material,
    reaskDueCount: reaskDue.length,
    totalTurns: Rel.get(uid).total_turns,
  });

  // 5. 生成して返す
  return produceAITurn(uid, sessionId, move, inputMode, {
    lastAnswer: text, domain, contourId, evidenceTurnId: userTurn.id,
    reaskFrag: move === 'reask' ? reaskDue[0] : null, domainRepeat,
  });
}

/** AIターンの生成・保存・状態更新・返却（handleTurn と react継続で共有）。 */
async function produceAITurn(uid: string, sessionId: string, move: Move, inputMode: InputMode, o: {
  lastAnswer: string; domain: string; contourId: string; evidenceTurnId: string | null;
  reaskFrag: any; domainRepeat: number;
}): Promise<TurnResponse> {
  const sess = Sessions.get(sessionId);
  const recent = Turns.recent(sessionId).map(t => ({ role: t.role, text: t.text }));
  const relevantFrags = Fragments.byDomain(uid, o.domain).slice(0, 5)
    .map(f => ({ text: f.text, confidence: f.confidence, status: f.status }));
  const gin = {
    move, inputMode, recentTurns: recent, lastAnswer: o.lastAnswer, fragments: relevantFrags,
    relation: getRelationSummary(uid), memory: getMemoryHighlights(uid),
    reaskText: o.reaskFrag?.text, struck: Contours.forDomain(uid, o.domain).struck, domain: o.domain,
  };

  let res: TurnResponse;

  if (move === 'strike') {
    const s = await generateStrike(gin);
    const frag = saveStrike(uid, s, o.evidenceTurnId ? [o.evidenceTurnId] : [], o.contourId);
    Turns.add({ user_id: uid, session_id: sessionId, role: 'ai', type: 'strike', text: s.message, refs: { fragmentId: frag.id } });
    Sessions.update(sessionId, {
      last_move: 'strike', last_domain: o.domain, domain_repeat: o.domainRepeat,
      turns_since_strike: 0, pending_fragment: frag.id, turn_count: sess.turn_count + 1,
    });
    res = {
      move, inputMode: 'tap', message: s.message,
      strike: { fragmentId: frag.id, components: s.components as any, confidence: s.confidence },
      missCandidates: s.missCandidates as any, resolution: computeResolution(uid),
    };
  } else {
    if (move === 'reask' && o.reaskFrag) {
      const r = o.reaskFrag.reask || { version: 1, history: [], lastAskedAt: null, nextEligibleAt: null };
      Fragments.update(o.reaskFrag.id, { reask: { ...r, lastAskedAt: new Date().toISOString() } });
    }
    const turn = await generateTurn(gin);
    Turns.add({ user_id: uid, session_id: sessionId, role: 'ai', type: move === 'reflect' ? 'reflection' : 'question', text: turn.message, input_mode: inputMode });
    Sessions.update(sessionId, {
      last_move: move, last_domain: o.domain, domain_repeat: o.domainRepeat,
      turns_since_strike: sess.turns_since_strike + 1, turn_count: sess.turn_count + 1,
    });
    res = { move, inputMode, message: turn.message, choices: (inputMode === 'free' ? [] : turn.choices) as any, resolution: computeResolution(uid) };
  }
  return res;
}

/** 反応（そうかも/わからない/違う）。記録し、次のAIターンを返す（spec 4-D）。 */
export async function react(uid: string, sessionId: string, fragmentId: string, kind: 'agree' | 'unsure' | 'disagree'): Promise<any> {
  const frag = Fragments.get(fragmentId);
  if (!frag) throw httpErr(404, 'fragment not found');
  Turns.add({ user_id: uid, session_id: sessionId, role: 'user', type: 'reaction', text: kind, refs: { fragmentId } });
  applyReaction(fragmentId, kind);
  Sessions.update(sessionId, { pending_fragment: null });

  // 違う → ハズレ型UIへ（FEが strike時に受け取った missCandidates を表示）。会話は /miss で継続。
  if (kind === 'disagree') {
    return { recorded: true, needMiss: true, fragmentId, resolution: computeResolution(uid) };
  }

  // onboarding 完了判定（agreed が2件たまったら firstlore へ）
  const sess = Sessions.get(sessionId);
  const agreedCount = Fragments.byUser(uid, ['agreed', 'corrected']).length;
  if (sess.mode === 'onboarding' && agreedCount >= 2) {
    Sessions.update(sessionId, { last_move: 'close' });
    return { recorded: true, done: true, resolution: computeResolution(uid) };
  }

  // 継続：新しい問いを返す（pace により strike は出ない）
  const next = await continueAfterReaction(uid, sessionId, frag.domain);
  return { recorded: true, next, resolution: computeResolution(uid) };
}

async function continueAfterReaction(uid: string, sessionId: string, domain: string): Promise<TurnResponse> {
  const sess = Sessions.get(sessionId);
  const reaskDue = getReaskDue(uid);
  let move: Move = 'pivot';
  let inputMode: InputMode = 'choice_free';
  if (reaskDue.length > 0) { move = 'reask'; inputMode = 'free'; }
  else if (sess.turn_count >= 10) { move = 'close'; }
  return produceAITurn(uid, sessionId, move, inputMode, {
    lastAnswer: '', domain, contourId: Contours.forDomain(uid, domain).id, evidenceTurnId: null,
    reaskFrag: reaskDue[0] || null, domainRepeat: 0,
  });
}

/** ハズレ型の選択を受け、信念を更新して当て直す（spec §3-5 / engine_design §1-3）。 */
export async function miss(uid: string, sessionId: string, fragmentId: string, type: any, detail?: string): Promise<any> {
  const frag = Fragments.get(fragmentId);
  if (!frag) throw httpErr(404, 'fragment not found');
  Turns.add({ user_id: uid, session_id: sessionId, role: 'user', type: 'miss', text: detail || type, refs: { fragmentId, missType: type } });
  applyMiss(fragmentId, type, detail);

  // reason は「何」を保持して「なぜ」を問う（再strikeしない）
  if (type === 'reason') {
    const turn = await generateTurn({
      move: 'dig', inputMode: 'free', recentTurns: Turns.recent(sessionId).map(t => ({ role: t.role, text: t.text })),
      lastAnswer: detail || '', fragments: [], relation: getRelationSummary(uid), memory: getMemoryHighlights(uid),
      struck: 0, domain: frag.domain,
    });
    Turns.add({ user_id: uid, session_id: sessionId, role: 'ai', type: 'question', text: turn.message, input_mode: 'free' });
    return { next: { move: 'dig', inputMode: 'free', message: turn.message, choices: [], resolution: computeResolution(uid) } };
  }

  // whole は別領域へ pivot
  if (type === 'whole') {
    const next = await produceAITurn(uid, sessionId, 'pivot', 'choice_free', {
      lastAnswer: '', domain: frag.domain, contourId: frag.contour_id || Contours.forDomain(uid, frag.domain).id,
      evidenceTurnId: null, reaskFrag: null, domainRepeat: 99,
    });
    return { next };
  }

  // それ以外は再strike（Pro）
  const rs = await generateRestrike({
    missType: type, detail, fragmentText: frag.text, domain: frag.domain,
    recentTurns: Turns.recent(sessionId).map(t => ({ role: t.role, text: t.text })),
  });
  const newFrag = saveStrike(uid, rs, frag.evidence, frag.contour_id || Contours.forDomain(uid, frag.domain).id);
  Turns.add({ user_id: uid, session_id: sessionId, role: 'ai', type: 'strike', text: rs.message, refs: { fragmentId: newFrag.id } });
  Sessions.update(sessionId, { pending_fragment: newFrag.id });
  return {
    next: {
      move: 'strike', inputMode: 'tap', message: rs.message,
      strike: { fragmentId: newFrag.id, components: rs.components, confidence: rs.confidence },
      missCandidates: rs.missCandidates, resolution: computeResolution(uid),
    },
  };
}

/** nudge（TAP TO RESOLVE）：未提示の agreed を1件開示。spec §3-7 */
export function nudge(uid: string): { read: string | null; resolution: number } {
  const agreed = Fragments.byUser(uid, ['agreed', 'corrected']);
  const read = agreed.length ? agreed[Math.floor(Math.random() * agreed.length)].text : null;
  return { read, resolution: computeResolution(uid) };
}

export function httpErr(status: number, msg: string) {
  const e: any = new Error(msg); e.status = status; return e;
}
