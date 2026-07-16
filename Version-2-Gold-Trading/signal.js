/* ============================================================
   Page — Signal
   ============================================================ */

(function () {
  const h = TT.h;
  let state = { tier: "all", status: "all" };

  function render() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("signal", 14)} Trading Signals</span>
            <h1>Signal <span class="text-grad-blue">เทรด</span></h1>
            <p>พื้นที่สำหรับสัญญาณซื้อขายจากระบบ EA บน MetaTrader 5 เมื่อเชื่อมต่อแหล่งข้อมูลจริงแล้ว</p>
          </div>

          ${TT.SignalService.isLive ? "" : `<div class="alert alert--warn" style="margin-bottom:24px"><span class="alert__icon">${TT.icon("warning", 18)}</span><div><strong>ระบบ Signal ยังไม่เปิดใช้งาน</strong><br>ขณะนี้ยังไม่มี API จาก EA/MT5 จึงไม่แสดงข้อมูลจำลองหรือสัญญาณซื้อขายที่อาจทำให้เข้าใจผิด</div></div>`}

          <!-- Stats -->
          <div class="signal-summary" id="signalStats" style="margin-bottom:24px"></div>

          <!-- Filter -->
          <div class="filter-bar">
            <div class="cluster">
              <span class="text-muted" style="font-size:var(--fs-sm)">ระดับ:</span>
              <div class="segmented" id="tierFilter" role="tablist">
                <button data-tier="all" class="is-active">ทั้งหมด</button>
                <button data-tier="demo">Demo</button>
                <button data-tier="premium">Premium</button>
              </div>
            </div>
            <div class="cluster">
              <span class="text-muted" style="font-size:var(--fs-sm)">สถานะ:</span>
              <div class="segmented" id="statusFilter" role="tablist">
                <button data-status="all" class="is-active">ทั้งหมด</button>
                <button data-status="active">เปิดอยู่</button>
                <button data-status="closed">ปิดแล้ว</button>
              </div>
            </div>
            <span class="badge" style="margin-left:auto">
              ${TT.SignalService.isLive ? `<span class="dot dot--live"></span> Live จาก EA/MT5` : "ยังไม่เชื่อมต่อ EA/MT5"}
            </span>
          </div>

          <!-- List -->
          <div class="grid grid--3" id="signalList"></div>

          <!-- Risk warning -->
          <div class="alert alert--warn" style="margin-top:32px">
            <span class="alert__icon">${TT.icon("warning", 18)}</span>
            <div>
              <strong>คำเตือน:</strong> Signal เป็นเพียงแนวทาง ไม่รับประกันผลกำไร การเทรดมีความเสี่ยงสูง ควรบริหารความเสี่ยงและใช้เงินที่ไม่กระทบความเป็นอยู่
            </div>
          </div>

          <!-- How to use -->
          <section class="section" style="padding-block:32px">
            <div class="section-header">
              <div class="section-title">
                <span class="eyebrow">How to use</span>
                <h2>วิธีใช้ Signal</h2>
              </div>
            </div>
            <div class="grid grid--3">
              <div class="card">
                <div class="feature__icon">${TT.icon("check", 20)}</div>
                <h4 style="margin:12px 0 6px">1. อ่าน Signal</h4>
                <p class="text-secondary" style="font-size:var(--fs-sm)">ดู Symbol, Direction (Buy/Sell), Entry, TP และ SL</p>
              </div>
              <div class="card">
                <div class="feature__icon">${TT.icon("chart", 20)}</div>
                <h4 style="margin:12px 0 6px">2. เปิด MT5</h4>
                <p class="text-secondary" style="font-size:var(--fs-sm)">ไปที่คู่เงินที่ระบุ วางคำสั่งตาม Entry</p>
              </div>
              <div class="card">
                <div class="feature__icon">${TT.icon("shield", 20)}</div>
                <h4 style="margin:12px 0 6px">3. บริหารความเสี่ยง</h4>
                <p class="text-secondary" style="font-size:var(--fs-sm)">ตั้ง Lot size และ SL/TP ตามแผนของคุณ</p>
              </div>
            </div>
            <a href="knowledge.html#how-to-use-signal" class="section-link" style="margin-top:16px;display:inline-flex">อ่านคู่มือเต็ม</a>
          </section>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "signal",
      main,
    });
    TT.layout.initNavbar();
    bindFilters();
    loadStats();
    loadList();
  }

  function bindFilters() {
    const tier = document.getElementById("tierFilter");
    const status = document.getElementById("statusFilter");

    tier.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tier]");
      if (!btn) return;
      tier.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.tier = btn.dataset.tier;
      loadList();
    });

    status.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-status]");
      if (!btn) return;
      status.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.status = btn.dataset.status;
      loadList();
    });
  }

  async function loadStats() {
    const el = document.getElementById("signalStats");
    if (!TT.SignalService.isLive) {
      return TT.h.empty(el, "ยังไม่มีสถิติสัญญาณจริง", "สถิติจะแสดงหลังเชื่อมต่อ EA/MT5 API");
    }
    try {
      const s = await TT.SignalService.getStats();
      el.innerHTML = `
        <div class="card stat">
          <span class="stat__value text-accent">${s.active}</span>
          <span class="stat__label">Signal เปิดอยู่</span>
        </div>
        <div class="card stat">
          <span class="stat__value text-buy">${s.winRate}%</span>
          <span class="stat__label">Win Rate (30 วัน)</span>
        </div>
        <div class="card stat">
          <span class="stat__value">${s.totalThisMonth}</span>
          <span class="stat__label">Signal เดือนนี้</span>
        </div>
        <div class="card stat">
          <span class="stat__value">${s.avgPips}</span>
          <span class="stat__label">เฉลี่ย pips/Signal</span>
        </div>
      `;
    } catch (e) {
      TT.h.error(el);
    }
  }

  async function loadList() {
    const el = document.getElementById("signalList");
    if (!TT.SignalService.isLive) {
      return TT.h.empty(el, "ยังไม่มีสัญญาณจากระบบจริง", "ไม่มีการใช้ข้อมูลจำลองแทนสัญญาณจริง");
    }
    TT.h.loading(el, 3);
    try {
      const list = await TT.SignalService.fetchSignals(state);
      if (!list.length) {
        return TT.h.empty(el, "ไม่มี Signal ตามตัวกรองที่เลือก", "ลองเปลี่ยนตัวกรองระดับหรือสถานะ");
      }
      el.innerHTML = list.map(TT.cards.signalCard).join("");
    } catch (e) {
      TT.h.error(el);
    }
  }

  document.addEventListener("DOMContentLoaded", render);
})();
