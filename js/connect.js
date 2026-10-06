/* ==========================================================================
   connect.js - つながる（ランダムマッチ）

   ロビーに自分の条件を置き、同時に他人の条件を読む。
   成立させるのは「双方の条件が互いに噛み合ったとき」だけ。
   自分が女性を指定していても、相手が男性を指定していたら成立しない。

   どちらが offer を出すかは公開鍵の大小で決める。
   両方が同時に offer を出すと衝突するため、必ず片方だけが発信側になる。
   ========================================================================== */

const Connect = (() => {

  const POLL = 2500;

  let mode = 'chat';
  let wantGender = '';
  let wantGame = '';
  let searching = false;
  let pollTimer = null;

  const el = {};

  function cache() {
    el.callBtn     = document.getElementById('startCallBtn');
    el.chatBtn     = document.getElementById('startChatBtn');
    el.bubble      = document.getElementById('filterBubble');
    el.bubbleText  = document.getElementById('filterBubbleText');
    el.sheet       = document.getElementById('filterSheet');
    el.sheetScrim  = document.getElementById('filterScrim');
    el.sheetClose  = document.getElementById('filterClose');
    el.gender      = document.getElementById('filterGender');
    el.game        = document.getElementById('filterGame');
    el.searching   = document.getElementById('searching');
    el.searchTitle = document.getElementById('searchingTitle');
    el.searchMeta  = document.getElementById('searchingMeta');
    el.searchCancel = document.getElementById('searchCancel');
  }

  /* ---- 条件UI ---- */

  function renderBubble() {
    const g = wantGender || '誰でも';
    const game = wantGame || 'ゲーム不問';
    el.bubbleText.textContent = g + ' · ' + game;
  }

  function renderGender() {
    el.gender.innerHTML = '';
    const opts = [['', 'こだわらない'], ...Profile.GENDERS.map(g => [g, g])];
    for (const [value, label] of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (wantGender === value ? ' is-on' : '');
      b.textContent = label;
      b.onclick = () => { wantGender = value; renderGender(); renderBubble(); };
      el.gender.appendChild(b);
    }
  }

  function renderGame() {
    const me = Profile.get();
    const games = [...new Set([...(me ? me.games : []), ...Profile.POPULAR_GAMES])];
    el.game.innerHTML = '<option value="">こだわらない</option>' +
      games.map(g => '<option value="' + Util.escapeHtml(g) + '">' + Util.escapeHtml(g) + '</option>').join('');
    el.game.value = wantGame;
    el.game.onchange = () => { wantGame = el.game.value; renderBubble(); };
  }

  function openSheet() {
    renderGender();
    renderGame();
    el.sheet.classList.add('is-on');
    el.sheetScrim.classList.add('is-on');
  }

  function closeSheet() {
    el.sheet.classList.remove('is-on');
    el.sheetScrim.classList.remove('is-on');
  }

  /* ---- 条件の照合 ---- */

  function matches(entry) {
    const me = Profile.get();
    if (!entry || entry.mode !== mode) return false;

    /* 自分の希望 → 相手 */
    if (wantGender && entry.gender !== wantGender) return false;
    if (wantGame && !Util.parseList(entry.games).includes(wantGame)) return false;

    /* 相手の希望 → 自分 */
    if (entry.wantGender && me.gender !== entry.wantGender) return false;
    if (entry.wantGame && !me.games.includes(entry.wantGame)) return false;

    return true;
  }

  /* ---- 探索 ---- */

  async function start(kind) {
    if (searching || RTC.active) return;
    const me = Profile.get();
    if (!me) return;

    mode = kind;
    searching = true;
    RTC.setAcceptMode(mode);

    GunDB.enterLobby({ ...Profile.lobbyCard(), mode, wantGender, wantGame });

    showSearching(true);
    tick();
    pollTimer = setInterval(tick, POLL);
  }

  async function tick() {
    if (!searching) return;

    const list = await GunDB.readLobby(POLL - 400);
    if (!searching || RTC.active) return;

    const candidates = list.filter(matches);
    el.searchMeta.textContent = candidates.length
      ? '条件に合う相手: ' + candidates.length + '人'
      : '待っている人: ' + list.length + '人';

    if (!candidates.length) return;

    /* 公開鍵が小さい側だけが発信する。相手が小さければ向こうから来るので待つ */
    const callable = candidates.filter(c => GunDB.pub < c.pub);
    if (!callable.length) return;

    const target = callable[Math.floor(Math.random() * callable.length)];
    await RTC.offerTo(target, mode);
  }

  function stop(silent) {
    if (!searching) return;
    searching = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    GunDB.leaveLobby();
    RTC.setAcceptMode(null);
    showSearching(false);
    if (!silent) UI.toast('探索をやめました', 'info', 1800);
  }

  function showSearching(on) {
    if (!el.searching) return;
    if (on) {
      el.searchTitle.textContent = (mode === 'chat' ? 'チャット' : '通話') + 'できる相手を探しています';
      el.searchMeta.textContent = '';
      el.searching.classList.remove('hidden');
      requestAnimationFrame(() => el.searching.classList.add('is-on'));
    } else {
      el.searching.classList.remove('is-on');
      setTimeout(() => el.searching.classList.add('hidden'), 280);
    }
  }

  function init() {
    cache();
    renderBubble();

    el.callBtn.onclick = () => start('call');
    el.chatBtn.onclick = () => start('chat');

    el.bubble.onclick = openSheet;
    el.sheetClose.onclick = closeSheet;
    el.sheetScrim.onclick = closeSheet;
    el.searchCancel.onclick = () => stop();

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSheet();
    });

    RTC.on('connected', () => {
      searching = false;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      GunDB.leaveLobby();
      showSearching(false);
    });

    window.addEventListener('beforeunload', () => GunDB.leaveLobby());
  }

  /* プロフィールでゲームを変えたら候補リストを作り直す */
  function refreshGameFilter() {
    if (el.game) renderGame();
  }

  return { init, start, stop, refreshGameFilter, get searching() { return searching; }, get mode() { return mode; } };
})();
