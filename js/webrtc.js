/* ==========================================================================
   webrtc.js - P2P接続（通話 / チャット共通）

   両者とも「探している」状態で出会うので、着信ダイアログは出さず自動で繋ぐ。
   どちらが offer を出すかは公開鍵の大小で決める（両方が同時に offer を
   出すと衝突するため、必ず片方だけが発信側になるようにしている）。

   【TURN について】
   静的サイトに自前の TURN 認証情報を書くと DevTools で誰でも読めるため、
   他人の通信に流用されて無料枠が枯れる。
   既定値は Open Relay Project が「公開前提」で配っている無料TURN。
   それでも対称NAT同士（特にモバイル回線）では繋がらないことがある。
   ========================================================================== */

/* ★IPアドレスの保護について★

   WebRTC は本来、相手と直接つなぐために互いの IP アドレスを交換する。
   つまり既定のままだと「つながった相手に自分の IP が見える」。
   相手は chrome://webrtc-internals を開くだけで確認できる。
   知らない人とランダムにつなぐアプリでは、これは住所の手がかりを渡すのと同じ。

   iceTransportPolicy:'relay' にすると、通信を必ず TURN サーバー経由にする。
   相手から見えるのは TURN サーバーの IP だけになり、自分の IP は隠れる。

   代償: 通信が必ず TURN を通るので、無料の共有TURNでは
   つながりにくくなったり、音声が不安定になることがある。
   false にすれば直接つながって安定するが、IP は相手に見える。 */
const HIDE_IP = true;

const ICE_SERVERS = {
  iceServers: [
    /* relay 強制のときは STUN を載せない。
       STUN は「自分の公開IPを調べる」ためのもので、relay では不要。 */
    ...(HIDE_IP ? [] : [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]),
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ],
  iceTransportPolicy: HIDE_IP ? 'relay' : 'all',
  iceCandidatePoolSize: 4
};

