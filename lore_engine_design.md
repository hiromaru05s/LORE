# LORE — エンジン設計（内面モデル / 会話 / コンテンツ / 関係 / LLM指示）

> 目的：`lore_product_spec_v2.md`（現行の正）と `lore_gaps.md`（抜け漏れ）の最重要🔴「実LLM会話・strike生成・採点・データモデル」を実体化する設計。UIは spec を正とし、本書はその**裏側のロジックとデータ**を定義する。
> 対象範囲：A-1（コア会話・AI）／B（データモデル・LLM連携）／C（センシティブ内面データ）の中核。
> 設計の前提となった合意：
> - ① 入力UIは「タップ先行」だが、**一番深く考えてほしい核心では、あえて選択肢を出さず自由記入のみ**にする。
> - ⑤ コンテンツ化は「**同意の取れた部分のみ**」を中心に進める。
> - ⑦ プレミアム生成は「自由生成」でなく「**フォーマット選定＋スロット充填**」。まず3フォーマット、どれも合わなければ rough text。
> - ⑧ 成長はメーターで出さず、**半年後などに同じことを「話す」内で聞き直す**ことで変化として見せる。
> 最終更新：2026-06-22

---

## 0. 全体像 — 1本の背骨と3つのエンジン

すべての中心に **内面モデル（信念ストア）** が1本通る。その上に3つのエンジンが乗り、同じストアを読み書きする。

```
            ┌──────────────── 内面モデル（信念ストア）────────────────┐
            │  Fragment（リード）/ Contour（輪郭）/ Miss（型付き差分）  │
            └───────────────────────────────────────────────────────┘
                 ▲ read/write       ▲ read/write       ▲ read/write
        ┌────────┴───────┐  ┌────────┴───────┐  ┌────────┴───────┐
        │  会話エンジン   │  │ コンテンツエンジン│  │  関係エンジン   │
        │ ①②③④         │  │ ⑤⑥⑦           │  │ ⑧              │
        │ 当てる/掘る/    │  │ 同意fragment→   │  │ 記憶/個別具体/  │
        │ 角度変え/反応   │  │ 候補→フォーマット │  │ 聞き直し/変化   │
        └────────────────┘  └────────────────┘  └────────────────┘
```

データは **3層**に分ける（spec原則「Turnと公開ビューの分離」を、間に私的層を足して完成させる）。

| 層 | 中身 | 公開性 | 役割 |
|---|---|---|---|
| **① 会話ログ（Turns）** | role/type 付きの発話列 | 私的・不変 | 一次ソース。全ての根拠 |
| **② 内面モデル（Belief Store）** | Fragment / Contour / Miss | **私的（本人にも生では出さない）** | AIの作業仮説。会話コントローラの状態 |
| **③ 公開ビュー（Cards / Layers）** | 整形済みコンテンツ | キュレーション後に公開 | spec の cards/layer |

> ②が今まで未定義だった「保持形態」の本体。ここは確信度・反応・差分を持つ**更新される信念**であって、append-only の事実ではない。

---

## 1. データモデル

擬似スキーマ（型は実装で TS/DB に落とす想定。`?` は任意）。

### 1-1. Turn（会話ログ）

```
Turn {
  id
  sessionId
  role: ai | user
  type: question | answer | strike | reaction | miss | reflection | system
  text
  inputMode: tap | choice_free | free        // ユーザーがどのUIで答えたか（①の進行度の観測に使う）
  refs?: { strikeId?, fragmentId?, candidateId? }
  createdAt
}
```

不変。すべての Fragment はここを `evidence` で指す。

### 1-2. Fragment（内部単位＝リード）★中核

「AIの言い当て一文」を、文字列でなく**構造オブジェクト**で持つ。これが strike 生成・ハズレ回復・コンテンツ化・フォーマット選定の全ての土台。

