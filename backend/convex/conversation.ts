import { v } from 'convex/values';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { api, internal } from './_generated/api';
import { decideMove } from './lib/controller';
import { scoreAnswer, materialWeight } from './lib/scoring';
import { generateTurn, generateStrike, generateRestrike, generateBoundaryAsk } from './lib/generate';
import { reactionPatch, missPatch, halfLifeFor } from './lib/belief';
import { capture, EV } from './lib/analytics';
import { relationFor, memoryFor, reaskDueFor, resolutionForUser, contourFor, prefsFor } from './helpers';
import { resolveUserId } from './users';

const nowIso = () => new Date().toISOString();

/** 残りの境界テーマから今回聞く1つを選ぶ。今の話題に関係するものを優先、なければ先頭。 */
function pickBoundaryTopic(remaining: string[], domain: string): string {
  return remaining.find((t) => domain && domain.includes(t)) || remaining[0];
}

// ───────────────────────── 内部: 読み込み ─────────────────────────
export const loadCtx = internalQuery({
  args: { uid: v.id('users'), sessionId: v.id('sessions'), domain: v.string() },
  handler: async (ctx, { uid, sessionId, domain }) => {
    const s = await ctx.db.get(sessionId);
    const contour = await contourFor(ctx, uid, domain);
    const due = await reaskDueFor(ctx, uid);
    const fragsDom = await ctx.db.query('fragments').withIndex('by_user_domain', (q) => q.eq('userId', uid).eq('domain', domain)).collect();
    const recentRows = await ctx.db.query('turns').withIndex('by_session', (q) => q.eq('sessionId', sessionId)).order('desc').take(8);
    return {
      lastMove: s!.lastMove, turnsSinceStrike: s!.turnsSinceStrike, turnCount: s!.turnCount, domainRepeat: s!.domainRepeat, mode: s!.mode,
      contourMaterial: contour?.material ?? 0, struck: contour?.struck ?? 0,
      reaskCount: due.length, reaskText: due[0]?.text ?? null,
      fragments: fragsDom.slice(0, 5).map((f) => ({ text: f.text, confidence: f.confidence, status: f.status })),
      recentTurns: recentRows.reverse().map((t) => ({ role: t.role, text: t.text })),
      relation: await relationFor(ctx, uid), memory: await memoryFor(ctx, uid),
      prefs: await prefsFor(ctx, uid),
      pendingBoundary: s!.pendingBoundary ?? null,
      turnsSinceBoundary: s!.turnCount - (s!.lastBoundaryTurn ?? -999),
    };
  },
});

// ───────────────────────── 内部: 書き込み ─────────────────────────
export const openSession = internalMutation({
  args: { uid: v.id('users'), mode: v.string() },
  handler: async (ctx, { uid, mode }) => {
    const sessionId = await ctx.db.insert('sessions', { userId: uid, mode, lastMove: 'open', lastDomain: '', domainRepeat: 0, turnsSinceStrike: 99, turnCount: 0 });
    const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q) => q.eq('userId', uid)).unique();
    if (rel) await ctx.db.patch(rel._id, { totalSessions: rel.totalSessions + 1 });
    return sessionId;
  },
});

