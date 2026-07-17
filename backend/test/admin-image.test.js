/* ============================================================
   Admin Image Refresh tests (POST /api/admin/news/:id/refresh-image)
   ------------------------------------------------------------
   ครอบคลุม (ตามข้อกำหนด Codex):
     A. List projection มี imageUrl + imageSource
     B. GET /api/admin/news/:id คืน image metadata ครบ
     C. POST refresh-image:
        1. สำเร็จ → updateImage + คืน image metadata + audit log
        2. Pexels ล้มเหลวทั้งหมด → ห้ามลบรูปเดิม (keptPreviousImage=true)
        3. ไม่มี reviewer → 400
        4. news not found → 404
        5. ไม่แก้ validation_status / publish_status / หัวข้อ / เนื้อหา
        6. กดซ้อน → 409 image_refresh_in_progress
        7. auth: ไม่มี auth → 401
        8. CSRF: origin ผิด → 403
        9. pipeline fail → audit failed + ไม่ลบรูปเดิม
     D. ไม่ leak PEXELS_API_KEY / adminToken / internal fields

   กฎ QC: ใช้ TEST TOKEN (random) + injectable _imageSearchFn (ไม่ยิง Pexels จริง)
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTestDb } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { createAuditRepository } from "../src/store/auditRepository.js";
import { createHttpServer, listen } from "../src/api/server.js";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd(), "..");

function makeTestToken() {
  return "test-" + randomBytes(16).toString("hex");
}

function sampleNews(overrides = {}) {
  const now = "2026-07-16T08:00:00.000Z";
  return {
    id: "img-news-001",
    source: "Kitco News",
    sourceUrl: "https://www.kitco.com/news/article/img-news-001",
    originalTitle: "Gold rises",
    originalAuthor: "Kitco News",
    originalPublishedAt: now,
    sourcePublishedAt: now,
    category: "Market News",
    originalContent: "Gold prices moved higher. ".repeat(5),
    thaiTitle: "ทองคำขึ้น",
    thaiSummary: "สรุป",
    thaiContent: ["ราคาทองคำปรับขึ้น"],
    marketFactors: "ดอกเบี้ย",
    keyFacts: ["ทองคำขึ้น"],
    mentionedNumbers: [],
    credit: "เรียบเรียงจาก Kitco",
    imageUrl: "https://images.pexels.com/photos/old/pexels-photo-old.jpeg",
    imageSource: "Pexels",
    imageAuthor: "Old Photographer",
    imageAuthorUrl: "https://www.pexels.com/@old",
    imageLicense: "Pexels License",
    imageSourceUrl: "https://www.pexels.com/photo/old/",
    imageSearchKeywords: ["gold market"],
    imageStatus: "selected",
    imageReviewRequired: false,
    validationStatus: "validated",
    publishStatus: "ready",
    aiConfidence: 90,
    aiValidation: { isValid: true },
    duplicateHash: "hash-img-001",
    sourcePolicy: "trusted",
    sourcePolicyReason: "kitco",
    topics: ["gold"],
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
  const auditRepo = createAuditRepository(db);
  const token = opts.token || makeTestToken();
  const server = createHttpServer({
    repo,
    auditRepo,
    projectRoot,
    adminToken: token,
    adminAllowedOrigins: opts.adminAllowedOrigins || [],
    _imageSearchFn: opts.imageSearchFn,
  });
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    token,
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
  if (opts.auth) init.headers["authorization"] = "Bearer " + opts.auth;
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

// auth helper — คืน Bearer token string
async function login(s) {
  return s.token;
}

const NEWS = "/api/admin/news";

// ===================== A. List projection =====================

test("A1. GET /api/admin/news list มี imageUrl + imageSource", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(sampleNews());
    const r = await req(s.base, "GET", NEWS, { auth: await login(s) });
    assert.equal(r.status, 200);
    assert.equal(r.payload[0].imageUrl, "https://images.pexels.com/photos/old/pexels-photo-old.jpeg");
    assert.equal(r.payload[0].imageSource, "Pexels");
  } finally {
    await s.close();
  }
});

// ===================== B. News detail returns image metadata =====================

test("B1. GET /api/admin/news/:id คืน image metadata ครบ", async () => {
  const s = await makeServer();
  try {
    s.repo.insertNews(sampleNews());
    const r = await req(s.base, "GET", NEWS + "/img-news-001", { auth: await login(s) });
    assert.equal(r.status, 200);
    assert.equal(r.payload.imageUrl, "https://images.pexels.com/photos/old/pexels-photo-old.jpeg");
    assert.equal(r.payload.imageAuthor, "Old Photographer");
    assert.equal(r.payload.imageAuthorUrl, "https://www.pexels.com/@old");
    assert.equal(r.payload.imageStatus, "selected");
    assert.deepEqual(r.payload.imageSearchKeywords, ["gold market"]);
  } finally {
    await s.close();
  }
});

// ===================== C. refresh-image =====================

test("C1. POST refresh-image สำเร็จ → updateImage + คืน image metadata + audit log", async () => {
  const fakePhoto = {
    id: 999,
    src: { large: "https://images.pexels.com/photos/999/pexels-photo-999.jpeg" },
    photographer: "New Photographer",
    photographer_url: "https://www.pexels.com/@new",
    url: "https://www.pexels.com/photo/999/",
    alt: "gold bars",
    width: 1920,
    height: 1080,
  };
  const s = await makeServer({ imageSearchFn: async () => [fakePhoto] });
  try {
    s.repo.insertNews(sampleNews({ imageUrl: null, imageStatus: null }));
    const r = await req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
      auth: await login(s),
      origin: s.base,
      body: { reviewer: "tester" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.id, "img-news-001");
    assert.ok(r.payload.image.imageUrl.includes("999"), "ต้องได้รูปใหม่");
    assert.equal(r.payload.image.imageStatus, "selected");
    assert.equal(s.repo.getById("img-news-001").imageStatus, "selected");
    const recent = s.auditRepo.recent(10);
    const audit = recent.find((a) => a.newsId === "img-news-001" && a.stage === "image_refresh_completed");
    assert.ok(audit, "ต้องมี audit image_refresh_completed");
    assert.equal(audit.status, "ok");
  } finally {
    await s.close();
  }
});

test("C2. POST refresh-image — Pexels fail → ห้ามลบรูปเดิม (keptPreviousImage=true) + audit", async () => {
  const s = await makeServer({ imageSearchFn: async () => { throw new Error("pexels down"); } });
  try {
    s.repo.insertNews(sampleNews({ imageUrl: "https://keep/old.jpeg", imageStatus: "selected" }));
    const r = await req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
      auth: await login(s),
      origin: s.base,
      body: { reviewer: "tester" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.payload.keptPreviousImage, true, "ต้องบอกว่าเก็บรูปเดิม");
    assert.equal(s.repo.getById("img-news-001").imageUrl, "https://keep/old.jpeg");
    assert.equal(s.repo.getById("img-news-001").imageStatus, "selected");
    const recent = s.auditRepo.recent(10);
    const audit = recent.find((a) => a.newsId === "img-news-001" && a.stage === "image_refresh_failed");
    assert.ok(audit, "ต้องมี audit image_refresh_failed");
    assert.equal(audit.status, "error");
  } finally {
    await s.close();
  }
});

test("C2b. POST refresh-image — fallback ต้องไม่เขียนทับรูปเดิม", async () => {
  const s = await makeServer({
    imageSearchFn: async () => [],
  });
  try {
    s.repo.insertNews(sampleNews({ imageUrl: "https://keep/old.jpeg", imageStatus: "selected" }));
    const r = await req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
      auth: await login(s),
      origin: s.base,
      body: { reviewer: "qc" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.payload.keptPreviousImage, true);
    assert.equal(s.repo.getById("img-news-001").imageUrl, "https://keep/old.jpeg");
  } finally {
    await s.close();
  }
});

test("C3. POST refresh-image ไม่มี reviewer → 400", async () => {
  const s = await makeServer({ imageSearchFn: async () => [] });
  try {
    s.repo.insertNews(sampleNews());
    const r = await req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
      auth: await login(s),
      origin: s.base,
      body: {},
    });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error, "reviewer_required");
    assert.equal(s.repo.getById("img-news-001").imageUrl, "https://images.pexels.com/photos/old/pexels-photo-old.jpeg");
  } finally {
    await s.close();
  }
});

test("C4. POST refresh-image — news not found → 404", async () => {
  const s = await makeServer({ imageSearchFn: async () => [] });
  try {
    const r = await req(s.base, "POST", NEWS + "/no-such-id/refresh-image", {
      auth: await login(s),
      origin: s.base,
      body: { reviewer: "tester" },
    });
    assert.equal(r.status, 404);
    assert.equal(r.payload.error, "news_not_found");
  } finally {
    await s.close();
  }
});

test("C5. refresh-image ไม่แก้ validation_status / publish_status / หัวข้อ / เนื้อหา", async () => {
  const fakePhoto = {
    id: 1,
    src: { large: "https://images.pexels.com/photos/new/pexels-photo-new.jpeg" },
    photographer: "New",
    photographer_url: "https://www.pexels.com/@new",
    url: "https://www.pexels.com/photo/new/",
    alt: "x",
    width: 1920, height: 1080,
  };
  const s = await makeServer({ imageSearchFn: async () => [fakePhoto] });
  try {
    s.repo.insertNews(sampleNews({
      validationStatus: "validated",
      publishStatus: "published",
      thaiTitle: "หัวข้อเดิม",
      thaiContent: ["เนื้อหาเดิม"],
      publishedAt: "2026-07-15T00:00:00.000Z",
    }));
    const r = await req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
      auth: await login(s),
      origin: s.base,
      body: { reviewer: "tester" },
    });
    assert.equal(r.status, 200);
    const after = s.repo.getById("img-news-001");
    assert.notEqual(after.imageUrl, "https://images.pexels.com/photos/old/pexels-photo-old.jpeg");
    assert.ok(after.imageUrl.includes("/new/"));
    assert.equal(after.validationStatus, "validated");
    assert.equal(after.publishStatus, "published");
    assert.equal(after.thaiTitle, "หัวข้อเดิม");
    assert.deepEqual(after.thaiContent, ["เนื้อหาเดิม"]);
    assert.equal(after.publishedAt, "2026-07-15T00:00:00.000Z");
  } finally {
    await s.close();
  }
});

test("C6. refresh-image ป้องกันกดซ้อน → 409 image_refresh_in_progress", async () => {
  const slowFn = async () => {
    await new Promise((r) => setTimeout(r, 200));
    return [{
      id: 1, src: { large: "https://x/new.jpeg" }, photographer: "p",
      photographer_url: "https://www.pexels.com/@p", url: "https://www.pexels.com/photo/1/",
      alt: "x", width: 1920, height: 1080,
    }];
  };
  const s = await makeServer({ imageSearchFn: slowFn });
  try {
    s.repo.insertNews(sampleNews());
    const [r1, r2] = await Promise.all([
      req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
        auth: await login(s), origin: s.base, body: { reviewer: "tester" },
      }),
      req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
        auth: await login(s), origin: s.base, body: { reviewer: "tester" },
      }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.equal(statuses[0], 200, "ต้องมีอย่างน้อย 1 สำเร็จ");
    assert.equal(statuses[1], 409, "ต้องมี 1 ตัวเป็น 409 in-progress");
    const conflict = r1.status === 409 ? r1 : r2;
    assert.equal(conflict.payload.error, "image_refresh_in_progress");
  } finally {
    await s.close();
  }
});

test("C7. refresh-image ไม่มี auth → 401", async () => {
  const s = await makeServer({ imageSearchFn: async () => [] });
  try {
    s.repo.insertNews(sampleNews());
    const r = await req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
      origin: s.base,
      body: { reviewer: "tester" },
    });
    assert.equal(r.status, 401);
    assert.equal(r.payload.error, "unauthorized");
  } finally {
    await s.close();
  }
});

test("C8. refresh-image origin ผิด → 403 (CSRF)", async () => {
  const s = await makeServer({ imageSearchFn: async () => [] });
  try {
    s.repo.insertNews(sampleNews());
    const r = await req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
      auth: await login(s),
      origin: "http://evil.example.com",
      body: { reviewer: "tester" },
    });
    assert.equal(r.status, 403);
    assert.equal(r.payload.error, "origin_not_allowed");
    assert.equal(s.repo.getById("img-news-001").imageUrl, "https://images.pexels.com/photos/old/pexels-photo-old.jpeg");
  } finally {
    await s.close();
  }
});

// ===================== D. No secret leak =====================

test("D1. refresh-image response ไม่ leak PEXELS_API_KEY / adminToken", async () => {
  const fakePhoto = {
    id: 1,
    src: { large: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg" },
    photographer: "P",
    photographer_url: "https://www.pexels.com/@p",
    url: "https://www.pexels.com/photo/1/",
    alt: "x", width: 1920, height: 1080,
  };
  const s = await makeServer({ imageSearchFn: async () => [fakePhoto] });
  try {
    s.repo.insertNews(sampleNews());
    const r = await req(s.base, "POST", NEWS + "/img-news-001/refresh-image", {
      auth: await login(s),
      origin: s.base,
      body: { reviewer: "tester" },
    });
    const dump = JSON.stringify(r.payload);
    assert.equal(dump.includes("adminToken"), false);
    assert.equal(dump.includes(s.token), false);
    assert.equal(dump.includes("PEXELS_API_KEY"), false, "ห้ามส่ง PEXELS_API_KEY");
    assert.equal(dump.includes("apiKey"), false);
  } finally {
    await s.close();
  }
});
