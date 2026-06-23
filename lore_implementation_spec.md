# LORE — 実装設計＆指示書（APIキーで動かす）

> 目的：`lore_engine_design.md`（内面モデル/会話/コンテンツ/関係の設計）を**動く実装**に落とすための指示書。DeepSeek の APIキーを env に挿せば、会話・言い当て・コンテンツ生成が実LLMで動くところまでを一気通貫で定義する。
> **本書の主役は、内部データモデル・会話設計・LLM制御**。バックエンド（最小BE＋DB）は「それを動かすための器」として、その上に最小限で載せる。
> 整合の正：`lore_product_spec_v2.md`（UI/コピー/フロー）、`lore_engine_design.md`（ロジック/データ）、`dev_web/LORE.dc.html`（現行プロトタイプ＝FEの正）。
> 最終更新：2026-06-22

---

## 0. スコープと前提（ノイズの切り分け）

「現行FEに痕跡はあるが**表示されていない要素はノイズ**」という方針で、BEを作る対象を絞る。

| 区分 | 対象 | 扱い |
|---|---|---|
| ✅ 作る（コア） | 会話→言い当て→反応→内面モデル蓄積／コンテンツ候補→生成→公開／プロフィール／**共有リンク＋受け手View**／**親しい人（close）レイヤー**／コンテンツ管理（編集・削除・レイヤー再割当）／**信念ストアのDB永続化** | 本実装の中身 |
| 🟡 最小だけ残す | **ともだち申請が来た時の、プロフィール上の「ともだち」UI表示**のみ | 申請受信→表示と承認だけ。送信導線・一覧の作り込みはしない |
| ❌ ノイズ（作らない） | **フォロー機能（存在しない）／通知一覧・未読（存在しない）**／ブロック・ミュート・履歴非表示／他者検索の汎用ソーシャル／LP拡張セクション／i18n網羅 | BEを作らない。FEからも順次除去（§11） |

現行 `state` のうち、**捨てる**もの（ノイズ）：`notifList` / `hiddenUsers` / `blockedUsers` / `msgMuted` / `friendsListOpen`（一覧）/ フォロー系。
**最小で残す**：`incomingRequests` / `friends`（申請受信表示のみ）。
**コア化して残す**：`messages` `convIdx` `pendingStrike` `cards` `candidates` `deleted` `granularity` `resolution` `profilePrivate` `pubCloseOnly` `shareToken` `contentShareToken` `viewCard` 等。

### 「APIキーで動く」の定義

`.env` に DeepSeek のキーと2つのモデルID（Pro/Flash）を入れて起動すれば、ハードコードの `script` / `homeScript` / `seedCards` / `genMap` / `readPool` が**全て実LLM＋DBの動的生成に置き換わって動く**状態。デモユーザー1名がseedされ、会話から実際に内面モデルが育ち、コンテンツが生成され、共有リンクが発行できる。

### スタック（最小）

- **FE**：現行 `dev_web/LORE.dc.html`（dc-runtime）をそのまま正面UIに使う。state をローカル管理から **BE API 呼び出し**に差し替える（§9）。
- **BE**：薄いサーバ（Node/TypeScript 想定。serverless 関数でも可）。**APIキーはサーバ側に保持**（ブラウザに出さない）。
- **DB**：Postgres（本番志向）/ SQLite（ローカル最速）。信念ストアの永続化先。
- **LLM**：DeepSeek（OpenAI互換API）。Pro/Flash の2段（§4）。

```
[FE: LORE.dc.html] ──HTTP──▶ [BE: orchestrator API] ──▶ [DB: Postgres/SQLite]
                                       │
                                       ├─▶ DeepSeek V4 Flash (会話/採点/候補/選定)
                                       └─▶ DeepSeek V4 Pro   (言い当て/コンテンツ生成)
```

### env（これだけで動く）

```
DEEPSEEK_API_KEY=sk-...            # ← ユーザーが発行して挿す唯一の必須キー
DEEPSEEK_BASE_URL=https://api.deepseek.com   # OpenAI互換エンドポイント
LLM_MODEL_PRO=deepseek-v4-pro     # 「いいLLM」: 言い当て・コンテンツ生成
LLM_MODEL_FLASH=deepseek-v4-flash # 「安いLLM」: 会話・採点・候補・選定
DATABASE_URL=postgres://... | file:./lore.db
SESSION_SECRET=...                # デモ認証用（任意）
```

