/* ============================================================
   CLI — ทดสอบ Phase 5 storage + integration (E2E with mock AI + mock image)
   ------------------------------------------------------------
   ทดสอบ:
   - insert ข่าวสำเร็จ
   - บันทึก validationStatus และ publishStatus แยกกัน (VALIDATED ≠ PUBLISHED)
   - บันทึก image metadata
   - duplicate detection (source_url + duplicate_hash)
   - query/filter ตาม status
   - restart persistence (close + reopen)
   - REJECTED/FAILED ไม่เรียก image pipeline
   - VALIDATED ไม่เปลี่ยน publishStatus เป็น PUBLISHED
   - transaction rollback เมื่อบันทึกผิดพลาด

   ข้อห้าม (ตามคำสั่ง):
   - ห้ามเรียก OpenAI API จริง (ใช้ forceMock)
   - ห้ามเรียก Pexels API จริง (ใช้ _mockSearchFn)
   - ห้ามเรียก Kitco scraper จริง (ใช้ mock news)
   - ห้ามแก้ Frontend / สร้าง Scheduler / เผยแพร่ข่าวจริง
   ============================================================ */

import { createTestDb, closeDb } from "../store/db.js";
import { createNewsRepository } from "../store/newsRepository.js";
import { processAndSaveNews } from "../pipeline/newsPipeline.js";
import { NewsStatus } from "../utils/schema.js";
import Database from "better-sqlite3";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function line(c = "─", n = 64) {
  console.log(c.repeat(n));
}

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
  }
}

