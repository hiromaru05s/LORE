# LORE — 立ち上げ手順 ＆ 君がやるアクション

> FE(`dev_web/LORE.dc.html`)はバックエンド接続済み（`dev_web/lore-convex.js` 経由）。
> **キーを入れた分だけ機能が有効化**され、未設定なら今まで通りデモで動く（graceful degrade）。
> 依存順に並べてある。上から順にやれば、各段階で「動く状態」を保ったまま本物に近づく。

---

## 全体像（何が何に繋がるか）

```
[Web: LORE.dc.html] ─┐
                      ├─→ [Convex] ──→ DeepSeek(会話/生成) / DB(内面モデル)
[Mobile: Expo(後)] ──┘        │
   認証: Clerk ───────────────┘  権利: RevenueCat(モバイル)＋Stripe(Web) → entitlements
   分析: PostHog
```

- **バックエンド本体＝Convex**（Web/モバイル共有）。キーはConvexのenvに入れる（ブラウザに出さない）。
- **唯一クライアントに置くキー** = Convex URL と Clerk Publishable Key（公開して良い種類）。

---

## Phase 0 — Convex を立てる（最初の土台）

1. Convex アカウント作成 → `backend/` で:
   ```bash
   cd backend && npm install
   npx convex dev            # ブラウザでログイン→dev デプロイ作成。convex/_generated も生成
   npx convex run seed:seedDemo   # デモユーザー @maruyama 作成（任意）
   ```
2. `npx convex dev` が出す **Deployment URL（https://xxx.convex.cloud）** を控える。
3. まずは認証なしで試せるように:
   ```bash
   npx convex env set ALLOW_DEV_USER 1
   ```

✅ この時点で **mock LLM** で会話APIが動く（DeepSeekキーなしでも）。

---

## Phase 1 — LLM（DeepSeek）= 会話を本物にする

- DeepSeek のAPIキーを発行。**V4 Pro / Flash の正確なモデルID**を確認（ここだけ要確認）。
- Convex env に:
  ```bash
  npx convex env set DEEPSEEK_API_KEY sk-...
  npx convex env set LLM_MODEL_PRO   <deepseek V4 pro のID>
  npx convex env set LLM_MODEL_FLASH <deepseek V4 flash のID>
  ```
- 未設定なら mock のまま（壊れない）。

---

## Phase 2 — Web FE を繋ぐ

1. `dev_web/LORE.dc.html` の `<head>` のコメントを外して URL を入れる:
   ```html
   <script>
     window.LORE_CONVEX_URL = "https://xxx.convex.cloud";
     // window.LORE_CLERK_PUBLISHABLE_KEY = "pk_test_...";  // Phase 3 で
   </script>
   ```
2. **http で配信**する（`file://` だと ESモジュール/Convexが動かない）:
   ```bash
   npx serve dev_web    # 等。localhost で開く
   ```

✅ これで会話→言い当て→反応→コンテンツ生成→公開→共有が**実バックエンド**で回る（認証は dev ユーザー）。
未設定の状態（URL空）なら従来のデモのまま。

---

## Phase 3 — 認証（Clerk）

**必須セットアップは Clerk ダッシュボード**（Clerk MCP は任意。あれば管理が楽になるが、下記キー/JWT設定はダッシュボード作業）。

1. Clerk アプリ作成 → **Publishable Key** と **Frontend API URL** を取得。
2. Clerk で **JWT テンプレートを作成、名前は `convex`**（Convex連携の公式手順）。
3. 設定:
   ```bash
   npx convex env set CLERK_FRONTEND_API_URL https://verb-noun-00.clerk.accounts.dev
   npx convex env set ALLOW_DEV_USER 0     # 本物の認証に切替
   ```
   FE側: `window.LORE_CLERK_PUBLISHABLE_KEY = "pk_..."` を有効化。
4. Clerk の **Allowed origins** に Web ドメイン（localhost と本番）を登録。

> 重要: **Clerk の userId = RevenueCat の app_user_id** に揃える（クロスプラットフォーム権利の前提）。

---

## Phase 4 — 決済（Web=Stripe / モバイル=RevenueCat、権利は案A）

### Stripe（Web）
1. アカウント作成 → サブスク商品/価格(price)を作成 → **Secret Key** 取得。
2. Webhook を追加: `https://<deployment>.convex.site/stripe/webhook`
   （イベント: `checkout.session.completed` / `customer.subscription.created|updated|deleted`）→ **Webhook Secret** 取得。
3. 設定:
   ```bash
   npx convex env set STRIPE_SECRET_KEY sk_...
   npx convex env set STRIPE_WEBHOOK_SECRET whsec_...
   npx convex env set APP_WEB_URL https://lore.app
   ```

