// LORE API クライアント（FE の LORE.dc.html に1枚ドロップして使う薄いラッパ）。
// 既存ハンドラ → API の対応は lore_implementation_spec.md §9 を参照。
// 使い方: const api = LoreAPI('http://localhost:8787'); await api.startSession('onboarding');

function LoreAPI(base = 'http://localhost:8787', userId = 'u_maruyama') {
  const j = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-user-id': userId },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error || res.statusText), { status: res.status });
    return res.json();
  };
  return {
    health: () => j('GET', '/health'),
    // 会話
    startSession: (mode) => j('POST', '/session', { mode }),
    turn: (sid, text, inputMode = 'choice_free') => j('POST', `/session/${sid}/turn`, { text, inputMode }),
    react: (sid, fragmentId, kind) => j('POST', `/session/${sid}/react`, { fragmentId, kind }),
    miss: (sid, fragmentId, type, detail) => j('POST', `/session/${sid}/miss`, { fragmentId, type, detail }),
    firstlore: (sid) => j('POST', `/session/${sid}/firstlore`),
    nudge: () => j('POST', '/nudge'),
    // コンテンツ
    candidates: () => j('GET', '/candidates'),
    generate: (seedId, granularity = 'normal') => j('POST', '/content/generate', { seedId, granularity }),
    regenerate: (seedId, granularity) => j('POST', '/content/regenerate', { seedId, granularity }),
    publish: (draft) => j('POST', '/content/publish', draft),
    patchCard: (id, patch) => j('PATCH', `/content/${id}`, patch),
    deleteCard: (id) => j('DELETE', `/content/${id}`),
    // 共有 / 受け手
    share: (scope, layer, contentId) => j('POST', '/share', { scope, layer, contentId }),
    revoke: (token) => j('POST', `/share/${token}/revoke`),
    receiverView: (token) => j('GET', `/s/${token}`),
    // プロフィール / ともだち
    me: () => j('GET', '/me'),
    setPrivate: (priv) => j('PATCH', '/me/private', { private: priv }),
    incoming: () => j('GET', '/friends/incoming'),
    acceptFriend: (id) => j('POST', `/friends/${id}/accept`),
  };
}

if (typeof module !== 'undefined') module.exports = { LoreAPI };
if (typeof window !== 'undefined') window.LoreAPI = LoreAPI;
