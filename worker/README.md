# Xログインを動かすための手順（完全無料・クレカ不要）

この Worker を立てないと **ログインボタンは機能しません**。
理由は `js/auth.js` の先頭コメントに書いてありますが、要点は
「X の token エンドポイントが CORS を許可していないので、ブラウザから直接叩けない」ことです。

所要時間は **15分程度**。費用は **0円**、クレジットカード登録も不要です。

---

## STEP 1. X 側でアプリを登録する（5分）

1. https://developer.x.com にアクセスし、自分の X アカウントでサインアップします（Free プランで十分）
2. **Projects & Apps → Overview → Create Project**（または既存 App を使う）
3. 作った App の **Settings → User authentication settings → Set up** を開く
4. 以下の通りに設定します

| 項目 | 設定値 | 理由 |
|---|---|---|
| **App permissions** | `Read` | 投稿権限は不要です |
| **Type of App** | `Single page App` | ← **重要**。これを選ぶと公開クライアントになり、client secret が不要になります |
| **Callback URI / Redirect URL** | 下の表を参照 | **1文字でも違うと失敗します** |
| **Website URL** | 自分のサイトURL（何でも可） | 必須項目のため |

### Callback URI に入れる値

`js/auth.js` は現在のディレクトリから自動計算します。環境ごとに下記をそのまま登録してください。
**複数登録できる**ので、ローカルと本番の両方を入れておくのが楽です。

| 動かす場所 | Callback URI |
|---|---|
| ローカル（`python -m http.server 8000`） | `http://localhost:8000/app.html` |
| GitHub Pages（ユーザーサイト） | `https://ユーザー名.github.io/app.html` |
| GitHub Pages（リポジトリサイト） | `https://ユーザー名.github.io/リポジトリ名/app.html` |

5. **Save** を押すと **Client ID** が表示されます。これをコピーしておきます
   （Client Secret は `Single page App` なら使いません）

---

## STEP 2. Worker をデプロイする（5分）

CLI を入れたくない人は **方法A** が一番早いです。

### 方法A: ダッシュボードに貼り付ける（インストール不要・推奨）

1. https://dash.cloudflare.com にサインアップ（無料・カード不要）
2. 左メニュー **Compute（Workers）→ Create → Create Worker**
3. 名前を `gamesocial-auth` にして **Deploy** を押す（中身は後で差し替えます）
4. **Edit code** を押し、エディタの中身を全部消して
   `oauth-worker.js` の内容を**まるごと貼り付け**
5. 貼り付けたコードの上部にある `ALLOWED_ORIGINS` を自分のURLに書き換える

```js
const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'https://あなたの名前.github.io'   // ← GitHub Pages を使うなら
];
```

> ⚠️ ここを `'*'` にしないでください。他人があなたの Worker を踏み台にして、
> あなたの X API 割り当てを使い切れてしまいます。

6. 右上の **Deploy** を押す
7. 表示される URL（`https://gamesocial-auth.xxxx.workers.dev`）をコピー

### 方法B: wrangler CLI を使う

```bash
npm install -g wrangler
wrangler login
cd worker
wrangler deploy
```

`ALLOWED_ORIGINS` は `oauth-worker.js` を編集してから deploy してください。

---

## STEP 3. サイト側に値を入れる（1分）

`js/auth.js` の先頭を書き換えます。

```js
const AUTH_CONFIG = {
  clientId: 'ここにSTEP1のClient ID',
  workerUrl: 'https://gamesocial-auth.xxxx.workers.dev',  // 末尾スラッシュなし
  scopes: ['tweet.read', 'users.read', 'offline.access']
};
```

---

## STEP 4. 動作確認

### Worker が生きているか

ブラウザで `https://あなたのWorker.workers.dev/health` を開きます。

```json
{"ok":true}
```

が出れば OK です。

### ログインを通す

`index.html` を開いて「Xでログイン」を押します。

---

## うまくいかない時（エラー別）

| 画面に出るメッセージ | 原因と対処 |
|---|---|
| `Worker に接続できません` | `workerUrl` の綴り間違い、または末尾に `/` が付いている |
| `Worker が このオリジンを許可していません` | `ALLOWED_ORIGINS` に今開いているURLが入っていない。`http` と `https`、ポート番号まで一致させる |
| `Callback URI が X 側の登録値と一致しているか確認してください` | X の設定画面の Callback URI と、実際に開いているURLがズレている。`/app.html` まで含めて完全一致が必要 |
| `state が一致しません` | ログイン途中で別タブを開いた等。もう一度やり直せば直る |
| `X API のレート制限に達しました` | Free プランの `/2/users/me` は上限が小さい。`js/auth.js` が1時間キャッシュするので、待てば回復する |
| `Unauthorized` が返る | `Type of App` が `Single page App` 以外になっている。Confidential client の場合は `wrangler secret put X_CLIENT_SECRET` でシークレットを登録する |

---

## この Worker が「自前サーバー」ではない理由

- 常駐プロセスがない（リクエストが来た瞬間だけ実行される）
- データベースを持たない（トークンは一切保存せず、そのまま転送するだけ）
- 管理・監視・アップデートの対象になるマシンがない
- 無料枠の 10万リクエスト/日 に対し、このアプリの使用量はログイン1回につき2リクエスト

実質的には「CORS ヘッダを付け直すだけの中継」です。