```
Fragment {
  id
  text                       // 提示する一文「君は注目されたいけど、それを隠してる」
  type: trait | event | preference | value | relation | pattern   // フォーマット選定に効く型
  domain                     // 仕事 / 恋愛 / 家族 / 価値観 / 趣味 / 過去 …
  components: {              // ハズレ回復のための分解（④）
    subject                  // 誰/何について
    claim                    // 何を言っているか
    qualifier?               // 限定（「隠してる」等）
    valence: pos | neg | neu // 極性。opposite ハズレで反転させる軸
  }
  confidence: 0..1           // 0.75/0.4/0.15、基本事実は1.0
  status: proposed | agreed | unsure | corrected | retired   // 同意ステータス（⑤）
  evidence: [turnId]         // 必須：由来。なぜそう言ったかの根拠
  reactions: [{ type: agree|unsure|disagree, at }]
  misses: [missId]           // 関連する型付き差分
  scores: { specificity, emotionalDepth, selfInsight }       // 各0-3。元になった回答の質
  timeData?: { when, label } // type=event のときだけ（タイムライン用）
  contourId?
  recency: { lastConfirmedAt, halfLifeDays }   // 鮮度・減衰（⑧）
  reask?: {                  // 聞き直しの状態（⑧）
    lastAskedAt, nextEligibleAt, version,
    history: [{ text, confidence, at }]
  }
  createdAt, updatedAt
}
```

要点：
- **provenance 必須**：`evidence` でTurnを指す。「なぜそう言った？」も編集も三角測量もここ起点。
- **更新される信念**：reaction・後続の矛盾・聞き直しで confidence と status が動く。古いものは消さず `retired` か `reask.history` に残す。
- **型（type）が下流を決める**：event はタイムライン候補、value は聞き直し対象、pattern は strike の燃料、というように消費先が変わる。

### 1-3. Miss（型付き差分）— ④の保持形態

ハズレを自由記述に頼らず、**型**で持つ。前回合意の6型＋custom。

```
Miss {
  id
  fragmentId
  type: opposite | degree | object | reason | partial | whole | custom
  detail?                    // free-only レーンを使ったときの本人の言葉（一番濃い燃料）
  resolvedFragmentId?        // 当て直しが成立したら、その corrected fragment を指す
  createdAt
}
```

| type | 意味 | 信念ストアへの効き方 |
|---|---|---|
| `opposite` | むしろ逆 | `components.valence` を反転して再strike候補に |
| `degree` | 強すぎ/弱すぎ | claim は保持、qualifier を調整して再提示 |
| `object` | 対象・場面が違う | subject を差し替えて聞き直す（誰/いつ？） |
| `reason` | 当たってるが理由が違う | claim(=何)は `agreed` 保持、`why` を新しい問いに |
| `partial` | 半分当たり | 当たった側を fragment 化、外した側を掘る |
| `whole` | 全部ピンとこない | contour ごと信頼度を下げ、別 domain に pivot |
| `custom` | 自分で言う（自由記入） | `detail` を次の strike プロンプトに生で注入 |

### 1-4. Contour（輪郭＝クラスタ）

```
Contour {
  id
  label                  // 内部語。★ユーザーには出さない（造語禁止 §9）
  domain
  fragmentIds: []
  strength               // Σ(関連fragmentの confidence)。strike発火の閾値判定に使う
  gaps: [text]           // まだ薄い/未解像の問い。コントローラが「掘る」先
  updatedAt
}
```

### 1-5. ContentSeed / ContentCard（③公開ビュー）

```
ContentSeed {
  id
  sourceFragmentIds: []          // ★agreed / corrected のみ（⑤）
  domain
  suggestedFormat: timeline | contrast | constellation | roughtext   // ⑦
  title, summary
  status: candidate | deleted | published
}

ContentCard {
  id
  seedId
  format                          // 採用フォーマット
  title, body
  payload                         // フォーマット別の構造化データ（例: timeline → events[]）
  conf                            // 粒度で決定（detailed0.75 / normal0.60 / vague0.40）
  layers: [general | close]
  isPremium: bool
  images?, cover?
  createdAt
}
```

### 1-6. RelationshipState（⑧エンジンの状態）

