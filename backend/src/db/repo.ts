import { nanoid } from 'nanoid';
import { db, J, now } from './db';
export { now } from './db';
import type {
  Turn, Fragment, Contour, ContentSeed, ContentCard, ShareLink,
  RelationshipState, FragmentStatus,
} from '../types';

export const id = (prefix: string) => `${prefix}_${nanoid(10)}`;

// ── row mappers ────────────────────────────────────────────────
function frag(r: any): Fragment {
  return {
    ...r,
    components: J.dec(r.components, {}),
    evidence: J.dec(r.evidence, []),
    reactions: J.dec(r.reactions, []),
    scores: J.dec(r.scores, null),
    time_data: J.dec(r.time_data, null),
    recency: J.dec(r.recency, null),
    reask: J.dec(r.reask, null),
  };
}
function contour(r: any): Contour {
  return { ...r, gaps: J.dec(r.gaps, []) };
}
function card(r: any): ContentCard {
  return {
    ...r,
    payload: J.dec(r.payload, null),
    layers: J.dec(r.layers, ['general']),
    images: J.dec(r.images, null),
    is_premium: !!r.is_premium,
    pinned: !!r.pinned,
  };
}
function seed(r: any): ContentSeed {
  return { ...r, source_fragment_ids: J.dec(r.source_fragment_ids, []) };
}

// ── users ──────────────────────────────────────────────────────
export const Users = {
  get(uid: string) {
    const r: any = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
    return r ? { ...r, profile_private: !!r.profile_private } : null;
  },
  byUserId(userId: string) {
    const r: any = db.prepare('SELECT * FROM users WHERE user_id=?').get(userId.replace(/^@/, ''));
    return r ? { ...r, profile_private: !!r.profile_private } : null;
  },
  upsert(u: any) {
    db.prepare(`INSERT INTO users (id,user_id,display_name,bio,avatar,profile_private)
      VALUES (@id,@user_id,@display_name,@bio,@avatar,@profile_private)
      ON CONFLICT(id) DO UPDATE SET display_name=@display_name,bio=@bio,avatar=@avatar,profile_private=@profile_private`)
      .run({ profile_private: 1, bio: '', avatar: '', ...u });
  },
  setPrivate(uid: string, priv: boolean) {
    db.prepare('UPDATE users SET profile_private=? WHERE id=?').run(priv ? 1 : 0, uid);
  },
};

// ── turns ──────────────────────────────────────────────────────
export const Turns = {
  add(t: Partial<Turn>): Turn {
    const row = {
      id: id('t'), refs: null, input_mode: null, created_at: now(),
      ...t, refs_j: J.enc(t.refs),
    } as any;
    db.prepare(`INSERT INTO turns (id,user_id,session_id,role,type,text,input_mode,refs,created_at)
      VALUES (@id,@user_id,@session_id,@role,@type,@text,@input_mode,@refs_j,@created_at)`).run(row);
    return { ...row, refs: t.refs ?? null };
  },
  recent(sessionId: string, n = 8): Turn[] {
    const rows: any[] = db.prepare('SELECT * FROM turns WHERE session_id=? ORDER BY created_at DESC LIMIT ?')
      .all(sessionId, n);
    return rows.reverse().map(r => ({ ...r, refs: J.dec(r.refs, null) }));
  },
};

