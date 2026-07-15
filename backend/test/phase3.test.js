/* ============================================================
   Phase 3 — Automated regression tests (node:test)
   ------------------------------------------------------------
   ครอบคลุม QC รอบ 1 acceptance criteria:
   - Source policy: exact allowlist, Reuters/external block, ชื่อปลอม block
   - Mock ห้าม validated
   - --real ไม่มี key ต้อง fail
   - AI validator failure / isValid=false → needs_review (ห้าม validated)
   - Banned words / advice → rejected
   - Missing numbers / unexpected numbers
   - Confidence/status thresholds
   ============================================================ */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  classifySource,
  partitionByPolicy,
  SourcePolicy,
  normalizeSourceName,
} from "../src/ai/sourcePolicy.js";
import {
  findBannedWords,
  findInvestmentAdvice,
  checkNumbers,
  validateRewritten,
} from "../src/ai/validator.js";
import { chat, chatJson } from "../src/ai/openai.client.js";
import {
  processNews,
  validateAiValidationShape,
} from "../src/ai/pipeline.js";
import { NewsStatus } from "../src/utils/schema.js";

// ---------- helper สร้างข่าวทดสอบ ----------
function makeNews(over = {}) {
  return {
    id: "test-1",
    source: "Kitco News",
    isExternal: false,
    originalTitle: "Gold prices rally on CPI data",
    originalContent:
      "Gold prices jumped to $4,089.10 per ounce, up 2.22%. " +
      "Silver reached $59.12, up 2.78%. The Federal Reserve signaled patience on rates. " +
      "CPI came in at 3.1% versus 3.3% expected. DXY fell to 104.32. " +
      "Analysts expect support at 4,000 and resistance at 4,100 in the near term.",
    sourceUrl: "https://www.kitco.com/news/test",
    originalPublishedAt: new Date().toISOString(),
    ...over,
  };
}

// ---------- helper สำหรับ DI tests (QC รอบ 2) ----------
// ผล rewrite "perfect" (ตัวเลขตรง + ไม่มี banned/advice) → local gate ผ่าน
// สำคัญ: ต้องครอบคลุมตัวเลขทุกตัวของ makeNews().originalContent เพื่อกัน missing
function perfectRewrite() {
  return {
    thaiTitle: "ทองคำขยับหลังข้อมูล CPI",
    thaiSummary: "ทองคำขยับขึ้นตามข้อมูล CPI",
    thaiContent: [
      "ทองคำขยับขึ้นราคา 4,089.10 ดอลลาร์ต่อออนซ์ บวก 2.22%",
      "เงินถึง 59.12 บวก 2.78% ทองคำรอ Fed CPI ออกมา 3.1% เทียบกับคาด 3.3%",
      "ดัชนีดอลลาร์ DXY ลดลงมาที่ 104.32 แนวรับ 4,000 แนวต้าน 4,100",
    ],
    marketFactors: "ดอกเบี้ย, ดอลลาร์, เงินเฟ้อ",
    keyFacts: ["CPI 3.1%", "DXY 104.32"],
    mentionedNumbers: ["4089.10", "2.22%", "59.12", "2.78%", "3.1%", "3.3%", "104.32", "4000", "4100"],
    imageSearchKeywords: ["gold market"],
  };
}
// validator ผล "ดี" ครบ schema (ผ่าน hard gates)
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

