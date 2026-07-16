/* ============================================================
   Broker Tools — Pure calculation functions (UMD)
   ------------------------------------------------------------
   แยกสูตรการคำนวณออกเป็น pure functions เพื่อให้ทดสอบได้
   โดยไม่พึ่งพา DOM ทั้งใน browser และ Node (ผ่าน createRequire)

   คำเตือน:
   - ผลลัพธ์เป็น "ค่าประมาณตามสูตรมาตรฐาน" เท่านั้น
   - ไม่ใช่การคำนวณแทนเงื่อนไขจริงของโบรกเกอร์แต่ละราย
   - pip value, contract size, swap rate จริงอาจต่างจากนี้
     ขึ้นอยู่กับสัญญาณ ประเภทบัญชี และเงื่อนไขของโบรกเกอร์
   ============================================================ */

(function (root, factory) {
  /* global define */
  if (typeof module === "object" && module.exports) {
    // CommonJS (Node test runner)
    module.exports = factory();
  } else if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    // Browser: แขวนเข้า TT namespace
    root.TT = root.TT || {};
    root.TT.brokerMath = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ค่าเริ่มต้นมาตรฐาน (Standard Lot ทั่วไปในตลาด Forex)
  // ใช้สำหรับหน้าเว็บเท่านั้น — ผู้ใช้แก้ไขได้ทั้งหมด
  const DEFAULTS = Object.freeze({
    // 1 Standard Lot = 100,000 หน่วยสกุลเงินหลัก (มาตรฐาน Forex)
    contractSize: 100000,
    // pip value เริ่มต้น (USD/lot) สำหรับ major forex pair เช่น EURUSD
    pipValuePerLot: 10,
    // ค่าเริ่มต้นสำหรับ symbol ต่าง ๆ (ตัวอย่าง — แก้ไขได้)
    symbols: {
      EURUSD: { price: 1.085, pipValuePerLot: 10, pipDigits: 4 },
      GBPUSD: { price: 1.27, pipValuePerLot: 10, pipDigits: 4 },
      USDJPY: { price: 150.5, pipValuePerLot: 9.14, pipDigits: 2 },
      XAUUSD: { price: 2350, pipValuePerLot: 1, pipDigits: 2 }, // 1 pip = $0.01 movement * 100oz
    },
  });

  /**
   * แปลง input ใด ๆ ให้เป็น number ที่ valid
   * @returns {number|null} คืน null ถ้าไม่ใช่จำนวนจริง หรือเป็น NaN/Infinity
   */
  function toNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v == null) return null;
    // ตัด comma และ whitespace
    const s = String(v).trim().replace(/,/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * ตรวจความถูกต้องของจำนวนบวกที่ไม่ใช่ศูนย์
   * @returns {{ok:boolean, value:number, error?:string}}
   */
  function positiveNumber(v, field = "ค่า") {
    const n = toNum(v);
    if (n === null) return { ok: false, value: NaN, error: `${field} ไม่ใช่จำนวนที่ถูกต้อง` };
    if (n === 0) return { ok: false, value: 0, error: `${field} ต้องไม่เป็น 0` };
    if (n < 0) return { ok: false, value: n, error: `${field} ต้องไม่ติดลบ` };
    return { ok: true, value: n };
  }

  /**
   * ตรวจความถูกต้องของจำนวนไม่เป็นลบ (อนุญาต 0 สำหรับบางฟิลด์เช่น nights)
   */
  function nonNegativeNumber(v, field = "ค่า") {
    const n = toNum(v);
    if (n === null) return { ok: false, value: NaN, error: `${field} ไม่ใช่จำนวนที่ถูกต้อง` };
    if (n < 0) return { ok: false, value: n, error: `${field} ต้องไม่ติดลบ` };
    return { ok: true, value: n };
  }

  /**
   * ปัดเศษให้ปลอดภัย (round half up) และจำกัดทศนิยม
   */
  function round(n, digits = 2) {
    if (n == null || !Number.isFinite(n)) return NaN;
    const f = Math.pow(10, digits);
    // แก้ floating-point drift ด้วย epsilon
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  /* ===========================================================
     1) Lot Size Calculator
     -----------------------------------------------------------
     สูตร:
       riskAmount   = capital * (riskPercent / 100)
       totalRiskPerLot = stopLossPips * pipValuePerLot
       lots         = riskAmount / totalRiskPerLot

     หมายเหตุ: pipValuePerLot = มูลค่า pip ต่อ 1 standard lot
     =========================================================== */
  function calcLotSize(input) {
    const capital = positiveNumber(input && input.capital, "เงินทุน");
    if (!capital.ok) return err(capital.error);

    const risk = positiveNumber(input && input.riskPercent, "ความเสี่ยง %");
    if (!risk.ok) return err(risk.error);

    const sl = positiveNumber(input && input.stopLossPips, "Stop Loss (pips)");
    if (!sl.ok) return err(sl.error);

    const pipVal = positiveNumber(input && input.pipValuePerLot, "Pip value");
    if (!pipVal.ok) return err(pipVal.error);

    const riskAmount = capital.value * (risk.value / 100);
    const riskPerLot = sl.value * pipVal.value;
    const lots = riskPerLot > 0 ? riskAmount / riskPerLot : 0;

    return {
      ok: true,
      riskAmount: round(riskAmount, 2),
      riskPerLot: round(riskPerLot, 2),
      lots: round(lots, 4),
      lotsRounded: round(lots, 2),
      formula: "lots = (capital × risk% / 100) ÷ (stopLossPips × pipValuePerLot)",
    };
  }

  /* ===========================================================
     2) Margin Calculator
     -----------------------------------------------------------
     สูตรมาตรฐานสำหรับ Forex (USD account, base/quote logic แบบเรียบ):
       contractValue = lot * contractSize * price
       requiredMargin = contractValue / leverage

     หมายเหตุ: รองรับกรณี quote currency ต่างจาก USD โดยใช้ price
     ที่ผู้ใช้กรอก (ราคาปัจจุบันของคู่เงิน) เป็นตัวแปลงหน่วยแล้ว
     สำหรับ symbol ที่มี USD เป็น quote (เช่น EURUSD) ผลลัพธ์ใกล้เคียงมาตรฐาน
     กรณี JPY/สกุลอื่นผู้ใช้ควรใส่ price ที่ถูกต้อง
     =========================================================== */
  function calcMargin(input) {
    const lot = positiveNumber(input && input.lot, "Lot size");
    if (!lot.ok) return err(lot.error);

    const lev = positiveNumber(input && input.leverage, "Leverage");
    if (!lev.ok) return err(lev.error);

    const price = positiveNumber(input && input.price, "ราคา");
    if (!price.ok) return err(price.error);

    const contractSize = toNum(input && input.contractSize);
    const cs = contractSize && contractSize > 0 ? contractSize : DEFAULTS.contractSize;

    const contractValue = lot.value * cs * price.value;
    const required = contractValue / lev.value;

    return {
      ok: true,
      contractValue: round(contractValue, 2),
      requiredMargin: round(required, 2),
      formula: "margin = (lot × contractSize × price) ÷ leverage",
      contractSizeUsed: cs,
    };
  }

  /* ===========================================================
     3) Trade Cost Comparison
     -----------------------------------------------------------
     สูตร:
       spreadCost  = spreadPips * pipValuePerLot * lot
       commissionCost = commissionPerLot * lot * 2 (เปิด+ปิด 1 round trip)
       costPerRound = spreadCost + commissionCost
       totalCost   = costPerRound * roundTrips

     * commissionPerLot หมายถึง "ต่อข้างต่อล็อต" ตามมาตรฐานโบรกเกอร์ส่วนใหญ่
       (1 round trip = เปิด + ปิด = 2 ข้าง) — ถ้าผู้ใช้ใส่ค่า round trip อยู่แล้ว
       สามารถตั้ง commissionIsRoundTrip = true เพื่อไม่คูณ 2
     =========================================================== */
  function calcTradeCost(input) {
    const spread = nonNegativeNumber(input && input.spreadPips, "Spread");
    if (!spread.ok) return err(spread.error);

    const comm = nonNegativeNumber(input && input.commissionPerLot, "Commission");
    if (!comm.ok) return err(comm.error);

    const lot = positiveNumber(input && input.lot, "Lot size");
    if (!lot.ok) return err(lot.error);

    const rounds = positiveNumber(input && input.roundTrips, "จำนวนรอบ");
    if (!rounds.ok) return err(rounds.error);

    const pipVal = toNum(input && input.pipValuePerLot);
    const pv = pipVal && pipVal > 0 ? pipVal : DEFAULTS.pipValuePerLot;

    const isRT = !!(input && input.commissionIsRoundTrip);
    const commMultiplier = isRT ? 1 : 2;

    const spreadCost = spread.value * pv * lot.value;
    const commissionCost = comm.value * lot.value * commMultiplier;
    const costPerRound = spreadCost + commissionCost;
    const total = costPerRound * rounds.value;

    return {
      ok: true,
      spreadCost: round(spreadCost, 2),
      commissionCost: round(commissionCost, 2),
      costPerRound: round(costPerRound, 2),
      totalCost: round(total, 2),
      formula: "total = (spread×pipValue×lot + commission×lot×2) × roundTrips",
      pipValueUsed: pv,
      commissionPerSide: round(comm.value, 2),
    };
  }

  /** เปรียบเทียบต้นทุนของหลายโบรกเกอร์ (สูงสุด 3) */
  function compareTradeCosts(brokers) {
    if (!Array.isArray(brokers)) return [];
    const list = brokers.slice(0, 3).map((b, i) => {
      const res = calcTradeCost(b);
      return {
        index: i,
        name: (b && b.name) || `Broker ${i + 1}`,
        result: res,
      };
    });
    // เรียงจากต่ำสุดไปสูงสุด (เฉพาะที่ ok)
    return list
      .filter((x) => x.result.ok)
      .sort((a, b) => a.result.totalCost - b.result.totalCost)
      .concat(list.filter((x) => !x.result.ok));
  }

  /* ===========================================================
     4) Swap / Rollover Calculator (ค่าประมาณ)
     -----------------------------------------------------------
     สูตร:
       swap = swapRatePerLot * lot * nights * direction

     * swapRatePerLot = อัตรา swap ที่โบรกเกอร์แจ้ง (ต่อล็อต/คืน)
     * direction: long = +1, short = -1 (short มักเป็นบวกเมื่อ rate ติดลบ)
       → ผู้ใช้ใส่ค่า swap rate พร้อมเครื่องหมาย หรือใช้ direction
     * ผลลัพธ์เป็น "ค่าประมาณ" เท่านั้น
     =========================================================== */
  function calcSwap(input) {
    const direction = input && input.direction === "short" ? "short" : "long";
    const lot = positiveNumber(input && input.lot, "Lot size");
    if (!lot.ok) return err(lot.error);

    // swap rate อนุญาตให้ติดลบได้ (swap rate บางคู่เป็นลบ)
    const rateNum = toNum(input && input.swapRatePerLot);
    if (rateNum === null) return err("Swap rate ไม่ใช่จำนวนที่ถูกต้อง");

    const nights = nonNegativeNumber(input && input.nights, "จำนวนคืน");
    if (!nights.ok) return err(nights.error);

    // ถ้าผู้ใช้ใส่ swap rate พร้อมเครื่องหมายแล้ว ใช้ตามนั้น
    // มิฉะนั้นใช้ direction เพื่อกำหนดเครื่องหมาย (long:+, short:-) เฉพาะเมื่อ rate >= 0
    let effectiveRate = rateNum;
    if (input && input.applyDirectionSign && rateNum >= 0) {
      effectiveRate = direction === "long" ? Math.abs(rateNum) : -Math.abs(rateNum);
    }

    const swap = effectiveRate * lot.value * nights.value;

    return {
      ok: true,
      swap: round(swap, 2),
      direction,
      effectiveRate: round(effectiveRate, 4),
      approximate: true,
      formula: "swap ≈ swapRatePerLot × lot × nights",
      note: "ค่าประมาณตามสูตร — swap rate จริงแตกต่างกันไปตามแต่ละโบรกเกอร์และวันในสัปดาห์ (คืนวันพุธมักคิด 3 เท่า)",
    };
  }

  /* ===========================================================
     helpers ภายใน
     =========================================================== */
  function err(msg) {
    return { ok: false, error: msg || "เกิดข้อผิดพลาดในการคำนวณ" };
  }

  return {
    DEFAULTS,
    toNum,
    round,
    positiveNumber,
    nonNegativeNumber,
    calcLotSize,
    calcMargin,
    calcTradeCost,
    compareTradeCosts,
    calcSwap,
  };
});