// สร้าง mock news ที่ผ่าน source policy (Kitco News) + มี originalContent
function mockKitcoNews(over = {}) {
  return {
    id: "kitco-test-1",
    source: "Kitco News",
    isExternal: false,
    sourceUrl: "https://www.kitco.com/news/article/test-1",
    originalTitle: "Gold prices rally on CPI data",
    originalContent:
      "Gold prices jumped to $4,089.10 per ounce, up 2.22%. Silver reached $59.12, up 2.78%. " +
      "The Federal Reserve signaled patience on rates after CPI came in at 3.1% versus 3.3% expected. " +
      "DXY fell to 104.32. Analysts expect support at 4,000 and resistance at 4,100.",
    originalPublishedAt: new Date().toISOString(),
    category: "Market News",
    imageSearchKeywords: ["gold bars", "Federal Reserve"],
    topics: ["gold", "fed", "inflation"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

// mock rewrite ที่ "perfect" (ตัวเลขตรง + ไม่มี banned)
function perfectRewrite() {
  return {
    thaiTitle: "ทองคำขยับหลังข้อมูล CPI",
    thaiSummary: "ทองคำขยับขึ้นตามข้อมูล CPI",
    thaiContent: [
      "ทองคำขยับขึ้นราคา 4,089.10 ดอลลาร์ต่อออนซ์ บวก 2.22%",
      "CPI ออกมา 3.1% เทียบกับคาด 3.3% DXY 104.32 แนวรับ 4,000 แนวต้าน 4,100",
    ],
    marketFactors: "ดอกเบี้ย, ดอลลาร์, เงินเฟ้อ",
    keyFacts: ["CPI 3.1%", "DXY 104.32"],
    mentionedNumbers: ["4089.10", "2.22%", "59.12", "2.78%", "3.1%", "3.3%", "104.32", "4000", "4100"],
    imageSearchKeywords: ["gold bars", "Federal Reserve"],
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
// mock image ที่คืนรูปดี
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

async function runTests() {
  line("═");
  console.log("Phase 5 — Storage + Integration E2E (mock AI + mock image)");
  console.log("DB: temporary SQLite (:memory: + temp file)");
  line("═");

  // ---- Test 1: insert + status แยก ----
  line();
  console.log("Test 1: insert + validationStatus/publishStatus แยกกัน");
  const db1 = createTestDb();
  const repo1 = createNewsRepository(db1);
  const r1 = await processAndSaveNews(mockKitcoNews(), { repo: repo1 }, {
    aiOpts: {
      forceMock: true,
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: validValidator(),
    },
    imageOpts: { _mockSearchFn: goodMockImageSearch(), delayMs: 0 },
  });
  check("insert saved=true", r1.saved === true, `got saved=${r1.saved}`);
  check(
    "validationStatus=validated",
    r1.news.validationStatus === NewsStatus.VALIDATED,
    `got ${r1.news.validationStatus}`
  );
  check(
    "publishStatus=processing (ไม่ใช่ validated/published)",
    r1.news.publishStatus === NewsStatus.PROCESSING,
    `got ${r1.news.publishStatus}`
  );
  check(
    "VALIDATED ไม่ทำให้ publishStatus=PUBLISHED",
    r1.news.publishStatus !== NewsStatus.PUBLISHED
  );
  check("image ถูกเรียก (imageSkipped=false)", r1.imageSkipped === false);
  check("imageUrl มีค่า", !!r1.news.imageUrl);
  check("imageStatus=selected", r1.news.imageStatus === "selected");
  check(
    "validatedAt ถูกตั้ง (มีค่า)",
    !!repo1.getById("kitco-test-1").validatedAt
  );
  check(
    "publishedAt ยัง NULL (ไม่ publish อัตโนมัติ)",
    repo1.getById("kitco-test-1").publishedAt === null
  );

  // ---- Test 2: duplicate detection (source_url) ----
  line();
  console.log("Test 2: duplicate detection (source_url)");
  const r2 = await processAndSaveNews(mockKitcoNews(), { repo: repo1 }, {
    aiOpts: {
      forceMock: true,
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: validValidator(),
    },
    imageOpts: { _mockSearchFn: goodMockImageSearch(), delayMs: 0 },
  });
  check("duplicate=true", r2.duplicate === true, `got ${r2.duplicate}`);
  check("saved=false (ซ้ำ)", r2.saved === false);
  check(
    "duplicateReason มีค่า",
    !!r2.duplicateReason,
    `got ${r2.duplicateReason}`
  );

  // ---- Test 3: REJECTED ไม่เรียก image ----
  line();
  console.log("Test 3: REJECTED ไม่เรียก image pipeline");
  let imageCalled = false;
  const trackingImage = async () => {
    imageCalled = true;
    return [];
  };
  const r3 = await processAndSaveNews(
    mockKitcoNews({
      id: "kitco-rejected-1",
      sourceUrl: "https://www.kitco.com/news/article/rejected-1",
    }),
    { repo: repo1 },
    {
      aiOpts: {
        forceMock: true,
        // rewrite มี banned → local gate reject
        _testRewriteResponse: { ...perfectRewrite(), thaiTitle: "ทองขึ้นแน่" },
        _testValidatorResponse: validValidator(),
      },
      imageOpts: { _mockSearchFn: trackingImage, delayMs: 0 },
    }
  );
  check(
    "validationStatus=rejected",
    r3.news.validationStatus === NewsStatus.REJECTED,
    `got ${r3.news.validationStatus}`
  );
  check("imageSkipped=true", r3.imageSkipped === true);
  check("image ไม่ถูกเรียก", imageCalled === false, "Pexels ไม่ควรถูกเรียก");
  check("imageUrl=null (ไม่เสีย quota)", r3.news.imageUrl === null);

  // ---- Test 4: FAILED ไม่เรียก image ----
  line();
  console.log("Test 4: FAILED (rewrite fail) ไม่เรียก image");
  let imageCalled2 = false;
  const r4 = await processAndSaveNews(
    mockKitcoNews({
      id: "kitco-failed-1",
      sourceUrl: "https://www.kitco.com/news/article/failed-1",
    }),
    { repo: repo1 },
    {
      aiOpts: {
        forceMock: true,
        _testRewriteResponse: null, // throw → rewrite_failed
      },
      imageOpts: {
        _mockSearchFn: async () => {
          imageCalled2 = true;
          return [];
        },
        delayMs: 0,
      },
    }
  );
  check(
    "validationStatus=failed",
    r4.news.validationStatus === NewsStatus.FAILED,
    `got ${r4.news.validationStatus}`
  );
  check("imageSkipped=true", r4.imageSkipped === true);
  check("image ไม่ถูกเรียก", imageCalled2 === false);

  // ---- Test 5: query/filter ----
  line();
  console.log("Test 5: query/filter ตาม status");
  const validatedList = repo1.listByStatus("validated");
  const rejectedList = repo1.listByStatus("rejected");
  const failedList = repo1.listByStatus("failed");
  check("listByStatus(validated) ≥ 1", validatedList.length >= 1);
  check("listByStatus(rejected) = 1", rejectedList.length === 1);
  check("listByStatus(failed) = 1", failedList.length === 1);
  const counts = repo1.countByStatus();
  check("countByStatus มี validated", counts.validated >= 1);
  check("countByStatus มี rejected", counts.rejected === 1);
  check("countByStatus มี failed", counts.failed === 1);

  // ---- Test 6: restart persistence ----
  line();
  console.log("Test 6: restart persistence (close + reopen ไฟล์เดิม)");
  // ใช้ temp file
  const tmpFile = join(
    tmpdir(),
    `phase5-test-${Date.now()}.db`
  );
  try {
    unlinkSync(tmpFile);
  } catch {
    /* ignore */
  }
  // session 1: insert
  const dbA = new Database(tmpFile);
  dbA.pragma("journal_mode = WAL");
  const migrationSql = readFileSync(
    join(__dirname, "..", "store", "migration.sql"),
    "utf8"
  );
  dbA.exec(migrationSql);
  const repoA = createNewsRepository(dbA);
  repoA.insertNews({
    ...mockKitcoNews({ id: "persist-1" }),
    validationStatus: "validated",
    publishStatus: "processing",
  });
  dbA.close();
  // session 2: reopen + query
  const dbB = new Database(tmpFile, { readonly: false });
  dbB.pragma("journal_mode = WAL");
  dbB.exec(migrationSql);
  const repoB = createNewsRepository(dbB);
  const got = repoB.getById("persist-1");
  check("restart: ข่าวยังอยู่หลัง close+reopen", got && got.id === "persist-1");
  check(
    "restart: validationStatus ยังคง validated",
    got.validationStatus === "validated"
  );
  check(
    "restart: publishStatus ยังคง processing (ไม่ publish)",
    got.publishStatus === "processing"
  );
  dbB.close();
  try {
    unlinkSync(tmpFile);
  } catch {
    /* ignore */
  }

  // ---- Test 7: transaction rollback ----
  line();
  console.log("Test 7: transaction rollback เมื่อ insert ผิดพลาด");
  // สร้าง db แยก + force error โดย insert news ที่ขาด field required
  const db3 = createTestDb();
  const repo3 = createNewsRepository(db3);
  let rollbackCaught = false;
  try {
    // news ที่ขาด validation_status (NOT NULL constraint) → ควร throw
    db3.transaction(() => {
      db3.prepare(
        "INSERT INTO news (id, source, validation_status, publish_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("bad-1", "Test", null, "processing", new Date().toISOString(), new Date().toISOString());
    })();
  } catch (err) {
    rollbackCaught = true;
  }
  check("transaction throw เมื่อ constraint fail", rollbackCaught);
  const badRow = db3.prepare("SELECT * FROM news WHERE id = ?").get("bad-1");
  check("rollback: row ไม่ถูกบันทึก", !badRow);

  // ---- Summary ----
  line();
  console.log(`\n📊 ผล: ${passed} passed, ${failed} failed`);
  line();
  if (failed > 0) {
    console.log("❌ Phase 5 E2E มี test fail");
    process.exitCode = 1;
  } else {
    console.log("✅ Phase 5 E2E ผ่านทั้งหมด");
  }
}

runTests().catch((err) => {
  console.error("❌ uncaught:", err);
  process.exitCode = 1;
});