> モデルIDは env で差し替え可能にし、プロバイダは抽象化する（§4-2）。将来 Claude/OpenAI に載せ替えても本書のロジックは不変。

---

## 1. アーキテクチャ — リクエストの流れ

会話の1ターンは必ずこの順で回る（詳細は §3）。

```
FE: ユーザー発話 ─▶ POST /session/:id/turn { text, inputMode }
                          │
BE orchestrator:          ▼
  1. Turn(user) を保存
  2. 採点 (Flash)         → scores {specificity, emotionalDepth, selfInsight}
  3. 信念ストア更新        → fragment 追加 / confidence 更新（DB）
  4. 状態を読み「手」と「入力モード」を決定（コントローラ＝コード）
  5. 手が strike なら Pro、それ以外は Flash でメッセージ生成（JSON）
  6. Turn(ai) を保存、必要なら Fragment(proposed) を保存
  7. resolution を再計算（信念ストアから導出）
                          ▼
FE: ◀─ 200 { message, move, inputMode, choices?, strike?, missCandidates?, resolution }
```

**重要な原則**：採点・コントローラ判断・コスト管理は**コード側（BE）**が持ち、LLMは「次の一手の文面と構造化データを作る」担当に限定する。これで挙動が安定し、安いモデルを多用できる。

---

## 2. データモデル（DB実装）★主役

`lore_engine_design.md` §1 の論理モデルをテーブルに落とす。DDLは Postgres 寄せ（SQLiteは型を読み替え）。

### 2-1. 3層 → テーブル対応

| 層 | テーブル | 公開性 |
|---|---|---|
| ① 会話ログ | `turns` | 私的・不変 |
| ② 内面モデル（信念ストア） | `fragments` / `misses` / `contours` | **私的** |
| ③ 公開ビュー | `content_seeds` / `content_cards` / `share_links` | キュレーション後に公開 |
| 横断 | `users` / `relationship_state` / `reask_queue` | — |

### 2-2. DDL（要点）

