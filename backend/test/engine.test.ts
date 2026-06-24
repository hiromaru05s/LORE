// 純粋エンジン(convex/lib)を Convex無しで通しE2E検証する。
// これが「脳みそ」の検証であり、Convex action/mutation の配線図でもある。
// 実行: npm run test:engine   （DEEPSEEK_API_KEY 未設定なら mock で動く）
import 'dotenv/config';
import { scoreAnswer, materialWeight } from '../convex/lib/scoring';
import { decideMove } from '../convex/lib/controller';
import { generateTurn, generateStrike, generateRestrike, generateBoundaryAsk } from '../convex/lib/generate';
import { reactionPatch, missPatch, halfLifeFor } from '../convex/lib/belief';
import { computeResolution } from '../convex/lib/resolution';
import { buildSeeds, selectFormat, generateContentBody } from '../convex/lib/content';
import { memoryHighlights, reaskDue, relationSummary } from '../convex/lib/relationship';
import { shareToken } from '../convex/lib/ids';
import { isMockLLM } from '../convex/lib/tuning';

const now = () => new Date().toISOString();
const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(60));
let fail = 0;
const assert = (c: boolean, m: string) => { if (!c) { fail++; line(`  ✗ ASSERT FAILED: ${m}`); } };

// ── ごく小さなインメモリ store（Convexの ctx.db 相当の役） ──
const store = {
  fragments: [] as any[],
  contours: {} as Record<string, { material: number; struck: number }>,
  rel: { total_sessions: 1, total_turns: 0, known_domains: [] as string[], input_mode_ratio: { tap: 0, choice_free: 0, free: 0 } as Record<string, number> },
};
const contourOf = (d: string) => (store.contours[d] ||= { material: 0, struck: 0 });
const agreed = () => store.fragments.filter(f => ['agreed', 'corrected'].includes(f.status));
const struckDomains = () => Object.entries(store.contours).filter(([, c]) => c.struck > 0).map(([d]) => d);
const resolution = () => computeResolution(agreed().map(f => ({ confidence: f.confidence })), struckDomains());

let lastMove = 'open';
let turnsSinceStrike = 99;
let turnCount = 0;
let lastDomain = '';
let domainRepeat = 0;
let turnsSinceBoundary = 999;
const BOUNDARY_TOPICS = ['恋愛', '家族', '仕事', 'お金', '過去', 'コンプレックス'];
const boundaryAsked: string[] = [];
const recent: { role: string; text: string }[] = [];

async function userTurn(text: string) {
  line(`\nあなた: ${text}`);
  recent.push({ role: 'user', text });
  store.rel.total_turns++; store.rel.input_mode_ratio.choice_free++;

  const score = await scoreAnswer(text);
  if (!store.rel.known_domains.includes(score.domain)) store.rel.known_domains.push(score.domain);
  const c = contourOf(score.domain);
  c.material += materialWeight(score.scores);
  domainRepeat = score.domain === lastDomain ? domainRepeat + 1 : 0;
  lastDomain = score.domain;

  const due = reaskDue(agreed(), Date.now());
  const boundaryRemaining = BOUNDARY_TOPICS.filter(t => !boundaryAsked.includes(t)).length;
  const { move, inputMode } = decideMove({
    lastMove, lastScore: score.scores, contourMaterial: c.material,
    reaskDueCount: due.length, turnsSinceStrike, domainRepeat, turnCount,
    boundaryRemaining, turnsSinceBoundary,
  });

  return produceAI(move, inputMode, text, score.domain, due[0]);
}