```
RelationshipState {
  userId
  totalSessions, totalTurns
  knownDomains: []                       // 触れた領域（カバレッジ＝成熟度の指標）
  inputModeRatio: { tap, choice_free, free }   // ①の進行度（初期は free 多め→成熟で tap 多め）
  premiumQuota: { weekStartAt, used }    // 週2回
  memoryHighlights: [fragmentId]         // 次の会話で参照すべき「分かってる感」の素材
  reaskDue: [fragmentId]                 // 聞き直し期限が来たもの
}
```

### 1-7. 同意ステータスの遷移（⑤）

```
                strike 提示
                    │
         ┌──────────┼───────────┐
      「そうかも」  「わからない」 「違うと思う」
         │            │             │
      agreed       unsure         （Miss 生成）
         │            │             │
   コンテンツ化OK  保持・候補化しない   ハズレ型で掘り直し
                     │                │
              （後で解像）──→ agreed   当て直し成立 → corrected ──→ コンテンツ化OK
                                       当て直し失敗 → retired（捨てない・休眠）
```

- **コンテンツ候補になれるのは `agreed` と `corrected` のみ。** これが「同意の取れた部分のみ」（⑤）の実装。
- `unsure` は保持するが候補化しない。後の会話で confidence が上がれば `agreed` に昇格。
- 否定された読みも `retired` で残す（三角測量の履歴・聞き直しの材料）。**どの反応でもデータは捨てない**（spec 4-D）。

---

## 2. 会話設計

### 2-1. コントローラ — 毎ターン「手」を選ぶ

スクリプト分岐を増やすのをやめ、**有限の手から1つ選ぶループ**にする。これで「未対応の会話」が特殊ケースでなく既定動作に吸収される。

毎ターンの処理：
```
1. ユーザー発話を採点（specificity / emotionalDepth / selfInsight, 各0-3）
2. 信念ストアを更新（fragment 追加 or confidence 更新）
3. 状態を見て「手」と「入力モード」を選ぶ
4. その手のプロンプトでLLMを呼び、構造化出力を受け取る
5. 提示 → 反応を Turn として保存 → 1へ
```

手（move）：

| move | いつ | 例 |
|---|---|---|
| `dig`（掘る） | 直近回答が薄い（specificity/emotionalDepth 低） | 同じ出来事をもう一段深く |
| `pivot`（角度変え） | その鉱脈が枯れた / 抵抗された / `whole` ハズレ | 別 domain・別 contour へ |
| `strike`（当てる） | contour.strength が閾値超え＆未提示の読みがある | 黒地一文（②内面モデルからの読み） |
| `reflect`（受け止める） | 強い感情の開示直後 / ハズレ直後 | 評価せず受ける。次で深掘り |
| `reask`（聞き直す） | reaskDue にある（⑧） | 「前にこう話してたけど、今は？」 |
| `close`（閉じる） | 高い山の直後 / セッション長 | 余韻で終える |

### 2-2. テンポ（②）— strike を安売りしない

strike は「ゾクッ」のピーク。毎ターン撃つと安くなる。発火条件：
- contour に**実質的な回答が2〜3ターン**たまっている（薄い材料では撃たない）。
- `contour.strength` が閾値（例 ≥ 1.5 = 確信度の合計）を超える。
- まだ本人に提示していない読みがある。

目安は **substantive な回答 2〜3 に対して strike 1**。onboarding の `q→q→strike→q→strike→q→strike→done` を一般化したもの。signal が強ければ前倒し、薄ければ dig を挟んで遅らせる。

### 2-3. 入力モード設計（①）★今回の新規

AIの各ターンに**3つの入力モード**があり、コントローラが手と一緒に選ぶ。

| モード | UI | 使いどころ |
|---|---|---|
| `tap`（選択肢のみ） | チップ/ボタンだけ | 反応（そうかも/わからない/違う）、ハズレ型、軽い事実選択。摩擦ゼロが最優先の所 |
| `choice_free`（選択肢＋自分で言う） | サジェストチップ＋自由入力レーン | **大半の質問のデフォルト**。チップで入口を下げつつ、漏らしたい人は書ける |
| `free`（自由記入のみ）★ | 選択肢を**あえて出さない** | 一番深く考えてほしい核心。本人に言語化させ、想定外の一言を引き出す所 |