```sql
-- 横断
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- 'u_maruyama'（デモseed）
  user_id       TEXT UNIQUE,               -- '@maruyama'（lore ID）
  display_name  TEXT, bio TEXT, avatar TEXT,
  profile_private BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ① 会話ログ（不変）
CREATE TABLE turns (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  session_id TEXT,
  role       TEXT,    -- ai | user
  type       TEXT,    -- question|answer|strike|reaction|miss|reflection|system
  text       TEXT,
  input_mode TEXT,    -- tap | choice_free | free
  refs       JSONB,   -- { strikeId?, fragmentId?, candidateId? }
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ② 内面モデル：Fragment（中核）
CREATE TABLE fragments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  text        TEXT,
  type        TEXT,   -- trait|event|preference|value|relation|pattern
  domain      TEXT,
  components  JSONB,  -- { subject, claim, qualifier, valence: pos|neg|neu }
  confidence  REAL,
  status      TEXT,   -- proposed|agreed|unsure|corrected|retired
  evidence    JSONB,  -- [turnId]   ★必須: 由来
  reactions   JSONB,  -- [{type, at}]
  scores      JSONB,  -- {specificity, emotionalDepth, selfInsight} 0-3
  time_data   JSONB,  -- {when, label}（type=event のみ）
  contour_id  TEXT,
  recency     JSONB,  -- {lastConfirmedAt, halfLifeDays}
  reask       JSONB,  -- {lastAskedAt, nextEligibleAt, version, history:[]}
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE misses (
  id                  TEXT PRIMARY KEY,
  fragment_id         TEXT REFERENCES fragments(id),
  type                TEXT,  -- opposite|degree|object|reason|partial|whole|custom
  detail              TEXT,  -- free レーンの本人の言葉
  resolved_fragment_id TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE contours (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  label       TEXT,    -- 内部語。★ユーザーに出さない
  domain      TEXT,
  strength    REAL,    -- Σ(関連fragment.confidence)。strike発火閾値
  gaps        JSONB,   -- [text]
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ③ 公開ビュー
CREATE TABLE content_seeds (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id),
  source_fragment_ids JSONB,  -- agreed|corrected のみ
  domain        TEXT,
  suggested_format TEXT,      -- timeline|contrast|constellation|roughtext
  title TEXT, summary TEXT,
  status        TEXT          -- candidate|deleted|published
);

CREATE TABLE content_cards (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  seed_id     TEXT,
  format      TEXT,
  title TEXT, body TEXT,
  payload     JSONB,   -- フォーマット別構造化データ（timeline→events[]等）
  conf        REAL,    -- detailed .75 / normal .60 / vague .40
  layers      JSONB,   -- ['general'] | ['general','close'] | ['close']
  is_premium  BOOLEAN DEFAULT FALSE,
  cover       TEXT, images JSONB,
  pinned      BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE share_links (
  token       TEXT PRIMARY KEY,   -- 推測困難なトークン（§7）
  user_id     TEXT REFERENCES users(id),
  scope       TEXT,    -- 'profile' | 'content'
  content_id  TEXT,    -- scope=content のとき
  layer       TEXT,    -- 'general' | 'close'
  revoked     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE relationship_state (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  total_sessions INT DEFAULT 0, total_turns INT DEFAULT 0,
  known_domains  JSONB DEFAULT '[]',
  input_mode_ratio JSONB,           -- {tap, choice_free, free}
  premium_quota  JSONB,             -- {weekStartAt, used}  週2
  memory_highlights JSONB DEFAULT '[]',
  reask_due      JSONB DEFAULT '[]'
);

-- 最小ともだち申請（残す分だけ）
CREATE TABLE friend_requests (
  id          TEXT PRIMARY KEY,
  to_user     TEXT REFERENCES users(id),
  from_user   TEXT,
  status      TEXT,   -- incoming|accepted
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

> フォロー・通知・ブロック等の**テーブルは作らない**（ノイズ）。

### 2-3. プロトタイプのハードコード → DB の対応

| 現行（ハードコード） | 置き換え先 | 生成元 |
|---|---|---|
| `script[]` / `homeScript[]` | `turns` ＋ 動的生成 | オーケストレータ（§3）が毎ターン生成 |
| `pendingStrike` / strike文 | `fragments`(proposed) ＋ Turn(strike) | Pro が生成（§4） |
| `react()` の resolution 固定式 | `fragments` の蓄積から導出 | §3-6 の式 |
| `seedCandidates[]` | `content_seeds` | Flash が agreed fragment から生成（§5-1） |
| `genMap`（detailed/normal/vague） | 生成時に Pro が3粒度で出力 | §5 |
| `seedCards[]` | `content_cards` | publish 時に確定（§5） |
| `readPool[]`（nudge用） | 未提示 `fragments` から1件 | §3-7 |

---

## 3. 会話設計（実装：オーケストレーションループ）★主役

`script` 駆動をやめ、**毎ターン状態から手を選ぶ**コントローラに置き換える。onboarding と home（再エンゲージ）は**同じエンジン**。違いは初回かどうかと進捗バーの有無だけ。

### 3-1. コントローラ（BE側・擬似コード）

```ts
async function handleTurn(userId, sessionId, { text, inputMode }) {
  await saveTurn(userId, sessionId, { role:'user', type:'answer', text, inputMode });

  // 2. 採点（Flash）
  const scores = await scoreAnswer(text, recentContext(userId));   // {spec, emo, insight}

  // 3. 信念ストア更新：直近の strike への反応 or 新素材
  await updateBeliefStore(userId, text, scores);

  // 4. 状態を読み、手と入力モードを決める（コード）
  const ctx = await loadControllerContext(userId, sessionId);
  const { move, inputMode: nextMode } = decideMove(ctx);

  // 5. 手に応じてモデルを選び、文面を生成
  const model = (move === 'strike') ? PRO : FLASH;
  const out = await generateMove({ move, nextMode, ctx, model });   // JSON

  // 6. 保存
  await saveTurn(userId, sessionId, { role:'ai', type:moveToType(move), text:out.message, inputMode:nextMode });
  if (move === 'strike') await saveFragment(userId, { ...out.strike, status:'proposed' });

  // 7. resolution 再計算
  const resolution = computeResolution(userId);

  return { ...out, move, inputMode:nextMode, resolution };
}
```

### 3-2. 手（move）と発火条件

| move | 発火条件（decideMove） | モデル |
|---|---|---|
| `dig` | 直近 scores の emotionalDepth または specificity が低い（≤1） | Flash |
| `pivot` | 現 contour.strength が伸び悩み／`whole` ハズレ／同 domain 連続3回超 | Flash |
| `strike` | あるcontourで substantive回答 ≥2 ＆ `strength ≥ STRIKE_THRESHOLD` ＆ 未提示の読みがある | **Pro** |
| `reflect` | 直前が強い感情開示／直前が strike のハズレ | Flash |
| `reask` | `reask_due` に期限到来 fragment がある（§6） | Flash |
| `close` | strike直後の高揚 ＆ セッション turn ≥ N | Flash |

初期しきい値（実会話でチューニング）：
```
STRIKE_THRESHOLD = 1.5     // Σconfidence
SUBSTANTIVE_MIN  = 2       // contour内の実質回答数
DOMAIN_REPEAT_MAX = 3
SESSION_CLOSE_TURNS = 8
STRIKE_PACE = 1 strike / 2-3 substantive answers
```

### 3-3. 入力モード（①）— tap / choice_free / free

`decideMove` が move と一緒に `inputMode` を返す。

| inputMode | UI | 選ぶ条件 |
|---|---|---|
| `tap` | 選択肢のみ | 反応（そうかも/わからない/違う）、ハズレ型、軽い確認 |
| `choice_free` | サジェスト＋自由入力 | 大半の質問のデフォルト |
| `free` | **選択肢を出さない** | 核心を深く考えさせる時：強い感情の直後、人生の核心、ハズレの`custom`、selfInsightが伸びそうな時 |

判定の芯：**浅い収集・確認・反応は tap、一番考えてほしい核心は free（あえて選択肢を出さない）**。
進行連動：`relationship_state.input_mode_ratio` を見て、初期は `choice_free`/`free` 多め、成熟で `tap` 中心。→「話すほどタップで済む」＝成長の体感（§6）。

### 3-4. strike のテンポ（②）

毎ターン撃たない。`STRIKE_PACE`（substantive 2-3 に対し1）を守る。撃つ瞬間は spec 4-D 通り：メタ `READ`→黒地に白の一文→`pendingStrike` をFEに返し、3択（そうかも0.75/わからない0.4/違う0.15）を tap で出す。

### 3-5. ハズレ回復（④）

```
strike → 「違うと思う」(react disagree)
   → BE: Miss を作らず、まず missCandidates を返す
   → FE: ハズレ型を tap 提示（opposite/degree/object/reason/partial/whole）＋「自分で言う＋」(free)
   → POST /miss { fragmentId, type, detail? }
   → BE: Miss 保存 → 型に応じ信念ストア更新（engine_design §1-3 表）→ 多くは re-strike(Pro) か reflect
