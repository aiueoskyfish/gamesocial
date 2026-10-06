/* ==========================================================================
   icons.js - SVGアイコン
   UIに絵文字を使うと環境ごとに字形が変わる上に安っぽく見えるため、
   線幅を揃えた自前のアイコンに統一する。色は currentColor で追従する。
   ========================================================================== */

const Icon = (() => {

  /* 24x24 グリッド、線幅1.7で統一 */
  const PATHS = {
    logo:      '<rect x="2.4" y="6.2" width="19.2" height="12.4" rx="5"/><path d="M7.6 10.8v3.2M6 12.4h3.2"/><circle cx="15.8" cy="11.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="18" cy="14" r="1.1" fill="currentColor" stroke="none"/>',
    menu:      '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close:     '<path d="M6 6l12 12M18 6L6 18"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',

    link:      '<path d="M10.2 13.8a4 4 0 0 0 5.8.3l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M13.8 10.2a4 4 0 0 0-5.8-.3l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
    clock:     '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 1.9"/>',
    profile:   '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.2c.7-3.7 3.8-6 7.5-6s6.8 2.3 7.5 6"/>',
    verified:  '<path d="M12 2.4 14.4 5l3.5-.4.6 3.5 3 1.9-1.6 3.1 1.6 3.1-3 1.9-.6 3.5-3.5-.4L12 21.6 9.6 19l-3.5.4-.6-3.5-3-1.9L4.1 11 2.5 7.9l3-1.9.6-3.5L9.6 5 12 2.4Z" fill="currentColor" stroke="none"/><path d="m8.6 12.1 2.3 2.3 4.5-4.6" stroke="var(--verified-ink,#0b0910)" stroke-width="2.1" fill="none"/>',

    phone:     '<path d="M16.3 21c-7 0-13.3-6.3-13.3-13.3 0-1 .3-1.9 1-2.5l1.7-1.7c.5-.5 1.3-.5 1.8 0l2.9 2.9c.5.5.5 1.3 0 1.8l-1.5 1.5a13 13 0 0 0 5.4 5.4l1.5-1.5c.5-.5 1.3-.5 1.8 0l2.9 2.9c.5.5.5 1.3 0 1.8l-1.7 1.7c-.6.7-1.5 1-2.5 1Z"/>',
    keyboard:  '<rect x="2.6" y="6" width="18.8" height="12" rx="2.6"/><path d="M7 10v.1M11 10v.1M15 10v.1M17 10v.1M7 13.8h10"/>',
    mic:       '<rect x="9" y="2.8" width="6" height="11.4" rx="3"/><path d="M5.5 11.4a6.5 6.5 0 0 0 13 0M12 17.9v3.3"/>',
    micOff:    '<path d="M9 5.6a3 3 0 0 1 6 0v4.2m-6 1.2v-1.2"/><path d="M5.5 11.4a6.5 6.5 0 0 0 10 5.5M18.5 11.4a6.4 6.4 0 0 1-.5 2.5M12 17.9v3.3"/><path d="M3.5 3.2 20.5 20.8"/>',

    check:     '<path d="M4.8 12.6 9.6 17.4 19.2 6.6"/>',
    info:      '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5M12 7.9v.2"/>',
    alert:     '<path d="M12 4.2 2.6 20h18.8L12 4.2Z"/><path d="M12 10v4.2M12 17.4v.2"/>',
    sparkle:   '<path d="M12 3.2l2.1 5.4 5.4 2.1-5.4 2.1L12 18.2l-2.1-5.4-5.4-2.1 5.4-2.1L12 3.2Z"/><path d="M18.8 16.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>',

    /* ランク */
    medal:     '<circle cx="12" cy="14.6" r="5.4"/><path d="M8.4 9.6 6 3.4h12l-2.4 6.2"/><path d="m12 12.2 1 2 2.2.3-1.6 1.6.4 2.2-2-1-2 1 .4-2.2-1.6-1.6 2.2-.3 1-2Z"/>',
    gem:       '<path d="M6.2 3.6h11.6l3.6 5.6L12 20.6 2.6 9.2l3.6-5.6Z"/><path d="M2.6 9.2h18.8M8.6 3.6 12 20.6 15.4 3.6"/>',
    crown:     '<path d="M3.4 7.4 6.6 14l5.4-9 5.4 9 3.2-6.6V18a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2V7.4Z"/>'
  };

  /* HTML文字列として欲しい場合（innerHTML に差し込む用） */
  function svg(n, cls = '') {
    const body = PATHS[n];
    if (!body) return '';
    return '<svg class="ico ' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  }

  /* <i data-ico="xxx"> を実際の SVG に置き換える */
  function hydrate(root = document) {
    root.querySelectorAll('[data-ico]').forEach(el => {
      const key = el.dataset.ico;
      if (!PATHS[key]) return;
      const cls = el.className ? el.className + ' ' : '';
      el.outerHTML = '<svg class="ico ' + cls.trim() + '" viewBox="0 0 24 24" aria-hidden="true">' + PATHS[key] + '</svg>';
    });
  }

  return { svg, hydrate, has: n => !!PATHS[n], PATHS };
})();

document.addEventListener('DOMContentLoaded', () => Icon.hydrate());