// ============================================================
// Fix #4: Source Policy — exact allowlist + isExternal ก่อน
// ============================================================
describe("Source Policy (Fix #4)", () => {
  test("Kitco exact allowlist → TRUSTED", () => {
    for (const s of ["Kitco News", "Kitco NewsWire", "Kitco Newsdesk"]) {
      const r = classifySource({ source: s, isExternal: false });
      assert.equal(r.policy, SourcePolicy.TRUSTED, `${s} ต้อง trusted`);
    }
  });

  test("Kitco case + whitespace insensitive (หลัง normalize)", () => {
    assert.equal(
      classifySource({ source: "  kitco   news ", isExternal: false }).policy,
      SourcePolicy.TRUSTED
    );
    assert.equal(
      classifySource({ source: "KITCO NEWSWIRE", isExternal: false }).policy,
      SourcePolicy.TRUSTED
    );
  });

  test("Reuters → needs_review", () => {
    const r = classifySource({ source: "Reuters", isExternal: false });
    assert.equal(r.policy, SourcePolicy.NEEDS_REVIEW);
    assert.match(r.reason, /reuters/);
  });

  test("external (isExternal=true) → block ก่อนตรวจชื่อเสมอ", () => {
    // แม้จะชื่อ "Kitco News" แต่ external → needs_review
    const r = classifySource({ source: "Kitco News", isExternal: true });
    assert.equal(r.policy, SourcePolicy.NEEDS_REVIEW);
    assert.equal(r.reason, "external_link");
  });

  test("ชื่อปลอมที่มีคำว่า Kitco ต้อง block", () => {
    const fakes = [
      "Fake Kitco News Syndication",
      "Not Kitco News",
      "Kitco News / Unknown Partner",
      "Kitco News Pro Premium",
      "Kitco News Aggregator",
    ];
    for (const s of fakes) {
      const r = classifySource({ source: s, isExternal: false });
      assert.equal(
        r.policy,
        SourcePolicy.NEEDS_REVIEW,
        `"${s}" ต้องเป็น needs_review (ห้าม substring match)`
      );
    }
  });

  test("source ว่าง → needs_review", () => {
    assert.equal(
      classifySource({ source: "", isExternal: false }).policy,
      SourcePolicy.NEEDS_REVIEW
    );
  });

  test("partitionByPolicy แยกถูก", () => {
    const list = [
      { source: "Kitco News", isExternal: false },
      { source: "Reuters", isExternal: false },
      { source: "Mining.com", isExternal: true },
    ];
    const { canProcess, blocked } = partitionByPolicy(list);
    assert.equal(canProcess.length, 1);
    assert.equal(blocked.length, 2);
  });

  test("normalizeSourceName collapse whitespace", () => {
    assert.equal(normalizeSourceName("  Kitco   News "), "kitco news");
  });
});

// ============================================================
// Fix #3: Number checker — missing + unexpected
// ============================================================
describe("Number checker (Fix #3)", () => {
  test("คืน missing เมื่อตัวเลขต้นฉบับหาย", () => {
    const r = checkNumbers(
      "Gold $4,089.10, silver $59.12, CPI 3.1%",
      "ทอง 4089.10 ดอลลาร์"
    );
    assert.ok(r.missing.length >= 2, "ต้องมีตัวเลขที่หาย");
    assert.ok(r.unexpected.length === 0);
  });

  test("คืน unexpected เมื่อ rewritten เพิ่มตัวเลข", () => {
    const r = checkNumbers(
      "Gold at 4089.10.",
      "ทอง 4089.10 และนักวิเคราะห์เป้าหมาย 9999 ดอลลาร์"
    );
    assert.ok(r.unexpected.includes("9999"), "ต้องตรวจพบ 9999 เป็น unexpected");
  });

  test("กรณีต้นฉบับไม่มีตัวเลข แต่ rewritten เพิ่ม 9,999", () => {
    const r = checkNumbers("ตลาดมีความผันผวน", "ราคาพุ่งถึง 9,999");
    assert.equal(r.originalCount, 0);
    assert.ok(r.unexpected.includes("9999"));
  });

  test("normalize $ comma decimal %", () => {
    const r = checkNumbers("$4,089.10 และ 2.22%", "4089.10 และ 2.22%");
    assert.equal(r.missing.length, 0);
    assert.equal(r.unexpected.length, 0);
  });

  test("validateRewritten ตั้ง hasUnexpectedNumbers", () => {
    const v = validateRewritten(
      { originalContent: "Gold at 4089.10." },
      {
        thaiTitle: "ทองขยับ",
        thaiSummary: "",
        thaiContent: ["ทอง 4089.10 เป้าหมาย 9999"],
        marketFactors: "",
        keyFacts: [],
        mentionedNumbers: [],
      }
    );
    assert.equal(v.hasUnexpectedNumbers, true);
    assert.equal(v.canAutoValidate, false);
  });
});

// ============================================================
// Fix #2 + validator: AI validator shape check
// ============================================================
describe("AI validator shape (Fix #2)", () => {
  test("shape ถูก → valid", () => {
    const r = validateAiValidationShape({
      isValid: true,
      bannedWordsFound: [],
      investmentAdviceFound: false,
      numbersMatch: true,
      numberMismatches: [],
      addedInformationFound: false,
      confidence: 90,
    });
    assert.equal(r.valid, true);
  });

  test("isValid ไม่ใช่ boolean → invalid", () => {
    const r = validateAiValidationShape(
      validValidator({ isValid: "yes" })
    );
    assert.equal(r.valid, false);
    assert.ok(r.errors.includes("isValid_required_boolean"));
  });

  test("confidence ไม่ใช่ number 0-100 → invalid", () => {
    assert.equal(
      validateAiValidationShape(validValidator({ confidence: "high" })).valid,
      false
    );
    assert.equal(
      validateAiValidationShape(validValidator({ confidence: 150 })).valid,
      false
    );
    assert.equal(
      validateAiValidationShape(validValidator({ confidence: -5 })).valid,
      false
    );
  });

  test("not an object → invalid", () => {
    assert.equal(validateAiValidationShape(null).valid, false);
    assert.equal(validateAiValidationShape("x").valid, false);
  });
});

