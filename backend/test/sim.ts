// E2E シミュレーション：mock モードで会話→strike→反応→ハズレ回復→候補→生成→公開→共有→聞き直し を通す。
// 実行: DATABASE_FILE=/tmp/lore_sim.db npx tsx test/sim.ts
import { migrate } from '../src/db/db';
import { Users, Rel, Fragments } from '../src/db/repo';
import { startSession, handleTurn, react, miss } from '../src/engine/orchestrator';
import { buildCandidates, generateContent, publish } from '../src/engine/content';
import { createShare, receiverView } from '../src/engine/share';
import { getReaskDue } from '../src/engine/relationship';
import { computeResolution } from '../src/engine/resolution';

const UID = 'u_maruyama';
const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(60));

async function main() {
  migrate();
  Users.upsert({ id: UID, user_id: 'maruyama', display_name: '丸山', bio: 'だいたい一番後ろの席にいる。', avatar: '丸', profile_private: 1 });
  Rel.get(UID);

  hr(); line('1) オンボーディング会話'); hr();
  const s = await startSession(UID, 'onboarding');
  const sid = s.sessionId;
  line(`LORE: ${s.message}  [move=${s.move} mode=${s.inputMode} res=${s.resolution.toFixed(2)}]`);

  const answers = [
    '夜中にずっと地図を見てた。次の旅の計画とかじゃなくて、ただ眺めてた。',
    '完全に一人だった。誰かに見せたいとは思わなかったな。落ち着くんだ、その時間が。',
    '人といて疲れるのは、気を使い続けた時かな。盛り上がってる場でも、どこか冷めてる自分がいる。',
    'なんで断るかって言うと…正直、気分かも。でも本当は理由をちゃんと考えてる気がする。',
    '昔から、帰り道のほうが好きだったな。打ち上げより、その後の静けさに本当の自分がいる。',
    '頼るのが苦手っていうか、頼った後に残る借りの感覚が、ずっと苦しいんだと思う。',
    '決めるのが遅いって言われる。でも一度決めたら覆さないから、慎重になってるだけ。',
  ];

  let pending: any = null;
  for (const a of answers) {
    line(`\nあなた: ${a}`);
    const r = await handleTurn(UID, sid, { text: a, inputMode: 'choice_free' });
    printAI(r);
    if (r.move === 'strike' && r.strike) {
      // 1回目は当てる、2回目は外してハズレ回復を試す
      const kind = pending === null ? 'agree' : 'disagree';
      line(`  → リアクション: ${kind}`);
      const rr = await react(UID, sid, r.strike.fragmentId, kind as any);
      if (rr.needMiss) {
        line('  → ハズレ。「理由が違う」を選択');
        const mr = await miss(UID, sid, r.strike.fragmentId, 'reason', 'それは弱さじゃなくて、選んでるだけ');
        printAI(mr.next);
        if (mr.next?.strike) { await react(UID, sid, mr.next.strike.fragmentId, 'agree'); line('  → 当て直しに そうかも'); }
      } else if (rr.done) {
        line('  → onboarding 完了 (firstlore へ)');
      } else if (rr.next) {
        printAI(rr.next);
      }
      pending = r.strike.fragmentId;
    }
  }

  hr(); line('2) 内面モデルの状態'); hr();
  const frags = Fragments.byUser(UID);
  for (const f of frags) line(`  [${f.status} ${f.confidence} ${f.type}/${f.domain}] ${f.text}`);
  line(`  resolution = ${computeResolution(UID).toFixed(3)}`);

  hr(); line('3) コンテンツ候補 → 生成 → 公開'); hr();
  const cands = await buildCandidates(UID);
  cands.forEach(c => line(`  候補: ${c.title} (${c.suggested_format}) — ${c.summary}`));
  if (cands[0]) {
    const draft = await generateContent(UID, cands[0].id, 'normal');
    line(`\n  生成 [${draft.format}] ${draft.title}`);
    line(`  本文: ${draft.body}`);
    const card = publish(UID, { seedId: cands[0].id, format: draft.format, title: draft.title, body: draft.body, payload: draft.payload, granularity: 'normal', closeOnly: false });
    line(`  公開: card=${card.id} layers=${JSON.stringify(card.layers)} conf=${card.conf}`);
  }

  hr(); line('4) 共有リンク → 受け手View'); hr();
  const link = createShare(UID, 'profile', 'general');
  line(`  リンク: https://${link.url}  (token ${link.token.length}文字)`);
  const view = receiverView(link.token);
  line(`  受け手が見るカード数: ${(view as any).cards?.length ?? 0}`);
  (view as any).cards?.forEach((c: any) => line(`    - ${c.title}`));

  hr(); line('5) 聞き直し(⑧) のパス検証（fragmentを半年前に遡らせる）'); hr();
  const agreed = Fragments.byUser(UID, ['agreed', 'corrected']).filter(f => ['value', 'preference', 'trait', 'pattern'].includes(f.type));
  if (agreed[0]) {
    const past = new Date(Date.now() - 200 * 86400_000).toISOString();
    Fragments.update(agreed[0].id, { recency: { lastConfirmedAt: past, halfLifeDays: 120 } });
    const due = getReaskDue(UID);
    line(`  聞き直し対象: ${due.length}件`);
    if (due.length) {
      const s2 = await startSession(UID, 'home');
      const r2 = await handleTurn(UID, s2.sessionId, { text: '今日は落ち着いた一日だった。', inputMode: 'choice_free' });
      line(`  → home会話で move=${r2.move}（reask が出れば成功）: ${r2.message}`);
    }
  }

  hr(); line('✅ E2E 完走'); hr();
}

function printAI(r: any) {
  if (!r) return;
  const tag = `[move=${r.move} mode=${r.inputMode} res=${(r.resolution ?? 0).toFixed?.(2) ?? r.resolution}]`;
  line(`LORE: ${r.message}  ${tag}`);
  if (r.choices?.length) line(`  選択肢: ${r.choices.map((c: any) => c.label).join(' / ')}`);
  if (r.missCandidates?.length) line(`  ハズレ型: ${r.missCandidates.map((c: any) => c.label).join(' / ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