async function produceAI(move: any, inputMode: any, lastAnswer: string, domain: string, reaskFrag: any) {
  const gin = {
    move, inputMode, recentTurns: recent.slice(-8), lastAnswer,
    fragments: store.fragments.filter(f => f.domain === domain).slice(0, 5).map(f => ({ text: f.text, confidence: f.confidence, status: f.status })),
    relation: relationSummary(store.rel), memory: memoryHighlights(agreed()),
    reaskText: reaskFrag?.text, struck: contourOf(domain).struck, domain,
  };
  turnCount++; turnsSinceBoundary++;
  if (move === 'ask_boundary') {
    const topic = BOUNDARY_TOPICS.filter(t => !boundaryAsked.includes(t))[0];
    const ba = await generateBoundaryAsk({ ...gin, move: 'ask_boundary', boundaryTopic: topic });
    boundaryAsked.push(topic); turnsSinceBoundary = 0; lastMove = 'ask_boundary';
    recent.push({ role: 'ai', text: ba.message });
    line(`LORE(ask_boundary:${topic}): ${ba.message}  [${ba.choices.map((c: any) => c.label).join(' / ')}]`);
    return { kind: 'boundary', topic, choices: ba.choices };
  }
  if (move === 'strike') {
    const s = await generateStrike(gin);
    const frag = { id: 'f' + store.fragments.length, text: s.message, type: s.type, domain: s.domain, components: s.components, confidence: s.confidence, status: 'proposed', reactions: [], recency: { lastConfirmedAt: null, halfLifeDays: halfLifeFor(s.type) || 0 } };
    store.fragments.push(frag);
    turnsSinceStrike = 0; lastMove = 'strike';
    recent.push({ role: 'ai', text: s.message });
    line(`LORE(strike): ${s.message}  [conf=${s.confidence} res=${resolution().toFixed(2)}]`);
    line(`  ハズレ型: ${s.missCandidates.map(m => m.label).join(' / ')}`);
    return { kind: 'strike', frag, missCandidates: s.missCandidates };
  }
  const t = await generateTurn(gin);
  turnsSinceStrike++; lastMove = move;
  recent.push({ role: 'ai', text: t.message });
  line(`LORE(${move}/${inputMode}): ${t.message}` + (t.choices.length ? `  [${t.choices.map(c => c.label).join(' / ')}]` : ''));
  return { kind: 'turn', move };
}

function applyReaction(frag: any, kind: 'agree' | 'unsure' | 'disagree') {
  const { patch, markStruck } = reactionPatch(frag, kind, now());
  Object.assign(frag, patch);
  if (markStruck) { const c = contourOf(frag.domain); c.struck++; c.material = 0; }
  line(`  → reaction=${kind} ⇒ status=${frag.status}`);
}

