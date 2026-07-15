/* ============================================================
   Phase 9 — Auto Pilot MVP tests
   ------------------------------------------------------------
   ครอบคลุม 13 เคสตามข้อกำหนด:
     1. default disabled
     2. เปิดไม่ได้ถ้า env ปิด
     3. เปิดได้เมื่อ env+DB อนุญาต
     4. run ซ้อนถูกป้องกัน
     5. maxPerRun ≤ 3
     6. ข่าวไม่ผ่าน gate → ไม่ publish
     7. ข่าวผ่านครบ gate → publish
     8. ข่าวหนึ่งล้ม → ข่าวถัดไปยังทำต่อ
     9. emergency stop หยุดรอบ
     10. mock mode → ห้าม publish
     11. ไม่มี sourcePublishedAt → ห้าม publish
     12. audit log ครบ stages
     13. restart → สถานะยังถูกต้อง + lock auto-release

   ใช้ DI mocks: fetchDigest/fetchArticles/processBatch — ไม่ยิง API จริง
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createAutoPilotRepository } from "../src/store/autoPilotRepository.js";
import { createAuditRepository, AUDIT_STAGES } from "../src/store/auditRepository.js";
import { createAutoPilot } from "../src/autopilot/autoPilot.js";
import { evaluateSafetyGate } from "../src/pipeline/runNewsUpdate.js";

/* ---------- helpers ---------- */

/** title หลากหลายจริง (dedupe ตรวจ title similarity — title ที่ normalize แล้วเหมือนกันจะถูกตัด) */
const SAMPLE_TITLES = [
  "Gold steadies above 4000 as PPI cools and yields rise",
  "Silver supply deficits widen as industrial demand climbs",
  "Bank of Canada holds rates steady amid inflation outlook",
  "Fed officials signal patience on rate cuts next quarter",
  "Mining sector braces for regulatory shifts in key regions",
];

/** สร้าง news source สำหรับ mock fetchDigest */
function srcItem(id, overrides = {}) {
  const idx = Math.abs(Number(id)) % SAMPLE_TITLES.length;
  return {
    id,
    sourceUrl: `https://www.kitco.com/news/${id}`,
    originalTitle: SAMPLE_TITLES[idx] || `Unique headline story number ${id}`,
    sourcePublishedAt: new Date().toISOString(),
    duplicateHash: `hash-${id}`,
    ...overrides,
  };
}