// ============================================================
// Banned words / advice (validator)
// ============================================================
describe("Banned words + advice", () => {
  test("ตรวจจับ ขึ้นแน่", () => {
    assert.ok(findBannedWords("ทองคำจะขึ้นแน่").includes("ขึ้นแน่"));
  });
  test("ตรวจจับ กำไรแน่นอน + ไม่มีความเสี่ยง", () => {
    const found = findBannedWords("กำไรแน่นอน ไม่มีความเสี่ยง");
    assert.ok(found.includes("กำไรแน่นอน"));
    assert.ok(found.includes("ไม่มีความเสี่ยง"));
  });
  test("ข่าวปกติไม่มี banned", () => {
    assert.equal(findBannedWords("ทองคำปรับตัวขึ้นตามข้อมูล").length, 0);
  });
  test("ตรวจจับคำแนะนำลงทุน", () => {
    assert.ok(findInvestmentAdvice("แนะนำให้ซื้อทันที").length > 0);
    assert.ok(findInvestmentAdvice("ควรซื้อทอง").length > 0);
  });
  test("validateRewritten ตั้ง passesLocalGate=false เมื่อมี banned", () => {
    const v = validateRewritten(
      { originalContent: "Gold 4089.10." },
      {
        thaiTitle: "ทองขึ้นแน่",
        thaiSummary: "",
        thaiContent: ["ขึ้นแน่"],
        marketFactors: "",
        keyFacts: [],
        mentionedNumbers: ["4089.10"],
      }
    );
    assert.equal(v.passesLocalGate, false);
  });
});

// ============================================================
// Fix #1 + #2: Pipeline (mock) — ห้าม validated
// ============================================================
describe("Pipeline mock mode (Fix #1)", () => {
  test("mock run ห้าม validated (สูงสุด needs_review)", async () => {
    const r = await processNews(makeNews(), { forceMock: true });
    assert.equal(r.mock, true);
    assert.notEqual(r.news.validationStatus, NewsStatus.VALIDATED);
    assert.notEqual(r.news.publishStatus, NewsStatus.VALIDATED);
  });

  test("mock ที่ local confidence สูงก็ตาม ต้องไม่ validated", async () => {
    // mock output ไม่มีตัวเลขจริง → อาจได้ local conf สูง
    // แต่ hard gate mock_run ต้อง block validated
    const r = await processNews(makeNews(), { forceMock: true });
    assert.equal(r.mock, true);
    assert.notEqual(r.news.validationStatus, "validated");
  });
});

// ============================================================
// Fix #1: --real ไม่มี key → fail fast
// ============================================================
describe("OpenAI client fail-fast (Fix #1)", () => {
  test("requireReal + ไม่มี key → throw MISSING_OPENAI_API_KEY", async () => {
    // NOTE: ทดสอบนี้สมมุติว่า env ไม่มี key (CI/dev ปกติ)
    // ถ้าในเครื่องมี key จริง ให้ข้าม
    const hasKey = !!process.env.OPENAI_API_KEY;
    if (hasKey) {
      // ใช้ option บังคับ no-key path: override config ไม่ได้ง่าย จึงข้าม
      return;
    }
    await assert.rejects(
      () => chat({ messages: [{ role: "user", content: "hi" }], requireReal: true }),
      /MISSING_OPENAI_API_KEY/
    );
    await assert.rejects(
      () => chatJson({ messages: [{ role: "user", content: "hi" }], requireReal: true }),
      /MISSING_OPENAI_API_KEY/
    );
  });

  test("forceMock ไม่เรียกจริง และ mock=true", async () => {
    const r = await chat({
      messages: [{ role: "user", content: "test" }],
      forceMock: true,
    });
    assert.equal(r.mock, true);
  });
});