async function main() {
  hr(); line(`LORE エンジン検証  [LLM=${isMockLLM() ? 'MOCK' : 'LIVE/DeepSeek'}]`); hr();

  const answers = [
    '夜中にずっと地図を見てた。次の旅の計画とかじゃなくて、ただ眺めてた。',
    '完全に一人だった。誰かに見せたいとは思わなかったな。落ち着くんだ、その時間が。',
    '人といて疲れるのは、気を使い続けた時かな。盛り上がってる場でも、どこか冷めてる自分がいる。',
    'なんで断るかって言うと…正直、気分かも。でも本当は理由をちゃんと考えてる気がする。',
    '昔から、帰り道のほうが好きだったな。打ち上げより、その後の静けさに本当の自分がいる。',
    '頼るのが苦手っていうか、頼った後に残る借りの感覚が、ずっと苦しいんだと思う。',
  ];

  let didAgree = false, didMiss = false;
  for (const a of answers) {
    const r = await userTurn(a);
    if (r.kind === 'strike') {
      if (!didAgree) { applyReaction(r.frag, 'agree'); didAgree = true; }
      else if (!didMiss) {
        applyReaction(r.frag, 'disagree'); didMiss = true;
        const { patch, followup } = missPatch(r.frag, 'reason');
        Object.assign(r.frag, patch);
        line(`  → miss=reason ⇒ followup=${followup}, status=${r.frag.status}`);
        assert(followup === 'reason', 'reason miss → followup reason');
      }
    }
  }

  hr(); line('内面モデル'); hr();
  for (const f of store.fragments) line(`  [${f.status} ${f.confidence} ${f.type}/${f.domain}] ${f.text.slice(0, 30)}`);
  const res = resolution();
  line(`  resolution = ${res.toFixed(3)}`);
  assert(store.fragments.length >= 1, 'strike が1件以上保存された');
  assert(agreed().length >= 1, 'agreed/corrected が1件以上');
  assert(res > 0.12, 'resolution が初期値より上がった');

  hr(); line('コンテンツ: 候補→選定→生成'); hr();
  const ag = agreed().map(f => ({ id: f.id, text: f.text, domain: f.domain, type: f.type }));
  const seeds = await buildSeeds(ag);
  seeds.seeds.forEach(s => line(`  候補: ${s.title} (${s.suggestedFormat})`));
  assert(seeds.seeds.length >= 1, '候補が生成された');
  const fmt = await selectFormat(ag);
  const content = await generateContentBody({ title: seeds.seeds[0].title, summary: seeds.seeds[0].summary, format: fmt, frags: agreed() });
  line(`  生成 [${content.format}] ${content.title}`);
  line(`  本文(normal): ${content.bodies.normal}`);
  assert(!!content.bodies.normal, '本文が生成された');

  hr(); line('共有トークン / 聞き直し'); hr();
  const tok = shareToken();
  line(`  share token: ${tok} (${tok.length}文字)`);
  assert(tok.length === 22, 'トークン22文字');
  // 聞き直し: agreed を半年前に遡らせる
  const v = agreed().find(f => ['value', 'preference', 'trait', 'pattern'].includes(f.type));
  if (v) {
    v.recency = { lastConfirmedAt: new Date(Date.now() - 200 * 86400_000).toISOString(), halfLifeDays: 120 };
    const due = reaskDue(agreed(), Date.now());
    line(`  聞き直し対象: ${due.length}件`);
    assert(due.length >= 1, '半年経過で聞き直し対象になる');
  }

  hr(); line('境界の聞き取り(ask_boundary)'); hr();
  // コントローラ: 残テーマあり・規定ターン経過・直近strikeでない → ask_boundary を選ぶ
  const bm = decideMove({ lastMove: 'dig', lastScore: { specificity: 1, emotionalDepth: 1, selfInsight: 1 }, contourMaterial: 0, reaskDueCount: 0, turnsSinceStrike: 3, domainRepeat: 0, turnCount: 8, boundaryRemaining: 3, turnsSinceBoundary: 99 });
  line(`  controller → ${bm.move}/${bm.inputMode}`);
  assert(bm.move === 'ask_boundary', '条件が揃うと ask_boundary を選ぶ');
  // 直近が strike の時は割り込まない（ゾワッを先）
  const bm2 = decideMove({ lastMove: 'strike', lastScore: { specificity: 1, emotionalDepth: 1, selfInsight: 1 }, contourMaterial: 0, reaskDueCount: 0, turnsSinceStrike: 0, domainRepeat: 0, turnCount: 8, boundaryRemaining: 3, turnsSinceBoundary: 99 });
  assert(bm2.move !== 'ask_boundary', 'strike直後は境界を聞かない');
  // 残テーマ0なら聞かない
  const bm3 = decideMove({ lastMove: 'dig', lastScore: { specificity: 1, emotionalDepth: 1, selfInsight: 1 }, contourMaterial: 0, reaskDueCount: 0, turnsSinceStrike: 3, domainRepeat: 0, turnCount: 8, boundaryRemaining: 0, turnsSinceBoundary: 99 });
  assert(bm3.move !== 'ask_boundary', '残テーマ0なら境界を聞かない');
  // 生成: message ＋ 固定二択（routing保証）
  const ba = await generateBoundaryAsk({ move: 'ask_boundary', inputMode: 'tap', recentTurns: recent.slice(-4), lastAnswer: '', fragments: [], relation: relationSummary(store.rel), memory: [], struck: 0, domain: '日常', boundaryTopic: '家族' });
  line(`  ask: ${ba.message}  [${ba.choices.map((c: any) => c.label).join(' / ')}]`);
  assert(!!ba.message, '境界質問の本文が生成された');
  assert(ba.choices.length === 2 && ba.choices.some((c: any) => c.value === 'ng'), '固定二択(ok/ng)が付く');

  hr();
  if (fail === 0) line('✅ 全アサート通過 / エンジン検証 完走');
  else line(`❌ ${fail} 件のアサート失敗`);
  hr();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
