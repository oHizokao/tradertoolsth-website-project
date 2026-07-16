/* ============================================================
   TraderToolsTH — Icon library (inline SVG) v3
   Consistent stroke, recognizable, premium friendly
   ============================================================ */

window.TT = window.TT || {};

TT.icon = function (name, size = 20) {
  const paths = {
    // ---- Navigation / UI ----
    signal: '<path d="M3 12h3l3-8 4 16 3-8h5" stroke-linecap="round" stroke-linejoin="round"/>',
    news: '<path d="M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4Z" stroke-linejoin="round"/><path d="M8 8h7M8 12h7M8 16h4" stroke-linecap="round"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2" stroke-linejoin="round"/><path d="M3 9h18M8 3v4M16 3v4" stroke-linecap="round"/>',
    broker: '<path d="M3 21h18M5 21V9l7-5 7 5v12" stroke-linejoin="round"/><path d="M9 21v-6h6v6" stroke-linejoin="round"/>',
    knowledge: '<path d="M4 19V6a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2Z" stroke-linejoin="round"/><path d="M18 17H6a2 2 0 0 0-2 2" stroke-linecap="round"/><path d="M8 7h6M8 11h6" stroke-linecap="round"/>',
    faq: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" stroke-linecap="round"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
    contact: '<path d="M4 5h16v11H8l-4 4V5Z" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" stroke-linecap="round"/>',
    home: '<path d="M4 11 12 4l8 7" stroke-linejoin="round"/><path d="M6 10v10h12V10" stroke-linejoin="round"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/>',
    check: '<path d="M5 12l5 5L20 6" stroke-linecap="round" stroke-linejoin="round"/>',
    x: '<path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/>',
    warning: '<path d="M12 3 2 20h20L12 3Z" stroke-linejoin="round"/><path d="M12 9v5M12 17v.5" stroke-linecap="round"/>',
    star: '<path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.5l1.1-6L3.4 9.3l6-.8L12 3Z" stroke-linejoin="round"/>',
    chart: '<path d="M4 4v16h16" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 14l3-4 3 2 4-6" stroke-linecap="round" stroke-linejoin="round"/>',
    trend: '<path d="M3 17l6-6 4 4 8-9" stroke-linecap="round" stroke-linejoin="round"/>',
    shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" stroke-linejoin="round"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/>',

    // ---- Header utilities ----
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5" stroke-linecap="round"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7" stroke-linecap="round"/><path d="M21 4v5h-5" stroke-linecap="round" stroke-linejoin="round"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" stroke-linejoin="round"/><path d="M10 17l5-5-5-5M15 12H3" stroke-linecap="round" stroke-linejoin="round"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke-linecap="round"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" stroke-linecap="round"/>',
    zap: '<path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z" stroke-linejoin="round"/>',
    gauge: '<path d="M12 13l4-4" stroke-linecap="round"/><path d="M4 18a8 8 0 1 1 16 0" stroke-linecap="round"/><circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"/>',

    // ---- Tools ----
    calculator: '<rect x="5" y="3" width="14" height="18" rx="2" stroke-linejoin="round"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0M8 18h2M12 18h2M16 18h0" stroke-linecap="round"/>',
    ruler: '<path d="M3 8l5-5 13 13-5 5L3 8Z" stroke-linejoin="round"/><path d="M7 4l2 2M10 7l2 2M13 10l2 2M16 13l2 2" stroke-linecap="round"/>',
    pivot: '<path d="M3 12h18" stroke-linecap="round"/><circle cx="6" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M9 8l3-3 3 3M9 16l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/>',
    fibonacci: '<path d="M4 20V4M4 4h16" stroke-linecap="round"/><path d="M4 8h12M4 12h9M4 16h6" stroke-linecap="round"/>',
    margin: '<rect x="3" y="6" width="18" height="12" rx="2" stroke-linejoin="round"/><path d="M7 10v4M17 10v4M12 9v6" stroke-linecap="round"/>',
    layers: '<path d="M12 3 3 8l9 5 9-5-9-5Z" stroke-linejoin="round"/><path d="M3 13l9 5 9-5M3 18l9 5 9-5" stroke-linecap="round" stroke-linejoin="round"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 0-2 2V5Z" stroke-linejoin="round"/><path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 1 2 2V5Z" stroke-linejoin="round"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',

    // ============================================================
    // SOCIAL — proper brand icons
    // ============================================================
    line: '<rect x="3" y="3" width="18" height="18" rx="4" stroke-linejoin="round"/><path d="M7 10.5c0-1.4 1.6-2.5 3.5-2.5S14 9.1 14 10.5s-1.6 2.5-3.5 2.5c-.3 0-.6 0-.9-.1L8 13.5l.4-1.2c-.9-.5-1.4-1.2-1.4-1.8Z" stroke-linejoin="round"/><path d="M16.5 9.5c1.4 0 2.5.9 2.5 2 0 .6-.4 1.1-1 1.5l.3.9-1.2-.7c-.2 0-.4.1-.6.1-1.4 0-2.5-.9-2.5-2s1.1-1.8 2.5-1.8Z" stroke-linejoin="round"/>',
    telegram: '<circle cx="12" cy="12" r="9"/><path d="M16.5 8.2 6.5 12.1c-.5.2-.5.9 0 1l2.5.8 1 3c.1.4.6.5.9.2l1.4-1.3 2.5 1.9c.3.2.7 0 .8-.3l1.9-8.8c.1-.5-.4-.8-.9-.6Z" stroke-linejoin="round"/><path d="m9 13 6-3.5-3.5 4" stroke-linecap="round" stroke-linejoin="round"/>',
    facebook: '<circle cx="12" cy="12" r="9"/><path d="M13.5 8.5h1.2V6.4c-.2 0-.9-.1-1.7-.1-1.7 0-2.8 1-2.8 2.9v1.3H8.5v2.2h1.7V19h2.2v-6.3h1.7l.3-2.2h-2V9.6c0-.7.2-1.1 1.1-1.1Z" stroke-linejoin="round"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  const p = paths[name] || "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false">${p}</svg>`;
};

TT.iconWrap = function (name, size = 20, extra = "") {
  return `<span class="icon" ${extra}>${TT.icon(name, size)}</span>`;
};
