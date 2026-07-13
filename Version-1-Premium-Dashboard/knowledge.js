/* ============================================================
   Page — Knowledge
   ============================================================ */

(function () {
  const h = TT.h;

  function renderBody(body) {
    return body
      .map((b) => {
        if (b.type === "h2") return `<h2>${h.esc(b.text)}</h2>`;
        if (b.type === "h3") return `<h3>${h.esc(b.text)}</h3>`;
        if (b.type === "p") return `<p>${h.esc(b.text)}</p>`;
        if (b.type === "ul")
          return `<ul>${b.items
            .map((i) => `<li>${h.esc(i)}</li>`)
            .join("")}</ul>`;
        if (b.type === "ol")
          return `<ol>${b.items
            .map((i) => `<li>${h.esc(i)}</li>`)
            .join("")}</ol>`;
        return "";
      })
      .join("");
  }

  function render() {
    const list = TT.knowledge || [];

    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("knowledge", 14)} Knowledge Base</span>
            <h1>ความรู้ <span class="text-grad-blue">การเทรด</span></h1>
            <p>บทความพื้นฐานที่เทรดเดอร์ทุกคนควรอ่าน ตั้งแต่ Forex ทองคำ การบริหารความเสี่ยง จนถึงการใช้ปฏิทินเศรษฐกิจ</p>
          </div>

          <div class="section-header">
            <div class="section-title">
              <span class="eyebrow">Articles</span>
              <h2>บทความทั้งหมด</h2>
            </div>
          </div>
          <div class="grid grid--3">
            ${list.map(TT.cards.knowledgeCard).join("")}
          </div>

          <div class="divider"></div>

          <div class="section-header">
            <div class="section-title">
              <span class="eyebrow">Full Content</span>
              <h2>อ่านบทความฉบับเต็ม</h2>
            </div>
          </div>

          ${list
            .map(
              (k) => `<article id="${h.esc(
                k.slug
              )}" class="card" style="margin-bottom:24px;scroll-margin-top:calc(var(--navbar-h) + 20px)">
                <div class="cluster--between" style="display:flex;margin-bottom:12px">
                  <span class="badge badge--accent">${h.esc(k.category)}</span>
                  <span class="text-muted" style="font-size:var(--fs-xs)">${k.readMinutes} นาทีอ่าน</span>
                </div>
                <h3 style="margin-bottom:12px">${h.esc(k.title)}</h3>
                <p class="text-secondary" style="margin-bottom:16px">${h.esc(
                  k.excerpt
                )}</p>
                <div class="prose">${renderBody(k.body)}</div>
              </article>`
            )
            .join("")}

          <div class="alert alert--warn" style="margin-top:32px">
            <span class="alert__icon">${TT.icon("warning", 18)}</span>
            <div>เนื้อหาในส่วนความรู้เป็นการให้ข้อมูลเบื้องต้น ไม่ใช่คำแนะนำให้ลงทุน ผลลัพธ์การเทรดขึ้นอยู่กับการตัดสินใจและการบริหารความเสี่ยงของคุณ</div>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "knowledge",
      main,
    });
    TT.layout.initNavbar();

    // ถ้ามี hash ให้ scroll ไป
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", render);
})();
