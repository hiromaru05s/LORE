-- LORE backend schema (SQLite). JSON列は TEXT に JSON 文字列で保存。
-- lore_implementation_spec.md §2 を SQLite 化。フォロー/通知テーブルは作らない（ノイズ）。

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  user_id         TEXT UNIQUE,
  display_name    TEXT,
  bio             TEXT,
  avatar          TEXT,
  profile_private INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ① 会話ログ（不変）
CREATE TABLE IF NOT EXISTS turns (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  session_id TEXT,
  role       TEXT,
  type       TEXT,
  text       TEXT,
  input_mode TEXT,
  refs       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_user ON turns(user_id);

-- ② 内面モデル：Fragment（中核）
CREATE TABLE IF NOT EXISTS fragments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  text        TEXT,
  type        TEXT,
  domain      TEXT,
  components  TEXT,
  confidence  REAL,
  status      TEXT,
  evidence    TEXT,
  reactions   TEXT,
  scores      TEXT,
  time_data   TEXT,
  contour_id  TEXT,
  recency     TEXT,
  reask       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_frag_user ON fragments(user_id);
CREATE INDEX IF NOT EXISTS idx_frag_status ON fragments(status);

CREATE TABLE IF NOT EXISTS misses (
  id                   TEXT PRIMARY KEY,
  fragment_id          TEXT,
  type                 TEXT,
  detail               TEXT,
  resolved_fragment_id TEXT,
  created_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contours (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  label       TEXT,
  domain      TEXT,
  material    REAL DEFAULT 0,
  struck      INTEGER DEFAULT 0,
  gaps        TEXT,
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contour_user_domain ON contours(user_id, domain);

-- ③ 公開ビュー
CREATE TABLE IF NOT EXISTS content_seeds (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT,
  source_fragment_ids TEXT,
  domain              TEXT,
  suggested_format    TEXT,
  title               TEXT,
  summary             TEXT,
  status              TEXT
);

CREATE TABLE IF NOT EXISTS content_cards (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  seed_id     TEXT,
  format      TEXT,
  title       TEXT,
  body        TEXT,
  payload     TEXT,
  conf        REAL,
  layers      TEXT,
  is_premium  INTEGER DEFAULT 0,
  cover       TEXT,
  images      TEXT,
  pinned      INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_user ON content_cards(user_id);

CREATE TABLE IF NOT EXISTS share_links (
  token       TEXT PRIMARY KEY,
  user_id     TEXT,
  scope       TEXT,
  content_id  TEXT,
  layer       TEXT,
  revoked     INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relationship_state (
  user_id           TEXT PRIMARY KEY,
  total_sessions    INTEGER DEFAULT 0,
  total_turns       INTEGER DEFAULT 0,
  known_domains     TEXT DEFAULT '[]',
  input_mode_ratio  TEXT DEFAULT '{"tap":0,"choice_free":0,"free":0}',
  premium_quota     TEXT,
  memory_highlights TEXT DEFAULT '[]',
  reask_due         TEXT DEFAULT '[]'
);

-- 最小ともだち申請（受信表示＋承認のみ。フォロー/通知は無し）
CREATE TABLE IF NOT EXISTS friend_requests (
  id         TEXT PRIMARY KEY,
  to_user    TEXT,
  from_user  TEXT,
  from_name  TEXT,
  status     TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- セッションの会話状態（pending strike 等の揮発状態）
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  mode          TEXT,         -- onboarding | home
  last_move     TEXT,
  last_domain   TEXT,
  domain_repeat INTEGER DEFAULT 0,
  turns_since_strike INTEGER DEFAULT 99,
  pending_fragment TEXT,
  turn_count    INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);
