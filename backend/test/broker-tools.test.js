/* ============================================================
   Broker Tools — Pure function tests
   ทดสอบสูตรทั้งหมด + edge cases (input ผิด, 0, ติดลบ, string, null)
   รันด้วย: node --test backend/test/broker-tools.test.js
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const MATH_PATH = resolve(
  process.cwd(),
  "..",
  "Version-2-Gold-Trading",
  "broker-tools.math.js"
);

let m;
try {
  m = require(MATH_PATH);
} catch (e) {
  // กรณี cwd อยู่ที่ backend/
  m = require(
    resolve(process.cwd(), "Version-2-Gold-Trading", "broker-tools.math.js")
  );
}

const {
  toNum,
  round,
  positiveNumber,
  nonNegativeNumber,
  calcLotSize,
  calcMargin,
  calcTradeCost,
  compareTradeCosts,
  calcSwap,
  DEFAULTS,
} = m;

/* ============================================================
   helpers: toNum, round, validators
   ============================================================ */
test("toNum: แปลงค่าปกติ และ string ที่มี comma/whitespace", () => {
  assert.equal(toNum(100), 100);
  assert.equal(toNum("100"), 100);
  assert.equal(toNum("1,234.56"), 1234.56);
  assert.equal(toNum("  50 "), 50);
  assert.equal(toNum("0.5"), 0.5);
});

test("toNum: คืน null สำหรับค่าผิด", () => {
  assert.equal(toNum(null), null);
  assert.equal(toNum(undefined), null);
  assert.equal(toNum(""), null);
  assert.equal(toNum("abc"), null);
  assert.equal(toNum(NaN), null);
  assert.equal(toNum(Infinity), null);
  assert.equal(toNum(-Infinity), null);
  assert.equal(toNum(" "), null);
});

test("round: ปัดเศษทศนิยมถูกต้อง และรอดพ้น floating-point drift", () => {
  assert.equal(round(1.005, 2), 1.01);
  assert.equal(round(2.675, 2), 2.68);
  assert.equal(round(123.4567, 2), 123.46);
  assert.equal(round(0.1 + 0.2, 1), 0.3);
  assert.ok(Number.isNaN(round(NaN)));
});

test("positiveNumber: ค่าถูกต้อง", () => {
  assert.deepEqual(positiveNumber(100, "X"), { ok: true, value: 100 });
  assert.deepEqual(positiveNumber("0.5", "X"), { ok: true, value: 0.5 });
});

test("positiveNumber: ปฏิเสธ 0", () => {
  const r = positiveNumber(0, "เงินทุน");
  assert.equal(r.ok, false);
  assert.equal(r.value, 0);
  assert.match(r.error, /เงินทุน/);
  assert.match(r.error, /0/);
});

test("positiveNumber: ปฏิเสธค่าติดลบ", () => {
  const r = positiveNumber(-50, "Lot");
  assert.equal(r.ok, false);
  assert.equal(r.value, -50);
  assert.match(r.error, /Lot/);
  assert.match(r.error, /ลบ/);
});

test("positiveNumber: ปฏิเสธค่าไม่ใช่จำนวน", () => {
  const r = positiveNumber("abc", "X");
  assert.equal(r.ok, false);
  assert.match(r.error, /ถูกต้อง/);
});

test("nonNegativeNumber: อนุญาต 0 แต่ปฏิเสธลบ", () => {
  assert.equal(nonNegativeNumber(0, "X").ok, true);
  assert.equal(nonNegativeNumber(5, "X").ok, true);
  const r = nonNegativeNumber(-1, "คืน");
  assert.equal(r.ok, false);
  assert.match(r.error, /คืน/);
});

/* ============================================================
   1) Lot Size Calculator
   ============================================================ */
test("calcLotSize: กรณีปกติ (ตัวอย่างในหน้าเว็บ)", () => {
  // capital=10000, risk=1%, SL=50 pips, pipValue=10
  const r = calcLotSize({ capital: 10000, riskPercent: 1, stopLossPips: 50, pipValuePerLot: 10 });
  assert.equal(r.ok, true);
  // riskAmount = 10000 * 1% = 100
  assert.equal(r.riskAmount, 100);
  // riskPerLot = 50 * 10 = 500
  assert.equal(r.riskPerLot, 500);
  // lots = 100 / 500 = 0.2
  assert.equal(r.lots, 0.2);
  assert.equal(r.lotsRounded, 0.2);
  assert.ok(r.formula);
});