/** สร้าง news object ที่ผ่าน pipeline (พร้อม Safety Gate) */
function goodNews(id, overrides = {}) {
  const idx = Math.abs(Number(id)) % SAMPLE_TITLES.length;
  return {
    id: `kitco-${id}`,
    source: "Kitco News",
    sourceUrl: `https://www.kitco.com/news/${id}`,
    sourcePublishedAt: new Date().toISOString(),
    sourcePolicy: "trusted",
    originalTitle: SAMPLE_TITLES[idx] || `Unique headline story number ${id}`,
    originalContent: "x".repeat(150),
    thaiTitle: `ทองคำทรงตัวข่าว ${id}`,
    thaiSummary: `สรุปข่าว ${id}`,
    thaiContent: [`เนื้อหาวรรคหนึ่งของข่าว ${id}`],
    validationStatus: "validated",
    imageStatus: "selected",
    imageReviewRequired: false,
    publishStatus: "ready",
    credit: "Kitco",
    imageUrl: "https://img.com/a.jpg",
    imageSourceUrl: "https://img.com/a",
    aiValidation: {
      bannedWordsFound: [],
      investmentAdviceFound: false,
      numbersMatch: true,
      addedInformationFound: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    duplicateHash: `hash-${id}`,
    ...overrides,
  };
}

/**
 * mock processBatch: รับ newsList (source items) แล้วคืน processed results
 * @param {object} opts { newsFactory: (src) => news, failIds?: Set }
 */
function makeMockProcessBatch(opts = {}) {
  const factory = opts.newsFactory || ((src) => goodNews(src.id));
  const failIds = opts.failIds || new Set();
  return async (newsList, ctx) => {
    const results = newsList.map((src) => {
      if (failIds.has(src.id)) {
        // จำลอง error ระดับข่าว (processAndSaveNews throw)
        return { ok: false, saved: false, error: "mock_process_error", news: null };
      }
      const news = factory(src);
      try {
        ctx.repo.insertNews(news);
      } catch {
        /* may exist */
      }
      return { ok: true, saved: true, news, reason: "validated", imageStatus: "selected" };
    });
    return { results, saved: results.filter((r) => r.saved), duplicates: [], failed: [] };
  };
}

/** setup repos + autoPilot พร้อม mock deps */
function setup(deps = {}) {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const apRepo = createAutoPilotRepository(db);
  const auditRepo = createAuditRepository(db);

  const mockDigest = deps.mockDigest || { items: [srcItem("1")], needsReview: [] };
  const fetchDigestFn = deps.fetchDigestFn || (async () => mockDigest);
  const fetchArticlesFn =
    deps.fetchArticlesFn ||
    (async (items) => ({
      results: items.map((i) => ({ ...i, originalContent: "x".repeat(150) })),
      errors: [],
    }));
  const processBatchFn = deps.processBatchFn || makeMockProcessBatch();
  const envAllowed = deps.envAllowed ?? true;

  const autoPilot = createAutoPilot(
    { repo, apRepo, auditRepo },
    { fetchDigestFn, fetchArticlesFn, processBatchFn, envAllowed }
  );

  return { db, repo, apRepo, auditRepo, autoPilot };
}

/* ============================================================
   1. default disabled
   ============================================================ */
test("1. default disabled", () => {
  const { autoPilot } = setup();
  const s = autoPilot.getStatus();
  assert.equal(s.enabled, false);
  assert.equal(s.status, "off");
  assert.equal(s.emergencyStop, false);
  assert.equal(autoPilot.canRun(), false);
});

/* ============================================================
   2. เปิดไม่ได้ถ้า env ปิด
   ============================================================ */
test("2. enable fails when env not allowed", () => {
  const { autoPilot } = setup({ envAllowed: false });
  const r = autoPilot.enable();
  assert.equal(r.ok, false);
  assert.equal(r.error, "env_not_allowed");
  assert.equal(autoPilot.getStatus().enabled, false);
});

/* ============================================================
   3. เปิดได้เมื่อ env+DB อนุญาต
   ============================================================ */
test("3. enable works when env+DB allow", () => {
  const { autoPilot } = setup({ envAllowed: true });
  const r = autoPilot.enable();
  assert.equal(r.ok, true);
  const s = autoPilot.getStatus();
  assert.equal(s.enabled, true);
  assert.equal(s.status, "idle");
  assert.equal(autoPilot.canRun(), true);
});

/* ============================================================
   4. run ซ้อนถูกป้องกัน (in-process + DB lock)
   ============================================================ */
test("4. concurrent run prevented", async () => {
  const { autoPilot, apRepo } = setup();
  autoPilot.enable();
  // จำลอง DB lock ถูก acquire แล้ว (อีก process)
  apRepo.acquireLock("other-token");
  const r = await autoPilot.runOnce();
  assert.equal(r.skipped, true);
  assert.equal(r.reason, "already_running");
});

/* ============================================================
   5. maxPerRun ≤ 3
   ============================================================ */
test("5. maxPerRun clamped to 3", async () => {
  const mockDigest = { items: [srcItem("1"), srcItem("2"), srcItem("3"), srcItem("4"), srcItem("5")], needsReview: [] };
  const { autoPilot, auditRepo } = setup({ mockDigest });
  autoPilot.enable();
  const r = await autoPilot.runOnce({ maxPerRun: 99 }); // ส่งเกิน
  // digest_fetched audit จะบันทึก maxPerRun ที่ใช้จริง
  const audit = auditRepo.listByRun(r.runId);
  const runStarted = audit.find((a) => a.stage === AUDIT_STAGES.RUN_STARTED);
  assert.equal(runStarted.metadata.maxPerRun, 3, "maxPerRun ต้องถูก clamp เหลือ 3");
  // candidates ไม่เกิน 3 (article_selected count)
  const selected = audit.filter((a) => a.stage === AUDIT_STAGES.ARTICLE_SELECTED);
  assert.ok(selected.length <= 3, `selected ${selected.length} ต้องไม่เกิน 3`);
});

/* ============================================================
   6. ข่าวไม่ผ่าน gate → ไม่ publish (audit publish_blocked)
   ============================================================ */
test("6. news failing gate not published", async () => {
  const mockDigest = { items: [srcItem("1")], needsReview: [] };
  // news ไม่ผ่าน gate: validationStatus = needs_review
  const processBatchFn = makeMockProcessBatch({
    newsFactory: (src) => goodNews(src.id, { validationStatus: "needs_review" }),
  });
  const { autoPilot, repo, auditRepo } = setup({ mockDigest, processBatchFn });
  autoPilot.enable();
  const r = await autoPilot.runOnce();
  assert.equal(r.published, 0);
  assert.equal(r.blocked, 1);
  // ไม่ถูก publish ใน DB
  const news = repo.getById("kitco-1");
  assert.notEqual(news.publishStatus, "published");
  // audit มี publish_blocked
  const blocked = auditRepo.listByRun(r.runId).filter((a) => a.stage === AUDIT_STAGES.PUBLISH_BLOCKED);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].reason, /validationStatus_not_validated/);
});

