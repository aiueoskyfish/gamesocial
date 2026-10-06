/* ==========================================================================
   history.js - 通話とチャットの履歴

   端末の IndexedDB にのみ残る。相手側には何も送らないし、
   キャッシュを消せば消える。
   ========================================================================== */

const History = (() => {

  const STORE = { call: 'calls', chat: 'chats' };
  const MAX = 200;

  async function add(mode, peer, startedAt, endedAt, transcript) {
    const store = STORE[mode];
    if (!store) return null;

    const rec = {
      id: Util.randomId(10),
      mode,
      at: startedAt,
      duration: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
      peer: {
        id: peer.id || '',
        name: peer.name || '',
        handle: peer.handle || '',
        avatarUrl: peer.avatarUrl || '',
        followers: peer.followers || 0,
        following: peer.following || 0
      }
    };
    if (mode === 'chat' && transcript && transcript.length) rec.transcript = transcript;

    await DB.set(store, rec.id, rec);
    await trim(store);
    return rec;
  }

  /* 増えすぎたら古いものから捨てる */
  async function trim(store) {
    const all = await DB.all(store);
    if (!all || all.length <= MAX) return;
    all.sort((a, b) => b.at - a.at);
    for (const old of all.slice(MAX)) await DB.del(store, old.id);
  }

  async function list(mode) {
    const all = (await DB.all(STORE[mode])) || [];
    return all.sort((a, b) => b.at - a.at);
  }

  async function clear(mode) {
    await DB.clear(STORE[mode]);
  }

  /* 通話とチャットを1つの時系列にまとめて出す */
  async function listAll() {
    const [calls, chats] = await Promise.all([list('call'), list('chat')]);
    return [...calls, ...chats].sort((a, b) => b.at - a.at);
  }

  let filter = 'all';

  function renderFilter(box, onChange) {
    if (!box) return;
    box.innerHTML = '';
    for (const [value, label] of [['all', 'すべて'], ['call', '通話'], ['chat', 'チャット']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (filter === value ? ' is-on' : '');
      b.textContent = label;
      b.onclick = () => { filter = value; renderFilter(box, onChange); if (onChange) onChange(); };
      box.appendChild(b);
    }
  }

  async function render(listEl, emptyEl) {
    if (!listEl) return;
    let items = await listAll();
    if (filter !== 'all') items = items.filter(r => r.mode === filter);

    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.textContent = filter === 'call' ? 'まだ通話していません'
                          : filter === 'chat' ? 'まだチャットしていません'
                          : 'まだ誰ともつながっていません';
      emptyEl.classList.toggle('hidden', items.length > 0);
    }
    if (!items.length) return;

    for (const rec of items) {
      const li = document.createElement('li');
      li.className = 'hist-item';
      li.innerHTML = `
        <span class="hist-mode hist-mode-${rec.mode}">${Icon.svg(rec.mode === 'call' ? 'phone' : 'keyboard')}</span>
        <img class="hist-av" alt="" src="${Util.escapeHtml(rec.peer.avatarUrl || 'assets/default-avatar.png')}">
        <div class="hist-meta">
          <span class="hist-name"></span>
          <span class="hist-id"></span>
        </div>
        <div class="hist-right">
          <span class="hist-dur">${Util.mmss(rec.duration)}</span>
          <span class="hist-when">${Util.ago(rec.at)}</span>
        </div>
      `;
      li.querySelector('.hist-name').textContent = rec.peer.name || '名前なし';
      li.querySelector('.hist-id').textContent = rec.peer.handle ? '@' + rec.peer.handle : '';

      if (rec.mode === 'chat' && rec.transcript && rec.transcript.length) {
        li.classList.add('is-openable');
        li.addEventListener('click', () => openTranscript(rec));
      }

      listEl.appendChild(li);
    }
  }

  function openTranscript(rec) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2 class="jp-title-sm">チャットの記録</h2>
          <button class="icon-btn" data-close type="button" aria-label="閉じる">${Icon.svg('close')}</button>
        </div>
        <div class="modal-body">
          <div class="peer-bar peer-bar-inline" data-peer></div>
          <ul class="tr-log" data-log></ul>
        </div>
      </div>
    `;

    back.querySelector('[data-peer]').innerHTML = peerBarHtml(rec.peer);

    const log = back.querySelector('[data-log]');
    for (const m of rec.transcript) {
      const li = document.createElement('li');
      li.className = 'tr-line' + (m.mine ? ' is-mine' : '');
      li.textContent = m.text;
      log.appendChild(li);
    }

    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('modal-open'));

    const close = () => {
      back.classList.remove('modal-open');
      setTimeout(() => back.remove(), 200);
    };
    back.querySelector('[data-close]').onclick = close;
    back.onclick = e => { if (e.target === back) close(); };
  }

  /* 通話・チャット中と履歴で同じ見た目にするための共通パーツ。
     ここに出る情報が、相手について分かる全て。 */
  function peerBarHtml(peer) {
    const f = Profile.formatCount;
    return `
      <img class="peer-av" alt="" src="${Util.escapeHtml(peer.avatarUrl || 'assets/default-avatar.png')}">
      <div class="peer-meta">
        <span class="peer-name">${Util.escapeHtml(peer.name || '名前なし')}</span>
        <span class="peer-id">${peer.handle ? '@' + Util.escapeHtml(peer.handle) : ''}</span>
        <div class="peer-metrics">
          <span><b>${f(peer.following)}</b>フォロー中</span>
          <span><b>${f(peer.followers)}</b>フォロワー</span>
        </div>
      </div>
    `;
  }

  return { add, list, listAll, clear, render, renderFilter, peerBarHtml };
})();
