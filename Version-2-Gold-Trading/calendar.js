/* ============================================================
   Page — Economic Calendar (V2 — Live API)
   ------------------------------------------------------------
   เรียก /api/calendar ผ่าน CalendarService (backend cache)
   กฎ:
   - ข้อมูลทั้งหมดมาจาก API ไม่มี hardcode หลอก
   - แสดงเวลา Asia/Bangkok (UTC+7)
   - filter: วันนี้ / พรุ่งนี้ / สัปดาห์นี้ + currency + impact
   - states: loading skeleton / empty / error + ลองใหม่ / stale
   - badge High Impact + ปุ่ม refresh + Mobile layout
   - ไม่ใช้คำว่า realtime — ใช้ "อัปเดตอัตโนมัติ" / "ข้อมูลล่าสุดจากการซิงก์"
   ============================================================ */

(function () {
  const h = TT.h;
  const state = { range: "week", impact: "all", currency: "all", loading: false, lastEnvelope: null };

  function render() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("calendar", 14)} Economic Calendar</span>
            <h1>ปฏิทิน <span class="text-grad-blue">ข่าวเศรษฐกิจ</span></h1>
            <p>ตารางเหตุการณ์เศรษฐกิจสำคัญ พร้อม Time, Currency, Impact, Previous, Forecast และ Actual — ข้อมูลล่าสุดจากการซิงก์ Forex Factory</p>
          </div>

          <div class="filter-bar">
            <div class="cluster">
              <span class="text-muted" style="font-size:var(--fs-sm)">ช่วง:</span>
              <div class="segmented" id="rangeFilter">
                <button data-range="day" class="is-active">วันนี้</button>
                <button data-range="tomorrow">พรุ่งนี้</button>
                <button data-range="week">สัปดาห์นี้</button>
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
                <option value="AUD">AUD</option>
                <option value="CAD">CAD</option>
                <option value="CHF">CHF</option>
                <option value="CNY">CNY</option>
                <option value="NZD">NZD</option>
              </select>
            </div>
            <div class="cluster" style="margin-left:auto">
              <button class="btn btn--ghost btn--sm" id="calRefreshBtn" type="button" title="รีเฟรชข้อมูล">
                ${TT.icon("refresh", 16)} รีเฟรช
              </button>
            </div>
          </div>

          <!-- Legend -->
          <div class="cluster cal-legend" style="margin-bottom:16px;font-size:var(--fs-xs)">
            <span class="cluster"><span class="dot" style="background:var(--impact-high)"></span> High</span>
            <span class="cluster"><span class="dot" style="background:var(--impact-medium)"></span> Medium</span>
            <span class="cluster"><span class="dot" style="background:var(--impact-low)"></span> Low</span>
          </div>

          <!-- status bar: อัปเดตล่าสุด + stale -->
          <div id="calStatus"></div>

          <div id="calendarList" aria-live="polite"></div>

          <div class="alert" style="margin-top:32px">
            <span class="alert__icon">${TT.icon("clock", 18)}</span>
            <div>เวลาแสดงเป็นเวลาท้องถิ่นไทย (ICT, UTC+7) ข้อมูล Actual อัปเดตหลังเผยแพร่จริง ระบบอัปเดตอัตโนมัติทุก 5 นาที</div>
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
      if (state.loading) return;
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
      if (state.loading) return;
      document
        .querySelectorAll("#impactFilter button")
        .forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.impact = btn.dataset.impact;
      loadList();
    });

    document.getElementById("currencyFilter").addEventListener("change", (e) => {
      if (state.loading) return;
      state.currency = e.target.value;
      loadList();
    });

    const refreshBtn = document.getElementById("calRefreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", onRefresh);

    loadList();
  }

  // คำนวณช่วงเวลาตาม state.range ในมุมมอง Asia/Bangkok
  // แต่ส่งเป็นวันที่ (YYYY-MM-DD) ให้ backend ตีความใน UTC — กัน skew ฝั่ง client
  function getRange() {
    const now = new Date();
    if (state.range === "day") {
      const from = startOfBangkokDay(now);
      const to = endOfBangkokDay(now);
      return { from, to };
    }
    if (state.range === "tomorrow") {
      const t = new Date(now.getTime() + 24 * 3_600_000);
      return { from: startOfBangkokDay(t), to: endOfBangkokDay(t) };
    }
    // week: วันนี้ + 7 วัน
    const from = startOfBangkokDay(now);
    const to = new Date(from.getTime() + 7 * 24 * 3_600_000 - 1);
    return { from, to };
  }

  // เริ่มต้นวันในเขตเวลาไทย (UTC+7) คืนเป็น Date ที่เทียบเท่า UTC
  function startOfBangkokDay(d) {
    // เลื่อนเป็นเวลาไทย แล้วปัดเที่ยงคืน แล้วเลื่อนกลับเป็น UTC
    const bkMs = d.getTime() + 7 * 3_600_000;
    const bk = new Date(bkMs);
    bk.setUTCHours(0, 0, 0, 0);
    return new Date(bk.getTime() - 7 * 3_600_000);
  }
  function endOfBangkokDay(d) {
    const bkMs = d.getTime() + 7 * 3_600_000;
    const bk = new Date(bkMs);
    bk.setUTCHours(23, 59, 59, 999);
    return new Date(bk.getTime() - 7 * 3_600_000);
  }

  async function loadList() {
    const el = document.getElementById("calendarList");
    if (!el) return;
    state.loading = true;
    el.innerHTML = renderSkeleton();
    renderStatus(null);
    try {
      const range = getRange();
      const envelope = await TT.CalendarService.fetchEvents({
        range,
        impact: state.impact,
        currency: state.currency,
      });
      state.lastEnvelope = envelope;

      // error state (service คืน error flag เมื่อ API ล้มเหลวโดยสมบูรณ์)
      if (envelope.error) {
        renderError(el);
        state.loading = false;
        return;
      }

      renderStatus(envelope);
      const list = envelope.items || [];
      if (!list.length) {
        h.empty(el, "ไม่มีเหตุการณ์ในช่วงที่เลือก", "ลองเปลี่ยนช่วงเวลาหรือตัวกรอง");
        state.loading = false;
        return;
      }

      // จัดกลุ่มตามวัน (ในมุมเวลาไทย)
      const groups = {};
      list.forEach((e) => {
        const iso = e.scheduledAtUtc || e.time;
        const d = new Date(iso);
        if (isNaN(d)) return;
        // คีย์กลุ่มในเขตเวลาไทย
        const bkMs = d.getTime() + 7 * 3_600_000;
        const bk = new Date(bkMs);
        const key = `${bk.getUTCFullYear()}-${bk.getUTCMonth()}-${bk.getUTCDate()}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(e);
      });

      const sortedKeys = Object.keys(groups).sort((a, b) => {
        const [ay, am, ad] = a.split("-").map(Number);
        const [by, bm, bd] = b.split("-").map(Number);
        return ay - by || am - bm || ad - bd;
      });

      el.innerHTML = sortedKeys
        .map((key) => {
          const items = groups[key];
          const [y, m, d] = key.split("-").map(Number);
          const dateObj = new Date(Date.UTC(y, m, d));
          const dateStr = `วัน${h.weekdayTh(dateObj.toISOString())}ที่ ${dateObj.toLocaleDateString("th-TH", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}`;
          const highCount = items.filter((i) => i.impact === "high").length;
          return `<div class="calendar-day">
              <span class="calendar-day__date">${dateStr}</span>
              <span class="calendar-day__count">${items.length} เหตุการณ์${
            highCount ? ` · <span class="badge badge--high">High Impact ${highCount}</span>` : ""
          }</span>
            </div>
            <div class="table-wrap cal-table-wrap" style="margin-bottom:24px">
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
      renderError(el);
    } finally {
      state.loading = false;
    }
  }

  // ปุ่มรีเฟรช: trigger sync ที่ backend (admin endpoint) แล้วโหลดซ้ำ
  // หากยังไม่ login admin → แค่ reload ข้อมูลจาก cache (อัปเดตอัตโนมัติอยู่แล้ว)
  async function onRefresh() {
    const btn = document.getElementById("calRefreshBtn");
    if (!btn || state.loading) return;
    btn.disabled = true;
    btn.dataset.state = "loading";
    try {
      // พยายาม trigger sync admin (อาจ 401 ถ้าไม่ login ก็ไม่เป็นไร)
      await fetch("/api/admin/calendar/refresh", { method: "POST" }).catch(() => {});
      // รอเล็กน้อยให้ sync เริ่ม แล้ว reload cache
      await new Promise((r) => setTimeout(r, 400));
      await loadList();
    } finally {
      btn.disabled = false;
      btn.dataset.state = "idle";
    }
  }

  // ---------- render helpers ----------
  function renderSkeleton() {
    return `<div class="card" style="padding:16px">
      <div class="skeleton" style="height:14px;width:30%;margin-bottom:16px"></div>
      ${Array.from({ length: 4 })
        .map(
          () => `<div class="skeleton" style="height:18px;width:100%;margin-bottom:10px"></div>`
        )
        .join("")}
    </div>`;
  }

  function renderError(el) {
    el.innerHTML = `<div class="state state--wide">
      <div class="state__title">⚠️ โหลดปฏิทินไม่สำเร็จ</div>
      <p>เกิดข้อผิดพลาดขณะเชื่อมต่อระบบปฏิทินเศรษฐกิจ กรุณาลองอีกครั้ง</p>
      <button class="btn btn--primary" type="button" id="calRetry">ลองอีกครั้ง</button>
    </div>`;
    const retry = document.getElementById("calRetry");
    if (retry) retry.addEventListener("click", loadList);
  }

  // status bar: อัปเดตล่าสุด + stale warning
  function renderStatus(envelope) {
    const el = document.getElementById("calStatus");
    if (!el) return;
    if (!envelope) {
      el.innerHTML = "";
      return;
    }
    const updated = envelope.updatedAt
      ? h.formatBangkok(envelope.updatedAt, { prefix: "อัปเดตล่าสุด " })
      : "ยังไม่มีข้อมูลอัปเดต";
    const staleNote = envelope.stale
      ? ` · <span class="cal-stale">กำลังแสดงข้อมูลล่าสุดที่มี</span>`
      : "";
    el.innerHTML = `<div class="cal-status">${h.esc(updated)}${staleNote}</div>`;
  }

  document.addEventListener("DOMContentLoaded", render);
})();
