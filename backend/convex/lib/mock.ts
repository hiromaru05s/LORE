// MOCK モード：APIキー未設定でも全パイプラインが動くよう、purpose ごとに有効な JSON を生成する。
// 実LLM接続時は使われない。Convex非依存・純粋。
export type Purpose = 'score' | 'turn' | 'strike' | 'restrike' | 'seeds' | 'format' | 'content';

const clamp3 = (n: number) => Math.max(0, Math.min(3, Math.round(n)));

function guessDomain(text: string): string {
  const t = text || '';
  if (/仕事|会社|職場|上司|同僚|打ち上げ|プロジェクト/.test(t)) return '仕事';
  if (/恋|彼|彼女|好きな人|付き合/.test(t)) return '恋愛';
  if (/親|家族|母|父|実家|兄|姉|弟|妹/.test(t)) return '家族';
  if (/友達|人といて|集まり|飲み|パーティ|端っこ|端|みんな/.test(t)) return '対人';
  if (/旅|趣味|本|映画|音楽|ゲーム|地図|写真/.test(t)) return '趣味';
  if (/昔|子供|高校|大学|頃|当時|あの時/.test(t)) return '過去';
  if (/大事|譲れ|べき|信じ|価値/.test(t)) return '価値観';
  return '日常';
}
function guessType(text: string): string {
  const t = text || '';
  if (/時|頃|昔|去年|高校|大学|当時/.test(t)) return 'event';
  if (/好き|嫌い|よく|いつも/.test(t)) return 'preference';
  if (/大事|譲れ|べき|信じ/.test(t)) return 'value';
  return 'trait';
}

const MISS_CANDIDATES = [
  { label: 'むしろ逆かも', value: 'opposite' },
  { label: 'そこまでじゃない', value: 'degree' },
  { label: '相手や場面が違う', value: 'object' },
  { label: '当たってるけど理由が違う', value: 'reason' },
  { label: '半分は合ってる', value: 'partial' },
  { label: 'ぜんぶピンとこない', value: 'whole' },
];

const READS = [
  { message: '君は、人に見せるために何かをするのがあまり好きじゃない。完結している時間そのものが、もう報酬になっている人だ。', subject: 'あなた', claim: '完結している時間そのものが報酬', qualifier: '人に見せるためではなく', valence: 'pos', type: 'value', domain: '価値観' },
  { message: '盛り上がっている場所より、その帰り道の静けさの方が好きだろう。賑わいが嫌いなんじゃない。余韻の方に本体がある。', subject: 'あなた', claim: '余韻の方に本体がある', qualifier: '賑わいが嫌いなのではなく', valence: 'pos', type: 'preference', domain: '対人' },
  { message: '君の「まあいいか」は諦めじゃない。戦う相手を、静かに選んでいるだけだ。', subject: 'あなた', claim: '戦う相手を静かに選んでいる', qualifier: '諦めではなく', valence: 'pos', type: 'trait', domain: '価値観' },
  { message: '注目されたいわけじゃない。ただ、見られていない時間にしか、本当の自分を出せないんだ。', subject: 'あなた', claim: '見られていない時間にしか本当の自分を出せない', qualifier: '', valence: 'neu', type: 'pattern', domain: '対人' },
  { message: '頼るのが苦手なんじゃない。頼った後に残る「借り」の感覚に、耐えられないんだ。', subject: 'あなた', claim: '借りの感覚に耐えられない', qualifier: '頼るのが苦手なのではなく', valence: 'neu', type: 'pattern', domain: '対人' },
];

function mockScore(h: any) {
  const text: string = h.text || '';
  const len = text.length;
  const emo = /嬉|悲|寂|怖|疲|不安|嫌|好き|つら|楽し|落ち着|怒|焦|安心|消耗|逃げ/.test(text) ? 2 : (len > 40 ? 1 : 0);
  const insight = /なぜ|理由|だと思う|気づ|かもしれ|本当は|自分でも|逃げかも/.test(text) ? 3 : (/多分|たぶん|かも/.test(text) ? 1 : 0);
  const spec = clamp3(Math.floor(len / 22));
  return { scores: { specificity: clamp3(spec), emotionalDepth: clamp3(emo), selfInsight: clamp3(insight) }, domain: guessDomain(text), type: guessType(text) };
}

function mockTurn(h: any) {
  const move = h.move || 'pivot';
  const last = (h.lastText || '').slice(0, 14);
  const free = h.inputMode === 'free';
  const msgs: Record<string, string> = {
    open: 'はじめまして。重い質問はしない。最近、気づいたら時間が溶けてたことってある？',
    dig: `「${last}」——もう少しだけ聞かせて。それって、どんな時に一番強く出る？`,
    pivot: '話は変わるけど。最近、自分でも少し意外だった選択ってあった？',
    reflect: 'そっか。それは、ちゃんと自分で抱えてきたんだね。',
    reask: '前に話してくれたことなんだけど…今の君にとって、ほんとうに譲れないものって何だろう？',
    close: '今日はこのへんで。…でも今の話、すこし像が動いた気がする。',
  };
  const chips: Record<string, string[]> = {
    open: ['夜中にずっと地図を見てた', '古い写真を整理してた'],
    dig: ['一人の時', '人といる時'], pivot: ['あるかも', '特にない'],
    reflect: ['うん', '…どうかな'], reask: ['時間', '誠実さ'], close: [],
  };
  return { message: msgs[move] || msgs.pivot, choices: free ? [] : (chips[move] || []).map(c => ({ label: c, value: c })) };
}

