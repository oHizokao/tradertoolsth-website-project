/* ============================================================
   Admin Content Management (Phase 14) — เพิ่มเติมจาก admin.js
   ------------------------------------------------------------
   กฎ safety (สอดคล้อง admin.js ตัวเดิม):
   - ห้ามเก็บ ADMIN_TOKEN ใน frontend (cookie HttpOnly จัดการฝั่ง backend)
   - ทุก fetch ใช้ credentials:"include" + same-origin (cookie ส่งอัตโนมัติ)
   - ไม่รื้อ admin.js ตัวเดิม — โหลดเป็น module แยก
   - ทำงานหลัง login (ใช้ session เดียวกับ auto-pilot)
   - ทุก state-changing ส่ง Origin อัตโนมัติ (same-origin fetch)
   ============================================================ */

(function () {
  const h = TT.h;

  const CONTENT_API = "/api/admin/content"; // content management endpoints
  const UPLOAD_EA = "/api/admin/content/upload/ea";
  const UPLOAD_IMAGE = "/api/admin/content/upload/image";

  const CONTENT_TYPES = [
    { key: "ea", label: "EA Products", repoKey: "ea" },
    { key: "articles", label: "บทความ Knowledge", repoKey: "article" },
    { key: "faq", label: "คำถามที่พบบ่อย (FAQ)", repoKey: "faq" },
    { key: "brokers", label: "รีวิวโบรกเกอร์", repoKey: "broker" },
  ];

  const state = {
    open: false,
    activeType: "ea",
    items: [],
    counts: null,
    loading: false,
    notice: null,
    editing: null, // { id? } สำหรับ edit modal
    submissions: [],
    submissionsLoading: false,
  };

  /* ---------- fetch helpers (cookie + same-origin เสมอ) ---------- */
  async function content(method, path, opts = {}) {
    const init = {
      method,
      headers: { "content-type": "application/json" },
      credentials: "include",
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return doFetch(CONTENT_API + path, init);
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

  /* ---------- open/close manager ---------- */
  function open() {
    state.open = true;
    state.activeType = "ea";
    state.notice = null;
    render();
    void loadCounts();
    void loadList();
    void loadEaSubmissions();
  }

  function close() {
    state.open = false;
    state.editing = null;
    render();
    // re-render parent dashboard (admin.js)
    const evt = new CustomEvent("tt:admin-content-close");
    document.dispatchEvent(evt);
  }

  /* ---------- data load ---------- */
  async function loadCounts() {
    try {
      const { status, payload } = await content("GET", "/counts");
      if (status === 401) return sessionExpired();
      if (status === 200) state.counts = payload;
    } catch {
      /* keep last */
    }
  }

  async function loadList() {
    state.loading = true;
    render();
    try {
      const { status, payload } = await content("GET", "/" + state.activeType + "?limit=200");
      if (status === 401) return sessionExpired();
      if (status === 200) state.items = Array.isArray(payload) ? payload : [];
      else state.notice = { type: "error", msg: "โหลดรายการไม่สำเร็จ" };
    } catch {
      state.notice = { type: "error", msg: "เครือข่ายผิดพลาด" };
    }
    state.loading = false;
    render();
  }

  async function loadEaSubmissions() {
    if (state.activeType !== "ea") return;
    state.submissionsLoading = true;
    render();
    try {
      const { status, payload } = await doFetch(
        "/api/admin/ea-submissions?status=pending_review&limit=100",
        { method: "GET", credentials: "include" }
      );
      if (status === 401) return sessionExpired();
      state.submissions = status === 200 && Array.isArray(payload) ? payload : [];
    } catch {
      state.submissions = [];
    }
    state.submissionsLoading = false;
    render();
  }

  function sessionExpired() {
    state.open = false;
    state.editing = null;
    const evt = new CustomEvent("tt:admin-session-expired");
    document.dispatchEvent(evt);
  }

  /* ---------- render root (overlay modal full screen) ---------- */
  function render() {
    let root = document.getElementById("adminContentRoot");
    if (!state.open) {
      if (root) root.remove();
      return;
    }
    if (!root) {
      root = document.createElement("div");
      root.id = "adminContentRoot";
      root.className = "admin-content-overlay";
      document.body.appendChild(root);
    }

    const typeCfg = CONTENT_TYPES.find((t) => t.key === state.activeType);
    root.innerHTML = `
      <div class="admin-content" role="dialog" aria-modal="true">
        <div class="admin-content__head">
          <div class="admin-content__title">จัดการเนื้อหาเว็บไซต์ (Content Management)</div>
          <button class="btn btn--ghost btn--sm" type="button" id="contentCloseBtn">ปิด</button>
        </div>
        ${state.notice ? `<div class="admin-notice admin-notice--${state.notice.type}">${h.esc(state.notice.msg)}</div>` : ""}

        <div class="admin-content__tabs">
          ${CONTENT_TYPES.map(
            (t) => `<button class="btn ${state.activeType === t.key ? "btn--primary" : "btn--ghost"} btn--sm" type="button" data-tab="${t.key}">${h.esc(t.label)}</button>`
          ).join("")}
        </div>

        <div class="admin-controls" style="margin-bottom:12px">
          <button class="btn btn--teal btn--sm" type="button" id="contentNewBtn">+ สร้างใหม่</button>
          <button class="btn btn--ghost btn--sm" type="button" id="contentRefreshBtn">รีเฟรช</button>
        </div>

        ${renderStats()}
        ${state.activeType === "ea" ? renderSubmissionQueue() : ""}
        ${renderTable(typeCfg)}
      </div>
    `;

    bindControls(typeCfg);
  }

  function renderStats() {
    if (!state.counts) return "";
    const c = state.counts[state.activeType] || { total: 0, byStatus: {} };
    const cards = [
      { label: "ทั้งหมด", value: c.total, cls: "" },
      { label: "เผยแพร่", value: (c.byStatus || {}).published || 0, cls: "ok" },
      { label: "ร่าง", value: (c.byStatus || {}).draft || 0, cls: "warn" },
    ];
    return `<div class="admin-stats" style="margin-bottom:12px">
      ${cards
        .map(
          (cc) => `<div class="admin-stat ${cc.cls}">
        <div class="admin-stat__label">${h.esc(cc.label)}</div>
        <div class="admin-stat__value">${cc.value}</div>
      </div>`
        )
        .join("")}
    </div>`;
  }

  function renderSubmissionQueue() {
    const items = state.submissions;
    return `<section class="admin-submissions" aria-labelledby="submissionQueueTitle">
      <div class="admin-submissions__head">
        <div>
          <h3 id="submissionQueueTitle">EA ที่ผู้ใช้ส่งมารอตรวจ</h3>
          <p>ตรวจข้อมูลและไฟล์ก่อนย้ายเข้าคลัง EA รายการที่ย้ายแล้วจะยังเป็นฉบับร่าง</p>
        </div>
        <span class="badge badge--${items.length ? "warn" : "ok"}">${items.length} รายการ</span>
      </div>
      ${state.submissionsLoading
        ? `<div class="state"><div class="state__title">กำลังโหลดรายการรอตรวจ...</div></div>`
        : items.length
        ? `<div class="admin-submissions__list">${items.map(renderSubmission).join("")}</div>`
        : `<div class="admin-submissions__empty">ไม่มี EA รอตรวจในขณะนี้</div>`}
    </section>`;
  }

  function renderSubmission(item) {
    const platform = String(item.platform || "").toUpperCase();
    const contact = item.contactEmail || item.contactName || "ไม่ระบุช่องทางติดต่อ";
    return `<article class="admin-submission-card">
      <div class="admin-submission-card__body">
        <div class="admin-submission-card__title">${h.esc(item.name || "EA ไม่มีชื่อ")}</div>
        <div class="admin-submission-card__meta">
          <span>${h.esc(platform || "ไม่ระบุแพลตฟอร์ม")}</span>
          <span>เวอร์ชัน ${h.esc(item.version || "-")}</span>
          <span>${h.esc(contact)}</span>
        </div>
        <details><summary>ดูรายละเอียด</summary><p>${h.esc(item.description || "-")}</p></details>
      </div>
      <div class="admin-submission-card__actions">
        <button class="btn btn--primary btn--sm" type="button" data-sub-act="migrate" data-sub-id="${h.esc(item.id)}">รับเข้าคลังเป็นฉบับร่าง</button>
        <button class="btn btn--ghost btn--sm" type="button" data-sub-act="reject" data-sub-id="${h.esc(item.id)}">ปฏิเสธ</button>
      </div>
    </article>`;
  }

  function renderTable(typeCfg) {
    if (state.loading) {
      return `<div class="state"><div class="state__title">กำลังโหลด...</div></div>`;
    }
    if (!state.items.length) {
      return `<div class="state"><div class="state__title">ยังไม่มีรายการ</div></div>`;
    }
    const titleKey = typeCfg.repoKey === "faq" ? "question" : "name" in state.items[0] ? "name" : "title";
    const slugKey = "slug";
    return `
      <table class="admin-news-table">
        <thead>
          <tr>
            <th>${typeCfg.repoKey === "faq" ? "คำถาม" : "ชื่อ/ชื่อเรื่อง"}</th>
            <th>Slug</th>
            <th>สถานะ</th>
            <th>สร้างเมื่อ</th>
            <th>การจัดการ</th>
          </tr>
        </thead>
        <tbody>
          ${state.items.map((it) => renderRow(it, titleKey, slugKey)).join("")}
        </tbody>
      </table>
    `;
  }

  function renderRow(it, titleKey, slugKey) {
    const title = it[titleKey] || it.question || it.name || it.title || "-";
    const slug = it[slugKey] || "-";
    const status = it.status || "-";
    const created = h.formatBangkok(it.createdAt, { prefix: "" }) || "-";
    return `<tr>
      <td class="admin-news__title">${h.esc(String(title).slice(0, 80))}${String(title).length > 80 ? "…" : ""}</td>
      <td class="mono" style="font-size:var(--fs-xs)">${h.esc(slug)}</td>
      <td><span class="admin-badge admin-badge--${statusBadge(status)}">${h.esc(statusLabel(status))}</span></td>
      <td class="mono" style="font-size:var(--fs-xs)">${h.esc(created)}</td>
      <td class="admin-news__actions">
        <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${h.esc(it.id)}">แก้ไข</button>
        ${status === "draft"
          ? `<button class="btn btn--primary btn--sm" data-act="publish" data-id="${h.esc(it.id)}">เผยแพร่</button>`
          : `<button class="btn btn--soft btn--sm" data-act="unpublish" data-id="${h.esc(it.id)}">เลิกเผยแพร่</button>`}
        <button class="btn btn--ghost btn--sm" data-act="delete" data-id="${h.esc(it.id)}" style="color:var(--sell)">ลบ</button>
      </td>
    </tr>`;
  }

  function statusBadge(s) {
    return { published: "ok", draft: "warn" }[s] || "";
  }
  function statusLabel(s) {
    return { published: "เผยแพร่แล้ว", draft: "ร่าง" }[s] || s;
  }

  /* ---------- controls ---------- */
  function bindControls(typeCfg) {
    const closeBtn = document.getElementById("contentCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", close);

    root().querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeType = btn.dataset.tab;
        state.notice = null;
        void loadList();
        if (state.activeType === "ea") void loadEaSubmissions();
      });
    });

    const newBtn = document.getElementById("contentNewBtn");
    if (newBtn) newBtn.addEventListener("click", () => openEditor(typeCfg, null));

    const refreshBtn = document.getElementById("contentRefreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => { void loadCounts(); void loadList(); });

    root().querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        if (act === "edit") {
          const item = state.items.find((x) => x.id === id);
          openEditor(typeCfg, item);
        } else if (act === "publish") void doAction(id, "publish");
        else if (act === "unpublish") void doAction(id, "unpublish");
        else if (act === "delete") void doDelete(id);
      });
    });

    root().querySelectorAll("[data-sub-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void reviewSubmission(btn.dataset.subId, btn.dataset.subAct);
      });
    });
  }

  function root() {
    return document.getElementById("adminContentRoot");
  }

  async function doAction(id, action) {
    state.notice = null;
    const { status, payload } = await content("POST", `/${state.activeType}/${id}/${action}`);
    if (status === 401) return sessionExpired();
    if (status === 403) state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
    else if (status === 409) state.notice = { type: "error", msg: payload.missing ? `ยังขาดฟิลด์ที่จำเป็น: ${payload.missing.join(", ")}` : (payload.error || "ไม่ผ่านเงื่อนไข") };
    else if (status === 200) state.notice = { type: "success", msg: action === "publish" ? "เผยแพร่แล้ว" : "เลิกเผยแพร่แล้ว" };
    else state.notice = { type: "error", msg: payload.error || "ดำเนินการไม่สำเร็จ" };
    void loadCounts();
    void loadList();
  }

  async function reviewSubmission(id, action) {
    if (!id || !["migrate", "reject"].includes(action)) return;
    let notes = "";
    if (action === "migrate") {
      if (!window.confirm("รับ EA รายการนี้เข้าคลังเป็นฉบับร่างใช่หรือไม่?")) return;
    } else {
      notes = window.prompt("ระบุเหตุผลที่ปฏิเสธ (ไม่บังคับ)", "") || "";
      if (!window.confirm("ยืนยันการปฏิเสธ EA รายการนี้?")) return;
    }
    state.notice = null;
    try {
      const { status, payload } = await doFetch(
        `/api/admin/ea-submissions/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(action === "reject" ? { reason: notes } : { notes }),
        }
      );
      if (status === 401) return sessionExpired();
      if (status === 200) {
        state.notice = {
          type: "success",
          msg: action === "migrate"
            ? "รับ EA เข้าคลังเป็นฉบับร่างแล้ว กรุณาตรวจและกดเผยแพร่เมื่อพร้อม"
            : "ปฏิเสธรายการแล้ว",
        };
        await Promise.all([loadCounts(), loadList(), loadEaSubmissions()]);
        return;
      }
      state.notice = { type: "error", msg: payload.error || "ตรวจรายการไม่สำเร็จ" };
    } catch (err) {
      state.notice = { type: "error", msg: "เครือข่ายผิดพลาด: " + err.message };
    }
    render();
  }

  async function doDelete(id) {
    if (!confirm("ต้องการลบรายการนี้ใช่หรือไม่? (ไม่สามารถย้อนกลับได้)")) return;
    state.notice = null;
    const { status, payload } = await content("DELETE", `/${state.activeType}/${id}`);
    if (status === 401) return sessionExpired();
    if (status === 200) state.notice = { type: "success", msg: "ลบแล้ว" };
    else state.notice = { type: "error", msg: payload.error || "ลบไม่สำเร็จ" };
    void loadCounts();
    void loadList();
  }

  /* ---------- editor (create/update modal) ---------- */
  function openEditor(typeCfg, item) {
    state.editing = item ? { id: item.id } : null;
    const isNew = !item;
    const overlay = document.createElement("div");
    overlay.className = "admin-confirm-overlay";
    overlay.innerHTML = `
      <div class="admin-content-editor" role="dialog" aria-modal="true">
        <div class="admin-confirm__title">${isNew ? "สร้าง" : "แก้ไข"} ${h.esc(typeCfg.label)}</div>
        <div class="admin-content-editor__body" id="editorBody">
          ${renderEditorForm(typeCfg, item)}
        </div>
        <div class="admin-confirm__actions">
          <button class="btn btn--ghost" type="button" data-act="cancel">ยกเลิก</button>
          <button class="btn btn--primary" type="button" data-act="save">${isNew ? "สร้าง" : "บันทึก"}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "cancel" || e.target === overlay) {
        overlay.remove();
        state.editing = null;
      } else if (act === "save") {
        const body = collectForm(typeCfg, overlay);
        if (!body) return; // validation error shown inside
        await saveItem(typeCfg, item, body, overlay);
      } else if (act === "upload-ea") {
        await handleUpload(overlay, "ea");
      } else if (act === "upload-image") {
        await handleUpload(overlay, "image");
      }
    });
  }

  function renderEditorForm(typeCfg, item) {
    const v = (key, fallback = "") => (item && item[key] != null ? item[key] : fallback);
    const isFaq = typeCfg.repoKey === "faq";

    // common fields
    let fields = "";
    if (!isFaq) {
      fields += textInput("slug", "Slug (url)", v("slug"), "ตัวอักษร a-z 0-9 และขีดกลางเท่านั้น");
    }
    if (typeCfg.repoKey === "ea") {
      fields += textInput("name", "ชื่อ EA *", v("name"));
      fields += textArea("description", "คำอธิบาย", v("description"));
      fields += textInput("version", "เวอร์ชัน *", v("version"));
      fields += selectInput("platform", "Platform *", v("platform", "mt5"), [["mt4", "MT4"], ["mt5", "MT5"], ["both", "MT4 + MT5"]]);
      fields += numberInput("price", "ราคา (USD) *", v("price", 0), 0, 1000000, 0.01);
      fields += selectInput("type", "ประเภท *", v("type", "free"), [["free", "ฟรี"], ["paid", "ขาย"]]);
      fields += fileRow("filePath", "ไฟล์ EA (.ex4/.ex5/.set/.zip)", v("filePath"), "upload-ea", "เลือกไฟล์ EA");
      fields += fileRow("coverImage", "รูปปก (.png/.jpg/.webp)", v("coverImage"), "upload-image", "เลือกรูปปก");
    } else if (typeCfg.repoKey === "article") {
      fields += textInput("title", "หัวข้อ *", v("title"));
      fields += textArea("excerpt", "เกริ่นนำ (excerpt)", v("excerpt"));
      fields += textArea("body", "เนื้อหา (JSON array ของ blocks)", JSON.stringify(v("body", []), null, 2), "รูปแบบ: [{\"type\":\"p\",\"text\":\"...\"},{\"type\":\"h2\",\"text\":\"...\"},{\"type\":\"ul\",\"items\":[\"...\"]}]");
      fields += textInput("category", "หมวดหมู่", v("category"));
      fields += numberInput("readMinutes", "เวลาอ่าน (นาที)", v("readMinutes", 0), 0, 600, 1);
      fields += fileRow("coverImage", "รูปปก", v("coverImage"), "upload-image", "เลือกรูปปก");
    } else if (typeCfg.repoKey === "faq") {
      fields += textInput("question", "คำถาม *", v("question"));
      fields += textArea("answer", "คำตอบ *", v("answer"));
      fields += textInput("category", "หมวดหมู่", v("category"));
    } else if (typeCfg.repoKey === "broker") {
      fields += textInput("name", "ชื่อโบรกเกอร์ *", v("name"));
      fields += textInput("shortName", "ชื่อย่อ", v("shortName"));
      fields += textArea("overview", "ภาพรวม", v("overview"));
      fields += numberInput("rating", "คะแนนดาว (0-5)", v("rating", 0), 0, 5, 0.1);
      fields += numberInput("score", "คะแนนรวม (0-100)", v("score", 0), 0, 100, 0.1);
      fields += textInput("logoColor", "สีโลโก้ (hex)", v("logoColor"));
      fields += textInput("license", "ใบอนุญาต", v("license"));
      fields += textArea("regulation", "Regulation (JSON array)", JSON.stringify(v("regulation", [])));
      fields += textInput("spread", "Spread", v("spread"));
      fields += textInput("commission", "Commission", v("commission"));
      fields += textInput("depositWithdraw", "ฝาก-ถอน", v("depositWithdraw"));
      fields += textArea("platform", "Platform (JSON array)", JSON.stringify(v("platform", [])));
      fields += numberInput("minDeposit", "ฝากขั้นต่ำ (USD)", v("minDeposit", 0), 0, 1000000000, 1);
      fields += textArea("pros", "จุดเด่น (JSON array)", JSON.stringify(v("pros", [])));
      fields += textArea("cons", "ข้อควรพิจารณา (JSON array)", JSON.stringify(v("cons", [])));
      fields += textInput("suitableFor", "เหมาะกับ", v("suitableFor"));
      fields += textInput("referenceUrl", "ลิงก์อ้างอิง (https://)", v("referenceUrl"));
      fields += textInput("reviewedAt", "วันที่ตรวจสอบ (YYYY-MM-DD)", v("reviewedAt"));
      fields += fileRow("coverImage", "รูปปก", v("coverImage"), "upload-image", "เลือกรูปปก");
    }

    return `<div class="admin-content-editor__form">${fields}</div>`;
  }

  function textInput(name, label, value, hint = "") {
    return `<div class="admin-field">
      <label class="admin-login__label" for="f_${name}">${h.esc(label)}</label>
      <input class="admin-login__input" id="f_${name}" name="${name}" type="text" value="${h.esc(String(value ?? ""))}" autocomplete="off">
      ${hint ? `<p class="text-muted" style="font-size:var(--fs-xs);margin:2px 0 0">${h.esc(hint)}</p>` : ""}
    </div>`;
  }
  function numberInput(name, label, value, min, max, step) {
    return `<div class="admin-field">
      <label class="admin-login__label" for="f_${name}">${h.esc(label)}</label>
      <input class="admin-login__input" id="f_${name}" name="${name}" type="number" value="${h.esc(String(value ?? ""))}" min="${min}" max="${max}" step="${step}" autocomplete="off">
    </div>`;
  }
  function textArea(name, label, value, hint = "") {
    return `<div class="admin-field">
      <label class="admin-login__label" for="f_${name}">${h.esc(label)}</label>
      <textarea class="admin-login__input" id="f_${name}" name="${name}" rows="${name === "body" ? 8 : 3}" style="font-family:monospace;font-size:var(--fs-xs)">${h.esc(String(value ?? ""))}</textarea>
      ${hint ? `<p class="text-muted" style="font-size:var(--fs-xs);margin:2px 0 0">${h.esc(hint)}</p>` : ""}
    </div>`;
  }
  function selectInput(name, label, value, options) {
    return `<div class="admin-field">
      <label class="admin-login__label" for="f_${name}">${h.esc(label)}</label>
      <select class="admin-login__input" id="f_${name}" name="${name}">
        ${options.map(([val, lbl]) => `<option value="${h.esc(val)}" ${String(value) === String(val) ? "selected" : ""}>${h.esc(lbl)}</option>`).join("")}
      </select>
    </div>`;
  }
  function fileRow(name, label, currentPath, actBtn, btnLabel) {
    return `<div class="admin-field">
      <label class="admin-login__label">${h.esc(label)}</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <code class="mono" id="f_${name}" style="font-size:var(--fs-xs);flex:1;min-width:120px;padding:6px 8px;background:var(--surface-2);border-radius:6px">${h.esc(currentPath || "(ยังไม่มีไฟล์)")}</code>
        <button class="btn btn--teal btn--sm" type="button" data-act="${actBtn}" data-target="${name}">${h.esc(btnLabel)}</button>
      </div>
    </div>`;
  }

  function collectForm(typeCfg, overlay) {
    const body = {};
    overlay.querySelectorAll("[name]").forEach((el) => {
      const name = el.getAttribute("name");
      // file rows store value in <code> element with id f_<name>
      if (el.tagName === "CODE") {
        const txt = el.textContent.trim();
        body[name] = txt === "(ยังไม่มีไฟล์)" ? "" : txt;
        return;
      }
      if (el.tagName === "INPUT" && el.type === "number") {
        body[name] = el.value === "" ? 0 : Number(el.value);
      } else {
        body[name] = el.value;
      }
    });

    // parse JSON-array fields (regulation, platform, pros, cons, body)
    for (const key of ["regulation", "platform", "pros", "cons"]) {
      if (typeof body[key] === "string") {
        try {
          body[key] = JSON.parse(body[key]);
        } catch {
          body[key] = [];
        }
      }
    }
    if (typeCfg.repoKey === "article" && typeof body.body === "string") {
      try {
        body.body = JSON.parse(body.body);
      } catch {
        body.body = [];
      }
    }
    return body;
  }

  async function saveItem(typeCfg, item, body, overlay) {
    const path = item
      ? `/${state.activeType}/${item.id}`
      : `/${state.activeType}`;
    const method = item ? "PUT" : "POST";
    const { status, payload } = await content(method, path, { body });
    if (status === 401) { overlay.remove(); return sessionExpired(); }
    if (status === 403) {
      state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
      render();
      overlay.remove();
      return;
    }
    if (status >= 200 && status < 300) {
      state.notice = { type: "success", msg: item ? "บันทึกแล้ว" : "สร้างแล้ว" };
      overlay.remove();
      void loadCounts();
      void loadList();
    } else {
      // show error inside editor body
      const editorBody = overlay.querySelector("#editorBody");
      if (editorBody) {
        const errBox = editorBody.querySelector("#editorError");
        if (errBox) errBox.remove();
        const div = document.createElement("div");
        div.id = "editorError";
        div.className = "admin-notice admin-notice--error";
        div.style.marginTop = "8px";
        div.textContent = payload.details || payload.error || "บันทึกไม่สำเร็จ";
        editorBody.appendChild(div);
      }
    }
  }

  /* ---------- upload (multipart) ---------- */
  async function handleUpload(overlay, kind) {
    const input = document.createElement("input");
    input.type = "file";
    if (kind === "ea") {
      input.accept = ".ex4,.ex5,.set,.zip";
    } else {
      input.accept = ".png,.jpg,.jpeg,.webp";
    }
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file, file.name);
      const url = kind === "ea" ? UPLOAD_EA : UPLOAD_IMAGE;
      try {
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const payload = await res.json().catch(() => ({}));
        if (res.status === 401) { overlay.remove(); return sessionExpired(); }
        if (res.status === 403) {
          state.notice = { type: "error", msg: "ไม่อนุญาตให้เรียกจากแหล่งนี้" };
          return;
        }
        if (res.status >= 200 && res.status < 300 && payload.path) {
          // update the corresponding code field with the returned path
          const target = kind === "ea" ? "filePath" : "coverImage";
          const codeEl = overlay.querySelector("#f_" + target);
          if (codeEl) codeEl.textContent = payload.path;
          state.notice = { type: "success", msg: `อัปโหลดสำเร็จ (${payload.size} bytes)` };
        } else {
          state.notice = { type: "error", msg: payload.error || payload.message || "อัปโหลดไม่สำเร็จ" };
        }
      } catch (err) {
        state.notice = { type: "error", msg: "เครือข่ายผิดพลาด: " + err.message };
      }
    };
    input.click();
  }

  /* ---------- public API of module ---------- */
  TT.adminContent = { open, close };

  // listen for session expiry from admin.js
  document.addEventListener("tt:admin-session-expired", () => {
    state.open = false;
    state.editing = null;
    const r = document.getElementById("adminContentRoot");
    if (r) r.remove();
  });
})();
