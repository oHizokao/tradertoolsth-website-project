/* ============================================================
   Page — Broker detail (v2)
   ------------------------------------------------------------
   หลักการ:
   - แสดงเฉพาะข้อมูลที่ตรวจสอบได้จากแหล่งทางการ
   - ไม่มี score / stars / spread / commission / โบนัส / ความเร็วถอน
     (เพราะไม่มีแหล่งอ้างอิงที่ตรวจสอบได้ในรอบนี้)
   - ฟิลด์ที่ยังยืนยันไม่ได้จะแสดง "รอตรวจสอบ"
   - มี disclaimer, methodology และรายการแหล่งอ้างอิง (sources)
     พร้อมวันที่ตรวจสอบ
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
      app.innerHTML = TT.layout.page({ active: "brokers", main: buildMain(b) });
      TT.layout.initNavbar();
      document.title = `${b.name} — ข้อมูลโบรกเกอร์ — ${TT.site.name}`;
    } catch (e) {
      h.error(document.querySelector("#main") || app, "โหลดข้อมูล Broker ไม่สำเร็จ");
    }
  }

  function buildMain(b) {
    const status = h.verificationStatusInfo(b.verificationStatus);
    return `
      <section class="page broker-detail">
        <div class="container">
          <a href="brokers.html" class="back-link">กลับไปยังรายการทั้งหมด</a>

          ${riskWarningBlock()}

          <div class="card broker-hero">
            <div style="display:flex;gap:20px;align-items:center;min-width:0">
              <div class="broker-hero__logo" style="color:${h.esc(
                b.logoColor
              )}">${h.esc(b.shortName)}</div>
              <div style="min-width:0">
                <h1 style="margin-bottom:6px">${h.esc(b.name)}</h1>
                <div class="cluster" style="gap:8px;flex-wrap:wrap">
                  <span class="badge ${status.cls}">${h.esc(status.label)}</span>
                  <span class="text-muted" style="font-size:var(--fs-sm)">ตรวจสอบเมื่อ <span class="num">${h.esc(b.verifiedAt)}</span></span>
                </div>
              </div>
            </div>
            <div class="cluster" style="justify-content:flex-end;align-items:flex-start">
              <div class="stack" style="gap:8px">
                <a href="${h.esc(b.officialUrl)}" target="_blank" rel="noopener nofollow" class="btn btn--soft btn--sm">เว็บไซต์ทางการ ↗</a>
                <span class="badge">${h.esc((b.platforms || []).join(" · "))}</span>
              </div>
            </div>
          </div>

          ${verificationNoteBlock(b)}

          <div class="grid grid--3" style="margin-top:24px">
            ${regulationCard(b)}
            ${accountCard(b)}
            ${fundingCard(b)}
          </div>

          <div class="grid grid--2" style="margin-top:24px">
            ${listCard("จุดเด่น (ตามข้อมูลทางการ)", b.highlights, "badge--buy", "check")}
            ${listCard("ข้อควรพิจารณา", b.considerations, "badge--sell", "x")}
          </div>

          <div class="card" style="margin-top:24px">
            <h3 style="margin-bottom:8px">ภาพรวม</h3>
            <p class="text-secondary">${h.esc(b.overview)}</p>
            <div class="spec" style="margin-top:16px">
              <span class="spec__label">เหมาะกับใคร</span>
              <span class="spec__value">${h.esc(b.suitableFor)}</span>
            </div>
          </div>

          ${sourcesBlock(b)}

          ${methodologyBlock()}

          ${disclaimerBlock(b)}

          <div class="cluster" style="margin-top:24px;justify-content:center">
            <a href="brokers.html" class="btn btn--ghost btn--lg">ดู Broker อื่น</a>
          </div>
        </div>
      </section>
    `;
  }

  function riskWarningBlock() {
    return `<div class="alert alert--warn" style="margin:18px 0">
      <span class="alert__icon">${TT.icon("warning", 18)}</span>
      <div>
        <strong>คำเตือนความเสี่ยง:</strong> ${h.esc(
          TT.site.riskWarning ||
            "การเทรดมีความเสี่ยงสูง อาจสูญเสียเงินทุนทั้งหมด ข้อมูลบนเว็บไซต์เป็นเพียงข้อมูลอ้างอิง ไม่ใช่คำแนะนำให้ลงทุน"
        )}
      </div>
    </div>`;
  }

  function verificationNoteBlock(b) {
    if (!b.verificationNote) return "";
    return `<div class="alert alert--info" style="margin-top:18px">
      <span class="alert__icon">${TT.icon("info", 18)}</span>
      <div>
        <strong>สถานะการตรวจสอบ:</strong> ${h.esc(b.verificationNote)}
      </div>
    </div>`;
  }

  function regulationCard(b) {
    const rows = (b.regulations || [])
      .map((r) => {
        const license = r.licenseNo
          ? h.esc(r.licenseNo)
          : "<span class='text-muted'>รอตรวจสอบ</span>";
        const entity = r.entity ? h.esc(r.entity) : "<span class='text-muted'>—</span>";
        const regVerifiedTag = r.registryVerified
          ? `<span class="badge badge--buy" style="margin-left:6px">ยืนยันใน registry</span>`
          : `<span class="badge badge--gold" style="margin-left:6px">ระบุโดยโบรกเกอร์</span>`;
        const brokerLink = r.brokerPageUrl
          ? `<a href="${h.esc(r.brokerPageUrl)}" target="_blank" rel="noopener nofollow" class="section-link">หน้าทางการ ↗</a>`
          : "";
        const registryLink = r.registryUrl
          ? `<a href="${h.esc(r.registryUrl)}" target="_blank" rel="noopener nofollow" class="section-link">registry ↗</a>`
          : "<span class='text-muted'>registry: รอตรวจสอบ</span>";
        const note = r.note ? `<div class="text-muted" style="font-size:var(--fs-xs);margin-top:4px">${h.esc(r.note)}</div>` : "";
        return `<li class="reg-item">
          <div class="reg-item__head">
            <span class="badge badge--ghost">${h.esc(r.regulator)}</span>
            ${regVerifiedTag}
          </div>
          <div class="reg-item__line"><span class="text-muted">นิติบุคคล:</span> ${entity}</div>
          <div class="reg-item__line"><span class="text-muted">เลขใบอนุญาต:</span> ${license}</div>
          <div class="reg-item__links">${brokerLink} ${registryLink}</div>
          ${note}
        </li>`;
      })
      .join("");
    return `<div class="card">
      <h4 class="card-section__title">หน่วยงานกำกับดูแล / ใบอนุญาต</h4>
      <ul class="reg-list">${rows || "<li class='text-muted'>รอตรวจสอบ</li>"}</ul>
    </div>`;
  }

  function accountCard(b) {
    const rows = (b.accountTypes || [])
      .map((a) => {
        const v =
          a.minDepositUsd === null || a.minDepositUsd === undefined
            ? "<span class='text-muted'>รอตรวจสอบ</span>"
            : a.minDepositUsd === 0
            ? "<span class='num'>ไม่ระบุขั้นต่ำ</span>"
            : `<span class="num">$${h.num(a.minDepositUsd, 0)}</span>`;
        const note = a.note
          ? `<div class="text-muted" style="font-size:var(--fs-xs);margin-top:2px">${h.esc(a.note)}</div>`
          : "";
        return `<li class="acct-item">
          <div class="acct-item__name">${h.esc(a.name)}</div>
          <div>ฝากขั้นต่ำ: ${v}</div>
          ${note}
        </li>`;
      })
      .join("");
    return `<div class="card">
      <h4 class="card-section__title">ประเภทบัญชี / ฝากขั้นต่ำ</h4>
      <ul class="acct-list">${rows || "<li class='text-muted'>รอตรวจสอบ</li>"}</ul>
      <p class="text-muted" style="font-size:var(--fs-xs);margin-top:8px">ตามข้อมูลที่ตรวจสอบได้จากหน้าทางการ อาจแตกต่างตามนิติบุคคล/ภูมิภาค</p>
    </div>`;
  }

  function fundingCard(b) {
    const methods =
      b.fundingMethods && b.fundingMethods.length
        ? b.fundingMethods
            .map((m) => `<span class="badge badge--ghost">${h.esc(m)}</span>`)
            .join("")
        : "<span class='text-muted'>รอตรวจสอบ</span>";
    return `<div class="card">
      <h4 class="card-section__title">ช่องทางฝาก-ถอน & แพลตฟอร์ม</h4>
      <div class="spec" style="margin-bottom:12px">
        <span class="spec__label">ช่องทางฝาก/ถอน</span>
        <div class="cluster" style="gap:6px;flex-wrap:wrap;margin-top:6px">${methods}</div>
      </div>
      <div class="spec">
        <span class="spec__label">แพลตฟอร์ม</span>
        <div class="cluster" style="gap:6px;flex-wrap:wrap;margin-top:6px">
          ${(b.platforms || [])
            .map((p) => `<span class="badge">${h.esc(p)}</span>`)
            .join("")}
        </div>
      </div>
    </div>`;
  }

  function listCard(title, items, badgeCls, iconName) {
    const lis = (items || [])
      .map(
        (t) =>
          `<li style="color:var(--text-secondary);margin-bottom:6px;display:flex;gap:8px;align-items:flex-start">
            <span class="badge ${badgeCls}" style="flex:0 0 auto;margin-top:2px">${TT.icon(
            iconName,
            12
          )}</span>
            <span>${h.esc(t)}</span>
          </li>`
      )
      .join("");
    return `<div class="card">
      <h4 style="margin-bottom:12px">${h.esc(title)}</h4>
      <ul style="padding-left:0;list-style:none">${lis || "<li class='text-muted'>รอตรวจสอบ</li>"}</ul>
    </div>`;
  }

  function sourcesBlock(b) {
    const rows = (b.sources || [])
      .map(
        (s) =>
          `<li class="source-item">
            <span class="source-item__field">${h.esc(s.field)}</span>
            <a href="${h.esc(s.url)}" target="_blank" rel="noopener nofollow" class="section-link">${h.esc(
            s.label || s.url
          )} ↗</a>
            <span class="text-muted" style="font-size:var(--fs-xs)">ตรวจสอบ ${h.esc(s.verifiedAt)}</span>
          </li>`
      )
      .join("");
    return `<div class="card" style="margin-top:24px">
      <h3 style="margin-bottom:12px">แหล่งข้อมูลอ้างอิง (Sources)</h3>
      <p class="text-muted" style="font-size:var(--fs-sm);margin-bottom:12px">รายการลิงก์แหล่งข้อมูลทางการที่ใช้ในการตรวจสอบ ผู้ใช้สามารถตรวจสอบซ้ำได้ด้วยตนเอง</p>
      <ul class="source-list">${rows}</ul>
    </div>`;
  }

  function methodologyBlock() {
    const m = TT.brokerMethodology;
    if (!m) return "";
    const items = (m.criteria || [])
      .map(
        (c) => `<li class="methodology__item">
          <strong>${h.esc(c.label)}</strong>
          <span class="text-secondary">${h.esc(c.desc)}</span>
        </li>`
      )
      .join("");
    return `<details class="card methodology" style="margin-top:24px">
      <summary class="methodology__summary">
        <span class="badge badge--accent">${TT.icon("info", 14)} วิธีตรวจสอบข้อมูล</span>
        <span>${h.esc(m.title)} <span class="text-muted" style="font-size:var(--fs-xs)">· อัปเดต ${h.esc(m.updatedAt)}</span></span>
      </summary>
      <ol class="methodology__list">${items}</ol>
    </details>`;
  }

  function disclaimerBlock(b) {
    const affiliate =
      TT.brokerAffiliateDisclosure ||
      "ลิงก์บางลิงก์อาจเป็นลิงก์พันธมิตร ข้อมูลไม่ได้จัดทำขึ้นเพื่อชี้นำให้ลงทุน";
    return `<div class="alert alert--warn" style="margin-top:24px">
      <span class="alert__icon">${TT.icon("warning", 18)}</span>
      <div>
        <strong>Disclaimer:</strong> ${h.esc(affiliate)}
        <br><br>
        รีวิวนี้รวบรวมข้อมูลเชิงข้อเท็จจริงจากแหล่งทางการเพื่อการเปรียบเทียบ <strong>ไม่ใช่คำแนะนำให้เปิดบัญชีหรือลงทุน</strong> ข้อมูลอาจเปลี่ยนแปลงตามนิติบุคคลและภูมิภาค ผู้ใช้ควรตรวจสอบกับโบรกเกอร์และหน่วยงานกำกับดูแลโดยตรงก่อนตัดสินใจ และใช้ดุลยพินิจของตนเองทั้งหมด
      </div>
    </div>`;
  }

  function renderNotFound() {
    const main = `<section class="page">
      <div class="container container--narrow">
        <div class="state" style="padding-block:80px">
          <div class="state__title">ไม่พบ Broker ที่คุณค้นหา</div>
          <a href="brokers.html" class="btn btn--primary" style="margin-top:16px">กลับไปยังรายการทั้งหมด</a>
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
