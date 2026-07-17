/* ============================================================
   Page — Forum topic detail (V2)
   ------------------------------------------------------------
   โครงสร้าง:
   - หัวกระทู้ (title + meta + author)
   - เนื้อหากระทู้ (floor 0 / OP) + actions (edit/delete/report)
   - รายการคำตอบ (floor 1, 2, ...) + pagination
   - ฟอร์มตอบกลับ
   - marketplace warning (ถ้าเป็นหมวด marketplace)

   กฎ:
   - ข้อมูลจาก API ทั้งหมด
   - textContent สำหรับทุก user content (XSS defense)
   - owner-only edit/delete (ส่ง token; backend ตรวจ)
   - state: loading / empty / error / not-found
   ============================================================ */

(function () {
  const h = TT.h;

  const state = {
    topicId: "",
    topic: null,
    posts: [],
    postOffset: 0,
    postLimit: 20,
    postTotal: 0,
    postHasMore: false,
    loading: false,
    replySubmitting: false,
    editing: null, // { type: 'topic'|'post', id }
  };

  async function init() {
    state.topicId = h.query("id") || "";
    renderShell();
    await loadAll();
  }

  function renderShell() {
    const main = `
      ${TT.layout.ticker()}
      <section class="page">
        <div class="container">
          <div id="forumDetail" aria-live="polite">
            <div class="skeleton" style="height:200px;border-radius:12px"></div>
          </div>
        </div>
      </section>
    `;
    document.getElementById("app").innerHTML = TT.layout.page({
      active: "forum",
      main,
    });
    TT.layout.initNavbar();
  }

  async function loadAll() {
    if (!state.topicId) return renderNotFound();
    try {
      const topic = await TT.ForumService.getTopic(state.topicId);
      state.topic = topic;
      document.title = `${topic.title} — ${TT.site.name} ฟอรัม`;
      await loadPosts(true);
      renderDetail();
    } catch (e) {
      if (e.message === "not_found") return renderNotFound();
      renderError("ไม่สามารถโหลดกระทู้", e.message || "");
    }
  }

  async function loadPosts(reset = false) {
    if (reset) {
      state.postOffset = 0;
      state.posts = [];
    }
    try {
      const result = await TT.ForumService.listPosts(state.topicId, {
        limit: state.postLimit,
        offset: state.postOffset,
      });
      state.postTotal = result.total || 0;
      state.postHasMore = !!result.hasMore;
      if (reset) state.posts = result.items;
      else state.posts = state.posts.concat(result.items);
    } catch {
      // ignore — posts เป็น optional
    }
  }

  /* ---------- render ---------- */
  function renderDetail() {
    const t = state.topic;
    const me = TT.ForumService.currentAuthor();
    const isOwner = me && me.id === t.authorId;
    const isMarket = t.isMarketplace || (t.category && t.category.isMarketplace);

    const detail = document.getElementById("forumDetail");
    if (!detail) return;

    detail.innerHTML = `
      <a class="forum-back" href="forum.html">← กลับไปยังฟอรัม</a>
      ${isMarket ? marketplaceWarning() : ""}

      <div class="forum-detail-head">
        <a class="forum-cat-pill forum-cat-pill--link"
           href="forum-category.html?category=${encodeURIComponent(t.categorySlug || (t.category && t.category.slug) || "")}"
           aria-label="ไปยังหมวด">${h.esc(t.category ? t.category.name : t.categorySlug)}</a>
        <h1 class="forum-detail-title" id="topicTitle"></h1>
        <div class="forum-detail-meta">
          <span>👤 <strong id="topicAuthor"></strong></span>
          <span>🕒 ${h.esc(h.formatBangkok(t.createdAt, { prefix: "ตั้งเมื่อ " }))}</span>
          <span>👁 ${t.viewCount || 0} อ่าน</span>
          <span>💬 ${t.replyCount || 0} ตอบ</span>
        </div>
      </div>

      <!-- OP (first post / floor 0) -->
      <div class="forum-posts" id="forumPosts">
        <div class="forum-post forum-post--op" data-post-type="topic" data-post-id="${h.esc(t.id)}">
          <div class="forum-post__head">
            <div class="forum-post__avatar">${h.esc(initialOf(t.author ? t.author.displayName : t.authorName))}</div>
            <div>
              <div class="forum-post__author" id="opAuthor"></div>
              <div class="forum-post__floor">เจ้าของกระทู้</div>
            </div>
            <div class="forum-post__time">${h.esc(h.formatBangkok(t.createdAt, { prefix: "" }))}</div>
          </div>
          <div class="forum-post__body" id="opBody"></div>
          ${renderAttachments(t.attachments || [], isOwner)}
          ${renderActions("topic", t.id, isOwner)}
        </div>

        <div id="forumReplyList"></div>
      </div>

      <div class="forum-loadmore" id="forumPostsLoadMoreWrap" hidden>
        <button id="forumPostsLoadMoreBtn" type="button">โหลดคำตอบเพิ่มเติม</button>
      </div>

      <!-- reply form -->
      <div class="forum-reply" id="forumReplyWrap">
        ${renderReplyForm(me)}
      </div>
    `;

    // set text via textContent (XSS defense)
    document.getElementById("topicTitle").textContent = t.title;
    document.getElementById("topicAuthor").textContent = t.author ? t.author.displayName : (t.authorName || "ผู้ใช้");
    document.getElementById("opAuthor").textContent = t.author ? t.author.displayName : (t.authorName || "ผู้ใช้");
    document.getElementById("opBody").textContent = t.body;

    // render replies
    renderReplies();

    // bind actions (report / edit / delete / reply)
    bindActions();
    bindReply();
    bindAttachmentUpload();

    // load more replies
    const lm = document.getElementById("forumPostsLoadMoreBtn");
    if (lm) lm.addEventListener("click", loadMoreReplies);
    toggleRepliesLoadMore();
  }

  function renderReplies() {
    const wrap = document.getElementById("forumReplyList");
    if (!wrap) return;
    const me = TT.ForumService.currentAuthor();
    const items = state.posts;
    if (!items.length) {
      wrap.innerHTML = `<div class="forum-state" style="padding:var(--sp-4)">
        <div class="forum-state__desc">ยังไม่มีคำตอบ — เป็นคนแรกที่ตอบกระทู้นี้</div>
      </div>`;
      return;
    }
    wrap.innerHTML = items
      .map((p) => {
        const isOwner = me && me.id === p.authorId;
        return `<div class="forum-post" data-post-type="post" data-post-id="${h.esc(p.id)}">
          <div class="forum-post__head">
            <div class="forum-post__avatar">${h.esc(initialOf(p.authorName))}</div>
            <div>
              <div class="forum-post__author" data-field="author"></div>
              <div class="forum-post__floor">คำตอบ #${p.floor}</div>
            </div>
            <div class="forum-post__time">${h.esc(h.formatBangkok(p.createdAt, { prefix: "" }))}</div>
          </div>
          <div class="forum-post__body" data-field="body"></div>
          ${renderActions("post", p.id, isOwner)}
        </div>`;
      })
      .join("");

    // set text via textContent (XSS defense — ไม่ใช้ innerHTML กับ user content)
    const nodes = wrap.querySelectorAll(".forum-post");
    nodes.forEach((node, i) => {
      const p = items[i];
      const authorEl = node.querySelector('[data-field="author"]');
      const bodyEl = node.querySelector('[data-field="body"]');
      if (authorEl) authorEl.textContent = p.authorName || "ผู้ใช้";
      if (bodyEl) bodyEl.textContent = p.body;
    });
  }

  function renderActions(type, id, isOwner) {
    const reportBtn = `<button class="forum-action-btn" data-action="report" data-type="${type}" data-id="${h.esc(id)}">🚩 แจ้ง</button>`;
    if (!isOwner) return `<div class="forum-post__actions">${reportBtn}</div>`;
    return `<div class="forum-post__actions">
      <button class="forum-action-btn" data-action="edit" data-type="${type}" data-id="${h.esc(id)}">✏️ แก้ไข</button>
      <button class="forum-action-btn forum-action-btn--danger" data-action="delete" data-type="${type}" data-id="${h.esc(id)}">🗑 ลบ</button>
      ${reportBtn}
    </div>`;
  }

  function renderAttachments(items, isOwner) {
    const list = items.length
      ? `<div class="forum-attachments__list">${items
          .map(
            (item) => `<a class="forum-attachment" href="${h.esc(item.url)}" target="_blank" rel="noopener">
              <span aria-hidden="true">📎</span>
              <span>${h.esc(item.originalName)}</span>
              <small>${formatBytes(item.byteSize)}</small>
            </a>`
          )
          .join("")}</div>`
      : "";
    const remaining = Math.max(0, 4 - items.length);
    const uploader = isOwner && remaining
      ? `<div class="forum-attachments__upload">
          <label for="topicAttachment">แนบไฟล์เพิ่ม</label>
          <input id="topicAttachment" type="file" multiple
                 accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.zip">
          <small>เพิ่มได้อีก ${remaining} ไฟล์ ไฟล์ละไม่เกิน 5MB</small>
          <button class="forum-action-btn" id="topicAttachmentSubmit" type="button">อัปโหลดไฟล์</button>
          <div class="forum-compose__error" id="topicAttachmentError" hidden></div>
        </div>`
      : "";
    if (!list && !uploader) return "";
    return `<div class="forum-attachments"><strong>ไฟล์แนบ</strong>${list}${uploader}</div>`;
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function bindAttachmentUpload() {
    const btn = document.getElementById("topicAttachmentSubmit");
    const input = document.getElementById("topicAttachment");
    if (!btn || !input) return;
    btn.addEventListener("click", async () => {
      const files = Array.from(input.files || []);
      const remaining = Math.max(0, 4 - (state.topic.attachments || []).length);
      const error = document.getElementById("topicAttachmentError");
      if (!files.length) return showAttachmentError(error, "กรุณาเลือกไฟล์");
      if (files.length > remaining) return showAttachmentError(error, `เลือกได้อีกไม่เกิน ${remaining} ไฟล์`);
      const invalid = files.find(
        (file) =>
          file.size > 5 * 1024 * 1024 ||
          !/\.(png|jpe?g|gif|webp|pdf|zip)$/i.test(file.name || "")
      );
      if (invalid) return showAttachmentError(error, `ไฟล์ ${invalid.name} มีชนิดไม่รองรับหรือใหญ่เกิน 5MB`);
      btn.disabled = true;
      if (error) error.hidden = true;
      try {
        for (let i = 0; i < files.length; i += 1) {
          btn.textContent = `กำลังอัปโหลด ${i + 1}/${files.length}...`;
          const attachment = await TT.ForumService.uploadAttachment({
            ownerType: "topic",
            ownerId: state.topic.id,
            file: files[i],
          });
          state.topic.attachments = state.topic.attachments || [];
          state.topic.attachments.push(attachment);
        }
        renderDetail();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "อัปโหลดไฟล์";
        showAttachmentError(error, `อัปโหลดไม่สำเร็จ: ${err.message || err}`);
      }
    });
  }

  function showAttachmentError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
  }

  function renderReplyForm(me) {
    if (!me) {
      return `<div class="forum-state">
        <div class="forum-state__title">เข้าร่วมสนทนา</div>
        <div class="forum-state__desc">ตั้งชื่อโปรไฟล์เพื่อตอบกระทู้นี้</div>
        <div style="margin-top:16px">
          <button class="forum-new-btn" id="forumSetupProfile" type="button">ตั้งชื่อโปรไฟล์</button>
        </div>
      </div>`;
    }
    return `
      <div class="forum-identity">
        <span>ล็อกอินในชื่อ:</span>
        <span class="forum-identity__name">${h.esc(me.displayName)}</span>
        <span class="forum-identity__guest">Guest</span>
      </div>
      <div class="forum-field">
        <label for="replyBody">ตอบกระทู้</label>
        <textarea id="replyBody" maxlength="10000" placeholder="เขียนคำตอบของคุณ..."></textarea>
      </div>
      <div class="forum-compose__error" id="replyError" hidden></div>
      <div class="forum-compose__actions">
        <button class="forum-new-btn" id="replySubmit" type="button">ตอบกลับ</button>
      </div>
    `;
  }

  function marketplaceWarning() {
    return `<div class="forum-warning">
      <span class="forum-warning__icon">⚠️</span>
      <div>
        <strong>คำเตือน:</strong> กระทู้นี้อยู่ในห้องซื้อขาย (Marketplace)
        แพลตฟอร์ม TraderToolsTH <strong>ไม่รับประกัน</strong>การซื้อขาย
        ไม่รับผิดชอบต่อความเสียหายใดๆ และไม่สามารถคืนเงินหรือไกล่เกลี่ยให้ได้
        กรุณาตรวจสอบความน่าเชื่อถือของคู่ค้าด้วยตัวท่านเอง
      </div>
    </div>`;
  }

  /* ---------- actions ---------- */
  function bindActions() {
    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const el = e.currentTarget;
        const action = el.dataset.action;
        const type = el.dataset.type;
        const id = el.dataset.id;
        if (action === "edit") onEdit(type, id);
        else if (action === "delete") onDelete(type, id);
        else if (action === "report") onReport(type, id);
      });
    });
    const setupBtn = document.getElementById("forumSetupProfile");
    if (setupBtn) setupBtn.addEventListener("click", setupProfileAndReload);
  }

  async function setupProfileAndReload() {
    const name = window.prompt("ตั้งชื่อที่จะแสดงในฟอรัม:", "");
    if (!name || !name.trim()) return;
    try {
      await TT.ForumService.createGuestProfile(name.trim().slice(0, 40));
      renderDetail(); // re-render เพื่อแสดง form ตอบกลับ
    } catch (e) {
      alert("ไม่สามารถสร้างโปรไฟล์ได้: " + (e.message || e));
    }
  }

  async function onEdit(type, id) {
    // inline edit: เปลี่ยน body เป็น textarea + save/cancel
    const node = document.querySelector(`[data-post-type="${type}"][data-post-id="${id}"]`);
    if (!node) return;
    const bodyEl = node.querySelector('[data-field="body"]');
    if (!bodyEl) return;

    // สำหรับ topic ใช้ #opBody, สำหรับ post ใช้ data-field="body"
    const target = type === "topic" ? document.getElementById("opBody") : bodyEl;
    if (!target) return;
    const current = target.textContent || "";
    target.classList.add("forum-post__body--editing");
    target.innerHTML = `<textarea class="forum-edit-textarea">${h.esc(current)}</textarea>
      <div class="forum-post__actions" style="margin-top:8px">
        <button class="forum-action-btn" data-edit-action="save">บันทึก</button>
        <button class="forum-action-btn" data-edit-action="cancel">ยกเลิก</button>
      </div>`;
    const ta = target.querySelector("textarea");
    ta.focus();

    target.querySelector('[data-edit-action="save"]').addEventListener("click", async () => {
      const val = ta.value.trim();
      if (!val) return alert("เนื้อหาต้องไม่ว่าง");
      try {
        if (type === "topic") {
          await TT.ForumService.updateTopic(id, { body: val });
          state.topic.body = val;
        } else {
          await TT.ForumService.updatePost(id, val);
          const p = state.posts.find((x) => x.id === id);
          if (p) p.body = val;
        }
        target.classList.remove("forum-post__body--editing");
        target.textContent = val;
      } catch (e) {
        alert("บันทึกไม่สำเร็จ: " + (e.message || e));
      }
    });
    target.querySelector('[data-edit-action="cancel"]').addEventListener("click", () => {
      target.classList.remove("forum-post__body--editing");
      target.textContent = current;
    });
  }

  async function onDelete(type, id) {
    if (!window.confirm("ต้องการลบใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้")) return;
    try {
      if (type === "topic") {
        await TT.ForumService.deleteTopic(id);
        window.location.href = "forum.html";
      } else {
        await TT.ForumService.deletePost(id);
        state.posts = state.posts.filter((x) => x.id !== id);
        renderReplies();
      }
    } catch (e) {
      alert("ลบไม่สำเร็จ: " + (e.message || e));
    }
  }

  async function onReport(type, id) {
    if (!TT.ForumService.hasIdentity()) {
      const name = window.prompt("ตั้งชื่อที่จะแสดงก่อนส่งรายงาน:", "");
      if (!name || !name.trim()) return;
      try {
        await TT.ForumService.createGuestProfile(name.trim().slice(0, 40));
      } catch (err) {
        alert("ไม่สามารถสร้างโปรไฟล์ได้: " + (err.message || err));
        return;
      }
    }
    const overlay = document.createElement("div");
    overlay.className = "forum-modal";
    overlay.id = "forumReportModal";
    overlay.innerHTML = `<div class="forum-modal__card">
      <div class="forum-modal__title">แจ้งเนื้อหาไม่เหมาะสม</div>
      <div class="forum-field">
        <label for="reportReason">เหตุผลในการแจ้ง</label>
        <textarea id="reportReason" maxlength="500" placeholder="อธิบายเหตุผล เช่น สแปม, หลอกลวง, เนื้อหาไม่เหมาะสม..."></textarea>
      </div>
      <div class="forum-compose__error" id="reportError" hidden></div>
      <div class="forum-compose__actions">
        <button class="forum-action-btn" id="reportCancel">ยกเลิก</button>
        <button class="forum-new-btn" id="reportSubmit">ส่งการแจ้ง</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    document.getElementById("reportCancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.getElementById("reportSubmit").addEventListener("click", async () => {
      const reason = document.getElementById("reportReason").value.trim();
      if (!reason) {
        const e = document.getElementById("reportError");
        e.textContent = "กรุณาระบุเหตุผล";
        e.hidden = false;
        return;
      }
      try {
        await TT.ForumService.reportTarget({
          targetType: type,
          targetId: id,
          reason,
        });
        overlay.remove();
        alert("ส่งการแจ้งเรียบร้อย ทีมงานจะตรวจสอบเร็วๆ นี้");
      } catch (e) {
        const err = document.getElementById("reportError");
        err.textContent = "ส่งไม่สำเร็จ: " + (e.message || e);
        err.hidden = false;
      }
    });
  }

  /* ---------- reply ---------- */
  function bindReply() {
    const btn = document.getElementById("replySubmit");
    if (!btn) return;
    btn.addEventListener("click", submitReply);
  }

  async function submitReply() {
    if (state.replySubmitting) return;
    const ta = document.getElementById("replyBody");
    if (!ta) return;
    const body = ta.value.trim();
    if (!body) return;
    const btn = document.getElementById("replySubmit");
    const errEl = document.getElementById("replyError");
    state.replySubmitting = true;
    btn.disabled = true;
    btn.textContent = "กำลังส่ง...";
    if (errEl) errEl.hidden = true;
    try {
      const post = await TT.ForumService.createPost(state.topicId, body);
      state.posts.push(post);
      ta.value = "";
      renderReplies();
    } catch (e) {
      let msg = e.message || "ส่งคำตอบไม่สำเร็จ";
      if (e.code === "rate_limited") msg = "โพสต์เร็วเกินไป กรุณารอสักครู่";
      else if (e.code === "auth_required") msg = "กรุณาตั้งชื่อโปรไฟล์ก่อนตอบ";
      if (errEl) {
        errEl.textContent = msg;
        errEl.hidden = false;
      } else {
        alert(msg);
      }
    } finally {
      state.replySubmitting = false;
      btn.disabled = false;
      btn.textContent = "ตอบกลับ";
    }
  }

  async function loadMoreReplies() {
    state.postOffset += state.postLimit;
    await loadPosts(false);
    renderReplies();
    toggleRepliesLoadMore();
  }

  function toggleRepliesLoadMore() {
    const wrap = document.getElementById("forumPostsLoadMoreWrap");
    if (!wrap) return;
    wrap.hidden = !state.postHasMore;
  }

  /* ---------- states ---------- */
  function renderNotFound() {
    const detail = document.getElementById("forumDetail");
    if (!detail) return;
    detail.innerHTML = `<div class="forum-state">
      <div class="forum-state__title">ไม่พบกระทู้</div>
      <div class="forum-state__desc">กระทู้อาจถูกลบหรือไม่เปิดเผย</div>
      <div style="margin-top:16px"><a class="forum-new-btn" href="forum.html">← กลับไปยังฟอรัม</a></div>
    </div>`;
  }

  function renderError(title, desc) {
    const detail = document.getElementById("forumDetail");
    if (!detail) return;
    detail.innerHTML = `<div class="forum-state">
      <div class="forum-state__title">⚠️ ${h.esc(title)}</div>
      <div class="forum-state__desc">${h.esc(desc || "กรุณาลองใหม่อีกครั้ง")}</div>
      <div style="margin-top:16px"><a class="forum-new-btn" href="forum.html">← กลับไปยังฟอรัม</a></div>
    </div>`;
  }

  /* ---------- helpers ---------- */
  function initialOf(name) {
    if (!name) return "?";
    return String(name).trim().charAt(0).toUpperCase();
  }

  // boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
