# LORE — プロジェクト現況（単一ソース）

> このファイルがプロジェクトの**唯一の状況ドキュメント**。設計の細部は最終的にコードが正。
> 最終更新：2026-06-23

---

## 0. プロダクト

**ひとことで：** AIと会話すると、AIが自分でも気づいていない自分を「言い当て（リード）」、その積み重ねが共有できる内面プロフィール = **lore** に育つ。育った lore は相手に応じて見せ方を切り替えて、アプリ未インストールの相手にもWebで共有できる。

- コア体験は「**AIに言い当てられたときのゾクッ**」一点。
- セッション（バースト）型。デイリー習慣・ストリーク・完成度ゲージは狙わない。
- ターゲット：新しい人と出会う頻度が高い層（学生／イベント常連／交流に積極的な層）。
- **ローンチ戦略：Web先行**。本格マーケはモバイルApp（Expo）が揃ってから。

### 設計原則（不変）
1. 磨くのは「AIが言い当てる体験」。
2. 価値は即時化（「3ヶ月続ければ分かる」は作らない）。
3. **入力は正直 / 出力はキュレーション**（答える瞬間に自己検閲させない）。
4. 強制力は「次の言い当てが見たい」から来させる（空の演出禁止）。
5. プロフィールはリアルな会話の"きっかけ"（代替にしない）。
6. **解像であって充填でない**：％・上限・完成度ゲージを出さない（初回lore生成までの進捗バーのみ例外）。
7. 診断アプリ／マッチングアプリ臭を出さない。ユーザー造語を画面に出さない（画面語は `LORE` / `READ`）。

---

## 1. 現在のステータス（何ができているか）

| 領域 | 状態 |
|---|---|
| **バックエンド（Convex）** | ✅ 実装済み。会話オーケストレーション／内面モデル／コンテンツ／共有／権利／最小ともだち |
| **会話エンジン（脳みそ）** | ✅ Convex非依存の純粋libに実装＋単体E2E検証済み（採点・コントローラ・strike・miss・resolution・聞き直し） |
| **LLM接続** | ✅ DeepSeek(OpenAI互換)。キー未設定なら mock 自動。Pro/Flash ルーティング（**当面は全部Flash運用**） |
| **Web FE（`LORE.dc.html`）** | ✅ バックエンド接続済み（`lore-convex.js`経由・デモfallback付き）。会話/反応/外し回復/つくる/公開/プロフィール/共有/受け手View/nudge を配線 |
| **FE仕上げ** | ✅ ブラウザ履歴・モーダルスクロールロック・二重送信防止・ダークモード変数化・maxlength・規約3言語化・デッドコード除去 |
| **認証（Clerk）** | ⬜ コードは対応済み（`auth.config`＋ensureUser）。**キー投入は未**（dev は `ALLOW_DEV_USER=1` で代替） |
| **Web決済（Stripe）** | ✅ コード済み（checkout＋webhook→entitlements）。**キー投入・商品作成は未**。ペイウォールUIは別途 |
| **モバイル決済（RevenueCat）** | ✅ コード済み（webhook→entitlements）。**Web先行のため当面不要**。モバイル時に有効化 |
| **分析（PostHog）** | ✅ サーバーcapture配線済み。**キー投入は未** |
| **ドメイン** | ✅ `yourlore.xyz`（Cloudflare）取得済み。共有URLに反映済み |
| **ホスティング/公開** | ⬜ 未（Cloudflare Pages予定）。ローカル動作確認後に実施 |
| **モバイル（Expo）** | ⬜ 後続。バックエンドは共通流用 |

### 次のアクション（最優先）
1. `cd backend && npx convex dev` → Convex URL 取得（§5）。
2. FE に URL を差して `npx serve dev_web` → **mockのまま実バックエンドで会話が回るか確認**。
3. DeepSeek キー投入 → 実LLM化＋**トークン実測（コスト試算の素材）**。
4. 以降：Clerk → Stripe → Cloudflare Pages公開。

---