```

### 3-6. resolution の導出（メーターは出さないが内部値は要る）

固定式（`react` の +0.05 等）をやめ、**信念ストアから計算**：
```
resolution = clamp(0..1,
   0.12 + 0.6 * normalize(Σ agreed/corrected fragment.confidence)
        + 0.2 * domainCoverage )      // 触れた domain の広がり
```
- 肖像の解像アニメ（canvas）はこの値で駆動（既存 `setResolution`）。
- ⚠️ **数値・％はUIに出さない**（spec §9）。canvas の鮮明さだけで見せる。onboarding の進捗バーのみ例外。

### 3-7. nudge（TAP TO RESOLVE）

`readPool` 固定をやめ、**未提示の agreed fragment を1件開示**して resolution を少し上げる。無ければ「最近の輪郭」を1つ言い換えて出す。

### 3-8. セッション中断/再開

`turns.session_id` ＋ `relationship_state` で復元。再開時は `reflect` から入って文脈を温め直す。バースト型（毎日埋めさせない）。

---

## 4. LLM制御（Pro/Flash）★主役

### 4-1. モデルルーティング

| 処理 | モデル | 理由 |
|---|---|---|
| 会話の手（question/dig/pivot/reflect/reask） | **Flash** | 量が多い。安く回す |
| 採点（3軸） | **Flash** | 単純分類 |
| コンテンツ候補（seed）生成 | **Flash** | 下書き的 |
| フォーマット選定 | **Flash** | 分類判断 |
| **言い当て（strike）生成** | **Pro** | 刺す瞬間＝プロダクトの命。質が要る |
| **コンテンツ本文生成（特にプレミアム）** | **Pro** | 出力がプロダクトの顔 |

> ユーザー指定：「会話・候補生成＝安いFlash／刺す瞬間・コンテンツ生成＝いいPro」。これをコードのルーティングで固定する。

### 4-2. プロバイダ統合（DeepSeek＝OpenAI互換）と抽象化

DeepSeek は OpenAI 互換 API。`base_url` と `api_key` を差すだけで OpenAI SDK 互換クライアントが使える。プロバイダは1枚の抽象で包む。

```ts
interface LLM {
  complete(opts: {
    model: 'pro' | 'flash',
    system: string,
    messages: Msg[],
    schema?: JSONSchema,   // 構造化出力
    temperature?: number,
  }): Promise<{ json?: any, text?: string, usage: Usage }>;
}

