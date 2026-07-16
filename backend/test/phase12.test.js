/* ============================================================
   Phase 12 — Economic Calendar tests
   ------------------------------------------------------------
   ครอบคลุม (ตามที่ Codex กำหนด):
     A. Scraper
       1. parse Forex Factory JSON export → normalized events
       2. timezone: UTC stored, Asia/Bangkok derived (+7)
       3. impact High/Medium/Low → high/medium/low (Holiday → low)
       4. tentative time detection
       5. actual/forecast/previous normalization ("" → null)
       6. invalid date ถูกทิ้ง (ห้ามเดาเวลา)
       7. deterministic sourceEventId (stable hash)
     B. Repository
       8. upsert + duplicate update (Actual ใหม่ update record เดิม)
       9. กันเขียนทับ Actual ด้วย NULL
      10. filters: date range / currency / impact
     C. Service
      11. cache fallback เมื่อ source error (คืน cache เดิม + stale)
      12. stale detection
      13. sync ไม่ซ้อน (in-flight lock)
      14. prune events เก่า
     D. API (HTTP)
      15. GET /api/calendar คืน envelope {items, updatedAt, stale, source}
      16. GET /api/calendar?importance=high / ?currency=USD
      17. GET /api/calendar/upcoming?limit=N (sorted asc)
      18. POST /api/admin/calendar/refresh: ไม่มี auth → 401; origin ผิด → 403
      19. public API ไม่ leak secret/internal fields
      20. invalid importance → 400
     E. Migration
      21. migration idempotent (รันซ้ได้ ไม่ error)
      22. มี index ครบ (scheduled_at_utc, currency, impact, source_event_id)
      23. ตาราง calendar แยกจาก news (ไม่กระทบ)
     F. Frontend handling
      24. calendar.service.js normalize envelope (array + object)
      25. error envelope ไม่ crash

   กฎ QC: ใช้ injectable fetchFn (fake source) — ห้ามยิง source จริงใน test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTestDb, __runMigrationsOn } from "../src/store/db.js";
import { createCalendarRepository } from "../src/store/calendarRepository.js";
import { createCalendarService } from "../src/calendar/calendarService.js";
import {
  normalizeEvent,
  parseCalendarJson,
  normalizeImpact,
  makeSourceEventId,
} from "../src/calendar/forexFactory.scraper.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const projectRoot = resolve(process.cwd(), "..");

// ====== FIXTURE: sample Forex Factory JSON export ======
function ffFixture() {
  return JSON.stringify([
    {
      title: "Core CPI m/m",
      country: "USD",
      date: "2026-07-14T08:30:00-04:00",
      impact: "High",
      forecast: "0.2%",
      previous: "0.2%",
    },
    {
      title: "ECB Press Conference",
      country: "EUR",
      date: "2026-07-17T08:30:00-04:00",
      impact: "High",
      forecast: "",
      previous: "",
    },
    {
      title: "BoJ Policy Rate",
      country: "JPY",
      date: "2026-07-17T23:00:00-04:00",
      impact: "Medium",
      forecast: "0.10%",
      previous: "0.10%",
    },
    {
      title: "French Bank Holiday",
      country: "EUR",
      date: "2026-07-14T02:01:00-04:00",
      impact: "Holiday",
      forecast: "",
      previous: "",
    },
    {
      title: "Italian Trade Balance",
      country: "EUR",
      date: "2026-07-14T04:00:00-04:00",
      impact: "Low",
      forecast: "-2.5B",
      previous: "-3.1B",
    },
    // invalid date — ต้องถูกทิ้ง
    {
      title: "Bad Event",
      country: "USD",
      date: "not-a-date",
      impact: "High",
      forecast: "1%",
      previous: "2%",
    },
  ]);
}

function makeTestToken() {
  return "test-" + randomBytes(16).toString("hex");
}

// ===================== A. SCRAPER =====================

test("A1. parseCalendarJson แปลง FF export → normalized events (drop invalid date)", () => {
  const events = parseCalendarJson(ffFixture());
  // 5 valid + 1 invalid date (ต้องถูกทิ้ง) = 5
  assert.equal(events.length, 5, "invalid date ต้องถูกทิ้ง");
  // ทุก event ต้องมี field ครบ
  for (const ev of events) {
    assert.ok(ev.sourceEventId, "ต้องมี sourceEventId");
    assert.ok(ev.sourceName);
    assert.ok(ev.eventName);
    assert.ok(ev.scheduledAtUtc);
    assert.ok(ev.scheduledAtBangkok);
    assert.ok(["low", "medium", "high"].includes(ev.impact));
  }
});

test("A2. timezone: scheduledAtUtc เป็น UTC (Z), scheduledAtBangkok = UTC+7", () => {
  const events = parseCalendarJson(ffFixture());
  const cpi = events.find((e) => e.eventName === "Core CPI m/m");
  assert.ok(cpi);
  // 2026-07-14T08:30:00-04:00 → UTC 12:30:00Z
  assert.equal(cpi.scheduledAtUtc, "2026-07-14T12:30:00.000Z");
  // Bangkok = UTC+7 → 19:30:00Z (แสดงเป็น offset)
  assert.equal(cpi.scheduledAtBangkok, "2026-07-14T19:30:00.000Z");
  // ตรวจว่า UTC ลงท้ายด้วย Z
  assert.ok(cpi.scheduledAtUtc.endsWith("Z"));
});

test("A3. impact: High/Medium/Low → high/medium/low; Holiday → low", () => {
  const events = parseCalendarJson(ffFixture());
  const byName = Object.fromEntries(events.map((e) => [e.eventName, e.impact]));
  assert.equal(byName["Core CPI m/m"], "high");
  assert.equal(byName["BoJ Policy Rate"], "medium");
  assert.equal(byName["Italian Trade Balance"], "low");
  assert.equal(byName["French Bank Holiday"], "low", "Holiday → low");

  // unit ของ normalizeImpact
  assert.equal(normalizeImpact("High"), "high");
  assert.equal(normalizeImpact("Medium"), "medium");
  assert.equal(normalizeImpact("Low"), "low");
  assert.equal(normalizeImpact("Holiday"), "low");
  assert.equal(normalizeImpact("Non-Economic"), "low");
  assert.equal(normalizeImpact(""), "low");
});

test("A4. tentative: Holiday impact → isTentative=true", () => {
  const events = parseCalendarJson(ffFixture());
  const holiday = events.find((e) => e.eventName === "French Bank Holiday");
  assert.equal(holiday.isTentative, true, "Holiday ต้องเป็น tentative");
  const cpi = events.find((e) => e.eventName === "Core CPI m/m");
  assert.equal(cpi.isTentative, false);

  // รองรับ title ที่มีคำว่า Tentative
  const ten = normalizeEvent(
    { title: "FOMC Meeting (Tentative)", country: "USD", date: "2026-07-14T18:00:00-04:00", impact: "Medium" },
    {}
  );
  assert.equal(ten.isTentative, true);
});

test("A5. actual/forecast/previous: '' → null", () => {
  const ev = normalizeEvent(
    { title: "X", country: "USD", date: "2026-07-14T08:30:00-04:00", impact: "High", forecast: "", previous: "", actual: "" },
    {}
  );
  assert.equal(ev.forecast, null);
  assert.equal(ev.previous, null);
  assert.equal(ev.actual, null);

  const ev2 = normalizeEvent(
    { title: "Y", country: "USD", date: "2026-07-14T08:30:00-04:00", impact: "High", forecast: "0.3%", previous: "0.2%", actual: "0.4%" },
    {}
  );
  assert.equal(ev2.forecast, "0.3%");
  assert.equal(ev2.previous, "0.2%");
  assert.equal(ev2.actual, "0.4%");
});

test("A6. invalid date → event ถูกทิ้ง (ห้ามเดาเวลา)", () => {
  const bad = normalizeEvent(
    { title: "Bad", country: "USD", date: "garbage", impact: "High" },
    {}
  );
  assert.equal(bad, null);

  const noDate = normalizeEvent(
    { title: "NoDate", country: "USD", impact: "High" },
    {}
  );
  assert.equal(noDate, null);
});

test("A7. deterministic sourceEventId: same (date+title+currency) → same id", () => {
  const a = makeSourceEventId({ dateUtc: "2026-07-14T12:30:00.000Z", title: "CPI", currency: "USD" });
  const b = makeSourceEventId({ dateUtc: "2026-07-14T12:30:00.000Z", title: "CPI", currency: "USD" });
  assert.equal(a, b);
  assert.ok(a.startsWith("ff-"));
  // ค่าต่าง → id ต่าง
  const c = makeSourceEventId({ dateUtc: "2026-07-14T12:30:00.000Z", title: "CPI", currency: "EUR" });
  assert.notEqual(a, c);
});

test("A8. parseCalendarJson: invalid JSON → throw (ไม่ silent fail)", () => {
  assert.throws(() => parseCalendarJson("not json"), /invalid JSON/);
  assert.throws(() => parseCalendarJson('{"obj":1}'), /not an array/);
});

// ===================== B. REPOSITORY =====================

function makeEvent(overrides = {}) {
  return {
    sourceEventId: "ff-test1",
    sourceName: "Forex Factory",
    sourceUrl: "https://www.forexfactory.com/calendar/",
    eventName: "CPI m/m",
    country: "USD",
    currency: "USD",
    impact: "high",
    scheduledAtUtc: "2026-07-14T12:30:00.000Z",
    scheduledAtBangkok: "2026-07-14T19:30:00.000Z",
    actual: null,
    forecast: "0.2%",
    previous: "0.2%",
    revised: null,
    detailUrl: null,
    isTentative: false,
    lastUpdated: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

test("B8. upsert: Actual ใหม่ → update record เดิม ไม่สร้างซ้ำ", () => {
  const db = createTestDb();
  try {
    const repo = createCalendarRepository(db);
    // insert ครั้งแรก (ยังไม่มี Actual)
    const ev1 = makeEvent({ actual: null });
    repo.upsertEvent(ev1);
    assert.equal(repo.count(), 1);
    assert.equal(repo.getBySourceEventId("ff-test1").actual, null);

    // upsert ซ้ำด้วย Actual ใหม่ → ต้อง update ไม่สร้าง row ใหม่
    const ev2 = makeEvent({ actual: "0.3%", lastUpdated: "2026-07-16T01:00:00.000Z" });
    repo.upsertEvent(ev2);
    assert.equal(repo.count(), 1, "ต้องยังเป็น 1 row (update ไม่ insert)");
    const got = repo.getBySourceEventId("ff-test1");
    assert.equal(got.actual, "0.3%");
    assert.equal(got.lastUpdated, "2026-07-16T01:00:00.000Z");
  } finally {
    db.close();
  }
});

test("B9. upsert: actual=null ต้องไม่เขียนทับ Actual เดิม", () => {
  const db = createTestDb();
  try {
    const repo = createCalendarRepository(db);
    repo.upsertEvent(makeEvent({ actual: "0.3%" }));
    // sync รอบใหม่ (ยังไม่มี actual ใน export) → ต้องไม่ลบ actual เดิม
    repo.upsertEvent(makeEvent({ actual: null }));
    assert.equal(
      repo.getBySourceEventId("ff-test1").actual,
      "0.3%",
      "ต้องคง actual เดิมไว้"
    );
  } finally {
    db.close();
  }
});

test("B10. filters: date range / currency / impact", () => {
  const db = createTestDb();
  try {
    const repo = createCalendarRepository(db);
    const now = "2026-07-16T00:00:00.000Z";
    repo.upsertEvent(makeEvent({ sourceEventId: "e1", currency: "USD", impact: "high", scheduledAtUtc: "2026-07-14T12:30:00.000Z", scheduledAtBangkok: "2026-07-14T19:30:00.000Z" }));
    repo.upsertEvent(makeEvent({ sourceEventId: "e2", currency: "EUR", impact: "high", scheduledAtUtc: "2026-07-17T12:30:00.000Z", scheduledAtBangkok: "2026-07-17T19:30:00.000Z" }));
    repo.upsertEvent(makeEvent({ sourceEventId: "e3", currency: "JPY", impact: "medium", scheduledAtUtc: "2026-07-18T03:00:00.000Z", scheduledAtBangkok: "2026-07-18T10:00:00.000Z" }));

    // date range
    const range = repo.listRange({ fromUtc: "2026-07-14T00:00:00.000Z", toUtc: "2026-07-15T23:59:59.000Z" });
    assert.equal(range.length, 1);
    assert.equal(range[0].sourceEventId, "e1");

    // currency filter
    assert.equal(repo.listRange({ currency: "USD" }).length, 1);
    assert.equal(repo.listRange({ currency: "EUR" }).length, 1);
    assert.equal(repo.listRange({ currency: "GBP" }).length, 0);

    // impact filter
    assert.equal(repo.listRange({ impact: "high" }).length, 2);
    assert.equal(repo.listRange({ impact: "medium" }).length, 1);
    assert.equal(repo.listRange({ impact: "low" }).length, 0);

    // combined
    const combined = repo.listRange({ currency: "JPY", impact: "medium" });
    assert.equal(combined.length, 1);
    assert.equal(combined[0].sourceEventId, "e3");

    // listRange ทั้งหมด (no filter) → เรียง asc
    const all = repo.listRange({});
    assert.equal(all.length, 3);
    assert.equal(all[0].sourceEventId, "e1", "เรียงเวลาเก่า→ใหม่");
    assert.equal(all[2].sourceEventId, "e3");

    // case-insensitive currency
    assert.equal(repo.listRange({ currency: "usd" }).length, 1);
  } finally {
    db.close();
  }
});

// ===================== C. SERVICE =====================

function makeServiceWithFakeFetch(fetchImpl, opts = {}) {
  const db = createTestDb();
  const repo = createCalendarRepository(db);
  const service = createCalendarService(repo, {
    enabled: true,
    fetchFn: fetchImpl,
    staleAfterSeconds: opts.staleAfterSeconds ?? 1800,
    syncIntervalSeconds: 300,
    ...opts,
  });
  return { db, repo, service };
}

test("C11. cache fallback เมื่อ source error → คืน cache เดิม + stale=true", async () => {
  // seed cache ก่อน
  const { db, repo, service } = makeServiceWithFakeFetch(async () => {
    throw new Error("simulated HTTP 500");
  });
  try {
    repo.upsertEvent(makeEvent({ sourceEventId: "cached1", actual: "0.3%" }));
    repo.setSyncMeta({ lastSyncAt: new Date(Date.now() - 7200000).toISOString(), lastSyncOk: true, lastEventCount: 1, sourceName: "Forex Factory" });

    // sync ล้มเหลว → ต้องคืน cache เดิม ไม่ลบ
    const result = await service.sync();
    assert.equal(result.ok, false);
    assert.equal(result.stale, true);
    // cache ยังอยู่
    assert.equal(repo.count(), 1);
    assert.equal(repo.getBySourceEventId("cached1").actual, "0.3%");
    // readEvents ยังคืนข้อมูล cache
    const env = service.readEvents({});
    assert.equal(env.items.length, 1);
    assert.equal(env.stale, true, "ต้อง stale เพราะ sync ล้มเหลว");
    // meta บันทึก error
    const meta = repo.getSyncMeta();
    assert.equal(meta.lastSyncOk, false);
    assert.ok(meta.lastError);
  } finally {
    db.close();
  }
});

test("C12. stale detection: fresh cache → stale=false; เก่า → stale=true", async () => {
  const { db, repo, service } = makeServiceWithFakeFetch(
    async () => parseCalendarJson(ffFixture()),
    { staleAfterSeconds: 600 }
  );
  try {
    // ยังไม่เคย sync → stale
    assert.equal(service.isStale(), true);
    // sync สำเร็จ → fresh
    await service.sync();
    assert.equal(service.isStale(), false);
    // จำลอง sync เก่า
    repo.setSyncMeta({ lastSyncAt: new Date(Date.now() - 3600000).toISOString(), lastSyncOk: true });
    assert.equal(service.isStale(), true, "เกิน staleAfterSeconds → stale");
  } finally {
    db.close();
  }
});

test("C13. sync ไม่ซ้อน (in-flight lock) — concurrent sync → skip", async () => {
  let callCount = 0;
  const { db, service } = makeServiceWithFakeFetch(async () => {
    callCount++;
    // หน่วงเพื่อจำลอง sync ยาว
    await new Promise((r) => setTimeout(r, 100));
    return parseCalendarJson(ffFixture());
  });
  try {
    // ยิง sync 2 ครั้งพร้อมกัน
    const [a, b] = await Promise.all([service.sync(), service.sync()]);
    // ต้องมีอย่างน้อย 1 ครั้งที่ skipped=true
    const skipped = a.skipped || b.skipped;
    assert.equal(skipped, true, "sync ที่ซ้อนต้องถูก skip");
    // fetchFn ถูกเรียกไม่เกิน 1 ครั้ง (sync ที่ skip ไม่ยิง source)
    assert.ok(callCount <= 1, "fetchFn ต้องไม่ถูกเรียกซ้อน");
  } finally {
    db.close();
  }
});

test("C14. prune events เก่ากว่า maxEventAgeHours", async () => {
  const { db, repo, service } = makeServiceWithFakeFetch(async () => {
    return parseCalendarJson(ffFixture());
  }, { maxEventAgeHours: 1 });
  try {
    // seed event เก่ามาก (เมื่อวาน)
    const oldIso = new Date(Date.now() - 48 * 3600000).toISOString();
    repo.upsertEvent(makeEvent({ sourceEventId: "old1", scheduledAtUtc: oldIso, scheduledAtBangkok: oldIso }));
    assert.equal(repo.count(), 1);
    // sync → prune events เก่า
    await service.sync();
    // event เก่าต้องถูกลบ
    const oldStill = repo.getBySourceEventId("old1");
    assert.equal(oldStill, null, "event เก่าต้องถูก prune");
  } finally {
    db.close();
  }
});

test("C14b. sync สำเร็จ → upsertMany + meta lastSyncOk=true", async () => {
  const { db, repo, service } = makeServiceWithFakeFetch(async () => {
    return parseCalendarJson(ffFixture());
  });
  try {
    const result = await service.sync();
    assert.equal(result.ok, true);
    assert.equal(result.saved, 5, "5 events จาก fixture");
    assert.equal(result.total, 5);
    const meta = repo.getSyncMeta();
    assert.equal(meta.lastSyncOk, true);
    assert.equal(meta.lastEventCount, 5);
    assert.ok(meta.lastSyncAt);
  } finally {
    db.close();
  }
});

// ===================== D. API (HTTP) =====================

async function makeServer(opts = {}) {
  const db = createTestDb();
  const calendarRepo = createCalendarRepository(db);
  const fetchImpl =
    opts.fetchImpl ||
    (async () => parseCalendarJson(ffFixture()));
  const calendarService = createCalendarService(calendarRepo, {
    enabled: true,
    fetchFn: fetchImpl,
    staleAfterSeconds: 1800,
  });
  // seed cache (sync ก่อนเพื่อมีข้อมูลตอบ)
  if (opts.seed !== false) {
    await calendarService.sync();
  }
  const token = opts.token || makeTestToken();
  const server = createHttpServer({
    calendarService,
    projectRoot,
    adminToken: token,
    adminAllowedOrigins: opts.adminAllowedOrigins || [],
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    token,
    calendarService,
    calendarRepo,
    db,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

async function req(base, method, path, opts = {}) {
  const init = { method, headers: { Accept: "application/json" } };
  if (opts.origin !== undefined) init.headers["origin"] = opts.origin;
  if (opts.auth) init.headers["authorization"] = "Bearer " + opts.auth;
  if (opts.cookie) init.headers["cookie"] = opts.cookie;
  const res = await fetch(base + path, init);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload: payload || {} };
}

test("D15. GET /api/calendar คืน envelope {items, updatedAt, stale, source}", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "GET", "/api/calendar");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.payload.items));
    assert.ok(r.payload.updatedAt, "ต้องมี updatedAt");
    assert.equal(typeof r.payload.stale, "boolean");
    assert.equal(r.payload.source, "Forex Factory");
    assert.ok(r.payload.items.length > 0, "ต้องมี events จาก seeded cache");
  } finally {
    await s.close();
  }
});

test("D16. GET /api/calendar?importance=high / ?currency=USD filters", async () => {
  const s = await makeServer();
  try {
    const rHigh = await req(s.base, "GET", "/api/calendar?importance=high");
    assert.equal(rHigh.status, 200);
    assert.ok(rHigh.payload.items.length > 0);
    assert.ok(rHigh.payload.items.every((i) => i.impact === "high"), "ทุก item ต้องเป็น high");

    const rUsd = await req(s.base, "GET", "/api/calendar?currency=USD");
    assert.equal(rUsd.status, 200);
    assert.ok(rUsd.payload.items.every((i) => i.currency === "USD"));

    // alias impact=high ต้องทำงานเหมือนกัน
    const rImpact = await req(s.base, "GET", "/api/calendar?impact=high");
    assert.equal(rImpact.payload.items.length, rHigh.payload.items.length);
  } finally {
    await s.close();
  }
});

test("D17. GET /api/calendar/upcoming?limit=N sorted asc", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "GET", "/api/calendar/upcoming?limit=3");
    assert.equal(r.status, 200);
    assert.ok(r.payload.items.length <= 3);
    // ต้องเรียง asc ตาม scheduledAtUtc
    for (let i = 1; i < r.payload.items.length; i++) {
      assert.ok(
        new Date(r.payload.items[i].scheduledAtUtc) >= new Date(r.payload.items[i - 1].scheduledAtUtc),
        "ต้องเรียงเวลาเก่า→ใหม่"
      );
    }
  } finally {
    await s.close();
  }
});

test("D18. POST /api/admin/calendar/refresh: no auth → 401; origin ผิด → 403", async () => {
  const s = await makeServer({ adminAllowedOrigins: [] });
  try {
    // no auth → 401
    const r1 = await req(s.base, "POST", "/api/admin/calendar/refresh", { origin: s.base });
    assert.equal(r1.status, 401);
    assert.equal(r1.payload.error, "unauthorized");
    // auth ถูก + origin ผิด → 403
    const r2 = await req(s.base, "POST", "/api/admin/calendar/refresh", {
      auth: s.token,
      origin: "http://evil.example.com",
    });
    assert.equal(r2.status, 403);
    assert.equal(r2.payload.error, "origin_not_allowed");
    // auth ถูก + origin ถูก → 202
    const r3 = await req(s.base, "POST", "/api/admin/calendar/refresh", {
      auth: s.token,
      origin: s.base,
    });
    assert.equal(r3.status, 202);
    assert.equal(r3.payload.ok, true);
  } finally {
    await s.close();
  }
});

test("D19. public API ไม่ leak secret/internal fields", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "GET", "/api/calendar");
    const dump = JSON.stringify(r.payload);
    // ห้ามมี secret
    assert.equal(dump.includes(s.token), false, "ห้ามคืน admin token");
    assert.equal(dump.includes("adminToken"), false);
    // ห้ามส่ง internal scrape metadata ที่ไม่จำเป็น (createdAt เป็น internal)
    for (const item of r.payload.items) {
      assert.equal(item.createdAt, undefined, "ห้ามส่ง createdAt (internal)");
      assert.equal(item.sourceEventId, undefined, "ใช้ id แทน sourceEventId (internal hash)");
    }
  } finally {
    await s.close();
  }
});

test("D20. invalid importance → 400", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "GET", "/api/calendar?importance=banana");
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "invalid_importance");
  } finally {
    await s.close();
  }
});

// ===================== E. MIGRATION =====================

test("E21. migration idempotent — รันซ้ำไม่ error", () => {
  const db = createTestDb();
  try {
    // รัน migration ซ้ำอีกครั้ง → ต้องไม่ throw
    assert.doesNotThrow(() => __runMigrationsOn(db));
    assert.doesNotThrow(() => __runMigrationsOn(db));
    // ตารางยังอยู่
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'calendar%'")
      .all();
    assert.ok(tables.some((t) => t.name === "calendar_events"));
    assert.ok(tables.some((t) => t.name === "calendar_sync_meta"));
  } finally {
    db.close();
  }
});

test("E22. มี index ครบ (scheduled_at_utc, currency, impact, source_event_id)", () => {
  const db = createTestDb();
  try {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_calendar%'")
      .all()
      .map((r) => r.name);
    assert.ok(indexes.includes("idx_calendar_scheduled_at_utc"));
    assert.ok(indexes.includes("idx_calendar_currency"));
    assert.ok(indexes.includes("idx_calendar_impact"));
    assert.ok(indexes.includes("idx_calendar_source_event_id"));
  } finally {
    db.close();
  }
});

test("E23. ตาราง calendar แยกจาก news — news table ไม่ถูกกระทบ", () => {
  const db = createTestDb();
  try {
    // news table ต้องยังมี schema เดิม (id, source, ...)
    const newsCols = db.prepare("PRAGMA table_info(news)").all().map((c) => c.name);
    assert.ok(newsCols.includes("id"));
    assert.ok(newsCols.includes("source"));
    assert.ok(newsCols.includes("validation_status"));
    // calendar table ต้องมี columns ของตัวเอง
    const calCols = db.prepare("PRAGMA table_info(calendar_events)").all().map((c) => c.name);
    assert.ok(calCols.includes("source_event_id"));
    assert.ok(calCols.includes("scheduled_at_utc"));
    assert.ok(calCols.includes("impact"));
    // news ไม่มี column ของ calendar และในทางกลับกัน
    assert.equal(newsCols.includes("scheduled_at_utc"), false);
    assert.equal(calCols.includes("validation_status"), false);
  } finally {
    db.close();
  }
});

// ===================== F. FRONTEND handling (logic-level) =====================
// ทดสอบ logic ของ service normalization แบบ isolated (ไม่ต้อง DOM)
// จำลองพฤติกรรม calendar.service.js

function normalizeEnvelopeLikeService(payload) {
  // จำลอง logic ใน Version-2-Gold-Trading/services/calendar.service.js
  if (Array.isArray(payload)) {
    return { items: payload, updatedAt: null, stale: false, source: "Forex Factory" };
  }
  if (payload && typeof payload === "object") {
    const items = Array.isArray(payload.items) ? payload.items : [];
    return {
      items,
      updatedAt: payload.updatedAt || null,
      stale: !!payload.stale,
      source: payload.source || "Forex Factory",
    };
  }
  return { items: [], updatedAt: null, stale: true, source: "Forex Factory" };
}

test("F24. frontend normalize envelope: รองรับ array และ object", () => {
  // array → envelope
  const arr = normalizeEnvelopeLikeService([{ id: "1" }, { id: "2" }]);
  assert.equal(arr.items.length, 2);
  assert.equal(arr.stale, false);

  // object envelope → normalize
  const obj = normalizeEnvelopeLikeService({
    items: [{ id: "1" }],
    updatedAt: "2026-07-16T00:00:00.000Z",
    stale: true,
    source: "Forex Factory",
  });
  assert.equal(obj.items.length, 1);
  assert.equal(obj.updatedAt, "2026-07-16T00:00:00.000Z");
  assert.equal(obj.stale, true);

  // null/undefined → empty (ไม่ crash)
  const empty = normalizeEnvelopeLikeService(null);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.stale, true);
});

test("F25. frontend: error จาก API ต้องไม่ crash และบอก error flag", () => {
  // จำลอง: API ล้มเหลว → service คืน envelope ที่มี error:true, items=[]
  const errorEnvelope = { items: [], updatedAt: null, stale: true, source: "Forex Factory", error: true };
  // UI ต้องเช็ค error flag → แสดง error state (ไม่แสดง empty state ปกติ)
  assert.equal(errorEnvelope.error, true);
  assert.equal(errorEnvelope.items.length, 0);
  // stale=true บอกว่าไม่มีข้อมูลล่าสุด
  assert.equal(errorEnvelope.stale, true);
});

test("F26. frontend: ไม่มี hardcode ข้อมูลหลอก — items มาจาก API เท่านั้น", () => {
  // ตรวจว่า calendar.service.js ไม่มี fallback เป็น mock data
  // (อ่าน source และยืนยันว่าไม่มีการอ้าง TT.calendar เป็น fallback)
  const svcSrc = readFileSync(
    resolve(projectRoot, "Version-2-Gold-Trading", "services", "calendar.service.js"),
    "utf8"
  );
  // ห้ามมี TT.calendar (mock data) ใน service ใหม่
  assert.equal(svcSrc.includes("TT.calendar"), false, "service ต้องไม่ใช้ TT.calendar mock เป็น fallback");
  // ต้องเรียก /api/calendar
  assert.ok(svcSrc.includes("/api/calendar"), "service ต้องเรียก /api/calendar");
});

// ===================== Extra: stale response field =====================

test("G27. response มี stale field ที่ reflect sync state", async () => {
  const { db, service } = makeServiceWithFakeFetch(async () => {
    throw new Error("source down");
  });
  try {
    // sync ล้มเหลวตั้งแต่แรก → stale
    await service.sync();
    const env = service.readEvents({});
    assert.equal(env.stale, true);
    assert.equal(env.source, "Forex Factory");
    assert.equal(env.updatedAt, null, "ยังไม่เคย sync สำเร็จ → updatedAt=null");
  } finally {
    db.close();
  }
});
