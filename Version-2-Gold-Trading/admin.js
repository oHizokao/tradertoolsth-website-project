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
              <button class="btn btn--teal btn--sm" type="button" id="adminContentBtn">
                จัดการเนื้อหาเว็บไซต์
              </button>
              <button class="btn btn--ghost btn--sm" type="button" id="adminLogoutBtn">
                ออกจากระบบ
              </button>
            </div>
          </div>

          ${state.notice ? renderNotice(state.notice) : ""}

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
    const c = state.counts || {};
    const pub = (c.publishStatus) || {};
    const val = (c.validationStatus) || {};

    return `
      <div class="admin-news">
        ${renderStatsGrid(pub, val, c.total || 0)}

        <div class="admin-controls">
          <button class="btn btn--teal" type="button" id="adminFetchBtn">
            ดึงข่าวใหม่
          </button>
          <button class="btn btn--ghost" type="button" id="adminRefreshNewsBtn">
            รีเฟรชรายการ
          </button>
          <button class="btn btn--soft" type="button" id="adminRollbackBtn"
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
        </div>

        <div class="admin-news-table-wrap">
          ${renderNewsTable()}
        </div>
      </div>
    `;
  }

  function renderStatsGrid(pub, val, total) {
    const cards = [
      { label: "ทั้งหมด", value: total, cls: "" },
      { label: "เผยแพร่แล้ว", value: pub.published || 0, cls: "ok" },
      { label: "พร้อมเผยแพร่", value: pub.ready || 0, cls: "warn" },
      { label: "ร่าง/ดำเนินการ", value: (pub.draft || 0) + (pub.processing || 0), cls: "" },
      { label: "ปฏิเสธ", value: pub.rejected || 0, cls: "err" },
      { label: "ล้มเหลว", value: pub.failed || 0, cls: "err" },
    ];
    return `<div class="admin-stats">
      ${cards
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
    const publishBtn =
      n.publishStatus === "ready"
        ? `<button class="btn btn--primary btn--sm" data-act="publish" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>เผยแพร่</button>`
        : "";
    const approveBtn =
      n.validationStatus === "validated" && n.publishStatus !== "ready" && n.publishStatus !== "published"
        ? `<button class="btn btn--ghost btn--sm" data-act="approve" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>อนุมัติ</button>`
        : "";
    const reviewBtn =
      n.publishStatus !== "published" && n.publishStatus !== "rejected"
        ? `<button class="btn btn--teal btn--sm" data-act="review" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>แก้ไข/ตรวจ</button>`
        : "";
    const rejectBtn =
      n.publishStatus !== "rejected" && n.publishStatus !== "published"
        ? `<button class="btn btn--soft btn--sm" data-act="reject" data-id="${h.esc(n.id)}" ${busy ? "disabled" : ""}>ปฏิเสธ</button>`
        : "";
    const detailBtn = `<button class="btn btn--ghost btn--sm" data-act="detail" data-id="${h.esc(n.id)}">รายละเอียด</button>`;
    const sourceLink = n.sourceUrl
      ? `<a href="${h.esc(n.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="admin-link">${h.esc(n.sourceName || "ต้นฉบับ")} ↗</a>`
      : h.esc(n.sourceName || "-");

    return `<tr>
      <td class="admin-news__title" title="${h.esc(n.title || "")}">${h.esc((n.title || "-").slice(0, 80))}${(n.title || "").length > 80 ? "…" : ""}</td>
      <td>${sourceLink}</td>
      <td class="mono" style="font-size:var(--fs-xs)">${h.esc(h.formatBangkok(n.sourcePublishedAt, { prefix: "" }) || "-")}</td>
      <td><span class="admin-badge admin-badge--${badgeClass(n.publishStatus)}">${h.esc(STATUS_LABELS[n.publishStatus] || n.publishStatus || "-")}</span></td>
      <td><span class="admin-badge admin-badge--${valBadgeClass(n.validationStatus)}">${h.esc(STATUS_LABELS[n.validationStatus] || n.validationStatus || "-")}</span><br><span class="mono" style="font-size:var(--fs-xs)">conf ${n.aiConfidence ?? "-"}</span></td>
      <td>${h.esc(n.imageStatus || "-")}${n.imageReviewRequired ? ' <span style="color:var(--sell)">⚠</span>' : ""}</td>
      <td class="admin-news__actions">
        ${detailBtn}
        ${reviewBtn}
        ${approveBtn}
        ${publishBtn}
        ${rejectBtn}
      </td>
    </tr>`;
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
                ${s.enabled || emergency ? "disabled" : ""}>
          เปิด Auto Pilot
        </button>
        <button class="btn btn--ghost" type="button" id="adminDisableBtn"
                ${!s.enabled ? "disabled" : ""}>
          ปิด Auto Pilot
        </button>
        <button class="btn btn--teal" type="button" id="adminRunBtn"
                ${running || !s.enabled || emergency ? "disabled" : ""}>
          รัน Auto Pilot ตอนนี้
        </button>
        <button class="btn btn--soft" type="button" id="adminEmergencyBtn"
                style="${emergency ? "border-color:var(--sell);color:var(--sell)" : ""}"
                ${emergency ? "disabled" : ""}>
          ${state.emergencyArmedAt ? "กดอีกครั้งเพื่อยืนยัน" : "Emergency Stop"}
        </button>
        <button class="btn btn--ghost" type="button" id="adminClearEmgBtn"
                ${!emergency ? "disabled" : ""}>
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

  function renderNotice(notice) {
    return `<div class="admin-notice admin-notice--${notice.type}">${h.esc(notice.msg)}</div>`;
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
    const btn = document.getElementById("adminContentBtn");
    if (btn && window.TT && TT.adminContent) {
      btn.addEventListener("click", () => {
        TT.adminContent.open();
      });
    }
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
      fetchBtn.addEventListener("click", () => void handleFetchNews());
    }
    const refreshBtn = document.getElementById("adminRefreshNewsBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        state.notice = null;
        await loadCounts();
        await loadNews();
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

    // row action buttons (event delegation)
    const tableWrap = document.querySelector(".admin-news-table-wrap");
    if (tableWrap) {
      tableWrap.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        if (act === "detail") void handleShowDetail(id);
        else if (act === "review") void handleOpenReview(id);
        else if (act === "approve") void handleApprove(id);
        else if (act === "reject") void handleReject(id);
        else if (act === "publish") void handlePublish(id);
      });
    }
  }

  // ---------- news actions ----------
  async function handleFetchNews() {
    setBtnLoading("adminFetchBtn", "กำลังดึง...");
    state.notice = null;
    try {
      // POST /api/admin/run — manual news fetch (ไม่ auto-publish)
      const { status, payload } = await doFetch("/api/admin/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ maxPerRun: 3 }),
      });
      if (status === 202 || status === 200) {
        state.notice = { type: "success", msg: payload.skipped ? "มีการดึงข่าวอยู่แล้ว" : "เริ่มดึงข่าวแล้ว (อาจใช้เวลาสักครู่)" };
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
      ["imageStatus", n.imageStatus],
      ["imageReviewRequired", n.imageReviewRequired],
      ["sourcePolicy", n.sourcePolicy],
      ["createdAt", h.formatBangkok(n.createdAt, { prefix: "" })],
      ["publishedAt", n.publishedAt ? h.formatBangkok(n.publishedAt, { prefix: "" }) : "-"],
    ];
    overlay.innerHTML = `
      <div class="admin-confirm admin-confirm--wide" role="dialog" aria-modal="true">
        <div class="admin-confirm__title">รายละเอียดข่าว</div>
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
      if (e.target.closest("[data-act='close']") || e.target === overlay) overlay.remove();
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
      state.notice = { type: "success", msg: "บันทึกการตรวจทานแล้ว — สถานะเป็น validated/ready" };
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
    state.busyRows.add(id);
    try {
      await fn();
    } finally {
      state.busyRows.delete(id);
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
    else if (status === 401) return sessionExpired();
    else state.notice = { type: "error", msg: payload.error || "เปิดไม่สำเร็จ" };
    await loadAllAndRender();
  }

  async function handleRunOnce() {
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
    state.notice = null;
    const { status, payload } = await ap(method, path);
    if (status === 200) state.notice = { type: "success", msg: successMsg };
    else if (status === 403) state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    else if (status === 401) return sessionExpired();
    else state.notice = { type: "error", msg: payload.error || "ดำเนินการไม่สำเร็จ" };
    await loadAllAndRender();
  }

  function sessionExpired() {
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
      if (state.authenticated) {
        void (async () => {
          await loadStatus();
          await loadCounts();
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
