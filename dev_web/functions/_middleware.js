// ──────────────────────────────────────────────────────────────────
//  サイト全体の Basic 認証（admin 専用ゲート）
//  - Cloudflare Pages Functions として全リクエストの手前で実行される。
//  - id/pw は Pages の環境変数 ADMIN_USER / ADMIN_PASS から読む（コードに直書きしない）。
//  - 判定はエッジ（サーバー側）で行うので、クライアントからは突破できない。
//  - 公開するときは Pages 側でこの functions を外す or 環境変数 PUBLIC=1 を立てる。
// ──────────────────────────────────────────────────────────────────

const REALM = 'LORE (private)';

function unauthorized() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
    },
  });
}

// 長さに依存しない定数時間比較（タイミング攻撃対策）
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export const onRequest = async (context) => {
  const { request, env, next } = context;

  // 公開モード（PUBLIC=1）ならゲートを完全に無効化してそのまま配信
  if (env.PUBLIC === '1' || env.PUBLIC === 'true') {
    return next();
  }

  const USER = env.ADMIN_USER;
  const PASS = env.ADMIN_PASS;

  // 認証情報が未設定なら fail-closed（誤って全公開しないよう拒否）
  if (!USER || !PASS) {
    return new Response(
      'Auth not configured. Set ADMIN_USER / ADMIN_PASS in Pages env vars.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const header = request.headers.get('Authorization') || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try {
      decoded = atob(encoded);
    } catch (_) {
      return unauthorized();
    }
    const idx = decoded.indexOf(':');
    if (idx !== -1) {
      const u = decoded.slice(0, idx);
      const p = decoded.slice(idx + 1);
      // ユーザー名・パスワードを両方とも定数時間で検証
      const ok = safeEqual(u, USER) & safeEqual(p, PASS);
      if (ok) return next();
    }
  }

  return unauthorized();
};