// DeepSeek 実装：OpenAI互換クライアント。model は env の LLM_MODEL_PRO/FLASH に解決。
// response_format: { type:'json_object' } ＋ schema を system に明記して JSON を強制。
```

> 抽象化しておけば、後で Claude / OpenAI に載せ替えてもオーケストレータは無変更。

### 4-3. システムプロンプト（毎回先頭・固定＝“preference”の正体）

LLMは記憶を持たない。望む人格・ルールは**毎回このsystemを前置**して作る。

**会話オーケストレータ用 system（Flash/Pro共通の土台）：**
```
あなたは LORE。ユーザーと話しながら、本人も気づいていない一面を「言い当てる」存在。
トーン：確信を持って短く、断定で。ヘッジ（〜かも、の連発）はしない。親密だが馴れ馴れしくない。
絶対ルール（ガードレール）：
- 数値・％・完成度・残り・メーターの概念を会話に一切出さない。
- 診断・占いの口調にしない（「あなたは○○タイプ」を言わない）。
- 内部の確信度や採点根拠を表に出さない。内部用語(fragment/contour等)を見せない。画面語は LORE / READ のみ。
- ネガティブな自己認識を強化しない。弱さは責めず、輪郭として扱う。
- 自傷・深刻な精神的危機の兆候があれば、言い当てを止め、受け止めと専門的支援の提示に切り替える。
出力は必ず指定された JSON スキーマだけを返す。余計な文章を付けない。
```

**strike生成用 system（Pro）追記：**
```
渡された contour の fragment 群を根拠に、まだ本人に言っていない読みを「一文」で刺せ。
根拠は message に書かない（断定だけ）。components に分解し、miss_candidates も付けよ。
```

**コンテンツ生成用 system（Pro）追記：**
```
同意済み fragment を素材に、読み物として成立する本文を書け。編集痕・AI臭を出さない。
指定フォーマットの payload を構造化して埋めよ。3粒度（detailed/normal/vague）で出力。
```

### 4-4. 構造化出力スキーマ（JSONで返させる＝fragmentが構造で残る仕組み）

**会話ターン応答：**
```json
{
  "move": "strike",
  "inputMode": "tap",
  "message": "君は注目されたいけど、それを隠してる",
  "strike": {
    "type": "trait", "domain": "対人",
    "components": { "subject":"あなた","claim":"注目されたい","qualifier":"隠している","valence":"pos" },
    "confidence": 0.75, "evidenceTurnIds": ["t_103","t_108"]
  },
  "choices": [
    {"label":"そうかも","value":"agree"},
    {"label":"わからない","value":"unsure"},
    {"label":"違うと思う","value":"disagree"}
  ],
  "missCandidates": []
}
```
- `move=question` のとき：`strike` 省略、`choices` はサジェスト、`inputMode` をセット。
- `inputMode=free` のとき：`choices` を空配列に（=あえて選択肢を出さない）。

**採点：** `{ "scores": { "specificity":2, "emotionalDepth":1, "selfInsight":3 } }`
**候補生成：** `{ "seeds":[ {"title","summary","sourceFragmentIds","suggestedFormat","domain"} ] }`
**フォーマット選定：** `{ "format":"timeline", "reason":"...", "payloadPlan":{...} }`
**コンテンツ生成：** `{ "title","format","payload", "bodies": {"detailed","normal","vague"} }`

> 受信後は **JSONをスキーマ検証**。壊れていたら1回だけ「JSONだけ返せ」と修復プロンプトで再試行、それでも駄目なら roughtext / 安全なフォールバックに落とす。

### 4-5. 文脈注入（毎回どのデータを入れるか＝“記憶”の正体）

system の後に、この順で詰める（「分かってる感」⑧の源泉）：
```
[関係サマリ]   total_sessions, known_domains, input_mode_ratio
[直近の会話]   直近 N ターン（turns）
[関連 fragment] 現 domain/contour の agreed/unsure を confidence 降順で数件
[memory_highlights] 参照させたい濃い fragment（本人の言葉を引用させる）
[reask_due]     期限到来の聞き直し（あれば。古い答えは渡すが「伏せて聞け」と指示）
[今回の指示]   手ごとのテンプレ（4-6）
```

### 4-6. 手ごとのプロンプト（system＋文脈の後に足す）

- **dig**：「直前回答は emotionalDepth が低い。同じ出来事をもう一段深く掘る質問を1つ。本人の言葉を引用。inputMode=free。」
- **pivot**：「この鉱脈は枯れた。未到達 domain（候補：…）へ自然に移る質問を1つ。」
- **strike**：4-3 のstrike system＋「対象 contour：{fragments}」。
- **reflect**：「評価や言い当てをせず、受け止める短い応答を1つ。次で深掘りする余地を残す。」
- **reask**：「半年前、本人はこう同意した：『{old}』。**古い答えは伏せて**、同じ核心を新鮮に聞き直す質問を1つ。inputMode=free。」

### 4-7. 採点（3軸）

各ターン、Flashで `specificity / emotionalDepth / selfInsight`（各0-3）を返させる。用途：低specificity→dig、高selfInsight余地→inputMode=free、十分蓄積→strike。

### 4-8. コスト・信頼性

- **既定は Flash**、Pro は strike とコンテンツ生成のみ（明示ゲート）。
- ストリーミング：strike は一文一括で出すと演出（黒地・点滅ドット）と相性が良い → 非ストリームで取得し、FE側で演出。会話質問はストリーム可。
- レート/リトライ：429/5xx は指数バックオフ。JSON壊れは4-4の修復1回。
- ログ：プロンプト/usage/モデルを記録（コスト可視化）。内面データはセンシティブ扱いで暗号化（§10未決）。

### 4-9. ガードレール実装

system のルール（4-3）に加え、**コード側でも後段チェック**：出力に数値メーター語・診断口調・危機兆候への不適切応答が混じっていないか軽く検査し、該当時は reflect＋支援提示に差し替える。spec §9・engine_design C を二重で担保。

---

## 5. コンテンツエンジン（実装）

### 5-1. 候補（seed）生成

`agreed` / `corrected` の fragment を domain でまとめ、Flash に `content_seeds` を生成させる（タイトル/概要/推奨フォーマット）。FEの generate スワイプデッキ（右=確定/左=削除）にそのまま供給。`deleted` は復元可（現行踏襲）。

### 5-2. フォーマット選定（⑦）＝自由生成しない

1. **選定（Flash）**：domain と手元 fragment の**型**を見て、3フォーマットから選ぶ。条件を満たさなければ `roughtext`。
2. **充填（Pro）**：選んだフォーマットの `payload` を埋め、3粒度の本文を生成。

| フォーマット | 必要な型 | payload |
|---|---|---|
| `timeline` | `event`(time_data付き) ≥3 | `events:[{when,label,body}]` |
| `contrast` | 変化/二面性のある `value`/`trait`（reask.history あれば最良） | `{before,after,pivot}` |
| `constellation` | 同domainの `preference`/`relation` ≥4 | `{nodes[],links[]}` |
| `roughtext`(既定) | agreed が1件でも | 整形済み段落 |

アニメーションはフォーマット側のFE実装（timeline=順次出現、contrast=反転リビール、constellation=ノード接続）。LLMは payload を出すだけ。

### 5-3. プレミアム生成（週2）

`relationship_state.premium_quota`（週2）。Pro で生成。上限到達時は「今週のプレミアムは使い切った／普通のコンテンツは作れる／来週また」。**残数の数値は出さない**。希少性＝バースト型（spec §0）と整合、「次の1枚が見たい」を作る。

### 5-4. 公開・管理（現行ハンドラを配線）

- `publishSelected` → `content_cards` に追加。`pubCloseOnly` → `layers:['close']`、オフ → `['general']`（必要なら両方）。
- 粒度→confidence：detailed .75 / normal .60 / vague .40。
- コンテンツ管理：`deleteCard` / `openRename`(confirmRename) / `toggleCardClose`(レイヤー再割当) / `pinCard` を BE 永続化に配線。

---

## 6. 関係エンジン（実装・⑧）

### 6-1. メモリ＝文脈注入

`memory_highlights`（最近 agreed の濃い fragment）を毎ターン注入し、質問を「本人の出来事に紐づけて」具体化させる（4-5/4-6）。これが「ずっと話して相手が無変化はキツい」への直接の答え。

### 6-2. 聞き直しスケジュール

- 対象は**変わりうる型のみ**：`value`/`preference`/`trait`（`pattern`可）。`event`・基本事実は聞き直さない。
- `fragments.reask.nextEligibleAt = lastConfirmedAt + halfLifeDays`（価値観180日 ≒ 半年など）。
- 期限到来を `reask_due` に積み、**「話す」内**で自然に差し込む（別画面にしない）。古い答えは伏せて聞く。
- 実装：日次の軽いジョブ or ターン処理時の遅延評価で `reask_due` を更新。

### 6-3. 変化のコンテンツ化（メーターなしで成長を見せる）

```
新答え vs reask.history
  ├ 同じ → confidence強化、nextEligibleAt 先送り、history追記
  └ 変化 → 古いものは「間違い」にせず evolved。新versionを作る
           → これ自体が contrast フォーマットの濃いプレミアム候補
              「半年前のあなたはこう言ってた。今はこう。」