export const recordAnswer = internalMutation({
  args: { uid: v.id('users'), sessionId: v.id('sessions'), text: v.string(), inputMode: v.string(), domain: v.string(), materialW: v.number() },
  handler: async (ctx, a) => {
    const turnId = await ctx.db.insert('turns', { userId: a.uid, sessionId: a.sessionId, role: 'user', type: 'answer', text: a.text, inputMode: a.inputMode });
    // rel 更新
    const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q) => q.eq('userId', a.uid)).unique();
    if (rel) {
      const ratio = { ...rel.inputModeRatio }; ratio[a.inputMode] = (ratio[a.inputMode] || 0) + 1;
      const known = rel.knownDomains.includes(a.domain) ? rel.knownDomains : [...rel.knownDomains, a.domain];
      await ctx.db.patch(rel._id, { totalTurns: rel.totalTurns + 1, inputModeRatio: ratio, knownDomains: known });
    }
    // contour 素材を積む
    let contour = await contourFor(ctx, a.uid, a.domain);
    if (!contour) {
      const cid = await ctx.db.insert('contours', { userId: a.uid, label: a.domain, domain: a.domain, material: a.materialW, struck: 0, gaps: [] });
      contour = await ctx.db.get(cid);
    } else {
      await ctx.db.patch(contour._id, { material: contour.material + a.materialW });
    }
    // session: domainRepeat 更新
    const s = await ctx.db.get(a.sessionId);
    const domainRepeat = a.domain === s!.lastDomain ? s!.domainRepeat + 1 : 0;
    await ctx.db.patch(a.sessionId, { lastDomain: a.domain, domainRepeat });
    return { turnId, contourId: contour!._id };
  },
});

export const saveAiTurn = internalMutation({
  args: { uid: v.id('users'), sessionId: v.id('sessions'), move: v.string(), inputMode: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert('turns', { userId: a.uid, sessionId: a.sessionId, role: 'ai', type: a.move === 'reflect' ? 'reflection' : 'question', text: a.text, inputMode: a.inputMode });
    const s = await ctx.db.get(a.sessionId);
    await ctx.db.patch(a.sessionId, { lastMove: a.move, turnCount: s!.turnCount + 1, turnsSinceStrike: s!.turnsSinceStrike + 1 });
    return await resolutionForUser(ctx, a.uid);
  },
});

// ask_boundary を保存し、session に「いま聞いてるテーマ」を刻む（次の発話＝その回答）。
export const saveBoundaryAsk = internalMutation({
  args: { uid: v.id('users'), sessionId: v.id('sessions'), topic: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert('turns', { userId: a.uid, sessionId: a.sessionId, role: 'ai', type: 'question', text: a.text, inputMode: 'tap', refs: { boundaryTopic: a.topic } });
    const s = await ctx.db.get(a.sessionId);
    await ctx.db.patch(a.sessionId, { lastMove: 'ask_boundary', turnCount: s!.turnCount + 1, turnsSinceStrike: s!.turnsSinceStrike + 1, pendingBoundary: a.topic, lastBoundaryTurn: s!.turnCount + 1 });
    return await resolutionForUser(ctx, a.uid);
  },
});

// 境界質問への回答を取り込む（採点せず preferences に保持）。pendingBoundary を消す。
export const consumeBoundaryAnswer = internalMutation({
  args: { uid: v.id('users'), sessionId: v.id('sessions'), text: v.string() },
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sessionId);
    const topic = s?.pendingBoundary;
    if (!topic) return { consumed: false as const };
    const ng = /避け|嫌|無理|やめ|ダメ|だめ|やだ|遠慮|NG/i.test(a.text);
    await ctx.db.insert('turns', { userId: a.uid, sessionId: a.sessionId, role: 'user', type: 'answer', text: a.text, inputMode: 'tap', refs: { boundaryTopic: topic, boundaryNg: ng } });
    const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q) => q.eq('userId', a.uid)).unique();
    if (rel) {
      const prefs: any = rel.preferences || {};
      const asked: string[] = Array.isArray(prefs.boundariesAsked) ? prefs.boundariesAsked : [];
      const ngList: string[] = Array.isArray(prefs.boundariesNg) ? prefs.boundariesNg : [];
      const nextAsked = asked.includes(topic) ? asked : [...asked, topic];
      const nextNg = ng && !ngList.includes(topic) ? [...ngList, topic] : ngList;
      await ctx.db.patch(rel._id, { preferences: { ...prefs, boundariesAsked: nextAsked, boundariesNg: nextNg } });
    }
    await ctx.db.patch(a.sessionId, { pendingBoundary: undefined });
    return { consumed: true as const, ng, topic };
  },
});

