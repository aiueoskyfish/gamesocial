/* ==========================================================================
   gun-init.js - Gun.js 初期化

   このアプリで Gun が担うのは2つだけ。
     1. ロビー（条件に合う相手を探す）
     2. WebRTC のシグナリング（offer / answer / ICE の交換）

   チャット本文と音声は WebRTC の P2P 接続を直接通り、Gun には流れない。
   DataChannel は DTLS で暗号化されているので、SEA による追加の暗号化は不要。

   【リレーについて】
   仕様書指定の gun-manhattan / gun-us は Heroku 無料枠終了で消滅（実測 404）。
   候補を10個試して HTTP 200 を返したのは relay.peer.ooo だけで、しかもそれは
   2端末で検証したところ WebSocket は繋がるのにデータが一切届かなかった。
   「接続できる＝使える」ではない。自前リレーを1つ立てるまで何も動かない。
   無料・クレカ不要の手順は relay/README.md にある。
   ========================================================================== */

const RELAYS = [
  /* ↓ ここをあなたのリレーのURLに置き換えてください（これが必須の作業です） */
  // 'https://あなたのリレー.onrender.com/gun',

  /* 接続はできるがデータが流れないため、保険にもならない。
     他に候補が無いので残しているが、これ単体では何も動かない。 */
  'https://relay.peer.ooo/gun'
];

const GunDB = (() => {
  let gun = null;
  let pair = null;
  let myId = null;
  let connected = 0;

  const listeners = { conn: [] };

  /* ロビーの鮮度。これより古いエントリは「もう居ない」とみなす */
  const LOBBY_STALE = 20000;
  const LOBBY_BEAT = 6000;

  let lobbyTimer = null;
  let lobbyEntry = null;

  /* ---- 鍵 ----
     Gun 上での身元。バックアップ機能は持たせない方針なので localStorage のみ。
     キャッシュを消せば鍵も消え、次回は別人として始まる（意図した挙動）。 */
  async function loadPair() {
    let p = null;
    try {
      const raw = localStorage.getItem('gs_sea_pair');
      if (raw) p = JSON.parse(raw);
    } catch { /* 壊れていたら作り直す */ }

    if (!p || !p.pub || !p.priv) {
      p = await SEA.pair();
      localStorage.setItem('gs_sea_pair', JSON.stringify(p));
    }
    return p;
  }

  async function init(twitterId) {
    myId = twitterId;

    gun = Gun({
      peers: RELAYS,
      localStorage: false,
      radisk: false,   /* 履歴は端末側に持つので Gun に貯める必要がない */
      axe: false
    });

    pair = await loadPair();
    watchConnection();

    return { gun, pair };
  }

  /* ---- 接続監視（表示用のUIは持たないが、繋がっていない事は伝える） ---- */

  function watchConnection() {
    const peers = gun.back('opt.peers') || {};

    const count = () => {
      let n = 0;
      for (const k in peers) {
        const w = peers[k] && peers[k].wire;
        if (w && w.readyState === 1) n++;
      }
      return n;
    };

    gun.on('hi', () => { connected = count(); emit(); });
    gun.on('bye', () => { connected = count(); emit(); });
    setInterval(() => {
      const n = count();
      if (n !== connected) { connected = n; emit(); }
    }, 5000);
  }

  function emit() {
    for (const fn of listeners.conn) {
      try { fn(connected, RELAYS.length); } catch { /* ignore */ }
    }
  }

  function onConnection(fn) {
    listeners.conn.push(fn);
    fn(connected, RELAYS.length);
  }

  /* ==========================================================================
     ロビー
     自分の条件を置き、同時に他人の条件を読む。両者の条件が互いに
     噛み合ったときだけ成立させる（片側だけ合っていても繋がない）。
     ========================================================================== */

  function enterLobby(entry) {
    lobbyEntry = entry;
    const beat = () => {
      if (!lobbyEntry || !pair) return;
      gun.get('lobby').get(pair.pub).put({ ...lobbyEntry, at: Date.now() });
    };
    beat();
    if (lobbyTimer) clearInterval(lobbyTimer);
    lobbyTimer = setInterval(beat, LOBBY_BEAT);
  }

  function leaveLobby() {
    lobbyEntry = null;
    if (lobbyTimer) clearInterval(lobbyTimer);
    lobbyTimer = null;
    if (pair && gun) gun.get('lobby').get(pair.pub).put({ at: 0, mode: '' });
  }

  /* ロビーを一定時間だけ読んで、生きているエントリを配列で返す */
  function readLobby(ms = 2200) {
    return new Promise(resolve => {
      if (!gun) { resolve([]); return; }
      const found = new Map();
      gun.get('lobby').map().once((data, pub) => {
        if (!data || !data.at || !data.mode) return;
        if (pub === pair.pub) return;
        if (Date.now() - data.at > LOBBY_STALE) return;
        found.set(pub, { pub, ...stripMeta(data) });
      });
      setTimeout(() => resolve([...found.values()]), ms);
    });
  }

  function stripMeta(obj) {
    const out = {};
    for (const k in obj) {
      if (k === '_') continue;
      const v = obj[k];
      if (v && typeof v === 'object' && v['#']) continue;
      out[k] = v;
    }
    return out;
  }

  return {
    RELAYS,
    init,
    onConnection,
    enterLobby, leaveLobby, readLobby,
    stripMeta,
    LOBBY_STALE,
    get gun() { return gun; },
    get pair() { return pair; },
    get pub() { return pair && pair.pub; },
    get myId() { return myId; },
    get peerCount() { return connected; }
  };
})();
