/* ============================================================
   Page — Broker Tools (เครื่องมือโบรกเกอร์)
   ------------------------------------------------------------
   เครื่องมือที่ใช้งานได้จริง (ไม่ใช่หน้าโฆษณา):
     1) Lot Size Calculator
     2) Margin Calculator
     3) Trade Cost Comparison (สูงสุด 3 โบรกเกอร์)
     4) Swap / Rollover Calculator

   สูตรทั้งหมดอยู่ใน broker-tools.math.js (pure functions)
   หน้านี้ทำหน้าที่: อ่าน input → เรียกสูตร → แสดงผล + จัดการ UI เท่านั้น
   ============================================================ */

(function () {
  const h = TT.h;
  const M = TT.brokerMath; // pure functions

  /* ============================================================
     ค่าเริ่มต้น — เป็น "ตัวอย่าง" ที่ผู้ใช้แก้ไขได้ทั้งหมด
     ไม่ใช่ข้อมูลราคา real-time
     ============================================================ */
  const DEFAULTS = {
    lotSize: { capital: "10000", riskPercent: "1", stopLossPips: "50", pipValuePerLot: "10" },
    margin: { lot: "1", leverage: "30", price: "1.085", contractSize: "100000" },
    cost: {
      brokers: [
        { name: "Broker A", spreadPips: "0.5", commissionPerLot: "3.5", lot: "1", roundTrips: "20" },
        { name: "Broker B", spreadPips: "0.2", commissionPerLot: "3", lot: "1", roundTrips: "20" },
        { name: "Broker C", spreadPips: "1.0", commissionPerLot: "0", lot: "1", roundTrips: "20" },
      ],
    },
    swap: { swapRatePerLot: "-5", lot: "1", nights: "3", direction: "long" },
  };

  /* ============================================================
     Render
     ============================================================ */
  function render() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("calculator", 14)} Broker Tools</span>
            <h1>เครื่องมือ <span class="text-grad-blue">โบรกเกอร์</span></h1>
            <p>ชุดเครื่องคำนวณสำหรับวางแผนการเทรด — ขนาดล็อต มาร์จิน ต้นทุน และ swap
               ค่าเริ่มต้นเป็นเพียงตัวอย่าง กรุณาแก้ไขให้ตรงกับเงื่อนไขของคุณ</p>
          </div>

          <div class="alert alert--info btools-notice" role="note">
            <span class="alert__icon">${TT.icon("shield", 18)}</span>
            <div>
              <strong>คำเตือน:</strong> ผลลัพธ์ทั้งหมดเป็น <em>ค่าประมาณตามสูตรมาตรฐาน</em>
              ไม่ใช่การคำนวณแทนเงื่อนไขจริงของโบรกเกอร์
              pip value, contract size, commission และ swap rate จริงอาจต่างจากนี้
              โปรดตรวจสอบกับโบรกเกอร์ของคุณก่อนตัดสินใจ
            </div>
          </div>

          <div class="btools-grid">

            <!-- ===================== 1) Lot Size ===================== -->
            <article class="card btools-card" id="bt-lot">
              <div class="btools-card__head">
                <span class="badge badge--accent">1</span>
                <h2 class="btools-card__title">เครื่องคำนวณ Lot Size</h2>
              </div>
              <p class="btools-card__desc">หาขนาดล็อตที่เหมาะสมจากเงินทุนและความเสี่ยงต่อไม้</p>

              <div class="btools-form" data-tool="lot">
                ${field("lot-capital", "เงินทุน (USD)", DEFAULTS.lotSize.capital, "$")}
                ${field("lot-risk", "ความเสี่ยง (%)", DEFAULTS.lotSize.riskPercent, "%")}
                ${field("lot-sl", "Stop Loss (pips)", DEFAULTS.lotSize.stopLossPips)}
                ${field("lot-pip", "Pip value (USD/lot)", DEFAULTS.lotSize.pipValuePerLot)}
              </div>

              <div class="btools-actions">
                <button class="btn btn--teal btn--sm" data-action="calc" data-tool="lot">${TT.icon("calculator", 14)} คำนวณ</button>
                <button class="btn btn--soft btn--sm" data-action="reset" data-tool="lot">รีเซ็ต</button>
              </div>

              <div class="btools-result" data-result="lot" hidden></div>

              <details class="btools-formula">
                <summary>สูตรที่ใช้</summary>
                <code>lots = (เงินทุน × ความเสี่ยง% ÷ 100) ÷ (Stop Loss pips × pip value/lot)</code>
              </details>
            </article>

            <!-- ===================== 2) Margin ===================== -->
            <article class="card btools-card" id="bt-margin">
              <div class="btools-card__head">
                <span class="badge badge--accent">2</span>
                <h2 class="btools-card__title">เครื่องคำนวณ Margin</h2>
              </div>
              <p class="btools-card__desc">มาร์จินที่จำเป็นต่อคำสั่ง ตาม leverage และราคา</p>

              <div class="btools-form" data-tool="margin">
                ${field("m-lot", "Lot size", DEFAULTS.margin.lot)}
                ${field("m-lev", "Leverage (1:?)", DEFAULTS.margin.leverage, "1:")}
                ${field("m-price", "ราคา (price)", DEFAULTS.margin.price)}
                ${field("m-cs", "Contract size", DEFAULTS.margin.contractSize)}
              </div>

              <div class="btools-actions">
                <button class="btn btn--teal btn--sm" data-action="calc" data-tool="margin">${TT.icon("calculator", 14)} คำนวณ</button>
                <button class="btn btn--soft btn--sm" data-action="reset" data-tool="margin">รีเซ็ต</button>
              </div>

              <div class="btools-result" data-result="margin" hidden></div>

              <details class="btools-formula">
                <summary>สูตรที่ใช้</summary>
                <code>margin = (lot × contract size × ราคา) ÷ leverage</code>
              </details>
            </article>

            <!-- ===================== 3) Trade Cost ===================== -->
            <article class="card btools-card btools-card--wide" id="bt-cost">
              <div class="btools-card__head">
                <span class="badge badge--accent">3</span>
                <h2 class="btools-card__title">เปรียบเทียบต้นทุนเทรด</h2>
              </div>
              <p class="btools-card__desc">เปรียบเทียบต้นทุนรวม (spread + commission) สูงสุด 3 โบรกเกอร์</p>

              <div class="btools-brokers" data-tool="cost" id="bt-cost-list">
                ${DEFAULTS.cost.brokers
                  .map(
                    (b, i) => `<div class="btools-broker" data-broker="${i}">
                    <div class="btools-broker__head">
                      <input class="input btools-broker__name" data-field="name" value="${h.esc(
                        b.name
                      )}" placeholder="ชื่อโบรกเกอร์" aria-label="ชื่อโบรกเกอร์ ${i + 1}">
                    ${
                      DEFAULTS.cost.brokers.length > 1
                        ? `<button class="btools-remove" data-action="remove-broker" data-index="${i}" aria-label="ลบโบรกเกอร์ ${i + 1}">✕</button>`
                        : ""
                    }
                    </div>
                    <div class="btools-form btools-form--inline">
                      ${fieldSmall(`c-spread-${i}`, "Spread (pips)", b.spreadPips)}
                      ${fieldSmall(`c-comm-${i}`, "Comm./lot (USD)", b.commissionPerLot)}
                      ${fieldSmall(`c-lot-${i}`, "Lot", b.lot)}
                      ${fieldSmall(`c-round-${i}`, "รอบเทรด", b.roundTrips)}
                    </div>
                  </div>`
                  )
                  .join("")}
              </div>

              <div class="btools-actions">
                <button class="btn btn--teal btn--sm" data-action="calc" data-tool="cost">${TT.icon("calculator", 14)} เปรียบเทียบ</button>
                <button class="btn btn--soft btn--sm" data-action="add-broker" data-tool="cost" id="bt-add-broker">+ เพิ่มโบรกเกอร์</button>
                <button class="btn btn--soft btn--sm" data-action="reset" data-tool="cost">รีเซ็ต</button>
              </div>

              <div class="btools-result" data-result="cost" hidden></div>

              <details class="btools-formula">
                <summary>สูตรที่ใช้</summary>
                <code>ต้นทุนรอบ = (spread × pip value × lot) + (commission × lot × 2)</code><br>
                <code>ต้นทุนรวม = ต้นทุนรอบ × จำนวนรอบ</code>
                <p class="text-muted" style="margin-top:6px;font-size:var(--fs-xs)">
                  ค่า commission ตามมาตรฐาน = ต่อข้างต่อล็อต (1 round trip = 2 ข้าง)
                </p>
              </details>
            </article>

            <!-- ===================== 4) Swap ===================== -->
            <article class="card btools-card" id="bt-swap">
              <div class="btools-card__head">
                <span class="badge badge--accent">4</span>
                <h2 class="btools-card__title">เครื่องคำนวณ Swap/Rollover</h2>
              </div>
              <p class="btools-card__desc">ค่าประมาณ swap สะสมตามจำนวนคืนที่ถือตำแหน่ง</p>

              <div class="btools-form" data-tool="swap">
                ${field("s-rate", "Swap rate (USD/lot/คืน)", DEFAULTS.swap.swapRatePerLot)}
                ${field("s-lot", "Lot size", DEFAULTS.swap.lot)}
                ${field("s-nights", "จำนวนคืน", DEFAULTS.swap.nights)}
                <div class="btools-field">
                  <label class="btools-field__label" for="s-dir">ทิศทาง</label>
                  <select class="input" id="s-dir" data-field="direction" aria-label="ทิศทาง">
                    <option value="long" selected>Long (ซื้อ)</option>
                    <option value="short">Short (ขาย)</option>
                  </select>
                </div>
              </div>

              <div class="btools-actions">
                <button class="btn btn--teal btn--sm" data-action="calc" data-tool="swap">${TT.icon("calculator", 14)} คำนวณ</button>
                <button class="btn btn--soft btn--sm" data-action="reset" data-tool="swap">รีเซ็ต</button>
              </div>

              <div class="btools-result" data-result="swap" hidden></div>

              <details class="btools-formula">
                <summary>สูตรที่ใช้</summary>
                <code>swap ≈ swap rate × lot × จำนวนคืน</code>
                <p class="text-muted" style="margin-top:6px;font-size:var(--fs-xs)">
                  <strong>ค่าประมาณ</strong> — swap rate จริงแตกต่างตามโบรกเกอร์และวัน
                  (คืนวันพุธมักคิด 3 เท่าสำหรับ Forex)
                </p>
              </details>
            </article>

          </div>

          <div class="alert alert--warn" style="margin-top:32px">
            <span class="alert__icon">${TT.icon("warning", 18)}</span>
            <div>
              <strong>ความเสี่ยง:</strong>
              การเทรดสินทรัพย์ที่มีหลักประกันมีความเสี่ยงสูง อาจสูญเสียเงินทุนทั้งหมด
              เครื่องมือบนหน้านี้เป็นเพียงตัวช่วยวางแผน ไม่ใช่คำแนะนำให้ซื้อหรือขาย
            </div>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "broker-tools",
      main,
    });
    TT.layout.initNavbar();
    bindEvents();
  }

  /* ============================================================
     Field helpers
     ============================================================ */
  function field(id, label, value, prefix = "") {
    return `<div class="btools-field">
      <label class="btools-field__label" for="${id}">${h.esc(label)}</label>
      <div class="btools-field__control">
        ${prefix ? `<span class="btools-field__prefix">${h.esc(prefix)}</span>` : ""}
        <input class="input btools-field__input" id="${id}" type="text" inputmode="decimal"
               value="${h.esc(value)}" placeholder="${h.esc(label)}" aria-label="${h.esc(label)}">
      </div>
    </div>`;
  }

  function fieldSmall(id, label, value) {
    return `<div class="btools-field btools-field--sm">
      <label class="btools-field__label" for="${id}">${h.esc(label)}</label>
      <input class="input btools-field__input" id="${id}" type="text" inputmode="decimal"
             value="${h.esc(value)}" placeholder="${h.esc(label)}" aria-label="${h.esc(label)}">
    </div>`;
  }

  /* ============================================================
     Read inputs (safe — ไม่ throw)
     ============================================================ */
  function readFields(container, fields) {
    const out = {};
    fields.forEach(([key, sel]) => {
      const el = container.querySelector(sel);
      out[key] = el ? el.value : "";
    });
    return out;
  }

  /* ============================================================
     Result rendering
     ============================================================ */
  function showResult(tool, html) {
    const box = document.querySelector(`[data-result="${tool}"]`);
    if (!box) return;
    box.innerHTML = html;
    box.hidden = false;
  }

  function showResultRow(label, value, opts = {}) {
    const cls = opts.cls ? ` ${opts.cls}` : "";
    return `<div class="btools-result__row${cls}">
      <span class="btools-result__label">${h.esc(label)}</span>
      <span class="btools-result__value">${h.esc(value)}</span>
    </div>`;
  }

  function showError(tool, msg) {
    showResult(
      tool,
      `<div class="btools-error" role="alert">
        <span class="btools-error__icon">⚠️</span>
        <span>${h.esc(msg)}</span>
      </div>`
    );
  }

  /* ============================================================
     Per-tool handlers
     ============================================================ */
  function handleLot() {
    const wrap = document.querySelector('[data-tool="lot"]');
    const v = readFields(wrap, [
      ["capital", "#lot-capital"],
      ["riskPercent", "#lot-risk"],
      ["stopLossPips", "#lot-sl"],
      ["pipValuePerLot", "#lot-pip"],
    ]);
    const r = M.calcLotSize(v);
    if (!r.ok) return showError("lot", r.error);

    showResult(
      "lot",
      `${showResultRow("จำนวนเงินที่เสี่ยง", "$" + h.num(r.riskAmount))}
       ${showResultRow("ความเสี่ยงต่อล็อต", "$" + h.num(r.riskPerLot))}
       ${showResultRow("Lot ที่แนะนำ", h.num(r.lots, 4) + " lots", { cls: "btools-result__row--accent" })}
       <p class="text-muted btools-result__note">ค่าประมาณตามสูตร — ตรวจสอบ contract spec ของโบรกเกอร์ก่อนใช้งานจริง</p>`
    );
  }

  function handleMargin() {
    const wrap = document.querySelector('[data-tool="margin"]');
    const v = readFields(wrap, [
      ["lot", "#m-lot"],
      ["leverage", "#m-lev"],
      ["price", "#m-price"],
      ["contractSize", "#m-cs"],
    ]);
    const r = M.calcMargin(v);
    if (!r.ok) return showError("margin", r.error);

    showResult(
      "margin",
      `${showResultRow("มูลค่าสัญญา", "$" + h.num(r.contractValue))}
       ${showResultRow("Required Margin", "$" + h.num(r.requiredMargin), { cls: "btools-result__row--accent" })}
       <p class="text-muted btools-result__note">ค่าประมาณ — margin จริงขึ้นอยู่กับสกุลเงินบัญชีและเงื่อนไขโบรกเกอร์</p>`
    );
  }

  function handleCost() {
    const list = document.getElementById("bt-cost-list");
    const brokers = [];
    list.querySelectorAll(".btools-broker").forEach((node) => {
      const name = node.querySelector('.btools-broker__name');
      const spread = node.querySelector('[id^="c-spread-"]');
      const comm = node.querySelector('[id^="c-comm-"]');
      const lot = node.querySelector('[id^="c-lot-"]');
      const rounds = node.querySelector('[id^="c-round-"]');
      brokers.push({
        name: name ? name.value : "",
        spreadPips: spread ? spread.value : "",
        commissionPerLot: comm ? comm.value : "",
        lot: lot ? lot.value : "",
        roundTrips: rounds ? rounds.value : "",
      });
    });

    const sorted = M.compareTradeCosts(brokers);
    if (!sorted.length) return showError("cost", "กรุณาเพิ่มโบรกเกอร์อย่างน้อย 1 ราย");

    const cheapest = sorted.find((b) => b.result.ok);
    const rows = sorted
      .map((b) => {
        if (!b.result.ok) {
          return `<div class="btools-cmp__row btools-cmp__row--bad">
            <span class="btools-cmp__name">${h.esc(b.name)}</span>
            <span class="btools-cmp__cost text-sell">— ${h.esc(b.result.error)}</span>
          </div>`;
        }
        const isBest = cheapest && b.index === cheapest.index;
        return `<div class="btools-cmp__row${isBest ? " btools-cmp__row--best" : ""}">
          <span class="btools-cmp__name">${h.esc(b.name)}${isBest ? ' <span class="badge badge--buy">ถูกสุด</span>' : ""}</span>
          <span class="btools-cmp__cost">${"$" + h.num(b.result.totalCost)}
            <span class="text-muted" style="font-size:var(--fs-xs)">(${h.num(b.result.costPerRound)}/รอบ)</span>
          </span>
        </div>`;
      })
      .join("");

    showResult(
      "cost",
      `<div class="btools-cmp">${rows}</div>
       <p class="text-muted btools-result__note">ค่าประมาณ — pip value เริ่มต้น $${M.DEFAULTS.pipValuePerLot}/lot/pip (major pair); commission นับ 2 ข้าง/round trip</p>`
    );
  }

  function handleSwap() {
    const wrap = document.querySelector('[data-tool="swap"]');
    const v = readFields(wrap, [
      ["swapRatePerLot", "#s-rate"],
      ["lot", "#s-lot"],
      ["nights", "#s-nights"],
      ["direction", "#s-dir"],
    ]);
    const r = M.calcSwap(v);
    if (!r.ok) return showError("swap", r.error);

    const sign = r.swap > 0 ? "+" : "";
    const cls = r.swap >= 0 ? "text-buy" : "text-sell";
    showResult(
      "swap",
      `${showResultRow("ทิศทาง", r.direction === "long" ? "Long (ซื้อ)" : "Short (ขาย)")}
       ${showResultRow("Swap รวม", `${sign}$` + h.num(r.swap), { cls: "btools-result__row--accent " + cls })}
       <p class="text-muted btools-result__note">${h.esc(r.note)}</p>`
    );
  }

  /* ============================================================
     Reset handlers — คืนค่าเริ่มต้น
     ============================================================ */
  function resetTool(tool) {
    if (tool === "lot") setFields({ "#lot-capital": DEFAULTS.lotSize.capital, "#lot-risk": DEFAULTS.lotSize.riskPercent, "#lot-sl": DEFAULTS.lotSize.stopLossPips, "#lot-pip": DEFAULTS.lotSize.pipValuePerLot });
    if (tool === "margin") setFields({ "#m-lot": DEFAULTS.margin.lot, "#m-lev": DEFAULTS.margin.leverage, "#m-price": DEFAULTS.margin.price, "#m-cs": DEFAULTS.margin.contractSize });
    if (tool === "swap") {
      setFields({ "#s-rate": DEFAULTS.swap.swapRatePerLot, "#s-lot": DEFAULTS.swap.lot, "#s-nights": DEFAULTS.swap.nights });
      const dir = document.getElementById("s-dir");
      if (dir) dir.value = DEFAULTS.swap.direction;
    }
    if (tool === "cost") {
      renderCostBrokers(DEFAULTS.cost.brokers);
    }
    const box = document.querySelector(`[data-result="${tool}"]`);
    if (box) {
      box.innerHTML = "";
      box.hidden = true;
    }
  }

  function setFields(map) {
    Object.entries(map).forEach(([sel, val]) => {
      const el = document.querySelector(sel);
      if (el) el.value = val;
    });
  }

  /* ============================================================
     Broker list render (เพิ่ม/ลบ/รีเซ็ต)
     ============================================================ */
  function renderCostBrokers(brokers) {
    const list = document.getElementById("bt-cost-list");
    if (!list) return;
    const capped = brokers.slice(0, 3);
    list.innerHTML = capped
      .map(
        (b, i) => `<div class="btools-broker" data-broker="${i}">
          <div class="btools-broker__head">
            <input class="input btools-broker__name" data-field="name" value="${h.esc(
              b.name || "Broker " + (i + 1)
            )}" placeholder="ชื่อโบรกเกอร์" aria-label="ชื่อโบรกเกอร์ ${i + 1}">
            ${
              capped.length > 1
                ? `<button class="btools-remove" data-action="remove-broker" data-index="${i}" aria-label="ลบโบรกเกอร์ ${i + 1}">✕</button>`
                : ""
            }
          </div>
          <div class="btools-form btools-form--inline">
            ${fieldSmall(`c-spread-${i}`, "Spread (pips)", b.spreadPips || "")}
            ${fieldSmall(`c-comm-${i}`, "Comm./lot (USD)", b.commissionPerLot || "")}
            ${fieldSmall(`c-lot-${i}`, "Lot", b.lot || "")}
            ${fieldSmall(`c-round-${i}`, "รอบเทรด", b.roundTrips || "")}
          </div>
        </div>`
      )
      .join("");
    updateAddButton(capped.length);
  }

  function currentBrokers() {
    const list = document.getElementById("bt-cost-list");
    const out = [];
    if (!list) return out;
    list.querySelectorAll(".btools-broker").forEach((node) => {
      const name = node.querySelector('.btools-broker__name');
      const spread = node.querySelector('[id^="c-spread-"]');
      const comm = node.querySelector('[id^="c-comm-"]');
      const lot = node.querySelector('[id^="c-lot-"]');
      const rounds = node.querySelector('[id^="c-round-"]');
      out.push({
        name: name ? name.value : "",
        spreadPips: spread ? spread.value : "",
        commissionPerLot: comm ? comm.value : "",
        lot: lot ? lot.value : "",
        roundTrips: rounds ? rounds.value : "",
      });
    });
    return out;
  }

  function addBroker() {
    const cur = currentBrokers();
    if (cur.length >= 3) return; // จำกัด 3
    const i = cur.length;
    cur.push({ name: "Broker " + (i + 1), spreadPips: "0.5", commissionPerLot: "3.5", lot: cur[0] && cur[0].lot ? cur[0].lot : "1", roundTrips: cur[0] && cur[0].roundTrips ? cur[0].roundTrips : "20" });
    renderCostBrokers(cur);
  }

  function removeBroker(index) {
    const cur = currentBrokers();
    if (cur.length <= 1) return;
    cur.splice(index, 1);
    renderCostBrokers(cur);
  }

  function updateAddButton(count) {
    const btn = document.getElementById("bt-add-broker");
    if (!btn) return;
    btn.disabled = count >= 3;
    btn.style.opacity = count >= 3 ? "0.5" : "";
    btn.title = count >= 3 ? "เปรียบเทียบได้สูงสุด 3 โบรกเกอร์" : "";
  }

  /* ============================================================
     Event binding (delegation)
     ============================================================ */
  function bindEvents() {
    const root = document.querySelector(".page");
    if (!root) return;
    if (root.dataset.btBound === "1") return;
    root.dataset.btBound = "1";

    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const tool = btn.getAttribute("data-tool");

      try {
        if (action === "calc") {
          if (tool === "lot") handleLot();
          if (tool === "margin") handleMargin();
          if (tool === "cost") handleCost();
          if (tool === "swap") handleSwap();
        } else if (action === "reset") {
          resetTool(tool);
        } else if (action === "add-broker") {
          addBroker();
        } else if (action === "remove-broker") {
          removeBroker(Number(btn.getAttribute("data-index")));
        }
      } catch (err) {
        // กัน crash ของทั้งหน้า — แสดง error ในกล่องผลลัพธ์ของ tool นั้น
        console.error("[broker-tools]", err);
        if (tool) showError(tool, "เกิดข้อผิดพลาดในการคำนวณ กรุณาตรวจสอบค่าที่กรอก");
      }
    });

    // Enter ในฟิลด์ → คำนวณทันที
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const form = e.target.closest(".btools-form");
      if (!form) return;
      const tool = form.getAttribute("data-tool");
      // กรณี cost อยู่ใน .btools-broker ไม่มี data-tool โดยตรง → เลือก container
      const t = tool || (e.target.closest("#bt-cost") ? "cost" : null);
      if (!t) return;
      const btn = document.querySelector(`[data-action="calc"][data-tool="${t}"]`);
      if (btn) btn.click();
    });

    updateAddButton(DEFAULTS.cost.brokers.length);
  }

  document.addEventListener("DOMContentLoaded", render);
})();
