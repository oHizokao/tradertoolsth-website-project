/* ============================================================
   Page — Broker list
   ============================================================ */

(function () {
  const h = TT.h;

  function render() {
    const main = `
      ${TT.layout.ticker()}

      <section class="page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("broker", 14)} Broker Reviews</span>
            <h1>รีวิว <span class="text-grad-blue">Broker</span></h1>
            <p>เปรียบเทียบโบรกเกอร์ Forex โดยพิจารณาใบอนุญาต Spread Commission ฝากถอน Platform ข้อดี ข้อจำกัด</p>
          </div>

          <div class="alert" style="margin-bottom:24px">
            <span class="alert__icon">${TT.icon("shield", 18)}</span>
            <div>
              <strong>หมายเหตุ Affiliate:</strong> ลิงก์บางลิงก์ในบทความอาจเป็นลิงก์พันธมิตร เราแนะนำเฉพาะโบรกเกอร์ที่ผ่านการตรวจสอบ แต่การตัดสินใจสุดท้ายเป็นของคุณ
            </div>
          </div>

          <div class="grid grid--2" id="brokerList"></div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "brokers",
      main,
    });
    TT.layout.initNavbar();
    loadList();
  }

  async function loadList() {
    const el = document.getElementById("brokerList");
    TT.h.loading(el, 4);
    try {
      const list = await TT.BrokerService.fetchBrokers();
      if (!list.length) return TT.h.empty(el);
      el.innerHTML = list.map(TT.cards.brokerCard).join("");
    } catch (e) {
      TT.h.error(el);
    }
  }

  document.addEventListener("DOMContentLoaded", render);
})();