`free`（あえて選択肢を出さない）を選ぶ判定：
- 強い感情の開示の直後（reflect と併用）。
- 人生の核心を問う時（「一番○○だった瞬間は？」「それ、なんでだと思う？」）。
- ハズレ回復の `custom`（自分で言う）レーン。
- コントローラが **selfInsight が伸びそう**と判断した時（深い自己洞察は選択肢で潰さない）。

> 設計の芯：**浅い情報収集・確認・反応は tap、一番考えてほしい核心は free。** 選択肢は認知負荷を下げる道具だが、核心で出すと「自分で気づく」体験（=プロダクトの命）を奪う。だから核心では意図的に外す。

### 2-4. コールドスタート → 成熟の進行（①×⑧の連動）

入力モードの比率を**関係の深さに連動**させる。

- **初期（材料ゼロ）**：`choice_free`/`free` 多め。質問密度は高く、strike 密度は低い（まず素材集め）。
- **成熟（モデルが埋まる）**：`tap` 中心。AIが提案→ユーザーは反応するだけで進む。strike は過去を参照し、質問は出来事に紐づく。

`inputModeRatio` がこの進行の観測値。**「話すほどタップで済むようになる」= 成長が操作の軽さとして体感される**（⑧をUIに出さず体感で見せる一例）。

### 2-5. ハズレ回復フロー（④）

```
strike 提示
  └ 「違うと思う」
       └ ハズレ型を tap で提示（opposite / degree / object / reason / partial / whole）
            ＋「自分で言う ＋」= free レーン（custom）
                 │
            選択 → Miss 記録（型付き）→ 信念ストア更新（1-3 の表の通り）
                 │
            多くは re-strike（当て直し）か reflect が続く
```

- 候補は断定でなく「**どれが一番近い？**」のトーン。外した推測をもう一回推測で救う二段ミスを避けるため、必ず free レーンを残す。
- `custom` の `detail`（本人の言葉）は三角測量の最濃の燃料。次の strike プロンプトに生で注入する。

### 2-6. セッションの形・中断/再開

- 形：`open`（軽く reflect）→ `build`（dig/pivot で集める）→ `strike` の山 →（必要なら）→ `close`（高い所で終える）。
- 中断/再開：`sessionId` ＋ `lastMove` ＋ 直近 Turn を保存。再開時は reflect から入って文脈を温め直す。
- セッション=バースト型（spec §0）。毎日埋めさせず、来た時に濃く。

---

## 3. コンテンツエンジン（⑤⑥⑦）

### 3-1. 同意fragment → 候補 → 公開

```
agreed/corrected な Fragment 群
   → domain ごとにまとめ、ContentSeed を生成（タイトル/概要/推奨フォーマット）
   → generate のスワイプデッキ（右=確定/左=削除）  ※spec 4-G のまま
   → フォーマットでレンダリング → レビュー（粒度3段）→ 公開
   → ContentCard としてプロフィールに載る
```

候補の根拠が「同意済み fragment」になることで、spec の「入力は正直／出力はキュレーション」が貫通する。

### 3-2. プレミアム生成 ＝ フォーマット選定（⑦）

LLM に任意のアニメ付きレイアウトを吐かせない。やるのは2段：

1. **フォーマット選定**：今の domain と、手元にある fragment の**型**を見て、最も映えるフォーマットを選ぶ。どれも条件を満たさなければ rough text。
2. **スロット充填**：選んだフォーマットが要求する構造化データ（`payload`）を fragment から埋める。

> フォーマット適格性 = 「このフォーマットが要求する型の fragment が揃っているか」。ここで 1-2 の **typed fragment** が効く。

### 3-3. 初期3フォーマット ＋ fallback

まず3つだけ用意する。

