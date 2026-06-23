# LORE — 決済 & マルチプラットフォーム基盤 リサーチ（2026-06）

> 目的：Web＝Stripe／モバイル＝RevenueCat の決定を前提に、料金・規約・実装・**権利(entitlement)の統合**を裏取りして、LORE（Convex＋Expo）構成への落とし込みまでまとめる。
> 調査日：2026-06-22。価格・規約は変動が速い領域なので、各数値に出典を付けた。
> 関連：`lore_implementation_spec.md`（BE）／`backend/`（実装済みエンジン）。

---

## 0. 結論（TL;DR）

1. **DBは1つを共有**。Web/モバイルは同じ backend(Convex)＋DBを叩く。プラットフォーム差はクライアント層だけ。
2. **決済はプラットフォームで分けるのが正解**（規約上の強制）：モバイル＝RevenueCat（ストア課金をラップ）、Web＝Stripe。
3. **ただし"権利"は1本化する**。RevenueCat には**自前Stripeの購入を取り込む機能（Track External Purchases）**があるので、「Webは自前Stripe Billing、モバイルはRevenueCat、でも is_premium は RevenueCat に集約」が成立する。これが推奨。
4. 周辺サービスの無料枠（君の聞いた情報）は**ほぼ全部当たってた**：Clerk 5万MRU無料（2026年2月に1万→5万へ拡大）、RevenueCat $2,500 MTRまで無料、PostHog 月100万イベント無料、Convex 月100万関数呼び出し+0.5GB無料。
5. モバイルで「IAP必須」は2025年の判例で**米国では緩んだ**（外部リンク可）が、**大半のアプリはIAPも併載が必要**で、Appleは外部購入にも手数料を取れる方向。**新規アプリの安全な既定はモバイル=IAP(RevenueCat)**のまま。

---

## 1. 全体構成

```
   ┌─────────── Clients ───────────┐
   │  Web (React/Expo Web)         │   Mobile (Expo / React Native)
   │   └ Stripe Checkout           │    └ RevenueCat SDK → App Store / Play 課金
   └──────────────┬────────────────┘
                  │ 同じ API・同じ認証(Clerk)
            ┌─────▼──────┐
            │  Convex     │  ← 1つの共有DB＋関数（信念ストア/会話/コンテンツ）
            │  (mutation/ │
            │   action)   │  ── DeepSeek (Pro/Flash)
            └─────┬──────┘
                  │ entitlement 同期(webhook)
            ┌─────▼───────────────┐
            │ RevenueCat          │ ← 課金の「真実の源」(is_premium)
            │  ├ App Store / Play │   モバイル
            │  └ Stripe(取り込み) │   Webの自前Stripe購入をimport
            └─────────────────────┘
   分析: PostHog (Web/RN両SDK)
```

---

## 2. モバイル決済：RevenueCat

