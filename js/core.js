/* ==========================================================================
   core.js - 共通の土台
   IndexedDB ラッパー / トースト通知 / 汎用ヘルパー

   保存先は IndexedDB のみ。ブラウザのキャッシュを消せば全部消える。
   （鍵もプロフィールも履歴も引き継がない、という方針）
   ========================================================================== */

const DB_NAME = 'gamesocial';
const DB_VERSION = 2;

const STORES = ['meta', 'calls', 'chats'];

const DB = (() => {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
        /* 廃止した機能（音楽・絵文字・テーマ・DM・スワイプ）のストアを掃除する */
        for (const name of [...db.objectStoreNames]) {
          if (!STORES.includes(name)) db.deleteObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  /* fn は必ず IDBRequest を返すこと。
     キーが存在しない get は req.result が undefined になるため、
     「リクエスト自身」を返さないよう result を明示的に取り出す。 */
  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let req;
      try {
        req = fn(t.objectStore(store));
      } catch (e) {
        reject(e);
        return;
      }
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  return {
    get:   (store, key)        => tx(store, 'readonly',  s => s.get(key)),
    set:   (store, key, value) => tx(store, 'readwrite', s => s.put(value, key)),
    del:   (store, key)        => tx(store, 'readwrite', s => s.delete(key)),
    clear: (store)             => tx(store, 'readwrite', s => s.clear()),
    keys:  (store)             => tx(store, 'readonly',  s => s.getAllKeys()),
    all:   (store)             => tx(store, 'readonly',  s => s.getAll())
  };
})();

/* ==========================================================================
   トースト
   ========================================================================== */

const UI = (() => {
  const ICONS = { info: 'info', success: 'check', error: 'alert', xp: 'sparkle' };

  function host() {
    let h = document.getElementById('toastHost');
    if (!h) {
      h = document.createElement('div');
      h.id = 'toastHost';
      h.className = 'toast-host';
      h.setAttribute('aria-live', 'polite');
      document.body.appendChild(h);
    }
    return h;
  }

  function toast(message, type = 'info', ms = 3600) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML =
      '<span class="toast-icon">' + Icon.svg(ICONS[type] || ICONS.info) + '</span>' +
      '<span class="toast-msg"></span>';
    el.querySelector('.toast-msg').textContent = message;
    host().appendChild(el);

    requestAnimationFrame(() => el.classList.add('toast-in'));

    const kill = () => {
      el.classList.remove('toast-in');
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 600);
    };
    const timer = setTimeout(kill, ms);
    el.addEventListener('click', () => { clearTimeout(timer); kill(); });
    return el;
  }

  function busy(btn, label = '処理中...') {
    if (!btn) return () => {};
    const prev = btn.innerHTML;
    const prevDisabled = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span><span>' + Util.escapeHtml(label) + '</span>';
    return () => { btn.innerHTML = prev; btn.disabled = prevDisabled; };
  }

  function confirmDialog(message, okLabel = 'OK') {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML =
        '<div class="modal modal-sm" role="dialog" aria-modal="true">' +
          '<p class="modal-text"></p>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-ghost" data-no>キャンセル</button>' +
            '<button class="btn btn-danger" data-yes></button>' +
          '</div>' +
        '</div>';
      back.querySelector('.modal-text').textContent = message;
      back.querySelector('[data-yes]').textContent = okLabel;
      document.body.appendChild(back);
      requestAnimationFrame(() => back.classList.add('modal-open'));

      const close = v => {
        back.classList.remove('modal-open');
        setTimeout(() => back.remove(), 200);
        resolve(v);
      };
      back.querySelector('[data-yes]').onclick = () => close(true);
      back.querySelector('[data-no]').onclick = () => close(false);
      back.onclick = e => { if (e.target === back) close(false); };
    });
  }

  return { toast, busy, confirmDialog };
})();

/* ==========================================================================
   ヘルパー
   ========================================================================== */

const Util = {
  escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  base64url(bytes) {
    let bin = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (const b of arr) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  randomId(len = 16) {
    const b = new Uint8Array(len);
    crypto.getRandomValues(b);
    return Util.base64url(b);
  },

  mmss(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  },

  ago(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return 'たった今';
    if (d < 3600000) return Math.floor(d / 60000) + '分前';
    if (d < 86400000) return Math.floor(d / 3600000) + '時間前';
    if (d < 604800000) return Math.floor(d / 86400000) + '日前';
    return new Date(ts).toLocaleDateString('ja-JP');
  },

  todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  },

  parseList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v) { try { return JSON.parse(v); } catch { return []; } }
    return [];
  },

  debounce(fn, ms = 200) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  },

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
};
