/* ============================================================
   Page — Signal (Market Status)
   ------------------------------------------------------------
   แสดง "สถานะตลาด/ทางเทคนิค" ที่อนุมานจากราคาจริงของระบบหลังบ้าน
   (/api/market-ticker) — เป็นโมเมนตัม (ขาขึ้น/ขาลง/นิ่ง) ไม่ใช่คำสั่งเทรด
   - EA/MT5 trade feed ยังไม่เชื่อมต่อ → ไม่แสดงสัญญาณจำลอง
   - แสดงแหล่งข้อมูล + เวลาอัปเดตอย่างชัดเจน
   - อัปเดตสดอัตโนมัติผ่าน TT.SignalService (subscribe MarketTickerService)
   ============================================================ */

(function () {
  const h = TT.h;
  let state = { assetClass: "all", momentum: "all" };
  let unsub = null; // unsubscribe live updates เมื่อ leave render

  /* ------------------------------------------------------------
     TradingView widget mounting — deterministic, no fixed timeout,
     no duplicate embeds. State is tracked on each mount via
     data-tv-state (loading | ready | error) and surfaced honestly.
     Symbol whitelist ดึงจาก TT.SignalService.SYMBOL_META (single
     source of truth) เพื่อกัน divergence ระหว่าง list กับ detail.
     ------------------------------------------------------------ */

  const TV_LIB_SRC = "https://s3.tradingview.com/tv.js";
  const TV_TECH_SRC =
    "https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js";

  // Load tv.js exactly once per page; rejects on network failure and
  // clears the cached promise so a retry can fetch again.
  let tvLibPromise = null;
  function loadTvLib() {
    if (window.TradingView) return Promise.resolve(window.TradingView);
    if (tvLibPromise) return tvLibPromise;
    tvLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TV_LIB_SRC;
      s.async = true;
      s.onload = () =>
        window.TradingView ? resolve(window.TradingView) : reject(new Error("tv_lib_unavailable"));
      s.onerror = () => {
        tvLibPromise = null;
        reject(new Error("tv_lib_load_failed"));
      };
      document.body.appendChild(s);
    });
    return tvLibPromise;
  }

  function setWidgetState(box, st) {
    if (box) box.setAttribute("data-tv-state", st);
  }

  // Mark a mount "ready" the moment TradingView injects its iframe —
  // event-driven via MutationObserver, so no arbitrary setTimeout.
  function watchTvReady(box) {
    if (!box) return;
    if (box.querySelector("iframe")) {
      setWidgetState(box, "ready");
      return;
    }
    const obs = new MutationObserver(() => {
      if (box.querySelector("iframe")) {
        setWidgetState(box, "ready");
        obs.disconnect();
      }
    });
    obs.observe(box, { childList: true, subtree: true });
  }

  // Loading + error overlay shared by every widget mount.
  function tvMountShell() {
    return `
      <div class="tv-mount__loader" role="status" aria-live="polite">
        <span class="tv-mount__spinner" aria-hidden="true"></span>
        <span class="tv-mount__loader-text">กำลังโหลดกราฟ…</span>
      </div>
      <div class="tv-mount__error" role="alert">
        <span class="tv-mount__error-icon">${TT.icon("warning", 24)}</span>
        <span class="tv-mount__error-title">ไม่สามารถโหลดกราฟได้</span>
        <span class="tv-mount__error-desc">อาจเกิดจากอินเทอร์เน็ตขัดข้องหรือการบล็อก TradingView กรุณาลองอีกครั้ง</span>
        <button type="button" class="tv-mount__retry">${TT.icon("refresh", 15)}<span>ลองอีกครั้ง</span></button>
      </div>`;
  }

  // Advanced Chart widget — timeframe/symbol interaction อยู่ภายใน
  // TradingView widget เอง (allow_symbol_change:false, ไม่มี external
  // timeframe control ที่ลิงก์ไป route อื่นของเว็บ)
  function mountChart(box, hostId, tvSymbol) {
    const host = document.getElementById(hostId);
    if (!host || !box) return;
    setWidgetState(box, "loading");
    host.innerHTML = ""; // never stack a second chart instance
    loadTvLib()
      .then((TV) => {
        if (!document.getElementById(hostId)) return; // navigated away mid-load
        watchTvReady(box);
        try {
          new TV.widget({
            autosize: true,
            symbol: tvSymbol,
            interval: "D",
            timezone: "Etc/UTC",
            theme: "dark",
            style: "1",
            locale: "en",
            enable_publishing: false,
            backgroundColor: "rgba(10, 33, 56, 1)",
            gridColor: "rgba(120, 160, 196, 0.08)",
            hide_top_toolbar: false,
            hide_legend: false,
            allow_symbol_change: false,
            save_image: false,
            container_id: hostId,
          });
        } catch (e) {
          setWidgetState(box, "error");
        }
      })
      .catch(() => {
        if (document.getElementById(hostId)) setWidgetState(box, "error");
      });
  }

  // Technical Analysis widget — appended directly (no setTimeout).
  function mountTech(box, tvSymbol) {
    if (!box) return;
    setWidgetState(box, "loading");
    box.querySelectorAll("iframe, script[data-tv-embed]").forEach((n) => n.remove()); // no duplicate embed
    watchTvReady(box);
    const s = document.createElement("script");
    s.src = TV_TECH_SRC;
    s.async = true;
    s.type = "text/javascript";
    s.setAttribute("data-tv-embed", "tech");
    s.innerHTML = JSON.stringify({
      interval: "1m",
      width: "100%",
      height: "100%",
      isTransparent: true,
      symbol: tvSymbol,
      showIntervalTabs: true,
      displayMode: "single",
      locale: "en",
      colorTheme: "dark",
    });
    s.onerror = () => setWidgetState(box, "error");
    box.appendChild(s);
  }

  function attachRetries(sym) {
    document.querySelectorAll(".tv-mount__retry").forEach((btn) => {
      if (btn.dataset.tvBound === "1") return;
      btn.dataset.tvBound = "1";
      btn.addEventListener("click", () => {
        const box = btn.closest(".tv-mount");
        if (!box) return;
        if (box.id === "tv_chart") mountChart(box, "tv_chart_host", sym.tv);
        else if (box.id === "tv_tech") mountTech(box, sym.tv);
      });
    });
  }

  /* ------------------------------------------------------------
     Format helpers (price/sparkline) สำหรับ market-status card
     ------------------------------------------------------------ */
  function fmtPrice(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 100) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
  }

  function fmtPct(p) {
    if (typeof p !== "number" || !Number.isFinite(p)) return "—";
    const sign = p > 0 ? "+" : "";
    return sign + p.toFixed(2) + "%";
  }

  function fmtChange(c) {
    if (typeof c !== "number" || !Number.isFinite(c)) return null;
    const sign = c > 0 ? "+" : "";
    return sign + c.toFixed(2);
  }

  function sparkline(history, tone) {
    const values = Array.isArray(history) ? history.filter(Number.isFinite) : [];
    if (values.length < 2) {
      return `<span class="market-spark market-spark--empty" aria-hidden="true">—</span>`;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    const points = values
      .map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / spread) * 26}`)
      .join(" ");
    return `<svg class="market-spark market-spark--${tone}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* ------------------------------------------------------------
     Market-status card — อนุมานจากราคาจริง (ไม่ใช่สัญญาณเทรด)
     ------------------------------------------------------------ */
  function statusCard(s) {
    const tone = s.status === "bullish" ? "up" : s.status === "bearish" ? "down" : "flat";
    const chgTone =
      s.direction === "up" ? "text-buy" : s.direction === "down" ? "text-sell" : "text-muted";
    const changeText = fmtChange(s.change);
    const detailHref = `signal.html?symbol=${encodeURIComponent(s.symbol)}`;
    const sourceText = s.source ? h.esc(s.source) : "ระบบตลาด";
    const updatedText = s.updatedAt
      ? h.formatBangkok(s.updatedAt, { prefix: "อัปเดต " })
      : "อัปเดตล่าสุด —";

    return `<article class="card card--hover market-card market-card--${tone}" data-symbol="${h.esc(s.symbol)}">
      <div class="card__head">
        <div class="cluster">
          <span class="badge">${h.esc(s.assetLabel)}</span>
          ${s.stale ? `<span class="badge badge--ghost" title="ข้อมูลล่าสุดที่มี">stale</span>` : ""}
        </div>
        <span class="badge market-card__status market-card__status--${tone}" title="${h.esc(s.statusEn)} momentum">
          ${s.status === "bullish" ? "▲" : s.status === "bearish" ? "▼" : "■"} ${h.esc(s.statusLabel)}
        </span>
      </div>
      <div class="market-card__symbol-row">
        <div>
          <h3 class="card__title market-card__title">${h.esc(s.label)}</h3>
          <span class="market-card__pair">${h.esc(s.symbol)}</span>
        </div>
        <span class="market-card__price">${h.esc(fmtPrice(s.price))}</span>
      </div>
      <div class="market-card__chg-row">
        <span class="${chgTone} market-card__chg">${h.esc(fmtPct(s.changePercent))}</span>
        ${changeText != null ? `<span class="${chgTone} market-card__chg-abs">${h.esc(changeText)}</span>` : ""}
        ${sparkline(s.history, tone)}
      </div>
      <div class="market-card__meta">
        <span class="text-muted">โมเมนตัม: <strong>${h.esc(s.statusLabel)}</strong> · ${h.esc(s.strengthLabel)}</span>
      </div>
      <div class="market-card__footer">
        <span class="text-muted market-card__src" title="${h.esc(sourceText)}">${TT.icon("chart", 13)} ${sourceText} · ${h.esc(updatedText)}</span>
        <a class="btn btn--soft btn--sm" href="${detailHref}">
          ${TT.icon("chart", 14)}<span>ดูกราฟ</span>${TT.icon("arrow", 14)}
        </a>
      </div>
    </article>`;
  }

  /* ------------------------------------------------------------
     Render — main list view
     ------------------------------------------------------------ */
  function render() {
    const assetFilters = TT.SignalService.ASSET_FILTERS;
    const momentumFilters = TT.SignalService.MOMENTUM_FILTERS;

    const main = `
      ${TT.layout.ticker()}

      <section class="page signal-page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("signal", 14)} Market Status</span>
            <h1>สถานะ <span class="text-grad-blue">ตลาด</span></h1>
            <p>สถานะตลาดแบบเรียลไทม์ที่อนุมานจากราคาจริงของระบบหลังบ้าน — แสดงทิศทางและโมเมนตัมเพื่อประกอบการวิเคราะห์ ไม่ใช่คำสั่งเทรด</p>
          </div>

          <!-- แจ้งตามจริง: EA feed ยังไม่เชื่อมต่อ + ข้อมูลมาจากไหน -->
          <div class="alert alert--info signal-source-alert" style="margin-bottom:20px">
            <span class="alert__icon">${TT.icon("info", 18)}</span>
            <div>
              <strong>ระบบ EA/MT5 trade feed ยังไม่เชื่อมต่อ</strong> — เพื่อความซื่อสัตย์ต่อข้อมูล เราจะไม่แสดงสัญญาณซื้อขาย (Entry/SL/TP) จำลอง
              การ์ดด้านล่างเป็น <strong>สถานะตลาด</strong> ที่คำนวณจากราคาจริง (ทิศทางและโมเมนตัม) ใช้ประกอบการวิเคราะห์เท่านั้น ไม่ใช่คำแนะนำให้ซื้อหรือขาย
            </div>
          </div>

          <!-- source + update time status bar -->
          <div class="signal-source-bar" id="signalSourceBar" aria-live="polite"></div>

          <!-- Stats -->
          <div class="signal-summary" id="signalStats" style="margin-bottom:20px"></div>

          <!-- Filter -->
          <div class="filter-bar">
            <div class="cluster">
              <span class="text-muted" style="font-size:var(--fs-sm)">หมวด:</span>
              <div class="segmented" id="assetFilter" role="tablist">
                ${assetFilters
                  .map((f) => `<button data-asset="${f.key}" class="${f.key === "all" ? "is-active" : ""}">${h.esc(f.label)}</button>`)
                  .join("")}
              </div>
            </div>
            <div class="cluster">
              <span class="text-muted" style="font-size:var(--fs-sm)">โมเมนตัม:</span>
              <div class="segmented" id="momentumFilter" role="tablist">
                ${momentumFilters
                  .map((f) => `<button data-momentum="${f.key}" class="${f.key === "all" ? "is-active" : ""}">${h.esc(f.label)}</button>`)
                  .join("")}
              </div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" id="signalRefreshBtn" style="margin-left:auto">
              ${TT.icon("refresh", 16)} รีเฟรช
            </button>
          </div>

          <!-- List -->
          <div class="grid grid--3" id="signalList" aria-live="polite"></div>

          <!-- Risk warning -->
          <div class="alert alert--warn" style="margin-top:32px">
            <span class="alert__icon">${TT.icon("warning", 18)}</span>
            <div>
              <strong>คำเตือน:</strong> สถานะตลาดและตัวชี้วัดเป็นเพียงข้อมูลอ้างอิงที่อนุมานจากราคา ไม่ใช่คำแนะนำให้ซื้อหรือขาย การเทรดมีความเสี่ยงสูง ควรบริหารความเสี่ยงและใช้เงินที่ไม่กระทบความเป็นอยู่
            </div>
          </div>

          <!-- How to use -->
          <section class="section" style="padding-block:32px">
            <div class="section-header">
              <div class="section-title">
                <span class="eyebrow">How to use</span>
                <h2>วิธีอ่านสถานะตลาด</h2>
              </div>
            </div>
            <div class="grid grid--3">
              <div class="card">
                <div class="feature__icon">${TT.icon("chart", 20)}</div>
                <h4 style="margin:12px 0 6px">1. เลือกสินทรัพย์</h4>
                <p class="text-secondary" style="font-size:var(--fs-sm)">เลือก symbol ที่สนใจจากการ์ดสถานะตลาดด้านบน</p>
              </div>
              <div class="card">
                <div class="feature__icon">${TT.icon("signal", 20)}</div>
                <h4 style="margin:12px 0 6px">2. อ่านสถานะ</h4>
                <p class="text-secondary" style="font-size:var(--fs-sm)">ดูทิศทาง (ขาขึ้น/ขาลง/นิ่ง) และความแรงของโมเมนตัมจากการเปลี่ยนแปลงราคาจริง</p>
              </div>
              <div class="card">
                <div class="feature__icon">${TT.icon("gauge", 20)}</div>
                <h4 style="margin:12px 0 6px">3. เปิดกราฟ</h4>
                <p class="text-secondary" style="font-size:var(--fs-sm)">กด “ดูกราฟ” เพื่อศึกษาแผนภูมิขั้นสูงและวิเคราะห์ทางเทคนิคเพิ่มเติม</p>
              </div>
            </div>
            <a href="knowledge.html" class="section-link" style="margin-top:16px;display:inline-flex">อ่านบทวิเคราะห์เพิ่มเติม</a>
          </section>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "signal",
      main,
    });
    TT.layout.initNavbar();
    bindFilters();

    // รับ live updates จาก MarketTickerService (ผ่าน SignalService)
    if (unsub) { try { unsub(); } catch (e) {} }
    unsub = TT.SignalService.subscribe(() => {
      renderSourceBar();
      renderStats();
      renderList();
    });

    // รีเฟรช manual
    const refreshBtn = document.getElementById("signalRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        refreshBtn.disabled = true;
        Promise.resolve(TT.SignalService.refresh()).finally(() => {
          setTimeout(() => { refreshBtn.disabled = false; }, 600);
        });
      });
    }
  }

  function bindFilters() {
    const asset = document.getElementById("assetFilter");
    const momentum = document.getElementById("momentumFilter");

    asset.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-asset]");
      if (!btn) return;
      asset.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.assetClass = btn.dataset.asset;
      renderList();
    });

    momentum.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-momentum]");
      if (!btn) return;
      momentum.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.momentum = btn.dataset.momentum;
      renderList();
    });
  }

  /* ------------------------------------------------------------
     Render blocks — driven by SignalService snapshot
     ------------------------------------------------------------ */
  function statusInfo(snap) {
    switch (snap.status) {
      case "live": return { text: "ข้อมูลตลาดสด", cls: "live" };
      case "stale": return { text: "กำลังแสดงข้อมูลล่าสุดที่มี", cls: "stale" };
      case "loading": return { text: "กำลังโหลดข้อมูลตลาด", cls: "loading" };
      case "unavailable": return { text: "ไม่สามารถอัปเดตข้อมูลตลาดได้", cls: "error" };
      case "empty": return { text: "ยังไม่มีข้อมูลตลาด", cls: "empty" };
      default: return { text: "กำลังเตรียมข้อมูล", cls: "loading" };
    }
  }

  function renderSourceBar() {
    const el = document.getElementById("signalSourceBar");
    if (!el) return;
    const snap = TT.SignalService.getSnapshot();
    const info = statusInfo(snap);
    const updated = snap.updatedAt
      ? h.formatBangkok(snap.updatedAt, { prefix: "อัปเดตล่าสุด " })
      : "ยังไม่มีข้อมูลอัปเดต";
    const eaState = TT.SignalService.eaConnected
      ? `<span class="badge"><span class="dot dot--live"></span> EA/MT5</span>`
      : `<span class="badge badge--ghost">EA/MT5: ยังไม่เชื่อมต่อ</span>`;
    el.innerHTML = `<div class="signal-source-bar__inner signal-source-bar__inner--${info.cls}">
      <span class="signal-source-bar__dot" aria-hidden="true"></span>
      <strong>${h.esc(info.text)}</strong>
      <span class="text-muted signal-source-bar__updated">${h.esc(updated)}</span>
      <span class="signal-source-bar__src">${TT.icon("chart", 13)} ${h.esc(TT.SignalService.source)}</span>
      ${eaState}
    </div>`;
  }

  function renderStats() {
    const el = document.getElementById("signalStats");
    if (!el) return;
    const stats = TT.SignalService.getSnapshot();
    const signals = stats.signals;
    const up = signals.filter((s) => s.direction === "up").length;
    const down = signals.filter((s) => s.direction === "down").length;
    const flat = signals.length - up - down;

    el.innerHTML = `
      <div class="card stat">
        <span class="stat__value">${signals.length}</span>
        <span class="stat__label">สินทรัพย์ที่ติดตาม</span>
      </div>
      <div class="card stat">
        <span class="stat__value text-buy">${up}</span>
        <span class="stat__label">ขาขึ้น</span>
      </div>
      <div class="card stat">
        <span class="stat__value text-sell">${down}</span>
        <span class="stat__label">ขาลง</span>
      </div>
      <div class="card stat">
        <span class="stat__value">${flat}</span>
        <span class="stat__label">ทิศทางนิ่ง</span>
      </div>
    `;
  }

  function renderList() {
    const el = document.getElementById("signalList");
    if (!el) return;
    const snap = TT.SignalService.getSnapshot();

    // กรณียังไม่มีข้อมูลเลย (loading/unavailable/empty)
    if (!snap.signals.length) {
      if (snap.status === "loading" || snap.status === "init") {
        TT.h.loading(el, Math.min(6, Math.max(3, (snap.total || 6))));
      } else if (snap.status === "unavailable") {
        TT.h.error(el, "ไม่สามารถดึงข้อมูลตลาดได้ในขณะนี้");
      } else {
        TT.h.empty(el, "ยังไม่มีข้อมูลสถานะตลาด", "กรุณารีเฟรชอีกครั้งหรือลองใหม่ภายหลัง");
      }
      return;
    }

    // filter
    let list = snap.signals.slice();
    if (state.assetClass !== "all") {
      list = list.filter((s) => s.assetClass === state.assetClass);
    }
    if (state.momentum !== "all") {
      list = list.filter((s) => s.direction === state.momentum);
    }

    if (!list.length) {
      TT.h.empty(el, "ไม่มีสินทรัพย์ตามตัวกรองที่เลือก", "ลองเปลี่ยนหมวดหรือโมเมนตัม");
      return;
    }

    el.innerHTML = list.map(statusCard).join("");
  }

  /* ------------------------------------------------------------
     Render — symbol detail (TradingView Advanced Chart + Tech)
     ใช้ whitelist จาก TT.SignalService.resolveSymbol
     ------------------------------------------------------------ */
  function renderSymbolDetail(rawSymbol) {
    const sym = TT.SignalService.resolveSymbol(rawSymbol);

    const main = `
      ${TT.layout.ticker()}

      <section class="page signal-detail">
        <div class="container">
          <header class="symbol-detail__head">
            <div class="symbol-detail__icon" aria-hidden="true">${TT.icon("chart", 24)}</div>
            <div class="symbol-detail__title">
              <span class="eyebrow">${TT.icon("signal", 14)} ${h.esc(sym.assetLabel)}</span>
              <h1>${h.esc(sym.label)}</h1>
              <p>Advanced Real-time Chart &amp; Technical Analysis · <span class="symbol-detail__pair">${h.esc(sym.tv)}</span></p>
            </div>
            <a class="btn btn--ghost symbol-detail__back" href="signal.html">
              ${TT.icon("arrow", 16)}<span>กลับสู่หน้าสถานะตลาด</span>
            </a>
          </header>

          ${
            sym.known
              ? ""
              : `<div class="alert alert--warn symbol-detail__hint">
                  <span class="alert__icon">${TT.icon("info", 18)}</span>
                  <div>
                    <strong>ไม่พบสัญลักษณ์ “${h.esc(sym.key || "—")}” ในรายการที่รองรับ</strong><br>
                    ระบบแสดงกราฟ <strong>ทองคำ (XAU/USD)</strong> เป็นค่าเริ่มต้นเพื่อความปลอดภัยของการแสดงผล
                  </div>
                </div>`
          }

          <div class="symbol-detail__grid">
            <div class="tv-card tv-card--chart">
              <div class="tv-card__head">
                <span class="tv-card__title">${TT.icon("chart", 16)}<span>แผนภูมิขั้นสูง</span></span>
                <span class="tv-card__tag">${h.esc(sym.tv)}</span>
              </div>
              <div class="tv-mount" id="tv_chart" data-tv-state="loading">
                ${tvMountShell()}
                <div class="tv-mount__frame" id="tv_chart_host"></div>
              </div>
            </div>

            <div class="tv-card tv-card--tech">
              <div class="tv-card__head">
                <span class="tv-card__title">${TT.icon("gauge", 16)}<span>วิเคราะห์ทางเทคนิค</span></span>
                <span class="tv-card__tag">${h.esc(sym.tv)}</span>
              </div>
              <div class="tv-mount tradingview-widget-container" id="tv_tech" data-tv-state="loading">
                ${tvMountShell()}
              </div>
            </div>
          </div>

          <div class="alert alert--warn symbol-detail__risk">
            <span class="alert__icon">${TT.icon("warning", 18)}</span>
            <div>
              <strong>คำเตือน:</strong> กราฟและตัวชี้วัดเป็นเครื่องมืออ้างอิงเท่านั้น ไม่ใช่คำแนะนำให้ซื้อหรือขาย การเทรดมีความเสี่ยงสูง
            </div>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "signal",
      main,
    });
    TT.layout.initNavbar();
    attachRetries(sym);
    mountChart(document.getElementById("tv_chart"), "tv_chart_host", sym.tv);
    mountTech(document.getElementById("tv_tech"), sym.tv);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const targetSymbol = new URLSearchParams(window.location.search).get("symbol");
    if (targetSymbol) {
      renderSymbolDetail(targetSymbol);
    } else {
      render();
    }
  });
})();