### RevenueCat（モバイル・権利の真実の源）
1. アカウント作成 → App Store / Google Play の課金商品を設定。
2. Webhook を追加: `https://<deployment>.convex.site/revenuecat/webhook`、**Authorization ヘッダ**に共有シークレットを設定 →
   ```bash
   npx convex env set REVENUECAT_WEBHOOK_AUTH <同じ値>
   ```
3. **案A**: RC ダッシュボードで Stripe アプリを連携し **External Purchase Tracking** をON → 自前Stripe購入をRCに取り込み、`is_premium` を一元化。
4. Expo 用に RC の **SDKキー**（iOS/Android）を取得（Phase 7）。

---

## Phase 5 — 分析（PostHog）

1. プロジェクト作成 → **Project API Key** 取得。
2. サーバー側計測:
   ```bash
   npx convex env set POSTHOG_API_KEY phc_...
   npx convex env set POSTHOG_HOST https://us.i.posthog.com
   ```
3. クライアント計測（任意・後で）: Web は `posthog-js`、Expo は `posthog-react-native` を別途。

---

## Phase 6 — ドメイン / ホスティング / 本番化

- **Web**（`dev_web/` 静的）: Vercel / Netlify / Cloudflare Pages 等にデプロイ。独自ドメイン（lore.app）を割当。
  - 共有リンク `/s/:token`・`/u/:id` のディープリンクのため、**未知パスは index.html にフォールバック**（SPA rewrite）する設定を入れる。
- **Convex**: 本番デプロイ `npx convex deploy` → 本番 Deployment の env を同様にセット。FE の `LORE_CONVEX_URL` を本番URLに。
- 各サービスのURL整合: Clerk allowed origins、Stripe success/cancel(`APP_WEB_URL`)、webhook URL を本番 `convex.site` に。

---

## Phase 7 — モバイル（Expo）※後続

- `convex/react-native` ＋ `@clerk/clerk-expo` ＋ `react-native-purchases`(RevenueCat) ＋ `posthog-react-native`。
- 実購入には **development build**（Expo Go 不可）。RC の app_user_id を Clerk userId に。
- バックエンド(Convex)は共通。schema/関数はそのまま使う。

---

## チェックリスト（君のアクション）

| # | やること | 取得物 | 入れる先 |
|---|---|---|---|
| 1 | Convex `npx convex dev` | Deployment URL | FE `LORE_CONVEX_URL` |
| 2 | DeepSeek キー＋モデルID確認 | API key, PRO/FLASH ID | Convex env |
| 3 | Web を http 配信＋URL設定 | — | FE head |
| 4 | Clerk アプリ＋JWTテンプレ`convex` | Publishable key, Frontend API URL | FE ＋ Convex env |
| 5 | Stripe 商品＋webhook | secret, webhook secret | Convex env / Stripe |
| 6 | RevenueCat 商品＋webhook＋Stripe取込 | webhook auth, SDK keys | Convex env / RC |
| 7 | PostHog プロジェクト | API key | Convex env |
| 8 | ドメイン＋ホスティング＋SPA fallback | — | ホスティング設定 |
| 9 | 本番 `convex deploy` ＋ env 複製 | 本番URL | FE/各サービス |

### その他（要意思決定）
- 🟡 **内面データの暗号化・保持期間**（センシティブ。spec §13 / lore_gaps C🔴）— 実ユーザー投入前に方針決定。
- 🟡 **DeepSeek V4 Pro/Flash の正式モデルID** の確定。
- 🟡 **プレミアムのペイウォール位置**（週2リッチ生成をどこから有料に）。
- 🟢 OGP画像のサーバー生成（受け手Webの見栄え）。

---

## いま繋がっている範囲（FE↔Convex）

`dev_web/lore-convex.js` 経由で接続済み。`_be()` 判定でバックエンド優先＋デモ fallback。

| FE操作 | 接続先 |
|---|---|
| はじめる / 話す | `conversation.startSession` |
| メッセージ送信 | `conversation.sendTurn`（外し回復は `miss` の custom にブリッジ） |
| そうかも/わからない/違う | `conversation.react` |
| つくる（候補表示） | `content.buildCandidates` |
| 候補確定→生成 | `content.generate` |
| 公開 | `content.publish` |
| プロフィール表示 | `users.getMe` |
| 共有リンク作成 | `share.createShare` |

未接続（次の配線候補）: コンテンツ単体共有 / 受け手View(`/s/:token`描画) / ともだち承認 / 設定の権利反映。`lore-convex.js` にメソッドは用意済みなので、各ハンドラに1行差すだけ。