export const saveStrike = internalMutation({
  args: { uid: v.id('users'), sessionId: v.id('sessions'), strike: v.any(), domain: v.string(), evidenceTurnId: v.optional(v.string()), contourId: v.id('contours') },
  handler: async (ctx, a) => {
    const s = a.strike;
    const fragId = await ctx.db.insert('fragments', {
      userId: a.uid, text: s.message, type: s.type, domain: s.domain, components: s.components, confidence: s.confidence,
      status: 'proposed', evidence: a.evidenceTurnId ? [a.evidenceTurnId] : [], reactions: [], contourId: a.contourId,
      recency: { lastConfirmedAt: null, halfLifeDays: halfLifeFor(s.type) || 0 },
      reask: halfLifeFor(s.type) ? { lastAskedAt: null, nextEligibleAt: null, version: 1, history: [] } : undefined,
    });
    await ctx.db.insert('turns', { userId: a.uid, sessionId: a.sessionId, role: 'ai', type: 'strike', text: s.message, refs: { fragmentId: fragId } });
    const sess = await ctx.db.get(a.sessionId);
    await ctx.db.patch(a.sessionId, { lastMove: 'strike', turnsSinceStrike: 0, pendingFragment: fragId, turnCount: sess!.turnCount + 1 });
    return { fragmentId: fragId, resolution: await resolutionForUser(ctx, a.uid) };
  },
});

// ───────────────────────── public actions ─────────────────────────
export const startSession = action({
  args: { mode: v.optional(v.string()) },
  handler: async (ctx, { mode }): Promise<any> => {
    const uid = await ctx.runMutation(api.users.ensureUser, {});
    const m = mode === 'home' ? 'home' : 'onboarding';
    const sessionId = await ctx.runMutation(internal.conversation.openSession, { uid, mode: m });
    const relation = await ctx.runQuery(internal.conversation.loadCtx, { uid, sessionId, domain: '日常' });
    const turn = await generateTurn({ move: 'open', inputMode: 'choice_free', recentTurns: [], lastAnswer: '', fragments: [], relation: relation.relation, memory: relation.memory, struck: 0, domain: '日常' });
    const resolution = await ctx.runMutation(internal.conversation.saveAiTurn, { uid, sessionId, move: 'open', inputMode: 'choice_free', text: turn.message });
    return { sessionId, move: 'open', inputMode: 'choice_free', message: turn.message, choices: turn.choices, resolution };
  },
});

