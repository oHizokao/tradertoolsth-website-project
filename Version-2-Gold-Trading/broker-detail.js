/* ============================================================
   Page — Broker detail
   ============================================================ */

(function () {
  const h = TT.h;

  async function render() {
    const slug = h.query("slug");
    const app = document.getElementById("app");

    app.innerHTML = TT.layout.page({
      active: "brokers",
      main: `<section class="page"><div class="container">
        <div class="skeleton" style="height:200px"></div>
      </div></section>`,
    });
    TT.layout.initNavbar();

    if (!slug) return renderNotFound();

    try {
      const b = await TT.BrokerService.getBySlug(slug);
      if (!b) return renderNotFound();

      const main = `
        <section class="page">
          <div class="container">
            <a href="brokers.html" class="back-link">กลับไปยังรีวิวทั้งหมด</a>

            <div class="card broker-hero">
              <div style="display:flex;gap:20px;align-items:center">
                <div class="broker-hero__logo" style="color:${h.esc(
                  b.logoColor
                )}">${h.esc(b.shortName)}</div>
                <div>
                  <h1 style="margin-bottom:6px">${h.esc(b.name)}</h1>
                  <div class="broker-hero__rating">
                    <span class="stars">${h.stars(b.rating)}</span>
                    <span class="text-muted">${h.num(b.rating, 1)} / 5</span>
                    <span class="badge badge--accent">${h.num(
                      b.score,
                      1
                    )} / 10</span>
                  </div>
                </div>
              </div>
              <div class="cluster" style="justify-content:flex-end;align-items:flex-start">
                <div class="stack" style="gap:8px">
                  <span class="badge badge--lime">${TT.icon("check", 14)} เหมาะกับ ${h.esc(
        b.suitableFor
      )}</span>
                  <span class="badge">ฝากขั้นต่ำ $${h.num(b.minDeposit, 0)}</span>
                </div>
              </div>
            </div>

            <div class="grid grid--3" style="margin-top:24px">
              <div class="card">
                <h4 style="color:var(--accent);margin-bottom:8px;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.08em">ใบอนุญาต</h4>
                <p style="color:var(--text-primary);font-weight:500">${h.esc(
                  b.license
                )}</p>
                <ul style="margin-top:12px;padding-left:16px;list-style:disc">
                  ${b.regulation
                    .map((r) => `<li style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:4px">${h.esc(r)}</li>`)
                    .join("")}
                </ul>
              </div>
              <div class="card">
                <h4 style="color:var(--accent);margin-bottom:8px;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.08em">ค่าใช้จ่าย</h4>
                <div class="stack" style="gap:10px">
                  <div class="spec">
                    <span class="spec__label">Spread</span>
                    <span class="spec__value">${h.esc(b.spread)}</span>
                  </div>
                  <div class="spec">
                    <span class="spec__label">Commission</span>
                    <span class="spec__value">${h.esc(b.commission)}</span>
                  </div>
                  <div class="spec">
                    <span class="spec__label">ฝากขั้นต่ำ</span>
                    <span class="spec__value">$${h.num(b.minDeposit, 0)}</span>
                  </div>
                </div>
              </div>
              <div class="card">
                <h4 style="color:var(--accent);margin-bottom:8px;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.08em">ฝาก-ถอน & Platform</h4>
                <div class="stack" style="gap:10px">
                  <div class="spec">
                    <span class="spec__label">ฝาก/ถอน</span>
                    <span class="spec__value">${h.esc(b.depositWithdraw)}</span>
                  </div>
                  <div class="spec">
                    <span class="spec__label">Platform</span>
                    <span class="spec__value">${h.esc(b.platform.join(", "))}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid grid--2" style="margin-top:24px">
              <div class="card">
                <h4 style="margin-bottom:12px;display:flex;align-items:center;gap:8px">
                  <span class="badge badge--buy">${TT.icon("check", 14)}</span> ข้อดี
                </h4>
                <ul style="padding-left:20px;list-style:disc">
                  ${b.pros
                    .map(
                      (p) =>
                        `<li style="color:var(--text-secondary);margin-bottom:6px">${h.esc(p)}</li>`
                    )
                    .join("")}
                </ul>
              </div>
              <div class="card">
                <h4 style="margin-bottom:12px;display:flex;align-items:center;gap:8px">
                  <span class="badge badge--sell">${TT.icon("x", 14)}</span> ข้อจำกัด
                </h4>
                <ul style="padding-left:20px;list-style:disc">
                  ${b.cons
                    .map(
                      (c) =>
                        `<li style="color:var(--text-secondary);margin-bottom:6px">${h.esc(c)}</li>`
                    )
                    .join("")}
                </ul>
              </div>
            </div>

            <div class="card" style="margin-top:24px">
              <h3 style="margin-bottom:8px">ภาพรวม</h3>
              <p class="text-secondary">${h.esc(b.overview)}</p>
            </div>

            <div class="alert alert--warn" style="margin-top:24px">
              <span class="alert__icon">${TT.icon("warning", 18)}</span>
              <div>
                <strong>Disclosure:</strong> ${h.esc(b.affiliateDisclosure)} รีวิวนี้เป็นความเห็นของเรา ไม่ใช่คำแนะนำให้เปิดบัญชี ควรตรวจสอบข้อมูลกับโบรกเกอร์โดยตรงก่อนตัดสินใจ
              </div>
            </div>

            <div class="cluster" style="margin-top:24px;justify-content:center">
              <a href="contact.html" class="btn btn--primary btn--lg">สอบถามเพิ่มเติม</a>
              <a href="brokers.html" class="btn btn--ghost btn--lg">ดู Broker อื่น</a>
            </div>
          </div>
        </section>
      `;

      app.innerHTML = TT.layout.page({ active: "brokers", main });
      TT.layout.initNavbar();
      document.title = `${b.name} — รีวิว Broker — ${TT.site.name}`;
    } catch (e) {
      TT.h.error(document.querySelector("#main") || app, "โหลดข้อมูล Broker ไม่สำเร็จ");
    }
  }

  function renderNotFound() {
    const main = `<section class="page">
      <div class="container container--narrow">
        <div class="state" style="padding-block:80px">
          <div class="state__title">ไม่พบ Broker ที่คุณค้นหา</div>
          <a href="brokers.html" class="btn btn--primary" style="margin-top:16px">กลับไปยังรีวิวทั้งหมด</a>
        </div>
      </div>
    </section>`;
    document.getElementById("app").innerHTML = TT.layout.page({
      active: "brokers",
      main,
    });
    TT.layout.initNavbar();
  }

  document.addEventListener("DOMContentLoaded", render);
})();
