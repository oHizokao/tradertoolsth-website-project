/* ============================================================
   Page — Forum list (V2)
   ------------------------------------------------------------
   โครงสร้าง:
   - หัวฟอรัม + สถิติ
   - การ์ดหมวดหมู่ (5 หมวด) + marketplace warning
   - toolbar (ค้นหา + sort + ปุ่มตั้งกระทู้)
   - รายการกระทู้ + pagination (load more)
   - compose modal (สร้างกระทู้ + สร้าง guest profile ถ้ายังไม่มี)

   กฎ:
   - ข้อมูลทั้งหมดจาก API ไม่ hardcode
   - ทุกการแสดงผลใช้ textContent (XSS defense)
   - state: loading / empty / error / permission-denied
   - กด "ตั้งกระทู้ใหม่" โดยไม่มี identity → สร้าง guest profile ก่อน
   ============================================================ */

(function () {
  const h = TT.h;

  const state = {
    categories: [],
    activeCategory: "", // "" = ทุกหมวด (Forum หลัก)
    topics: [],
    total: 0,
    offset: 0,
    limit: 12,
    hasMore: false,
    sort: "recent",
    search: "",
    view: "timeline", // "timeline" | "forum" — ค่าเริ่มต้น Timeline
    loading: false,
    loadingCats: false,
    error: null,
    showCompose: false,
  };

  function renderShell() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <div class="forum-head">
            <span class="eyebrow">${TT.icon("chat", 14)} Community</span>
            <h1>ฟอรัม <span class="text-grad-blue">ชุมชน</span></h1>
            <p>แลกเปลี่ยนความรู้ แจก EA/Indicator ถามตอบ และพูดคุยกับเทรดเดอร์คนอื่น</p>
            <div class="forum-head__stats" id="forumStats"></div>
          </div>

          <!-- category cards -->
          <div class="forum-cats" id="forumCats" aria-live="polite"></div>

          <!-- toolbar -->
          <div class="forum-toolbar">
            <div class="forum-search">
              <span class="forum-search__icon">🔍</span>
              <input type="search" id="forumSearch" placeholder="ค้นหากระทู้..." aria-label="ค้นหากระทู้">
            </div>
            <select class="forum-sort" id="forumSort" aria-label="เรียงลำดับ">
              <option value="recent">ใหม่ที่สุด</option>
              <option value="created">ตั้งล่าสุด</option>
              <option value="replies">ตอบมากสุด</option>
              <option value="views">เปิดอ่านมากสุด</option>
            </select>
            <div class="forum-view-toggle" role="group" aria-label="มุมมอง">
              <button type="button" class="forum-view-btn is-active" data-view="timeline" aria-pressed="true">Timeline</button>
              <button type="button" class="forum-view-btn" data-view="forum" aria-pressed="false">มุมมอง Forum</button>
            </div>
            <button class="forum-new-btn" id="forumNewBtn" type="button">+ ตั้งกระทู้ใหม่</button>
          </div>

          <div id="forumTopics" aria-live="polite"></div>

          <div class="forum-loadmore" id="forumLoadMoreWrap" hidden>
            <button id="forumLoadMoreBtn" type="button">โหลดเพิ่มเติม</button>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "forum",
      main,
    });
    TT.layout.initNavbar();
    document.title = `ฟอรัมชุมชน — ${TT.site.name}`;

    // bind events
    document.getElementById("forumNewBtn").addEventListener("click", onNewTopic);
    document.getElementById("forumLoadMoreBtn").addEventListener("click", loadMore);
    const searchEl = document.getElementById("forumSearch");
    let searchTimer = null;
    searchEl.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        state.offset = 0;
        state.topics = [];
        loadTopics();
      }, 350);
    });
    document.getElementById("forumSort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      state.offset = 0;
      state.topics = [];
      loadTopics();
    });
    // view toggle — สลับมุมมองโดยไม่ยิง API ซ้ำ (reuse state.topics)
    document.querySelectorAll(".forum-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.view === state.view) return;
        state.view = btn.dataset.view;
        const u = new URL(location.href);
        u.searchParams.set("view", state.view);
        history.replaceState({}, "", u);
        updateViewToggle();
        renderTopics();
      });
    });
  }

  function updateViewToggle() {
    document.querySelectorAll(".forum-view-btn").forEach((btn) => {
      const active = btn.dataset.view === state.view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  async function init() {
    renderShell();
    // โหลด view จาก URL (?view=timeline|forum) — default timeline
    const v = h.query("view");
    if (v === "forum" || v === "timeline") state.view = v;
    updateViewToggle();
    // โหลดหมวดหมู่ + สถิติ + กระทู้พร้อมกัน
    await Promise.all([loadCategories(), loadStats()]);
    // Forum หลัก = Timeline รวมทุกหมวด (state.activeCategory = "")
    // หมายเหตุ: category card ตอนนี้ลิงก์ไป forum-category.html แล้ว (ไม่ filter ในหน้าเดิม)
    await loadTopics();
  }

  /* ---------- categories ---------- */
  async function loadCategories() {
    state.loadingCats = true;
    const wrap = document.getElementById("forumCats");
    if (wrap) wrap.innerHTML = skeletonCards(5);
    try {
      const cats = await TT.ForumService.listCategories();
      state.categories = cats;
      renderCategories();
    } catch (e) {
      if (wrap) wrap.innerHTML = stateBlock("ไม่สามารถโหลดหมวดหมู่", e.message || "");
    } finally {
      state.loadingCats = false;
    }
  }

  function renderCategories() {
    const wrap = document.getElementById("forumCats");
    if (!wrap) return;
    const cats = state.categories;
    if (!cats.length) {
      wrap.innerHTML = "";
      return;
    }
    // การ์ด "ทุกหมวด" อยู่บนสุด
    const allCard = `
      <a class="forum-cat" href="forum.html" data-cat="">
        <div class="forum-cat__icon">≡</div>
        <div class="forum-cat__name">ทุกหมวด</div>
        <div class="forum-cat__desc">ดูกระทู้ทั้งหมดในฟอรัม</div>
        <div class="forum-cat__meta">
          <span>${state.total} กระทู้</span>
        </div>
      </a>`;
    wrap.innerHTML =
      allCard +
      cats
        .map((c) => {
          const icon = iconForCategory(c.slug);
          const isMarket = c.isMarketplace;
          // category card → หน้า Category Timeline แยก (forum-category.html)
          return `<a class="forum-cat ${isMarket ? "forum-cat--marketplace" : ""}" href="forum-category.html?category=${encodeURIComponent(c.slug)}" data-cat="${h.esc(c.slug)}">
            <div class="forum-cat__icon">${h.esc(icon)}</div>
            <div class="forum-cat__name">${h.esc(c.name)}${isMarket ? ' <span class="forum-cat__badge">Marketplace</span>' : ""}</div>
            <div class="forum-cat__desc">${h.esc(c.description)}</div>
            <div class="forum-cat__meta">
              <span>${c.topicCount || 0} กระทู้</span>
              ${isMarket ? '<span>ซื้อขาย</span>' : ""}
            </div>
          </a>`;
        })
        .join("");
    // ไม่ intercept click — ให้ <a> นำทางปกติไป forum-category.html (ตาม requirement)
  }

  function iconForCategory(slug) {
    return (
      {
        "ea-indicator": "⚡",
        tricks: "🎯",
        brokers: "🏛",
        marketplace: "🛒",
        general: "💬",
      }[slug] || "📋"
    );
  }

  /* ---------- stats ---------- */
  async function loadStats() {
    const wrap = document.getElementById("forumStats");
    if (!wrap) return;
    try {
      const s = await TT.ForumService.getStats();
      wrap.innerHTML = `
        <span class="forum-head__stat"><strong>${s.topics}</strong> กระทู้</span>
        <span class="forum-head__stat"><strong>${s.posts}</strong> คำตอบ</span>
        <span class="forum-head__stat"><strong>${s.categories}</strong> หมวดหมู่</span>
      `;
    } catch {
      wrap.innerHTML = "";
    }
  }

  /* ---------- topics ---------- */
  async function loadTopics() {
    state.loading = true;
    const wrap = document.getElementById("forumTopics");
    if (!wrap) return;

    // ถ้า offset=0 → ล้างก่อนแสดง skeleton
    if (state.offset === 0) {
      wrap.innerHTML = `<div class="forum-topics" id="forumTopicsList">${skeletonRows(4)}</div>`;
      // แสดง warning banner ถ้าอยู่ในหมวด marketplace
      renderMarketplaceWarning(wrap);
    }

    try {
      const result = await TT.ForumService.listTopics({
        category: state.activeCategory,
        limit: state.limit,
        offset: state.offset,
        sort: state.sort,
        search: state.search,
      });
      state.total = result.total || 0;
      state.hasMore = !!result.hasMore;
      // append (กรณี load more) หรือ replace (offset 0)
      if (state.offset === 0) state.topics = result.items;
      else state.topics = state.topics.concat(result.items);
      renderTopics();
      updateCategoryCounts();
    } catch (e) {
      wrap.innerHTML = stateBlock("ไม่สามารถโหลดกระทู้", e.message || "กรุณาลองใหม่อีกครั้ง");
    } finally {
      state.loading = false;
    }
  }

  function renderMarketplaceWarning(parentWrap) {
    // แสดงคำเตือน marketplace ถ้ากำลังดูหมวด marketplace หรือทุกหมวด
    if (state.activeCategory !== "marketplace") return;
    const existing = parentWrap.querySelector(".forum-warning");
    if (existing) return;
    const warn = document.createElement("div");
    warn.className = "forum-warning";
    warn.innerHTML = `
      <span class="forum-warning__icon">⚠️</span>
      <div>
        <strong>คำเตือน:</strong> ฟอรัมนี้เป็นพื้นที่สำหรับซื้อขายระหว่างสมาชิก
        แพลตฟอร์ม TraderToolsTH <strong>ไม่รับประกัน</strong>การซื้อขาย
        ไม่รับผิดชอบต่อความเสียหายใดๆ และไม่สามารถคืนเงินหรือไกล่เกลี่ยให้ได้
        กรุณาตรวจสอบความน่าเชื่อถือของผู้ขายด้วยตัวท่านเองก่อนทำธุรกรรม
      </div>`;
    parentWrap.insertBefore(warn, parentWrap.firstChild);
  }

  function renderTopics() {
    const wrap = document.getElementById("forumTopics");
    if (!wrap) return;
    renderMarketplaceWarning(wrap);
    const warnHtml = wrap.querySelector(".forum-warning")?.outerHTML || "";

    const topics = state.topics;
    if (!topics.length) {
      wrap.innerHTML = warnHtml +
        stateBlock(
          "ยังไม่มีกระทู้",
          state.activeCategory
            ? "เป็นคนแรกที่ตั้งกระทู้ในหมวดนี้!"
            : "กดปุ่ม \"ตั้งกระทู้ใหม่\" เพื่อเริ่มสนทนา"
        );
      toggleLoadMore(false);
      return;
    }

    // เลือก view: Timeline (default) หรือ Forum list
    const listHtml = state.view === "forum"
      ? renderForumListView(topics)
      : renderTimelineView(topics);

    wrap.innerHTML = warnHtml + listHtml;
    toggleLoadMore(state.hasMore && !state.loading);
  }

  // Timeline view: การ์ดโพสต์แบบ Community Feed
  function renderTimelineView(topics) {
    return `<div class="forum-timeline">
      ${topics
        .map((t) => {
          const catName = categoryName(t.categorySlug);
          const preview = h.truncate(t.body || "", 180);
          const time = h.formatBangkok(t.lastActivityAt || t.createdAt, { prefix: "" });
          const avatar = initialOf(t.authorName);
          return `<article class="forum-tl-card">
            <a class="forum-card-link" href="forum-topic.html?id=${encodeURIComponent(t.id)}"
               aria-label="เปิดกระทู้ ${h.esc(t.title)}"></a>
            <div class="forum-tl-card__head">
              <div class="forum-tl-card__avatar" aria-hidden="true">${h.esc(avatar)}</div>
              <div class="forum-tl-card__by">
                <span class="forum-tl-card__author">${h.esc(t.authorName || "ผู้ใช้")}</span>
                <span class="forum-tl-card__time">${h.esc(time)}</span>
              </div>
              <a class="forum-cat-pill forum-cat-pill--link"
                 href="forum-category.html?category=${encodeURIComponent(t.categorySlug)}"
                 aria-label="ไปยังหมวด ${h.esc(catName)}">${h.esc(catName)}</a>
            </div>
            <h3 class="forum-tl-card__title">${h.esc(t.title)}</h3>
            <p class="forum-tl-card__preview">${h.esc(preview)}</p>
            <div class="forum-tl-card__foot">
              <span class="forum-tl-card__stat">💬 <strong>${t.replyCount || 0}</strong> ตอบ</span>
              <span class="forum-tl-card__stat">👁 ${t.viewCount || 0}</span>
            </div>
          </article>`;
        })
        .join("")}
    </div>`;
  }

  // Forum list view: รายการแบบตาราง forum เดิม
  function renderForumListView(topics) {
    return `<div class="forum-topics">
      ${topics
        .map((t) => {
          const catName = categoryName(t.categorySlug);
          const preview = h.truncate(t.body || "", 140);
          const time = h.formatBangkok(t.lastActivityAt || t.createdAt, { prefix: "" });
          const avatar = initialOf(t.authorName);
          return `<article class="forum-topic-row">
            <a class="forum-card-link" href="forum-topic.html?id=${encodeURIComponent(t.id)}"
               aria-label="เปิดกระทู้ ${h.esc(t.title)}"></a>
            <div class="forum-topic-row__avatar">${h.esc(avatar)}</div>
            <div class="forum-topic-row__main">
              <div class="forum-topic-row__title">${h.esc(t.title)}</div>
              <div class="forum-topic-row__preview">${h.esc(preview)}</div>
              <div class="forum-topic-row__meta">
                <a class="forum-cat-pill forum-cat-pill--link"
                   href="forum-category.html?category=${encodeURIComponent(t.categorySlug)}">${h.esc(catName)}</a>
                <span class="forum-topic-row__meta-item">👤 ${h.esc(t.authorName || "ผู้ใช้")}</span>
                <span class="forum-topic-row__meta-item">🕒 ${h.esc(time)}</span>
                <span class="forum-topic-row__meta-item">👁 ${t.viewCount || 0}</span>
              </div>
            </div>
            <div class="forum-topic-row__replies">
              <strong>${t.replyCount || 0}</strong>
              <span>ตอบ</span>
            </div>
          </article>`;
        })
        .join("")}
    </div>`;
  }

  function updateCategoryCounts() {
    // refresh "ทุกหมวด" count
    const allCard = document.querySelector('.forum-cat[data-cat=""]');
    if (allCard) {
      const meta = allCard.querySelector(".forum-cat__meta span");
      if (meta) meta.textContent = `${state.total} กระทู้`;
    }
  }

  function toggleLoadMore(show) {
    const wrap = document.getElementById("forumLoadMoreWrap");
    if (!wrap) return;
    wrap.hidden = !show;
    const btn = document.getElementById("forumLoadMoreBtn");
    if (btn) btn.disabled = state.loading;
  }

  async function loadMore() {
    if (state.loading || !state.hasMore) return;
    state.offset += state.limit;
    toggleLoadMore(false);
    await loadTopics();
  }

  /* ---------- compose (new topic) ---------- */
  async function onNewTopic() {
    // ต้องมี identity ก่อน — ถ้ายังไม่มี ให้สร้าง guest profile
    if (!TT.ForumService.hasIdentity()) {
      const name = window.prompt("ตั้งชื่อที่จะแสดงในฟอรัม (ชื่อเล่นหรือนามแฝง):", "");
      if (!name || !name.trim()) return;
      try {
        await TT.ForumService.createGuestProfile(name.trim().slice(0, 40));
      } catch (e) {
        alert("ไม่สามารถสร้างโปรไฟล์ได้: " + (e.message || e));
        return;
      }
    }
    openCompose();
  }

  function openCompose() {
    const cats = state.categories.filter((c) => true); // ทุกหมวดเปิดให้ตั้งกระทู้
    const overlay = document.createElement("div");
    overlay.className = "forum-modal";
    overlay.id = "forumComposeModal";
    overlay.innerHTML = `
      <div class="forum-modal__card">
        <div class="forum-modal__title">ตั้งกระทู้ใหม่</div>
        <div class="forum-compose" style="border:none;padding:0;margin:0;">
          <div class="forum-field">
            <label for="composeCat">หมวดหมู่</label>
            <select id="composeCat">
              ${cats
                .map(
                  (c) =>
                    `<option value="${h.esc(c.slug)}"${c.slug === state.activeCategory ? " selected" : ""}>${h.esc(c.name)}${c.isMarketplace ? " (Marketplace)" : ""}</option>`
                )
                .join("")}
            </select>
          </div>
          <div class="forum-field">
            <label for="composeTitle">หัวข้อ</label>
            <input type="text" id="composeTitle" maxlength="200" placeholder="หัวข้อกระทู้...">
          </div>
          <div class="forum-field">
            <label for="composeBody">เนื้อหา</label>
            <textarea id="composeBody" maxlength="10000" placeholder="เขียนรายละเอียดของกระทู้..."></textarea>
          </div>
          <div class="forum-field">
            <label for="composeFiles">ไฟล์แนบ (ไม่บังคับ)</label>
            <input id="composeFiles" type="file" multiple
                   accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.zip">
            <small class="forum-field__hint">สูงสุด 4 ไฟล์ ไฟล์ละไม่เกิน 5MB — PNG/JPG/GIF/WEBP/PDF/ZIP</small>
          </div>
          <div class="forum-compose__error" id="composeError" hidden></div>
          <div class="forum-compose__actions">
            <button type="button" class="forum-action-btn" id="composeCancel">ยกเลิก</button>
            <button type="button" class="forum-new-btn" id="composeSubmit">ตั้งกระทู้</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("composeCancel").addEventListener("click", closeCompose);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeCompose();
    });
    document.getElementById("composeSubmit").addEventListener("click", submitCompose);
    document.getElementById("composeTitle").focus();
  }

  function closeCompose() {
    const m = document.getElementById("forumComposeModal");
    if (m) m.remove();
  }

  async function submitCompose() {
    const cat = document.getElementById("composeCat").value;
    const title = document.getElementById("composeTitle").value.trim();
    const body = document.getElementById("composeBody").value.trim();
    const errEl = document.getElementById("composeError");
    const btn = document.getElementById("composeSubmit");
    if (btn.dataset.createdTopic) {
      window.location.href = `forum-topic.html?id=${encodeURIComponent(btn.dataset.createdTopic)}`;
      return;
    }
    const files = Array.from(document.getElementById("composeFiles")?.files || []);

    if (!title) return showComposeError("กรุณาใส่หัวข้อ");
    if (!body) return showComposeError("กรุณาใส่เนื้อหา");
    if (files.length > 4) return showComposeError("แนบไฟล์ได้สูงสุด 4 ไฟล์");
    const invalidFile = files.find(
      (file) =>
        file.size > 5 * 1024 * 1024 ||
        !/\.(png|jpe?g|gif|webp|pdf|zip)$/i.test(file.name || "")
    );
    if (invalidFile) {
      return showComposeError(`ไฟล์ ${invalidFile.name} มีชนิดไม่รองรับหรือใหญ่เกิน 5MB`);
    }

    btn.disabled = true;
    btn.textContent = "กำลังบันทึก...";
    try {
      const created = await TT.ForumService.createTopic({
        categorySlug: cat,
        title,
        body,
      });
      btn.dataset.createdTopic = created.id;
      for (let i = 0; i < files.length; i += 1) {
        btn.textContent = `กำลังอัปโหลดไฟล์ ${i + 1}/${files.length}...`;
        await TT.ForumService.uploadAttachment({
          ownerType: "topic",
          ownerId: created.id,
          file: files[i],
        });
      }
      closeCompose();
      // ไปยังหน้ากระทู้ที่สร้าง
      window.location.href = `forum-topic.html?id=${encodeURIComponent(created.id)}`;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = btn.dataset.createdTopic ? "เปิดกระทู้ที่สร้างแล้ว" : "ตั้งกระทู้";
      let msg = e.message || "ไม่สามารถตั้งกระทู้ได้";
      if (btn.dataset.createdTopic) {
        msg = `สร้างกระทู้แล้ว แต่แนบไฟล์ไม่สำเร็จ (${msg}) กดปุ่มเพื่อเปิดกระทู้และลองแนบใหม่`;
      }
      if (e.code === "rate_limited") {
        msg = "โพสต์เร็วเกินไป กรุณารอสักครู่แล้วลองใหม่";
      } else if (e.code === "auth_required") {
        msg = "กรุณาตั้งชื่อโปรไฟล์ก่อนโพสต์";
      }
      showComposeError(msg);
    }
  }

  function showComposeError(msg) {
    const el = document.getElementById("composeError");
    if (el) {
      el.textContent = msg;
      el.hidden = false;
    }
  }

  /* ---------- helpers ---------- */
  function categoryName(slug) {
    const c = state.categories.find((x) => x.slug === slug);
    return c ? c.name : slug;
  }

  function initialOf(name) {
    if (!name) return "?";
    const ch = String(name).trim().charAt(0);
    return ch.toUpperCase();
  }

  function skeletonCards(n) {
    return Array.from({ length: n })
      .map(
        () => `<div class="forum-cat">
          <div class="skeleton" style="width:44px;height:44px;border-radius:10px;margin-bottom:12px"></div>
          <div class="skeleton" style="height:18px;width:60%;margin-bottom:8px"></div>
          <div class="skeleton" style="height:14px;width:100%;margin-bottom:6px"></div>
          <div class="skeleton" style="height:14px;width:40%"></div>
        </div>`
      )
      .join("");
  }

  function skeletonRows(n) {
    return Array.from({ length: n })
      .map(
        () => `<div class="forum-topic-row">
          <div class="skeleton" style="width:40px;height:40px;border-radius:50%;flex-shrink:0"></div>
          <div class="forum-topic-row__main">
            <div class="skeleton" style="height:18px;width:70%;margin-bottom:8px"></div>
            <div class="skeleton" style="height:14px;width:100%;margin-bottom:6px"></div>
            <div class="skeleton" style="height:12px;width:50%"></div>
          </div>
        </div>`
      )
      .join("");
  }

  function stateBlock(title, desc) {
    return `<div class="forum-state">
      <div class="forum-state__title">${h.esc(title)}</div>
      ${desc ? `<div class="forum-state__desc">${h.esc(desc)}</div>` : ""}
    </div>`;
  }

  // boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
