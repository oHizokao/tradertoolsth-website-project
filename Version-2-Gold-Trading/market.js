/* Market Overview — consumes only first-party public APIs. */
(function () {
  const LABELS = {
    XAUUSD: "ทองคำ", XAGUSD: "เงิน", EURUSD: "ยูโร / ดอลลาร์",
    GBPUSD: "ปอนด์ / ดอลลาร์", USDJPY: "ดอลลาร์ / เยน",
    BTCUSD: "Bitcoin", DXY: "Dollar Index", OIL: "น้ำมัน WTI",
  };
  const CLASSES = {
    XAUUSD: "metals", XAGUSD: "metals", EURUSD: "forex", GBPUSD: "forex",
    USDJPY: "forex", BTCUSD: "crypto", DXY: "index", OIL: "commodity",
  };
  const CURRENCY = { EURUSD: "EUR", GBPUSD: "GBP", USDJPY: "JPY" };
  const FILTERS = [
    ["all", "ทั้งหมด"], ["watchlist", "Watchlist"], ["metals", "โลหะ"],
    ["forex", "Forex"], ["crypto", "Crypto"], ["index", "ดัชนี"],
    ["commodity", "สินค้าโภคภัณฑ์"],
  ];
  const state = {
    items: [], status: "loading", updatedAt: null, stale: false,
    filter: "all", selected: "XAUUSD", extras: { news: [], events: [] },
    watch: loadWatchlist(),
  };

  function loadWatchlist() {
    try {
      const saved = JSON.parse(localStorage.getItem("tt-market-watchlist") || "null");
      if (Array.isArray(saved)) return new Set(saved.filter((s) => LABELS[s]));
    } catch (_) {}
    return new Set(["XAUUSD", "EURUSD", "BTCUSD"]);
  }

  function saveWatchlist() {
    localStorage.setItem("tt-market-watchlist", JSON.stringify([...state.watch]));
  }

  function esc(value) { return TT.h.esc(String(value == null ? "" : value)); }
  function formatPrice(value) {
    if (!Number.isFinite(value)) return "—";
    const digits = value >= 1000 ? 2 : value >= 10 ? 3 : 5;
    return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 2 });
  }
  function formatTime(value) {
    if (!value) return "ยังไม่มีเวลาอัปเดต";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "ยังไม่มีเวลาอัปเดต" :
      `อัปเดต ${d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} น.`;
  }

  function renderShell() {
    const main = `${TT.layout.ticker()}
      <section class="page market-page">
        <div class="container">
          <div class="page-head market-head">
            <span class="eyebrow">${TT.icon("chart", 14)} MARKET OVERVIEW</span>
            <h1>ติดตาม <span class="text-grad-blue">ภาพรวมตลาด</span></h1>
            <p>ข้อมูลราคา ข่าว และเหตุการณ์เศรษฐกิจจากระบบเดียว พร้อมสถานะความสดของข้อมูลอย่างชัดเจน</p>
          </div>

          <!-- บอกตามตรง: เป็นข้อมูลราคาอ้างอิงจากระบบรวบรวมตลาด มิใช่สัญญาณเทรดจาก EA/MT5 -->
          <div class="alert alert--info" style="margin-bottom:20px">
            <span class="alert__icon">${TT.icon("info", 18)}</span>
            <div>
              <strong>ข้อมูลราคาอ้างอิง (Reference Market Data)</strong> — ราคานี้มาจากระบบรวบรวมตลาดของเว็บ
              ใช้สำหรับติดตามและประกอบการวิเคราะห์เท่านั้น <strong>มิใช่สัญญาณเทรดจริงหรือคำสั่งจากระบบ EA/MT5</strong>
              (ยังไม่มีการเชื่อมต่อ EA/MT5 signal feed) ราคาอาจต่างจากเบรกเกอร์หรือ TradingView ของแต่ละราย
            </div>
          </div>
          <div class="market-toolbar">
            <div class="segmented market-filters" id="marketFilters">
              ${FILTERS.map(([key, label]) => `<button type="button" data-filter="${key}" class="${key === "all" ? "is-active" : ""}">${label}</button>`).join("")}
            </div>
            <button class="btn btn--ghost btn--sm" type="button" id="marketRefresh">${TT.icon("refresh", 16)} รีเฟรช</button>
          </div>
          <div id="marketStatus" aria-live="polite"></div>
          <div class="market-layout">
            <div id="marketGrid" class="market-grid" aria-live="polite"></div>
            <aside id="marketDetail" class="market-detail" aria-live="polite"></aside>
          </div>
        </div>
      </section>`;
    document.getElementById("app").innerHTML = TT.layout.page({ active: "market", main });
    TT.layout.initNavbar();
    bind();
    renderMarket();
    TT.MarketTickerService.subscribe(onTicker);
    TT.MarketTickerService.start();
    loadExtras();
  }

  function bind() {
    document.getElementById("marketFilters").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      state.filter = btn.dataset.filter;
      document.querySelectorAll("#marketFilters button").forEach((b) => b.classList.toggle("is-active", b === btn));
      renderMarket();
    });
    document.getElementById("marketRefresh").addEventListener("click", () => TT.MarketTickerService.refresh());
    document.getElementById("marketGrid").addEventListener("click", (e) => {
      const watch = e.target.closest("button[data-watch]");
      if (watch) {
        const symbol = watch.dataset.watch;
        state.watch.has(symbol) ? state.watch.delete(symbol) : state.watch.add(symbol);
        saveWatchlist(); renderMarket(); return;
      }
      const card = e.target.closest("button[data-symbol]");
      if (!card) return;
      state.selected = card.dataset.symbol;
      renderMarket(); loadExtras();
    });
  }

  function onTicker(snap) {
    state.items = snap.items || [];
    state.status = snap.status;
    state.updatedAt = snap.updatedAt;
    state.stale = snap.stale;
    if (!state.items.some((i) => i.symbol === state.selected) && state.items[0]) state.selected = state.items[0].symbol;
    renderMarket();
  }

  function visibleItems() {
    if (state.filter === "watchlist") return state.items.filter((i) => state.watch.has(i.symbol));
    if (state.filter === "all") return state.items;
    return state.items.filter((i) => (i.assetClass || CLASSES[i.symbol]) === state.filter);
  }

  function renderMarket() {
    const status = document.getElementById("marketStatus");
    const grid = document.getElementById("marketGrid");
    if (!status || !grid) return;
    const statusText = state.status === "live" ? "ข้อมูลตลาดล่าสุด" : state.status === "stale" ? "กำลังแสดงข้อมูลล่าสุดที่มี" : state.status === "loading" ? "กำลังโหลดข้อมูลตลาด" : "ไม่สามารถอัปเดตข้อมูลตลาดได้";
    status.innerHTML = `<div class="market-status market-status--${esc(state.status)}"><span class="dot"></span><strong>${statusText}</strong><span>${formatTime(state.updatedAt)}</span></div>`;
    if (state.status === "loading" && !state.items.length) {
      grid.innerHTML = Array.from({ length: 6 }, () => `<div class="market-card market-card--skeleton"><span></span><span></span><span></span></div>`).join("");
    } else if ((state.status === "unavailable" || state.status === "empty") && !state.items.length) {
      // แจ้งตามตรงเมื่อดึงข้อมูลไม่ได้ — ห้ามแสดงเป็น "ไม่มีสินทรัพย์ในหมวด" เพราะจะเข้าใจผิด
      const title = state.status === "unavailable" ? "ไม่สามารถอัปเดตข้อมูลตลาดได้ในขณะนี้" : "ยังไม่มีข้อมูลตลาด";
      grid.innerHTML = `<div class="state state--wide"><div class="state__title">${title}</div><p>กรุณารีเฟรชอีกครั้ง หรือลองใหม่ภายหลัง</p></div>`;
    } else {
      const list = visibleItems();
      grid.innerHTML = list.length ? list.map(cardMarkup).join("") : `<div class="state state--wide"><div class="state__title">ยังไม่มีสินทรัพย์ในหมวดนี้</div><p>เพิ่มรายการโปรดหรือเลือกหมวดอื่น</p></div>`;
    }
    renderDetail();
  }

  function cardMarkup(item) {
    const positive = item.direction === "up";
    const negative = item.direction === "down";
    const tone = positive ? "up" : negative ? "down" : "flat";
    const sign = positive ? "+" : "";
    const pct = Number.isFinite(item.changePercent) ? `${sign}${item.changePercent.toFixed(2)}%` : "—";
    // สถานะต่อสัญลักษณ์แบบซื่อสัตย์: แหล่งข้อมูล + เวลาอัปเดต + stale (ข้อมูลล่าสุดที่มี)
    const sourceLabel = item.source ? esc(item.source) : "ระบบรวบรวมตลาด";
    const staleBadge = item.stale ? ` <span class="market-card__stale" title="ข้อมูลล่าสุดที่มี">stale</span>` : "";
    return `<article class="market-card market-card--${tone} ${state.selected === item.symbol ? "is-selected" : ""}">
      <button type="button" class="market-card__main" data-symbol="${esc(item.symbol)}" aria-label="ดูรายละเอียด ${esc(item.symbol)}">
        <span class="market-card__top"><strong>${esc(item.symbol)}</strong><small>${esc(LABELS[item.symbol] || item.symbol)}</small></span>
        <span class="market-card__price">${formatPrice(item.price)}</span>
        <span class="market-card__change">${pct}</span>
        ${sparkline(item.history, tone)}
        <span class="market-card__src">${TT.icon("chart", 11)} ${sourceLabel} · ${formatTime(item.updatedAt)}${staleBadge}</span>
      </button>
      <button type="button" class="market-watch ${state.watch.has(item.symbol) ? "is-active" : ""}" data-watch="${esc(item.symbol)}" aria-label="${state.watch.has(item.symbol) ? "นำออกจาก" : "เพิ่มใน"} Watchlist">★</button>
    </article>`;
  }

  function sparkline(history, tone) {
    const values = Array.isArray(history) ? history.filter(Number.isFinite) : [];
    if (values.length < 2) return `<span class="market-sparkline market-sparkline--empty">รอข้อมูลกราฟ</span>`;
    const min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
    const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / spread) * 24}`).join(" ");
    return `<svg class="market-sparkline market-sparkline--${tone}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function renderDetail() {
    const el = document.getElementById("marketDetail");
    if (!el) return;
    const item = state.items.find((i) => i.symbol === state.selected);
    if (!item) {
      el.innerHTML = `<div class="state"><div class="state__title">เลือกสินทรัพย์เพื่อดูรายละเอียด</div></div>`;
      return;
    }
    
    // ตรวจสอบว่ามีข้อมูล Sentiment จาก Myfxbook หรือไม่ (คู่เงินหลัก, ทอง, เงิน)
    const isSupportedSentiment = /USD|EUR|GBP|JPY|XAU|XAG/.test(item.symbol) && item.symbol !== "DXY";
    const sentimentHtml = isSupportedSentiment ? `
      <section class="market-related">
        <h3>📊 Community Outlook</h3>
        <div style="border-radius: 8px; overflow: hidden; background: #fff; margin-top: 12px; height: 160px;">
          <iframe src="https://widgets.myfxbook.com/widgets/outlook.html?symbol=${esc(item.symbol)}" width="100%" height="160" frameborder="0" scrolling="no" allowtransparency="true"></iframe>
        </div>
      </section>
    ` : "";

    el.innerHTML = `<div class="market-detail__head"><div><span>${esc(LABELS[item.symbol] || item.symbol)}</span><h2>${esc(item.symbol)}</h2></div><strong>${formatPrice(item.price)}</strong></div>
      <dl class="market-stats"><div><dt>เปลี่ยนแปลง</dt><dd>${Number.isFinite(item.change) ? item.change.toFixed(4) : "—"}</dd></div><div><dt>เปอร์เซ็นต์</dt><dd>${Number.isFinite(item.changePercent) ? `${item.changePercent.toFixed(2)}%` : "—"}</dd></div><div><dt>แหล่งข้อมูล</dt><dd>${esc(item.source || "ระบบตลาด")}</dd></div></dl>
      ${sentimentHtml}
      <section class="market-related"><h3>ข่าวล่าสุด</h3>${state.extras.news.length ? state.extras.news.map((n) => `<a href="news-detail.html?slug=${encodeURIComponent(n.slug || n.id || "")}">${esc(n.title || "ข่าวตลาด")}</a>`).join("") : `<p>ยังไม่มีข่าวที่เกี่ยวข้อง</p>`}</section>
      <section class="market-related"><h3>เหตุการณ์เศรษฐกิจ</h3>${state.extras.events.length ? state.extras.events.map((e) => `<div><strong>${esc(e.currency)}</strong><span>${esc(e.eventName)}</span><small>${formatTime(e.scheduledAtUtc)}</small></div>`).join("") : `<p>ยังไม่มีเหตุการณ์ที่เกี่ยวข้อง</p>`}</section>`;
  }

  async function loadExtras() {
    const currency = CURRENCY[state.selected] || (state.selected === "USDJPY" ? "USD" : "USD");
    try {
      const [newsRes, calRes] = await Promise.all([
        fetch("/api/news?limit=3&offset=0", { headers: { Accept: "application/json" } }),
        fetch(`/api/calendar/upcoming?limit=3&currency=${encodeURIComponent(currency)}`, { headers: { Accept: "application/json" } }),
      ]);
      const news = newsRes.ok ? await newsRes.json() : { items: [] };
      const cal = calRes.ok ? await calRes.json() : { items: [] };
      state.extras = { news: Array.isArray(news) ? news : (news.items || []), events: cal.items || [] };
    } catch (_) {
      state.extras = { news: [], events: [] };
    }
    renderDetail();
  }

  document.addEventListener("DOMContentLoaded", renderShell);
})();