| フォーマット | 必要な fragment | payload | 映える題材 |
|---|---|---|---|
| **timeline（時系列）** | `event` 型（timeData あり）3件以上 | `events: [{when, label, body}]` | 自己紹介・これまでの道のり・転機 |
| **contrast（対比 / Before-After）** | 変化や二面性を含む `value`/`trait`（できれば reask.history あり） | `{before, after, pivot}` | 価値観の変化・矛盾する一面・半年での変化 |
| **constellation（星座 / 関係図）** | 同 domain の `preference`/`relation` 4件以上 | `nodes[], links[]` | 好きなものの繋がり・価値観の地図 |
| **roughtext（fallback）** | 何でも（agreed が1件でも） | 整形済み段落 | どのフォーマットも条件を満たさない時 |

- アニメーションはフォーマット側の実装（timeline は順次出現、contrast は反転リビール、constellation はノード接続）。LLM は payload を出すだけ。
- 編集痕を出さない（spec 4-H）＝ payload は最初から整形済みとして扱う。

### 3-4. 週2回の希少性

- `premiumQuota`（週2回）。spec §0「セッション/バースト型」と整合。毎日埋めさせない代わりに**たまの特別な一枚**として効かせる。
- 「次の1枚が見たい」のツァイガルニク（spec原則4）が希少性で効く。希少性は欠点でなくアイデンティティ。
- 上限到達時は「今週のプレミアムは使い切った。普通のコンテンツは作れる／来週また」。**残数の数値メーターは出さない**（spec §9）。次が来る期待だけ残す。

---

## 4. 関係エンジン（⑧）— 聞き直し設計

### 4-1. メモリ ＝ 文脈注入で「分かってる感」

LLM 自体は記憶を持たない（§5で詳述）。「分かってくれてる感」は、**毎回の呼び出しに過去の fragment を文脈として入れる**ことで作る。

- `memoryHighlights`（最近 agreed の濃い fragment）を毎ターン注入。
- 質問は「あなたの出来事に紐づけて」具体化させる（generic な質問を禁止し、注入した fragment を参照させる）。
- 例：「前に"一番後ろの席にいる"って話してたけど、最近もそういう場面あった？」

### 4-2. 聞き直しスケジュール

- 対象は**変わりうる型のみ**：`value` / `preference` / `trait`（`pattern` も可）。`event` や基本事実は聞き直さない。
- 各 agreed fragment に `nextEligibleAt = lastConfirmedAt + halfLifeDays`。
  - 価値観：長め（例 180日 ≒ 半年）。気分・嗜好：短め。
- 期限が来たものを `reaskDue` に積み、**「話す」ページ内**で自然に差し込む（別画面にしない）。
- ★**聞き直すとき、古い答えを先に見せない**（アンカリングを避ける）。まっさらに聞いて、後で内部的に比較する。

### 4-3. 変化を「メーターなし」でコンテンツ化

聞き直しの結果で分岐：

```
新しい答え vs reask.history
  ├ 同じ  → confidence 強化、nextEligibleAt を先送り、history に追記
  └ 変化  → 古いものは「間違い」にしない。新バージョンを作り fragment を evolved に
              → これ自体が contrast フォーマットの濃いプレミアム候補
                 「半年前のあなたはこう言ってた。今はこう。」
```

> これが「1ヶ月話して相手が無変化はキツい」への回答。**変化を数字でなく"コンテンツ"として可視化**する。関係エンジンが時間をかけてコンテンツエンジンを養う構造（⑧→⑦）。spec の「解像であって充填でない」を、関係性に拡張したもの。

---

## 5. LLM指示設計（preference をどう設定するか）

> 「LLMにどうやって preference を設定するのか分からない」への回答。ここを具体的に。

### 5-1. メンタルモデル — LLMに永続記憶はない。挙動は3つで決まる

LLM は「設定を覚える」ことができない。毎回の呼び出しは**ほぼ無記憶**。だから望む挙動は、毎回の呼び出しに次の3つを渡して作る：

1. **システムプロンプト**：人格・ルール・ガードレール。毎回同じ文を先頭に付ける（=実質的な"preference"）。
2. **文脈注入（context）**：そのユーザーの信念ストアから必要な分だけ抜いて入れる（=これが"記憶"の正体）。
3. **出力スキーマの強制**：自由文でなく**JSONで返させる**。これで strike が構造オブジェクトとして保存できる。