// ── fragments ──────────────────────────────────────────────────
export const Fragments = {
  add(f: Partial<Fragment>): Fragment {
    const t = now();
    const row: any = {
      id: id('f'), confidence: 0.5, status: 'proposed', domain: '', type: 'trait',
      created_at: t, updated_at: t,
      ...f,
      components: J.enc(f.components ?? {}),
      evidence: J.enc(f.evidence ?? []),
      reactions: J.enc(f.reactions ?? []),
      scores: J.enc(f.scores ?? null),
      time_data: J.enc(f.time_data ?? null),
      recency: J.enc(f.recency ?? null),
      reask: J.enc(f.reask ?? null),
    };
    db.prepare(`INSERT INTO fragments
      (id,user_id,text,type,domain,components,confidence,status,evidence,reactions,scores,time_data,contour_id,recency,reask,created_at,updated_at)
      VALUES (@id,@user_id,@text,@type,@domain,@components,@confidence,@status,@evidence,@reactions,@scores,@time_data,@contour_id,@recency,@reask,@created_at,@updated_at)`)
      .run({ contour_id: null, ...row });
    return this.get(row.id)!;
  },
  get(fid: string): Fragment | null {
    const r: any = db.prepare('SELECT * FROM fragments WHERE id=?').get(fid);
    return r ? frag(r) : null;
  },
  update(fid: string, patch: Partial<Fragment>) {
    const cur = this.get(fid); if (!cur) return;
    const merged = { ...cur, ...patch, updated_at: now() };
    db.prepare(`UPDATE fragments SET text=@text,type=@type,domain=@domain,components=@components,
      confidence=@confidence,status=@status,evidence=@evidence,reactions=@reactions,scores=@scores,
      time_data=@time_data,contour_id=@contour_id,recency=@recency,reask=@reask,updated_at=@updated_at WHERE id=@id`)
      .run({
        ...merged,
        components: J.enc(merged.components), evidence: J.enc(merged.evidence),
        reactions: J.enc(merged.reactions), scores: J.enc(merged.scores),
        time_data: J.enc(merged.time_data), recency: J.enc(merged.recency), reask: J.enc(merged.reask),
      });
  },
  byUser(uid: string, statuses?: FragmentStatus[]): Fragment[] {
    let rows: any[];
    if (statuses?.length) {
      const ph = statuses.map(() => '?').join(',');
      rows = db.prepare(`SELECT * FROM fragments WHERE user_id=? AND status IN (${ph}) ORDER BY updated_at DESC`)
        .all(uid, ...statuses);
    } else {
      rows = db.prepare('SELECT * FROM fragments WHERE user_id=? ORDER BY updated_at DESC').all(uid);
    }
    return rows.map(frag);
  },
  byDomain(uid: string, domain: string): Fragment[] {
    return db.prepare('SELECT * FROM fragments WHERE user_id=? AND domain=? ORDER BY confidence DESC')
      .all(uid, domain).map(frag);
  },
};

// ── misses ─────────────────────────────────────────────────────
export const Misses = {
  add(m: any) {
    const row = { id: id('m'), detail: null, resolved_fragment_id: null, created_at: now(), ...m };
    db.prepare(`INSERT INTO misses (id,fragment_id,type,detail,resolved_fragment_id,created_at)
      VALUES (@id,@fragment_id,@type,@detail,@resolved_fragment_id,@created_at)`).run(row);
    return row;
  },
};

// ── contours ───────────────────────────────────────────────────
export const Contours = {
  forDomain(uid: string, domain: string): Contour {
    let r: any = db.prepare('SELECT * FROM contours WHERE user_id=? AND domain=?').get(uid, domain);
    if (!r) {
      r = { id: id('c'), user_id: uid, label: domain, domain, material: 0, struck: 0, gaps: '[]', updated_at: now() };
      db.prepare(`INSERT INTO contours (id,user_id,label,domain,material,struck,gaps,updated_at)
        VALUES (@id,@user_id,@label,@domain,@material,@struck,@gaps,@updated_at)`).run(r);
    }
    return contour(r);
  },
  bump(cid: string, dMaterial: number) {
    db.prepare('UPDATE contours SET material=material+?, updated_at=? WHERE id=?').run(dMaterial, now(), cid);
  },
  markStruck(cid: string) {
    db.prepare('UPDATE contours SET struck=struck+1, material=0, updated_at=? WHERE id=?').run(now(), cid);
  },
  byUser(uid: string): Contour[] {
    return db.prepare('SELECT * FROM contours WHERE user_id=? ORDER BY material DESC').all(uid).map(contour);
  },
};