test("calcLotSize: ความเสี่ยงสูง → lot ใหญ่ขึ้นตามสัดส่วน", () => {
  const r1 = calcLotSize({ capital: 5000, riskPercent: 1, stopLossPips: 20, pipValuePerLot: 10 });
  const r2 = calcLotSize({ capital: 5000, riskPercent: 2, stopLossPips: 20, pipValuePerLot: 10 });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.lots, r1.lots * 2);
});

test("calcLotSize: SL ลดลง → lot เพิ่มขึ้น", () => {
  const wide = calcLotSize({ capital: 10000, riskPercent: 1, stopLossPips: 100, pipValuePerLot: 10 });
  const tight = calcLotSize({ capital: 10000, riskPercent: 1, stopLossPips: 25, pipValuePerLot: 10 });
  assert.equal(tight.lots, wide.lots * 4);
});

test("calcLotSize: capital = 0 ไม่ผ่าน", () => {
  const r = calcLotSize({ capital: 0, riskPercent: 1, stopLossPips: 50, pipValuePerLot: 10 });
  assert.equal(r.ok, false);
  assert.match(r.error, /เงินทุน/);
});

test("calcLotSize: ค่าติดลบไม่ผ่าน", () => {
  const r = calcLotSize({ capital: -1000, riskPercent: 1, stopLossPips: 50, pipValuePerLot: 10 });
  assert.equal(r.ok, false);
  assert.match(r.error, /เงินทุน/);
});

