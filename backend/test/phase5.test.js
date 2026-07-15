/* ============================================================
   Phase 5 — Storage + Integration regression tests (node:test)
   ------------------------------------------------------------
   ครอบคลุม:
   1. db: open + idempotent migration
   2. newsRepository: insert / getById / getBySourceUrl / getByDuplicateHash
   3. duplicate detection (source_url + duplicate_hash) ใน transaction
   4. status แยก: validationStatus ≠ publishStatus
   5. update status (validation/publish/image) แยกอิสระ
   6. query/filter/sort + countByStatus
   7. restart persistence (close + reopen)
   8. transaction rollback
   9. newsPipeline integration: REJECTED/FAILED ไม่เรียก image
   10. VALIDATED ≠ PUBLISHED
   ============================================================ */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestDb, __resolveDbPath } from "../src/store/db.js";
import { createNewsRepository } from "../src/store/newsRepository.js";
import { newsToRow, rowToNews } from "../src/store/newsMapper.js";
import { processAndSaveNews } from "../src/pipeline/newsPipeline.js";
import { NewsStatus } from "../src/utils/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- helpers ----------
function makeNews(over = {}) {
  const now = new Date().toISOString();
  return {
    id: "n1",
    source: "Kitco News",
    sourceUrl: "https://www.kitco.com/news/a1",
    originalTitle: "Gold rally on CPI",
    originalContent:
      "Gold prices jumped to 4,089.10 per ounce, up 2.22%. Silver 59.12, up 2.78%. " +
      "CPI 3.1% vs 3.3% expected. DXY 104.32.",
    originalPublishedAt: now,
    category: "Market News",
    validationStatus: "fetched",
    publishStatus: "fetched",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}
function perfectRewrite() {
  return {
    thaiTitle: "ทองคำขยับหลังข้อมูล CPI",
    thaiSummary: "ทองคำขยับขึ้น",
    thaiContent: [
      "ทองคำ 4,089.10 ดอลลาร์ต่อออนซ์ บวก 2.22%",
      "CPI 3.1% เทียบกับคาด 3.3% DXY 104.32",
    ],
    marketFactors: "ดอกเบี้ย ดอลลาร์ เงินเฟ้อ",
    keyFacts: ["CPI 3.1%"],
    mentionedNumbers: ["4089.10", "2.22%", "59.12", "2.78%", "3.1%", "3.3%", "104.32"],
    imageSearchKeywords: ["gold bars"],
  };
}
function validValidator(over = {}) {
  return {
    isValid: true,
    bannedWordsFound: [],
    investmentAdviceFound: false,
    numbersMatch: true,
    numberMismatches: [],
    addedInformationFound: false,
    confidence: 92,
    ...over,
  };
}
function goodMockImageSearch() {
  return async () => [
    {
      id: 100,
      width: 1920,
      height: 1080,
      photographer: "Jane",
      photographer_url: "https://www.pexels.com/@jane",
      url: "https://www.pexels.com/photo/100",
      src: { large2x: "https://images.pexels.com/100/large2x.jpg" },
    },
  ];
}

// ============================================================
// 1. DB + migration
// ============================================================
describe("1. db open + migration idempotent", () => {
  test("default DATABASE_URL resolves to backend/data/news.db", () => {
    const resolved = __resolveDbPath("file:./data/news.db").replace(/\\/g, "/");
    assert.match(resolved, /\/backend\/data\/news\.db$/i);
    assert.doesNotMatch(resolved, /\/data\/data\/news\.db$/i);
  });

  test("createTestDb สร้าง table ได้", () => {
    const db = createTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    assert.ok(tables.includes("news"));
    assert.ok(tables.includes("schema_migrations"));
    db.close();
  });

  test("migration รันซ้ำได้ไม่พัง (idempotent)", () => {
    const db = createTestDb();
    // รัน migration ซ้ำ → ไม่ throw
    const sql = readFileSync(
      join(__dirname, "..", "src", "store", "migration.sql"),
      "utf8"
    );
    assert.doesNotThrow(() => db.exec(sql));
    db.close();
  });

  test("indexes ถูกสร้าง", () => {
    const db = createTestDb();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all()
      .map((r) => r.name);
    for (const idx of [
      "idx_news_source_url",
      "idx_news_dup_hash",
      "idx_news_validation_status",
      "idx_news_publish_status",
      "idx_news_published_at",
    ]) {
      assert.ok(indexes.includes(idx), `missing index: ${idx}`);
    }
    db.close();
  });
});

// ============================================================
// 2. newsRepository: insert + query
// ============================================================
describe("2. newsRepository insert + query", () => {
  let db, repo;
  beforeEach(() => {
    db = createTestDb();
    repo = createNewsRepository(db);
  });
  afterEach(() => db.close());

  test("insertNews → getById", () => {
    const { inserted } = repo.insertNews(makeNews());
    assert.equal(inserted, true);
    const got = repo.getById("n1");
    assert.ok(got);
    assert.equal(got.sourceUrl, "https://www.kitco.com/news/a1");
  });

  test("insert id ซ้ำ → inserted=false (ON CONFLICT DO NOTHING)", () => {
    repo.insertNews(makeNews());
    const { inserted } = repo.insertNews(makeNews());
    assert.equal(inserted, false);
  });

  test("getBySourceUrl", () => {
    repo.insertNews(makeNews());
    const got = repo.getBySourceUrl("https://www.kitco.com/news/a1");
    assert.ok(got);
    assert.equal(got.id, "n1");
  });

  test("getByDuplicateHash", () => {
    const news = makeNews({ duplicateHash: "abc123" });
    repo.insertNews(news);
    const got = repo.getByDuplicateHash("abc123");
    assert.ok(got);
    assert.equal(got.id, "n1");
  });

  test("JSON array fields round-trip", () => {
    repo.insertNews(
      makeNews({
        thaiContent: ["p1", "p2"],
        keyFacts: ["f1"],
        mentionedNumbers: ["1.5%", "2.22%"],
        topics: ["gold", "fed"],
      })
    );
    const got = repo.getById("n1");
    assert.deepEqual(got.thaiContent, ["p1", "p2"]);
    assert.deepEqual(got.keyFacts, ["f1"]);
    assert.deepEqual(got.mentionedNumbers, ["1.5%", "2.22%"]);
    assert.deepEqual(got.topics, ["gold", "fed"]);
  });

  test("boolean field round-trip (isExternal)", () => {
    repo.insertNews(makeNews({ isExternal: true }));
    assert.equal(repo.getById("n1").isExternal, true);
    repo.clearAll();
    repo.insertNews(makeNews({ isExternal: false }));
    assert.equal(repo.getById("n1").isExternal, false);
  });
});

// ============================================================
// 3. duplicate detection (transaction)
// ============================================================
describe("3. duplicate detection (transaction)", () => {
  let db, repo;
  beforeEach(() => {
    db = createTestDb();
    repo = createNewsRepository(db);
  });
  afterEach(() => db.close());

  test("saveWithDedup insert ครั้งแรก → saved=true", () => {
    const r = repo.saveWithDedup(makeNews());
    assert.equal(r.saved, true);
    assert.equal(r.duplicate, false);
  });

  test("saveWithDedup ซ้ำ source_url → duplicate=true", () => {
    repo.saveWithDedup(makeNews());
    const r = repo.saveWithDedup(
      makeNews({ id: "n2" }) // id ต่าง แต่ sourceUrl เดิม
    );
    assert.equal(r.duplicate, true);
    assert.equal(r.saved, false);
    assert.match(r.reason, /source_url/);
  });

  test("saveWithDedup ซ้ำ duplicate_hash → duplicate=true", () => {
    repo.saveWithDedup(makeNews({ duplicateHash: "h1" }));
    const r = repo.saveWithDedup(
      makeNews({ id: "n2", sourceUrl: "https://other/x", duplicateHash: "h1" })
    );
    assert.equal(r.duplicate, true);
    assert.match(r.reason, /duplicate_hash/);
  });

  test("saveWithDedup source_url normalize (trailing slash)", () => {
    repo.saveWithDedup(makeNews({ sourceUrl: "https://x/a/" }));
    const r = repo.saveWithDedup(
      makeNews({ id: "n2", sourceUrl: "https://x/a" })
    );
    assert.equal(r.duplicate, true);
  });

  test("transaction: dedup + insert atomic (race-safe)", () => {
    // ถ้าไม่ใช่ transaction อาจมีช่องว่างระหว่าง check→insert
    // ทดสอบโดยเรียกพร้อมกันไม่ได้ใน sync API — แต่ verify saveWithDedup
    // ใช้ db.transaction() ภายใน (ดู newsRepository.js)
    const r1 = repo.saveWithDedup(makeNews());
    const r2 = repo.saveWithDedup(makeNews());
    assert.equal(r1.saved, true);
    assert.equal(r2.duplicate, true);
    assert.equal(repo.countAll(), 1, "ต้องมี 1 row เท่านั้น (ไม่ insert ซ้ำ)");
  });
});

// ============================================================
// 4. status แยก validationStatus ≠ publishStatus
// ============================================================
describe("4. status separation", () => {
  let db, repo;
  beforeEach(() => {
    db = createTestDb();
    repo = createNewsRepository(db);
  });
  afterEach(() => db.close());

  test("updateValidationStatus ไม่แตะ publishStatus", () => {
    repo.insertNews(
      makeNews({ validationStatus: "fetched", publishStatus: "fetched" })
    );
    repo.updateValidationStatus("n1", "validated");
    const got = repo.getById("n1");
    assert.equal(got.validationStatus, "validated");
    assert.equal(got.publishStatus, "fetched", "publishStatus ต้องไม่เปลี่ยน");
    assert.ok(got.validatedAt, "validatedAt ต้องถูกตั้ง");
  });

  test("updatePublishStatus ไม่แตะ validationStatus", () => {
    repo.insertNews(
      makeNews({ validationStatus: "validated", publishStatus: "processing" })
    );
    repo.updatePublishStatus("n1", "published");
    const got = repo.getById("n1");
    assert.equal(got.publishStatus, "published");
    assert.equal(got.validationStatus, "validated", "validationStatus ต้องไม่เปลี่ยน");
    assert.ok(got.publishedAt);
  });

  test("ข่าวที่ไม่ validated ห้ามเปลี่ยนเป็น published", () => {
    repo.insertNews(
      makeNews({ validationStatus: "rejected", publishStatus: "processing" })
    );
    assert.equal(repo.updatePublishStatus("n1", "published"), false);
    const got = repo.getById("n1");
    assert.equal(got.publishStatus, "processing");
    assert.equal(got.publishedAt, null);
  });

  test("updateImage ไม่แตะ status", () => {
    repo.insertNews(
      makeNews({ validationStatus: "validated", publishStatus: "processing" })
    );
    repo.updateImage("n1", {
      imageUrl: "https://x/img.jpg",
      imageSource: "Pexels",
      imageStatus: "selected",
      imageReviewRequired: false,
    });
    const got = repo.getById("n1");
    assert.equal(got.imageUrl, "https://x/img.jpg");
    assert.equal(got.imageStatus, "selected");
    assert.equal(got.validationStatus, "validated");
    assert.equal(got.publishStatus, "processing");
  });

  test("hasUsableImage", () => {
    repo.insertNews(makeNews());
    assert.equal(repo.hasUsableImage("n1"), false);
    repo.updateImage("n1", {
      imageUrl: "https://x/img.jpg",
      imageSource: "Pexels",
      imageStatus: "selected",
      imageReviewRequired: false,
    });
    assert.equal(repo.hasUsableImage("n1"), true);
  });
});

// ============================================================
// 5. query/filter/sort + count
// ============================================================
describe("5. query/filter/sort + count", () => {
  let db, repo;
  beforeEach(() => {
    db = createTestDb();
    repo = createNewsRepository(db);
  });
  afterEach(() => db.close());

  test("listByStatus", () => {
    repo.insertNews(makeNews({ id: "a", validationStatus: "validated" }));
    repo.insertNews(makeNews({ id: "b", validationStatus: "rejected" }));
    repo.insertNews(makeNews({ id: "c", validationStatus: "validated" }));
    const validated = repo.listByStatus("validated");
    assert.equal(validated.length, 2);
  });

  test("listByPublishStatus", () => {
    repo.insertNews(makeNews({ id: "a", publishStatus: "processing" }));
    repo.insertNews(makeNews({ id: "b", publishStatus: "published" }));
    assert.equal(repo.listByPublishStatus("processing").length, 1);
    assert.equal(repo.listByPublishStatus("published").length, 1);
  });

  test("countByStatus รวมทุก status", () => {
    repo.insertNews(makeNews({ id: "a", validationStatus: "validated" }));
    repo.insertNews(makeNews({ id: "b", validationStatus: "rejected" }));
    repo.insertNews(makeNews({ id: "c", validationStatus: "validated" }));
    const c = repo.countByStatus();
    assert.equal(c.validated, 2);
    assert.equal(c.rejected, 1);
  });

  test("countAll", () => {
    repo.insertNews(makeNews({ id: "a" }));
    repo.insertNews(makeNews({ id: "b" }));
    assert.equal(repo.countAll(), 2);
  });
});

// ============================================================
// 6. restart persistence
// ============================================================
describe("6. restart persistence", () => {
  test("close + reopen ไฟล์เดิม → ข้อมูลยังอยู่", () => {
    const tmpFile = join(
      tmpdir(),
      `p5-${Date.now()}.db`
    );
    const migrationSql = readFileSync(
      join(__dirname, "..", "src", "store", "migration.sql"),
      "utf8"
    );
    // session 1
    const dbA = new Database(tmpFile);
    dbA.exec(migrationSql);
    const repoA = createNewsRepository(dbA);
    repoA.insertNews(makeNews({ id: "persist-1", validationStatus: "validated", publishStatus: "processing" }));
    dbA.close();
    // session 2
    const dbB = new Database(tmpFile);
    dbB.exec(migrationSql);
    const repoB = createNewsRepository(dbB);
    const got = repoB.getById("persist-1");
    assert.ok(got);
    assert.equal(got.validationStatus, "validated");
    assert.equal(got.publishStatus, "processing");
    dbB.close();
    try { unlinkSync(tmpFile); } catch {}
  });
});

// ============================================================
// 7. transaction rollback
// ============================================================
describe("7. transaction rollback", () => {
  test("constraint violation → rollback", () => {
    const db = createTestDb();
    assert.throws(() => {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO news (id, source, validation_status, publish_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("bad", "Test", null, "p", new Date().toISOString(), new Date().toISOString());
      })();
    });
    const row = db.prepare("SELECT * FROM news WHERE id = ?").get("bad");
    assert.equal(row, undefined, "rollback: row ต้องไม่ถูกบันทึก");
    db.close();
  });
});