function mockStrike(h: any) {
  const r = READS[(h.struck || 0) % READS.length];
  return {
    message: r.message,
    components: { subject: r.subject, claim: r.claim, qualifier: r.qualifier, valence: r.valence },
    confidence: h.struck >= 2 ? 0.4 : 0.75, type: r.type, domain: h.domain || r.domain,
    missCandidates: MISS_CANDIDATES.slice(0, 4),
  };
}

function mockRestrike(h: any) {
  const map: Record<string, string> = {
    opposite: 'なるほど、逆か。じゃあ君はむしろ、自分から場を動かしたい側なのかもしれない。',
    degree: 'そこまで強くはない、か。…でも、芯のところには確かにそれがある。',
    object: '相手によるんだね。特定の誰かの前でだけ、その輪郭は濃くなる。',
    reason: `当たってはいる。ただ理由が違う——${h.detail || 'それは弱さじゃなく、選択だ'}。`,
    partial: '半分か。なら、合っていた半分の方に、君の本体がある。',
    whole: 'ぜんぶ違ったか。…じゃあ一度、別の角度から見てみよう。',
    custom: `そっか。「${h.detail || ''}」——そこにこそ、君の輪郭がある。`,
  };
  return {
    message: map[h.missType] || '君には、まだ言葉になっていない輪郭がある。',
    components: { subject: 'あなた', claim: '訂正後の輪郭', qualifier: '', valence: 'neu' },
    confidence: 0.7, type: 'trait', domain: h.domain || '日常', missCandidates: MISS_CANDIDATES.slice(0, 4),
  };
}

function pickFormat(frags: any[]): string {
  const types = (frags || []).map(f => f.type);
  if (types.filter((t: string) => t === 'event').length >= 3) return 'timeline';
  if (types.filter((t: string) => t === 'preference' || t === 'relation').length >= 4) return 'constellation';
  if ((frags || []).some((f: any) => f.reask?.history?.length)) return 'contrast';
  return 'roughtext';
}

function mockSeeds(h: any) {
  const frags: any[] = (h.agreed || []).slice(0, 3);
  if (frags.length === 0) return { seeds: [{ title: 'いまの自分', summary: 'まだ言葉になっていない輪郭。', domain: '日常', suggestedFormat: 'roughtext', sourceFragmentIds: [] }] };
  const titles = ['退屈との付き合い方', '断り方に出る性格', '人との距離の取り方', '余韻の置き場所', '選び方のクセ'];
  return { seeds: frags.map((f, i) => ({ title: titles[i % titles.length], summary: (f.text || '').slice(0, 28), domain: f.domain || '日常', suggestedFormat: pickFormat(frags), sourceFragmentIds: [f.id].filter(Boolean) })) };
}

function mockFormat(h: any) { return { format: pickFormat(h.fragments || []), reason: 'mock: 素材の型から選定' }; }

function mockContent(h: any) {
  const title = h.title || 'いまの自分';
  const sm = h.summary || '何も起きない時間に、君がどう強いか。';
  let payload: any = null;
  if (h.format === 'timeline') payload = { events: (h.events || []).map((e: any) => ({ when: e.when || '', label: e.label || '', body: e.body || '' })) };
  else if (h.format === 'contrast') payload = { before: '半年前の自分', after: '今の自分', pivot: 'その間に起きたこと' };
  else if (h.format === 'constellation') payload = { nodes: (h.fragments || []).slice(0, 5).map((f: any, i: number) => ({ id: i, label: (f.text || '').slice(0, 8) })), links: [] };
  return {
    title, format: h.format || 'roughtext', payload,
    bodies: {
      detailed: `丸山は${sm} 予定が真っ白な日曜の朝、多くの人がスマホを開いて何かを探しはじめる時間に、彼はただ窓の外を見ていられる。沈黙が怖くない、数少ないタイプだ。`,
      normal: `丸山は${sm} 何も起きない時間を無理に埋めようとせず、そのまま過ごせる。`,
      vague: `丸山は、${sm.slice(0, 12)}…そういう人だ。`,
    },
  };
}

export function mockGenerate(purpose: Purpose, hints: any): any {
  switch (purpose) {
    case 'score': return mockScore(hints);
    case 'turn': return mockTurn(hints);
    case 'strike': return mockStrike(hints);
    case 'restrike': return mockRestrike(hints);
    case 'seeds': return mockSeeds(hints);
    case 'format': return mockFormat(hints);
    case 'content': return mockContent(hints);
    default: return {};
  }
}
