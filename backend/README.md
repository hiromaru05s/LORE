# LORE backend

`lore_implementation_spec.md` / `lore_engine_design.md` を実装したバックエンド。
**APIキーを1本挿せば実LLMで動く**。未設定なら自動で **mock モード**（キー無しで全パイプラインが動く）で起動する。

主役は内部データモデル・会話設計・LLM制御。BE＋DB はそれを動かす器。

## 動かす（最短）

```bash
cd backend
npm install
cp .env.example .env        # そのままでも mock で起動する
npm run migrate             # SQLite スキーマ作成
npm run seed                # デモユーザー @maruyama を作成
npm start                   # http://localhost:8787
```

`/health` を叩くと `mode: "mock"`（キー未設定）か `mode: "live"`（キー設定済）が返る。

## 本物のLLMに切り替える（キーを挿すだけ）

`.env` に DeepSeek のキーを入れる。これだけで mock → 実LLM(DeepSeek, OpenAI互換)に自動で切り替わる。

```
DEEPSEEK_API_KEY=sk-...          # ← これが唯一の必須
DEEPSEEK_BASE_URL=https://api.deepseek.com
LLM_MODEL_PRO=deepseek-...       # 言い当て・コンテンツ生成（いいLLM）
LLM_MODEL_FLASH=deepseek-...     # 会話・採点・候補・選定（安いLLM）
```

> モデルルーティング（spec §4-1）：会話/採点/候補/選定 = **Flash**、言い当て(strike)/コンテンツ生成 = **Pro**。
> プロバイダは `src/llm/provider.ts` で抽象化済み。Claude/OpenAI へ載せ替えてもロジックは不変。

## E2E を見る（mock で会話が回る）

```bash
DATABASE_FILE=/tmp/lore_sim.db npx tsx test/sim.ts
```

オンボーディング会話 → 言い当て → 反応(そうかも/違う) → ハズレ回復 → 内面モデル蓄積 →
コンテンツ候補 → 生成 → 公開 → 共有リンク → 受け手View → 聞き直し(⑧) までを1回で通す。

## 構成

```
src/
  config.ts            env / mock判定 / 調整パラメータ(TUNING)
  types.ts             データモデル型
  db/                  SQLite・スキーマ・migrate・seed・リポジトリ層
  llm/
    provider.ts        統一LLM呼び出し（DeepSeek実体 + mock切替）
    prompts.ts         system / 手ごと指示 / 文脈組み立て（spec §4-3/4-5/4-6）
    schemas.ts         Zod 構造化出力スキーマ（spec §4-4）
    mock.ts            キー無しで動かすための擬似生成
  engine/
    scoring.ts         3軸採点（Flash）
    beliefStore.ts     fragment/contour/miss 更新（信念改訂）
    controller.ts      decideMove + 入力モード（tap/choice_free/free）
    generate.ts        手の文面生成 / strike(Pro) / 再strike
    orchestrator.ts    handleTurn メインループ / react / miss / nudge
    resolution.ts      信念ストアからの resolution 導出（メーター非表示）
    content.ts         候補生成 / フォーマット選定 / 生成(Pro) / 公開 / プレミアム枠
    share.ts           共有リンク / 受け手View
    relationship.ts    記憶注入 / 聞き直しスケジュール（⑧）
  index.ts             express ルート（spec §9）
web/loreApi.js         FE(LORE.dc.html)用の薄いクライアント
```

## API（抜粋・spec §9）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/session` | セッション開始（onboarding/home） |
| POST | `/session/:id/turn` | ユーザー発話→次のAIターン |
| POST | `/session/:id/react` | そうかも/わからない/違う |
| POST | `/session/:id/miss` | ハズレ型の選択→当て直し |
| POST | `/nudge` | TAP TO RESOLVE |
| GET | `/candidates` | コンテンツ候補 |
| POST | `/content/generate` | フォーマット選定＋生成 |
| POST | `/content/publish` | 公開（レイヤー/プレミアム） |
| POST | `/share` / `/share/:token/revoke` | 共有リンク発行/失効 |
| GET | `/s/:token` | 受け手View |
| GET | `/me` | 自分のプロフィール（cards/resolution/申請） |
| POST | `/friends/:id/accept` | ともだち申請の承認（最小） |

## スコープ（ノイズ除外）

フォロー・通知は**作らない**（存在しない）。ともだち申請は「受信表示＋承認」だけ。
詳細は `lore_implementation_spec.md` §0 / §8 / §11。

## 注意

- 調整値（strike閾値・pace・聞き直し半減期）は `src/config.ts` の `TUNING`。実会話でチューニングする。
- 内面データはセンシティブ。暗号化・保持期間は今後（spec §13 / lore_gaps C🔴）。
- SQLite の WAL が使えない環境では自動で TRUNCATE journal に落とす。