## 2. 技術スタック（確定）

```
  [Web: LORE.dc.html(静的)]──┐         [Mobile: Expo(後続)]
        Cloudflare Pages      │              App Store / Play
                              ├── 同じ Convex バックエンド ──→ DeepSeek(会話/生成)
                              │         （DB＝内面モデル）
  認証: Clerk ────────────────┘
  権利: Stripe(Web) ＋ RevenueCat(モバイル) → entitlements（案A）
  分析: PostHog
```

- **バックエンド＝Convex**（Web/モバイル共有・1プロジェクト・ホスティング込み）。**APIキーは全部Convexのenvに集約**。クライアントに置くのは Convex URL と Clerk Publishable Key のみ。
- **モデルルーティング**：会話/採点/候補/選定＝Flash、言い当て(strike)/コンテンツ生成＝Pro。**当面は両方Flashに向けてコスト抑制**（env で `LLM_MODEL_PRO`=`LLM_MODEL_FLASH`）。
- **graceful degrade**：各キーを入れた分だけ機能有効化。未設定でもデモ/mockで動く。

---

## 3. 設計の要点（コアの3エンジン）

すべての中心に **内面モデル（信念ストア）** が1本。3つのエンジンが同じストアを読み書きする。

### データ3層
1. **会話ログ（turns）**：不変の一次ソース。
2. **内面モデル（fragments / contours / misses）**：AIの私的な仮説。**ユーザーにも生では出さない**。
3. **公開ビュー（contentCards / shareLinks）**：キュレーション後に公開。

### 会話エンジン
- 毎ターン状態から「手」を選ぶ：`dig`(掘る)/`pivot`(角度変え)/`strike`(当てる)/`reflect`(受け止め)/`reask`(聞き直し)/`close`。
- **入力モード**：`tap`(選択肢のみ)／`choice_free`(選択肢＋自由)／`free`(あえて選択肢を出さない＝核心を深く考えさせる)。
- **テンポ**：strikeを安売りしない（substantive回答2〜3に対し1）。
- **外し回復**：違う→ハズレ型（opposite/degree/object/reason/partial/whole/custom）→当て直し。FEは既存の自由記述を `custom` miss にブリッジ。

### コンテンツエンジン
- 同意済み fragment → 候補(seed) → **フォーマット選定**（timeline / contrast / constellation / roughtext）→ 生成(3粒度) → 公開（一般/親しい人レイヤー）。
- プレミアム生成＝週2の希少性（バースト型と整合）。権利は entitlements を参照。

### 関係エンジン（⑧）
- 記憶注入で「分かってる感」。**半年後などに同じ核心を聞き直し**、変化したら contrast コンテンツ化（メーターを出さず成長を見せる）。

---

## 4. リポジトリ構成

```
backend/                 Convex バックエンド（runbook は backend/README.md）
  convex/
    schema.ts            全テーブル（内面モデル/公開ビュー/権利/最小ともだち）
    conversation.ts      会話オーケストレーション（action）＋永続化（mutation/query）
    content.ts share.ts users.ts entitlements.ts friends.ts
    stripe.ts revenuecat.ts http.ts   決済webhook
    auth.config.ts       Clerk
    lib/                 ★Convex非依存の純粋エンジン（脳みそ・単体テスト可）
  test/engine.test.ts    純粋エンジンの通しE2E
dev_web/
  LORE.dc.html           Web FE（dc-runtime プロトタイプ＝デザインの正）
  lore-convex.js         FE↔Convex 統合クライアント（window.LoreBackend）
  support.js 画像 manifest 等
LORE.md                  ← このファイル（唯一の状況ドキュメント）
```

---

## 5. 立ち上げ手順

