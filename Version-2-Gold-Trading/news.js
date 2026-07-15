/* ============================================================
   Page — News list (V2)
   ------------------------------------------------------------
   โครงสร้าง:
   - "ข่าวล่าสุด"  : 3 ข่าวล่าสุด (เด่น) เรียงใหม่ → เก่า
   - "ข่าวเพิ่มเติม": ข่าวลำดับ 4 เป็นต้นไป โหลดทีละ 6 ข่าว ผ่านปุ่ม
   กฎ:
   - ข่าวทั้งหมดมาจาก API (เฉพาะ published) ไม่ hardcode
   - ถ้ายังไม่มีข่าวเก่ากว่า 3 → ซ่อนส่วน "ข่าวเพิ่มเติม"
   - ระหว่างโหลด: ปิดปุ่ม + ข้อความ "กำลังโหลด..."
   - โหลดหมด: เปลี่ยนเป็น "แสดงข่าวครบแล้ว" (disabled)
   - API ล้มเหลว: ข้อความไทย + ปุ่ม "ลองอีกครั้ง"
   - กันกดซ้ำระหว่างโหลด (isLoading flag)
   ============================================================ */

(function () {
  const h = TT.h;

  const LATEST_COUNT = 3; // ข่าวล่าสุด (ส่วนบน)
  const MORE_PAGE = 6; // ข่าวเพิ่มเติม โหลดทีละ 6

  const state = {
    category: "all",
    loading: false, // กันกดซ้ำ (load more)
    latestLoaded: false,
    moreOffset: LATEST_COUNT, // ตัวชี้ข่าวเพิ่มเติมถัดไป
    hasMore: false,
    total: 0,
    // track id ที่แสดงแล้ว เพื่อกันซ้ำเมื่อโหลดเพิ่ม (defense-in-depth)
    shownIds: new Set(),
  };

  function render() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("news", 14)} Market News</span>
            <h1>ข่าว <span class="text-grad-blue">ตลาด</span></h1>
            <p>ข่าว Forex และทองคำ สรุปและเรียบเรียงใหม่ พร้อมผลกระทบต่อตลาดและแหล่งที่มา</p>
          </div>

          <div class="tabs" id="catTabs" role="tablist">
            ${TT.newsCategories
              .map(
                (c, i) =>
                  `<button class="tabs__btn ${
                    i === 0 ? "is-active" : ""
                  }" data-cat="${c.id}" role="tab">${h.esc(c.label)}</button>`
              )
              .join("")}
          </div>

          <h2 class="news-section-title">
            <span>ข่าวล่าสุด</span>
            <span class="news-section-title__rule"></span>
          </h2>
          <div class="grid grid--3" id="newsLatest" aria-live="polite"></div>

          <div id="newsMoreWrap" hidden>
            <h2 class="news-section-title news-section-title--more">
              <span>ข่าวเพิ่มเติม</span>
              <span class="news-section-title__rule"></span>
            </h2>
            <div class="grid grid--3" id="newsMore" aria-live="polite"></div>
          </div>

          <div class="news-loadmore-wrap" id="newsLoadMoreWrap">
            <button class="btn btn--ghost news-loadmore-btn" id="newsLoadMoreBtn" type="button">
              โหลดข่าวเพิ่มเติม
            </button>
          </div>

          <div class="alert" style="margin-top:32px">
            <span class="alert__icon">${TT.icon("shield", 18)}</span>
            <div>
              ข่าวและบทความของเราเรียบเรียงใหม่จากแหล่งข้อมูลหลายแห่ง มีลิงก์กลับไปยังแหล่งที่มาเพื่อให้ผู้อ่านตรวจสอบได้
            </div>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "news",
      main,
    });
    TT.layout.initNavbar();

    document.getElementById("catTabs").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-cat]");
      if (!btn) return;
      if (state.loading) return;
      document
        .querySelectorAll("#catTabs .tabs__btn")
        .forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.category = btn.dataset.cat;
      resetAndLoad();
    });

    const moreBtn = document.getElementById("newsLoadMoreBtn");
    if (moreBtn) moreBtn.addEventListener("click", loadMore);

    resetAndLoad();
  }

  function resetAndLoad() {
    state.latestLoaded = false;
    state.moreOffset = LATEST_COUNT;
    state.hasMore = false;
    state.total = 0;
    state.shownIds = new Set();

    const latest = document.getElementById("newsLatest");
    const more = document.getElementById("newsMore");
    const moreWrap = document.getElementById("newsMoreWrap");
    const loadWrap = document.getElementById("newsLoadMoreWrap");
    if (more) more.innerHTML = "";
    if (moreWrap) moreWrap.hidden = true;
    if (loadWrap) loadWrap.hidden = true;
    loadLatest();
  }

  async function loadLatest() {
    const el = document.getElementById("newsLatest");
    if (!el) return;
    h.loading(el, LATEST_COUNT);
    try {
      const page = await TT.NewsService.fetchNews(state.category, {
        limit: LATEST_COUNT,
        offset: 0,
      });
      const items = page.items || [];
      state.total = page.total || items.length;
      // ตำแหน่งเริ่มข่าวเพิ่มเติม = จำนวนข่าวล่าสุดที่โหลดจริง
      state.moreOffset = items.length;
      markShown(items);

      if (!items.length) {
        el.innerHTML = "";
        h.empty(el, "ยังไม่มีข่าวในหมวดนี้");
        hideMoreSection();
        hideLoadMore();
        state.latestLoaded = true;
        return;
      }

      el.innerHTML = items.map(TT.cards.newsCard).join("");

      // มีข่าวเก่ากว่าส่วนล่าสุดไหม → เปิดส่วนข่าวเพิ่มเติม + ปุ่ม
      state.hasMore = state.moreOffset < state.total;
      if (state.hasMore) {
        showMoreSection();
        showLoadMoreIdle();
      } else {
        hideMoreSection();
        hideLoadMore();
      }
      state.latestLoaded = true;
    } catch (e) {
      el.innerHTML = "";
      renderLatestError();
    }
  }

  async function loadMore() {
    if (state.loading || !state.latestLoaded) return;
    const btn = document.getElementById("newsLoadMoreBtn");
    const wrap = document.getElementById("newsLoadMoreWrap");
    if (!btn) return;

    state.loading = true;
    setBtnLoading(btn, "กำลังโหลด...");

    try {
      const page = await TT.NewsService.fetchNews(state.category, {
        limit: MORE_PAGE,
        offset: state.moreOffset,
      });
      const items = page.items || [];
      state.total = page.total || state.total;
      // กันซ้ำ (dedupe) กับข่าวที่แสดงแล้ว — defense in depth
      const fresh = items.filter((n) => n && !state.shownIds.has(n.id));
      markShown(fresh);

      const moreEl = document.getElementById("newsMore");
      if (moreEl) moreEl.insertAdjacentHTML("beforeend", fresh.map(TT.cards.newsCard).join(""));

      // เลื่อน offset ตามจำนวนที่ API คืนจริง (ไม่ใช่ fresh) เพื่อให้ตำแหน่งถัดไปถูกต้อง
      state.moreOffset += items.length;
      state.hasMore = state.moreOffset < state.total && page.hasMore;

      if (state.hasMore) {
        setBtnIdle(btn, "โหลดข่าวเพิ่มเติม");
      } else {
        setBtnDone(btn, "แสดงข่าวครบแล้ว");
      }
      clearBtnRetryNote();
    } catch (e) {
      // แสดงข้อความไทย + ปุ่มลองอีกครั้ง (click ก็จะวนไป loadMore ที่มี state.loading guard)
      setBtnRetry(btn, "ลองอีกครั้ง");
      console.error("[news] load more failed:", e);
    } finally {
      state.loading = false;
    }
  }

  // ---------- helpers ----------
  function markShown(items) {
    for (const n of items) if (n && n.id) state.shownIds.add(n.id);
  }
  function showMoreSection() {
    const w = document.getElementById("newsMoreWrap");
    if (w) w.hidden = false;
  }
  function hideMoreSection() {
    const w = document.getElementById("newsMoreWrap");
    if (w) w.hidden = true;
  }
  function showLoadMoreIdle() {
    const wrap = document.getElementById("newsLoadMoreWrap");
    if (!wrap) return;
    wrap.hidden = false;
    const btn = document.getElementById("newsLoadMoreBtn");
    if (btn) setBtnIdle(btn, "โหลดข่าวเพิ่มเติม");
  }
  function hideLoadMore() {
    const wrap = document.getElementById("newsLoadMoreWrap");
    if (wrap) wrap.hidden = true;
  }

  function setBtnLoading(btn, label) {
    btn.disabled = true;
    btn.dataset.state = "loading";
    btn.textContent = label;
  }
  function setBtnIdle(btn, label) {
    btn.disabled = false;
    btn.dataset.state = "idle";
    btn.textContent = label;
  }
  function setBtnDone(btn, label) {
    btn.disabled = true;
    btn.dataset.state = "done";
    btn.textContent = label;
  }
  function setBtnRetry(btn, label) {
    // ไม่ตัดการเชื่อมต่อ click handler หลัก (loadMore) เพราะ loadMore
    // มี state.loading guard อยู่แล้ว และเมื่อสำเร็จจะปรับ label เอง
    btn.disabled = false;
    btn.dataset.state = "error";
    btn.textContent = label;
    const wrap = document.getElementById("newsLoadMoreWrap");
    if (wrap && !wrap.querySelector(".news-loadmore-note")) {
      const note = document.createElement("p");
      note.className = "news-loadmore-note";
      note.textContent = "โหลดข่าวเพิ่มเติมไม่สำเร็จ กรุณาลองอีกครั้ง";
      wrap.appendChild(note);
    }
  }

  function clearBtnRetryNote() {
    const note = document.querySelector("#newsLoadMoreWrap .news-loadmore-note");
    if (note) note.remove();
  }

  function renderLatestError() {
    const el = document.getElementById("newsLatest");
    if (!el) return;
    el.innerHTML = `<div class="state state--wide">
      <div class="state__title">⚠️ โหลดข่าวไม่สำเร็จ</div>
      <p>เกิดข้อผิดพลาดขณะเชื่อมต่อระบบข่าว กรุณาลองอีกครั้ง</p>
      <button class="btn btn--primary" type="button" id="newsRetryLatest">ลองอีกครั้ง</button>
    </div>`;
    const retry = document.getElementById("newsRetryLatest");
    if (retry) retry.addEventListener("click", () => loadLatest());
    hideMoreSection();
    hideLoadMore();
  }

  document.addEventListener("DOMContentLoaded", render);
})();