```
関係エンジンが時間をかけてコンテンツエンジンを養う（⑧→⑦）。「解像であって充填でない」の対人版。

---

## 7. 共有＆受け手View（実装）

- `share_links`：`scope`(profile|content)・`layer`(general|close)・`token`。トークンは**推測困難**（≥16文字, URLセーフ乱数。現行6文字は不可）。`revoked` で失効（現行 `shareRefresh` を配線）。
- 公開レンダリング：`GET /s/:token` → 該当 user の `content_cards` を `layer` で絞って受け手View（未インストール可）。`profile_private` でも、有効な共有リンク経由なら該当レイヤーのみ閲覧可。
- コンテンツ単体共有：`GET /c/:token`（現行 `openContentShare`）。
- OGP：受け手Webの肝。サーバーで統一フォーマットの OGP 画像を生成（MVPは静的テンプレでも可、`lore_gaps A-4🔴`）。
- 受け手の「つくる」(onMakeOwn) → welcome へ（招待ループ、spec §10 最重要仮説の計測ポイント）。

---

## 8. 最小ともだち申請（残す分だけ）

- **作るのは「申請受信→プロフィール表示→承認」だけ**。`friend_requests`(status: incoming|accepted)。
- FE：`incomingRequests` を相手プロフィール/プロフィール上の「ともだち」UIに出し、`acceptRequest` のみ配線。
- **フォロー・通知・一覧・ブロックは作らない**（ノイズ）。現行の `sendFriendRequest` の送信導線・`friendsListOpen` 一覧・`blockUser` 等はFEから除去（§11）。

---

## 9. API一覧（FE↔BE 配線）

| 現行ハンドラ | エンドポイント | モデル |
|---|---|---|
| `onStart` / `enterNew` | `POST /session` （onboarding|home開始） | Flash |
| `send` / `advance` | `POST /session/:id/turn { text, inputMode }` | Flash/Pro |
| `reactAgree/Unsure/Disagree` | `POST /session/:id/react { fragmentId, kind }` | Flash/Pro |
| ハズレ型選択 | `POST /miss { fragmentId, type, detail? }` | Pro(re-strike) |
| `finishOnboarding` | `POST /session/:id/firstlore`（初回lore確定） | — |
| `onNudge` | `POST /nudge` → 未提示fragment 1件 | — |
| `goGenerate`（候補取得） | `GET /candidates` | Flash |
| `confirmCandidate` | `POST /content/generate { seedId, granularity }` | Flash選定+Pro生成 |
| `regenWithGran` | `POST /content/regenerate { id, granularity }` | Pro |
| `publishSelected` | `POST /content/publish { ...card, layers }` | — |
| `deleteCard/confirmRename/toggleCardClose/pinCard` | `PATCH/DELETE /content/:id` | — |
| `goShare` / `shareRefresh` | `POST /share { scope, layer }` / `POST /share/:token/revoke` | — |
| `onSearch` → public | `GET /s/:token`（受け手View） | — |
| `acceptRequest` | `POST /friends/:id/accept` | — |
| プロフィール取得 | `GET /me`（cards/resolution/private等） | — |

> 認証はデモ単一ユーザーでよい（`maruyama`）。本実装の主役ではない（§0）。

---

## 10. 「APIキーで動かす」手順

```
1. DB 用意：Postgres か SQLite。マイグレーション実行（§2 DDL）。
2. デモユーザー seed：u_maruyama / @maruyama / displayName 丸山 / bio。
3. .env に DEEPSEEK_API_KEY と LLM_MODEL_PRO/FLASH、DATABASE_URL を設定。
4. BE 起動（orchestrator API）。
5. FE：LORE.dc.html の state 操作を §9 の API 呼び出しに差し替え（fetch ラッパ1枚）。
6. ブラウザで welcome → はじめる → 実LLM会話が回り、strikeが出て、内面モデルがDBに溜まる。
```

これで「キー1本挿せば動く」が成立。会話・言い当て・候補・コンテンツ生成が全て実LLM、状態はDB永続。

---

## 11. 現行プロトタイプからの移行（ノイズ除去ガイド）

**FEから除去（ノイズ）：**
`notifList` と notif 画面 / `goNotif` ・ `hiddenUsers` ・ `removeFromHistory` ・ `blockedUsers` ・ `blockUser/unblockUser` ・ `msgMuted/toggleMute` ・ `friendsListOpen` 一覧 ・ フォロー文言（通知文「フォローしました」）。

**BE配線に置換：**
`script/homeScript/seedCandidates/genMap/seedCards/readPool` → 全て §9 API。`react` の固定resolution → §3-6 導出。

**最小で残す：**
`incomingRequests` + `acceptRequest`（申請受信表示と承認）。

**矛盾解消（lore_gaps G）：**
publish二系統は `publishSelected` に一本化、`publish(layer)` は削除。確信度メタの数値露出（`READ · 0.75`）は §9 の方針に合わせ要再確認。

---

## 12. 段階導入（Phase）

| Phase | 中身 | 使うLLM |
|---|---|---|
| **P0** | 会話→strike→反応→内面モデルDB蓄積。1枚のloreで「ゾクッ」を単体検証 | Flash＋Pro |
| **P1** | 候補→フォーマット選定→生成→公開／レイヤー／共有リンク＋受け手View（OGP） | ＋選定/生成 |
| **P2** | 聞き直し（⑧）→変化のcontrastコンテンツ／招待ループ計測 | — |
| **P3** | プレミアム拡充（フォーマット増）／課金／共通点抽出 | — |

---

## 13. 未決事項（実装前に決める）

- 🟡 `STRIKE_THRESHOLD` / `STRIKE_PACE` / `halfLifeDays` の実値（実会話でチューニング）。
- 🟡 採点を会話呼び出しに混ぜるか別呼び出しか（レイテンシ vs コスト）。Flashなら混ぜる案が有力。
- 🟡 内面モデル（②）の暗号化・最小化・保持期間（lore_gaps C🔴）。private層をどこまで保存し、いつ消すか。
- 🟡 OGP生成の実体（静的テンプレ→動的）。
- 🟡 DeepSeek の構造化出力の堅さ（json_object モードの安定度）次第で、スキーマ検証＋修復の強度を調整。
- 🟢 constellation の payload 仕様（3フォーマットで最も重い）。

---

### 本書が埋める箇所（対応表）

| 本書 | 対応 |
|---|---|
| §2 データモデルDDL | engine_design §1 を実装化、gaps B「データモデル正規化」 |
| §3 オーケストレーション | gaps A-1🔴「実AI会話/採点/strike」、`script`撤廃 |
| §4 LLM制御（Pro/Flash） | gaps B🔴「LLM連携」、ユーザー指定のモデルルーティング |
| §5 コンテンツ | engine_design §3、gaps A-2 |
| §6 関係エンジン | engine_design §4（⑧聞き直し） |
| §7 共有/受け手 | gaps A-4🔴「OGP/共有アクセス制御」 |
| §0/§8/§11 ノイズ除去 | 「非表示FE＝ノイズ」方針の徹底 |