```bash
# 1) Convex（バックエンド＋DB＋ホスティング込み）
cd backend && npm install
npx convex dev                       # ログイン→デプロイ。URL(https://xxx.convex.cloud)を控える
npx convex env set ALLOW_DEV_USER 1  # 認証なしのデモユーザーで試す
npx convex run seed:seedDemo         # デモユーザー @maruyama（任意）

# 2) Web を繋ぐ
#   dev_web/LORE.dc.html の <head> に:
#   <script>window.LORE_CONVEX_URL = "https://xxx.convex.cloud";</script>
npx serve dev_web                    # http で配信（file:// 不可）

# 3) 実LLM化（全部Flash運用）
npx convex env set DEEPSEEK_API_KEY sk-...
npx convex env set LLM_MODEL_PRO   <flashのモデルID>
npx convex env set LLM_MODEL_FLASH <flashのモデルID>

# 純粋エンジンだけの検証（Convex不要・mockで会話が回る）
cd backend && npm run test:engine
```

### キー投入先（全部 Convex env）
| 機能 | env | 未設定時 |
|---|---|---|
| 実LLM | `DEEPSEEK_API_KEY` / `LLM_MODEL_PRO` / `LLM_MODEL_FLASH` | mock |
| 認証 | `CLERK_FRONTEND_API_URL`（＋FEに Publishable Key） | `ALLOW_DEV_USER=1` |
| Web決済 | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `APP_WEB_URL` | 無効 |
| モバイル権利 | `REVENUECAT_WEBHOOK_AUTH` | 無効 |
| 分析 | `POSTHOG_API_KEY` | no-op |

webhook URL: `https://<deployment>.convex.site/stripe/webhook` ／ `/revenuecat/webhook`

---

## 6. 課金（案A・Web先行）

- **Web＝自前Stripe／モバイル＝RevenueCat**。権利は `entitlements` テーブルに集約（両 webhook が書き込む）。
- **Web先行なら RevenueCat は不要**。Stripe webhook → entitlements で完結。モバイル追加時に RC webhook を足すだけ（手戻りゼロ）。
- **今から守る1点**：ユーザーIDを Clerk userId で安定させる（Stripe checkout の `client_reference_id` に渡す）。後でモバイル/RCが来ても同一ユーザーに紐づく。
- 規約上、モバイルのアプリ内デジタル課金は IAP(RevenueCat) が基本。Web購入済みの権利アクセスはサーバー側 entitlements で解放可。

---

## 7. ロードマップ / 未決事項

- 🔴 **内面データの暗号化・最小化・保持期間**：センシティブ。実ユーザー投入前に方針決定。
- 🟡 **DeepSeek V4 Pro/Flash の正式モデルID** と現行単価の確定（コスト試算）。
- 🟡 **ペイウォール位置**：プレミアム（週2リッチ生成）をどこから有料に。UIは別途実装中。
- 🟡 **Stripe checkout 導線**：ペイウォールUI確定後に `lore-convex.js` の `checkout` を配線。
- 🟡 **ともだち incoming の backend ソース化**：FEのフレンドUIが現状ローカルmock。`friends.incoming` 由来にすると承認が完全に効く。
- 🟢 **OGP画像のサーバー生成**（受け手Webの見栄え）。
- 🟢 **Cloudflare Pages 公開**＋`yourlore.xyz`割当（**未知パスを index.html にSPAフォールバック**＝共有リンクのディープリンク用）。本番は `npx convex deploy`。
- 🟢 **モバイル（Expo）**：`convex/react-native`＋Clerk Expo＋`react-native-purchases`(RC)＋`posthog-react-native`。実購入は development build。

---

## 8. 主要な決定ログ

- スタック確定：Convex / Clerk / Stripe(Web) / RevenueCat(モバイル) / PostHog / DeepSeek / Expo。
- 旧 Express+SQLite 実装は撤去済み（脳みそは `convex/lib` に純粋移植）。
- ノイズ除外：**フォロー・通知は作らない**。ともだちは「受信表示＋承認」だけ。
- ドメイン：`yourlore.xyz`（安価TLDで先行、必要なら後で乗り換え）。
- LLM：当面 **全部Flash**（プレミアム乱発でPro原価が膨らむのを回避）。
- ブランチ：`feat/backend`（main＝FEデモは温存）。
