/* ============================================================
   Phase 11 — News Management API tests
   ------------------------------------------------------------
   ครอบคลุม News Management ที่เพิ่มใน Phase 11:
     1. counts endpoint คืน publishStatus + validationStatus maps
     2. news list default (all) sort ใหม่→เก่า
     3. news list filter ตาม ?status= (publish_status)
     4. approve: validationStatus != validated → 409
     5. approve: validated → ready (200)
     6. reject → validationStatus='rejected' + publishStatus='rejected'
     7. publish: ผ่าน gate → published; ไม่ผ่าน → 409
     8. review: schema invalid → 400
     9. review: sourceChecked != true → 400
    10. review: unexpected number → 409 deterministic_quality_gate
    11. review: ผ่าน → validated/ready (200)
    12. rollback: ไม่มี published → 409
    13. rollback: มี published → ready + audit 'news_rollback'
    14. rollback ซ้อน → 409
    15. auth unified: cookie login → /api/admin/news ผ่าน
    16. auth: ไม่มี cookie/Bearer → 401
    17. CSRF: POST ด้วย cookie + origin ผิด → 403; GET ไม่ต้อง origin → 200
    18. response ไม่คืน adminToken / internal fields

   กฎ QC: ใช้ TEST TOKEN (random) เท่านั้น — ห้ามใช้ ADMIN_TOKEN จริงจาก env
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createAutoPilotRepository } from "../src/store/autoPilotRepository.js";
import { createAuditRepository } from "../src/store/auditRepository.js";
import { createAutoPilot } from "../src/autopilot/autoPilot.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd(), "..");

function makeTestToken() {
  return "test-" + randomBytes(16).toString("hex");
}

/** sample news ที่ผ่าน safety gate ทั้งหมด (สามารถ publish ได้) */
function samplePublishable(overrides = {}) {
  const now = "2026-07-16T08:00:00.000Z";
  return {
    id: "gold-test-001",
    source: "Kitco News",
    sourceUrl: "https://www.kitco.com/news/article/gold-test-001",
    originalTitle: "Gold rises as Fed rate expectations change",
    originalAuthor: "Kitco News",
    originalPublishedAt: now,
    sourcePublishedAt: now,
    category: "Market News",
    originalContent: "Gold prices moved higher after interest-rate expectations changed. ".repeat(5),
    thaiTitle: "ทองคำปรับตัวขึ้น หลังมุมมองดอกเบี้ยเฟดเปลี่ยน",
    thaiSummary: "ราคาทองคำขยับขึ้น ขณะที่ตลาดประเมินแนวโน้มดอกเบี้ยใหม่",
    thaiContent: [
      "ราคาทองคำปรับตัวสูงขึ้น หลังนักลงทุนทบทวนแนวโน้มอัตราดอกเบี้ยของธนาคารกลางสหรัฐ",
      "ข้อมูลดังกล่าวอาจเพิ่มความผันผวนให้ตลาดระยะสั้น โดยยังต้องติดตามตัวเลขเศรษฐกิจถัดไป",
    ],
    marketFactors: "ดอกเบี้ยสหรัฐและค่าเงินดอลลาร์",
    keyFacts: ["ราคาทองคำปรับขึ้น"],
    mentionedNumbers: [],
    credit: "เรียบเรียงจาก Kitco News",
    imageUrl: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg",
    imageSource: "Pexels",
    imageAuthor: "Tester",
    imageAuthorUrl: "https://www.pexels.com/@tester",
    imageLicense: "Pexels License",
    imageSourceUrl: "https://www.pexels.com/photo/1/",
    imageSearchKeywords: ["gold market"],
    imageStatus: "selected",
    imageReviewRequired: false,
    validationStatus: "validated",
    publishStatus: "processing",
    aiConfidence: 94,
    aiValidation: { isValid: true },
    duplicateHash: "hash-gold-test-001",
    sourcePolicy: "trusted",
    sourcePolicyReason: "kitco",
    topics: ["gold", "fed"],
    section: "Latest Metals News",
    teaser: "Gold rises",
    isExternal: false,
    pipelineNote: "validated",
    createdAt: now,
    updatedAt: now,
    validatedAt: now,
    publishedAt: null,
    ...overrides,
  };
}

