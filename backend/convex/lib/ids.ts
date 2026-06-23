// 推測困難なトークン生成（共有リンク用。spec §7: 6文字→不可、22文字相当）。
// crypto.getRandomValues は Convex ランタイム・Node 双方で利用可。
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function shareToken(len = 22): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
