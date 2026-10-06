/* ==========================================================================
   auth.js - Twitter(X) OAuth 2.0 PKCE（PHASE 2）

   【重要・なぜ Worker が必要なのか】
   X の token エンドポイントと /2/users/me は CORS ヘッダ
   (Access-Control-Allow-Origin) を返しません。実測で確認済みです。
   そのためブラウザ単体では code → access_token の交換ができません。
   PKCE は「client secret を隠せない環境向け」の仕組みですが、
   CORS の許可とは別の話で、X 側が許可していないため回避できません。

   そこで中継役として Cloudflare Workers を使います。
   常駐サーバーもDBも無く、無料枠は 10万リクエスト/日・クレカ不要です。
   デプロイ手順は worker/README.md にあります。
   ========================================================================== */

const AUTH_CONFIG = {
  /* X Developer Portal (https://developer.x.com) でアプリを作成し、
     「User authentication settings」を有効化した後に発行される
     OAuth 2.0 Client ID をここに貼ってください。
     App permissions は "Read" / Type of App は "Single page App" を選びます。 */
  clientId: 'dkRQbjZ4V0s4cjloZkhNYW83a3A6MTpjaQ',

  /* worker/README.md の手順でデプロイした Worker の URL。
     例: 'https://gamesocial-auth.yourname.workers.dev'
     末尾のスラッシュは付けないでください。 */
  workerUrl: 'https://gamesocial-auth.aiueoskyfish.workers.dev',

  scopes: ['tweet.read', 'users.read', 'offline.access']
};