async function makeServer(opts = {}) {
  const db = createTestDb();
  const repo = createNewsRepository(db);
  const apRepo = createAutoPilotRepository(db);
  const auditRepo = createAuditRepository(db);
  const autoPilot = createAutoPilot(
    { repo, apRepo, auditRepo },
    {
      fetchDigestFn: async () => ({ items: [], needsReview: [] }),
      fetchArticlesFn: async () => ({ results: [], errors: [] }),
      processBatchFn: async () => ({ results: [], saved: [], duplicates: [], failed: [] }),
      envAllowed: opts.envAllowed ?? true,
    }
  );
  const token = opts.token || makeTestToken();
  const server = createHttpServer({
    repo,
    autoPilot,
    auditRepo,
    projectRoot,
    siteVersion: "2",
    adminToken: token,
    adminAllowedOrigins: opts.adminAllowedOrigins || [],
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    token,
    autoPilot,
    repo,
    auditRepo,
    db,
    close: async () => {
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

async function req(base, method, path, opts = {}) {
  const init = { method, headers: {} };
  if (opts.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  if (opts.origin !== undefined) init.headers["origin"] = opts.origin;
  if (opts.cookie) init.headers["cookie"] = opts.cookie;
  if (opts.auth) init.headers["authorization"] = "Bearer " + opts.auth;
  const res = await fetch(base + path, init);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return {
    status: res.status,
    setCookie: res.headers.get("set-cookie"),
    payload: payload || {},
  };
}

/** login แล้วคืน cookie string */
async function login(s) {
  const r = await req(s.base, "POST", "/api/admin/auto-pilot/login", {
    body: { token: s.token },
    origin: s.base,
  });
  assert.equal(r.status, 200, "login ต้องสำเร็จ");
  // ดึง cookie value ออกจาก Set-Cookie header
  const m = r.setCookie.match(/admin_session=([^;]+)/);
  return "admin_session=" + m[1];
}

const NEWS = "/api/admin/news";
const AP = "/api/admin/auto-pilot";

/* ---------- 1. counts ---------- */
test("1. GET /counts คืน publishStatus + validationStatus maps", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable());
    s.repo.insertNews(samplePublishable({ id: "n2", duplicateHash: "n2", sourceUrl: "https://k.com/2", publishStatus: "ready" }));
    s.repo.insertNews(samplePublishable({ id: "n3", duplicateHash: "n3", sourceUrl: "https://k.com/3", validationStatus: "needs_review", publishStatus: "draft" }));
    const cookie = await login(s);
    const r = await req(s.base, "GET", NEWS + "/counts", { cookie });
    assert.equal(r.status, 200);
    assert.equal(typeof r.payload.publishStatus, "object");
    assert.equal(typeof r.payload.validationStatus, "object");
    assert.equal(r.payload.total, 3);
    assert.equal(r.payload.publishStatus.processing, 1);
    assert.equal(r.payload.publishStatus.ready, 1);
    assert.equal(r.payload.publishStatus.draft, 1);
    assert.equal(r.payload.validationStatus.validated, 2);
    assert.equal(r.payload.validationStatus.needs_review, 1);
  } finally {
    await s.close();
  }
});

/* ---------- 2. news list default sort ใหม่→เก่า ---------- */
test("2. GET /news default sort newest→oldest (created_at DESC)", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "old", duplicateHash: "old", sourceUrl: "https://k.com/old", createdAt: "2026-07-10T00:00:00.000Z" }));
    s.repo.insertNews(samplePublishable({ id: "new", duplicateHash: "new", sourceUrl: "https://k.com/new", createdAt: "2026-07-16T00:00:00.000Z" }));
    const cookie = await login(s);
    const r = await req(s.base, "GET", NEWS, { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.payload.length, 2);
    assert.equal(r.payload[0].id, "new", "newest first");
    assert.equal(r.payload[1].id, "old");
  } finally {
    await s.close();
  }
});

/* ---------- 3. news list filter ?status= ---------- */
test("3. GET /news?status=ready filter ตาม publish_status", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "pub", duplicateHash: "pub", sourceUrl: "https://k.com/pub" }));
    s.repo.insertNews(samplePublishable({ id: "rdy", duplicateHash: "rdy", sourceUrl: "https://k.com/rdy", publishStatus: "ready" }));
    const cookie = await login(s);
    const r = await req(s.base, "GET", NEWS + "?status=ready", { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.payload.length, 1);
    assert.equal(r.payload[0].id, "rdy");
    assert.equal(r.payload[0].publishStatus, "ready");
  } finally {
    await s.close();
  }
});

