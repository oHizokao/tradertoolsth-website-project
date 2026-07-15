/* ============================================================
   Admin Dashboard (Phase 10) — ควบคุม Auto Pilot
   ------------------------------------------------------------
   กฎ safety:
   - ห้ามเก็บ ADMIN_TOKEN ใน frontend (cookie HttpOnly จัดการฝั่ง backend)
   - อ่านสถานะจาก backend เสมอ (load + after action + auto-refresh)
   - ปุ่ม Run disabled ขณะ running
   - Emergency Stop ยืนยัน 2 ขั้น (click → กดอีกครั้งภายใน 5s)
   - เปิด Auto Pilot ครั้งแรกต้อง confirm เตือน auto-publish
   - ทุก fetch ใช้ credentials:"include" + same-origin (cookie ส่งอัตโนมัติ)
   - ไม่ bypass Safety Gate — publish อยู่ฝั่ง backend เท่านั้น
   ============================================================ */

(function () {
  const h = TT.h;

  const API = "/api/admin/auto-pilot";
  const REFRESH_MS = 10000; // auto-refresh สถานะทุก 10 วิ
  const EMERGENCY_WINDOW_MS = 5000; // หน้าต่างยืนยัน emergency 2 ขั้น

  const state = {
    authenticated: false,
    status: null,
    loading: false,
    notice: null, // { type: "error"|"info"|"success", msg }
    emergencyArmedAt: 0, // timestamp ที่กด emergency ครั้งแรก
    enableConfirmedOnce: false, // กด confirm เปิดครั้งแรกแล้วหรือยัง
    refreshTimer: null,
  };

  // ---------- fetch helper (cookie + same-origin เสมอ) ----------
  async function api(method, path, opts = {}) {
    const init = {
      method,
      headers: { "content-type": "application/json" },
      credentials: "include", // ส่ง cookie
      // same-origin: browser ตั้ง Origin อัตโนมัติ = หน้าเว็บ → ผ่าน CSRF check
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch(API + path, init);
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
    // เริ่มจากการเช็ค session
    void checkSessionAndRender();
  }

  async function checkSessionAndRender() {
    try {
      const { payload } = await api("GET", "/session");
      state.authenticated = !!payload.authenticated;
    } catch {
      state.authenticated = false;
    }
    if (state.authenticated) {
      await loadStatusAndRenderDashboard();
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
                ${TT.icon("shield", 22)} เข้าสู่ระบบผู้ดูแล
              </div>
              <p class="admin-login__desc">
                กรอก Admin Token เพื่อควบคุม Auto Pilot<br>
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
                  ${TT.icon("login", 18)} เข้าสู่ระบบ
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
          const { status, payload } = await api("POST", "/login", { body: { token } });
          if (status === 200) {
            state.authenticated = true;
            state.notice = null;
            await loadStatusAndRenderDashboard();
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

  // ---------- Dashboard ----------
  async function loadStatusAndRenderDashboard() {
    try {
      const { status, payload } = await api("GET", "/status");
      if (status === 401) {
        // session หมด → กลับหน้า login
        state.authenticated = false;
        stopAutoRefresh();
        state.notice = { type: "info", msg: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };
        renderLogin();
        return;
      }
      if (status === 200) {
        state.status = payload;
      }
    } catch {
      // keep last status; แสดง notice transient
    }
    renderDashboard();
  }

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
            <div class="admin-head__title">${TT.icon("gauge", 24)} Auto Pilot Dashboard</div>
            <button class="btn btn--ghost btn--sm" type="button" id="adminLogoutBtn">
              ${TT.icon("x", 16)} ออกจากระบบ
            </button>
          </div>

          ${state.notice ? renderNotice(state.notice) : ""}

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

          <h2 class="admin-section-title">${TT.icon("zap", 18)} การควบคุม</h2>
          <div class="admin-controls">
            <button class="btn btn--primary" type="button" id="adminEnableBtn"
                    ${s.enabled || emergency ? "disabled" : ""}>
              ${TT.icon("check", 16)} เปิด Auto Pilot
            </button>
            <button class="btn btn--ghost" type="button" id="adminDisableBtn"
                    ${!s.enabled ? "disabled" : ""}>
              ${TT.icon("x", 16)} ปิด Auto Pilot
            </button>
            <button class="btn btn--teal" type="button" id="adminRunBtn"
                    ${running || !s.enabled || emergency ? "disabled" : ""}>
              ${TT.icon("zap", 16)} รัน Auto Pilot ตอนนี้
            </button>
            <button class="btn btn--soft" type="button" id="adminEmergencyBtn"
                    style="${emergency ? "border-color:var(--sell);color:var(--sell)" : ""}"
                    ${emergency ? "disabled" : ""}>
              ${TT.icon("warning", 16)} ${state.emergencyArmedAt ? "กดอีกครั้งเพื่อยืนยัน" : "Emergency Stop"}
            </button>
            <button class="btn btn--ghost" type="button" id="adminClearEmgBtn"
                    ${!emergency ? "disabled" : ""}>
              ${TT.icon("check", 16)} Clear Emergency
            </button>
          </div>

          <h2 class="admin-section-title">${TT.icon("chart", 18)} Audit Log ล่าสุด</h2>
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

          <p class="text-muted" style="font-size:var(--fs-xs);margin-top:20px;line-height:1.6">
            ${TT.icon("shield", 14)} การตัดสินใจ publish อยู่ฝั่ง Backend เท่านั้น —
            หน้านี้เป็นเพียงตัวควบคุม ไม่สามารถ bypass Safety Gate ได้
          </p>
        </div>
      </section>
    `;

    bindDashboardControls(running, emergency, s);
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
    } else if (s.status === "idle") {
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
        await api("POST", "/logout").catch(() => {});
        state.authenticated = false;
        state.status = null;
        stopAutoRefresh();
        state.notice = { type: "info", msg: "ออกจากระบบแล้ว" };
        renderLogin();
      });
    }

    const enableBtn = document.getElementById("adminEnableBtn");
    if (enableBtn) {
      enableBtn.addEventListener("click", () => handleEnable(s));
    }

    const disableBtn = document.getElementById("adminDisableBtn");
    if (disableBtn) {
      disableBtn.addEventListener("click", () => void actionWithRefresh("POST", "/disable", "ปิด Auto Pilot แล้ว"));
    }

    const runBtn = document.getElementById("adminRunBtn");
    if (runBtn) {
      runBtn.addEventListener("click", () => void handleRunOnce());
    }

    const emergencyBtn = document.getElementById("adminEmergencyBtn");
    if (emergencyBtn) {
      emergencyBtn.addEventListener("click", () => handleEmergencyTwoStep());
    }

    const clearEmgBtn = document.getElementById("adminClearEmgBtn");
    if (clearEmgBtn) {
      clearEmgBtn.addEventListener("click", () => void actionWithRefresh("POST", "/clear-emergency", "ล้าง Emergency Stop แล้ว"));
    }
  }

  // เปิด Auto Pilot — confirm เตือน auto-publish ครั้งแรก
  async function handleEnable(s) {
    if (!state.enableConfirmedOnce) {
      showConfirm({
        title: `${TT.icon("warning", 20)} ยืนยันการเปิด Auto Pilot`,
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
    const { status, payload } = await api("POST", "/enable");
    state.notice = null;
    if (status === 200) {
      state.notice = { type: "success", msg: "เปิด Auto Pilot แล้ว" };
    } else if (status === 409) {
      const map = {
        env_not_allowed: "Environment ไม่อนุญาตให้เปิด (AUTO_PILOT_ENABLED=false)",
        emergency_stop_active: "Emergency Stop ยังตั้งอยู่ — ล้างก่อนจึงจะเปิดได้",
      };
      state.notice = { type: "error", msg: map[payload.error] || "เปิดไม่ได้ในขณะนี้" };
    } else if (status === 403) {
      state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    } else if (status === 401) {
      return sessionExpired();
    } else {
      state.notice = { type: "error", msg: payload.error || "เปิดไม่สำเร็จ" };
    }
    await loadStatusAndRenderDashboard();
  }

  async function handleRunOnce() {
    setBtnLoading("adminRunBtn", "กำลังสั่งรัน...");
    const { status, payload } = await api("POST", "/run-once", { body: { maxPerRun: 3 } });
    state.notice = null;
    if (status === 202) {
      if (payload.skipped) {
        state.notice = { type: "info", msg: "Auto Pilot กำลังทำงานอยู่แล้ว" };
      } else {
        state.notice = { type: "info", msg: "เริ่มรัน Auto Pilot แล้ว (ทำงานเบื้องหลัง)" };
      }
    } else if (status === 409) {
      state.notice = { type: "error", msg: "Auto Pilot ยังปิดอยู่ — เปิดก่อนจึงจะรันได้" };
    } else if (status === 403) {
      state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    } else if (status === 401) {
      return sessionExpired();
    } else {
      state.notice = { type: "error", msg: payload.error || "สั่งรันไม่สำเร็จ" };
    }
    await loadStatusAndRenderDashboard();
  }

  // Emergency Stop ยืนยัน 2 ขั้น (click → 5s window → click อีก)
  function handleEmergencyTwoStep() {
    const now = Date.now();
    if (state.emergencyArmedAt && now - state.emergencyArmedAt < EMERGENCY_WINDOW_MS) {
      // ขั้นที่ 2 — ยืนยันแล้ว
      state.emergencyArmedAt = 0;
      void actionWithRefresh("POST", "/emergency-stop", "สั่ง Emergency Stop แล้ว — รอบปัจจุบันจะหยุดก่อนข่าวถัดไป");
    } else {
      // ขั้นที่ 1 — arm
      state.emergencyArmedAt = now;
      state.notice = { type: "info", msg: "กด Emergency Stop อีกครั้งภายใน 5 วินาทีเพื่อยืนยัน" };
      renderDashboard();
      // auto-reset หลัง 5s
      setTimeout(() => {
        if (state.emergencyArmedAt === now) {
          state.emergencyArmedAt = 0;
          if (state.authenticated) renderDashboard();
        }
      }, EMERGENCY_WINDOW_MS);
    }
  }

  async function actionWithRefresh(method, path, successMsg) {
    state.notice = null;
    const { status, payload } = await api(method, path);
    if (status === 200) {
      state.notice = { type: "success", msg: successMsg };
    } else if (status === 403) {
      state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    } else if (status === 401) {
      return sessionExpired();
    } else {
      state.notice = { type: "error", msg: payload.error || "ดำเนินการไม่สำเร็จ" };
    }
    await loadStatusAndRenderDashboard();
  }

  function sessionExpired() {
    state.authenticated = false;
    stopAutoRefresh();
    state.notice = { type: "info", msg: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };
    renderLogin();
  }

  // ---------- custom confirm dialog (no native confirm) ----------
  function showConfirm({ title, body, confirmLabel, confirmClass, onConfirm }) {
    const overlay = document.createElement("div");
    overlay.className = "admin-confirm-overlay";
    overlay.innerHTML = `
      <div class="admin-confirm" role="dialog" aria-modal="true">
        <div class="admin-confirm__title">${title}</div>
        <div class="admin-confirm__body">${body}</div>
        <div class="admin-confirm__actions">
          <button class="btn btn--ghost" type="button" data-act="cancel">ยกเลิก</button>
          <button class="btn ${confirmClass}" type="button" data-act="confirm">${confirmLabel}</button>
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
      if (state.authenticated) void loadStatusAndRenderDashboard();
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