export const sendTurn = action({
  args: { sessionId: v.id('sessions'), text: v.string(), inputMode: v.optional(v.string()) },
  handler: async (ctx, a): Promise<any> => {
    const uid = await ctx.runMutation(api.users.ensureUser, {});
    const text = (a.text || '').trim();
    if (!text) throw new Error('empty text');
    const inputMode = a.inputMode || 'choice_free';

    // 直前が境界質問なら、この発話はその回答。採点せず preferences に取り込み、会話を続ける。
    const bd: any = await ctx.runMutation(internal.conversation.consumeBoundaryAnswer, { uid, sessionId: a.sessionId, text });
    if (bd.consumed) {
      const bcx = await ctx.runQuery(internal.conversation.loadCtx, { uid, sessionId: a.sessionId, domain: '日常' });
      const bgin = { move: 'dig' as const, inputMode: 'choice_free' as const, recentTurns: bcx.recentTurns, lastAnswer: '', fragments: bcx.fragments, relation: bcx.relation, memory: bcx.memory, struck: bcx.struck, domain: '日常', intensity: bcx.prefs.strikeIntensity, avoidTopics: bcx.prefs.boundariesNg, tone: bcx.prefs.tone, depth: bcx.prefs.depth };
      const bturn = await generateTurn(bgin);
      const resolution = await ctx.runMutation(internal.conversation.saveAiTurn, { uid, sessionId: a.sessionId, move: 'dig', inputMode: 'choice_free', text: bturn.message });
      return { move: 'dig', inputMode: 'choice_free', message: bturn.message, choices: bturn.choices, resolution };
    }

    const score = await scoreAnswer(text);
    const { turnId, contourId } = await ctx.runMutation(internal.conversation.recordAnswer, { uid, sessionId: a.sessionId, text, inputMode, domain: score.domain, materialW: materialWeight(score.scores) });
    const cx = await ctx.runQuery(internal.conversation.loadCtx, { uid, sessionId: a.sessionId, domain: score.domain });

    const { move, inputMode: outMode } = decideMove({
      lastMove: cx.lastMove, lastScore: score.scores, contourMaterial: cx.contourMaterial,
      reaskDueCount: cx.reaskCount, turnsSinceStrike: cx.turnsSinceStrike, domainRepeat: cx.domainRepeat, turnCount: cx.turnCount,
      boundaryRemaining: cx.prefs.boundaryRemaining.length, turnsSinceBoundary: cx.turnsSinceBoundary,
    });

    const gin = { move, inputMode: outMode, recentTurns: cx.recentTurns, lastAnswer: text, fragments: cx.fragments, relation: cx.relation, memory: cx.memory, reaskText: cx.reaskText || undefined, struck: cx.struck, domain: score.domain, intensity: cx.prefs.strikeIntensity, avoidTopics: cx.prefs.boundariesNg, tone: cx.prefs.tone, depth: cx.prefs.depth };

    if (move === 'ask_boundary') {
      const topic = pickBoundaryTopic(cx.prefs.boundaryRemaining, score.domain);
      const ba = await generateBoundaryAsk({ ...gin, move: 'ask_boundary', boundaryTopic: topic });
      const resolution = await ctx.runMutation(internal.conversation.saveBoundaryAsk, { uid, sessionId: a.sessionId, topic, text: ba.message });
      return { move: 'ask_boundary', inputMode: 'tap', message: ba.message, choices: ba.choices, resolution };
    }
    if (move === 'strike') {
      const s = await generateStrike(gin);
      const { fragmentId, resolution } = await ctx.runMutation(internal.conversation.saveStrike, { uid, sessionId: a.sessionId, strike: s, domain: score.domain, evidenceTurnId: turnId, contourId });
      await capture(EV.STRIKE_SHOWN, uid, { domain: score.domain });
      return { move, inputMode: 'tap', message: s.message, strike: { fragmentId, components: s.components, confidence: s.confidence }, missCandidates: s.missCandidates, resolution };
    }
    const turn = await generateTurn(gin);
    const resolution = await ctx.runMutation(internal.conversation.saveAiTurn, { uid, sessionId: a.sessionId, move, inputMode: outMode, text: turn.message });
    return { move, inputMode: outMode, message: turn.message, choices: outMode === 'free' ? [] : turn.choices, resolution };
  },
});