/* ---------- 4. approve: validationStatus != validated → 409 ---------- */
test("4. approve: validationStatus=needs_review → 409 quality_validation_required", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "nv", duplicateHash: "nv", sourceUrl: "https://k.com/nv", validationStatus: "needs_review" }));
    const cookie = await login(s);
    const r = await req(s.base, "POST", NEWS + "/nv/approve", { cookie, origin: s.base, body: {} });
    assert.equal(r.status, 409);
    assert.equal(r.payload.error, "quality_validation_required");
  } finally {
    await s.close();
  }
});

/* ---------- 5. approve: validated → ready ---------- */
test("5. approve: validated → 200 publishStatus=ready", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "ok", duplicateHash: "ok", sourceUrl: "https://k.com/ok", validationStatus: "validated", publishStatus: "processing" }));
    const cookie = await login(s);
    const r = await req(s.base, "POST", NEWS + "/ok/approve", { cookie, origin: s.base, body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.payload.publishStatus, "ready");
    assert.equal(s.repo.getById("ok").publishStatus, "ready");
  } finally {
    await s.close();
  }
});

/* ---------- 6. reject → rejected ---------- */
test("6. reject → validationStatus + publishStatus = rejected", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "rj", duplicateHash: "rj", sourceUrl: "https://k.com/rj" }));
    const cookie = await login(s);
    const r = await req(s.base, "POST", NEWS + "/rj/reject", { cookie, origin: s.base, body: { reason: "test" } });
    assert.equal(r.status, 200);
    assert.equal(r.payload.validationStatus, "rejected");
    assert.equal(r.payload.publishStatus, "rejected");
    const after = s.repo.getById("rj");
    assert.equal(after.validationStatus, "rejected");
    assert.equal(after.publishStatus, "rejected");
  } finally {
    await s.close();
  }
});

/* ---------- 7. publish: ผ่าน gate → published; ไม่ผ่าน → 409 ---------- */
test("7a. publish: ผ่าน safety gate → 200 published", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "p1", duplicateHash: "p1", sourceUrl: "https://k.com/p1", publishStatus: "ready" }));
    const cookie = await login(s);
    const r = await req(s.base, "POST", NEWS + "/p1/publish", { cookie, origin: s.base, body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.payload.publishStatus, "published");
    assert.equal(s.repo.getById("p1").publishStatus, "published");
  } finally {
    await s.close();
  }
});

test("7b. publish: ไม่ผ่าน gate (missing sourcePublishedAt) → 409", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "p2", duplicateHash: "p2", sourceUrl: "https://k.com/p2", publishStatus: "ready", sourcePublishedAt: null }));
    const cookie = await login(s);
    const r = await req(s.base, "POST", NEWS + "/p2/publish", { cookie, origin: s.base, body: {} });
    assert.equal(r.status, 409);
    assert.equal(r.payload.error, "publish_guard_rejected");
    assert.notEqual(s.repo.getById("p2").publishStatus, "published");
  } finally {
    await s.close();
  }
});

/* ---------- 8. review: schema invalid → 400 ---------- */
test("8. review: missing thaiContent → 400 reviewed_news_schema_invalid", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "rev1", duplicateHash: "rev1", sourceUrl: "https://k.com/rev1" }));
    const cookie = await login(s);
    const r = await req(s.base, "POST", NEWS + "/rev1/review", {
      cookie,
      origin: s.base,
      body: { sourceChecked: true, reviewer: "tester", news: { thaiTitle: "x", thaiContent: [] } },
    });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "reviewed_news_schema_invalid");
  } finally {
    await s.close();
  }
});

/* ---------- 9. review: sourceChecked != true → 400 ---------- */
test("9. review: sourceChecked false → 400 source_check_and_reviewer_required", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "rev2", duplicateHash: "rev2", sourceUrl: "https://k.com/rev2" }));
    const cookie = await login(s);
    const r = await req(s.base, "POST", NEWS + "/rev2/review", {
      cookie,
      origin: s.base,
      body: { sourceChecked: false, reviewer: "tester", news: { thaiTitle: "x", thaiContent: ["a"] } },
    });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "source_check_and_reviewer_required");
  } finally {
    await s.close();
  }
});

