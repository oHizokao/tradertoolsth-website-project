/* ============================================================
   Focused test — /api/calendar/upcoming truthfulness
   ------------------------------------------------------------
   Regression guard for the home-page calendar widget:
   - upcoming ต้อง surface เฉพาะ event ในอนาคตเท่านั้น (now-aware)
   - เมื่อ cache มีแต่ event ที่ผ่านไปแล้ว ต้องคืน items:[] (จริง)
     ห้าม "เติม" หรือย้อนเวลาเพื่อทำให้ดูมีข้อมูล → ห้าม fabricate
   - envelope ต้องมี updatedAt/stale/source เพื่อให้ UI อธิบายได้
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/store/db.js";
import { createCalendarRepository } from "../src/store/calendarRepository.js";
import { createCalendarService } from "../src/calendar/calendarService.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd(), "..");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeEvent(overrides = {}) {
  return {
    sourceEventId: "ff-upcoming-1",
    sourceName: "Forex Factory",
    sourceUrl: "https://www.forexfactory.com/calendar/",
    eventName: "CPI m/m",
    country: "USD",
    currency: "USD",
    impact: "high",
    scheduledAtUtc: iso(DAY),
    scheduledAtBangkok: iso(DAY),
    actual: null,
    forecast: "0.2%",
    previous: "0.2%",
    revised: null,
    detailUrl: null,
    isTentative: false,
    lastUpdated: iso(0),
    ...overrides,
  };
}

async function makeServer({ seed = [] } = {}) {
  const db = createTestDb();
  const repo = createCalendarRepository(db);
  for (const ev of seed) repo.upsertEvent(ev);
  repo.setSyncMeta({
    lastSyncAt: iso(0),
    lastSyncOk: true,
    lastEventCount: seed.length,
    sourceName: "Forex Factory",
  });
  const calendarService = createCalendarService(repo, { enabled: true });
  const server = createHttpServer({
    calendarService,
    projectRoot,
    adminToken: "",
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

async function getJson(base, path) {
  const res = await fetch(base + path, { headers: { accept: "application/json" } });
  const text = await res.text();
  return { status: res.status, payload: text ? JSON.parse(text) : {} };
}

test("upcoming surfaces ONLY future events (sorted asc)", async () => {
  const s = await makeServer({
    seed: [
      // past — must be excluded
      makeEvent({ sourceEventId: "past1", scheduledAtUtc: iso(-2 * DAY), scheduledAtBangkok: iso(-2 * DAY), eventName: "PastA" }),
      makeEvent({ sourceEventId: "past2", scheduledAtUtc: iso(-1 * HOUR), scheduledAtBangkok: iso(-1 * HOUR), eventName: "PastB" }),
      // future — must appear, sorted asc
      makeEvent({ sourceEventId: "fut2", scheduledAtUtc: iso(2 * DAY), scheduledAtBangkok: iso(2 * DAY), eventName: "FutureB" }),
      makeEvent({ sourceEventId: "fut1", scheduledAtUtc: iso(1 * DAY), scheduledAtBangkok: iso(1 * DAY), eventName: "FutureA" }),
    ],
  });
  try {
    const r = await getJson(s.base, "/api/calendar/upcoming?limit=5");
    assert.equal(r.status, 200);
    assert.equal(r.payload.items.length, 2, "past events excluded; only 2 future");
    assert.equal(r.payload.items[0].eventName, "FutureA");
    assert.equal(r.payload.items[1].eventName, "FutureB");
    // envelope fields ที่ UI ใช้อธิบายแหล่ง/เวลา
    assert.equal(r.payload.source, "Forex Factory");
    assert.ok(r.payload.updatedAt, "updatedAt present for UI status bar");
    assert.equal(typeof r.payload.stale, "boolean");
  } finally {
    await s.close();
  }
});

test("upcoming is empty (truthful) when all cached events are in the past — no fabrication", async () => {
  const s = await makeServer({
    seed: [
      makeEvent({ sourceEventId: "p1", scheduledAtUtc: iso(-3 * DAY), scheduledAtBangkok: iso(-3 * DAY) }),
      makeEvent({ sourceEventId: "p2", scheduledAtUtc: iso(-1 * HOUR), scheduledAtBangkok: iso(-1 * HOUR) }),
    ],
  });
  try {
    // /api/calendar ยังคืน cache ทั้งหมด (มี events) — แสดงว่า cache ไม่ว่าง
    const all = await getJson(s.base, "/api/calendar");
    assert.ok(all.payload.items.length > 0, "cache has events (proves this isn't an empty cache)");

    // upcoming ต้องว่างเพราะทุก event ผ่านไปแล้ว — ห้าม fabricate
    const r = await getJson(s.base, "/api/calendar/upcoming?limit=5");
    assert.equal(r.status, 200);
    assert.equal(Array.isArray(r.payload.items), true);
    assert.equal(r.payload.items.length, 0, "no future events → empty (truthful)");
    assert.equal(r.payload.source, "Forex Factory");
    assert.ok(r.payload.updatedAt, "updatedAt still present so UI can explain update time");
  } finally {
    await s.close();
  }
});

test("upcoming respects limit and only counts future events", async () => {
  const seed = [];
  for (let i = 1; i <= 6; i++) {
    seed.push(
      makeEvent({
        sourceEventId: `fut${i}`,
        scheduledAtUtc: iso(i * DAY),
        scheduledAtBangkok: iso(i * DAY),
        eventName: `Future${i}`,
      })
    );
  }
  const s = await makeServer({ seed });
  try {
    const r = await getJson(s.base, "/api/calendar/upcoming?limit=3");
    assert.equal(r.status, 200);
    assert.equal(r.payload.items.length, 3, "limit honoured");
    assert.equal(r.payload.items[0].eventName, "Future1");
    assert.equal(r.payload.items[2].eventName, "Future3");
  } finally {
    await s.close();
  }
});