const Auth = (() => {
  const LS = {
    token:     'gs_access_token',
    refresh:   'gs_refresh_token',
    expires:   'gs_token_expires',
    verifier:  'gs_pkce_verifier',
    state:     'gs_oauth_state',
    userCache: 'gs_user_cache'
  };

  const USER_CACHE_MS = 60 * 60 * 1000; /* X API の読み取り上限が厳しいので1時間キャッシュ（必須） */

  /* GitHub Pages のプロジェクトサイト（/repo/ 配下）でも正しく動くように
     現在のディレクトリから組み立てる。X 側の Callback URI には
     ここで算出される値をそのまま登録してください。 */
  function redirectUri() {
    const dir = location.pathname.replace(/[^/]*$/, '');
    return location.origin + dir + 'app.html';
  }

  function isConfigured() {
    return AUTH_CONFIG.clientId !== 'YOUR_CLIENT_ID' &&
           !!AUTH_CONFIG.clientId &&
           AUTH_CONFIG.workerUrl.indexOf('YOUR-WORKER') === -1 &&
           !!AUTH_CONFIG.workerUrl;
  }

  /* ---------- PKCE ---------- */

  function generateCodeVerifier() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Util.base64url(bytes); /* 43文字の base64url */
  }

  async function generateCodeChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return Util.base64url(digest);
  }

  /* ---------- ログイン開始 ---------- */

  async function startLogin() {
    if (!isConfigured()) throw new Error('clientId / workerUrl が未設定です');

    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = Util.randomId(16);

    /* リダイレクトを跨ぐので localStorage に置く
       （別タブで戻ってきた場合でも拾えるようにするため sessionStorage は使わない） */
    localStorage.setItem(LS.verifier, verifier);
    localStorage.setItem(LS.state, state);

    const q = new URLSearchParams({
      response_type: 'code',
      client_id: AUTH_CONFIG.clientId,
      redirect_uri: redirectUri(),
      scope: AUTH_CONFIG.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });

    location.assign('https://x.com/i/oauth2/authorize?' + q.toString());
  }

  /* ---------- コールバック処理 ---------- */

  function hasCallbackParams() {
    const p = new URLSearchParams(location.search);
    return p.has('code') || p.has('error');
  }

  async function handleCallback() {
    const p = new URLSearchParams(location.search);

    if (p.has('error')) {
      cleanUrl();
      throw new Error(p.get('error_description') || p.get('error') || '認証が拒否されました');
    }

    const code = p.get('code');
    const state = p.get('state');
    if (!code) throw new Error('認証コードがありません');

    const expectState = localStorage.getItem(LS.state);
    const verifier = localStorage.getItem(LS.verifier);
    if (!expectState || state !== expectState) {
      cleanUrl();
      throw new Error('state が一致しません（CSRF 防止のため中断しました）');
    }
    if (!verifier) {
      cleanUrl();
      throw new Error('PKCE verifier が見つかりません。もう一度ログインしてください');
    }

    const res = await fetch(AUTH_CONFIG.workerUrl + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri(),
        client_id: AUTH_CONFIG.clientId
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.access_token) {
      cleanUrl();
      localStorage.removeItem(LS.verifier);
      localStorage.removeItem(LS.state);
      throw new Error(describeTokenError(res.status, data));
    }

    localStorage.setItem(LS.token, data.access_token);
    if (data.refresh_token) localStorage.setItem(LS.refresh, data.refresh_token);
    if (data.expires_in) {
      localStorage.setItem(LS.expires, String(Date.now() + data.expires_in * 1000));
    }
    localStorage.removeItem(LS.verifier);
    localStorage.removeItem(LS.state);
    cleanUrl();

    return data.access_token;
  }

  function describeTokenError(status, data) {
    if (status === 0) return 'Worker に接続できません。workerUrl を確認してください';
    if (status === 404) return 'Worker の /token が見つかりません。デプロイを確認してください';
    if (status === 403) return 'Worker が このオリジンを許可していません。ALLOWED_ORIGINS を確認してください';
    if (data && data.error === 'invalid_request') {
      return 'トークン交換に失敗しました。Callback URI が X 側の登録値と一致しているか確認してください';
    }
    if (data && data.error_description) return 'トークン交換に失敗: ' + data.error_description;
    if (data && data.error) return 'トークン交換に失敗: ' + data.error;
    return 'トークン交換に失敗しました (HTTP ' + status + ')';
  }

  function cleanUrl() {
    history.replaceState({}, document.title, location.pathname);
  }

  /* ---------- トークン ---------- */

  function getToken() {
    return localStorage.getItem(LS.token);
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function tokenExpired() {
    const exp = Number(localStorage.getItem(LS.expires) || 0);
    if (!exp) return false;
    return Date.now() > exp - 60000; /* 1分前倒しで更新 */
  }

  async function refreshToken() {
    const rt = localStorage.getItem(LS.refresh);
    if (!rt) throw new Error('refresh_token がありません');

    const res = await fetch(AUTH_CONFIG.workerUrl + '/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt, client_id: AUTH_CONFIG.clientId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error('トークンを更新できませんでした');

    localStorage.setItem(LS.token, data.access_token);
    if (data.refresh_token) localStorage.setItem(LS.refresh, data.refresh_token);
    if (data.expires_in) {
      localStorage.setItem(LS.expires, String(Date.now() + data.expires_in * 1000));
    }
    return data.access_token;
  }

  async function ensureToken() {
    if (!isLoggedIn()) throw new Error('未ログインです');
    if (tokenExpired() && localStorage.getItem(LS.refresh)) {
      try { return await refreshToken(); } catch { /* 失効していても一度は試す */ }
    }
    return getToken();
  }

  /* ---------- ユーザー情報 ---------- */

  /* X API の読み取り枠は非常に小さいため、起動時に1回だけ呼び、1時間キャッシュする。
     キャッシュがあればネットワークには一切出ない。 */
  async function getUserInfo(force = false) {
    if (!force) {
      try {
        const raw = localStorage.getItem(LS.userCache);
        if (raw) {
          const c = JSON.parse(raw);
          if (c && c.at && Date.now() - c.at < USER_CACHE_MS && c.user) return c.user;
        }
      } catch { /* 壊れたキャッシュは無視して取り直す */ }
    }

    const token = await ensureToken();
    const res = await fetch(AUTH_CONFIG.workerUrl + '/me', {
      headers: { Authorization: 'Bearer ' + token }
    });

    if (res.status === 429) {
      const stale = readStaleUser();
      if (stale) return stale;
      throw new Error('X API のレート制限に達しました。しばらく待ってください');
    }
    if (res.status === 401) {
      const stale = readStaleUser();
      if (stale) return stale;
      throw new Error('認証が切れました。再ログインしてください');
    }
    if (!res.ok) {
      const stale = readStaleUser();
      if (stale) return stale;
      throw new Error('ユーザー情報を取得できませんでした (HTTP ' + res.status + ')');
    }

    const json = await res.json();
    const d = json.data || {};
    const m = d.public_metrics || {};
    const user = {
      id: d.id,
      username: d.username,
      name: d.name,
      avatarUrl: (d.profile_image_url || '').replace('_normal', '_200x200'),
      followers: m.followers_count || 0,
      following: m.following_count || 0
    };

    localStorage.setItem(LS.userCache, JSON.stringify({ at: Date.now(), user }));
    await DB.set('meta', 'twitterUser', user);
    return user;
  }

  /* 期限切れでも手元のキャッシュがあれば使う（リレー落ち・制限時の最後の砦） */
  function readStaleUser() {
    try {
      const raw = localStorage.getItem(LS.userCache);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.user) return c.user;
      }
    } catch { /* ignore */ }
    return null;
  }

  async function getCachedUser() {
    const stale = readStaleUser();
    if (stale) return stale;
    try { return (await DB.get('meta', 'twitterUser')) || null; } catch { return null; }
  }

  /* ---------- ログアウト ---------- */

  function logout() {
    for (const k of Object.values(LS)) localStorage.removeItem(k);
    /* Gun の鍵も消す（他の端末に残っているものには影響しない） */
    localStorage.removeItem('gs_sea_pair');
    location.replace('index.html');
  }

  return {
    AUTH_CONFIG,
    isConfigured,
    generateCodeVerifier,
    generateCodeChallenge,
    startLogin,
    hasCallbackParams,
    handleCallback,
    getToken,
    ensureToken,
    refreshToken,
    getUserInfo,
    getCachedUser,
    isLoggedIn,
    logout,
    redirectUri
  };
})();