/* ---------- 10. review: unexpected number → 409 ---------- */
test("10. review: unexpected number → 409 deterministic_quality_gate", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "rev3", duplicateHash: "rev3", sourceUrl: "https://k.com/rev3" }));
    const cookie = await login(s);
    // เพิ่มตัวเลข 9999 ที่ไม่มีในต้นฉบับ → unexpected number → canAutoValidate false
    const r = await req(s.base, "POST", NEWS + "/rev3/review", {
      cookie,
      origin: s.base,
      body: {
        sourceChecked: true,
        reviewer: "tester",
        news: {
          thaiTitle: "ทองคำขึ้น 9999 ดอลลาร์",
          thaiSummary: "สรุป",
          thaiContent: ["ราคาทอง 9999 ดอลลาร์"],
          keyFacts: [],
        },
      },
    });
    assert.equal(r.status, 409);
    assert.equal(r.payload.error, "deterministic_quality_gate");
    assert.ok(r.payload.localCheck, "ต้องส่ง localCheck กลับมา");
    assert.equal(r.payload.localCheck.canAutoValidate, false);
    assert.equal(r.payload.localCheck.hasUnexpectedNumbers, true);
  } finally {
    await s.close();
  }
});

/* ---------- 11. review: ผ่าน → validated/ready ---------- */
test("11. review: clean rewrite → 200 validated/ready", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "rev4", duplicateHash: "rev4", sourceUrl: "https://k.com/rev4", validationStatus: "needs_review" }));
    const cookie = await login(s);
    const r = await req(s.base, "POST", NEWS + "/rev4/review", {
      cookie,
      origin: s.base,
      body: {
        sourceChecked: true,
        reviewer: "tester",
        notes: "ตรวจแล้ว",
        news: {
          thaiTitle: "ทองคำปรับตัวขึ้น หลังมุมมองดอกเบี้ยเฟดเปลี่ยน",
          thaiSummary: "ราคาทองคำขยับขึ้น",
          thaiContent: ["ราคาทองคำปรับตัวสูงขึ้น"],
          keyFacts: ["ราคาทองคำปรับขึ้น"],
        },
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.payload.validationStatus, "validated");
    assert.equal(r.payload.publishStatus, "ready");
    const after = s.repo.getById("rev4");
    assert.equal(after.validationStatus, "validated");
    assert.equal(after.publishStatus, "ready");
  } finally {
    await s.close();
  }
});

/* ---------- 12. rollback: ไม่มี published → 409 ---------- */
test("12. rollback: ไม่มี published → 409 no_published_news", async () => {
  const s = await makeServer();
  try {
    const cookie = await login(s);
    const r = await req(s.base, "POST", AP + "/rollback", { cookie, origin: s.base, body: { reviewer: "tester" } });
    assert.equal(r.status, 409);
    assert.equal(r.payload.error, "no_published_news");
  } finally {
    await s.close();
  }
});

/* ---------- 13. rollback: published → ready + audit ---------- */
test("13. rollback: published → ready + audit news_rollback", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "rb1", duplicateHash: "rb1", sourceUrl: "https://k.com/rb1", publishStatus: "ready" }));
    // publish ก่อนผ่าน gate
    assert.equal(s.repo.updatePublishStatus("rb1", "published"), true);
    const cookie = await login(s);
    const r = await req(s.base, "POST", AP + "/rollback", { cookie, origin: s.base, body: { reviewer: "tester" } });
    assert.equal(r.status, 200);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.id, "rb1");
    assert.equal(r.payload.previousStatus, "published");
    assert.equal(r.payload.newStatus, "ready");
    assert.equal(s.repo.getById("rb1").publishStatus, "ready");
    assert.equal(s.repo.getById("rb1").publishedAt, null, "published_at must be null after rollback");
    // audit entry ต้องมี stage news_rollback
    const recent = s.auditRepo.recent(10);
    const rbAudit = recent.find((a) => a.stage === "news_rollback" && a.newsId === "rb1");
    assert.ok(rbAudit, "ต้องมี audit entry news_rollback");
    assert.equal(rbAudit.status, "ok");
    assert.equal(rbAudit.reason, "manual_rollback");
  } finally {
    await s.close();
  }
});

/* ---------- 14. rollback ซ้อน → 409 ---------- */
test("14. rollback ซ้อน (หลัง rollback แรก) → 409", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "rb2", duplicateHash: "rb2", sourceUrl: "https://k.com/rb2", publishStatus: "ready" }));
    assert.equal(s.repo.updatePublishStatus("rb2", "published"), true);
    const cookie = await login(s);
    const r1 = await req(s.base, "POST", AP + "/rollback", { cookie, origin: s.base, body: {} });
    assert.equal(r1.status, 200);
    // rollback ซ้อน → ไม่มี published แล้ว
    const r2 = await req(s.base, "POST", AP + "/rollback", { cookie, origin: s.base, body: {} });
    assert.equal(r2.status, 409);
    assert.equal(r2.payload.error, "no_published_news");
  } finally {
    await s.close();
  }
});

