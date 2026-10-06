/* ==========================================================================
   app.js - 起動と画面制御
   ========================================================================== */

const App = (() => {

  let twitterUser = null;
  let currentView = 'home';

  function boot(text) {
    const t = document.getElementById('bootText');
    if (t) t.textContent = text;
  }

  async function start() {
    if (Auth.hasCallbackParams()) {
      boot('Xの認証を確認しています...');
      try {
        await Auth.handleCallback();
      } catch (e) {
        showBootError(e.message);
        return;
      }
    }

    if (!Auth.isLoggedIn()) {
      location.replace('index.html');
      return;
    }

    boot('プロフィールを取得しています...');
    try {
      twitterUser = await Auth.getUserInfo();
    } catch (e) {
      const cached = await Auth.getCachedUser();
      if (!cached) { showBootError(e.message); return; }
      twitterUser = cached;
      UI.toast('Xの情報を更新できませんでした。保存済みの情報で続行します', 'error', 5000);
    }

    boot('接続しています...');
    try {
      await GunDB.init(twitterUser.id);
    } catch (e) {
      UI.toast('P2Pネットワークに接続できませんでした', 'error', 6000);
      console.error(e);
    }

    await Profile.load(twitterUser);
    await Rank.load();

    RTC.init();
    Chat.init();
    Connect.init();
    bindChrome();
    bindSession();
    renderHome();
    renderSettings();
    Rank.render();

    document.getElementById('bootOverlay').classList.add('hidden');

    /* 年齢はまだ聞いていないときだけ1回出す */
    if (Profile.needsAge()) openAgeGate();

    if (await Rank.checkDailyLogin()) {
      UI.toast('ログインボーナス +' + Rank.XP_TABLE.dailyLogin, 'xp', 3500);
    }

    setTimeout(() => {
      if (GunDB.peerCount === 0) {
        UI.toast('リレーに接続できていません。relay/README.md の手順でリレーを立ててください', 'error', 9000);
      }
    }, 6000);
  }

  function showBootError(message) {
    const ov = document.getElementById('bootOverlay');
    ov.innerHTML =
      '<div class="boot-inner">' +
        '<p class="boot-err"></p>' +
        '<button class="btn-line" id="bootRelogin" type="button" style="width:auto;padding:0 24px">ログイン画面に戻る</button>' +
      '</div>';
    ov.querySelector('.boot-err').textContent = message;
    document.getElementById('bootRelogin').onclick = () => Auth.logout();
  }

  /* ---- ホーム ---- */

  function renderHome() {
    const me = Profile.get();
    document.getElementById('meAvatar').src = me.avatarUrl || 'assets/default-avatar.png';
    document.getElementById('meName').textContent = me.name || '名前未取得';
    document.getElementById('meHandle').textContent = me.handle ? '@' + me.handle : '';
  }

  /* ---- 年齢の入力 ---- */

  function openAgeGate() {
    const me = Profile.get();
    const gate = document.getElementById('ageGate');
    const input = document.getElementById('ageInput');

    document.getElementById('ageAvatar').src = me.avatarUrl || 'assets/default-avatar.png';
    document.getElementById('ageName').textContent = me.name || '';
    document.getElementById('ageHandle').textContent = me.handle ? '@' + me.handle : '';
    document.getElementById('ageUserId').textContent = 'ID: ' + (me.id || '—');
    input.value = '';

    gate.classList.remove('hidden');
    requestAnimationFrame(() => gate.classList.add('is-on'));
    setTimeout(() => input.focus(), 200);

    /* 何が入力されても弾かず、そのまま受け取って閉じる */
    const submit = async () => {
      await Profile.setAge(input.value);
      gate.classList.remove('is-on');
      setTimeout(() => gate.classList.add('hidden'), 300);
    };

    document.getElementById('ageSubmit').onclick = submit;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  }

  /* ---- 画面切り替え ---- */

  function showView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('is-active', v.id === 'view-' + name);
    });
    document.querySelectorAll('.menu-item').forEach(b => {
      b.classList.toggle('is-active', b.dataset.view === name);
    });
    closeMenu();
    window.scrollTo(0, 0);

    if (name === 'history') renderHistory();
  }

  function renderHistory() {
    const listEl = document.getElementById('histList');
    const emptyEl = document.getElementById('histEmpty');
    History.renderFilter(document.getElementById('histFilter'), () => History.render(listEl, emptyEl));
    History.render(listEl, emptyEl);
  }

  /* ---- メニュー ---- */

  function openMenu() {
    document.getElementById('menuSheet').classList.add('is-on');
    document.getElementById('menuScrim').classList.add('is-on');
  }
  function closeMenu() {
    document.getElementById('menuSheet').classList.remove('is-on');
    document.getElementById('menuScrim').classList.remove('is-on');
  }

  function bindChrome() {
    document.getElementById('homeBtn').onclick = () => showView('home');
    document.getElementById('histBtn').onclick = () => showView('history');
    document.getElementById('editProfBtn').onclick = () => showView('settings');

    document.getElementById('menuBtn').onclick = openMenu;
    document.getElementById('menuClose').onclick = closeMenu;
    document.getElementById('menuScrim').onclick = closeMenu;

    document.querySelectorAll('.menu-item').forEach(b => {
      b.onclick = () => showView(b.dataset.view);
    });

    document.getElementById('logoutBtn').onclick = async () => {
      if (await UI.confirmDialog('ログアウトします。履歴もこの端末から消えます。', 'ログアウト')) {
        await DB.clear('calls');
        await DB.clear('chats');
        Auth.logout();
      }
    };

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  /* ---- プロフィール ---- */

  function renderSettings() {
    Profile.renderMeCard(document.getElementById('meCard'));
    Profile.renderGender(document.getElementById('myGender'));

    const gamesBox = document.getElementById('myGames');
    const countEl = document.getElementById('myGameCount');
    const redraw = () => Profile.renderGames(gamesBox, countEl, () => Connect.refreshGameFilter());
    redraw();

    const input = document.getElementById('myGameInput');
    const add = async () => {
      if (await Profile.addGame(input.value.trim())) {
        input.value = '';
        redraw();
        Connect.refreshGameFilter();
      }
    };
    document.getElementById('myGameAdd').onclick = add;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  }

  /* ---- 通話・チャットの画面 ---- */

  function bindSession() {
    const callScreen = document.getElementById('callScreen');

    document.getElementById('callMuteBtn').onclick = () => RTC.toggleMute();
    document.getElementById('callEndBtn').onclick = () => RTC.end();

    RTC.on('connected', (peer, mode) => {
      if (mode === 'chat') {
        Chat.open(peer);
      } else {
        document.getElementById('callPeer').innerHTML = History.peerBarHtml(peer);
        document.getElementById('callBigAvatar').src = peer.avatarUrl || 'assets/default-avatar.png';
        document.getElementById('callState').textContent = '通話中';
        document.getElementById('callTimer').textContent = '0:00';
        callScreen.classList.remove('hidden');
        requestAnimationFrame(() => callScreen.classList.add('is-on'));
      }
    });

    RTC.on('ended', async (peer, mode, startedAt) => {
      const transcript = Chat.active ? Chat.close() : null;

      callScreen.classList.remove('is-on');
      setTimeout(() => callScreen.classList.add('hidden'), 300);

      /* 成立しなかった呼び出しは履歴に残さない */
      if (peer && startedAt) {
        await History.add(mode, peer, startedAt, Date.now(), transcript);
        if (currentView === 'history') renderHistory();
      }
    });
  }

  return { start, showView, get view() { return currentView; }, get twitterUser() { return twitterUser; } };
})();

window.addEventListener('DOMContentLoaded', () => {
  App.start().catch(e => {
    console.error(e);
    UI.toast('起動に失敗しました: ' + (e.message || e), 'error', 8000);
  });
});
