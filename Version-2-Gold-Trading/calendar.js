/* ============================================================
   Page — Economic Calendar
   ============================================================ */

(function () {
  const h = TT.h;
  let state = { range: "week", impact: "all", currency: "all" };

  function render() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("calendar", 14)} Economic Calendar</span>
            <h1>ปฏิทิน <span class="text-grad-blue">ข่าวเศรษฐกิจ</span></h1>
            <p>ตารางเหตุการณ์เศรษฐกิจสำคัญ พร้อม Time, Currency, Impact, Previous, Forecast และ Actual</p>
          </div>

          <div class="filter-bar">
            <div class="cluster">
              <span class="text-muted" style="font-size:var(--fs-sm)">ช่วง:</span>
              <div class="segmented" id="rangeFilter">
                <button data-range="day" class="is-active">รายวัน</button>
                <button data-range="week">รายสัปดาห์</button>
                <button data-range="month">รายเดือน</button>
              </div>
            </div>
            <div class="cluster">
              <span class="text-muted" style="font-size:var(--fs-sm)">ผลกระทบ:</span>
              <div class="segmented" id="impactFilter">
                <button data-impact="all" class="is-active">ทั้งหมด</button>
                <button data-impact="high">สูง</button>
                <button data-impact="medium">กลาง</button>
                <button data-impact="low">ต่ำ</button>
              </div>
            </div>
            <div class="cluster">
              <span class="text-muted" style="font-size:var(--fs-sm)">สกุล:</span>
              <select id="currencyFilter" class="segmented" style="padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary)">
                <option value="all">ทั้งหมด</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="JPY">JPY</option>
              </select>
            </div>
          </div>

          <!-- Legend -->
          <div class="cluster" style="margin-bottom:16px;font-size:var(--fs-xs)">
            <span class="cluster"><span class="dot" style="background:var(--impact-high)"></span> High</span>
            <span class="cluster"><span class="dot" style="background:var(--impact-medium)"></span> Medium</span>
            <span class="cluster"><span class="dot" style="background:var(--impact-low)"></span> Low</span>
          </div>

          <div id="calendarList"></div>

          <div class="alert" style="margin-top:32px">
            <span class="alert__icon">${TT.icon("clock", 18)}</span>
            <div>เวลาแสดงเป็นเวลาท้องถิ่นไทย (ICT, UTC+7) ข้อมูล Actual อัปเดตหลังเผยแพร่จริง</div>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "calendar",
      main,
    });
    TT.layout.initNavbar();

    document.getElementById("rangeFilter").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      document
        .querySelectorAll("#rangeFilter button")
        .forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.range = btn.dataset.range;
      loadList();
    });

    document.getElementById("impactFilter").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-impact]");
      if (!btn) return;
      document
        .querySelectorAll("#impactFilter button")
        .forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.impact = btn.dataset.impact;
      loadList();
    });

    document.getElementById("currencyFilter").addEventListener("change", (e) => {
      state.currency = e.target.value;
      loadList();
    });

    loadList();
  }

  function getRange() {
    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    if (state.range === "day") {
      to.setHours(23, 59, 59, 999);
    } else if (state.range === "week") {
      to.setDate(to.getDate() + 7);
    } else if (state.range === "month") {
      to.setMonth(to.getMonth() + 1);
    }
    return { from, to };
  }

  async function loadList() {
    const el = document.getElementById("calendarList");
    el.innerHTML = `<div class="skeleton" style="height:300px"></div>`;
    try {
      const range = getRange();
      const list = await TT.CalendarService.fetchEvents({
        range,
        impact: state.impact,
        currency: state.currency,
      });
      if (!list.length) {
        return TT.h.empty(
          el,
          "ไม่มีเหตุการณ์ในช่วงที่เลือก",
          "ลองเปลี่ยนช่วงเวลาหรือตัวกรอง"
        );
      }

      // จัดกลุ่มตามวัน
      const groups = {};
      list.forEach((e) => {
        const d = new Date(e.time);
        const key = d.toDateString();
        if (!groups[key]) groups[key] = [];
        groups[key].push(e);
      });

      el.innerHTML = Object.entries(groups)
        .map(([key, items]) => {
          const d = new Date(key);
          const dateStr = `วัน${h.weekdayTh(
            d.toISOString()
          )}ที่ ${d.toLocaleDateString("th-TH", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}`;
          return `<div class="calendar-day">
              <span class="calendar-day__date">${dateStr}</span>
              <span class="calendar-day__count">${items.length} เหตุการณ์</span>
            </div>
            <div class="table-wrap" style="margin-bottom:24px">
              <table class="data">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>สกุล</th>
                    <th>ผลกระทบ</th>
                    <th>เหตุการณ์</th>
                    <th>Previous</th>
                    <th>Forecast</th>
                    <th>Actual</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(TT.cards.calendarRow).join("")}
                </tbody>
              </table>
            </div>`;
        })
        .join("");
    } catch (e) {
      TT.h.error(el);
    }
  }

  document.addEventListener("DOMContentLoaded", render);
})();