/* ---------- 15. auth unified: cookie → /api/admin/news ผ่าน ---------- */
test("15. auth unified: cookie login ใช้กับ /api/admin/news ได้", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable());
    const cookie = await login(s);
    // GET ด้วย cookie → 200
    const r = await req(s.base, "GET", NEWS, { cookie });
    assert.equal(r.status, 200);
    // counts ด้วย cookie → 200
    const rc = await req(s.base, "GET", NEWS + "/counts", { cookie });
    assert.equal(rc.status, 200);
  } finally {
    await s.close();
  }
});

/* ---------- 16. auth: ไม่มี cookie/Bearer → 401 ---------- */
test("16. auth: ไม่มี cookie/Bearer → 401", async () => {
  const s = await makeServer();
  try {
    const r = await req(s.base, "GET", NEWS, {});
    assert.equal(r.status, 401);
    assert.equal(r.payload.error, "unauthorized");
    const rc = await req(s.base, "GET", NEWS + "/counts", {});
    assert.equal(rc.status, 401);
  } finally {
    await s.close();
  }
});

/* ---------- 17. CSRF: POST ด้วย cookie + origin ผิด → 403; GET ไม่ต้อง origin ---------- */
test("17. CSRF: POST + cookie + origin ผิด → 403; GET + cookie ไม่ต้อง origin → 200", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "csrf", duplicateHash: "csrf", sourceUrl: "https://k.com/csrf", validationStatus: "validated", publishStatus: "processing" }));
    const cookie = await login(s);
    // GET ด้วย cookie ไม่ต้อง origin → 200
    const rg = await req(s.base, "GET", NEWS, { cookie });
    assert.equal(rg.status, 200);
    // POST approve ด้วย cookie + origin ผิด → 403
    const rp = await req(s.base, "POST", NEWS + "/csrf/approve", { cookie, origin: "http://evil.example.com", body: {} });
    assert.equal(rp.status, 403);
    assert.equal(rp.payload.error, "origin_not_allowed");
    // POST approve ด้วย cookie + origin ถูก → 200
    const rp2 = await req(s.base, "POST", NEWS + "/csrf/approve", { cookie, origin: s.base, body: {} });
    assert.equal(rp2.status, 200);
  } finally {
    await s.close();
  }
});

/* ---------- 18. response ไม่คืน adminToken / internal fields ---------- */
test("18. news response ไม่คืน adminToken หรือ internal fields", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable());
    const cookie = await login(s);
    const r = await req(s.base, "GET", NEWS, { cookie });
    const dump = JSON.stringify(r.payload);
    assert.equal(dump.includes("adminToken"), false, "ห้ามคืน adminToken");
    assert.equal(dump.includes(s.token), false, "ห้ามคืน token ใน response");
    // list projection ต้องไม่มี internal fields (เช่น aiValidation, duplicateHash)
    assert.equal(r.payload[0].aiValidation, undefined);
    assert.equal(r.payload[0].duplicateHash, undefined);
    assert.equal(r.payload[0].sourcePolicy, undefined);
    // detail endpoint คืน full object แต่ต้องไม่มี adminToken เช่นกัน
    const rd = await req(s.base, "GET", NEWS + "/gold-test-001", { cookie });
    const ddump = JSON.stringify(rd.payload);
    assert.equal(ddump.includes("adminToken"), false);
  } finally {
    await s.close();
  }
});

/* ---------- 19. rollback endpoint auth: ต้อง cookie + origin ---------- */
test("19. rollback: ไม่มี auth → 401; origin ผิด → 403", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(samplePublishable({ id: "rba", duplicateHash: "rba", sourceUrl: "https://k.com/rba", publishStatus: "ready" }));
    assert.equal(s.repo.updatePublishStatus("rba", "published"), true);
    // ไม่มี auth → 401
    const r1 = await req(s.base, "POST", AP + "/rollback", { origin: s.base, body: {} });
    assert.equal(r1.status, 401);
    const cookie = await login(s);
    // origin ผิด → 403
    const r2 = await req(s.base, "POST", AP + "/rollback", { cookie, origin: "http://evil.example.com", body: {} });
    assert.equal(r2.status, 403);
    assert.equal(r2.payload.error, "origin_not_allowed");
  } finally {
    await s.close();
  }
});
