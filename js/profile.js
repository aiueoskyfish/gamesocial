/* ==========================================================================
   profile.js - 自分の情報

   名前・アイコン・ID・フォロワー数は X から取得したものを使い、変更できない。
   ここで編集できるのは「性別」と「遊ぶゲーム」だけで、どちらも
   つながる相手の絞り込みに使われる。
   ========================================================================== */

const Profile = (() => {

  /* 絞り込みに使うため自由記述ではなく選択式。未設定も許容する */
  const GENDERS = ['女性', '男性', 'その他'];

  const POPULAR_GAMES = [
    'VALORANT', 'Apex Legends', 'フォートナイト', 'Overwatch 2', 'LoL',
    'Minecraft', 'スプラトゥーン3', '原神', 'FF14', 'モンハンワイルズ',
    'Dead by Daylight', 'PUBG', 'CoD', 'R6S', 'Rocket League',
    'Among Us', 'マリオカート', 'スマブラSP', 'あつ森', 'ポケモンSV',
    'Rust', 'ARK', 'Terraria', 'Phasmophobia', 'GTA V',
    'Tarkov', 'Destiny 2', 'ストリートファイター6', '鉄拳8', 'スターレイル',
    'ゼンゼロ', '第五人格', 'VRChat', 'Roblox', 'Palworld',
    'Stardew Valley', 'プロセカ', 'ウマ娘'
  ];

  const MAX_GAMES = 10;

  let me = null;

  async function load(twitterUser) {
    const saved = (await DB.get('meta', 'profile')) || {};
    me = {
      /* X 由来（変更不可） */
      id: twitterUser.id,
      handle: twitterUser.username || '',
      name: twitterUser.name || '',
      avatarUrl: twitterUser.avatarUrl || '',
      followers: twitterUser.followers || 0,
      following: twitterUser.following || 0,
      /* 端末側で編集するもの */
      gender: saved.gender || '',
      games: Array.isArray(saved.games) ? saved.games : [],
      age: saved.age || '',
      ageDone: !!saved.ageDone
    };
    return me;
  }

  function get() { return me; }

  async function save() {
    await DB.set('meta', 'profile', {
      gender: me.gender, games: me.games, age: me.age, ageDone: me.ageDone
    });
    return me;
  }

  /* 年齢は集計用に1回集めるだけで、アプリ内のどこにも表示しないし
     マッチングにも使わない。入力内容は検証せず、何が来ても受け取って通す。 */
  function needsAge() { return !me.ageDone; }

  async function setAge(value) {
    me.age = String(value == null ? '' : value).trim().slice(0, 16);
    me.ageDone = true;
    await save();
    reportAge();   /* 送信の成否は利用の妨げにしない */
    return me.age;
  }

  /* 年齢は運営の集計用にだけ送る。相手に渡るロビー情報には載せない。 */
  function reportAge() {
    const url = Auth.AUTH_CONFIG.workerUrl;
    if (!url || url.indexOf('YOUR-WORKER') !== -1) return;
    fetch(url + '/age', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: me.id, handle: me.handle, age: me.age, at: Date.now() })
    }).catch(() => { /* 届かなくても利用は続行する */ });
  }

  /* ロビーに載せる自己紹介。相手の画面に出る情報はこれが全て */
  function lobbyCard() {
    return {
      id: me.id,
      handle: me.handle,
      name: me.name,
      avatarUrl: me.avatarUrl,
      followers: me.followers,
      following: me.following,
      gender: me.gender,
      games: JSON.stringify(me.games || [])
    };
  }

  function formatCount(n) {
    const v = Number(n) || 0;
    if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万';
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(v);
  }

  /* ---- 自分の情報カード（読み取り専用） ---- */

  function renderMeCard(box) {
    if (!box || !me) return;
    box.innerHTML = `
      <img class="me-card-av" alt="" src="${Util.escapeHtml(me.avatarUrl || 'assets/default-avatar.png')}">
      <div class="me-card-body">
        <span class="me-card-name"></span>
        <span class="me-card-id"></span>
        <div class="me-card-metrics">
          <span><b>${formatCount(me.following)}</b>フォロー中</span>
          <span><b>${formatCount(me.followers)}</b>フォロワー</span>
        </div>
      </div>
    `;
    box.querySelector('.me-card-name').textContent = me.name || '名前未取得';
    box.querySelector('.me-card-id').textContent = me.handle ? '@' + me.handle : '';
  }

  /* ---- 性別（自分の設定） ---- */

  function renderGender(box, onChange) {
    if (!box || !me) return;
    box.innerHTML = '';

    const mk = (value, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (me.gender === value ? ' is-on' : '');
      b.textContent = label;
      b.addEventListener('click', async () => {
        me.gender = value;
        await save();
        renderGender(box, onChange);
        if (onChange) onChange();
      });
      box.appendChild(b);
    };

    mk('', '未設定');
    for (const g of GENDERS) mk(g, g);
  }

  /* ---- 遊ぶゲーム ---- */

  function renderGames(box, countEl, onChange) {
    if (!box || !me) return;
    box.innerHTML = '';

    const all = [...new Set([...POPULAR_GAMES, ...me.games])];
    for (const g of all) {
      const on = me.games.includes(g);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (on ? ' is-on' : '');
      b.textContent = g;
      b.addEventListener('click', async () => {
        if (on) me.games = me.games.filter(x => x !== g);
        else if (me.games.length >= MAX_GAMES) {
          UI.toast('ゲームは最大' + MAX_GAMES + '個までです', 'error');
          return;
        } else me.games.push(g);
        await save();
        renderGames(box, countEl, onChange);
        if (onChange) onChange();
      });
      box.appendChild(b);
    }
    if (countEl) countEl.textContent = me.games.length + ' / ' + MAX_GAMES;
  }

  async function addGame(name) {
    if (!name) return false;
    if (me.games.includes(name)) { UI.toast('すでに追加されています', 'info'); return false; }
    if (me.games.length >= MAX_GAMES) { UI.toast('ゲームは最大' + MAX_GAMES + '個までです', 'error'); return false; }
    me.games.push(name);
    await save();
    return true;
  }

  return {
    GENDERS, POPULAR_GAMES, MAX_GAMES,
    load, get, save, lobbyCard, formatCount,
    needsAge, setAge,
    renderMeCard, renderGender, renderGames, addGame
  };
})();