// ── content seeds / cards ──────────────────────────────────────
export const Seeds = {
  replaceCandidates(uid: string, seeds: Partial<ContentSeed>[]) {
    db.prepare("DELETE FROM content_seeds WHERE user_id=? AND status='candidate'").run(uid);
    const ins = db.prepare(`INSERT INTO content_seeds (id,user_id,source_fragment_ids,domain,suggested_format,title,summary,status)
      VALUES (@id,@user_id,@source_fragment_ids,@domain,@suggested_format,@title,@summary,'candidate')`);
    const out: ContentSeed[] = [];
    for (const s of seeds) {
      const row = { id: id('s'), user_id: uid, domain: '', suggested_format: 'roughtext', title: '', summary: '', ...s,
        source_fragment_ids: J.enc(s.source_fragment_ids ?? []) };
      ins.run(row); out.push(seed({ ...row, status: 'candidate' }));
    }
    return out;
  },
  get(sid: string): ContentSeed | null {
    const r: any = db.prepare('SELECT * FROM content_seeds WHERE id=?').get(sid);
    return r ? seed(r) : null;
  },
  candidates(uid: string): ContentSeed[] {
    return db.prepare("SELECT * FROM content_seeds WHERE user_id=? AND status='candidate'").all(uid).map(seed);
  },
  setStatus(sid: string, status: string) {
    db.prepare('UPDATE content_seeds SET status=? WHERE id=?').run(status, sid);
  },
};

export const Cards = {
  add(c: Partial<ContentCard>): ContentCard {
    const row: any = {
      id: id('k'), seed_id: null, format: 'roughtext', conf: 0.6, cover: null,
      created_at: now(), ...c,
      payload: J.enc(c.payload ?? null), layers: J.enc(c.layers ?? ['general']), images: J.enc(c.images ?? null),
      is_premium: c.is_premium ? 1 : 0, pinned: c.pinned ? 1 : 0,
    };
    db.prepare(`INSERT INTO content_cards (id,user_id,seed_id,format,title,body,payload,conf,layers,is_premium,cover,images,pinned,created_at)
      VALUES (@id,@user_id,@seed_id,@format,@title,@body,@payload,@conf,@layers,@is_premium,@cover,@images,@pinned,@created_at)`).run(row);
    return this.get(row.id)!;
  },
  get(kid: string): ContentCard | null {
    const r: any = db.prepare('SELECT * FROM content_cards WHERE id=?').get(kid);
    return r ? card(r) : null;
  },
  byUser(uid: string): ContentCard[] {
    return db.prepare('SELECT * FROM content_cards WHERE user_id=? ORDER BY pinned DESC, created_at DESC')
      .all(uid).map(card);
  },
  update(kid: string, patch: Partial<ContentCard>) {
    const cur = this.get(kid); if (!cur) return;
    const m = { ...cur, ...patch };
    db.prepare(`UPDATE content_cards SET title=@title,body=@body,payload=@payload,conf=@conf,layers=@layers,
      is_premium=@is_premium,cover=@cover,images=@images,pinned=@pinned WHERE id=@id`).run({
      ...m, payload: J.enc(m.payload), layers: J.enc(m.layers), images: J.enc(m.images),
      is_premium: m.is_premium ? 1 : 0, pinned: m.pinned ? 1 : 0,
    });
  },
  remove(kid: string) { db.prepare('DELETE FROM content_cards WHERE id=?').run(kid); },
};

// ── share links ────────────────────────────────────────────────
export const Shares = {
  create(s: Partial<ShareLink>): ShareLink {
    const token = nanoid(22);   // 推測困難（spec §7: 6文字→不可）
    const row: any = { token, content_id: null, layer: 'general', created_at: now(), scope: 'profile', ...s, revoked: 0 };
    db.prepare(`INSERT INTO share_links (token,user_id,scope,content_id,layer,revoked,created_at)
      VALUES (@token,@user_id,@scope,@content_id,@layer,@revoked,@created_at)`).run(row);
    return { ...row, revoked: false };
  },
  get(token: string): ShareLink | null {
    const r: any = db.prepare('SELECT * FROM share_links WHERE token=?').get(token);
    return r ? { ...r, revoked: !!r.revoked } : null;
  },
  revoke(token: string) { db.prepare('UPDATE share_links SET revoked=1 WHERE token=?').run(token); },
};

