# LORE backend (Convex)

確定スタックの実装。**Web=Stripe／モバイル=RevenueCat／権利はRevenueCatに集約（案A）／認証Clerk／分析PostHog／LLMはDeepSeek（Pro/Flash）／DB＋関数はConvex（Web・モバイル共有）**。

主役は**内部データモデル・会話設計・LLM制御**で、それを Convex 上で動かす。各サービスのキーを入れた分だけ機能が有効化される（graceful degrade）。

## 構成

```
convex/
  schema.ts            データモデル（全テーブル。フォロー/通知は無し＝ノイズ除外）
  auth.config.ts       Clerk 認証
  http.ts              Stripe / RevenueCat の webhook ルート
  users.ts             ensureUser / getMe / setPrivate（Clerk起点）
  conversation.ts      会話オーケストレーション（action）＋永続化（mutation/query）
  content.ts           候補→フォーマット選定→生成→公開／コンテンツ管理
  share.ts             共有リンク発行・失効・受け手View（公開query）
  entitlements.ts      権利（isPremium）。webhookが更新、publishが参照
  stripe.ts            Web決済（checkout＋webhook, "use node"）
  revenuecat.ts        モバイル決済 webhook → 権利同期
  friends.ts           最小ともだち申請（受信表示＋承認のみ）
  seed.ts              デモ用シード（npx convex run seed:seedDemo）
  lib/                 ★Convex非依存の純粋エンジン（脳みそ）。単体テスト可
    llm.ts  mock.ts  prompts.ts  schemas.ts  scoring.ts  controller.ts
    belief.ts  resolution.ts  generate.ts  content.ts  relationship.ts
    analytics.ts(PostHog)  ids.ts  tuning.ts  types.ts
  helpers.ts           Convexサーバー側の共通ヘルパ（lib＋ctx.db）
test/
  engine.test.ts       純粋エンジンの通しE2E（Convex無しで検証）
```

**設計の肝**：LLM呼び出し・DB読み書き・コントローラ判断はコード(BE)が持ち、LLMは「次の一手のJSONを作る」担当に限定。`lib/` は Convex 非依存なので、ここだけ独立に型チェック＆テストできる（脳みその検証）。Convex関数はその薄いアダプタ。

## 動かす

```bash
cd backend
npm install
npm run test:engine        # ← まず脳みそを検証（mockで会話が回る。Convex不要）

npx convex dev             # Convexにログイン→デプロイ→ convex/_generated 生成＆関数起動
npx convex run seed:seedDemo   # デモユーザー @maruyama を作成（任意）
```

`convex dev` の後、クライアント（web / Expo）から Convex SDK で関数を呼ぶ。クライアントは REST ではなく Convex クライアント（`convex/react` / `convex/react-native`）を使う。

## キーを入れて有効化（graceful degrade）

Convex の env に設定（`npx convex env set KEY value`）。`.env.example` 参照。

| 機能 | キー | 未設定時 |
|---|---|---|
| 実LLM会話・生成 | `DEEPSEEK_API_KEY`（＋PRO/FLASHモデルID） | **mock**で動く |
| 認証 | `CLERK_FRONTEND_API_URL` | `ALLOW_DEV_USER=1`でデモユーザーにフォールバック |
| Web決済 | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | checkout無効・webhook no-op |
| モバイル決済/権利 | `REVENUECAT_WEBHOOK_AUTH` | webhook no-op |
| 分析 | `POSTHOG_API_KEY` | capture no-op |

→ **DeepSeekキー＋`convex dev`だけで会話は実LLMで回る**。Stripe/RC/Clerk/PostHogは後から挿すほど機能が増える。

## 主な関数（クライアントから呼ぶ）

| 種別 | 関数 | 用途 |
|---|---|---|
| mutation | `users.ensureUser` | ログイン時に users 行を作成（Clerk起点） |
| action | `conversation.startSession` | セッション開始 |
| action | `conversation.sendTurn` | 発話→次のAIターン |
| action | `conversation.react` | そうかも/わからない/違う |
| action | `conversation.miss` | ハズレ型→当て直し |
| query | `conversation.nudge` | TAP TO RESOLVE |
| action | `content.buildCandidates` | コンテンツ候補 |
| action | `content.generate` | フォーマット選定＋本文生成 |
| mutation | `content.publish` | 公開（レイヤー/プレミアム） |
| mutation | `share.createShare` / `share.revokeShare` | 共有リンク |
| query | `share.receiverView` | 受け手View（未認証可） |
| query | `users.getMe` | 自分のプロフィール |
| query | `entitlements.isPremium` | 課金状態 |
| query/mutation | `friends.incoming` / `friends.accept` | 最小ともだち申請 |

webhook: `https://<deployment>.convex.site/stripe/webhook` ／ `/revenuecat/webhook`

## 権利の流れ（案A）

Web=自前Stripe、モバイル=RevenueCat。**RevenueCat を権利の真実の源**にし、Stripe購入は RC の Track External Purchases で取り込んで `is_premium` を一元化する。`entitlements` テーブルは両 webhook が更新し、`content.publish` のプレミアムはこれを参照する。前提：Web/モバイルで **同一 Clerk userId = RevenueCat app_user_id** を共有。詳細は `../lore_payments_platform_research.md`。

## 注意
- `convex/lib` のみ `npm run typecheck` で型チェックできる（Convex非依存のため）。`convex/` の関数は `convex dev` 実行時に Convex が型チェック＆codegenする。
- 調整値（strike閾値・pace・聞き直し半減期・プレミアム週2）は `convex/lib/tuning.ts`。
- 内面データはセンシティブ。暗号化・保持期間は今後（spec §13）。
