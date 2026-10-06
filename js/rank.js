/* ==========================================================================
   rank.js - ランク

   XP は端末側だけで管理する（Gun には出さない）。
   分散型なので他人と突き合わせても正しさを保証できず、
   ランキングも作らない方針なので、純粋に自分用の指標として扱う。
   ========================================================================== */

const Rank = (() => {

  const RANKS = [
    { name: 'Silver',   min: 0,     icon: 'medal', color: '#c7cdd6' },
    { name: 'Gold',     min: 500,   icon: 'medal', color: '#f2c14e' },
    { name: 'Platinum', min: 2000,  icon: 'gem',   color: '#9fe8d8' },
    { name: 'Diamond',  min: 6000,  icon: 'gem',   color: '#8fd4ff' },
    { name: 'Mythic',   min: 15000, icon: 'crown', color: '#c89bff' }
  ];

  const XP_TABLE = {
    dailyLogin:  10,
    connected:   20,   /* 1回つながるごと */
    callMin:      5,   /* 通話1分ごと */
    chatMin:      3    /* チャット1分ごと */
  };

  const LABELS = {
    dailyLogin: 'ログインボーナス',
    connected:  'つながった',
    callMin:    '通話',
    chatMin:    'チャット'
  };

  let xp = 0;

  async function load() {
    xp = (await DB.get('meta', 'xp')) || 0;
    return xp;
  }

  function current() { return xp; }

  function rankOf(v = xp) {
    let r = RANKS[0];
    for (const x of RANKS) if (v >= x.min) r = x;
    return r;
  }

  function nextOf(v = xp) {
    for (const x of RANKS) if (v < x.min) return x;
    return null;
  }

  function progress(v = xp) {
    const cur = rankOf(v);
    const next = nextOf(v);
    if (!next) return 1;
    const span = next.min - cur.min;
    return span <= 0 ? 1 : (v - cur.min) / span;
  }

  function formatXp(n) { return (n || 0).toLocaleString('ja-JP'); }

  function badgeHtml(v = xp) {
    const r = rankOf(v);
    return '<span class="rank-badge" style="--rank-color:' + r.color + '">' +
             Icon.svg(r.icon, 'rank-badge-icon') +
             '<span class="rank-badge-name">' + r.name + '</span>' +
             '<span class="rank-badge-xp">' + formatXp(v) + '</span>' +
           '</span>';
  }

  function nextLine(v = xp) {
    const next = nextOf(v);
    if (!next) return '最高ランクに到達しています';
    return '<span class="rank-next-inner" style="--rank-color:' + next.color + '">次は ' +
           Icon.svg(next.icon, 'rank-next-icon') + next.name +
           ' まで ' + formatXp(next.min - v) + '</span>';
  }

  async function addXp(key, times = 1) {
    const amount = (XP_TABLE[key] || 0) * times;
    if (amount <= 0) return null;

    const before = xp;
    xp = before + amount;
    await DB.set('meta', 'xp', xp);

    floatXp(amount, LABELS[key] || '');

    const rBefore = rankOf(before);
    const rAfter = rankOf(xp);
    if (rBefore.name !== rAfter.name) showRankUp(rAfter);

    render();
    return { amount, before, after: xp, rank: rAfter };
  }

  function floatXp(amount, label) {
    const host = document.getElementById('xpHost');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.innerHTML = '<strong>+' + amount + '</strong>' +
                   (label ? '<span>' + Util.escapeHtml(label) + '</span>' : '');
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('xp-float-go'));
    setTimeout(() => el.remove(), 1800);
  }

  function showRankUp(rank) {
    const ov = document.getElementById('rankUpOverlay');
    if (!ov) return;
    document.getElementById('rankUpIcon').innerHTML = Icon.svg(rank.icon, 'rankup-icon-svg');
    document.getElementById('rankUpName').textContent = rank.name;
    ov.style.setProperty('--rank-color', rank.color);
    ov.classList.remove('hidden');
    requestAnimationFrame(() => ov.classList.add('is-on'));

    const close = () => {
      ov.classList.remove('is-on');
      setTimeout(() => ov.classList.add('hidden'), 400);
    };
    setTimeout(close, 3000);
    ov.onclick = close;
  }

  async function checkDailyLogin() {
    const today = Util.todayKey();
    const last = await DB.get('meta', 'lastLoginDate');
    if (last === today) return false;

    await DB.set('meta', 'lastLoginDate', today);

    const streak = (await DB.get('meta', 'loginStreak')) || 0;
    const y = new Date(Date.now() - 86400000);
    const yKey = y.getFullYear() + '-' +
                 String(y.getMonth() + 1).padStart(2, '0') + '-' +
                 String(y.getDate()).padStart(2, '0');
    await DB.set('meta', 'loginStreak', last === yKey ? streak + 1 : 1);

    await addXp('dailyLogin');
    return true;
  }

  function render() {
    const box = document.getElementById('menuRank');
    if (!box) return;
    const cur = rankOf();
    const pct = Math.round(progress() * 100);

    box.innerHTML =
      badgeHtml() +
      '<div class="rank-bar"><div class="rank-bar-fill" style="width:' + pct + '%;background:' + cur.color + '"></div></div>' +
      '<div class="rank-next">' + nextLine() + '</div>';
  }

  return {
    RANKS, XP_TABLE, LABELS,
    load, current, rankOf, nextOf, progress, badgeHtml, nextLine, formatXp,
    addXp, floatXp, showRankUp, checkDailyLogin, render
  };
})();
