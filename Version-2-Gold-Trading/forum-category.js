/* ============================================================
   Page — Forum Category Timeline (V2)
   ------------------------------------------------------------
   URL: forum-category.html?category=<slug>

   โครงสร้าง:
   - Breadcrumb: Forum > ชื่อหมวด
   - Category header: icon + ชื่อ + คำอธิบาย + จำนวนกระทู้จริง + ปุ่มสร้างโพสต์
   - Toolbar: search เฉพาะหมวด + sort + toggle Timeline/Forum
   - Timeline card (default) หรือ Forum list (toggle ไม่ยิง API ซ้ำ)
   - Load more + skeleton + empty + error + invalid category state
   - Marketplace warning (ถ้า category เป็น marketplace)

   กฎ QC:
   - ใช้ slug จาก URL เท่านั้น (ห้าม hardcode ชื่อ/จำนวนโพสต์)
   - ข้อมูลทั้งหมดจาก API ไม่ mock
   - XSS-safe: ใช้ TT.h.esc ทุกจุด, ป้ายหมวดเป็น <a> ไป forum-category
   - สลับมุมมองไม่ยิง API ซ้ำ (reuse state.topics)
   - กดโพสต์ในหน้าหมวด → compose ล็อก category เป็นหมวดปัจจุบัน
   ============================================================ */

