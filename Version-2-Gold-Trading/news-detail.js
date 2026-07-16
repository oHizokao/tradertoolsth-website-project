/* ============================================================
   Page — News detail
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

  async function render() {
    const slug = h.query("slug");
    const app = document.getElementById("app");

    // loading shell
    app.innerHTML = TT.layout.page({
      active: "news",
      main: `<section class="page"><div class="container container--narrow">
        <div class="skeleton" style="height:14px;width:30%;margin-bottom:12px"></div>
        <div class="skeleton" style="height:32px;width:80%;margin-bottom:16px"></div>
        <div class="skeleton" style="height:18px;width:100%;margin-bottom:8px"></div>
        <div class="skeleton" style="height:18px;width:90%"></div>
      </div></section>`,
    });
    TT.layout.initNavbar();

    if (!slug) {
      return renderNotFound();
    }

    try {
      const n = await TT.NewsService.getBySlug(slug);
      if (!n) return renderNotFound();

      const catLabel = n.category === "gold" ? "ทองคำ" : "Forex";
      const catBadge = n.category === "gold" ? "badge--lime" : "badge--accent";

      const main = `
        <section class="page">
          <div class="container container--narrow">
            <a href="news.html" class="back-link">กลับไปยังข่าวทั้งหมด</a>

            <article>
              <div class="article-head">
                <div class="article-head__meta">
                  <span class="badge ${catBadge}">${catLabel}</span>
                  <span class="badge badge--${n.impact}">${h.impactText(
        n.impact
      )} Impact</span>
                  <span>•</span>
                  <span>${h.formatBangkok(n.sourcePublishedAt || n.publishedAt)}</span>
                  <span>•</span>
                  <span>${n.readMinutes} นาทีอ่าน</span>
                </div>
                <h1>${h.esc(n.title)}</h1>
                <p class="text-secondary" style="font-size:var(--fs-md);margin-top:12px">${h.esc(
                  n.excerpt
                )}</p>
              </div>

              <img src="${h.esc(n.cover)}" alt="${h.esc(
        n.title
      )}" class="article-cover" onerror="this.style.display='none'">

              ${
                n.imageCredit && n.imageCredit.source
                  ? `<p class="text-muted" style="font-size:var(--fs-xs);margin-top:8px">
                    ภาพ: ${h.esc(n.imageCredit.author || n.imageCredit.source)} / ${h.esc(n.imageCredit.source)}
                    ${n.imageCredit.sourceUrl ? ` • <a href="${h.esc(n.imageCredit.sourceUrl)}" target="_blank" rel="noopener">ดูที่มาภาพ</a>` : ""}
                  </p>`
                  : ""
              }

              <div class="prose">
                ${renderBody(n.body)}
              </div>

              ${
                n.impactOnMarket
                  ? `<div class="article-impact">
                    <h4>ผลกระทบต่อตลาด</h4>
                    <p style="margin:0">${h.esc(n.impactOnMarket)}</p>
                  </div>`
                  : ""
              }

              <div class="alert" style="margin-top:24px">
                <span class="alert__icon">${TT.icon("shield", 18)}</span>
                <div>
                  <strong>แหล่งที่มา:</strong> ${h.esc(n.source)}
                  ${
                    n.sourceUrl && n.sourceUrl !== "#"
                      ? ` • <a href="${h.esc(n.sourceUrl)}" target="_blank" rel="noopener">ดูต้นฉบับ</a>`
                      : ""
                  }
                </div>
              </div>

              ${
                n.importedAt
                  ? `<p class="text-muted" style="font-size:var(--fs-xs);margin-top:8px">${h.formatImported(n.importedAt)}</p>`
                  : ""
              }

              <div class="alert alert--warn" style="margin-top:16px">
                <span class="alert__icon">${TT.icon("warning", 18)}</span>
                <div>เนื้อหานี้เป็นการเรียบเรียงใหม่เพื่อความเข้าใจ ไม่ใช่คำแนะนำให้ซื้อหรือขาย</div>
              </div>
            </article>
          </div>
        </section>
      `;

      app.innerHTML = TT.layout.page({ active: "news", main });
      TT.layout.initNavbar();
      document.title = `${n.title} — ${TT.site.name}`;
    } catch (e) {
      TT.h.error(
        document.querySelector("#main .container") || app,
        "โหลดข่าวไม่สำเร็จ"
      );
    }
  }

  function renderNotFound() {
    const main = `<section class="page">
      <div class="container container--narrow">
        <div class="state" style="padding-block:80px">
          <div class="state__title">ไม่พบข่าวที่คุณค้นหา</div>
          <p>อาจถูกลบหรือย้ายแล้ว</p>
          <a href="news.html" class="btn btn--primary" style="margin-top:16px">กลับไปยังข่าวทั้งหมด</a>
        </div>
      </div>
    </section>`;
    document.getElementById("app").innerHTML = TT.layout.page({
      active: "news",
      main,
    });
    TT.layout.initNavbar();
  }

  document.addEventListener("DOMContentLoaded", render);
})();