// ============================================================
// 8. mapper round-trip
// ============================================================
describe("8. mapper round-trip", () => {
  test("newsToRow → rowToNews preserves fields", () => {
    const news = makeNews({
      thaiContent: ["p1"],
      keyFacts: ["f1"],
      aiValidation: { isValid: true, confidence: 90 },
      isExternal: true,
      imageReviewRequired: true,
    });
    const row = newsToRow(news);
    const back = rowToNews(row);
    assert.deepEqual(back.thaiContent, ["p1"]);
    assert.deepEqual(back.keyFacts, ["f1"]);
    assert.deepEqual(back.aiValidation, { isValid: true, confidence: 90 });
    assert.equal(back.isExternal, true);
    assert.equal(back.imageReviewRequired, true);
  });

  test("null/missing handled gracefully", () => {
    const row = newsToRow(makeNews({ thaiContent: null, keyFacts: undefined }));
    const back = rowToNews(row);
    assert.deepEqual(back.thaiContent, []);
    assert.deepEqual(back.keyFacts, []);
  });
});

// ============================================================
// 9. newsPipeline integration — REJECTED/FAILED ไม่เรียก image
// ============================================================
describe("9. newsPipeline image gate", () => {
  test("VALIDATED → เรียก image + saved + publishStatus=ready", async () => {
    const db = createTestDb();
    const repo = createNewsRepository(db);
    const r = await processAndSaveNews(
      makeNews({ id: "v1" }),
      { repo },
      {
        aiOpts: {
          forceMock: true,
          _testRewriteResponse: perfectRewrite(),
          _testValidatorResponse: validValidator(),
        },
        imageOpts: { _mockSearchFn: goodMockImageSearch(), delayMs: 0 },
      }
    );
    assert.equal(r.news.validationStatus, "validated");
    assert.equal(r.news.publishStatus, "ready");
    assert.equal(r.news.publishStatus !== "published", true);
    assert.equal(r.imageSkipped, false);
    assert.ok(r.news.imageUrl);
    assert.equal(r.saved, true);
    db.close();
  });

  test("REJECTED → ไม่เรียก image (imageSkipped=true)", async () => {
    const db = createTestDb();
    const repo = createNewsRepository(db);
    let imageCalled = false;
    const r = await processAndSaveNews(
      makeNews({ id: "r1" }),
      { repo },
      {
        aiOpts: {
          forceMock: true,
          _testRewriteResponse: { ...perfectRewrite(), thaiTitle: "ทองขึ้นแน่" },
          _testValidatorResponse: validValidator(),
        },
        imageOpts: {
          _mockSearchFn: async () => {
            imageCalled = true;
            return [];
          },
          delayMs: 0,
        },
      }
    );
    assert.equal(r.news.validationStatus, "rejected");
    assert.equal(r.imageSkipped, true);
    assert.equal(imageCalled, false, "Pexels ต้องไม่ถูกเรียก");
    assert.equal(r.news.imageUrl, null);
    db.close();
  });

  test("FAILED → ไม่เรียก image", async () => {
    const db = createTestDb();
    const repo = createNewsRepository(db);
    let imageCalled = false;
    const r = await processAndSaveNews(
      makeNews({ id: "f1" }),
      { repo },
      {
        aiOpts: { forceMock: true, _testRewriteResponse: null },
        imageOpts: {
          _mockSearchFn: async () => {
            imageCalled = true;
            return [];
          },
          delayMs: 0,
        },
      }
    );
    assert.equal(r.news.validationStatus, "failed");
    assert.equal(r.imageSkipped, true);
    assert.equal(imageCalled, false);
    db.close();
  });

  test("VALIDATED ไม่ทำให้ publishStatus=PUBLISHED", async () => {
    const db = createTestDb();
    const repo = createNewsRepository(db);
    const r = await processAndSaveNews(
      makeNews({ id: "v2" }),
      { repo },
      {
        aiOpts: {
          forceMock: true,
          _testRewriteResponse: perfectRewrite(),
          _testValidatorResponse: validValidator(),
        },
        imageOpts: { _mockSearchFn: goodMockImageSearch(), delayMs: 0 },
      }
    );
    assert.equal(r.news.validationStatus, "validated");
    assert.notEqual(r.news.publishStatus, "published");
    assert.notEqual(r.news.publishStatus, "validated");
    db.close();
  });

  test("duplicate ใน batch → saved=false duplicate=true", async () => {
    const db = createTestDb();
    const repo = createNewsRepository(db);
    const news = makeNews({ id: "d1" });
    const opts = {
      aiOpts: {
        forceMock: true,
        _testRewriteResponse: perfectRewrite(),
        _testValidatorResponse: validValidator(),
      },
      imageOpts: { _mockSearchFn: goodMockImageSearch(), delayMs: 0 },
    };
    const r1 = await processAndSaveNews(news, { repo }, opts);
    const r2 = await processAndSaveNews(news, { repo }, opts);
    assert.equal(r1.saved, true);
    assert.equal(r2.duplicate, true);
    assert.equal(r2.saved, false);
    db.close();
  });

  test("duplicate ถูกหยุดก่อน AI และ image", async () => {
    const db = createTestDb();
    const repo = createNewsRepository(db);
    repo.insertNews(makeNews({ id: "stored" }));
    let imageCalled = false;
    const r = await processAndSaveNews(
      makeNews({ id: "incoming" }),
      { repo },
      {
        aiOpts: { _testRewriteResponse: null },
        imageOpts: {
          _mockSearchFn: async () => {
            imageCalled = true;
            return [];
          },
        },
      }
    );
    assert.equal(r.duplicate, true);
    assert.equal(r.imageSkipped, true);
    assert.equal(imageCalled, false);
    assert.equal(r.reason, "duplicate");
    db.close();
  });

  test("external source needs_review แต่ไม่เรียก image", async () => {
    const db = createTestDb();
    const repo = createNewsRepository(db);
    let imageCalled = false;
    const r = await processAndSaveNews(
      makeNews({
        id: "external-1",
        source: "Reuters",
        sourceUrl: "https://example.com/reuters-1",
        isExternal: true,
      }),
      { repo },
      {
        imageOpts: {
          _mockSearchFn: async () => {
            imageCalled = true;
            return [];
          },
        },
      }
    );
    assert.equal(r.news.validationStatus, "needs_review");
    assert.equal(r.imageSkipped, true);
    assert.equal(imageCalled, false);
    assert.equal(r.news.imageUrl, null);
    db.close();
  });

  test("missing content needs_review แต่ไม่เรียก image", async () => {
    const db = createTestDb();
    const repo = createNewsRepository(db);
    let imageCalled = false;
    const r = await processAndSaveNews(
      makeNews({
        id: "short-1",
        sourceUrl: "https://www.kitco.com/news/short-1",
        originalContent: "too short",
      }),
      { repo },
      {
        imageOpts: {
          _mockSearchFn: async () => {
            imageCalled = true;
            return [];
          },
        },
      }
    );
    assert.equal(r.news.validationStatus, "needs_review");
    assert.equal(r.imageSkipped, true);
    assert.equal(imageCalled, false);
    db.close();
  });
});
