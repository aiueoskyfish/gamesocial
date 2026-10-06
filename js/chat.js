/* ==========================================================================
   chat.js - リアルタイムチャット（ジフシー式）

   打っている途中の文字がそのまま相手に流れる。
   確定（Enter）した時だけ既読が返り、ログに積まれる。
   本文は WebRTC の DataChannel を直接通るので Gun には残らない。
   ========================================================================== */

const Chat = (() => {

  let active = false;
  let peer = null;
  let lastSent = '';
  let typingTimer = null;
  let transcript = [];

  const el = {};

  function cache() {
    el.screen  = document.getElementById('chatScreen');
    el.peerBar = document.getElementById('chatPeer');
    el.live    = document.getElementById('tcRecvLive');
    el.typing  = document.getElementById('tcTyping');
    el.recvLog = document.getElementById('tcRecvLog');
    el.sendLog = document.getElementById('tcSendLog');
    el.input   = document.getElementById('tcInput');
    el.endBtn  = document.getElementById('chatEndBtn');
  }

  function open(p) {
    if (active) return;
    active = true;
    peer = p;
    transcript = [];

    cache();
    el.peerBar.innerHTML = History.peerBarHtml(peer) +
      '<span id="tcTimer" class="peer-timer">0:00</span>';
    el.live.textContent = '';
    el.recvLog.innerHTML = '';
    el.sendLog.innerHTML = '';
    el.input.value = '';
    lastSent = '';
    el.typing.classList.add('hidden');

    el.screen.classList.remove('hidden');
    requestAnimationFrame(() => el.screen.classList.add('is-on'));
    setTimeout(() => el.input.focus(), 160);

    bind();
  }

  let bound = false;

  function bind() {
    if (bound) return;
    bound = true;

    /* 差分ではなく毎回「今の全文」を送る。取りこぼしに強い */
    el.input.addEventListener('input', () => {
      const v = el.input.value;
      if (v === lastSent) return;
      lastSent = v;
      RTC.send({ t: 'live', v });
      RTC.send({ t: 'typing', v: true });
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => RTC.send({ t: 'typing', v: false }), 1200);
    });

    el.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        commit();
      }
    });

    el.endBtn.addEventListener('click', () => RTC.end());
  }

  function commit() {
    const v = el.input.value.trim();
    if (!v) return;

    push(el.sendLog, v, true);
    RTC.send({ t: 'commit', v });

    el.input.value = '';
    lastSent = '';
    RTC.send({ t: 'live', v: '' });
  }

  function onMessage(msg) {
    if (!active || !msg) return;

    if (msg.t === 'live') {
      el.live.textContent = msg.v || '';
      return;
    }
    if (msg.t === 'commit') {
      el.live.textContent = '';
      push(el.recvLog, msg.v || '', false);
      RTC.send({ t: 'read', at: Date.now() });   /* 既読は確定時だけ */
      return;
    }
    if (msg.t === 'typing') {
      el.typing.classList.toggle('hidden', !msg.v);
      return;
    }
    if (msg.t === 'read') {
      markRead();
      return;
    }
  }

  function push(list, text, mine) {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
    transcript.push({ mine, text, at: Date.now() });
  }

  function markRead() {
    const last = el.sendLog.lastElementChild;
    if (!last || last.querySelector('.tc-read')) return;
    const s = document.createElement('span');
    s.className = 'tc-read';
    s.textContent = '既読';
    last.appendChild(s);
  }

  function close() {
    if (!active) return;
    active = false;
    if (typingTimer) clearTimeout(typingTimer);
    if (el.screen) {
      el.screen.classList.remove('is-on');
      setTimeout(() => el.screen.classList.add('hidden'), 300);
    }
    const t = transcript;
    transcript = [];
    peer = null;
    return t;
  }

  function init() {
    cache();
    RTC.on('message', onMessage);
  }

  return { init, open, close, get active() { return active; }, get transcript() { return transcript; } };
})();