// 反応の適用（mutation）
export const applyReactionMut = internalMutation({
  args: { uid: v.id('users'), sessionId: v.id('sessions'), fragmentId: v.id('fragments'), kind: v.string() },
  handler: async (ctx, a) => {
    const frag = await ctx.db.get(a.fragmentId);
    if (!frag) throw new Error('fragment not found');
    await ctx.db.insert('turns', { userId: a.uid, sessionId: a.sessionId, role: 'user', type: 'reaction', text: a.kind, refs: { fragmentId: a.fragmentId } });
    const { patch, markStruck } = reactionPatch(frag, a.kind as any, nowIso());
    await ctx.db.patch(a.fragmentId, patch);
    if (markStruck && frag.contourId) { const c = await ctx.db.get(frag.contourId); if (c) await ctx.db.patch(frag.contourId, { struck: c.struck + 1, material: 0 }); }
    await ctx.db.patch(a.sessionId, { pendingFragment: undefined });
    const s = await ctx.db.get(a.sessionId);
    const agreed = await ctx.db.query('fragments').withIndex('by_user_status', (q) => q.eq('userId', a.uid).eq('status', 'agreed')).collect();
    const corrected = await ctx.db.query('fragments').withIndex('by_user_status', (q) => q.eq('userId', a.uid).eq('status', 'corrected')).collect();
    // 初めての agree で「miss歓迎」を一度だけ宣言する（ゾワッ先・宣言後）
    let showMissWelcome = false;
    if (a.kind === 'agree') {
      const rel = await ctx.db.query('relationshipState').withIndex('by_user', (q) => q.eq('userId', a.uid)).unique();
      const prefs = (rel?.preferences as any) || {};
      if (rel && !(prefs.intro && prefs.intro.missWelcomeShown)) {
        showMissWelcome = true;
        await ctx.db.patch(rel._id, { preferences: { ...prefs, intro: { ...(prefs.intro || {}), missWelcomeShown: true } } });
      }
    }
    return { status: (patch as any).status || frag.status, agreedCount: agreed.length + corrected.length, mode: s!.mode, domain: frag.domain, showMissWelcome, resolution: await resolutionForUser(ctx, a.uid) };
  },
});

export const react = action({
  args: { sessionId: v.id('sessions'), fragmentId: v.id('fragments'), kind: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const uid = await ctx.runMutation(api.users.ensureUser, {});
    const r = await ctx.runMutation(internal.conversation.applyReactionMut, { uid, sessionId: a.sessionId, fragmentId: a.fragmentId, kind: a.kind });
    await capture(EV.STRIKE_REACTION, uid, { kind: a.kind });
    if (a.kind === 'agree') await capture(EV.FRAGMENT_AGREED, uid, {});

    if (a.kind === 'disagree') return { recorded: true, needMiss: true, fragmentId: a.fragmentId, resolution: r.resolution };

    // 初agree後に一度だけ「miss歓迎」を宣言（外し回復を機能させ、寄り添い感を出す）
    if (r.showMissWelcome) {
      const msg = '君のことを知りたいから、僕からも色々聞くし「こうじゃない？」って言うこともある。違ったら、その都度教えてね。僕は君に、すごく興味があるんだ。';
      const resolution = await ctx.runMutation(internal.conversation.saveAiTurn, { uid, sessionId: a.sessionId, move: 'reflect', inputMode: 'choice_free', text: msg });
      return { recorded: true, next: { move: 'reflect', inputMode: 'choice_free', message: msg, choices: [{ label: 'うん', value: 'うん' }, { label: 'りょうかい', value: 'りょうかい' }], resolution } };
    }
    if (r.mode === 'onboarding' && r.agreedCount >= 2) { await capture(EV.ONBOARDING_DONE, uid, {}); return { recorded: true, done: true, resolution: r.resolution }; }

    // 継続：新しい問い（pace により strike は出ない）。常にチップ付き。
    const cx = await ctx.runQuery(internal.conversation.loadCtx, { uid, sessionId: a.sessionId, domain: r.domain });
    const move = cx.reaskCount > 0 ? 'reask' : (cx.turnCount >= 10 ? 'close' : 'pivot');
    const turn = await generateTurn({ move: move as any, inputMode: 'choice_free', recentTurns: cx.recentTurns, lastAnswer: '', fragments: cx.fragments, relation: cx.relation, memory: cx.memory, reaskText: cx.reaskText || undefined, struck: cx.struck, domain: r.domain, intensity: cx.prefs.strikeIntensity, avoidTopics: cx.prefs.boundariesNg, tone: cx.prefs.tone, depth: cx.prefs.depth });
    const resolution = await ctx.runMutation(internal.conversation.saveAiTurn, { uid, sessionId: a.sessionId, move, inputMode: 'choice_free', text: turn.message });
    return { recorded: true, next: { move, inputMode: 'choice_free', message: turn.message, choices: turn.choices, resolution } };
  },
});