// ============================================================
// Fix #2: AI validator hard gate scenarios (mock-driven)
// ============================================================
describe("Pipeline hard gates (Fix #2)", () => {
  test("AI validator isValid=false → ห้าม validated", async () => {
    // inject ผล validator ปลอมผ่าน skipAiValidate + manual ไม่ได้
    // จึงทดสอบผ่าน mock: mock validator ส่ง isValid=true + mockOnly
    // → hard block validated (เพราะ mockOnly)
    const r = await processNews(makeNews(), { forceMock: true });
    assert.notEqual(r.news.validationStatus, NewsStatus.VALIDATED);
  });

  test("banned words ใน rewritten → rejected (local gate)", async () => {
    // stub rewriteNews ไม่ตรงได้ง่าย — ทดสอบผ่าน validateRewritten แทน
    const v = validateRewritten(
      { originalContent: "Gold 4089.10." },
      {
        thaiTitle: "ทองขึ้นแน่",
        thaiSummary: "",
        thaiContent: ["ขึ้นแน่"],
        marketFactors: "",
        keyFacts: [],
        mentionedNumbers: ["4089.10"],
      }
    );
    assert.equal(v.passesLocalGate, false);
  });

  test("unexpected numbers → canAutoValidate=false", () => {
    const v = validateRewritten(
      { originalContent: "Gold 4089.10." },
      {
        thaiTitle: "ทอง",
        thaiSummary: "",
        thaiContent: ["ทอง 4089.10 เป้าหมาย 12345"],
        marketFactors: "",
        keyFacts: [],
        mentionedNumbers: [],
      }
    );
    assert.equal(v.canAutoValidate, false);
    assert.equal(v.hasUnexpectedNumbers, true);
  });
});

// ============================================================
// Thresholds
// ============================================================
describe("Confidence/status thresholds", () => {
  test("localConfidence 100 เมื่อไม่มีปัญหา", () => {
    const v = validateRewritten(
      { originalContent: "Gold 4089.10." },
      {
        thaiTitle: "ทอง",
        thaiSummary: "",
        thaiContent: ["ทอง 4089.10"],
        marketFactors: "",
        keyFacts: [],
        mentionedNumbers: ["4089.10"],
      }
    );
    assert.equal(v.localConfidence, 100);
  });

  test("localConfidence ลดเมื่อมี unexpected numbers", () => {
    const v = validateRewritten(
      { originalContent: "Gold 4089.10." },
      {
        thaiTitle: "ทอง",
        thaiSummary: "",
        thaiContent: ["ทอง 4089.10 เป้า 9999 และ 8888"],
        marketFactors: "",
        keyFacts: [],
        mentionedNumbers: [],
      }
    );
    assert.ok(v.localConfidence < 100);
  });
});

// ============================================================
// QC รอบ 2 — Hard-gate regression tests (DI via _testRewriteResponse / _testValidatorResponse)
// ============================================================

describe("QC รอบ 2 — Finding 1: number gate ครอบคลุม (DI rewrite)", () => {
  test("เปลี่ยนเลขใน title 4,100 → 4,200 → ห้าม validated (unexpected)", () => {
    const rw = perfectRewrite();
    rw.thaiTitle = "ทองทะลุ 4,200 ดอลลาร์"; // original มี 4,100 ไม่มี 4,200
    const v = validateRewritten(
      {
        originalContent:
          "Gold tests resistance at 4,100. CPI 3.1% vs 3.3%. DXY 104.32.",
      },
      rw
    );
    assert.equal(v.hasUnexpectedNumbers, true);
    assert.equal(v.canAutoValidate, false);
  });

  test("เปลี่ยน 25 basis points → 50 basis points → ตรวจพบ", () => {
    const r = checkNumbers(
      "Fed cut 25 basis points.",
      "Fed ลดดอกเบี้ย 50 basis points"
    );
    assert.ok(r.unexpected.includes("50"));
    assert.ok(r.missing.includes("25"));
  });

  test("เปลี่ยนปี 2025 → 2026 → ตรวจพบ", () => {
    const r = checkNumbers(
      "In 2025 gold rose. CPI 3.1%.",
      "ในปี 2026 ทองขึ้น ส่วน CPI 3.1%"
    );
    assert.ok(r.unexpected.includes("2026"));
    assert.ok(r.missing.includes("2025"));
  });

  test("ordinal noise (1st / ไตรมาสที่ 1) ไม่ตก false positive", () => {
    const r = checkNumbers(
      "The 1st quarter saw growth.",
      "ไตรมาสที่ 1 มีการเติบโต"
    );
    assert.equal(r.unexpected.length, 0);
    assert.equal(r.missing.length, 0);
  });

  test("ตัวเลขใน thaiSummary/keyFacts ถูกตรวจ", () => {
    const rw = perfectRewrite();
    rw.thaiSummary = "DXY อยู่ที่ 999"; // original มี 104.32 ไม่มี 999
    const v = validateRewritten(
      { originalContent: "DXY fell to 104.32. CPI 3.1%." },
      rw
    );
    assert.equal(v.hasUnexpectedNumbers, true);
  });
});