const RTC = (() => {

  let pc = null;
  let localStream = null;
  let dataChannel = null;
  let peer = null;          /* 相手の表示情報 */
  let mode = null;          /* 'chat' | 'call' */
  let callId = null;
  let startedAt = 0;
  let acceptMode = null;    /* 探索中に受け入れる種別 */
  let busy = false;

  let timerInt = null, xpInt = null, levelRaf = null;
  let audioCtx = null, analyser = null;

  const handlers = { message: [], connected: [], ended: [] };

  function on(ev, fn) { if (handlers[ev]) handlers[ev].push(fn); }
  function off(ev, fn) { if (handlers[ev]) handlers[ev] = handlers[ev].filter(f => f !== fn); }
  function fire(ev, ...a) { for (const f of handlers[ev] || []) { try { f(...a); } catch (e) { console.warn(e); } } }

  /* ---- シグナリング ---- */

  function signalPut(targetPub, payload) {
    GunDB.gun.get('signal').get(targetPub).get(GunDB.pub).put({
      data: JSON.stringify({ cid: callId, ...payload }),
      at: Date.now()
    });
  }

  /* 処理済みのシグナルは空にする。残すと次の接続で再生されて切断事故になる */
  function clearSignal(fromPub) {
    GunDB.gun.get('signal').get(GunDB.pub).get(fromPub).put({ data: '', at: Date.now() });
  }

  function icePut(targetPub, candidate) {
    GunDB.gun.get('ice').get(targetPub).get(GunDB.pub)
      .get(Util.randomId(8))
      .put(JSON.stringify({ cid: callId, c: candidate }));
  }

  function listen() {
    const gun = GunDB.gun;
    if (!gun || !GunDB.pub) return;
    const seen = new Set();

    gun.get('signal').get(GunDB.pub).map().on(async (val, fromPub) => {
      if (!val || !val.data) return;
      const sig = fromPub + ':' + val.at;
      if (seen.has(sig)) return;
      seen.add(sig);
      if (val.at && Date.now() - val.at > 45000) return;

      let msg;
      try { msg = JSON.parse(val.data); } catch { return; }

      /* offer 以外は、進行中の接続宛てでなければ捨てる */
      if (msg.type !== 'offer' && msg.cid !== callId) return;

      if (msg.type === 'offer')  return onOffer(fromPub, msg);
      if (msg.type === 'answer') return onAnswer(fromPub, msg);
      if (msg.type === 'bye')    return onBye(fromPub);
      if (msg.type === 'busy')   return onBusy(fromPub);
    });

    gun.get('ice').get(GunDB.pub).map().map().on(async val => {
      if (!val || !pc || !callId) return;
      try {
        const p = JSON.parse(val);
        if (!p || p.cid !== callId || !p.c) return;
        await pc.addIceCandidate(new RTCIceCandidate(p.c));
      } catch { /* 期限切れ候補は無視 */ }
    });
  }

  /* ---- PeerConnection ---- */

  function createPc(targetPub) {
    const conn = new RTCPeerConnection(ICE_SERVERS);

    conn.onicecandidate = e => { if (e.candidate) icePut(targetPub, e.candidate.toJSON()); };

    conn.ontrack = e => {
      const a = document.getElementById('callAudio');
      if (a) a.srcObject = e.streams[0];
      startLevelMeter(e.streams[0]);
    };

    conn.onconnectionstatechange = () => {
      const s = conn.connectionState;
      if (s === 'connected') onConnected();
      if (s === 'failed') {
        UI.toast('接続できませんでした。相手または自分の回線がP2Pを通していません', 'error', 7000);
        teardown();
      }
      if (s === 'disconnected' || s === 'closed') teardown();
    };

    conn.ondatachannel = e => bindChannel(e.channel);
    return conn;
  }

  function bindChannel(ch) {
    dataChannel = ch;
    ch.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      fire('message', m);
    };
  }

  /* ---- 発信 ---- */

  async function offerTo(entry, kind) {
    if (busy || pc) return false;
    busy = true;

    peer = entryToPeer(entry);
    mode = kind;
    callId = Util.randomId(8);

    try {
      pc = createPc(entry.pub);

      if (kind === 'call') {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
      }

      bindChannel(pc.createDataChannel('gs', { ordered: true }));

      const offer = await pc.createOffer({ offerToReceiveAudio: kind === 'call' });
      await pc.setLocalDescription(offer);

      signalPut(entry.pub, {
        type: 'offer',
        kind,
        sdp: pc.localDescription.sdp,
        me: Profile.lobbyCard()
      });

      /* 応答が無ければ諦めて探索に戻る */
      const thisCall = callId;
      setTimeout(() => {
        if (callId === thisCall && pc && pc.connectionState !== 'connected') teardown();
      }, 12000);

      return true;
    } catch (e) {
      if (e && e.name === 'NotAllowedError') UI.toast('マイクの使用が許可されませんでした', 'error', 6000);
      else UI.toast('接続を開始できませんでした: ' + (e.message || e), 'error');
      teardown();
      return false;
    }
  }

  /* ---- 着信（探索中なら自動で応答） ---- */

  async function onOffer(fromPub, msg) {
    if (pc || busy || !acceptMode || msg.kind !== acceptMode) {
      callId = msg.cid;
      signalPut(fromPub, { type: 'busy' });
      callId = null;
      return;
    }

    busy = true;
    callId = msg.cid;
    mode = msg.kind;
    peer = entryToPeer({ pub: fromPub, ...(msg.me || {}) });
    clearSignal(fromPub);

    try {
      pc = createPc(fromPub);

      if (mode === 'call') {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
      }

      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signalPut(fromPub, { type: 'answer', sdp: pc.localDescription.sdp, me: Profile.lobbyCard() });
    } catch (e) {
      if (e && e.name === 'NotAllowedError') UI.toast('マイクの使用が許可されませんでした', 'error', 6000);
      signalPut(fromPub, { type: 'bye' });
      teardown();
    }
  }

  async function onAnswer(fromPub, msg) {
    if (!pc || !peer || peer.pub !== fromPub) return;
    if (pc.signalingState === 'stable') return;
    clearSignal(fromPub);
    if (msg.me) peer = entryToPeer({ pub: fromPub, ...msg.me });
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } catch (e) {
      console.warn('[rtc] answer', e);
    }
  }

  function onBye(fromPub) {
    clearSignal(fromPub);
    if (peer && peer.pub === fromPub) {
      UI.toast('相手が終了しました', 'info');
      teardown();
    }
  }

  function onBusy(fromPub) {
    clearSignal(fromPub);
    if (peer && peer.pub === fromPub && !startedAt) teardown();
  }

  function entryToPeer(e) {
    return {
      pub: e.pub,
      id: e.id || '',
      handle: e.handle || '',
      name: e.name || '',
      avatarUrl: e.avatarUrl || '',
      followers: Number(e.followers) || 0,
      following: Number(e.following) || 0,
      gender: e.gender || '',
      games: Util.parseList(e.games)
    };
  }

  /* ---- 接続成立 / 終了 ---- */

  function onConnected() {
    if (startedAt) return;
    startedAt = Date.now();
    acceptMode = null;

    fire('connected', peer, mode);

    timerInt = setInterval(() => {
      const el = document.getElementById('callTimer');
      if (el) el.textContent = Util.mmss(duration());
      const tc = document.getElementById('tcTimer');
      if (tc) tc.textContent = Util.mmss(duration());
    }, 1000);

    xpInt = setInterval(() => Rank.addXp(mode === 'call' ? 'callMin' : 'chatMin'), 60000);
    Rank.addXp('connected');

    if (mode === 'call' && localStream) startLevelMeter(localStream, true);
  }

  function end() {
    if (peer) signalPut(peer.pub, { type: 'bye' });
    teardown();
  }

  function teardown() {
    const hadPeer = peer;
    const hadMode = mode;
    const hadStart = startedAt;

    if (timerInt) clearInterval(timerInt);
    if (xpInt) clearInterval(xpInt);
    timerInt = xpInt = null;

    if (levelRaf) cancelAnimationFrame(levelRaf);
    levelRaf = null;
    if (audioCtx) { try { audioCtx.close(); } catch { /* ignore */ } }
    audioCtx = analyser = null;

    if (localStream) { for (const t of localStream.getTracks()) t.stop(); localStream = null; }
    if (dataChannel) { try { dataChannel.close(); } catch { /* ignore */ } }
    dataChannel = null;
    if (pc) { try { pc.close(); } catch { /* ignore */ } }
    pc = null;

    const a = document.getElementById('callAudio');
    if (a) a.srcObject = null;

    peer = null; mode = null; callId = null; startedAt = 0; busy = false;

    fire('ended', hadPeer, hadMode, hadStart);
  }

  function duration() { return startedAt ? (Date.now() - startedAt) / 1000 : 0; }

  function toggleMute() {
    if (!localStream) return false;
    const tracks = localStream.getAudioTracks();
    const nowMuted = tracks.length ? tracks[0].enabled : false;
    for (const t of tracks) t.enabled = !nowMuted ? true : false;
    const muted = tracks.length ? !tracks[0].enabled : false;
    const btn = document.getElementById('callMuteBtn');
    if (btn) {
      btn.classList.toggle('is-muted', muted);
      btn.innerHTML = Icon.svg(muted ? 'micOff' : 'mic');
    }
    return muted;
  }

  /* ---- 音量の可視化 ---- */

  function startLevelMeter(stream, isLocal = false) {
    const canvas = document.getElementById('callLevel');
    if (!canvas || !stream.getAudioTracks().length) return;
    if (levelRaf) cancelAnimationFrame(levelRaf);

    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
    } catch { return; }

    const data = new Uint8Array(analyser.frequencyBinCount);
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;

    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const n = (v - 128) / 128; sum += n * n; }
      const rms = Math.min(1, Math.sqrt(sum / data.length) * 4);

      ctx.clearRect(0, 0, w, h);
      const cs = getComputedStyle(document.documentElement);
      const color = (cs.getPropertyValue(isLocal ? '--success' : '--accent') || '#8b7bff').trim();

      for (let i = 0; i < 3; i++) {
        const r = 86 + i * 16 + rms * 26;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = (0.30 + rms * 0.55) / (i + 1);
        ctx.lineWidth = 2 + rms * 3;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      levelRaf = requestAnimationFrame(draw);
    };
    draw();
  }

  function init() { listen(); }

  return {
    ICE_SERVERS,
    init, offerTo, end, toggleMute, duration,
    on, off,
    send(obj) {
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(obj));
        return true;
      }
      return false;
    },
    setAcceptMode(m) { acceptMode = m; },
    get acceptMode() { return acceptMode; },
    get active() { return !!pc; },
    get connected() { return !!startedAt; },
    get peer() { return peer; },
    get mode() { return mode; },
    get channelOpen() { return !!(dataChannel && dataChannel.readyState === 'open'); }
  };
})();
