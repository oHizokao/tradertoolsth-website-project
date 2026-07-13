/* ============================================================
   Page — News list
   ============================================================ */

(function () {
  const h = TT.h;
  let state = { category: "all" };

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

          <div class="grid grid--3" id="newsList"></div>

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
      document
        .querySelectorAll("#catTabs .tabs__btn")
        .forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.category = btn.dataset.cat;
      loadList();
    });

    loadList();
  }

  async function loadList() {
    const el = document.getElementById("newsList");
    TT.h.loading(el, 3);
    try {
      const list = await TT.NewsService.fetchNews(state.category);
      if (!list.length) return TT.h.empty(el, "ยังไม่มีข่าวในหมวดนี้");
      el.innerHTML = list.map(TT.cards.newsCard).join("");
    } catch (e) {
      TT.h.error(el);
    }
  }

  document.addEventListener("DOMContentLoaded", render);
})();