/* ============================================================
   7. ข่าวผ่านครบ gate → publish
   ============================================================ */
test("7. news passing all gates published", async () => {
  const mockDigest = { items: [srcItem("1")], needsReview: [] };
  const { autoPilot, repo, auditRepo } = setup({ mockDigest });
  autoPilot.enable();
  const r = await autoPilot.runOnce();
  assert.equal(r.published, 1);
  assert.equal(r.publishedIds[0], "kitco-1");
  // ใน DB publishStatus = published
  const news = repo.getById("kitco-1");
  assert.equal(news.publishStatus, "published");
  // audit publish_completed
  const completed = auditRepo.listByRun(r.runId).filter((a) => a.stage === AUDIT_STAGES.PUBLISH_COMPLETED);
  assert.equal(completed.length, 1);
});

/* ============================================================
   8. ข่าวหนึ่งล้ม → ข่าวถัดไปยังทำต่อ
   ============================================================ */
test("8. one news failure continues to next", async () => {
  // ใช้ sourcePublishedAt ต่างกันชัดเจนเพื่อให้ order แน่นอน
  const now = Date.now();
  const mockDigest = {
    items: [
      srcItem("1", { sourcePublishedAt: new Date(now).toISOString() }),
      srcItem("2", { sourcePublishedAt: new Date(now + 1000).toISOString() }),
    ],
    needsReview: [],
  };
  // ข่าว 1 ล้มเหลว, ข่าว 2 ปกติ
  const processBatchFn = makeMockProcessBatch({ failIds: new Set(["1"]) });
  const { autoPilot, repo, auditRepo } = setup({ mockDigest, processBatchFn });
  autoPilot.enable();
  const r = await autoPilot.runOnce();
  // ข่าว 1 failed, ข่าว 2 published
  assert.equal(r.failed, 1);
  assert.equal(r.published, 1, `published ต้องเป็น 1 (ได้ ${r.published}, ids=${JSON.stringify(r.publishedIds)}, audit=${JSON.stringify(auditRepo.listByRun(r.runId).map(a=>a.stage+":"+a.status).join(","))})`);
  assert.equal(r.publishedIds[0], "kitco-2");
  assert.equal(repo.getById("kitco-2").publishStatus, "published");
});

/* ============================================================
   9. emergency stop หยุดรอบ
   ============================================================ */
test("9. emergency stop halts run mid-way", async () => {
  const now = Date.now();
  const mockDigest = {
    items: [
      srcItem("1", { sourcePublishedAt: new Date(now).toISOString() }),
      srcItem("2", { sourcePublishedAt: new Date(now + 1000).toISOString() }),
      srcItem("3", { sourcePublishedAt: new Date(now + 2000).toISOString() }),
    ],
    needsReview: [],
  };
  // processBatch ประมวลผลครบทั้ง 3 แต่ trigger emergency stop หลังข่าว 1
  // (autoPilot จะเห็น flag ใน loop หน้า ก่อนเริ่มข่าว 2)
  const { autoPilot, apRepo, auditRepo } = setup({
    mockDigest,
    processBatchFn: async (newsList, ctx) => {
      const results = [];
      for (const src of newsList) {
        const news = goodNews(src.id);
        try { ctx.repo.insertNews(news); } catch {}
        results.push({ ok: true, saved: true, news, reason: "validated", imageStatus: "selected" });
      }
      // หลังประมวลผลครบ จำลอง emergency stop ถูกตั้งระหว่างที่ autoPilot publish loop
      // (publish loop จะเห็น flag ก่อนเริ่มข่าวถัดไป)
      apRepo.setEmergencyStop(true);
      return { results, saved: results, duplicates: [], failed: [] };
    },
  });
  autoPilot.enable();
  const r = await autoPilot.runOnce();
  // emergency stop ต้องหยุดก่อน publish ครบ
  assert.ok(r.published < 3, `ต้องหยุดก่อนครบ 3 (published=${r.published})`);
  const stopped = auditRepo.listByRun(r.runId).filter((a) => a.stage === AUDIT_STAGES.EMERGENCY_STOP);
  assert.ok(stopped.length >= 1, "ต้องมี emergency_stop audit");
});