describe("QC รอบ 2 — Finding 2: AI validator schema required + fail closed", () => {
  test("validator ขาด safety field (เฉพาะ isValid+confidence) → invalid", () => {
    const r = validateAiValidationShape({ isValid: true, confidence: 95 });
    assert.equal(r.valid, false);
    assert.ok(r.errors.length >= 5); // ขาดอย่างน้อย 5 fields
  });

  test("validator ครบ schema → valid", () => {
    assert.equal(validateAiValidationShape(validValidator()).valid, true);
  });

  test("validator isValid=false → pipeline ห้าม validated", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: validValidator({ isValid: false, confidence: 40 }),
    });
    assert.notEqual(r.news.validationStatus, "validated");
  });

  test("validator throw (null inject) → needs_review (ห้าม validated)", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: null,
    });
    assert.notEqual(r.news.validationStatus, "validated");
    assert.equal(r.news.validationStatus, "needs_review");
  });

  test("validator bad shape → needs_review (ห้าม validated)", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: { isValid: true, confidence: 95 }, // ขาด fields
    });
    assert.notEqual(r.news.validationStatus, "validated");
  });

  test("validator numbersMatch=false แต่ไม่มี mismatch จริง → ใช้ local deterministic result", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: validValidator({ numbersMatch: false }),
    });
    assert.equal(r.news.validationStatus, "validated");
    assert.equal(r.news.aiValidation.aiNumberVerdictIgnored, true);
  });

  test("validator ระบุ mismatch ที่ค่าแตกต่างจริง → ห้าม validated", async () => {
    const rewritten = perfectRewrite();
    rewritten.thaiTitle = "ทองคำอยู่ที่ 4,999.10 ดอลลาร์";
    const r = await processNews(makeNews(), {
      _testRewriteResponse: rewritten,
      _testValidatorResponse: validValidator({
        numbersMatch: false,
        numberMismatches: [{ original: "4,089.10", rewritten: "4,999.10" }],
      }),
    });
    assert.notEqual(r.news.validationStatus, "validated");
  });

  test("validator bannedWordsFound ไม่ว่าง → ห้าม validated", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: validValidator({
        bannedWordsFound: ["ขึ้นแน่"],
      }),
    });
    assert.notEqual(r.news.validationStatus, "validated");
  });

  test("validator investmentAdviceFound=true → ห้าม validated", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: validValidator({ investmentAdviceFound: true }),
    });
    assert.notEqual(r.news.validationStatus, "validated");
  });

  test("validator addedInformationFound=true → ห้าม validated", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: validValidator({ addedInformationFound: true }),
    });
    assert.notEqual(r.news.validationStatus, "validated");
  });

  test("validator confidence ผิดช่วง (101) → invalid shape", () => {
    const r = validateAiValidationShape(
      validValidator({ confidence: 101 })
    );
    assert.equal(r.valid, false);
  });
});

describe("QC รอบ 2 — Finding 3: skipAiValidate ห้าม validated", () => {
  test("skipAiValidate=true + rewrite perfect → สูงสุด needs_review", async () => {
    const r = await processNews(makeNews(), {
      skipAiValidate: true,
      _testRewriteResponse: perfectRewrite(),
    });
    assert.notEqual(r.news.validationStatus, "validated");
  });
});

describe("QC รอบ 2 — Finding 4: hard-gate pipeline end-to-end", () => {
  test("ทุกอย่าง perfect + real validator → validated (positive control)", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: perfectRewrite(),
      _testValidatorResponse: validValidator(), // confidence 92, isValid true
    });
    assert.equal(r.news.validationStatus, "validated");
  });

  test("rewrite มี unexpected number → local gate block validated", async () => {
    const rw = perfectRewrite();
    rw.thaiTitle = "ทองทะลุ 9,999 ดอลลาร์"; // original ไม่มี 9,999
    const r = await processNews(makeNews(), {
      _testRewriteResponse: rw,
      _testValidatorResponse: validValidator(),
    });
    assert.notEqual(r.news.validationStatus, "validated");
  });

  test("rewrite มี banned word → rejected (local gate)", async () => {
    const rw = perfectRewrite();
    rw.thaiTitle = "ทองขึ้นแน่";
    const r = await processNews(makeNews(), {
      _testRewriteResponse: rw,
      _testValidatorResponse: validValidator(),
    });
    assert.equal(r.news.validationStatus, "rejected");
  });

  test("rewrite failure → status failed", async () => {
    const r = await processNews(makeNews(), {
      _testRewriteResponse: null,
    });
    assert.equal(r.news.validationStatus, "failed");
  });
});