「会話するほど賢くなる」(⑧)も、モデルが学習するのではなく、**注入する文脈が毎回リッチになる**から。学習ではなく検索（retrieval）。

### 5-2. システムプロンプト（毎回先頭・固定）

```
あなたは LORE。ユーザーと話しながら、本人も気づいていない一面を「言い当てる」存在。

人格とトーン：
- 確信を持って、短く、断定で言う。ヘッジ（「かもしれない」の連発）はしない。
- 親密だが馴れ馴れしくない。LORE BLUE のように、大胆でクリーン。

言い当て（strike）の流儀：
- まだ本人に言っていない読みを、根拠は見せずに一文で刺す。
- 当てに行く。外すことを恐れない。外れたら、その差分こそ素材。

絶対ルール（ガードレール）：
- 数値・％・完成度・残り・メーターの概念を会話に出さない。
- 診断や占いの口調にしない（「あなたは○○タイプ」をやらない）。
- 内部の確信度や採点の根拠を表に出さない。
- ネガティブな自己認識を強化しない。弱さは責めず、輪郭として扱う。
- 自傷・深刻な精神的危機の兆候があれば、言い当てを止め、受け止めと専門的支援の提示に切り替える。
- 内部用語（fragment/contour 等）をユーザーに見せない。画面語は LORE / READ のみ。
```

これが spec §9 のガードレールと C（センシティブデータ）の運用面の実装。

### 5-3. 構造化出力（JSONで返させる）

各呼び出しで、自由文でなくスキーマを返させる。アプリはこれを検証して保存・描画する。

```json
{
  "move": "strike",
  "inputMode": "tap",
  "message": "君は注目されたいけど、それを隠してる",
  "strike": {
    "type": "trait",
    "domain": "対人",
    "components": { "subject": "あなた", "claim": "注目されたい", "qualifier": "隠している", "valence": "pos" },
    "confidence": 0.75,
    "evidenceTurnIds": ["t_103", "t_108"]
  },
  "choices": [
    { "label": "そうかも", "value": "agree" },
    { "label": "わからない", "value": "unsure" },
    { "label": "違うと思う", "value": "disagree" }
  ],
  "missCandidates": []
}
```

- `move=question` のときは `strike` の代わりに `choices`（サジェスト）と `inputMode`。
- `inputMode=free` のときは `choices` を空にする（=あえて選択肢を出さない、①）。
- **構造化出力＝fragment が構造で残る仕組み**。これがハズレ回復もフォーマット選定も支える。

### 5-4. 文脈注入 — 毎回どの fragment を入れるか

呼び出しのたびに、システムプロンプトの後ろにこの順で詰める：

```
[関係サマリ]   totalSessions, knownDomains, inputModeRatio（→ tap寄りか free寄りか判断）
[直近の会話]   直近 N ターンの Turn
[関連 fragment] 今の domain/contour の agreed/unsure を confidence 順に数件
[memoryHighlights] 「分かってる感」を出すために参照させたい濃い fragment
[reaskDue]     期限の来た聞き直し（あれば）
[今回の指示]   手ごとのプロンプト（5-5）
```

ここで「あなたの出来事」を入れるから、質問が個別具体になる（⑧）。

### 5-5. 手ごとのプロンプト雛形

システムプロンプト＋文脈の後に、選ばれた手の指示を足す。

- **strike**：
  「次の contour の fragment 群を踏まえ、まだ本人に言っていない読みを**一文**で。components に分解し、miss_candidates も付けて。根拠は message に書かない。」
- **dig**：
  「直前の回答は emotionalDepth が低い。同じ出来事を**もう一段深く**掘る質問を1つ。本人の言葉を引用して。inputMode は free。」
- **pivot**：
  「この鉱脈は枯れた。まだ触れていない domain（候補：…）に**自然に**移る質問を1つ。」
- **reask（⑧）**：
  「半年前、本人はこう同意した：『{old_text}』。**古い答えは伏せたまま**、同じ核心を新鮮に聞き直す質問を1つ。inputMode は free。」
