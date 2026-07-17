/* ============================================================
   Page — Broker list (v2)
   ------------------------------------------------------------
   คุณสมบัติ:
   - filter ตาม regulator / platform / ค้นหาชื่อ
   - compare (เลือก 2–4 โบรกเกอร์ → ตารางเปรียบเทียบ)
   - แสดง "วิธีให้คะแนน" (methodology) อย่างโปร่งใส
   - risk warning และ affiliate disclosure
   - ทุก claim มีลิงก์แหล่งข้อมูลในหน้ารายละเอียด
   ============================================================ */

(function () {
  const h = TT.h;

  // state ของตัวกรองและการเปรียบเทียบ
  const state = {
    regulator: "",
    platform: "",
    search: "",
    sort: "name",
    compare: new Set(), // เก็บ slug ที่เลือกเปรียบเทียบ
  };

  const MAX_COMPARE = 4;

  function render() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page broker-page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("broker", 14)} Broker Database</span>
            <h1>ฐานข้อมูล <span class="text-grad-blue">Broker</span></h1>
            <p>ข้อมูลโบรกเกอร์ที่รวบรวมจากเว็บไซต์ทางการและหน่วยงานกำกับดูแลเท่านั้น ทุกข้อมูลสำคัญมีลิงก์อ้างอิงและวันที่ตรวจสอบให้ผู้ใช้ตรวจสอบซ้ำได้ มีเครื่องมือกรองและเปรียบเทียบ และไม่มีการจัดอันดับหรือให้คะแนน</p>
          </div>

          ${riskWarningBlock()}

          <div class="broker-controls" id="brokerControls">
            <div class="broker-controls__filters">
              <div class="field">
                <label for="fRegulator" class="field__label">หน่วยงานกำกับดูแล</label>
                <select id="fRegulator" class="field__input"><option value="">ทั้งหมด</option></select>
              </div>
              <div class="field">
                <label for="fPlatform" class="field__label">แพลตฟอร์ม</label>
                <select id="fPlatform" class="field__input"><option value="">ทั้งหมด</option></select>
              </div>
              <div class="field">
                <label for="fSearch" class="field__label">ค้นหาชื่อ</label>
                <input id="fSearch" type="search" class="field__input" placeholder="เช่น XM, Exness" autocomplete="off">
              </div>
              <div class="field">
                <label for="fSort" class="field__label">เรียงตาม</label>
                <select id="fSort" class="field__input">
                  <option value="name">ชื่อ (ก–Z)</option>
                  <option value="updated">วันที่ตรวจสอบล่าสุด</option>
                </select>
              </div>
            </div>
            <div class="broker-controls__meta">
              <span id="brokerCount" class="text-muted" style="font-size:var(--fs-sm)"></span>
              <button type="button" id="resetFilters" class="btn btn--ghost btn--xs">ล้างตัวกรอง</button>
            </div>
          </div>

          <div class="broker-compare-bar" id="brokerCompareBar" hidden>
            <div class="broker-compare-bar__info">
              <strong>เปรียบเทียบ:</strong>
              <span id="compareCount" class="text-muted" style="font-size:var(--fs-sm)"></span>
            </div>
            <div class="broker-compare-bar__actions">
              <button type="button" id="compareBtn" class="btn btn--soft btn--sm" disabled>เปรียบเทียบตอนนี้</button>
              <button type="button" id="clearCompare" class="btn btn--ghost btn--xs">ยกเลิก</button>
            </div>
          </div>

          <div class="grid grid--2" id="brokerList"></div>

          ${compareSection()}

          ${methodologyBlock()}

          ${affiliateDisclosureBlock()}
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "brokers",
      main,
    });
    TT.layout.initNavbar();
    initControls();
    loadList();
    syncCompareBar();
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

  function affiliateDisclosureBlock() {
    const text =
      TT.brokerAffiliateDisclosure ||
      "ลิงก์บางลิงก์อาจเป็นลิงก์พันธมิตร ข้อมูลไม่ได้จัดทำขึ้นเพื่อชี้นำให้ลงทุน";
    return `<div class="alert alert--info" style="margin-top:24px">
      <span class="alert__icon">${TT.icon("shield", 18)}</span>
      <div>
        <strong>หมายเหตุ Affiliate / ความโปร่งใส:</strong> ${h.esc(text)}
      </div>
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
        <span class="badge badge--accent">${TT.icon("info", 14)} วิธีให้คะแนน</span>
        <span>${h.esc(m.title)} <span class="text-muted" style="font-size:var(--fs-xs)">· อัปเดต ${h.esc(m.updatedAt)}</span></span>
      </summary>
      <ol class="methodology__list">${items}</ol>
      <p class="text-muted" style="font-size:var(--fs-xs);margin-top:12px">
        เราไม่ได้กำหนดคะแนนรวมหรือจัดอันดับโบรกเกอร์ หัวข้อ "วิธีให้คะแนน" หมายถึงเกณฑ์ที่เราใช้ตรวจสอบและคัดกรองข้อมูลเพื่อแสดงบนเว็บไซต์เท่านั้น
      </p>
    </details>`;
  }

  function compareSection() {
    return `<section id="compareSection" class="broker-compare-wrap" hidden style="margin-top:24px">
      <div class="card">
        <div class="cluster" style="justify-content:space-between;margin-bottom:12px">
          <h3 style="margin:0">ตารางเปรียบเทียบ</h3>
          <button type="button" id="closeCompare" class="btn btn--ghost btn--xs">ปิด</button>
        </div>
        <div class="table-wrap">
          <table class="compare-table" id="compareTable"></table>
        </div>
      </div>
    </section>`;
  }

  function initControls() {
    // regulator options
    const regSel = document.getElementById("fRegulator");
    TT.BrokerService.listRegulators().forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      regSel.appendChild(opt);
    });
    // platform options
    const platSel = document.getElementById("fPlatform");
    TT.BrokerService.listPlatforms().forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      platSel.appendChild(opt);
    });

    const regEl = document.getElementById("fRegulator");
    const platEl = document.getElementById("fPlatform");
    const searchEl = document.getElementById("fSearch");
    const sortEl = document.getElementById("fSort");

    regEl.addEventListener("change", () => {
      state.regulator = regEl.value;
      loadList();
    });
    platEl.addEventListener("change", () => {
      state.platform = platEl.value;
      loadList();
    });
    let searchTimer = null;
    searchEl.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = searchEl.value;
        loadList();
      }, 200);
    });
    sortEl.addEventListener("change", () => {
      state.sort = sortEl.value;
      loadList();
    });
    document.getElementById("resetFilters").addEventListener("click", () => {
      state.regulator = "";
      state.platform = "";
      state.search = "";
      state.sort = "name";
      regEl.value = "";
      platEl.value = "";
      searchEl.value = "";
      sortEl.value = "name";
      loadList();
    });

    // compare handlers
    document.getElementById("compareBtn").addEventListener("click", runCompare);
    document.getElementById("clearCompare").addEventListener("click", clearCompare);
    document.getElementById("closeCompare").addEventListener("click", () => {
      document.getElementById("compareSection").hidden = true;
    });

    // ตรวจ checkbox เปรียบเทียบจากการคลิกในการ์ด (event delegation)
    document.getElementById("brokerList").addEventListener("change", (ev) => {
      const cb = ev.target.closest(".broker-compare__cb");
      if (!cb) return;
      const slug = cb.dataset.slug;
      if (cb.checked) {
        if (state.compare.size >= MAX_COMPARE) {
          cb.checked = false;
          return;
        }
        state.compare.add(slug);
      } else {
        state.compare.delete(slug);
      }
      syncCompareBar();
    });
  }

  async function loadList() {
    const el = document.getElementById("brokerList");
    h.loading(el, 4);
    try {
      const list = await TT.BrokerService.fetchBrokers({
        regulator: state.regulator,
        platform: state.platform,
        search: state.search,
        sort: state.sort,
      });
      const countEl = document.getElementById("brokerCount");
      if (countEl) countEl.textContent = `พบ ${list.length} โบรกเกอร์`;
      if (!list.length) {
        return h.empty(el, "ไม่พบโบรกเกอร์ที่ตรงกับตัวกรอง", "ลองล้างตัวกรองหรือเปลี่ยนเงื่อนไข");
      }
      el.innerHTML = list.map(TT.cards.brokerCard).join("");
      // sync compare checkboxes ตาม state ปัจจุบัน
      el.querySelectorAll(".broker-compare__cb").forEach((cb) => {
        cb.checked = state.compare.has(cb.dataset.slug);
      });
    } catch (e) {
      h.error(el);
    }
  }

  function syncCompareBar() {
    const bar = document.getElementById("brokerCompareBar");
    const countEl = document.getElementById("compareCount");
    const btn = document.getElementById("compareBtn");
    if (!bar) return;
    const n = state.compare.size;
    bar.hidden = n === 0;
    if (countEl)
      countEl.textContent = n > 0 ? `เลือกแล้ว ${n} / ${MAX_COMPARE} (ขั้นต่ำ 2)` : "";
    if (btn) btn.disabled = n < 2;
  }

  function clearCompare() {
    state.compare.clear();
    document
      .querySelectorAll(".broker-compare__cb")
      .forEach((cb) => (cb.checked = false));
    syncCompareBar();
    const sec = document.getElementById("compareSection");
    if (sec) sec.hidden = true;
  }

  async function runCompare() {
    const sec = document.getElementById("compareSection");
    const tbl = document.getElementById("compareTable");
    if (!sec || !tbl) return;
    sec.hidden = false;
    tbl.innerHTML = `<tr><td class="text-muted">กำลังโหลด…</td></tr>`;
    try {
      const rows = await TT.BrokerService.compare(Array.from(state.compare));
      if (!rows.length) {
        tbl.innerHTML = `<tr><td class="text-muted">ไม่พบข้อมูล</td></tr>`;
        return;
      }
      renderCompareTable(tbl, rows);
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      tbl.innerHTML = `<tr><td class="text-sell">โหลดข้อมูลเปรียบเทียบไม่สำเร็จ</td></tr>`;
    }
  }

  function renderCompareTable(tbl, rows) {
    const head = `<tr><th>รายการ</th>${rows
      .map(
        (b) =>
          `<th><a href="broker-detail.html?slug=${encodeURIComponent(
            b.slug
          )}" style="color:inherit">${h.esc(b.name)}</a></th>`
      )
      .join("")}</tr>`;

    function row(label, getter) {
      return `<tr><td class="compare-table__label">${h.esc(label)}</td>${rows
        .map((b) => `<td>${getter(b)}</td>`)
        .join("")}</tr>`;
    }

    const statusInfo = (b) => {
      const s = h.verificationStatusInfo(b.verificationStatus);
      return `<span class="badge ${s.cls}">${h.esc(s.label)}</span>`;
    };
    const regs = (b) =>
      (b.regulations || [])
        .map((r) => `<div class="compare-cell__line"><span class="badge badge--ghost">${h.esc(r.regulator)}</span></div>`)
        .join("") || h.orPending(null);
    const accs = (b) =>
      (b.accountTypes || [])
        .map((a) => {
          const v =
            a.minDepositUsd == null
              ? "—"
              : a.minDepositUsd === 0
              ? "ไม่ระบุขั้นต่ำ"
              : `$${h.num(a.minDepositUsd, 0)}`;
          return `<div class="compare-cell__line">${h.esc(a.name)}: <span class="num">${v}</span></div>`;
        })
        .join("") || h.orPending(null);
    const funding = (b) =>
      b.fundingMethods && b.fundingMethods.length
        ? h.esc(b.fundingMethods.join(", "))
        : h.orPending(null);
    const platforms = (b) => h.esc((b.platforms || []).join(", "));
    const links = (b) =>
      `<a href="${h.esc(b.officialUrl)}" target="_blank" rel="noopener nofollow" class="section-link">เว็บทางการ ↗</a>`;

    tbl.innerHTML =
      head +
      row("สถานะการตรวจสอบ", statusInfo) +
      row("เว็บไซต์ทางการ", links) +
      row("หน่วยงานกำกับดูแล", regs) +
      row("ประเภทบัญชี / ฝากขั้นต่ำ", accs) +
      row("แพลตฟอร์ม", platforms) +
      row("ช่องทางฝากถอน", funding) +
      row("ตรวจสอบเมื่อ", (b) => `<span class="num">${h.esc(b.verifiedAt)}</span>`);
  }

  document.addEventListener("DOMContentLoaded", render);
})();
