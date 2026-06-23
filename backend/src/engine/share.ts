import { Shares, Cards, Users } from '../db/repo';
import { httpErr } from './orchestrator';
import type { Layer } from '../types';

/** 共有リンク発行（spec §7）。token は推測困難（22文字）。 */
export function createShare(uid: string, scope: 'profile' | 'content', layer: Layer = 'general', contentId?: string) {
  const link = Shares.create({ user_id: uid, scope, layer, content_id: contentId || null });
  const path = scope === 'content' ? `/c/${link.token}` : `/s/${link.token}`;
  return { token: link.token, url: `lore.app${path}`, layer, scope };
}

export function revokeShare(token: string) {
  const link = Shares.get(token);
  if (!link) throw httpErr(404, 'link not found');
  Shares.revoke(token);
  return { revoked: true };
}

/**
 * 受け手 View（未インストール可）。トークンの layer で絞ったカードを返す。
 * profile_private でも、有効リンク経由なら該当レイヤーのみ閲覧可（spec §7）。
 */
export function receiverView(token: string) {
  const link = Shares.get(token);
  if (!link || link.revoked) throw httpErr(404, 'invalid or revoked link');
  const user = Users.get(link.user_id);
  if (!user) throw httpErr(404, 'user not found');

  if (link.scope === 'content' && link.content_id) {
    const card = Cards.get(link.content_id);
    return { kind: 'content', author: pubUser(user), card: card ? pubCard(card) : null };
  }

  const cards = Cards.byUser(link.user_id)
    .filter(c => c.layers.includes(link.layer) || (link.layer === 'close')) // close は general も見える
    .map(pubCard);
  return { kind: 'profile', author: pubUser(user), layer: link.layer, cards };
}

const pubUser = (u: any) => ({ displayName: u.display_name, userId: `@${u.user_id}`, bio: u.bio, avatar: u.avatar });
const pubCard = (c: any) => ({ id: c.id, title: c.title, body: c.body, format: c.format, payload: c.payload, conf: c.conf, isPremium: c.is_premium, cover: c.cover });