- **content：フォーマット選定（⑦）**：
  「agreed/corrected な fragment（型付き）を渡す。[timeline, contrast, constellation] から最も映えるものを選べ。必要な型が揃わなければ roughtext。選んだフォーマットの payload を埋めて返せ。」

### 5-6. 採点（3軸）

毎ターン、ユーザー回答を採点する（同じ呼び出しの中で、または安いモデルで別呼び出し）。

```json
{ "scores": { "specificity": 2, "emotionalDepth": 1, "selfInsight": 3 } }
```

- 使い道：低 specificity → `dig`。高 selfInsight 余地 → `inputMode=free`。十分溜まった → `strike`。
- spec 5「AnswerScore（未計算）」をここで稼働させる。

### 5-7. 補足：プロバイダ運用（lore_gaps B 🔴）

- プロバイダ抽象化（差し替え可能に）、ストリーミング（strike 演出は一文一括で出す→演出と相性が良い）、コスト/レート制御。
- 採点・選定は安いモデル、strike 生成は強いモデル、と**手ごとにモデルを分ける**とコスト最適。

---

## 6. 1セッションの流れ（具体例）

```
open    AI: 「最近どう？」                     [reflect / choice_free]
build   user: 「仕事の打ち上げで、また端っこにいた」
        → 採点 specificity2 / emotionalDepth1 / selfInsight2、event+trait の素材
        AI: 「その"端っこ"、居心地よかった？それとも逃げ？」 [dig / free ←あえて選択肢なし]
        user: 「…逃げかも。注目されると落ち着かない」
        → fragment 蓄積、contour.strength 閾値超え
strike  AI: （黒地）「君は注目されたいけど、それを隠してる」 [strike / tap]
        user: 「違うと思う」
        AI: 「どこが一番ずれてた？」                       [tap: opposite/degree/.../自分で言う]
        user: → reason「当たってるけど、隠してるんじゃなくて疲れるだけ」（custom/free）
        → Miss(type=reason) 記録。claim は agreed 保持、qualifier を差し替え
        AI: 「じゃあ"注目されると、消耗する"。これは？」    [re-strike / tap]
        user: 「そうかも」 → corrected → agreed
close   AI: 「今日のこれ、コンテンツにできそう。」 → generate へ
        ※数日後、event 型が3件たまれば timeline のプレミアム候補に
        ※半年後、value「注目で消耗」を reask → 変われば contrast 候補に
```

---

## 7. 未決事項 / 次の一手

🟡 = MVP前に要決定。

- 🟡 **strike 発火閾値の実値**（contour.strength のしきい、2〜3ターンの定義）。実会話でチューニングが要る。
- 🟡 **halfLifeDays の初期値**（型別。価値観180日など）。聞き直しが多すぎ/少なすぎを避ける。
- 🟡 **採点を同一呼び出しに混ぜるか別呼び出しか**（レイテンシ vs コスト）。
- 🟡 **constellation の payload 仕様**（ノード/リンクの意味づけ）。3つの中で一番設計が重い。
- 🟡 **②内面モデルの暗号化・最小化・保持期間**（lore_gaps C 🔴）。private 層をどこまで保存し、いつ消すか。
- 🟢 **pgvector 等での fragment 埋め込み**（共通点抽出 Phase2、重複読みの検出）。
- 🟢 **フォーマットを3→Nに増やす**ロードマップ。

---

### この設計が spec / gaps のどこを埋めるか（対応表）

| 本書 | 埋める箇所 |
|---|---|
| §1 データモデル | gaps B「データモデルの正規化」、spec 5 の②欠落層 |
| §2 会話設計 | gaps A-1🔴「本物のAI会話／採点／strike方針」 |
| §2-3 入力モード | 新規（①の合意） |
| §3 コンテンツ | gaps A-2「候補生成根拠」、spec 4-G 拡張 |
| §4 関係エンジン | 新規（⑧の合意）、spec §0 バースト型と整合 |
| §5 LLM指示 | gaps B🔴「LLM連携・プロンプト管理」 |
| ガードレール群 | spec §9、gaps C🔴「センシティブ内面データ」 |