// ハズレ型の適用（mutation）
export const applyMissMut = internalMutation({
  args: { uid: v.id('users'), sessionId: v.id('sessions'), fragmentId: v.id('fragments'), type: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const frag = await ctx.db.get(a.fragmentId);
    if (!frag) throw new Error('fragment not found');
    await ctx.db.insert('turns', { userId: a.uid, sessionId: a.sessionId, role: 'user', type: 'miss', text: a.detail || a.type, refs: { fragmentId: a.fragmentId, missType: a.type } });
    await ctx.db.insert('misses', { fragmentId: a.fragmentId, type: a.type, detail: a.detail });
    const { patch, followup } = missPatch(frag, a.type as any);
    await ctx.db.patch(a.fragmentId, patch);
    const recentRows = await ctx.db.query('turns').withIndex('by_session', (q) => q.eq('sessionId', a.sessionId)).order('desc').take(8);
    return { followup, fragmentText: frag.text, domain: frag.domain, contourId: frag.contourId, evidence: frag.evidence, recentTurns: recentRows.reverse().map((t) => ({ role: t.role, text: t.text })), relation: await relationFor(ctx, a.uid), memory: await memoryFor(ctx, a.uid) };
  },
});

export const miss = action({
  args: { sessionId: v.id('sessions'), fragmentId: v.id('fragments'), type: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, a): Promise<any> => {
    const uid = await ctx.runMutation(api.users.ensureUser, {});
    const m: any = await ctx.runMutation(internal.conversation.applyMissMut, { uid, sessionId: a.sessionId, fragmentId: a.fragmentId, type: a.type, detail: a.detail });

    if (m.followup === 'reason' || m.followup === 'whole') {
      const move = m.followup === 'reason' ? 'dig' : 'pivot';
      const inputMode = m.followup === 'reason' ? 'free' : 'choice_free';
      const turn = await generateTurn({ move: move as any, inputMode: inputMode as any, recentTurns: m.recentTurns, lastAnswer: a.detail || '', fragments: [], relation: m.relation, memory: m.memory, struck: 0, domain: m.domain });
      const resolution = await ctx.runMutation(internal.conversation.saveAiTurn, { uid, sessionId: a.sessionId, move, inputMode, text: turn.message });
      return { next: { move, inputMode, message: turn.message, choices: inputMode === 'free' ? [] : turn.choices, resolution } };
    }
    // restrike
    const rs = await generateRestrike({ missType: a.type, detail: a.detail, fragmentText: m.fragmentText, domain: m.domain, recentTurns: m.recentTurns });
    const contourId = m.contourId || (await ctx.runMutation(internal.conversation.recordAnswer, { uid, sessionId: a.sessionId, text: '(restrike)', inputMode: 'tap', domain: m.domain, materialW: 0 })).contourId;
    const { fragmentId, resolution } = await ctx.runMutation(internal.conversation.saveStrike, { uid, sessionId: a.sessionId, strike: rs, domain: m.domain, contourId });
    return { next: { move: 'strike', inputMode: 'tap', message: rs.message, strike: { fragmentId, components: rs.components, confidence: rs.confidence }, missCandidates: rs.missCandidates, resolution } };
  },
});

// nudge（TAP TO RESOLVE）：未提示の agreed を1件開示
export const nudge = query({
  args: {},
  handler: async (ctx) => {
    const uid = await resolveUserId(ctx);
    if (!uid) return { read: null, resolution: 0 };
    const agreed = await ctx.db.query('fragments').withIndex('by_user_status', (q) => q.eq('userId', uid).eq('status', 'agreed')).collect();
    const read = agreed.length ? agreed[Math.floor(Math.random() * agreed.length)].text : null;
    return { read, resolution: await resolutionForUser(ctx, uid) };
  },
});
