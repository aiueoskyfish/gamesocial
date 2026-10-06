/* ==========================================================================
   oauth-worker.js - X OAuth 2.0 の CORS 中継（Cloudflare Workers）

   X の token エンドポイントと /2/users/me は CORS ヘッダを返さないため、
   ブラウザから直接呼べません。この Worker が唯一の役割は「中継」です。
   データベースも常駐プロセスもありません。

   無料枠: 10万リクエスト/日・クレジットカード不要。
   デプロイ手順は同じフォルダの README.md を参照してください。
   ========================================================================== */

/* このWorkerを使えるサイトのオリジンを列挙します。
   ここを '*' にすると他人があなたのWorkerを踏み台にして
   X API の割り当てを使い切れてしまうため、必ず自分のURLだけを書いてください。 */
const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'https://aiueoskyfish.github.io'
];

const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
/* public_metrics はフォロワー数・フォロー中の取得に必要（通話/チャット画面で表示する） */
const X_ME_URL    = 'https://api.x.com/2/users/me?user.fields=profile_image_url,username,name,public_metrics';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = isAllowed(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin, allowed) });
    }

    if (!allowed) {
      return json({ error: 'origin_not_allowed', origin }, 403, cors(origin, false));
    }

    try {
      if (url.pathname === '/token'   && request.method === 'POST') return await handleToken(request, env, origin);
      if (url.pathname === '/refresh' && request.method === 'POST') return await handleRefresh(request, env, origin);
      if (url.pathname === '/me'      && request.method === 'GET')  return await handleMe(request, origin);
      if (url.pathname === '/age'     && request.method === 'POST') return await handleAge(request, env, origin);
      if (url.pathname === '/export'  && request.method === 'GET')  return await handleExport(request, env, url);
      if (url.pathname === '/health') return json({ ok: true }, 200, cors(origin, true));
      return json({ error: 'not_found' }, 404, cors(origin, true));
    } catch (e) {
      return json({ error: 'worker_error', error_description: String(e && e.message || e) }, 500, cors(origin, true));
    }
  }
};

function isAllowed(origin) {
  if (!origin) return true; /* curl 等、Origin が無いリクエストは通す */
  return ALLOWED_ORIGINS.includes(origin);
}

function cors(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : ALLOWED_ORIGINS[0] || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

/* Single page App（公開クライアント）なら client_secret は不要。
   誤って Confidential client で作ってしまった場合のみ、
   wrangler secret put X_CLIENT_SECRET で登録すると Basic 認証を付けます。 */
function authHeaders(env, clientId) {
  const secret = env && env.X_CLIENT_SECRET;
  if (!secret) return {};
  return { Authorization: 'Basic ' + btoa(clientId + ':' + secret) };
}

async function handleToken(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const required = ['code', 'code_verifier', 'redirect_uri', 'client_id'];
  for (const k of required) {
    if (!b[k]) return json({ error: 'invalid_request', error_description: k + ' がありません' }, 400, cors(origin, true));
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: b.code,
    code_verifier: b.code_verifier,
    redirect_uri: b.redirect_uri,
    client_id: b.client_id
  });

  const res = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...authHeaders(env, b.client_id)
    },
    body: form.toString()
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', ...cors(origin, true) }
  });
}

async function handleRefresh(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  if (!b.refresh_token || !b.client_id) {
    return json({ error: 'invalid_request' }, 400, cors(origin, true));
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: b.refresh_token,
    client_id: b.client_id
  });

  const res = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...authHeaders(env, b.client_id)
    },
    body: form.toString()
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', ...cors(origin, true) }
  });
}

/* ==========================================================================
   年齢の収集

   アプリで入力された年齢を KV に貯める。保存するのは
   X のユーザーID・@ハンドル・年齢・時刻だけで、
   氏名・メールアドレス・IPアドレスは保存しない。

   必要な準備:
     wrangler kv namespace create AGES        （KVを作る）
     wrangler secret put EXPORT_KEY           （書き出し用の合言葉を決める）
   ========================================================================== */

async function handleAge(request, env, origin) {
  if (!env.AGES) {
    return json({ error: 'kv_not_bound' }, 500, cors(origin, true));
  }

  const b = await request.json().catch(() => ({}));
  const id = String(b.id || '').slice(0, 32);

  /* キーに使うので ID だけは確認する。年齢の中身は何が来ても弾かずそのまま保存する。 */
  if (!id || !/^\d+$/.test(id)) return json({ error: 'bad_id' }, 400, cors(origin, true));

  /* ユーザーIDをキーにするので、同じ人が入れ直しても行が増えない */
  await env.AGES.put('age:' + id, JSON.stringify({
    id,
    handle: String(b.handle || '').slice(0, 32),
    age: String(b.age == null ? '' : b.age).slice(0, 16),
    at: Date.now()
  }));

  return json({ ok: true }, 200, cors(origin, true));
}

/* 集めたデータの書き出し。合言葉が一致したときだけ返す。
   例) https://<worker>/export?key=合言葉           → JSON
       https://<worker>/export?key=合言葉&format=csv → CSV */
async function handleExport(request, env, url) {
  const key = url.searchParams.get('key') || '';
  if (!env.EXPORT_KEY || key !== env.EXPORT_KEY) {
    return new Response('forbidden', { status: 403 });
  }
  if (!env.AGES) return new Response('kv_not_bound', { status: 500 });

  const rows = [];
  let cursor;
  do {
    const list = await env.AGES.list({ prefix: 'age:', cursor });
    for (const k of list.keys) {
      const v = await env.AGES.get(k.name);
      if (v) { try { rows.push(JSON.parse(v)); } catch { /* 壊れた行は飛ばす */ } }
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);

  /* 年齢は検証せず集めているので、数字でない回答も混ざりうる。
     数字として読めるものを先に、読めないものを後ろに並べる。 */
  /* 空欄は Number('') が 0 になってしまい「0代」に化けるので、
     中身のある文字列だけを数値として扱う。 */
  const num = v => {
    const s = String(v == null ? '' : v).trim();
    if (!s) return Infinity;
    const n = Number(s);
    return isFinite(n) ? n : Infinity;
  };
  rows.sort((a, b) => num(a.age) - num(b.age));

  if (url.searchParams.get('format') === 'csv') {
    const csv = 'id,handle,age,at\n' +
      rows.map(r => [r.id, r.handle, r.age, new Date(r.at).toISOString()].join(',')).join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ages.csv"'
      }
    });
  }

  /* 年代ごとの集計も一緒に返す */
  const buckets = {};
  for (const r of rows) {
    const n = num(r.age);
    const label = isFinite(n) ? (Math.floor(n / 10) * 10) + '代' : '数字以外';
    buckets[label] = (buckets[label] || 0) + 1;
  }

  return new Response(JSON.stringify({ total: rows.length, buckets, rows }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

/* アクセストークンはクライアントが持っているものをそのまま転送するだけ。
   Worker 側では保存しません。 */
async function handleMe(request, origin) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return json({ error: 'missing_token' }, 401, cors(origin, true));
  }

  const res = await fetch(X_ME_URL, { headers: { Authorization: auth } });
  const text = await res.text();

  const headers = { 'Content-Type': 'application/json', ...cors(origin, true) };
  /* レート制限の残量をクライアントに見せる */
  for (const h of ['x-rate-limit-remaining', 'x-rate-limit-reset']) {
    const v = res.headers.get(h);
    if (v) headers[h] = v;
  }

  return new Response(text, { status: res.status, headers });
}
