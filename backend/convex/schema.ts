import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// LORE データモデル（lore_implementation_spec.md §2 を Convex 化）。
// フォロー/通知テーブルは作らない（ノイズ）。柔軟なネストJSONは v.any() で持つ。

export default defineSchema({
  users: defineTable({
    clerkId: v.optional(v.string()),     // Clerk のユーザーID（認証の起点・RC appUserID と一致させる）
    userId: v.string(),                  // 公開ハンドル @maruyama
    displayName: v.string(),
    bio: v.string(),
    avatar: v.string(),
    profilePrivate: v.boolean(),
  })
    .index('by_clerk', ['clerkId'])
    .index('by_handle', ['userId']),

  // ① 会話ログ（不変）
  turns: defineTable({
    userId: v.id('users'),
    sessionId: v.id('sessions'),
    role: v.string(),
    type: v.string(),
    text: v.string(),
    inputMode: v.optional(v.string()),
    refs: v.optional(v.any()),
  }).index('by_session', ['sessionId']),

  // ② 内面モデル：Fragment（中核）
  fragments: defineTable({
    userId: v.id('users'),
    text: v.string(),
    type: v.string(),
    domain: v.string(),
    components: v.any(),
    confidence: v.number(),
    status: v.string(),                  // proposed|agreed|unsure|corrected|retired
    evidence: v.array(v.string()),
    reactions: v.any(),
    scores: v.optional(v.any()),
    timeData: v.optional(v.any()),
    contourId: v.optional(v.id('contours')),
    recency: v.optional(v.any()),
    reask: v.optional(v.any()),
  })
    .index('by_user', ['userId'])
    .index('by_user_status', ['userId', 'status'])
    .index('by_user_domain', ['userId', 'domain']),

  misses: defineTable({
    fragmentId: v.id('fragments'),
    type: v.string(),
    detail: v.optional(v.string()),
    resolvedFragmentId: v.optional(v.id('fragments')),
  }).index('by_fragment', ['fragmentId']),

  contours: defineTable({
    userId: v.id('users'),
    label: v.string(),
    domain: v.string(),
    material: v.number(),
    struck: v.number(),
    gaps: v.optional(v.any()),
  }).index('by_user_domain', ['userId', 'domain']),

  // ③ 公開ビュー
  contentSeeds: defineTable({
    userId: v.id('users'),
    sourceFragmentIds: v.array(v.string()),
    domain: v.string(),
    suggestedFormat: v.string(),
    title: v.string(),
    summary: v.string(),
    status: v.string(),                  // candidate|deleted|published
  }).index('by_user_status', ['userId', 'status']),

  contentCards: defineTable({
    userId: v.id('users'),
    seedId: v.optional(v.string()),
    format: v.string(),
    title: v.string(),
    body: v.string(),
    payload: v.optional(v.any()),
    conf: v.number(),
    layers: v.array(v.string()),         // ['general'] | ['close'] | both
    isPremium: v.boolean(),
    cover: v.optional(v.string()),
    images: v.optional(v.any()),
    pinned: v.boolean(),
  }).index('by_user', ['userId']),

  shareLinks: defineTable({
    token: v.string(),
    userId: v.id('users'),
    scope: v.string(),                   // profile|content
    contentId: v.optional(v.string()),
    layer: v.string(),                   // general|close
    revoked: v.boolean(),
  }).index('by_token', ['token']),

  relationshipState: defineTable({
    userId: v.id('users'),
    totalSessions: v.number(),
    totalTurns: v.number(),
    knownDomains: v.array(v.string()),
    inputModeRatio: v.any(),
    premiumQuota: v.any(),
    memoryHighlights: v.array(v.string()),
    reaskDue: v.array(v.string()),
    preferences: v.optional(v.any()),   // 受信ダイヤル: {strikeIntensity, boundariesNg[], tone, intro:{missWelcomeShown}}
  }).index('by_user', ['userId']),

  sessions: defineTable({
    userId: v.id('users'),
    mode: v.string(),                    // onboarding|home
    lastMove: v.string(),
    lastDomain: v.string(),
    domainRepeat: v.number(),
    turnsSinceStrike: v.number(),
    pendingFragment: v.optional(v.id('fragments')),
    turnCount: v.number(),
  }).index('by_user', ['userId']),

  // 最小ともだち申請（受信表示＋承認のみ。フォロー/通知は無し）
  friendRequests: defineTable({
    toUser: v.id('users'),
    fromUser: v.string(),
    fromName: v.string(),
    status: v.string(),                  // incoming|accepted
  }).index('by_to', ['toUser']),

  // 権利（RevenueCat が真実の源。Stripe(web)購入もRC経由 or webhookで同期）
  entitlements: defineTable({
    userId: v.id('users'),
    isPremium: v.boolean(),
    store: v.optional(v.string()),       // app_store|play_store|stripe
    productId: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
    willRenew: v.optional(v.boolean()),
    updatedAt: v.string(),
  }).index('by_user', ['userId']),
});