(function () {
  const h = TT.h;

  const state = {
    slug: "", // category slug จาก URL
    category: null, // category object จาก API (null = invalid/loading)
    topics: [],
    total: 0,
    offset: 0,
    limit: 12,
    hasMore: false,
    sort: "recent",
    search: "",
    view: "timeline", // "timeline" | "forum"
    loading: false,
    loadingCat: false,
    catError: null, // null | "invalid" | "network"
    topicsError: null,
  };

  function renderShell() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <nav class="forum-breadcrumb" aria-label="breadcrumb">
            <a href="forum.html">ฟอรัม</a>
            <span aria-hidden="true">›</span>
            <span id="forumCrumbCat">หมวด</span>
          </nav>

          <div id="forumCatHeader" aria-live="polite"></div>

          <!-- toolbar -->
          <div class="forum-toolbar" id="forumToolbar" hidden>
            <div class="forum-search">
              <span class="forum-search__icon">🔍</span>
              <input type="search" id="forumSearch" placeholder="ค้นหาในหมวดนี้..." aria-label="ค้นหาในหมวดนี้">
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

    // bind toolbar events
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
    document.querySelectorAll(".forum-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.view === state.view) return;
        state.view = btn.dataset.view;
        // sync URL (ไม่ reload)
        const u = new URL(location.href);
        u.searchParams.set("view", state.view);
        history.replaceState({}, "", u);
        updateViewToggle();
        renderTopics();
      });
    });
    document.getElementById("forumLoadMoreBtn").addEventListener("click", loadMore);
  }

  async function init() {
    renderShell();
    state.slug = h.query("category") || "";
    // preload view จาก URL
    const v = h.query("view");
    if (v === "forum" || v === "timeline") state.view = v;
    updateViewToggle();

    if (!state.slug) {
      renderInvalidCategory("ไม่ได้ระบุหมวด", "กรุณาเลือกหมวดจากหน้าฟอรัม");
      return;
    }
    await loadCategory();
    if (state.category) {
      await loadTopics();
    }
  }

  /* ---------- category ---------- */
  async function loadCategory() {
    state.loadingCat = true;
    state.catError = null;
    const wrap = document.getElementById("forumCatHeader");
    if (wrap) wrap.innerHTML = skeletonHeader();
    try {
      const cat = await TT.ForumService.getCategory(state.slug);
      if (!cat || cat.error) {
        renderInvalidCategory();
        state.category = null;
        return;
      }
      state.category = cat;
      renderCategoryHeader();
      document.getElementById("forumToolbar").hidden = false;
      // title
      document.title = `${cat.name} — ฟอรัม ${TT.site.name}`;
      const crumb = document.getElementById("forumCrumbCat");
      if (crumb) crumb.textContent = cat.name;
    } catch (e) {
      // 404 category_not_found → invalid category state
      if (e.message === "not_found" || e.message === "category_not_found") {
        renderInvalidCategory();
      } else {
        state.catError = "network";
        renderCategoryError("ไม่สามารถโหลดหมวด", e.message || "");
      }
      state.category = null;
    } finally {
      state.loadingCat = false;
    }
  }

  function renderCategoryHeader() {
    const wrap = document.getElementById("forumCatHeader");
    if (!wrap || !state.category) return;
    const c = state.category;
    const icon = iconForCategory(c.slug);
    const isMarket = !!c.isMarketplace;
    wrap.innerHTML = `
      ${isMarket ? marketplaceWarning() : ""}
      <div class="forum-cat-header">
        <div class="forum-cat-header__icon" aria-hidden="true">${h.esc(icon)}</div>
        <div class="forum-cat-header__main">
          <h1 class="forum-cat-header__name">${h.esc(c.name)}${isMarket ? ' <span class="forum-cat__badge">Marketplace</span>' : ""}</h1>
          <p class="forum-cat-header__desc">${h.esc(c.description || "")}</p>
          <div class="forum-cat-header__meta">
            <span><strong id="catTopicCount">${c.topicCount || 0}</strong> กระทู้</span>
          </div>
        </div>
        <div class="forum-cat-header__actions">
          <a class="forum-action-btn" href="forum.html" aria-label="กลับหน้าฟอรัมรวม">← ฟอรัม</a>
          <button class="forum-new-btn" type="button" id="forumNewBtn">+ สร้างโพสต์ในหมวดนี้</button>
        </div>
      </div>
    `;
    const btn = document.getElementById("forumNewBtn");
    if (btn) btn.addEventListener("click", onNewTopic);
  }

  function marketplaceWarning() {
    return `<div class="forum-warning" role="note">
      <span class="forum-warning__icon">⚠️</span>
      <div>
        <strong>คำเตือน:</strong> ฟอรัมนี้เป็นพื้นที่สำหรับซื้อขายระหว่างสมาชิก
        แพลตฟอร์ม TraderToolsTH <strong>ไม่รับประกัน</strong>การซื้อขาย
        ไม่รับผิดชอบต่อความเสียหายใดๆ และไม่สามารถคืนเงินหรือไกล่เกลี่ยให้ได้
        กรุณาตรวจสอบความน่าเชื่อถือของผู้ขายด้วยตัวท่านเองก่อนทำธุรกรรม
      </div>
    </div>`;
  }

  function skeletonHeader() {
    return `<div class="forum-cat-header">
      <div class="skeleton" style="width:56px;height:56px;border-radius:14px"></div>
      <div class="forum-cat-header__main">
        <div class="skeleton" style="height:24px;width:40%;margin-bottom:10px"></div>
        <div class="skeleton" style="height:14px;width:80%;margin-bottom:6px"></div>
        <div class="skeleton" style="height:14px;width:30%"></div>
      </div>
    </div>`;
  }

  /* ---------- topics ---------- */
  async function loadTopics() {
    state.loading = true;
    state.topicsError = null;
    const wrap = document.getElementById("forumTopics");
    if (!wrap) return;
    if (state.offset === 0) {
      wrap.innerHTML = skeletonRows(4);
    }
    try {
      const result = await TT.ForumService.listTopics({
        category: state.slug,
        limit: state.limit,
        offset: state.offset,
        sort: state.sort,
        search: state.search,
      });
      state.total = result.total || 0;
      state.hasMore = !!result.hasMore;
      if (state.offset === 0) state.topics = result.items;
      else state.topics = state.topics.concat(result.items);
      // sync header count (อาจเปลี่ยนตาม search/sort)
      const cnt = document.getElementById("catTopicCount");
      if (cnt && !state.search) cnt.textContent = String(state.category?.topicCount ?? state.total);
      renderTopics();
    } catch (e) {
      state.topicsError = e.message || "";
      wrap.innerHTML = stateBlock("⚠️ ไม่สามารถโหลดกระทู้", e.message || "กรุณาลองใหม่อีกครั้ง");
      toggleLoadMore(false);
    } finally {
      state.loading = false;
    }
  }

  function renderTopics() {
    const wrap = document.getElementById("forumTopics");
    if (!wrap) return;
    const topics = state.topics;
    if (!topics.length) {
      wrap.innerHTML = emptyState();
      toggleLoadMore(false);
      return;
    }
    const html =
      state.view === "forum" ? renderForumList(topics) : renderTimeline(topics);
    wrap.innerHTML = html;
    toggleLoadMore(state.hasMore && !state.loading);
  }

  // Timeline card: อ่านเหมือน Community Feed (avatar, author, เวลา, ป้ายหมวด, หัวข้อ, preview, ตอบ, เข้าชม)
  function renderTimeline(topics) {
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

  // Forum list: รายการแบบตาราง forum เดิม
  function renderForumList(topics) {
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

  function updateViewToggle() {
    document.querySelectorAll(".forum-view-btn").forEach((btn) => {
      const active = btn.dataset.view === state.view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
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

  /* ---------- states ---------- */
  function emptyState() {
    const catName = state.category ? state.category.name : "หมวดนี้";
    return `<div class="forum-state forum-state--empty">
      <div class="forum-state__title">ยังไม่มีโพสต์ใน${h.esc(catName)}</div>
      <div class="forum-state__desc">เป็นคนแรกที่เริ่มสนทนาในหมวดนี้!</div>
      <div style="margin-top:16px">
        <button class="forum-new-btn" type="button" id="emptyNewBtn">+ สร้างโพสต์ในหมวดนี้</button>
      </div>
    </div>`;
  }

  function renderInvalidCategory(title, desc) {
    const wrap = document.getElementById("forumCatHeader");
    if (wrap) {
      wrap.innerHTML = `<div class="forum-state">
        <div class="forum-state__title">⚠️ ${h.esc(title || "ไม่พบหมวดที่เลือก")}</div>
        <div class="forum-state__desc">${h.esc(desc || "หมวดที่คุณเลือกอาจไม่ถูกต้องหรือถูกลบไปแล้ว")}</div>
        <div style="margin-top:16px"><a class="forum-new-btn" href="forum.html">← กลับไปยังฟอรัม</a></div>
      </div>`;
    }
    document.getElementById("forumToolbar").hidden = true;
    const topics = document.getElementById("forumTopics");
    if (topics) topics.innerHTML = "";
    toggleLoadMore(false);
    const crumb = document.getElementById("forumCrumbCat");
    if (crumb) crumb.textContent = "ไม่พบหมวด";
  }

  function renderCategoryError(title, desc) {
    const wrap = document.getElementById("forumCatHeader");
    if (!wrap) return;
    wrap.innerHTML = `<div class="forum-state">
      <div class="forum-state__title">${h.esc(title)}</div>
      <div class="forum-state__desc">${h.esc(desc)}</div>
      <div style="margin-top:16px">
        <button class="forum-new-btn" type="button" id="catRetryBtn">ลองอีกครั้ง</button>
        <a class="forum-action-btn" href="forum.html" style="margin-left:8px">← ฟอรัม</a>
      </div>
    </div>`;
    const retry = document.getElementById("catRetryBtn");
    if (retry) retry.addEventListener("click", () => { init(); });
  }

  function stateBlock(title, desc) {
    return `<div class="forum-state">
      <div class="forum-state__title">${h.esc(title)}</div>
      ${desc ? `<div class="forum-state__desc">${h.esc(desc)}</div>` : ""}
      <div style="margin-top:12px"><button class="forum-new-btn" type="button" id="topicsRetryBtn">ลองอีกครั้ง</button></div>
    </div>`;
  }

  /* ---------- compose (new topic) — lock category เป็นหมวดปัจจุบัน ---------- */
  async function onNewTopic() {
    // delegate empty-state button ด้วย
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
    const cat = state.category;
    if (!cat) return;
    const overlay = document.createElement("div");
    overlay.className = "forum-modal";
    overlay.id = "forumComposeModal";
    overlay.innerHTML = `
      <div class="forum-modal__card">
        <div class="forum-modal__title">ตั้งกระทู้ใน "${h.esc(cat.name)}"</div>
        <div class="forum-compose" style="border:none;padding:0;margin:0;">
          <div class="forum-field">
            <label for="composeCat">หมวดหมู่</label>
            <select id="composeCat" disabled>
              <option value="${h.esc(cat.slug)}" selected>${h.esc(cat.name)}${cat.isMarketplace ? " (Marketplace)" : ""}</option>
            </select>
            <small class="forum-field__hint">ล็อกไว้เป็นหมวดปัจจุบัน — กลับไป<a href="forum.html">ฟอรัมรวม</a>เพื่อเลือกหมวดอื่น</small>
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
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeCompose(); });
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
      (file) => file.size > 5 * 1024 * 1024 || !/\.(png|jpe?g|gif|webp|pdf|zip)$/i.test(file.name || "")
    );
    if (invalidFile) return showComposeError(`ไฟล์ ${invalidFile.name} มีชนิดไม่รองรับหรือใหญ่เกิน 5MB`);

    btn.disabled = true;
    btn.textContent = "กำลังบันทึก...";
    try {
      const created = await TT.ForumService.createTopic({ categorySlug: cat, title, body });
      btn.dataset.createdTopic = created.id;
      for (let i = 0; i < files.length; i += 1) {
        btn.textContent = `กำลังอัปโหลดไฟล์ ${i + 1}/${files.length}...`;
        await TT.ForumService.uploadAttachment({ ownerType: "topic", ownerId: created.id, file: files[i] });
      }
      closeCompose();
      // redirect ไปหน้ากระทู้ที่สร้าง
      window.location.href = `forum-topic.html?id=${encodeURIComponent(created.id)}`;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = btn.dataset.createdTopic ? "เปิดกระทู้ที่สร้างแล้ว" : "ตั้งกระทู้";
      let msg = e.message || "ไม่สามารถตั้งกระทู้ได้";
      if (btn.dataset.createdTopic) {
        msg = `สร้างกระทู้แล้ว แต่แนบไฟล์ไม่สำเร็จ (${msg}) กดปุ่มเพื่อเปิดกระทู้และลองแนบใหม่`;
      }
      if (e.code === "rate_limited") msg = "โพสต์เร็วเกินไป กรุณารอสักครู่แล้วลองใหม่";
      else if (e.code === "auth_required") msg = "กรุณาตั้งชื่อโปรไฟล์ก่อนโพสต์";
      showComposeError(msg);
    }
  }

  function showComposeError(msg) {
    const el = document.getElementById("composeError");
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  /* ---------- helpers ---------- */
  function categoryName(slug) {
    if (state.category && state.category.slug === slug) return state.category.name;
    return slug;
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

  function initialOf(name) {
    if (!name) return "?";
    return String(name).trim().charAt(0).toUpperCase();
  }

  function skeletonRows(n) {
    return `<div class="forum-timeline">
      ${Array.from({ length: n })
        .map(
          () => `<div class="forum-tl-card">
            <div class="forum-tl-card__head">
              <div class="skeleton" style="width:40px;height:40px;border-radius:50%"></div>
              <div style="flex:1">
                <div class="skeleton" style="height:14px;width:40%;margin-bottom:6px"></div>
                <div class="skeleton" style="height:12px;width:25%"></div>
              </div>
            </div>
            <div class="skeleton" style="height:18px;width:80%;margin:10px 0 8px"></div>
            <div class="skeleton" style="height:14px;width:100%;margin-bottom:6px"></div>
            <div class="skeleton" style="height:14px;width:60%"></div>
          </div>`
        )
        .join("")}
    </div>`;
  }

  // delegate empty-state button (สร้างโพสต์)
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#emptyNewBtn, #topicsRetryBtn");
    if (!b) return;
    if (b.id === "emptyNewBtn") void onNewTopic();
    else if (b.id === "topicsRetryBtn") { state.offset = 0; state.topics = []; loadTopics(); }
  });

  // boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