// ── relationship state ─────────────────────────────────────────
export const Rel = {
  get(uid: string): RelationshipState {
    let r: any = db.prepare('SELECT * FROM relationship_state WHERE user_id=?').get(uid);
    if (!r) {
      r = { user_id: uid, total_sessions: 0, total_turns: 0, known_domains: '[]',
        input_mode_ratio: '{"tap":0,"choice_free":0,"free":0}',
        premium_quota: J.enc({ weekStartAt: now(), used: 0 }), memory_highlights: '[]', reask_due: '[]' };
      db.prepare(`INSERT INTO relationship_state (user_id,total_sessions,total_turns,known_domains,input_mode_ratio,premium_quota,memory_highlights,reask_due)
        VALUES (@user_id,@total_sessions,@total_turns,@known_domains,@input_mode_ratio,@premium_quota,@memory_highlights,@reask_due)`).run(r);
    }
    return {
      ...r,
      known_domains: J.dec(r.known_domains, []),
      input_mode_ratio: J.dec(r.input_mode_ratio, { tap: 0, choice_free: 0, free: 0 }),
      premium_quota: J.dec(r.premium_quota, { weekStartAt: now(), used: 0 }),
      memory_highlights: J.dec(r.memory_highlights, []),
      reask_due: J.dec(r.reask_due, []),
    };
  },
  save(s: RelationshipState) {
    db.prepare(`UPDATE relationship_state SET total_sessions=@total_sessions,total_turns=@total_turns,
      known_domains=@known_domains,input_mode_ratio=@input_mode_ratio,premium_quota=@premium_quota,
      memory_highlights=@memory_highlights,reask_due=@reask_due WHERE user_id=@user_id`).run({
      ...s, known_domains: J.enc(s.known_domains), input_mode_ratio: J.enc(s.input_mode_ratio),
      premium_quota: J.enc(s.premium_quota), memory_highlights: J.enc(s.memory_highlights), reask_due: J.enc(s.reask_due),
    });
  },
};

// ── sessions (会話の揮発状態) ──────────────────────────────────
export const Sessions = {
  create(uid: string, mode: string): any {
    const row = { id: id('sess'), user_id: uid, mode, last_move: 'open', last_domain: '',
      domain_repeat: 0, turns_since_strike: 99, pending_fragment: null, turn_count: 0, created_at: now() };
    db.prepare(`INSERT INTO sessions (id,user_id,mode,last_move,last_domain,domain_repeat,turns_since_strike,pending_fragment,turn_count,created_at)
      VALUES (@id,@user_id,@mode,@last_move,@last_domain,@domain_repeat,@turns_since_strike,@pending_fragment,@turn_count,@created_at)`).run(row);
    return row;
  },
  get(sid: string): any { return db.prepare('SELECT * FROM sessions WHERE id=?').get(sid); },
  update(sid: string, patch: any) {
    const cur = this.get(sid); if (!cur) return;
    const m = { ...cur, ...patch };
    db.prepare(`UPDATE sessions SET mode=@mode,last_move=@last_move,last_domain=@last_domain,
      domain_repeat=@domain_repeat,turns_since_strike=@turns_since_strike,pending_fragment=@pending_fragment,turn_count=@turn_count WHERE id=@id`).run(m);
  },
};

// ── friend requests (最小) ─────────────────────────────────────
export const Friends = {
  incoming(uid: string) {
    return db.prepare("SELECT * FROM friend_requests WHERE to_user=? AND status='incoming'").all(uid);
  },
  add(toUser: string, fromUser: string, fromName: string) {
    const row = { id: id('fr'), to_user: toUser, from_user: fromUser, from_name: fromName, status: 'incoming', created_at: now() };
    db.prepare(`INSERT INTO friend_requests (id,to_user,from_user,from_name,status,created_at)
      VALUES (@id,@to_user,@from_user,@from_name,@status,@created_at)`).run(row);
    return row;
  },
  accept(frId: string) { db.prepare("UPDATE friend_requests SET status='accepted' WHERE id=?").run(frId); },
};
