/* ============================================================
   Page — EA Hub
   ------------------------------------------------------------
   - Hero + คำเตือนความเสี่ยง
   - Filter: platform (MT4/MT5), price (ฟรี/ขาย), กลยุทธ์, ช่องค้นหา
   - EA cards grid (loading / empty / error states)
   - Modal รายละเอียด EA
   - Modal "ส่ง EA ของคุณ" (ฟอร์ม + validation + ส่ง API จริง)

   ข้อมูลทั้งหมดดึงจาก TT.EAService — หาก API ยังไม่พร้อม
   จะแสดง error/empty state จริง ไม่มี mock success
   ============================================================ */

(function () {
  const h = TT.h;

  // state ของ filter ปัจจุบัน
  const state = {
    platform: "all", // all | MT4 | MT5
    price: "all", // all | free | paid
    strategy: "all", // all | trend | grid | scalper | hedging | breakout | other
    query: "",
    items: [],
    loading: false,
    error: null,
  };

  // ============================================================
  // RENDER — หน้าหลัก
  // ============================================================
  function render() {
    const main = `
      <!-- ============ HERO ============ -->
      <section class="ea-hero">
        <div class="container ea-hero__inner">
          <div class="ea-hero__content">
            <span class="ea-hero__eyebrow">
              <span class="ea-hero__eyebrow-dot" aria-hidden="true"></span>
              ${TT.icon("ea", 14)} EA HUB
            </span>
            <h1 class="ea-hero__title">
              Expert Advisor <span class="ea-hero__title-accent">Hub</span>
            </h1>
            <p class="ea-hero__lead">
              แหล่งรวม EA (Expert Advisor) สำหรับ MT4 / MT5 — ทั้ง EA แจกฟรีและ EA คุณภาพจากนักพัฒนา
              ดาวน์โหลด ทดลองใช้ และเริ่มต้นสร้างระบบเทรดอัตโนมัติของคุณ
            </p>
            <div class="ea-hero__cta">
              <a href="#ea-list" class="btn btn--primary btn--lg">
                ${TT.icon("layers", 18)} ดู EA ทั้งหมด
              </a>
              <button type="button" id="heroSubmitBtn" class="btn btn--ghost-light btn--lg">
                ${TT.icon("upload", 18)} ส่ง EA ของคุณ
              </button>
            </div>
            <div class="ea-hero__stats">
              <div class="stat">
                <span class="stat__value" id="eaStatTotal">—</span>
                <span class="stat__label">EA ทั้งหมด</span>
              </div>
              <div class="stat">
                <span class="stat__value" id="eaStatFree">—</span>
                <span class="stat__label">EA ฟรี</span>
              </div>
              <div class="stat">
                <span class="stat__value" id="eaStatPaid">—</span>
                <span class="stat__label">EA พรีเมียม</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============ RISK WARNING ============ -->
      <section class="page">
        <div class="container">
          <div class="alert alert--warn ea-risk" role="note">
            <span class="alert__icon">${TT.icon("warning", 20)}</span>
            <div>
              <strong>คำเตือนความเสี่ยง:</strong>
              EA (Expert Advisor) เป็นเครื่องมือช่วยเทรดอัตโนมัติ ผลลัพธ์ในอดีต
              <em>ไม่รับประกันผลตอบแทนในอนาคต</em> การใช้งาน EA มีความเสี่ยงสูง
              อาจทำให้สูญเสียเงินทุนทั้งหมด ควรทดสอบบน <strong>Demo Account</strong>
              ก่อนใช้งานจริงเสมอ และใช้เงินที่ไม่กระทบความเป็นอยู่
              TraderToolsTH ไม่รับประกันผลการทำงานของ EA ใด ๆ
              และไม่รับผิดชอบต่อความเสียหายที่เกิดจากการใช้งาน
            </div>
          </div>

          <!-- ============ FILTER BAR ============ -->
          <div class="ea-toolbar" id="eaToolbar">
            <div class="ea-toolbar__row">
              <div class="ea-toolbar__group">
                <label class="ea-toolbar__label">แพลตฟอร์ม</label>
                <div class="segmented" role="group" aria-label="กรองตามแพลตฟอร์ม">
                  <button type="button" data-filter-platform="all" class="is-active">ทั้งหมด</button>
                  <button type="button" data-filter-platform="MT4">MT4</button>
                  <button type="button" data-filter-platform="MT5">MT5</button>
                </div>
              </div>

              <div class="ea-toolbar__group">
                <label class="ea-toolbar__label">ราคา</label>
                <div class="segmented" role="group" aria-label="กรองตามราคา">
                  <button type="button" data-filter-price="all" class="is-active">ทั้งหมด</button>
                  <button type="button" data-filter-price="free">ฟรี</button>
                  <button type="button" data-filter-price="paid">พรีเมียม</button>
                </div>
              </div>

              <div class="ea-toolbar__group ea-toolbar__group--grow">
                <label class="ea-toolbar__label" for="eaStrategy">ประเภทกลยุทธ์</label>
                <select id="eaStrategy" class="ea-toolbar__select" data-filter-strategy>
                  <option value="all">ทุกกลยุทธ์</option>
                  <option value="trend">Trend Following</option>
                  <option value="grid">Grid</option>
                  <option value="scalper">Scalper</option>
                  <option value="hedging">Hedging</option>
                  <option value="breakout">Breakout</option>
                  <option value="martingale">Martingale</option>
                  <option value="arbitrage">Arbitrage</option>
                  <option value="other">อื่น ๆ</option>
                </select>
              </div>
            </div>

            <div class="ea-toolbar__row ea-toolbar__row--search">
              <div class="ea-search">
                <span class="ea-search__icon" aria-hidden="true">${TT.icon("search", 18)}</span>
                <input
                  type="search"
                  id="eaQuery"
                  class="ea-search__input"
                  placeholder="ค้นหาชื่อ EA, คำอธิบาย, กลยุทธ์…"
                  autocomplete="off"
                  aria-label="ค้นหา EA">
              </div>
              <div class="ea-toolbar__meta">
                <span id="eaCount" class="ea-toolbar__count">—</span>
                <button type="button" id="eaResetBtn" class="btn btn--ghost btn--sm" hidden>
                  ${TT.icon("refresh", 14)} ล้างตัวกรอง
                </button>
              </div>
            </div>
          </div>

          <!-- ============ EA GRID ============ -->
          <div id="eaList" class="ea-grid" aria-live="polite" aria-busy="true"></div>

          <!-- ============ NO RESULT (filter) ============ -->
          <div id="eaNoResult" class="state" hidden>
            <div class="state__title">ไม่พบ EA ที่ตรงกับตัวกรอง</div>
            <p>ลองปรับเงื่อนไขการค้นหา หรือล้างตัวกรองแล้วลองใหม่</p>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "ea",
      main,
    });
    TT.layout.initNavbar();
    // opt-out ticker บนหน้า EA — ไม่จำเป็นต้องโหลดราคาตลาด (กัน warning + network waste)
    document.body.classList.add("no-ticker");

    bindToolbar();
    bindHero();
    loadList();
  }

  // ============================================================
  // LOAD — ดึงข้อมูลจาก service
  // ============================================================
  async function loadList() {
    const el = document.getElementById("eaList");
    const noResult = document.getElementById("eaNoResult");
    if (!el) return;

    state.loading = true;
    state.error = null;
    el.setAttribute("aria-busy", "true");
    noResult.hidden = true;
    h.loading(el, 6);

    try {
      const items = await TT.EAService.fetchEAs({ force: true });
      state.items = Array.isArray(items) ? items : [];
      renderStats(state.items);
      applyFilters();
    } catch (err) {
      state.error = err;
      state.items = [];
      renderStats([]);
      h.error(el, errorMessage(err, "ไม่สามารถโหลดรายการ EA ได้"));
      el.setAttribute("aria-busy", "false");
      // แสดง error ใน count ด้วย
      const countEl = document.getElementById("eaCount");
      if (countEl) countEl.textContent = "โหลดไม่สำเร็จ";
    } finally {
      state.loading = false;
    }
  }

  function errorMessage(err, fallback) {
    if (!err) return fallback;
    if (err.code === "network_error") return "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้";
    if (err.message && err.message.startsWith("HTTP 404"))
      return "ยังไม่พบบริการ EA ในขณะนี้";
    if (err.message && err.message.startsWith("HTTP 5"))
      return "เซิร์ฟเวอร์ขัดข้อง กรุณาลองใหม่ภายหลัง";
    return fallback;
  }

  // ============================================================
  // FILTER — กรอง + render
  // ============================================================
  function applyFilters() {
    const el = document.getElementById("eaList");
    const noResult = document.getElementById("eaNoResult");
    const countEl = document.getElementById("eaCount");
    if (!el) return;

    let list = state.items.slice();

    // platform
    if (state.platform !== "all") {
      list = list.filter((ea) => {
        const platforms = Array.isArray(ea.platforms || ea.platform)
          ? ea.platforms || ea.platform
          : String(ea.platform || "").split(",").map((s) => s.trim());
        return platforms.some((p) =>
          String(p).toUpperCase().includes(state.platform)
        );
      });
    }

    // price/type — ใช้ field `type` จาก backend ("free"|"paid") เป็นหลัก
    if (state.price !== "all") {
      list = list.filter((ea) => {
        const type = (ea.type || "").toLowerCase();
        const p = Number(ea.price);
        const isFree =
          type === "free" || (!type && !isNaN(p) && p === 0);
        return state.price === "free" ? isFree : !isFree;
      });
    }

    // strategy
    if (state.strategy !== "all") {
      list = list.filter((ea) => {
        const s = String(ea.strategy || "").toLowerCase();
        if (state.strategy === "other") {
          return ![
            "trend", "grid", "scalper", "scalping", "hedging", "hedge",
            "breakout", "martingale", "arbitrage",
          ].some((k) => s.includes(k));
        }
        return s.includes(state.strategy);
      });
    }

    // query
    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      list = list.filter((ea) => {
        const hay = [
          ea.name, ea.description, ea.excerpt, ea.strategy, ea.author,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    // render
    el.setAttribute("aria-busy", "false");
    if (!list.length) {
      el.innerHTML = "";
      noResult.hidden = false;
    } else {
      noResult.hidden = true;
      el.innerHTML = list.map(TT.cards.eaCard).join("");
    }

    if (countEl) {
      const total = state.items.length;
      const shown = list.length;
      countEl.textContent =
        total === 0
          ? "ไม่มี EA"
          : shown === total
          ? `ทั้งหมด ${total} รายการ`
          : `แสดง ${shown} จาก ${total} รายการ`;
    }

    updateResetBtn();
  }

  function updateResetBtn() {
    const btn = document.getElementById("eaResetBtn");
    if (!btn) return;
    const active =
      state.platform !== "all" ||
      state.price !== "all" ||
      state.strategy !== "all" ||
      state.query.trim() !== "";
    btn.hidden = !active;
  }

  function renderStats(items) {
    const total = items.length;
    const free = items.filter((ea) => {
      const type = (ea.type || "").toLowerCase();
      return type === "free" || (!type && Number(ea.price) === 0);
    }).length;
    const paid = total - free;
    setText("eaStatTotal", total || "—");
    setText("eaStatFree", free || "—");
    setText("eaStatPaid", paid || "—");
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ============================================================
  // BIND — toolbar + hero events
  // ============================================================
  function bindToolbar() {
    // platform segmented
    document.querySelectorAll("[data-filter-platform]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll("[data-filter-platform]")
          .forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.platform = btn.dataset.filterPlatform;
        applyFilters();
      });
    });

    // price segmented
    document.querySelectorAll("[data-filter-price]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll("[data-filter-price]")
          .forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.price = btn.dataset.filterPrice;
        applyFilters();
      });
    });

    // strategy select
    const stratSel = document.getElementById("eaStrategy");
    if (stratSel) {
      stratSel.addEventListener("change", () => {
        state.strategy = stratSel.value;
        applyFilters();
      });
    }

    // search (debounced)
    const searchEl = document.getElementById("eaQuery");
    if (searchEl) {
      let t = null;
      searchEl.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.query = searchEl.value;
          applyFilters();
        }, 220);
      });
    }

    // reset
    const resetBtn = document.getElementById("eaResetBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        state.platform = "all";
        state.price = "all";
        state.strategy = "all";
        state.query = "";
        // reset UI
        document
          .querySelectorAll("[data-filter-platform]")
          .forEach((b) =>
            b.classList.toggle(
              "is-active",
              b.dataset.filterPlatform === "all"
            )
          );
        document
          .querySelectorAll("[data-filter-price]")
          .forEach((b) =>
            b.classList.toggle("is-active", b.dataset.filterPrice === "all")
          );
        if (stratSel) stratSel.value = "all";
        if (searchEl) searchEl.value = "";
        applyFilters();
      });
    }

    // event delegation สำหรับปุ่ม "ดูรายละเอียด" บนการ์ด
    document.addEventListener("click", onCardClick);
  }

  function onCardClick(e) {
    const btn = e.target.closest("[data-ea-detail]");
    if (!btn) return;
    const id = btn.dataset.eaDetail;
    openDetailModal(id);
  }

  /** ค้น EA จาก state.items ด้วย id หรือ slug (decode แล้วเทียบทั้งสอง) */
  function findEA(ref) {
    if (!ref) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(ref);
    } catch (_) {
      decoded = ref;
    }
    return (
      state.items.find(
        (e) => String(e.id) === decoded || e.slug === decoded
      ) || null
    );
  }

  function bindHero() {
    const heroBtn = document.getElementById("heroSubmitBtn");
    if (heroBtn) {
      heroBtn.addEventListener("click", () => openSubmitModal());
    }
  }

  // ============================================================
  // DETAIL MODAL
  // ============================================================
  function openDetailModal(id) {
    const root = document.getElementById("eaDetailRoot");
    if (!root) return;

    const ea = findEA(id);
    if (!ea) return;

    const platforms = Array.isArray(ea.platforms || ea.platform)
      ? ea.platforms || ea.platform
      : [];
    const platformBadges = platforms
      .map((p) => {
        const cls = /mt5/i.test(p) ? "badge--accent" : "badge--teal";
        return `<span class="badge ${cls}">${h.esc(p)}</span>`;
      })
      .join("");

    const priceNum = Number(ea.price);
    const isFree = ea.type === "free" || (!isNaN(priceNum) && priceNum === 0);
    const priceText = isFree
      ? "ฟรี (Free)"
      : `$${h.num(isNaN(priceNum) ? 0 : priceNum, 2)}`;

    const cover = ea.cover || ea.image || "";
    const coverBlock = cover
      ? `<img src="${h.esc(cover)}" alt="${h.esc(ea.name)}" class="ea-detail__cover-img" onerror="this.style.display='none'">`
      : `<div class="ea-detail__cover-ph" aria-hidden="true">${TT.icon("ea", 56)}</div>`;

    const desc =
      ea.description || ea.excerpt || "ยังไม่มีคำอธิบายสำหรับ EA นี้";

    const changelog = ea.changelog
      ? `<div class="ea-detail__section">
          <h4>${TT.icon("clock", 16)} บันทึกการอัปเดต</h4>
          <div class="ea-detail__changelog">${formatChangelog(ea.changelog)}</div>
        </div>`
      : "";

    const specs = [
      ["เวอร์ชัน", ea.version ? "v" + h.esc(ea.version) : "-"],
      ["กลยุทธ์", ea.strategy ? h.esc(ea.strategy) : "-"],
      ["ประเภท", isFree ? "ฟรี (Free)" : "พรีเมียม (Paid)"],
      ["ราคา", priceText],
      [
        "อัปเดตล่าสุด",
        ea.updatedAt || ea.updated_at || ea.publishedAt
          ? h.formatBangkok(ea.updatedAt || ea.updated_at || ea.publishedAt, { prefix: "" })
          : "-",
      ],
      ["ผู้พัฒนา", ea.author ? h.esc(ea.author) : "-"],
    ]
      .map(
        ([k, v]) =>
          `<div class="spec"><span class="spec__label">${h.esc(
            k
          )}</span><span class="spec__value">${v}</span></div>`
      )
      .join("");

    const ctaUrl = ea.downloadUrl || ea.purchaseUrl || "";
    const cta = ctaUrl
      ? `<a href="${h.esc(ctaUrl)}" class="btn ${
          isFree ? "btn--primary" : "btn--teal"
        } btn--lg" rel="noopener">
          ${TT.icon(isFree ? "download" : "arrow", 18)}
          ${isFree ? "ดาวน์โหลดฟรี" : "ซื้อเลย"}
        </a>`
      : `<span class="ea-detail__cta-soon">ช่องทางดาวน์โหลด/ซื้อจะเปิดให้เร็ว ๆ นี้</span>`;

    root.innerHTML = `
      <div class="ea-modal" role="dialog" aria-modal="true" aria-labelledby="eaDetailTitle">
        <div class="ea-modal__backdrop" data-close></div>
        <div class="ea-modal__panel ea-modal__panel--wide" role="document">
          <button type="button" class="ea-modal__close" data-close aria-label="ปิด">${TT.icon("x", 20)}</button>
          <div class="ea-detail">
            <div class="ea-detail__cover">${coverBlock}</div>
            <div class="ea-detail__main">
              <div class="cluster ea-detail__badges">${platformBadges}</div>
              <h2 class="ea-detail__title" id="eaDetailTitle">${h.esc(ea.name)}</h2>
              <div class="ea-detail__specs">${specs}</div>
            </div>
          </div>

          <div class="ea-detail__section">
            <h4>${TT.icon("knowledge", 16)} รายละเอียด</h4>
            <p class="ea-detail__desc">${h.esc(desc)}</p>
          </div>

          ${
            ea.features && ea.features.length
              ? `<div class="ea-detail__section">
                  <h4>${TT.icon("check", 16)} คุณสมบัติเด่น</h4>
                  <ul class="ea-detail__features">
                    ${ea.features
                      .map((f) => `<li>${TT.icon("check", 14)} ${h.esc(f)}</li>`)
                      .join("")}
                  </ul>
                </div>`
              : ""
          }

          ${changelog}

          <div class="ea-detail__cta">
            ${cta}
            <button type="button" class="btn btn--ghost" data-close>ปิด</button>
          </div>

          <div class="alert ea-detail__risk" role="note">
            <span class="alert__icon">${TT.icon("warning", 16)}</span>
            <div>ผลลัพธ์ที่ผ่านมาไม่รับประกันอนาคต — ทดสอบบน Demo ก่อนใช้งานจริง</div>
          </div>
        </div>
      </div>
    `;

    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    bindModalClose(root);
    // focus trap-lite
    const closeBtn = root.querySelector(".ea-modal__close");
    if (closeBtn) closeBtn.focus();
  }

  function formatChangelog(changelog) {
    if (Array.isArray(changelog)) {
      return `<ul class="ea-changelog">${changelog
        .map(
          (c) =>
            `<li><strong>${h.esc(c.version || "")}</strong> — ${h.esc(
              c.note || c.text || ""
            )}</li>`
        )
        .join("")}</ul>`;
    }
    return `<div class="ea-detail__desc">${h.esc(String(changelog))}</div>`;
  }

  // ============================================================
  // SUBMIT MODAL — ส่ง EA ของคุณ
  // ============================================================
  function openSubmitModal() {
    const root = document.getElementById("eaSubmitRoot");
    if (!root) return;

    root.innerHTML = `
      <div class="ea-modal" role="dialog" aria-modal="true" aria-labelledby="eaSubmitTitle">
        <div class="ea-modal__backdrop" data-close></div>
        <div class="ea-modal__panel ea-modal__panel--form" role="document">
          <button type="button" class="ea-modal__close" data-close aria-label="ปิด">${TT.icon("x", 20)}</button>

          <div class="ea-submit__head">
            <span class="ea-submit__eyebrow">${TT.icon("upload", 16)} ส่ง EA เข้าระบบ</span>
            <h2 class="ea-submit__title" id="eaSubmitTitle">ส่ง EA ของคุณ</h2>
            <p class="ea-submit__lead">
              EA ที่ส่งเข้าระบบจะถูกตรวจสอบโดยทีมงานก่อนเผยแพร่ (Pending Review)
              — ระบบปฏิเสธ EA ที่มีพฤติกรรมผิดปกติหรือไม่ปลอดภัย
            </p>
            <div class="ea-submit__notice">
              ${TT.icon("shield", 14)}
              <span>
                <strong>ฟรีเท่านั้น:</strong> EA ที่ส่งผ่านแบบฟอร์มนี้
                จะแสดงเป็น "ฟรี" เสมอ — หากต้องการตั้งราคา/ขาย
                กรุณาติดต่อทีมงานหลังการอนุมัติ
              </span>
            </div>
          </div>

          <form id="eaSubmitForm" class="ea-submit__form" novalidate>
            <div class="field">
              <label for="eaName">ชื่อ EA <span class="req">*</span></label>
              <input type="text" id="eaName" name="name" maxlength="200"
                     placeholder="เช่น GoldScalper Pro" required>
            </div>

            <div class="field">
              <label for="eaDesc">คำอธิบาย <span class="req">*</span></label>
              <textarea id="eaDesc" name="description" minlength="20" maxlength="8000"
                        placeholder="อธิบายกลยุทธ์ คู่เงินที่รองรับ ระยะเวลา (timeframe) และข้อควรระวัง (อย่างน้อย 20 ตัวอักษร)" required></textarea>
            </div>

            <div class="field--row">
              <div class="field">
                <label for="eaPlatform">แพลตฟอร์ม <span class="req">*</span></label>
                <select id="eaPlatform" name="platform" required>
                  <option value="">— เลือก —</option>
                  <option value="MT4">MetaTrader 4 (MT4)</option>
                  <option value="MT5">MetaTrader 5 (MT5)</option>
                </select>
              </div>
              <div class="field">
                <label for="eaVersion">เวอร์ชัน <span class="req">*</span></label>
                <input type="text" id="eaVersion" name="version" maxlength="60"
                       placeholder="เช่น 1.2.0" required>
              </div>
            </div>

            <div class="field">
              <label for="eaStrategySubmit">ประเภทกลยุทธ์ (ไม่บังคับ)</label>
              <select id="eaStrategySubmit" name="strategy">
                <option value="">— เลือก (ไม่บังคับ) —</option>
                <option value="Trend Following">Trend Following</option>
                <option value="Grid">Grid</option>
                <option value="Scalper">Scalper</option>
                <option value="Hedging">Hedging</option>
                <option value="Breakout">Breakout</option>
                <option value="Martingale">Martingale</option>
                <option value="Arbitrage">Arbitrage</option>
                <option value="Other">อื่น ๆ</option>
              </select>
            </div>

            <div class="field--row">
              <div class="field">
                <label for="eaContactName">ชื่อผู้ส่ง (ไม่บังคับ)</label>
                <input type="text" id="eaContactName" name="contactName" maxlength="100"
                       placeholder="ชื่อหรือชื่อทีมของคุณ">
              </div>
              <div class="field">
                <label for="eaContactEmail">อีเมลติดต่อ (ไม่บังคับ)</label>
                <input type="email" id="eaContactEmail" name="contactEmail" maxlength="200"
                       placeholder="you@example.com">
              </div>
            </div>

            <div class="field">
              <label for="eaCover">รูปปก (ไม่บังคับ)</label>
              <input type="file" id="eaCover" name="cover" accept="image/png,image/jpeg,image/webp">
              <span class="field__hint">PNG/JPG/WEBP — สูงสุด 10MB</span>
            </div>

            <div class="field">
              <label for="eaFile">ไฟล์ EA <span class="req">*</span></label>
              <input type="file" id="eaFile" name="ea"
                     accept=".ex4,.ex5,.set,.zip" required>
              <span class="field__hint">.ex4 / .ex5 / .set / .zip — สูงสุด 50MB</span>
            </div>

            <div class="field ea-submit__consent">
              <label class="ea-checkbox">
                <input type="checkbox" id="eaConsent" name="consent" required>
                <span>ฉันยืนยันว่าเป็นเจ้าของ EA นี้ / มีสิทธิ์แจกจ่าย
                และยอมรับ <a href="contact.html" target="_blank">เงื่อนไขการใช้งาน</a>
                ของ TraderToolsTH</span>
              </label>
            </div>

            <!-- error/success/progress zone -->
            <div id="eaSubmitAlert" class="ea-submit__alert" hidden role="alert"></div>

            <!-- progress bar (hidden until upload) -->
            <div id="eaSubmitProgress" class="ea-submit__progress" hidden>
              <div class="ea-submit__progress-bar">
                <span id="eaSubmitProgressFill" style="width:0%"></span>
              </div>
              <span id="eaSubmitProgressText" class="ea-submit__progress-text">กำลังอัปโหลด… 0%</span>
            </div>

            <div class="ea-submit__actions">
              <button type="button" class="btn btn--ghost" data-close>ยกเลิก</button>
              <button type="submit" id="eaSubmitBtn" class="btn btn--primary btn--lg">
                ${TT.icon("upload", 18)} ส่ง EA เข้าตรวจสอบ
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    bindModalClose(root);

    const form = document.getElementById("eaSubmitForm");
    if (form) form.addEventListener("submit", onSubmitSubmit);

    const closeBtn = root.querySelector(".ea-modal__close");
    if (closeBtn) closeBtn.focus();
  }

  async function onSubmitSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const btn = document.getElementById("eaSubmitBtn");
    const alertEl = document.getElementById("eaSubmitAlert");
    const progEl = document.getElementById("eaSubmitProgress");
    const progFill = document.getElementById("eaSubmitProgressFill");
    const progText = document.getElementById("eaSubmitProgressText");

    // รวบรวมค่า — public submit ไม่มี price/status (server บังคับ)
    const payload = {
      name: form.name.value,
      description: form.description.value,
      platform: form.platform.value,
      version: form.version.value,
      strategy: form.strategy.value,
      contactName: form.contactName.value,
      contactEmail: form.contactEmail.value,
      coverFile: form.cover.files[0] || null,
      eaFile: form.ea.files[0] || null,
    };

    hideAlert(alertEl);

    // ตรวจ consent ก่อน (เพิ่มเติมจาก validation ใน service)
    if (!form.consent.checked) {
      showAlert(alertEl, "error", ["กรุณายอมรับเงื่อนไขการใช้งาน"]);
      return;
    }

    // ปิดปุ่ม + แสดง progress
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${TT.icon("clock", 18)} กำลังส่ง…`;
    }

    try {
      const result = await TT.EAService.submitEA(payload, (pct) => {
        if (progEl) progEl.hidden = false;
        if (progFill) progFill.style.width = pct + "%";
        if (progText) progText.textContent = `กำลังอัปโหลด… ${pct}%`;
      });

      // สำเร็จจริง — แสดงข้อความจาก response
      if (progEl) progEl.hidden = true;
      showAlert(
        alertEl,
        "success",
        [
          `ส่ง EA เข้าระบบเรียบร้อย — สถานะ: ${
            result.status === "pending_review"
              ? "รอตรวจสอบ"
              : h.esc(result.status || "ส่งแล้ว")
          }`,
          result.id
            ? `รหัสอ้างอิง: ${h.esc(result.id)}`
            : "ทีมงานจะตรวจสอบและติดต่อกลับโดยเร็ว",
        ],
        true
      );
      form.reset();
    } catch (err) {
      if (progEl) progEl.hidden = true;

      // validation errors (จาก browser)
      if (err.code === "validation_failed" && Array.isArray(err.errors)) {
        showAlert(alertEl, "error", err.errors);
      } else {
        // API error จริง — แสดงข้อความตรงไปตรงมา ไม่ mock success
        const msg =
          err.serverError ||
          (err.code === "network_error"
            ? "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง"
            : err.code === "timeout"
            ? "หมดเวลารอ — ไฟล์อาจใหญ่เกินไป กรุณาลองอีกครั้ง"
            : "เกิดข้อผิดพลาดในการส่ง EA กรุณาลองใหม่อีกครั้ง");
        showAlert(alertEl, "error", [msg]);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${TT.icon("upload", 18)} ส่ง EA เข้าตรวจสอบ`;
      }
    }
  }

  function showAlert(el, kind, lines, autoClose) {
    if (!el) return;
    el.hidden = false;
    el.className = `ea-submit__alert ea-submit__alert--${kind}`;
    const icon =
      kind === "success" ? TT.icon("check", 18) : TT.icon("warning", 18);
    el.innerHTML = `<span class="ea-submit__alert-icon">${icon}</span>
      <div>${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
    if (autoClose) {
      // ปิด modal อัตโนมัติหลัง success 3.5s
      setTimeout(() => {
        const root = document.getElementById("eaSubmitRoot");
        if (root && root.getAttribute("aria-hidden") === "false") {
          closeModal(root);
        }
      }, 3500);
    }
  }

  function hideAlert(el) {
    if (!el) return;
    el.hidden = true;
    el.innerHTML = "";
  }

  // ============================================================
  // MODAL — close helpers + ESC + focus
  // ============================================================
  function bindModalClose(root) {
    root.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => closeModal(root));
    });
    // ESC
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeModal(root);
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
  }

  function closeModal(root) {
    if (!root) return;
    root.innerHTML = "";
    root.setAttribute("aria-hidden", "true");
    // ปิด modal-open ถ้าไม่มี modal root อื่นที่เปิดอยู่
    const anyOpen = Array.from(
      document.querySelectorAll('[id$="Root"][aria-hidden="false"]')
    ).some((r) => r.children.length > 0);
    if (!anyOpen) document.body.classList.remove("modal-open");
  }

  // ============================================================
  // INIT
  // ============================================================
  document.addEventListener("DOMContentLoaded", render);
})();