### 料金（2026）
- **$2,500 MTR まで無料**、超過分に **1%**。Grow $99/mo（〜$10K MTR）、Pro $500/mo（高ボリューム＋高度分析）。
  出典：[RevenueCat Pricing](https://www.revenuecat.com/pricing) / [costbench](https://costbench.com/software/subscription-billing/revenuecat/)
- **MTR(Monthly Tracked Revenue)＝Apple/Googleの手数料を引く前の総額**で計算される点に注意（実入りに対する実効レートは1%より高く見える）。

### Expo / React Native
- `npx expo install expo-dev-client react-native-purchases react-native-purchases-ui`。コア＝`react-native-purchases`、UI(ペイウォール)＝`react-native-purchases-ui`。
- **Expo Go では実購入不可、development build が必要**（ネイティブコードのため）。Expo Go 上ではmock APIに自動置換されUIプレビューは可能。
- v9.7.6 以降、iOS/Android/Web を**同じSDK・同じ entitlement**で扱える（Web Billing は内部的にStripe）。
  出典：[RevenueCat × Expo docs](https://www.revenuecat.com/docs/getting-started/installation/expo) / [react-native-purchases (GitHub)](https://github.com/revenuecat/react-native-purchases) / [Single Expo app blog](https://www.revenuecat.com/blog/engineering/build-a-single-expo-app-with-subscriptions-on-ios-android-and-web-using-revenuecat/)

---

## 3. Web決済：Stripe

### 料金（2026）
- **決済処理：2.9% + $0.30**（カード）。
- **Stripe Billing（サブスク層）はこれに上乗せ**：Starter **0.5%** / Scale **0.8%**（定期課金額に対して）。従量(PAYG)なら **0.7%**。
  出典：[Stripe Billing Pricing](https://stripe.com/billing/pricing) / [Stripe Pricing](https://stripe.com/pricing) / [costbench](https://costbench.com/software/subscription-billing/stripe-billing/)
- つまり Web の月額サブスクは概算で **2.9% + $0.30 + 0.5〜0.8%**。少額サブスク（例 $5/月）だと $0.30 の固定費が効くので、年額プランや価格設計で吸収する設計が要る。
- 税：**Stripe Tax**（別料金）で各国の消費税/VAT/インボイスを自動化できる。越境課金するなら要検討。

---

## 4. ★権利(entitlement)の統合 ── ここが一番大事

「Webで買った人がアプリでもプレミアム」「アプリで買った人がWebでも」を成立させる設計。3案。

### 案A（推奨）：RevenueCat を"真実の源"に。Webは自前Stripe＋取り込み
- モバイル＝RevenueCat（ストア課金）。Web＝**自前のStripe Billing**で課金。
- RevenueCat の **Track External Purchases** で、RC外で起きたStripe購入を取り込み、**モバイルSDKで entitlement を解放**できる。
  出典：[RC × Stripe 連携docs](https://www.revenuecat.com/docs/web/integrations/stripe)（"Import Stripe Billing purchases that happen outside of RevenueCat, and unlock access with the RevenueCat SDK"）
- backend は「is_premium か？」を **RevenueCat に一元化して問う**だけ。Convex は RC の webhook で entitlement を同期。
- メリット：君の決定（Web=Stripe）をそのまま活かしつつ、権利は1本。Stripe側は自前なので無料トライアル/クーポン/独自チェックアウトが自由。
- 注意：RC購入フロー(Web SDK)を使う場合、**無料トライアルとクーポンは現状RCフロー内で未対応**（自前Stripe側で実装し、RCには取り込む形なら回避可）。

### 案B：RevenueCat に全部寄せる（RC Web Billing＝中身はStripe）
- Webも RevenueCat の Web Billing（Stripeが裏で動く）で課金。実装は最小、権利統合は自動。
- ただし「Web=自前Stripe」という君の方針からはズレる（Stripeを直接は触らない）。トライアル/クーポン未対応の制約も受ける。

### 案C（非推奨）：自前で突き合わせ
- Web=Stripe / モバイル=RevenueCat を**それぞれ独立**に持ち、Convex内で両方のwebhookを受けて自前で名寄せ。
- 最も自由だが、entitlementは「expired / renewing / 課金失敗中…」など状態が多く、プラットフォーム毎に名前も意味も違う。**この突き合わせは想像よりずっと重い**（RC公式も「mergeは別タスク」と明言）。出典：[Cross-platform subscriptions](https://www.revenuecat.com/blog/engineering/cross-platform-subscriptions-ios-android-web/)
- RCのimport機能がある以上、自前突き合わせを選ぶ理由は薄い。

> **結論：案A。** Web=Stripe（自前）を活かし、RevenueCat を entitlement の単一窓口にする。LORE の「プレミアム＝クロスプラットフォームのコンテンツ生成」と相性が良い。

### 前提：認証の共有が必須
クロスプラットフォーム権利は**Web/モバイルで同一ユーザーIDを共有**して初めて成立する。→ Clerk のユーザーIDを RevenueCat の `appUserID` に揃える。

---

## 5. App Store / Play 規約の現在地（なぜモバイルはIAP）

決済を分ける理由は好みでなく規約。ただし2025-2026で動いた。

- **2025/4/30**：判例で **Apple は米国ストアでIAP強制を禁止**され、**アプリ内に外部決済リンクを置ける**ように。出典：[Epic v. Apple (Wikipedia)](https://en.wikipedia.org/wiki/Epic_Games_v._Apple) / [RC: anti-steering ruling](https://www.revenuecat.com/blog/growth/apple-anti-steering-ruling-monetization-strategy/)
- ただし **大半のアプリは依然IAPの併載が必要**（完全外部のみは"リーダーアプリ"等の例外）。
- **2025/12**：第9巡回控訴裁が「**Appleは外部購入にも(27%より低い)合理的な手数料を取れる**」と判断。枠組みは地裁で確定予定。
- **2026/5**：最高裁がAppleの執行停止申立てを却下。出典：[AppleInsider](https://appleinsider.com/articles/26/05/06/supreme-court-denies-apples-hopes-for-breathing-space-in-its-fight-against-epic) / [MacRumors](https://www.macrumors.com/2026/05/21/apple-supreme-court-epic-games-case/)
- 適用対象は**アプリ内で売るデジタル財/サービス**（サブスク等）。LOREのプレミアムはここに該当。

**含意**：
- これらは主に**米国**の話で、流動的。グローバル/日本では従来どおりIAPが基本線。
- **新規アプリの安全な既定＝モバイルはRevenueCat(IAP)**。外部リンク→WebのStripeに流す最適化は、米国で手数料を見ながら**後から**足す論点（RCはこのapp→web導線も支援）。

---

## 6. 周辺サービスの現行無料枠（君の情報の答え合わせ）

| サービス | 君の認識 | 実際（2026） | 判定 |
|---|---|---|---|
| **Clerk**(認証) | 5万MAUまで無料 | **5万MRU無料**（2026/2に1万→5万へ拡大）。Pro $25/mo($20年払)で5万MRU込、超過$0.02/MRU。単位は**MRU=登録24h以降に再訪したユーザー**でMAUより緩い | ◎ 当たり |
| **RevenueCat**(モバイル決済) | $2,500まで無料 | **$2,500 MTRまで無料**、超過1% | ◎ 当たり |
| **PostHog**(分析) | 1プロジェクト無料 | **月100万イベント無料**＋録画5,000・1プロジェクト・1年保持。超過 ~$0.00005/event | ◎ 当たり |
| **Convex**(DB) | 安全・MCP・env切替 | **月100万関数呼び出し+0.5GB無料**（ハードキャップ）。Pro $25/開発者/mo。Web/Expo両SDK＋MCPあり | ◎ 妥当 |

出典：[Clerk Pricing](https://clerk.com/pricing) / [Clerk free 50k](https://saasprices.net/blog/clerk-free-plan-changes) / [Convex Pricing](https://www.convex.dev/pricing) / [Convex Limits](https://docs.convex.dev/production/state/limits) / [PostHog Pricing](https://posthog.com/pricing)

補足：**Clerk × Convex は公式インテグレーションあり**（王道の組み合わせ）。RevenueCat は **MCP も提供**（[RC MCP docs](https://www.revenuecat.com/docs/tools/mcp)）。

---

## 7. LORE実装への落とし込み

### 7-1. いま作ったコードとの接続
- `backend/` の **会話/内面モデル/LLM制御エンジンはそのまま移植**（Convexの action=LLM呼び出し、mutation/query=DB）。`repo.ts`＋Express は Convex 関数に置換。
- **`relationship_state.premium_quota`（週2制限）はプロダクト仕様として残す**。一方 **「課金者か(is_premium)」は RevenueCat の entitlement**。この2層を分離：
  - RevenueCat → 「プレミアム購読者か」
  - LOREコード → 「購読者でも週2まで」
  - 非購読者は週0（または1回お試し）など、ペイウォール位置は別途設計。

### 7-2. データの持ち方（Convex想定の追記テーブル）
```
entitlements {           // RevenueCat webhook で同期する権利キャッシュ
  userId,                // Clerk のユーザーID＝RC appUserID
  isPremium: bool,
  productId, store,      // app_store | play_store | stripe
  expiresAt, willRenew,
  updatedAt
}
```
`content.checkPremiumQuota()` は、まず `entitlements.isPremium` を見て、次に週2を見る、の順にする。

### 7-3. 認証の起点
- Clerk を Web/Expo 共通の認証に。`users.id` を Clerk userId 起点へ。RevenueCat の `appUserID` も同じ値に揃える（クロス権利の前提）。

---

## 8. ざっくりコスト感（初期〜小規模）

| 局面 | 月額の目安 |
|---|---|
| 立ち上げ（MAU〜数千、売上小） | **ほぼ$0**：Clerk無料/Convex無料/PostHog無料/RC無料($2,500 MTRまで)。Stripeは売上に対する従量のみ |
| 成長（売上が出始め） | RC 1%（$2,500超）＋Stripe実費(2.9%+$0.30+0.5%)＋各SaaSの有料移行($20〜25/mo級) |

固定費は小さく、**売上連動で増える**設計。少額サブスクは Stripe の $0.30 固定費が効くので**年額/価格設計**で吸収する。

---

## 9. 未決 / 次アクション

- 🟡 **案A/Bの最終決定**：自前Stripe（柔軟・要実装）か RC Web Billing（最小実装）。君の方針的には**案A**。
- 🟡 **ペイウォール位置**：プレミアム(週2リッチ生成)を有料の中心にするか、無料に何回与えるか（spec §5-3 / KGI）。
- 🟡 **価格・通貨・年額有無**：少額サブスクのStripe固定費対策。
- 🟡 **Convex移行設計**：`backend/` エンジン → action/mutation 分割、テーブル定義、Clerk認証配線（別途1枚に起こす価値あり）。
- 🟢 **Stripe Tax / 越境**：EN対応で課税地が増えるなら。
- 🟢 **App→Web 外部リンク導線**（米国の手数料最適化）は後続。

---

## 出典一覧

- RevenueCat 料金: https://www.revenuecat.com/pricing ／ https://costbench.com/software/subscription-billing/revenuecat/
- RevenueCat × Expo: https://www.revenuecat.com/docs/getting-started/installation/expo ／ https://github.com/revenuecat/react-native-purchases ／ https://www.revenuecat.com/blog/engineering/build-a-single-expo-app-with-subscriptions-on-ios-android-and-web-using-revenuecat/
- RevenueCat × Stripe（権利統合）: https://www.revenuecat.com/docs/web/integrations/stripe ／ https://www.revenuecat.com/blog/engineering/cross-platform-subscriptions-ios-android-web/
- RevenueCat MCP: https://www.revenuecat.com/docs/tools/mcp
- Stripe 料金: https://stripe.com/billing/pricing ／ https://stripe.com/pricing ／ https://costbench.com/software/subscription-billing/stripe-billing/
- App Store 判例: https://en.wikipedia.org/wiki/Epic_Games_v._Apple ／ https://www.revenuecat.com/blog/growth/apple-anti-steering-ruling-monetization-strategy/ ／ https://appleinsider.com/articles/26/05/06/supreme-court-denies-apples-hopes-for-breathing-space-in-its-fight-against-epic ／ https://www.macrumors.com/2026/05/21/apple-supreme-court-epic-games-case/
- Clerk 料金: https://clerk.com/pricing ／ https://saasprices.net/blog/clerk-free-plan-changes
- Convex 料金: https://www.convex.dev/pricing ／ https://docs.convex.dev/production/state/limits
- PostHog 料金: https://posthog.com/pricing