test("calcLotSize: input ผิด (string, null) ไม่ทำให้พัง", () => {
  const r = calcLotSize({ capital: "abc", riskPercent: null, stopLossPips: undefined, pipValuePerLot: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /เงินทุน/);
});

test("calcLotSize: riskPercent = 0 ไม่ผ่าน", () => {
  const r = calcLotSize({ capital: 10000, riskPercent: 0, stopLossPips: 50, pipValuePerLot: 10 });
  assert.equal(r.ok, false);
  assert.match(r.error, /ความเสี่ยง/);
});

test("calcLotSize: pipValuePerLot = 0 ไม่ผ่าน", () => {
  const r = calcLotSize({ capital: 10000, riskPercent: 1, stopLossPips: 50, pipValuePerLot: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Pip value/);
});

test("calcLotSize: ไม่มี input เลย", () => {
  const r = calcLotSize();
  assert.equal(r.ok, false);
  assert.match(r.error, /เงินทุน/);
});

test("calcLotSize: ตัวเลขแบบ string ที่มี comma", () => {
  const r = calcLotSize({ capital: "10,000", riskPercent: "1", stopLossPips: "50", pipValuePerLot: "10" });
  assert.equal(r.ok, true);
  assert.equal(r.lots, 0.2);
});

/* ============================================================
   2) Margin Calculator
   ============================================================ */
test("calcMargin: กรณีปกติ EURUSD 1 lot 1:30", () => {
  // lot=1, contractSize=100000, price=1.085, leverage=30
  // contractValue = 1 * 100000 * 1.085 = 108500
  // margin = 108500 / 30 = 3616.67
  const r = calcMargin({ lot: 1, leverage: 30, price: 1.085 });
  assert.equal(r.ok, true);
  assert.equal(r.contractValue, 108500);
  assert.equal(r.requiredMargin, round(108500 / 30, 2));
});

test("calcMargin: XAUUSD 0.5 lot 1:100", () => {
  // contractSize default 100000 — แต่ทองมักใช้ 100oz/lot
  // ผู้ใช้สามารถ override contractSize ได้
  const r = calcMargin({ lot: 0.5, leverage: 100, price: 2350, contractSize: 100 });
  assert.equal(r.ok, true);
  // 0.5 * 100 * 2350 = 117500, /100 = 1175
  assert.equal(r.contractValue, 117500);
  assert.equal(r.requiredMargin, 1175);
});

test("calcMargin: leverage สูง → margin ต่ำลง", () => {
  const low = calcMargin({ lot: 1, leverage: 30, price: 1.1 });
  const high = calcMargin({ lot: 1, leverage: 300, price: 1.1 });
  // leverage 300 = 10x ของ 30 → margin เป็น 1/10
  assert.equal(high.requiredMargin, round(low.requiredMargin / 10, 2));
});

test("calcMargin: lot = 0 ไม่ผ่าน", () => {
  const r = calcMargin({ lot: 0, leverage: 30, price: 1.1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Lot/);
});

test("calcMargin: leverage ติดลบไม่ผ่าน", () => {
  const r = calcMargin({ lot: 1, leverage: -10, price: 1.1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Leverage/);
});

test("calcMargin: price = 0 ไม่ผ่าน", () => {
  const r = calcMargin({ lot: 1, leverage: 30, price: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error, /ราคา/);
});

test("calcMargin: input ว่างทั้งหมด", () => {
  const r = calcMargin({});
  assert.equal(r.ok, false);
  assert.match(r.error, /Lot/);
});

test("calcMargin: ใช้ contractSize default เมื่อไม่ระบุ", () => {
  const r = calcMargin({ lot: 1, leverage: 1, price: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.contractSizeUsed, DEFAULTS.contractSize);
  assert.equal(r.requiredMargin, DEFAULTS.contractSize);
});

/* ============================================================
   3) Trade Cost Comparison
   ============================================================ */
test("calcTradeCost: กรณีปกติ", () => {
  // spread=0.5 pips, commission=$3.5/side, lot=1, rounds=20
  // spreadCost = 0.5 * 10 * 1 = 5
  // commissionCost = 3.5 * 1 * 2 = 7
  // costPerRound = 5 + 7 = 12
  // total = 12 * 20 = 240
  const r = calcTradeCost({ spreadPips: 0.5, commissionPerLot: 3.5, lot: 1, roundTrips: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.spreadCost, 5);
  assert.equal(r.commissionCost, 7);
  assert.equal(r.costPerRound, 12);
  assert.equal(r.totalCost, 240);
});

test("calcTradeCost: commissionIsRoundTrip = true ไม่คูณ 2", () => {
  const r = calcTradeCost({
    spreadPips: 0.5,
    commissionPerLot: 7, // ราคารวม round-trip แล้ว
    lot: 1,
    roundTrips: 20,
    commissionIsRoundTrip: true,
  });
  assert.equal(r.commissionCost, 7);
  assert.equal(r.costPerRound, 12);
});

test("calcTradeCost: spread 0 ได้ (commission only)", () => {
  const r = calcTradeCost({ spreadPips: 0, commissionPerLot: 3.5, lot: 1, roundTrips: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.spreadCost, 0);
  assert.equal(r.commissionCost, 7);
  assert.equal(r.totalCost, 70);
});

test("calcTradeCost: lot = 0 ไม่ผ่าน", () => {
  const r = calcTradeCost({ spreadPips: 0.5, commissionPerLot: 3.5, lot: 0, roundTrips: 10 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Lot/);
});

test("calcTradeCost: roundTrips ติดลบไม่ผ่าน", () => {
  const r = calcTradeCost({ spreadPips: 0.5, commissionPerLot: 3.5, lot: 1, roundTrips: -5 });
  assert.equal(r.ok, false);
  assert.match(r.error, /รอบ/);
});

test("calcTradeCost: input ทั้งหมดเป็น string ผิด", () => {
  const r = calcTradeCost({ spreadPips: "x", commissionPerLot: [], lot: null, roundTrips: undefined });
  assert.equal(r.ok, false);
});

test("compareTradeCosts: เรียงจากต้นทุนต่ำสุดไปสูงสุด", () => {
  const brokers = [
    { name: "A", spreadPips: 1.0, commissionPerLot: 7, lot: 1, roundTrips: 10 }, // total: (10+14)*10=240
    { name: "B", spreadPips: 0.2, commissionPerLot: 3, lot: 1, roundTrips: 10 }, // total: (2+6)*10=80
    { name: "C", spreadPips: 0.5, commissionPerLot: 3.5, lot: 1, roundTrips: 10 }, // total: (5+7)*10=120
  ];
  const sorted = compareTradeCosts(brokers);
  assert.equal(sorted.length, 3);
  assert.equal(sorted[0].name, "B");
  assert.equal(sorted[1].name, "C");
  assert.equal(sorted[2].name, "A");
});

test("compareTradeCosts: จำกัดสูงสุด 3 โบรกเกอร์", () => {
  const brokers = Array.from({ length: 5 }, (_, i) => ({
    name: `B${i}`,
    spreadPips: 0.1 * i,
    commissionPerLot: 3,
    lot: 1,
    roundTrips: 10,
  }));
  assert.equal(compareTradeCosts(brokers).length, 3);
});

test("compareTradeCosts: แยก result ที่ผิดไว้ท้าย และไม่พัง", () => {
  const brokers = [
    { name: "OK", spreadPips: 0.5, commissionPerLot: 3.5, lot: 1, roundTrips: 10 },
    { name: "BAD", spreadPips: "x", commissionPerLot: 3.5, lot: 1, roundTrips: 10 },
  ];
  const sorted = compareTradeCosts(brokers);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].name, "OK");
  assert.equal(sorted[0].result.ok, true);
  assert.equal(sorted[1].name, "BAD");
  assert.equal(sorted[1].result.ok, false);
});

test("compareTradeCosts: input ไม่ใช่ array → []", () => {
  assert.deepEqual(compareTradeCosts(null), []);
  assert.deepEqual(compareTradeCosts(undefined), []);
  assert.deepEqual(compareTradeCosts("abc"), []);
});

/* ============================================================
   4) Swap / Rollover Calculator
   ============================================================ */
test("calcSwap: long กรณีปกติ", () => {
  // rate=5 USD/lot/night, lot=1, nights=3, long
  // swap = 5 * 1 * 3 = 15
  const r = calcSwap({ swapRatePerLot: 5, lot: 1, nights: 3, direction: "long" });
  assert.equal(r.ok, true);
  assert.equal(r.swap, 15);
  assert.equal(r.direction, "long");
  assert.equal(r.approximate, true);
});

test("calcSwap: short สลับเครื่องหมายเมื่อ applyDirectionSign", () => {
  const r = calcSwap({
    swapRatePerLot: 5,
    lot: 1,
    nights: 3,
    direction: "short",
    applyDirectionSign: true,
  });
  assert.equal(r.swap, -15);
  assert.equal(r.direction, "short");
});

test("calcSwap: rate ติดลบ (สมจริง long ที่เสีย swap)", () => {
  const r = calcSwap({ swapRatePerLot: -5, lot: 2, nights: 7, direction: "long" });
  assert.equal(r.ok, true);
  assert.equal(r.swap, -70);
});

test("calcSwap: nights = 0 → swap = 0 (ผ่าน ไม่พัง)", () => {
  const r = calcSwap({ swapRatePerLot: 5, lot: 1, nights: 0, direction: "long" });
  assert.equal(r.ok, true);
  assert.equal(r.swap, 0);
});

test("calcSwap: lot = 0 ไม่ผ่าน", () => {
  const r = calcSwap({ swapRatePerLot: 5, lot: 0, nights: 3, direction: "long" });
  assert.equal(r.ok, false);
  assert.match(r.error, /Lot/);
});

test("calcSwap: nights ติดลบไม่ผ่าน", () => {
  const r = calcSwap({ swapRatePerLot: 5, lot: 1, nights: -3, direction: "long" });
  assert.equal(r.ok, false);
  assert.match(r.error, /คืน/);
});

test("calcSwap: swap rate ผิด", () => {
  const r = calcSwap({ swapRatePerLot: "abc", lot: 1, nights: 3, direction: "long" });
  assert.equal(r.ok, false);
  assert.match(r.error, /Swap rate/);
});

test("calcSwap: default direction เป็น long", () => {
  const r = calcSwap({ swapRatePerLot: 5, lot: 1, nights: 3 });
  assert.equal(r.direction, "long");
});

test("calcSwap: ระบุ approximate flag และ note", () => {
  const r = calcSwap({ swapRatePerLot: 5, lot: 1, nights: 3 });
  assert.equal(r.approximate, true);
  assert.ok(r.note && r.note.length > 0);
  assert.match(r.note, /ประมาณ/);
});

/* ============================================================
   Smoke: ทุกฟังก์ชันคืน object ที่มี ok flag เสมอ (no throw)
   ============================================================ */
test("no-throw: ทุกฟังก์ชันไม่ throw กับ input แย่ ๆ", () => {
  const bad = [null, undefined, "", "abc", {}, [], NaN, true, false];
  for (const v of bad) {
    assert.doesNotThrow(() => calcLotSize(v));
    assert.doesNotThrow(() => calcMargin(v));
    assert.doesNotThrow(() => calcTradeCost(v));
    assert.doesNotThrow(() => calcSwap(v));
  }
});

test("formula ถูกส่งกลับในผลลัพธ์ทุกตัว", () => {
  assert.ok(calcLotSize({ capital: 100, riskPercent: 1, stopLossPips: 5, pipValuePerLot: 1 }).formula);
  assert.ok(calcMargin({ lot: 1, leverage: 30, price: 1 }).formula);
  assert.ok(calcTradeCost({ spreadPips: 1, commissionPerLot: 1, lot: 1, roundTrips: 1 }).formula);
  assert.ok(calcSwap({ swapRatePerLot: 1, lot: 1, nights: 1 }).formula);
});