/* ============================================================
   10. mock mode → ห้าม publish
   ============================================================ */
test("10. mock mode blocks publish", async () => {
  const mockDigest = { items: [srcItem("1")], needsReview: [] };
  // processBatch คืน reason ที่บ่ง mock
  const processBatchFn = async (newsList, ctx) => {
    const results = newsList.map((src) => {
      const news = goodNews(src.id);
      try { ctx.repo.insertNews(news); } catch {}
      return { ok: true, saved: true, news, reason: "validated_mock", imageStatus: "selected" };
    });
    return { results, saved: results, duplicates: [], failed: [] };
  };
  const { autoPilot, auditRepo } = setup({ mockDigest, processBatchFn });
  autoPilot.enable();
  const r = await autoPilot.runOnce();
  assert.equal(r.published, 0, "mock mode ห้าม publish");
  assert.equal(r.blocked, 1);
  const blocked = auditRepo.listByRun(r.runId).filter((a) => a.stage === AUDIT_STAGES.PUBLISH_BLOCKED);
  assert.match(blocked[0].reason, /mock_mode/);
});

/* ============================================================
   11. ไม่มี sourcePublishedAt → ห้าม publish
   ============================================================ */
test("11. missing sourcePublishedAt blocks publish", async () => {
  const mockDigest = { items: [srcItem("1")], needsReview: [] };
  const processBatchFn = makeMockProcessBatch({
    newsFactory: (src) => goodNews(src.id, { sourcePublishedAt: null }),
  });
  const { autoPilot, auditRepo } = setup({ mockDigest, processBatchFn });
  autoPilot.enable();
  const r = await autoPilot.runOnce();
  assert.equal(r.published, 0);
  assert.equal(r.blocked, 1);
  const blocked = auditRepo.listByRun(r.runId).filter((a) => a.stage === AUDIT_STAGES.PUBLISH_BLOCKED);
  assert.match(blocked[0].reason, /invalid_or_missing_sourcePublishedAt/);
});

/* ============================================================
   12. audit log ครบ stages
   ============================================================ */
test("12. audit log covers all required stages", async () => {
  const mockDigest = { items: [srcItem("1")], needsReview: [] };
  const { autoPilot, auditRepo } = setup({ mockDigest });
  autoPilot.enable();
  const r = await autoPilot.runOnce();
  const stages = auditRepo.listByRun(r.runId).map((a) => a.stage);
  const required = [
    AUDIT_STAGES.RUN_STARTED,
    AUDIT_STAGES.DIGEST_FETCHED,
    AUDIT_STAGES.ARTICLE_SELECTED,
    AUDIT_STAGES.REWRITE_COMPLETED,
    AUDIT_STAGES.IMAGE_COMPLETED,
    AUDIT_STAGES.VALIDATION_PASSED,
    AUDIT_STAGES.PUBLISH_COMPLETED,
    AUDIT_STAGES.RUN_COMPLETED,
  ];
  for (const s of required) {
    assert.ok(stages.includes(s), `audit ต้องมี stage: ${s}`);
  }
  // ทุก entry ต้องมี timestamp + runId + stage + status
  const all = auditRepo.listByRun(r.runId);
  for (const a of all) {
    assert.ok(a.createdAt, "ต้องมี createdAt");
    assert.equal(a.runId, r.runId);
    assert.ok(a.stage);
    assert.ok(a.status);
  }
  // metadata ต้องไม่มี secret
  const jsonStr = JSON.stringify(all);
  assert.equal(jsonStr.includes("api_key"), false, "metadata ต้องไม่มี secret key");
  assert.equal(jsonStr.includes("admin_token"), false);
});

