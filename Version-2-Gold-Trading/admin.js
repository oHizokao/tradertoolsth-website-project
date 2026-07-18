/* ============================================================
   Admin Dashboard (Phase 10 + 11) — Auto Pilot + News Management
   ------------------------------------------------------------
   กฎ safety:
   - ห้ามเก็บ ADMIN_TOKEN ใน frontend (cookie HttpOnly จัดการฝั่ง backend)
   - อ่านสถานะจาก backend เสมอ (load + after action + auto-refresh)
   - ปุ่ม Run/Rollback disabled ขณะทำงาน
   - Emergency Stop ยืนยัน 2 ขั้น (click → กดอีกครั้งภายใน 5s)
   - เปิด Auto Pilot ครั้งแรกต้อง confirm เตือน auto-publish
   - ทุก fetch ใช้ credentials:"include" + same-origin (cookie ส่งอัตโนมัติ)
   - ไม่ bypass Safety Gate — publish อยู่ฝั่ง backend เท่านั้น
   - Review modal block approve เมื่อมี unexpected numbers (สอดคล้อง backend)
   ============================================================ */

(function () {
  const h = TT.h;

  const AP_API = "/api/admin/auto-pilot"; // Auto Pilot endpoints
  const NEWS_API = "/api/admin/news"; // News management endpoints
  const REFRESH_MS = 10000; // auto-refresh สถานะทุก 10 วิ
  const NEWS_REFRESH_RETRY_MS = 500; // รอ DB/list ตามหลัง pipeline แบบสั้น ๆ
  const NEWS_REFRESH_RETRIES = 8; // สูงสุด 4 วินาทีหลังคำสั่งดึงข่าวสำเร็จ
  const EMERGENCY_WINDOW_MS = 5000; // หน้าต่างยืนยัน emergency/rollback 2 ขั้น

  // publish_status ที่ใช้ใน filter และ badge
  const PUBLISH_STATUSES = ["published", "ready", "processing", "draft", "rejected", "failed"];
  const STATUS_LABELS = {
    published: "เผยแพร่แล้ว",
    ready: "พร้อมเผยแพร่",
    processing: "กำลังดำเนินการ",
    draft: "ร่าง",
    rejected: "ปฏิเสธ",
    failed: "ล้มเหลว",
    validated: "ตรวจแล้ว",
    needs_review: "ต้องตรวจ",
    fetched: "ดึงมาแล้ว",
  };

  const state = {
    activeOperation: null,
    operationHistory: [],
    authenticated: false,
    status: null, // auto-pilot status
    news: [], // รายการข่าวสำหรับตาราง
    counts: null, // { publishStatus, validationStatus, total }
    loading: false,
    loadingNews: false,
    notice: null, // { type: "error"|"info"|"success", msg }
    emergencyArmedAt: 0,
    rollbackArmedAt: 0,
    enableConfirmedOnce: false,
    refreshTimer: null,
    newsFilter: "", // publish_status filter ("" = all)
    fetchMaxPerRun: 3, // จำนวนข่าวสูงสุดต่อรอบที่เลือกในฟอร์มดึงข่าว (1-10)
    fetchWithImages: true, // ตัวเลือกภาพประกอบ: true = ดึงพร้อมรูป (Pexels), false = ข้ามรูป
    fetchFetchAll: false, // ดึงทั้งหมดที่มี (true = ส่ง fetchAll ไป backend, ปิด numeric input)
    newsSelected: new Set(), // id ข่าวที่เลือกไว้สำหรับ bulk delete
    reviewer: "", // ชื่อ reviewer สำหรับ review/rollback
    busyRows: new Set(), // id ของข่าวที่กำลังประมวลผล (กันกดซ้ำ)
  };

  // ---------- fetch helpers (cookie + same-origin เสมอ) ----------
  async function ap(method, path, opts = {}) {
    const init = {
      method,
      headers: { "content-type": "application/json" },
      credentials: "include",
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return doFetch(AP_API + path, init);
  }

  async function news(method, path, opts = {}) {
    const init = {
      method,
      headers: { "content-type": "application/json" },
      credentials: "include",
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return doFetch(NEWS_API + path, init);
  }

  async function doFetch(url, init) {
    try {
      const res = await fetch(url, init);
      let payload = null;
      const text = await res.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: text };
        }
      }
      return { status: res.status, payload: payload || {} };
    } catch (error) {
      return {
        status: 0,
        payload: {
          error: "server_unreachable",
          message: `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ${error?.message || "network error"}`,
        },
      };
    }
  }

  // ---------- render root ----------
  function render() {
    document.getElementById("app").innerHTML = TT.layout.page({
      active: "admin",
      main: `<div id="adminRoot"></div>`,
    });
    TT.layout.initNavbar();
    document.title = `Admin Dashboard — ${TT.site.name}`;
    void checkSessionAndRender();
  }

  async function checkSessionAndRender() {
    try {
      const { payload } = await ap("GET", "/session");
      state.authenticated = !!payload.authenticated;
    } catch {
      state.authenticated = false;
    }
    if (state.authenticated) {
      await loadAllAndRender();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
      renderLogin();
    }
  }

  // ---------- Login view ----------
  function renderLogin() {
    const root = document.getElementById("adminRoot");
    if (!root) return;
    root.innerHTML = `
      <section class="page">
        <div class="container container--narrow">
          <div class="admin-login">
            <div class="card admin-login__card">
              <div class="admin-login__title">
                เข้าสู่ระบบผู้ดูแล
              </div>
              <p class="admin-login__desc">
                กรอก Admin Token เพื่อควบคุม Auto Pilot และจัดการข่าว<br>
                Token จะถูกเก็บเป็น HttpOnly cookie เท่านั้น — ไม่เก็บในหน้าเว็บ
              </p>
              ${state.notice ? renderNotice(state.notice) : ""}
              <form id="adminLoginForm">
                <div class="admin-login__field">
                  <label class="admin-login__label" for="adminTokenInput">Admin Token</label>
                  <input class="admin-login__input" id="adminTokenInput" type="password"
                         autocomplete="off" placeholder="วาง token ที่นี่" required>
                </div>
                <button class="btn btn--primary btn--block" type="submit" id="adminLoginBtn">
                  เข้าสู่ระบบ
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    `;
    const form = document.getElementById("adminLoginForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const token = document.getElementById("adminTokenInput").value;
        if (!token) return;
        state.notice = null;
        setBtnLoading("adminLoginBtn", "กำลังเข้าสู่ระบบ...");
        try {
          const { status, payload } = await ap("POST", "/login", { body: { token } });
          if (status === 200) {
            state.authenticated = true;
            state.notice = null;
            await loadAllAndRender();
            startAutoRefresh();
          } else if (status === 401) {
            state.notice = { type: "error", msg: "Token ไม่ถูกต้อง" };
            renderLogin();
          } else if (status === 403) {
            state.notice = { type: "error", msg: "ไม่อนุญาตให้เข้าถึงจากแหล่งนี้" };
            renderLogin();
          } else {
            state.notice = { type: "error", msg: payload.error || "เข้าสู่ระบบไม่สำเร็จ" };
            renderLogin();
          }
        } catch (err) {
          state.notice = { type: "error", msg: "เชื่อมต่อ server ไม่ได้" };
          renderLogin();
        }
      });
    }
  }

  // ---------- load ----------
  async function loadAllAndRender() {
    await Promise.all([loadStatus(), loadCounts(), loadNews()]);
    // คำขอทั้งสามทำงานพร้อมกันได้ และอาจมีคำขอหนึ่งพบว่า session หมดอายุ
    // ห้ามวาด dashboard ทับหน้า login หลัง sessionExpired() ทำงานแล้ว
    if (!state.authenticated) {
      renderLogin();
      return;
    }
    renderDashboard();
  }

  async function loadStatus() {
    try {
      const { status, payload } = await ap("GET", "/status");
      if (status === 401) return sessionExpired();
      if (status === 200) state.status = payload;
    } catch {
      /* keep last status */
    }
  }

  async function loadCounts() {
    try {
      const { status, payload } = await news("GET", "/counts");
      if (status === 401) return sessionExpired();
      if (status === 200) state.counts = payload;
    } catch {
      /* keep last */
    }
  }

  async function loadNews() {
    state.loadingNews = true;
    try {
      const path = state.newsFilter ? `?status=${encodeURIComponent(state.newsFilter)}&limit=100` : "?limit=100";
      const { status, payload } = await news("GET", path);
      if (status === 401) {
        state.loadingNews = false;
        return sessionExpired();
      }
      if (status === 200) state.news = Array.isArray(payload) ? payload : [];
    } catch {
      /* keep last */
    }
    state.loadingNews = false;
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    const root = document.getElementById("adminRoot");
    if (!root) return;
    const s = state.status || {};
    const running = !!s.running;
    const emergency = !!s.emergencyStop;

    root.innerHTML = `
      <section class="page">
        <div class="container container--narrow">
          <div class="admin-head">
            <div class="admin-head__title">Admin Dashboard</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="btn btn--teal btn--sm" type="button" id="adminContentHeaderBtn">
                จัดการเนื้อหาเว็บไซต์
              </button>
              <button class="btn btn--ghost btn--sm" type="button" id="adminLogoutBtn">
                ออกจากระบบ
              </button>
            </div>
          </div>

          ${state.notice ? renderNotice(state.notice) : ""}
          <div id="adminActivityPanel">${renderActivityPanel()}</div>

          ${renderReviewerField()}

          <h2 class="admin-section-title">จัดการเนื้อหาเว็บไซต์</h2>
          ${renderContentSection()}

          <h2 class="admin-section-title">จัดการข่าว</h2>
          ${renderNewsSection()}

          <h2 class="admin-section-title">Auto Pilot</h2>
          ${renderAutoPilotSection(s, running, emergency)}

          <p class="text-muted" style="font-size:var(--fs-xs);margin-top:20px;line-height:1.6">
            การตัดสินใจ publish/rollback อยู่ฝั่ง Backend เท่านั้น —
            หน้านี้เป็นตัวควบคุม ไม่สามารถ bypass Safety Gate ได้
          </p>
        </div>
      </section>
    `;

    bindDashboardControls(running, emergency, s);
  }

  // ---------- News Management section ----------
  function renderReviewerField() {
    return `
      <div class="admin-reviewer">
        <label class="admin-login__label" for="reviewerInput">ชื่อผู้ตรวจทาน</label>
        <input class="admin-login__input" id="reviewerInput" type="text"
               value="${h.esc(state.reviewer)}" placeholder="ชื่อของคุณ"
               maxlength="80" autocomplete="off">
        <p class="text-muted" style="font-size:var(--fs-xs);margin:4px 0 0">
          ใช้สำหรับบันทึก audit trail ในการ review / approve / rollback
        </p>
      </div>
    `;
  }

  // ---------- Content Management section (Phase 14) ----------
  // เปิด Content Manager overlay (admin-content.js) — จัดการ EA, Articles, FAQ, Brokers
  // ใช้ cookie session เดียวกับ Admin เดิม ห้ามเก็บ token ฝั่ง frontend
  function renderContentSection() {
    const enabled = typeof TT !== "undefined" && TT.adminContent && typeof TT.adminContent.open === "function";
    return `
      <div class="admin-content-entry">
        <div class="admin-content-entry__info">
          <div class="admin-content-entry__title">EA Products · บทความ · FAQ · รีวิวโบรกเกอร์</div>
          <p class="text-muted" style="font-size:var(--fs-xs);margin:4px 0 0">
            สร้าง/แก้ไข/เผยแพร่เนื้อหาเว็บไซต์ — ใช้ session เดียวกับ Admin
            (cookie HttpOnly, ไม่เก็บ token ใน frontend)
          </p>
        </div>
        <button class="btn btn--teal" type="button" id="adminContentBtn"
                ${enabled ? "" : "disabled title=\"admin-content.js ยังไม่พร้อม\""}>
          ${TT.icon ? TT.icon("ea", 16) : ""} จัดการเนื้อหาเว็บไซต์
        </button>
      </div>
    `;
  }

  function renderNewsSection() {
    const controlsBusy = !!state.activeOperation;
    const c = state.counts || {};
    const pub = (c.publishStatus) || {};
    const val = (c.validationStatus) || {};
    const img = c.imageStatus
      ? {
          ...c.imageStatus,
          pexelsSelected: c.pexelsSelected || 0,
          ownedFallback: c.ownedFallback || 0,
          reviewRequired: c.imageReviewRequired || 0,
        }
      : null;

    return `
      <div class="admin-news">
        ${renderStatsGrid(pub, val, c.total || 0, img)}

        <div class="admin-controls">
          <div class="admin-fetch-config" role="group" aria-label="ตัวเลือกการดึงข่าว">
            <label class="admin-login__label" for="fetchMaxPerRun">จำนวนข่าวต่อรอบ</label>
            <input class="admin-login__input" id="fetchMaxPerRun" name="fetchMaxPerRun"
                   type="number" min="1" max="10" step="1" inputmode="numeric"
                   style="max-width:90px"
                   value="${h.esc(String(state.fetchMaxPerRun))}"
                   ${state.fetchFetchAll || controlsBusy ? "disabled" : ""}>
            <label class="admin-fetch-config__check" for="fetchFetchAll">
              <input type="checkbox" id="fetchFetchAll" name="fetchFetchAll"
                     ${state.fetchFetchAll ? "checked" : ""}
                     ${controlsBusy ? "disabled" : ""}>
              <span>ดึงทั้งหมดที่มี</span>
            </label>
            <label class="admin-fetch-config__check" for="fetchWithImages">
              <input type="checkbox" id="fetchWithImages" name="fetchWithImages"
                     ${state.fetchWithImages ? "checked" : ""}
                     ${controlsBusy ? "disabled" : ""}>
              <span>ดึงพร้อมรูปภาพ (Pexels)</span>
            </label>
          </div>
          <button class="btn btn--teal" type="button" id="adminFetchBtn" ${controlsBusy ? "disabled" : ""}>
            ดึงข่าวใหม่
          </button>
          <button class="btn btn--ghost" type="button" id="adminRefreshNewsBtn" ${controlsBusy ? "disabled" : ""}>
            รีเฟรชรายการ
          </button>
          <button class="btn btn--soft" type="button" id="adminRollbackBtn"
                  ${controlsBusy ? "disabled" : ""}
                  style="${state.rollbackArmedAt ? "border-color:var(--sell);color:var(--sell)" : ""}">
            ${state.rollbackArmedAt ? "กดอีกครั้งเพื่อยืนยัน Rollback" : "Rollback ข่าวล่าสุด"}
          </button>
        </div>

        <div class="admin-filter">
          <label class="admin-login__label" for="statusFilter">กรองตามสถานะ:</label>
          <select class="admin-login__input" id="statusFilter" style="max-width:200px">
            <option value="">ทั้งหมด</option>
            ${PUBLISH_STATUSES.map(
              (st) => `<option value="${st}" ${state.newsFilter === st ? "selected" : ""}>${h.esc(STATUS_LABELS[st] || st)}</option>`
            ).join("")}
          </select>
          <span class="admin-bulk-bar__count" id="newsSelectedCount" aria-live="polite">
            เลือกแล้ว ${state.newsSelected.size} รายการ
          </span>
          <button class="btn btn--soft admin-btn--danger" type="button" id="adminBulkDeleteBtn"
                  ${controlsBusy || state.newsSelected.size === 0 ? "disabled" : ""}>
            ลบที่เลือก
          </button>
        </div>

        <div class="admin-news-table-wrap">
          ${renderNewsTable()}
        </div>
      </div>
    `;
  }

  function renderStatsGrid(pub, val, total, img) {
    const cards = [
      { label: "ทั้งหมด", value: total, cls: "" },
      { label: "เผยแพร่แล้ว", value: pub.published || 0, cls: "ok" },
      { label: "พร้อมเผยแพร่", value: pub.ready || 0, cls: "warn" },
      { label: "ร่าง/ดำเนินการ", value: (pub.draft || 0) + (pub.processing || 0), cls: "" },
      { label: "ปฏิเสธ", value: pub.rejected || 0, cls: "err" },
      { label: "ล้มเหลว", value: pub.failed || 0, cls: "err" },
    ];
    // image stats (requirement ข้อ 5: Pexels สำเร็จ / รูปสำรอง / ล้มเหลว / ต้องตรวจ)
    const imgCards = img
      ? [
          { label: "Pexels สำเร็จ", value: img.pexelsSelected || 0, cls: "ok" },
          { label: "รูปสำรอง", value: img.ownedFallback || 0, cls: "warn" },
          { label: "รูปล้มเหลว", value: img.failed || 0, cls: "err" },
          { label: "ต้องตรวจรูป", value: img.reviewRequired || 0, cls: "warn" },
        ]
      : [];
    return `<div class="admin-stats">
      ${cards
        .map(
          (c) => `<div class="admin-stat ${c.cls}">
        <div class="admin-stat__label">${h.esc(c.label)}</div>
        <div class="admin-stat__value">${c.value}</div>
      </div>`
        )
        .join("")}
      ${imgCards.length ? '<div class="admin-stat admin-stat--divider"></div>' : ""}
      ${imgCards
        .map(
          (c) => `<div class="admin-stat ${c.cls}">
        <div class="admin-stat__label">${h.esc(c.label)}</div>
        <div class="admin-stat__value">${c.value}</div>
      </div>`
        )
        .join("")}
    </div>`;
  }

  function renderNewsTable() {
    if (state.loadingNews) {
      return `<div class="state"><div class="state__title">กำลังโหลดข่าว...</div></div>`;
    }
    if (!state.news.length) {
      return `<div class="state"><div class="state__title">ยังไม่มีข่าวในสถานะนี้</div></div>`;
    }
    return `
      <table class="admin-news-table">
        <thead>
          <tr>
            <th class="admin-news__select-col">
              <input type="checkbox" id="newsSelectAll" class="admin-news-select-all"
                     aria-label="เลือกทั้งหมดที่แสดง">
            </th>
            <th>ข่าว</th>
            <th>แหล่ง</th>
            <th>เวลาต้นทาง</th>
            <th>สถานะ</th>
            <th>การตรวจ</th>
            <th>รูป</th>
            <th>การจัดการ</th>
          </tr>
        </thead>
        <tbody>
          ${state.news.map(renderNewsRow).join("")}
        </tbody>
      </table>
    `;
  }

  function renderNewsRow(n) {
    const busy = state.busyRows.has(n.id);
    const selected = state.newsSelected.has(n.id);
    const publishWarnings = Array.isArray(n.publishWarnings) ? n.publishWarnings : [];
    const warningBadge = publishWarnings.length
      ? `<br><span class="admin-badge admin-badge--warn" title="${h.esc(publishWarnings.join(" • "))}">⚠ ควรตรวจ ${publishWarnings.length} จุด</span>`
      : "";
    const selectCell = `<td class="admin-news__select-col">
      <input type="checkbox" class="admin-news-select" data-news-select
             id="news-select-${h.esc(n.id)}" data-id="${h.esc(n.id)}"
             aria-label="เลือกข่าวนี้เพื่อลบ"
             ${selected ? "checked" : ""} ${busy ? "disabled" : ""}>
    </td>`;
    const publishBtn =
      n.publishStatus === "ready"
        ? `<button class="btn btn--primary btn--sm" data-act="publish" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>เผยแพร่</button>`
        : "";
    const approveBtn =
      n.validationStatus === "validated" && n.publishStatus !== "ready" && n.publishStatus !== "published"
        ? `<button class="btn btn--ghost btn--sm" data-act="approve" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>อนุมัติ</button>`
        : "";
    const reviewBtn =
      n.publishStatus !== "rejected"
        ? `<button class="btn btn--teal btn--sm" data-act="review" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>${n.publishStatus === "published" ? "แก้ไขข่าว" : "แก้ไข/ตรวจ"}</button>`
        : "";
    const rejectBtn =
      n.publishStatus !== "rejected" && n.publishStatus !== "published"
        ? `<button class="btn btn--soft btn--sm" data-act="reject" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>ปฏิเสธ</button>`
        : "";
    const deleteBtn = `<button class="btn btn--soft btn--sm admin-btn--danger" data-act="delete" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>ลบ</button>`;
    const detailBtn = `<button class="btn btn--ghost btn--sm" data-act="detail" data-id="${h.esc(n.id)}">รายละเอียด</button>`;
    const sourceLink = n.sourceUrl
      ? `<a href="${h.esc(n.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="admin-link">${h.esc(n.sourceName || "ต้นฉบับ")} ↗</a>`
      : h.esc(n.sourceName || "-");
    const imgCell = renderNewsThumbnail(n);

    return `<tr>
      ${selectCell}
      <td class="admin-news__title" title="${h.esc(n.title || "")}">${h.esc((n.title || "-").slice(0, 80))}${(n.title || "").length > 80 ? "…" : ""}</td>
      <td>${sourceLink}</td>
      <td class="mono" style="font-size:var(--fs-xs)">${h.esc(h.formatBangkok(n.sourcePublishedAt, { prefix: "" }) || "-")}</td>
      <td><span class="admin-badge admin-badge--${badgeClass(n.publishStatus)}">${h.esc(STATUS_LABELS[n.publishStatus] || n.publishStatus || "-")}</span></td>
      <td><span class="admin-badge admin-badge--${valBadgeClass(n.validationStatus)}">${h.esc(STATUS_LABELS[n.validationStatus] || n.validationStatus || "-")}</span><br><span class="mono" style="font-size:var(--fs-xs)">conf ${n.aiConfidence ?? "-"}</span>${warningBadge}</td>
      <td>${imgCell}</td>
      <td class="admin-news__actions">
        ${detailBtn}
        ${reviewBtn}
        ${approveBtn}
        ${publishBtn}
        ${rejectBtn}
        ${deleteBtn}
      </td>
    </tr>`;
  }

  // ---------- news thumbnail cell ----------
  // แสดง thumbnail 80×50 px, ป้าย Pexels/รูปสำรอง/ไม่มีรูป, object-fit cover
  // alt จากชื่อข่าว, placeholder ถ้าโหลดไม่ได้ (onerror)
  function renderNewsThumbnail(n) {
    const url = n.imageUrl || "";
    const title = (n.title || "ข่าว").slice(0, 120);
    // กระบวนการตัดสินใจแหล่งที่มา: imageSource บอกว่ามาจากไหน
    // - "Pexels" → ป้าย Pexels (รูปจริงจาก Pexels)
    // - url ขึ้นต้น /news-assets/*.svg → ป้าย "รูปสำรอง" (TraderToolsTH owned artwork)
    // - ไม่มี url → "ไม่มีรูป"
    const isFallbackSvg = /^\/news-assets\//.test(url);
    const isPexels = !isFallbackSvg && (n.imageSource === "Pexels" || /^https?:\/\/images\.pexels\.com\//.test(url));
    let sourceTag = "";
    if (!url) {
      // ไม่มีรูปเลย → แสดงข้อความ "ไม่มีรูป"
      sourceTag = `<span class="admin-thumb-empty">ไม่มีรูป</span>`;
    } else if (isFallbackSvg) {
      sourceTag = `<span class="admin-thumb-tag admin-thumb-tag--fallback">รูปสำรอง</span>`;
    } else if (isPexels) {
      sourceTag = `<span class="admin-thumb-tag admin-thumb-tag--pexels">Pexels</span>`;
    } else {
      sourceTag = `<span class="admin-thumb-tag">${h.esc(n.imageSource || "อื่น")}</span>`;
    }
    // thumbnail img (มี placeholder ถ้าโหลดไม่ได้)
    const thumb = url
      ? `<img class="admin-thumb" src="${h.esc(url)}" alt="${h.esc(title)}" loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <span class="admin-thumb-ph" style="display:none" role="img" aria-label="รูปโหลดไม่ได้">ไม่มีรูป</span>`
      : `<span class="admin-thumb-ph" role="img" aria-label="ไม่มีรูป">ไม่มีรูป</span>`;
    const reviewFlag = n.imageReviewRequired ? ' <span class="admin-thumb-warn" title="ต้องตรวจรูป">⚠</span>' : "";
    return `<div class="admin-thumb-cell">${thumb}${sourceTag}${reviewFlag}</div>`;
  }

  function badgeClass(status) {
    return (
      {
        published: "ok",
        ready: "warn",
        rejected: "err",
        failed: "err",
      }[status] || ""
    );
  }
  function valBadgeClass(status) {
    return (
      {
        validated: "ok",
        rejected: "err",
        failed: "err",
        needs_review: "warn",
      }[status] || ""
    );
  }

  // ---------- Auto Pilot section (from Phase 10, unchanged logic) ----------
  function renderAutoPilotSection(s, running, emergency) {
    const controlsBusy = !!state.activeOperation;
    return `
      <div class="card">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px">
          <span style="font-weight:var(--fw-semibold)">สถานะปัจจุบัน:</span>
          ${renderStatusBadge(s, emergency)}
        </div>

        <div class="admin-info">
          ${renderInfoCell("ข่าวสูงสุดต่อรอบ", h.esc(String(s.maxPerRun ?? "-")))}
          ${renderInfoCell("เวลารันล่าสุด", h.formatBangkok(s.lastRunAt, { prefix: "" }) || "-")}
          ${renderInfoCell("สำเร็จล่าสุด", h.formatBangkok(s.lastSuccessAt, { prefix: "" }) || "-")}
          ${renderInfoCell("env allowed", s.envAllowed ? "ใช่" : "ไม่", !s.envAllowed)}
          ${renderInfoCell("DB enabled", s.enabled ? "ใช่" : "ไม่", !s.enabled)}
          ${renderInfoCell("กำลังทำงาน", running ? "ใช่" : "ไม่")}
        </div>

        ${
          s.lastError
            ? `<div class="admin-info__cell admin-info__value--error" style="margin-top:12px">
                 <div class="admin-info__label">error ล่าสุด</div>
                 <div class="admin-info__value admin-info__value--error">${h.esc(String(s.lastError))}</div>
               </div>`
            : ""
        }
      </div>

      <h3 class="admin-subtitle">การควบคุม</h3>
      <div class="admin-controls">
        <button class="btn btn--primary" type="button" id="adminEnableBtn"
                ${s.enabled || emergency || controlsBusy ? "disabled" : ""}>
          เปิด Auto Pilot
        </button>
        <button class="btn btn--ghost" type="button" id="adminDisableBtn"
                ${!s.enabled || controlsBusy ? "disabled" : ""}>
          ปิด Auto Pilot
        </button>
        <button class="btn btn--teal" type="button" id="adminRunBtn"
                ${running || !s.enabled || emergency || controlsBusy ? "disabled" : ""}>
          รัน Auto Pilot ตอนนี้
        </button>
        <button class="btn btn--soft" type="button" id="adminEmergencyBtn"
                style="${emergency ? "border-color:var(--sell);color:var(--sell)" : ""}"
                ${emergency || controlsBusy ? "disabled" : ""}>
          ${state.emergencyArmedAt ? "กดอีกครั้งเพื่อยืนยัน" : "Emergency Stop"}
        </button>
        <button class="btn btn--ghost" type="button" id="adminClearEmgBtn"
                ${!emergency || controlsBusy ? "disabled" : ""}>
          Clear Emergency
        </button>
      </div>

      <h3 class="admin-subtitle">Audit Log ล่าสุด</h3>
      <div class="admin-audit-wrap">
        <table class="admin-audit">
          <thead>
            <tr>
              <th>เวลา</th><th>stage</th><th>newsId</th><th>status</th><th>เหตุผล</th>
            </tr>
          </thead>
          <tbody id="adminAuditBody">
            ${renderAuditRows(s.recentAudit || [])}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderStatusBadge(s, emergency) {
    let key, label;
    if (emergency) {
      key = "emergency";
      label = "Emergency Stop";
    } else if (s.status === "running") {
      key = "running";
      label = "กำลังทำงาน";
    } else if (s.status === "stopped_error") {
      key = "stopped_error";
      label = "หยุดเนื่องจากข้อผิดพลาด";
    } else if (s.enabled) {
      key = "idle";
      label = "พร้อมทำงาน";
    } else {
      key = "off";
      label = "ปิดอยู่";
    }
    return `<span class="admin-status-badge admin-status-badge--${key}"><span class="dot"></span>${h.esc(label)}</span>`;
  }

  function renderInfoCell(label, value, isWarn) {
    return `<div class="admin-info__cell">
      <div class="admin-info__label">${h.esc(label)}</div>
      <div class="admin-info__value ${isWarn ? "admin-info__value--error" : ""}">${h.esc(value)}</div>
    </div>`;
  }

  function renderAuditRows(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">ยังไม่มี audit log</td></tr>`;
    }
    return entries
      .map((a) => {
        const statusCls = {
          ok: "admin-audit__status--ok",
          error: "admin-audit__status--error",
          blocked: "admin-audit__status--blocked",
          skipped: "admin-audit__status--skipped",
        }[a.status] || "admin-audit__status--skipped";
        return `<tr>
          <td class="mono" style="font-size:var(--fs-xs)">${h.esc(h.formatBangkok(a.createdAt, { prefix: "", timeOnly: true }))}</td>
          <td class="admin-audit__stage">${h.esc(a.stage || "-")}</td>
          <td class="admin-audit__reason">${h.esc(a.newsId || "-")}</td>
          <td><span class="admin-audit__status ${statusCls}">${h.esc(a.status || "-")}</span></td>
          <td class="admin-audit__reason" title="${h.esc(a.reason || "")}">${h.esc(a.reason || "-")}</td>
        </tr>`;
      })
      .join("");
  }

  function renderActivityPanel() {
    const active = state.activeOperation;
    const history = state.operationHistory.slice(0, 5);
    const activeHtml = active
      ? `<div class="admin-activity__active" role="status" aria-live="polite">
          <span class="admin-spinner admin-spinner--sm" aria-hidden="true"></span>
          <div>
            <div class="admin-activity__status">กำลังทำงาน</div>
            <strong>${h.esc(active.label)}</strong>
            <div class="admin-activity__detail">${h.esc(active.detail || "ระบบกำลังประมวลผล กรุณารอสักครู่")}</div>
          </div>
        </div>`
      : `<div class="admin-activity__idle"><span class="admin-activity__dot"></span> ระบบพร้อมรับคำสั่ง</div>`;
    const historyHtml = history.length
      ? `<div class="admin-activity__history">
          <div class="admin-activity__history-title">ผลการทำงานล่าสุด</div>
          ${history.map((item) => `<div class="admin-activity__item admin-activity__item--${item.type}">
            <span class="admin-activity__icon" aria-hidden="true">${item.type === "success" ? "✓" : item.type === "error" ? "!" : "i"}</span>
            <div><strong>${h.esc(item.label)}</strong><div>${h.esc(item.summary)}</div></div>
            <time>${h.esc(item.time)}</time>
          </div>`).join("")}
        </div>`
      : `<div class="admin-activity__empty">เมื่อกดปุ่ม ระบบจะแสดงขั้นตอนและผลลัพธ์ที่นี่</div>`;
    return `<section class="admin-activity card" aria-label="สถานะการทำงานของระบบ">
      <div class="admin-activity__head"><h2>สถานะการทำงาน</h2><span>${active ? "กำลังประมวลผล" : "พร้อมใช้งาน"}</span></div>
      ${activeHtml}
      ${historyHtml}
    </section>`;
  }

  function syncActivityPanel() {
    const panel = document.getElementById("adminActivityPanel");
    if (panel) panel.innerHTML = renderActivityPanel();
  }

  function disableActionButtons(disabled) {
    const ids = [
      "adminFetchBtn", "adminRefreshNewsBtn", "adminRollbackBtn", "adminEnableBtn",
      "adminDisableBtn", "adminRunBtn", "adminEmergencyBtn", "adminClearEmgBtn",
      "adminBulkDeleteBtn",
    ];
    ids.forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = disabled || btn.disabled;
    });
    document.querySelectorAll(".admin-news-table [data-act]").forEach((btn) => {
      btn.disabled = disabled;
    });
    // ปิด checkbox เลือกข่าวระหว่างประมวลผล (กันเปลี่ยน selection ขณะ bulk delete)
    document.querySelectorAll(".admin-news-select, #newsSelectAll").forEach((cb) => {
      cb.disabled = disabled;
    });
  }

  function beginOperation(key, label, detail, buttonId, buttonLabel) {
    if (state.activeOperation) {
      state.notice = { type: "info", msg: `ระบบกำลังทำงาน: ${state.activeOperation.label} กรุณารอให้เสร็จก่อน` };
      showToast("info", state.notice.msg);
      return false;
    }
    state.activeOperation = { key, label, detail, startedAt: new Date().toISOString() };
    state.notice = null;
    syncActivityPanel();
    disableActionButtons(true);
    if (buttonId && buttonLabel) setBtnLoading(buttonId, buttonLabel);
    showToast("info", `${label} — กำลังดำเนินการ`);
    return true;
  }

  function finishOperation(type, summary) {
    const op = state.activeOperation;
    if (!op) return;
    state.operationHistory.unshift({
      key: op.key,
      label: op.label,
      summary,
      type,
      time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
    });
    state.operationHistory = state.operationHistory.slice(0, 8);
    state.activeOperation = null;
    state.notice = { type, msg: summary };
    syncActivityPanel();
    showToast(type, summary);
  }

  function recordOperationResult(label, type, summary) {
    state.operationHistory.unshift({
      key: `record-${Date.now()}`,
      label,
      summary,
      type,
      time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
    });
    state.operationHistory = state.operationHistory.slice(0, 8);
    state.notice = { type, msg: summary };
    syncActivityPanel();
    showToast(type, summary);
  }

  function formatNewsRunResult(payload = {}) {
    if (payload.skipped) return "ไม่ได้เริ่มรอบใหม่ เพราะมีการดึงข่าวทำงานอยู่แล้ว";
    const source = Number(payload.digestItems || 0);
    const opened = Number(payload.opened || 0);
    const saved = Number(payload.saved || 0);
    const existing = Number(payload.existing || 0);
    const duplicates = Number(payload.duplicates || 0);
    const review = Number(payload.needsReview || 0);
    const failed = Number(payload.failed || 0);
    return `เสร็จแล้ว: พบจากต้นทาง ${source} ข่าว · เปิดตรวจ ${opened} · บันทึกใหม่ ${saved} · ซ้ำกับระบบ ${existing} · ซ้ำระหว่างประมวลผล ${duplicates} · รอตรวจ ${review} · ล้มเหลว ${failed}`;
  }

  function setRowBusy(id, label) {
    Array.from(document.querySelectorAll(".admin-news-table [data-id]")).filter((btn) => btn.dataset.id === String(id)).forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.act !== "detail") btn.textContent = label;
    });
  }

  function renderNotice(notice) {
    return `<div class="admin-notice admin-notice--${notice.type}">${h.esc(notice.msg)}</div>`;
  }

  function showToast(type, message, timeoutMs = 4500) {
    let region = document.getElementById("adminToastRegion");
    if (!region) {
      region = document.createElement("div");
      region.id = "adminToastRegion";
      region.className = "admin-toast-region";
      region.setAttribute("role", "region");
      region.setAttribute("aria-label", "การแจ้งเตือน");
      document.body.appendChild(region);
    }
    const toast = document.createElement("div");
    const safeType = ["success", "error", "info"].includes(type) ? type : "info";
    toast.className = `admin-toast admin-toast--${safeType}`;
    toast.setAttribute("role", safeType === "error" ? "alert" : "status");
    toast.innerHTML = `<span class="admin-toast__dot" aria-hidden="true"></span><span>${h.esc(message)}</span><button type="button" class="admin-toast__close" aria-label="ปิดการแจ้งเตือน">×</button>`;
    region.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    const remove = () => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 180);
    };
    toast.querySelector(".admin-toast__close")?.addEventListener("click", remove);
    setTimeout(remove, timeoutMs);
  }

  // ---------- dashboard controls ----------
  function bindDashboardControls(running, emergency, s) {
    const logoutBtn = document.getElementById("adminLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await ap("POST", "/logout").catch(() => {});
        state.authenticated = false;
        state.status = null;
        stopAutoRefresh();
        state.notice = { type: "info", msg: "ออกจากระบบแล้ว" };
        renderLogin();
      });
    }

    bindContentButton();

    // reviewer field
    const reviewerInput = document.getElementById("reviewerInput");
    if (reviewerInput) {
      reviewerInput.addEventListener("input", (e) => {
        state.reviewer = e.target.value.slice(0, 80);
      });
    }

    // news actions
    bindNewsControls();

    // auto-pilot controls
    const enableBtn = document.getElementById("adminEnableBtn");
    if (enableBtn) enableBtn.addEventListener("click", () => handleEnable(s));
    const disableBtn = document.getElementById("adminDisableBtn");
    if (disableBtn) disableBtn.addEventListener("click", () => void apActionWithRefresh("POST", "/disable", "ปิด Auto Pilot แล้ว"));
    const runBtn = document.getElementById("adminRunBtn");
    if (runBtn) runBtn.addEventListener("click", () => void handleRunOnce());
    const emergencyBtn = document.getElementById("adminEmergencyBtn");
    if (emergencyBtn) emergencyBtn.addEventListener("click", () => handleEmergencyTwoStep());
    const clearEmgBtn = document.getElementById("adminClearEmgBtn");
    if (clearEmgBtn) clearEmgBtn.addEventListener("click", () => void apActionWithRefresh("POST", "/clear-emergency", "ล้าง Emergency Stop แล้ว"));
  }

  // ---------- Content Management button (Phase 14) ----------
  // เปิด content manager จาก dashboard — ใช้ module แยก (admin-content.js)
  // สอดคล้องกับ admin.js เดิม: ใช้ session เดียวกัน (cookie HttpOnly)
  function bindContentButton() {
    document.querySelectorAll("#adminContentBtn, #adminContentHeaderBtn").forEach((btn) => {
      if (window.TT && TT.adminContent) {
        btn.addEventListener("click", () => {
          recordOperationResult("จัดการเนื้อหาเว็บไซต์", "info", "เปิดหน้าจัดการ EA, บทความ, FAQ และรีวิวโบรกเกอร์แล้ว");
          TT.adminContent.open();
        });
      }
    });
  }
  // เมื่อ content module แจ้ง session หมดอายุ → กลับไป login
  document.addEventListener("tt:admin-session-expired", () => {
    state.authenticated = false;
    stopAutoRefresh();
    state.notice = { type: "info", msg: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };
    renderLogin();
  });

  // เมื่อ content manager ปิด → re-render dashboard เพื่อ refresh สถานะล่าสุด
  // (counts/รายการอาจเปลี่ยนจากการ CRUD ใน content manager)
  document.addEventListener("tt:admin-content-close", () => {
    if (state.authenticated) {
      void (async () => {
        await loadStatus();
        await loadCounts();
        renderDashboard();
      })();
    }
  });

  function bindNewsControls() {
    const fetchBtn = document.getElementById("adminFetchBtn");
    if (fetchBtn) {
      fetchBtn.addEventListener("click", () => void handleFetchNewsWithStatus());
    }
    // ตัวเลือกการดึงข่าว (จำนวน + รูปภาพ + ดึงทั้งหมด) — เก็บเข้า state ทันทีที่เปลี่ยน
    // เพื่อให้ re-render dashboard แล้วค่าที่ผู้ใจเลือกยังอยู่
    const maxPerRunInput = document.getElementById("fetchMaxPerRun");
    if (maxPerRunInput) {
      maxPerRunInput.addEventListener("input", (e) => {
        state.fetchMaxPerRun = readFetchMaxPerRun(e.target.value);
      });
    }
    const fetchAllInput = document.getElementById("fetchFetchAll");
    if (fetchAllInput) {
      fetchAllInput.addEventListener("change", (e) => {
        state.fetchFetchAll = !!e.target.checked;
        // เมื่อเปิด "ดึงทั้งหมดที่มี" → ปิด numeric input (ค่า maxPerRun จะถูกแทนด้วย batch size ฝั่ง backend)
        const num = document.getElementById("fetchMaxPerRun");
        if (num) num.disabled = state.fetchFetchAll || !!state.activeOperation;
      });
    }
    const withImagesInput = document.getElementById("fetchWithImages");
    if (withImagesInput) {
      withImagesInput.addEventListener("change", (e) => {
        state.fetchWithImages = !!e.target.checked;
      });
    }
    const refreshBtn = document.getElementById("adminRefreshNewsBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        if (!beginOperation("refresh-list", "รีเฟรชรายการข่าว", "กำลังอ่านยอดรวม สถานะข่าว และรูปภาพล่าสุดจากฐานข้อมูล", "adminRefreshNewsBtn", "กำลังรีเฟรช...")) return;
        try {
          await loadCounts();
          await loadNews();
          finishOperation("success", `รีเฟรชสำเร็จ แสดงข่าว ${state.news.length} รายการ จากทั้งหมด ${state.counts?.total || 0} รายการ`);
        } catch (err) {
          finishOperation("error", `รีเฟรชไม่สำเร็จ: ${err.message || err}`);
        }
        renderDashboard();
      });
    }
    const rollbackBtn = document.getElementById("adminRollbackBtn");
    if (rollbackBtn) {
      rollbackBtn.addEventListener("click", () => handleRollbackTwoStep());
    }
    const statusFilter = document.getElementById("statusFilter");
    if (statusFilter) {
      statusFilter.addEventListener("change", (e) => {
        state.newsFilter = e.target.value;
        void (async () => {
          await loadNews();
          renderDashboard();
        })();
      });
    }

    // select-all visible rows checkbox
    const selectAll = document.getElementById("newsSelectAll");
    if (selectAll) {
      selectAll.addEventListener("change", (e) => {
        const checked = !!e.target.checked;
        document.querySelectorAll(".admin-news-select").forEach((cb) => {
          if (cb.disabled) return;
          cb.checked = checked;
          const id = cb.dataset.id;
          if (!id) return;
          if (checked) state.newsSelected.add(id);
          else state.newsSelected.delete(id);
        });
        updateSelectedCount();
      });
    }

    // bulk delete (selected) — ต้อง confirm ก่อนส่งคำขอ
    const bulkDeleteBtn = document.getElementById("adminBulkDeleteBtn");
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener("click", () => void handleBulkDelete());
    }

    // row action buttons + per-row checkbox (event delegation)
    const tableWrap = document.querySelector(".admin-news-table-wrap");
    if (tableWrap) {
      tableWrap.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        if (act === "detail") void handleShowDetailWithStatus(id);
        else if (act === "review") void handleOpenReviewWithStatus(id);
        else if (act === "approve") void handleApprove(id);
        else if (act === "reject") void handleReject(id);
        else if (act === "publish") void handlePublish(id);
        else if (act === "delete") void handleDeleteSingle(id);
      });
      tableWrap.addEventListener("change", (e) => {
        const cb = e.target.closest("[data-news-select]");
        if (!cb) return;
        const id = cb.dataset.id;
        if (!id) return;
        if (cb.checked) state.newsSelected.add(id);
        else state.newsSelected.delete(id);
        updateSelectedCount();
        syncSelectAllCheckbox();
      });
    }

    // sync UI state ที่ขึ้นกับ selection หลัง render
    updateSelectedCount();
    syncSelectAllCheckbox();
  }

  // ---------- news actions ----------
  async function handleShowDetailWithStatus(id) {
    if (!beginOperation(`detail-${id}`, "โหลดรายละเอียดข่าว", "กำลังอ่านเนื้อหา สถานะ และข้อมูลรูปภาพของข่าว", null, null)) return;
    setRowBusy(id, "กำลังโหลด...");
    await handleShowDetail(id);
    if (!state.authenticated) return;
    const failed = state.notice?.type === "error";
    finishOperation(failed ? "error" : "success", failed ? state.notice.msg : "โหลดรายละเอียดข่าวสำเร็จ");
    renderDashboard();
  }

  async function handleOpenReviewWithStatus(id) {
    if (!beginOperation(`review-${id}`, "เปิดแบบฟอร์มตรวจทาน", "กำลังโหลดต้นฉบับ เนื้อหาภาษาไทย และผลตรวจคุณภาพ", null, null)) return;
    setRowBusy(id, "กำลังโหลด...");
    await handleOpenReview(id);
    if (!state.authenticated) return;
    const failed = state.notice?.type === "error";
    finishOperation(failed ? "error" : "success", failed ? state.notice.msg : "เปิดแบบฟอร์มตรวจทานแล้ว");
    renderDashboard();
  }

  // อ่าน + sanitize จำนวนข่าวต่อรอบจาก input (1-10, default 3)
  // ป้องกันค่าตกหล่น/ปัดเศษ/อักขระแปลกจากผู้ใช้ — backend จะ clamp อีกชั้น
  function readFetchMaxPerRun(raw) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(10, n));
  }

  async function handleFetchNewsWithStatus() {
    const fetchAll = !!state.fetchFetchAll;
    const maxPerRun = readFetchMaxPerRun(state.fetchMaxPerRun);
    const withImages = !!state.fetchWithImages;
    const beforeRun = snapshotNewsState();
    let expectedSaved = 0;
    let shouldWaitForNews = false;
    const imgNote = withImages ? " → ดึงรูปจาก Pexels" : " → ข้ามการดึงรูป";
    const countLabel = fetchAll ? "ทั้งหมดที่มี" : `${maxPerRun} รายการ`;
    if (!beginOperation(
      "fetch-news",
      `ดึงข่าวใหม่ ${countLabel}${withImages ? "" : " (ไม่มีรูป)"}`,
      `กำลังอ่านรายการต้นทาง → ตรวจข่าวซ้ำ → เปิดบทความ → เรียบเรียงและตรวจคุณภาพ${imgNote} → บันทึกผล`,
      "adminFetchBtn",
      "กำลังดึงและตรวจข่าว..."
    )) return;
    try {
      const { status, payload } = await doFetch("/api/admin/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ maxPerRun, withImages, fetchAll }),
      });
      if (status === 200 || status === 202) {
        expectedSaved = Number(payload.saved || 0);
        shouldWaitForNews = !payload.skipped;
        finishOperation(payload.skipped ? "info" : "success", formatNewsRunResult(payload));
      } else if (status === 401) {
        state.activeOperation = null;
        return sessionExpired();
      } else if (status === 403) {
        finishOperation("error", "ไม่อนุญาตให้สั่งดึงข่าวจากหน้านี้");
      } else {
        finishOperation("error", `ดึงข่าวไม่สำเร็จ: ${payload.error || `HTTP ${status}`}`);
      }
    } catch (err) {
      finishOperation("error", `เชื่อมต่อระบบไม่ได้: ${err.message || err}`);
    }
    if (shouldWaitForNews) {
      await refreshNewsAfterRun(beforeRun, expectedSaved);
    } else {
      await loadAllAndRender();
    }
  }

  function snapshotNewsState() {
    return {
      total: Number(state.counts?.total || 0),
      ids: state.news.map((item) => String(item.id)).join("|"),
    };
  }

  function newsStateChanged(before) {
    const current = snapshotNewsState();
    return current.total !== before.total || current.ids !== before.ids;
  }

  async function refreshNewsAfterRun(before, expectedSaved) {
    for (let attempt = 0; attempt < NEWS_REFRESH_RETRIES; attempt += 1) {
      await Promise.all([loadStatus(), loadCounts(), loadNews()]);
      if (!state.authenticated) return;
      const changed = newsStateChanged(before);
      renderDashboard();
      // ถ้าไม่มีข่าวใหม่ตามผลลัพธ์ (เช่นมีแต่ข่าวซ้ำ) โหลดครั้งเดียวก็เพียงพอ
      if (changed || expectedSaved <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, NEWS_REFRESH_RETRY_MS));
    }
    // ยังไม่เห็น record ใหม่ภายในช่วง retry ให้รอบ auto-refresh โหลดรายการต่อเอง
    showToast("info", "ระบบบันทึกข่าวแล้ว และจะอัปเดตรายการให้อัตโนมัติในอีกสักครู่");
  }

  async function handleFetchNews() {
    setBtnLoading("adminFetchBtn", "กำลังดึง...");
    state.notice = null;
    const fetchAll = !!state.fetchFetchAll;
    const maxPerRun = readFetchMaxPerRun(state.fetchMaxPerRun);
    const withImages = !!state.fetchWithImages;
    try {
      // POST /api/admin/run — manual news fetch (ไม่ auto-publish)
      // ค่า maxPerRun, withImages และ fetchAll มาจากฟอร์มที่ผู้ใจเลือก
      const { status, payload } = await doFetch("/api/admin/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ maxPerRun, withImages, fetchAll }),
      });
      if (status === 202 || status === 200) {
        state.notice = { type: "success", msg: payload.skipped ? "มีการดึงข่าวอยู่แล้ว" : `เริ่มดึงข่าว ${fetchAll ? "ทั้งหมดที่มี" : `${maxPerRun} รายการ`} แล้ว${withImages ? "" : " (ไม่มีรูป)"} (อาจใช้เวลาสักครู่)` };
      } else if (status === 401) {
        return sessionExpired();
      } else if (status === 403) {
        state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
      } else {
        state.notice = { type: "error", msg: payload.error || "ดึงข่าวไม่สำเร็จ" };
      }
    } catch {
      state.notice = { type: "error", msg: "เชื่อมต่อ server ไม่ได้" };
    }
    await loadAllAndRender();
  }

  // ---------- selection helpers (bulk delete) ----------
  // อัปเดตตัวเลข "เลือกแล้ว N รายการ" + สถานะปุ่ม "ลบที่เลือก"
  function updateSelectedCount() {
    const n = state.newsSelected.size;
    const el = document.getElementById("newsSelectedCount");
    if (el) el.textContent = `เลือกแล้ว ${n} รายการ`;
    const btn = document.getElementById("adminBulkDeleteBtn");
    if (btn) btn.disabled = n === 0 || !!state.activeOperation;
  }

  // sync สถานะ checkbox "เลือกทั้งหมด" (checked/indeterminate/unchecked)
  function syncSelectAllCheckbox() {
    const sa = document.getElementById("newsSelectAll");
    if (!sa) return;
    const boxes = Array.from(document.querySelectorAll(".admin-news-select")).filter((b) => !b.disabled);
    if (!boxes.length) {
      sa.checked = false;
      sa.indeterminate = false;
      return;
    }
    const allChecked = boxes.every((b) => b.checked);
    const someChecked = boxes.some((b) => b.checked);
    sa.checked = allChecked;
    sa.indeterminate = !allChecked && someChecked;
  }

  // ---------- delete (single) ----------
  // กฎ safety: window.confirm ทันทีก่อนคำขอ — ไม่ยืนยัน = ไม่ส่งคำขอ
  // ปิด UI ขณะทำงาน, ล้าง/อัปเดต state แล้ว reload counts + news
  async function handleDeleteSingle(id) {
    if (!window.confirm("ยืนยันการลบข่าวนี้? การกระทำนี้ไม่สามารถย้อนกลับได้")) return;
    if (!beginOperation(
      `delete-${id}`,
      "ลบข่าว",
      "กำลังลบข่าวรายการนี้ออกจากระบบ",
      null,
      null
    )) return;
    state.busyRows.add(id);
    setRowBusy(id, "กำลังลบ...");
    try {
      const { status, payload } = await news("DELETE", `/${encodeURIComponent(id)}`);
      if (status === 401) {
        state.activeOperation = null;
        state.busyRows.delete(id);
        return sessionExpired();
      }
      if (status === 404) {
        finishOperation("error", "ไม่พบข่าวนี้ (อาจถูกลบไปแล้ว)");
      } else if (status === 200) {
        state.newsSelected.delete(id);
        finishOperation("success", "ลบข่าวแล้ว");
      } else {
        finishOperation("error", `ลบไม่สำเร็จ: ${payload.error || `HTTP ${status}`}`);
      }
    } catch (err) {
      finishOperation("error", `เชื่อมต่อระบบไม่ได้: ${err.message || err}`);
    } finally {
      state.busyRows.delete(id);
      await loadAllAndRender();
    }
  }

  // ---------- delete (bulk selected) ----------
  // กฎ safety: window.confirm ทันทีก่อนคำขอ — ไม่ยืนยัน = ไม่ส่งคำขอ
  // ปิด UI ขณะทำงาน, ล้าง selection แล้ว reload counts + news
  async function handleBulkDelete() {
    const ids = Array.from(state.newsSelected);
    if (!ids.length) return;
    if (!window.confirm(`ยืนยันการลบข่าว ${ids.length} รายการที่เลือก? การกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
    if (!beginOperation(
      "bulk-delete",
      `ลบข่าว ${ids.length} รายการ`,
      "กำลังลบข่าวที่เลือกออกจากระบบ",
      "adminBulkDeleteBtn",
      "กำลังลบ..."
    )) return;
    try {
      const { status, payload } = await news("POST", `/bulk-delete`, { body: { ids } });
      if (status === 401) {
        state.activeOperation = null;
        return sessionExpired();
      }
      if (status === 400) {
        finishOperation("error", `คำขอไม่ถูกต้อง: ${payload.error || "ids ไม่ valid"}`);
      } else if (status === 200) {
        const del = (payload.deletedIds || []).length;
        const notFound = (payload.notFoundIds || []).length;
        state.newsSelected.clear();
        finishOperation(
          notFound ? "info" : "success",
          `ลบแล้ว ${del} รายการ${notFound ? ` · ไม่พบ ${notFound} รายการ` : ""}`
        );
      } else {
        finishOperation("error", `ลบไม่สำเร็จ: ${payload.error || `HTTP ${status}`}`);
      }
    } catch (err) {
      finishOperation("error", `เชื่อมต่อระบบไม่ได้: ${err.message || err}`);
    } finally {
      await loadAllAndRender();
    }
  }

  async function handleShowDetail(id) {
    const { status, payload } = await news("GET", `/${encodeURIComponent(id)}`);
    if (status === 401) return sessionExpired();
    if (status !== 200) {
      state.notice = { type: "error", msg: "โหลดรายละเอียดไม่ได้" };
      renderDashboard();
      return;
    }
    showDetailModal(payload);
  }

  function showDetailModal(n) {
    const overlay = document.createElement("div");
    overlay.className = "admin-confirm-overlay";
    const fields = [
      ["ID", n.id],
      ["หัวข้อ (ไทย)", n.thaiTitle],
      ["หัวข้อ (ต้นฉบับ)", n.originalTitle],
      ["แหล่งข่าว", n.source],
      ["Source URL", n.sourceUrl],
      ["sourcePublishedAt", h.formatBangkok(n.sourcePublishedAt, { prefix: "" })],
      ["validationStatus", n.validationStatus],
      ["publishStatus", n.publishStatus],
      ["aiConfidence", n.aiConfidence],
      ["sourcePolicy", n.sourcePolicy],
      ["คำเตือนก่อนเผยแพร่", Array.isArray(n.aiValidation?.publishWarnings) && n.aiValidation.publishWarnings.length
        ? n.aiValidation.publishWarnings.join(" • ")
        : "ไม่มีคำเตือน"],
      ["pipelineNote", n.pipelineNote || "-"],
      ["createdAt", h.formatBangkok(n.createdAt, { prefix: "" })],
      ["publishedAt", n.publishedAt ? h.formatBangkok(n.publishedAt, { prefix: "" }) : "-"],
    ];
    overlay.innerHTML = `
      <div class="admin-confirm admin-confirm--wide" role="dialog" aria-modal="true">
        <div class="admin-confirm__title">รายละเอียดข่าว</div>
        ${renderImagePreviewBlock(n)}
        <div class="admin-detail">
          ${fields
            .map(
              ([k, v]) => `<div class="admin-detail__row">
              <div class="admin-detail__key">${h.esc(k)}</div>
              <div class="admin-detail__val">${h.esc(v === null || v === undefined ? "-" : String(v))}</div>
            </div>`
            )
            .join("")}
        </div>
        <div class="admin-confirm__actions">
          <button class="btn btn--ghost" type="button" data-act="close">ปิด</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      const refreshBtn = e.target.closest("[data-act='refresh-image']");
      if (refreshBtn) {
        const id = refreshBtn.dataset.id;
        overlay.remove();
        void handleRefreshImage(id);
        return;
      }
      if (e.target.closest("[data-act='close']") || e.target === overlay) overlay.remove();
    });
  }

  // ---------- Image Preview block (สำหรับ detail modal) ----------
  // แสดงรูปใหญ่ + ชื่อแหล่งที่มา + ช่างภาพ + ลิงก์ต้นฉบับ + เครดิต Pexels
  //        + สถานะรูป + imageReviewRequired + ปุ่มดึงรูปจาก Pexels ใหม่
  function renderImagePreviewBlock(n) {
    const url = n.imageUrl || "";
    const title = (n.thaiTitle || n.originalTitle || "ข่าว").slice(0, 120);
    const status = n.imageStatus || "-";
    const source = n.imageSource || (url ? "ไม่ระบุ" : "-");
    const photographer = n.imageAuthor || "-";
    const authorUrl = n.imageAuthorUrl || "";
    const sourceUrl = n.imageSourceUrl || "";
    const license = n.imageLicense || "-";
    const reviewRequired = !!n.imageReviewRequired;
    const keywords = Array.isArray(n.imageSearchKeywords) ? n.imageSearchKeywords : [];

    const isFallbackSvg = /^\/news-assets\//.test(url);
    const isPexels = !isFallbackSvg && (source === "Pexels" || /^https?:\/\/images\.pexels\.com\//.test(url));

    // เครดิต Pexels: "Photo by {photographer} on Pexels"
    let credit = "";
    if (isPexels && photographer && photographer !== "-") {
      credit = `Photo by ${photographer} on Pexels`;
    } else if (isFallbackSvg) {
      credit = "งานศิลปะโดย TraderToolsTH Design";
    } else if (source !== "-") {
      credit = `ภาพจาก ${source}`;
    }

    // ลิงก์ต้นฉบับ (Pexels photo page หรือ source url)
    const pexelsLink = isPexels && authorUrl && /^https?:\/\//.test(authorUrl)
      ? `<a href="${h.esc(authorUrl)}" target="_blank" rel="noopener noreferrer" class="admin-link">หน้าช่างภาพบน Pexels ↗</a>`
      : (sourceUrl && /^https?:\/\//.test(sourceUrl)
        ? `<a href="${h.esc(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="admin-link">ดูที่ต้นฉบับ ↗</a>`
        : "");

    // รูปใหญ่ พร้อม placeholder ถ้าโหลดไม่ได้
    // คลิกที่รูปเพื่อเปิดภาพต้นฉบับ (Pexels photo page หรือ source url)
    const clickHref = sourceUrl && /^https?:\/\//.test(sourceUrl)
      ? sourceUrl
      : (isPexels && authorUrl && /^https?:\/\//.test(authorUrl) ? authorUrl : url);
    const bigImg = url
      ? `${clickHref && /^https?:\/\//.test(clickHref) ? `<a href="${h.esc(clickHref)}" target="_blank" rel="noopener noreferrer" class="admin-preview-img-link" title="เปิดภาพต้นฉบับ">` : ""}
         <img class="admin-preview-img" src="${h.esc(url)}" alt="${h.esc(title)}" loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="admin-preview-ph" style="display:none" role="img" aria-label="รูปโหลดไม่ได้">
           <span>โหลดรูปไม่ได้</span>
         </div>
         ${clickHref && /^https?:\/\//.test(clickHref) ? "</a>" : ""}`
      : `<div class="admin-preview-ph" role="img" aria-label="ไม่มีรูป"><span>ไม่มีรูป</span></div>`;

    // status badge สีตามสถานะ
    const statusClass = status === "selected" ? "admin-badge--ok"
      : status === "fallback" ? "admin-badge--warn"
      : status === "failed" ? "admin-badge--err" : "";

    return `<div class="admin-preview">
      <div class="admin-preview__media">
        ${bigImg}
        ${reviewRequired ? '<span class="admin-preview-warn" title="ต้องตรวจรูป">⚠ ต้องตรวจรูป</span>' : ""}
      </div>
      <div class="admin-preview__meta">
        <div class="admin-preview__row">
          <span class="admin-detail__key">แหล่งรูป</span>
          <span><strong>${h.esc(source)}</strong>${isPexels ? ' <span class="admin-thumb-tag admin-thumb-tag--pexels">Pexels</span>' : ""}${isFallbackSvg ? ' <span class="admin-thumb-tag admin-thumb-tag--fallback">รูปสำรอง</span>' : ""}</span>
        </div>
        <div class="admin-preview__row">
          <span class="admin-detail__key">ช่างภาพ</span>
          <span>${h.esc(photographer)}${pexelsLink ? " · " + pexelsLink : ""}</span>
        </div>
        <div class="admin-preview__row">
          <span class="admin-detail__key">เครดิต</span>
          <span>${h.esc(credit || "-")}</span>
        </div>
        <div class="admin-preview__row">
          <span class="admin-detail__key">สถานะรูป</span>
          <span><span class="admin-badge ${statusClass}">${h.esc(status)}</span>${reviewRequired ? ' <span class="admin-badge admin-badge--warn">ต้องตรวจ</span>' : ""}</span>
        </div>
        <div class="admin-preview__row">
          <span class="admin-detail__key">imageReviewRequired</span>
          <span class="mono">${reviewRequired ? "true" : "false"}</span>
        </div>
        <div class="admin-preview__row">
          <span class="admin-detail__key">ลิขสิทธิ์</span>
          <span>${h.esc(license)}</span>
        </div>
        ${keywords.length ? `<div class="admin-preview__row"><span class="admin-detail__key">keyword</span><span class="mono" style="font-size:var(--fs-xs)">${keywords.map((k) => h.esc(k)).join(", ")}</span></div>` : ""}
        <div class="admin-preview__actions">
          <button class="btn btn--teal btn--sm" type="button" data-act="refresh-image" data-id="${h.esc(n.id)}" title="เปลี่ยนรูปเดิม — ค้น Pexels ใหม่อีกครั้ง (ใช้โควตา Pexels)">
            ${TT.icon ? TT.icon("refresh", 14) : ""} เปลี่ยนรูปเดิม (ดึง Pexels ใหม่)
          </button>
        </div>
      </div>
    </div>`;
  }

  // ---------- refresh image action ----------
  // flow: confirm (ใช้โควตา Pexels) → busyRows + disabled + "กำลังค้นหารูป..." →
  //       reload + อัปเดต Preview ทันทีเมื่อสำเร็จ
  // ป้องกันกดซ้อน: state.busyRows + backend ก็มี in-flight lock คืน 409
  async function handleRefreshImage(id) {
    // กันกดซ้อนฝั่ง frontend
    if (state.busyRows.has(id)) {
      state.notice = { type: "error", msg: "กำลังประมวลผลข่าวนี้อยู่แล้ว กรุณารอสักครู่" };
      renderDashboard();
      return;
    }
    // ขั้นต่อขั้นยืนยัน (เพราะใช้โควตา Pexels)
    const confirmed = await showConfirmDialog({
      title: "ดึงรูปจาก Pexels ใหม่?",
      message: "การดึงรูปใหม่จะเรียก Pexels API ซึ่งใช้โควตารายชั่วโมง และอาจเขียนทับรูปปัจจุบัน หาก Pexels ล้มเหลว ระบบจะเก็บรูปเดิมไว้ ต้องการดำเนินการต่อหรือไม่?",
      confirmLabel: "ดึงรูปใหม่",
      cancelLabel: "ยกเลิก",
      danger: false,
    });
    if (!confirmed) return;

    state.busyRows.add(id);
    // แสดง modal สถานะกำลังค้นหา
    showImageLoadingModal(id);

    try {
      const reviewer = state.reviewer || "admin";
      const { status, payload } = await news("POST", `/${encodeURIComponent(id)}/refresh-image`, {
        body: { reviewer },
      });
      if (status === 401) {
        closeImageLoadingModal();
        state.busyRows.delete(id);
        return sessionExpired();
      }
      if (status === 404) {
        closeImageLoadingModal();
        state.busyRows.delete(id);
        state.notice = { type: "error", msg: "ไม่พบข่าวนี้" };
        renderDashboard();
        return;
      }
      if (status === 400) {
        closeImageLoadingModal();
        state.busyRows.delete(id);
        state.notice = { type: "error", msg: "ต้องระบุชื่อผู้ตรวจ (reviewer)" };
        renderDashboard();
        return;
      }
      if (status === 409) {
        // backend บอกว่ากำลัง refresh อยู่แล้ว (กดซ้อน)
        closeImageLoadingModal();
        state.busyRows.delete(id);
        state.notice = { type: "info", msg: "ระบบกำลังดึงรูปข่าวนี้อยู่แล้ว กรุณารอสักครู่" };
        renderDashboard();
        return;
      }
      if (status === 502) {
        closeImageLoadingModal();
        state.busyRows.delete(id);
        const reason = payload.message || payload.error || "Pexels ตอบไม่ได้";
        showImageErrorModal(id, `ค้นหารูปไม่สำเร็จ: ${reason} (รูปเดิมยังคงอยู่)`);
        return;
      }
      if (status !== 200) {
        closeImageLoadingModal();
        state.busyRows.delete(id);
        const reason = payload.error || payload.message || `HTTP ${status}`;
        showImageErrorModal(id, `เกิดข้อผิดพลาด: ${reason}`);
        return;
      }
      // สำเร็จ — แยกกรณี keptPreviousImage (Pexels fail แต่เก็บรูปเดิม)
      closeImageLoadingModal();
      state.busyRows.delete(id);
      const keptOld = !!payload.keptPreviousImage;
      // reload ข่าวเพื่ออัปเดต preview + table
      const { status: st2, payload: detail } = await news("GET", `/${encodeURIComponent(id)}`);
      if (st2 === 200) {
        showDetailModal(detail);
      }
      if (keptOld) {
        state.notice = { type: "info", msg: "Pexels ไม่พร้อมใช้งาน ระบบเก็บรูปเดิมไว้ ลองอีกครั้งภายหลัง" };
      } else {
        state.notice = { type: "success", msg: "ดึงรูปใหม่สำเร็จแล้ว" };
      }
      // refresh table ทันที
      recordOperationResult("เปลี่ยนรูปข่าว", keptOld ? "info" : "success", state.notice?.msg || (keptOld ? "เก็บรูปเดิมไว้" : "ดึงรูปใหม่สำเร็จ"));
      await loadNews();
      renderDashboard();
    } catch (err) {
      closeImageLoadingModal();
      state.busyRows.delete(id);
      recordOperationResult("เปลี่ยนรูปข่าว", "error", `เชื่อมต่อระบบไม่ได้: ${err.message || err}`);
      showImageErrorModal(id, `เชื่อมต่อ server ไม่ได้: ${err.message || err}`);
    }
  }

  // ตัวช่วย modals สำหรับ refresh-image flow (loading + error + confirm)
  function showImageLoadingModal(id) {
    closeImageLoadingModal();
    const overlay = document.createElement("div");
    overlay.className = "admin-confirm-overlay";
    overlay.id = "adminImageLoadingOverlay";
    overlay.innerHTML = `
      <div class="admin-confirm" role="alertdialog" aria-modal="true" aria-busy="true">
        <div class="admin-confirm__title">กำลังค้นหารูป...</div>
        <div class="admin-detail" style="text-align:center;padding:20px 0">
          <div class="admin-spinner" aria-hidden="true"></div>
          <p style="margin-top:12px;color:var(--text-muted)">กำลังเรียก Pexels สำหรับข่าวนี้ (อาจใช้เวลา 10–30 วินาที)</p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  function closeImageLoadingModal() {
    const el = document.getElementById("adminImageLoadingOverlay");
    if (el) el.remove();
  }
  function showImageErrorModal(id, msg) {
    const overlay = document.createElement("div");
    overlay.className = "admin-confirm-overlay";
    overlay.innerHTML = `
      <div class="admin-confirm" role="alertdialog" aria-modal="true">
        <div class="admin-confirm__title">⚠️ ดึงรูปไม่สำเร็จ</div>
        <div class="admin-detail" style="padding:12px 0">
          <p style="color:var(--text-secondary);word-break:break-word">${h.esc(msg)}</p>
          <p style="margin-top:8px;font-size:var(--fs-xs);color:var(--text-muted)">คุณสามารถลองอีกครั้งได้ หรือใช้รูปสำรองชั่วคราว</p>
        </div>
        <div class="admin-confirm__actions">
          <button class="btn btn--ghost" type="button" data-act="close">ปิด</button>
          <button class="btn btn--primary" type="button" data-act="retry">ลองอีกครั้ง</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target.closest("[data-act='retry']")) {
        overlay.remove();
        void handleRefreshImage(id);
        return;
      }
      if (e.target.closest("[data-act='close']") || e.target === overlay) overlay.remove();
    });
  }

  // generic confirm dialog ที่คืน Promise<boolean>
  function showConfirmDialog({ title, message, confirmLabel = "ยืนยัน", cancelLabel = "ยกเลิก", danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "admin-confirm-overlay";
      overlay.innerHTML = `
        <div class="admin-confirm" role="dialog" aria-modal="true">
          <div class="admin-confirm__title">${h.esc(title)}</div>
          <div class="admin-detail" style="padding:12px 0">
            <p style="color:var(--text-secondary);word-break:break-word">${h.esc(message)}</p>
          </div>
          <div class="admin-confirm__actions">
            <button class="btn btn--ghost" type="button" data-act="cancel">${h.esc(cancelLabel)}</button>
            <button class="btn ${danger ? "btn--soft" : "btn--primary"}" type="button" data-act="confirm">${h.esc(confirmLabel)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const done = (val) => {
        overlay.remove();
        resolve(val);
      };
      overlay.addEventListener("click", (e) => {
        if (e.target.closest("[data-act='confirm']")) return done(true);
        if (e.target.closest("[data-act='cancel']") || e.target === overlay) return done(false);
      });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") return done(false);
        if (e.key === "Enter") return done(true);
      });
    });
  }

  // ---------- Review Modal ----------
  let reviewState = null; // { id, item, form }

  async function handleOpenReview(id) {
    const { status, payload } = await news("GET", `/${encodeURIComponent(id)}`);
    if (status === 401) return sessionExpired();
    if (status !== 200) {
      state.notice = { type: "error", msg: "โหลดข่าวสำหรับแก้ไขไม่ได้" };
      renderDashboard();
      return;
    }
    reviewState = {
      id,
      item: payload,
      form: {
        thaiTitle: payload.thaiTitle || "",
        thaiSummary: payload.thaiSummary || "",
        thaiContent: Array.isArray(payload.thaiContent) ? payload.thaiContent.join("\n\n") : "",
        marketFactors: payload.marketFactors || "",
        keyFacts: Array.isArray(payload.keyFacts) ? payload.keyFacts.join("\n") : "",
        impact: payload.marketFactors || "",
      },
    };
    showReviewModal();
  }

  function showReviewModal() {
    if (!reviewState) return;
    const rs = reviewState;
    const overlay = document.createElement("div");
    overlay.className = "admin-confirm-overlay";
    overlay.innerHTML = `
      <div class="admin-confirm admin-confirm--wide" role="dialog" aria-modal="true">
        <div class="admin-confirm__title">ตรวจทานและแก้ไขข่าว</div>
        <div class="admin-review">
          <div class="admin-review__col">
            <div class="admin-review__label">ต้นฉบับ (อังกฤษ)</div>
            <div class="admin-review__orig-title">${h.esc(rs.item.originalTitle || "-")}</div>
            <div class="admin-review__orig-body">${h.esc((rs.item.originalContent || "").slice(0, 1200))}${(rs.item.originalContent || "").length > 1200 ? "…" : ""}</div>
          </div>
          <div class="admin-review__col">
            <div class="admin-review__label">ฉบับแก้ไข (ไทย)</div>
            <label class="admin-login__label">หัวข้อ</label>
            <textarea class="admin-login__input" id="rvTitle" rows="2">${h.esc(rs.form.thaiTitle)}</textarea>
            <label class="admin-login__label">สรุป</label>
            <textarea class="admin-login__input" id="rvSummary" rows="2">${h.esc(rs.form.thaiSummary)}</textarea>
            <label class="admin-login__label">เนื้อหา (คั่นย่อหน้าด้วยบรรทัดว่าง)</label>
            <textarea class="admin-login__input" id="rvContent" rows="6">${h.esc(rs.form.thaiContent)}</textarea>
            <label class="admin-login__label">ปัจจัยตลาด</label>
            <input class="admin-login__input" id="rvFactors" value="${h.esc(rs.form.marketFactors)}">
            <label class="admin-login__label">ข้อเท็จจริงสำคัญ (บรรทัดละข้อ)</label>
            <textarea class="admin-login__input" id="rvFacts" rows="3">${h.esc(rs.form.keyFacts)}</textarea>
          </div>
        </div>
        <div class="admin-review__notice" id="rvNotice"></div>
        <div class="admin-review__check">
          <label><input type="checkbox" id="rvSourceChecked"> ยืนยันว่าตรวจเทียบกับแหล่งข่าวต้นฉบับแล้ว</label>
        </div>
        <div class="admin-confirm__actions">
          <button class="btn btn--ghost" type="button" data-act="cancel">ยกเลิก</button>
          <button class="btn btn--teal" type="button" id="rvSubmitBtn" data-act="submit">บันทึกการตรวจทาน</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", async (e) => {
      if (e.target === overlay || e.target.closest("[data-act='cancel']")) {
        overlay.remove();
        reviewState = null;
        return;
      }
      const submitBtn = e.target.closest("[data-act='submit']");
      if (!submitBtn) return;
      e.preventDefault();
      await submitReview(overlay);
    });
  }

  async function submitReview(overlay) {
    const rs = reviewState;
    if (!rs) return;
    const reviewer = state.reviewer.trim();
    const sourceChecked = document.getElementById("rvSourceChecked").checked;
    const noticeEl = document.getElementById("rvNotice");
    if (!reviewer) {
      if (noticeEl) noticeEl.innerHTML = `<div class="admin-notice admin-notice--error">กรุณากรอกชื่อผู้ตรวจทานด้านบน</div>`;
      return;
    }
    if (!sourceChecked) {
      if (noticeEl) noticeEl.innerHTML = `<div class="admin-notice admin-notice--error">ต้องยืนยันว่าตรวจเทียบต้นฉบับแล้ว</div>`;
      return;
    }
    const thaiContent = document.getElementById("rvContent").value
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const reviewed = {
      thaiTitle: document.getElementById("rvTitle").value.trim(),
      thaiSummary: document.getElementById("rvSummary").value.trim(),
      thaiContent,
      marketFactors: document.getElementById("rvFactors").value.trim(),
      keyFacts: document
        .getElementById("rvFacts")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      mentionedNumbers: rs.item.mentionedNumbers || [],
      imageSearchKeywords: rs.item.imageSearchKeywords || [],
      credit: rs.item.credit,
    };
    if (!reviewed.thaiTitle || !reviewed.thaiContent.length) {
      if (noticeEl) noticeEl.innerHTML = `<div class="admin-notice admin-notice--error">ต้องมีหัวข้อและเนื้อหา</div>`;
      return;
    }

    const submitBtn = document.getElementById("rvSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "กำลังบันทึก...";
    }
    const { status, payload } = await news("POST", `/${encodeURIComponent(rs.id)}/review`, {
      body: { sourceChecked: true, reviewer, news: reviewed },
    });
    if (status === 200) {
      overlay.remove();
      reviewState = null;
      const warningCount = Array.isArray(payload.publishWarnings) ? payload.publishWarnings.length : 0;
      state.notice = {
        type: warningCount ? "info" : "success",
        msg: payload.publishStatus === "published"
          ? `บันทึกการแก้ไขแล้ว — ข่าวยังเผยแพร่อยู่${warningCount ? ` · มีคำเตือน ${warningCount} จุด` : ""}`
          : `บันทึกการตรวจทานแล้ว — สถานะเป็น validated/ready${warningCount ? ` · มีคำเตือน ${warningCount} จุด` : ""}`,
      };
      showToast(state.notice.type, state.notice.msg);
      await loadAllAndRender();
    } else if (status === 401) {
      overlay.remove();
      reviewState = null;
      return sessionExpired();
    } else if (status === 409 && payload.localCheck) {
      // deterministic_quality_gate — แสดงเหตุผล (numbers/banned/advice)
      const lc = payload.localCheck;
      const reasons = [];
      if (lc.bannedWords && lc.bannedWords.length) reasons.push("คำต้องห้าม: " + lc.bannedWords.join(", "));
      if (lc.adviceWords && lc.adviceWords.length) reasons.push("คำแนะนำลงทุน: " + lc.adviceWords.join(", "));
      if (lc.hasUnexpectedNumbers) reasons.push("มีตัวเลขที่ไม่อยู่ในต้นฉบับ: " + (lc.numberCheck?.unexpected || []).join(", "));
      if (noticeEl)
        noticeEl.innerHTML = `<div class="admin-notice admin-notice--error">ไม่ผ่าน Quality Gate: ${h.esc(reasons.join(" • ") || payload.error)}</div>`;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "บันทึกการตรวจทาน";
      }
    } else {
      if (noticeEl) noticeEl.innerHTML = `<div class="admin-notice admin-notice--error">${h.esc(payload.error || "บันทึกไม่สำเร็จ")}</div>`;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "บันทึกการตรวจทาน";
      }
    }
  }

  async function withRowLock(id, fn) {
    if (state.busyRows.has(id)) return;
    if (!beginOperation(
      `news-row-${id}`,
      "ดำเนินการกับข่าว",
      "กำลังส่งคำสั่ง ตรวจเงื่อนไข และบันทึกสถานะข่าวรายการนี้",
      null,
      null
    )) return;
    state.busyRows.add(id);
    setRowBusy(id, "กำลังทำงาน...");
    try {
      await fn();
      const result = state.notice || { type: "success", msg: "ดำเนินการกับข่าวเสร็จแล้ว" };
      finishOperation(result.type || "success", result.msg || "ดำเนินการกับข่าวเสร็จแล้ว");
    } catch (err) {
      finishOperation("error", `ดำเนินการไม่สำเร็จ: ${err.message || err}`);
    } finally {
      state.busyRows.delete(id);
      if (state.authenticated) renderDashboard();
    }
  }

  async function handleApprove(id) {
    await withRowLock(id, async () => {
      const { status, payload } = await news("POST", `/${encodeURIComponent(id)}/approve`, { body: {} });
      if (status === 200) state.notice = { type: "success", msg: "อนุมัติแล้ว — สถานะ ready" };
      else if (status === 401) return sessionExpired();
      else if (status === 409) state.notice = { type: "error", msg: payload.error === "quality_validation_required" ? "ต้องตรวจทาน (review) ให้ validated ก่อน" : payload.error };
      else state.notice = { type: "error", msg: payload.error || "อนุมัติไม่สำเร็จ" };
      await loadAllAndRender();
    });
  }

  async function handleReject(id) {
    showConfirm({
      title: "ปฏิเสธข่าว",
      body: "ยืนยันการปฏิเสธข่าวนี้? สถานะจะเป็น rejected",
      confirmLabel: "ปฏิเสธ",
      confirmClass: "btn--soft",
      onConfirm: async () => {
        await withRowLock(id, async () => {
          const { status, payload } = await news("POST", `/${encodeURIComponent(id)}/reject`, {
            body: { reviewer: state.reviewer.trim() || "admin" },
          });
          if (status === 200) state.notice = { type: "info", msg: "ปฏิเสธข่าวแล้ว" };
          else if (status === 401) return sessionExpired();
          else state.notice = { type: "error", msg: payload.error || "ปฏิเสธไม่สำเร็จ" };
          await loadAllAndRender();
        });
      },
    });
  }

  async function handlePublish(id) {
    showConfirm({
      title: "เผยแพร่ข่าว",
      body: "ยืนยันการเผยแพร่? ระบบจะตรวจ Safety Gate ทั้ง 16 ข้ออีกครั้งฝั่ง backend",
      confirmLabel: "เผยแพร่",
      confirmClass: "btn--primary",
      onConfirm: async () => {
        await withRowLock(id, async () => {
          const { status, payload } = await news("POST", `/${encodeURIComponent(id)}/publish`, { body: {} });
          if (status === 200) state.notice = { type: "success", msg: "เผยแพร่แล้ว" };
          else if (status === 401) return sessionExpired();
          else if (status === 409)
            state.notice = { type: "error", msg: payload.error === "publish_guard_rejected" ? "ไม่ผ่าน Safety Gate — ตรวจสถานะ validation/image/source" : payload.error };
          else state.notice = { type: "error", msg: payload.error || "เผยแพร่ไม่สำเร็จ" };
          await loadAllAndRender();
        });
      },
    });
  }

  // ---------- rollback (2-step confirm) ----------
  function handleRollbackTwoStep() {
    const now = Date.now();
    if (state.rollbackArmedAt && now - state.rollbackArmedAt < EMERGENCY_WINDOW_MS) {
      state.rollbackArmedAt = 0;
      void doRollback();
    } else {
      state.rollbackArmedAt = now;
      state.notice = { type: "info", msg: "Rollback จะยกเลิกการเผยแพร่ข่าวล่าสุด — กดอีกครั้งภายใน 5 วินาทีเพื่อยืนยัน" };
      renderDashboard();
      setTimeout(() => {
        if (state.rollbackArmedAt === now) {
          state.rollbackArmedAt = 0;
          if (state.authenticated) renderDashboard();
        }
      }, EMERGENCY_WINDOW_MS);
    }
  }

  async function doRollback() {
    if (!beginOperation("rollback", "Rollback ข่าวล่าสุด", "กำลังค้นหาข่าวที่เผยแพร่ล่าสุดและเปลี่ยนกลับเป็นสถานะพร้อมเผยแพร่", "adminRollbackBtn", "กำลัง Rollback...")) return;
    state.notice = null;
    const { status, payload } = await ap("POST", "/rollback", {
      body: { reviewer: state.reviewer.trim() || "admin" },
    });
    if (status === 200) {
      state.notice = { type: "success", msg: `Rollback แล้ว: "${(payload.title || "").slice(0, 50)}" กลับเป็น ready` };
    } else if (status === 401) {
      return sessionExpired();
    } else if (status === 403) {
      state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    } else if (status === 409) {
      state.notice = { type: "error", msg: payload.error === "no_published_news" ? "ไม่มีข่าว published ให้ rollback" : payload.error };
    } else {
      state.notice = { type: "error", msg: payload.error || "rollback ไม่สำเร็จ" };
    }
    finishOperation(state.notice?.type || "info", state.notice?.msg || "Rollback เสร็จแล้ว");
    await loadAllAndRender();
  }

  // ---------- Auto Pilot actions (from Phase 10) ----------
  async function handleEnable(s) {
    if (!state.enableConfirmedOnce) {
      showConfirm({
        title: "ยืนยันการเปิด Auto Pilot",
        body: "โหมดนี้จะเผยแพร่ข่าวอัตโนมัติโดยไม่รอคนตรวจสอบ ต้องการเปิดใช่หรือไม่",
        confirmLabel: "เปิด Auto Pilot",
        confirmClass: "btn--primary",
        onConfirm: async () => {
          state.enableConfirmedOnce = true;
          await doEnable();
        },
      });
      return;
    }
    await doEnable();
  }

  async function doEnable() {
    if (!beginOperation("enable-auto", "เปิด Auto Pilot", "กำลังตรวจ ENV, Emergency Stop และบันทึกสถานะเปิดใช้งาน", "adminEnableBtn", "กำลังเปิด...")) return;
    setBtnLoading("adminEnableBtn", "กำลังเปิด...");
    const { status, payload } = await ap("POST", "/enable");
    state.notice = null;
    if (status === 200) state.notice = { type: "success", msg: "เปิด Auto Pilot แล้ว" };
    else if (status === 409) {
      const map = {
        env_not_allowed: "Environment ไม่อนุญาตให้เปิด (AUTO_PILOT_ENABLED=false)",
        emergency_stop_active: "Emergency Stop ยังตั้งอยู่ — ล้างก่อนจึงจะเปิดได้",
      };
      state.notice = { type: "error", msg: map[payload.error] || "เปิดไม่ได้ในขณะนี้" };
    } else if (status === 403) state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    else if (status === 401) {
      state.activeOperation = null;
      return sessionExpired();
    }
    else state.notice = { type: "error", msg: payload.error || "เปิดไม่สำเร็จ" };
    finishOperation(state.notice?.type || "info", state.notice?.msg || "ตรวจสถานะ Auto Pilot แล้ว");
    await loadAllAndRender();
  }

  async function handleRunOnce() {
    if (!beginOperation("run-auto", "รัน Auto Pilot ตอนนี้", "กำลังส่งคำสั่งให้ระบบดึงข่าว ตรวจคุณภาพ ดึงรูป และเผยแพร่ข่าวที่ผ่าน Safety Gate", "adminRunBtn", "กำลังสั่งรัน...")) return;
    setBtnLoading("adminRunBtn", "กำลังสั่งรัน...");
    const { status, payload } = await ap("POST", "/run-once", { body: { maxPerRun: 3 } });
    state.notice = null;
    if (status === 202) {
      state.notice = payload.skipped
        ? { type: "info", msg: "Auto Pilot กำลังทำงานอยู่แล้ว" }
        : { type: "info", msg: "เริ่มรัน Auto Pilot แล้ว (ทำงานเบื้องหลัง)" };
    } else if (status === 409) state.notice = { type: "error", msg: "Auto Pilot ยังปิดอยู่ — เปิดก่อนจึงจะรันได้" };
    else if (status === 403) state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    else if (status === 401) return sessionExpired();
    else state.notice = { type: "error", msg: payload.error || "สั่งรันไม่สำเร็จ" };
    finishOperation(state.notice?.type || "info", state.notice?.msg || "ส่งคำสั่ง Auto Pilot แล้ว");
    await loadAllAndRender();
  }

  function handleEmergencyTwoStep() {
    const now = Date.now();
    if (state.emergencyArmedAt && now - state.emergencyArmedAt < EMERGENCY_WINDOW_MS) {
      state.emergencyArmedAt = 0;
      void apActionWithRefresh("POST", "/emergency-stop", "สั่ง Emergency Stop แล้ว — รอบปัจจุบันจะหยุดก่อนข่าวถัดไป");
    } else {
      state.emergencyArmedAt = now;
      state.notice = { type: "info", msg: "กด Emergency Stop อีกครั้งภายใน 5 วินาทีเพื่อยืนยัน" };
      renderDashboard();
      setTimeout(() => {
        if (state.emergencyArmedAt === now) {
          state.emergencyArmedAt = 0;
          if (state.authenticated) renderDashboard();
        }
      }, EMERGENCY_WINDOW_MS);
    }
  }

  async function apActionWithRefresh(method, path, successMsg) {
    const configByPath = {
      "/disable": ["disable-auto", "ปิด Auto Pilot", "กำลังหยุดการทำงานอัตโนมัติและบันทึกสถานะ", "adminDisableBtn", "กำลังปิด..."],
      "/emergency-stop": ["emergency-stop", "Emergency Stop", "กำลังส่งคำสั่งหยุดฉุกเฉิน ระบบจะหยุดก่อนประมวลผลข่าวถัดไป", "adminEmergencyBtn", "กำลังสั่งหยุด..."],
      "/clear-emergency": ["clear-emergency", "ล้าง Emergency Stop", "กำลังล้างสถานะหยุดฉุกเฉินและตรวจความพร้อมของระบบ", "adminClearEmgBtn", "กำลังล้าง..."],
    };
    const op = configByPath[path] || ["auto-action", "ดำเนินการ Auto Pilot", "กำลังส่งคำสั่งไปยังระบบ", null, null];
    if (!beginOperation(...op)) return;
    state.notice = null;
    const { status, payload } = await ap(method, path);
    if (status === 200) state.notice = { type: "success", msg: successMsg };
    else if (status === 403) state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    else if (status === 401) return sessionExpired();
    else state.notice = { type: "error", msg: payload.error || "ดำเนินการไม่สำเร็จ" };
    finishOperation(state.notice?.type || "info", state.notice?.msg || successMsg);
    await loadAllAndRender();
  }

  function sessionExpired() {
    state.activeOperation = null;
    state.authenticated = false;
    stopAutoRefresh();
    state.notice = { type: "info", msg: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };
    renderLogin();
  }

  // ---------- custom confirm dialog ----------
  function showConfirm({ title, body, confirmLabel, confirmClass, onConfirm }) {
    const overlay = document.createElement("div");
    overlay.className = "admin-confirm-overlay";
    overlay.innerHTML = `
      <div class="admin-confirm" role="dialog" aria-modal="true">
        <div class="admin-confirm__title">${h.esc(title)}</div>
        <div class="admin-confirm__body">${h.esc(body)}</div>
        <div class="admin-confirm__actions">
          <button class="btn btn--ghost" type="button" data-act="cancel">ยกเลิก</button>
          <button class="btn ${confirmClass}" type="button" data-act="confirm">${h.esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "cancel" || e.target === overlay) {
        overlay.remove();
      } else if (act === "confirm") {
        overlay.remove();
        void onConfirm();
      }
    });
  }

  // ---------- helpers ----------
  function setBtnLoading(id, label) {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = true;
      btn.dataset.state = "loading";
      btn.textContent = label;
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(() => {
      if (state.authenticated && !state.activeOperation) {
        void (async () => {
          await Promise.all([loadStatus(), loadCounts(), loadNews()]);
          // ไม่ re-render ระหว่าง user interaction — เฉพาะเมื่อไม่มี modal เปิดอยู่
          if (!document.querySelector(".admin-confirm-overlay")) {
            renderDashboard();
          }
        })();
      }
    }, REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  // ---------- boot ----------
  // ห้ามเปิด Auto Pilot เองตอนโหลด — เช็ค session แล้วแสดง login/dashboard เท่านั้น
  document.addEventListener("DOMContentLoaded", render);
})();
