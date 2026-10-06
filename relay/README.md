# 自分の Gun リレーを無料で立てる手順

## なぜ必要か（これをやらないと何も動きません）

仕様書が指定していたリレーは、**実測で全部死んでいました**。

```
404  https://gun-manhattan.herokuapp.com/gun   ← Heroku無料枠終了(2022-11)で消滅
404  https://gun-us.herokuapp.com/gun          ← 同上
530  https://peer.wallie.io/gun                ← 有名な代替だが死亡
000  https://plankton-app-6qfp3.ondigitalocean.app/gun
000  https://gun-ams1.maddiex.wtf/gun
000  https://gun-rs.iris.to/gun
200  https://relay.peer.ooo/gun                ← HTTPは生きている
```

10個試してHTTPが返ったのは1個だけ。しかも **その1個も使えません**。

実際に2端末を繋いで検証したところ、`relay.peer.ooo` は
**WebSocket 接続は成功するのに、データが一切相手に届きませんでした**。

```
A が書き込み → B から読む → undefined
B が書き込み → A から読む → undefined
```

「接続できている＝使える」ではない、という点が罠です。
ヘッダーの接続インジケーターは緑になりますが、スワイプには誰も出てきません。

同じテストを自前リレー（このフォルダのコード）に向けた瞬間、

```
A が書き込み → B から読む → "from A"  ✅
```

となり、スワイプ・マッチ・DM・通話が**すべて動作しました**。

**つまり、リレーを1つ立てることが必須作業です。** 15分で終わります。

> リレーはデータの中継だけで、**あなたのメッセージを読むことはできません**（DMは端末間で暗号化されているため）。

---

## 方法A: Render（無料・クレカ不要・推奨）

1. https://render.com にサインアップ（GitHub アカウントでログイン可）
2. このフォルダ（`relay/`）の中身を GitHub のリポジトリにプッシュする
3. Render で **New → Web Service** を選び、そのリポジトリを指定
4. 設定は以下

| 項目 | 値 |
|---|---|
| Language | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | **Free** |

5. Deploy が終わると `https://あなたの名前.onrender.com` が発行されます
6. `js/gun-init.js` の `RELAYS` に追記します

```js
const RELAYS = [
  'https://relay.peer.ooo/gun',
  'https://あなたの名前.onrender.com/gun',   // ← 追記
];
```

### Render 無料プランの注意

15分アクセスが無いとスリープし、次のアクセスで**起動に40〜60秒**かかります。
`relay.peer.ooo` と併記しておけば、起きるまでの間もそちらで通信できます。

---

## 方法B: Hugging Face Spaces（無料・クレカ不要・スリープしにくい）

Render と違い、**48時間アクセスが無いまでスリープしません**。常用にはこちらが有利です。

1. https://huggingface.co にサインアップ
2. **New Space** → SDK に **Docker** を選択 → Space を作成
3. この `relay/` フォルダの `Dockerfile` と `package.json`、`relay.js` をアップロード
4. Space の **Settings → Variables** で `PORT` を `7860` に設定（HF の既定ポート）
5. 発行された `https://ユーザー名-space名.hf.space` を `RELAYS` に `/gun` を付けて追記

---

## 方法C: 手元のPCで動かす（確認用）

```bash
cd relay
npm install
npm start
```

`http://localhost:8765/gun` が立ちます。同じ Wi-Fi 内の端末同士のテストに使えます。
PC を閉じると止まるので、本番用にはなりません。

---

## 動作確認

ブラウザで `https://あなたのリレー/gun` を開きます。
JSON か空のレスポンスが返れば動いています（404 なら失敗）。

アプリ側では、設定 → 接続 のパネルに接続中のリレー数が出ます。
ヘッダーの丸が緑なら全リレー接続、黄色なら一部、赤なら未接続です。