/* ============================================================
   13. restart → crash lock auto-released on migration re-run
   ============================================================ */
test("13. crash lock auto-released on migration re-run", async () => {
  const { __runMigrationsOn } = await import("../src/store/db.js");
  const db = createTestDb();
  // seed crash state (จำลอง process crash ระหว่าง runOnce)
  db.prepare(
    "UPDATE auto_pilot_settings SET status = 'running', lock_token = ?, last_error = NULL WHERE id = 'singleton'"
  ).run("crashed-token-x");
  const before = db
    .prepare("SELECT status, lock_token FROM auto_pilot_settings WHERE id = 'singleton'")
    .get();
  assert.equal(before.status, "running");
  assert.equal(before.lock_token, "crashed-token-x");
  // re-run migration → auto-release
  __runMigrationsOn(db);
  const after = db
    .prepare("SELECT status, lock_token, last_error FROM auto_pilot_settings WHERE id = 'singleton'")
    .get();
  assert.equal(after.status, "stopped_error", "status ต้องเปลี่ยนเป็น stopped_error");
  assert.equal(after.lock_token, null, "lock_token ต้องถูก clear");
  assert.equal(after.last_error, "process_restart_during_run");
  db.close();
});

/* ============================================================
   extra — Safety Gate unit tests (16 gates coverage)
   ============================================================ */
test("Safety Gate: all 16 gates evaluated", () => {
  const good = goodNews("x");
  assert.equal(evaluateSafetyGate(good).passed, true);

  // ตัวอย่าง gate failures (subset — ครอบคลุมหลายข้อ)
  assert.match(evaluateSafetyGate({ ...good, sourcePolicy: "needs_review" }).reasons.join(","), /source_not_trusted/);
  assert.match(evaluateSafetyGate({ ...good, sourceUrl: "" }).reasons.join(","), /missing_source_url/);
  assert.match(evaluateSafetyGate({ ...good, sourcePublishedAt: null }).reasons.join(","), /sourcePublishedAt/);
  assert.match(evaluateSafetyGate({ ...good, validationStatus: "rejected" }).reasons.join(","), /deterministic_rejected/);
  assert.match(evaluateSafetyGate({ ...good, validationStatus: "needs_review" }).reasons.join(","), /not_validated/);
  assert.match(evaluateSafetyGate({ ...good, imageStatus: "fallback" }).reasons.join(","), /imageStatus_not_selected/);
  assert.match(evaluateSafetyGate({ ...good, imageReviewRequired: true }).reasons.join(","), /image_review_required/);
  assert.match(evaluateSafetyGate({ ...good, publishStatus: "published" }).reasons.join(","), /already_published/);
  assert.match(evaluateSafetyGate({ ...good, sourcePublishedAt: "2020-01-01T00:00:00Z" }).reasons.join(","), /news_too_old/);
  assert.match(evaluateSafetyGate({ ...good, aiValidation: { ...good.aiValidation, numbersMatch: false } }).reasons.join(","), /numbers_mismatch/);
  assert.match(evaluateSafetyGate({ ...good, credit: "" }).reasons.join(","), /missing_credit/);
  assert.match(evaluateSafetyGate(good, { isMockRun: true }).reasons.join(","), /mock_mode/);
});

/* ============================================================
   extra — audit secret scrubbing
   ============================================================ */
test("audit scrubs secrets from metadata", () => {
  const { db, auditRepo } = setup();
  auditRepo.append({
    runId: "r1",
    stage: AUDIT_STAGES.RUN_STARTED,
    status: "ok",
    metadata: { apiKey: "sk-real-secret", adminToken: "tok", count: 5, nested: { password: "p" } },
  });
  const entries = auditRepo.listByRun("r1");
  assert.equal(entries[0].metadata.apiKey, "[redacted]");
  assert.equal(entries[0].metadata.adminToken, "[redacted]");
  assert.equal(entries[0].metadata.count, 5);
  assert.equal(entries[0].metadata.nested.password, "[redacted]");
  db.close();
});
