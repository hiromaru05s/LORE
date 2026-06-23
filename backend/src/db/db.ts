import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const db = new Database(config.dbFile);
// WAL はネットワーク/一部マウントFSで I/O エラーになるため、可能なら使い、駄目なら既定に落とす。
try { db.pragma('journal_mode = WAL'); } catch { try { db.pragma('journal_mode = TRUNCATE'); } catch {} }
try { db.pragma('foreign_keys = ON'); } catch {}

/** スキーマ適用（冪等）。 */
export function migrate() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
}

// ── JSON 列ヘルパ ───────────────────────────────────────────────
export const J = {
  enc: (v: any) => (v === undefined || v === null ? null : JSON.stringify(v)),
  dec: (v: any, fallback: any = null) => {
    if (v === null || v === undefined) return fallback;
    try { return JSON.parse(v); } catch { return fallback; }
  },
};

export const now = () => new Date().toISOString();
