/* ============================================================
   Page — FAQ
   ============================================================ */

(function () {
  const h = TT.h;

  function render() {
    const list = TT.faq || [];
    const main = `
      <section class="page">
        <div class="container container--narrow">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("faq", 14)} FAQ</span>
            <h1>คำถาม <span class="text-grad-blue">ที่พบบ่อย</span></h1>
            <p>รวบรวมคำถามที่ผู้ใช้สงสัยบ่อยที่สุดเกี่ยวกับ Signal การใช้งาน และการติดต่อ</p>
          </div>

          <div id="faqList">
            ${list
              .map(
                (item, i) => `<div class="faq-item" data-faq="${i}">
                <button class="faq-item__q" aria-expanded="false" aria-controls="faq-a-${i}">
                  <span>${h.esc(item.q)}</span>
                  <span class="faq-item__icon" aria-hidden="true">+</span>
                </button>
                <div class="faq-item__a" id="faq-a-${i}" role="region">
                  <div class="faq-item__a-inner">${h.esc(item.a)}</div>
                </div>
              </div>`
              )
              .join("")}
          </div>

          <div class="card" style="margin-top:32px;text-align:center">
            <h3 style="margin-bottom:8px">ยังไม่พบคำตอบที่คุณหา?</h3>
            <p class="text-secondary" style="margin-bottom:16px">ทีมงานพร้อมตอบทุกคำถามของคุณ</p>
            <a href="contact.html" class="btn btn--primary">${TT.icon("contact", 16)} ติดต่อเรา</a>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "faq",
      main,
    });
    TT.layout.initNavbar();
    bindAccordion();
  }

  function bindAccordion() {
    const items = document.querySelectorAll(".faq-item");
    items.forEach((item) => {
      const btn = item.querySelector(".faq-item__q");
      const ans = item.querySelector(".faq-item__a");
      btn.addEventListener("click", () => {
        const isOpen = item.classList.contains("is-open");
        // ปิดอันอื่น (optional - ปล่อยเปิดได้หลายอัน)
        // items.forEach((i) => { i.classList.remove("is-open"); i.querySelector(".faq-item__q").setAttribute("aria-expanded","false"); i.querySelector(".faq-item__a").style.maxHeight = 0; });

        if (isOpen) {
          item.classList.remove("is-open");
          btn.setAttribute("aria-expanded", "false");
          ans.style.maxHeight = 0;
        } else {
          item.classList.add("is-open");
          btn.setAttribute("aria-expanded", "true");
          ans.style.maxHeight = ans.scrollHeight + "px";
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", render);
})();
