/* ============================================================
   CLI — ทดสอบระบบ OpenAI เรียบเรียง + ตรวจสอบข่าว (Phase 3)
   ------------------------------------------------------------
   โหมด:
   - (default) ดึงข่าวจริงจาก Kitco → แบ่งตาม source policy →
                 ประมวลผลข่าว TRUSTED ผ่าน pipeline → รายงานสถานะ + cost
   - --mock     บังคับใช้ mock (ไม่เสียเงิน)
   - --real     บังคับใช้ API จริง (ต้องมี OPENAI_API_KEY)
   - --limit N  จำกัดจำนวนข่าวที่ประมวลผล
   - --article URL  ประมวลผลบทความเดี่ยวจาก URL

   ตัวอย่าง:
     node src/cli/test-rewrite.js --mock --limit 2
     node src/cli/test-rewrite.js --real --limit 2
     node src/cli/test-rewrite.js --real --article <URL>

   หมายเหตุ: ไม่เชื่อม Pexels/DB/Scheduler/Frontend (ตามขอบเขต Phase 3)
   ============================================================ */

import { fetchDigest, fetchArticle, fetchArticles, StructureError } from "../scraper/kitco.scraper.js";
import { partitionByPolicy, classifySource } from "../ai/sourcePolicy.js";
import { processNews, processBatch } from "../ai/pipeline.js";
import { costTracker } from "../ai/costTracker.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

const log = logger.make("test3");

function parseArgs(argv) {
  const out = { mock: false, real: false, limit: null, article: null, max: 3 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mock") out.mock = true;
    else if (a === "--real") out.real = true;
    else if (a === "--limit") out.limit = Number(argv[++i]) || 2;
    else if (a === "--max") out.max = Number(argv[++i]) || 3;
    else if (a === "--article") out.article = argv[++i];
  }
  return out;
}

function line(c = "─", n = 64) {
  console.log(c.repeat(n));
}

async function runSingleArticle(url, opts) {
  line("═");
  console.log("โหมด: ประมวลผลบทความเดี่ยวผ่าน AI pipeline");
  console.log(`URL : ${url}`);
  console.log(`Mode: ${opts.mock ? "MOCK" : opts.real ? "REAL API" : "AUTO"}`);
  line("═");

  const item = {
    id: "",
    section: "(single)",
    sourceUrl: url,
    urlAlias: url.replace(/^https?:\/\/[^/]+/, ""),
    originalTitle: "",
    source: "",
    topics: [],
  };
  const news = await fetchArticle(item);
  const r = await processNews(news, {
    forceMock: opts.mock && !opts.real,
    requireReal: opts.real === true,
  });
  printResult(r, true);
}

function printResult(r, verbose) {
  line("·");
  // กรณี failed (batch เก็บ {ok:false, error, news})
  if (!r || !r.news || !r.localCheck) {
    console.log(`❌ FAILED: ${r?.error || r?.reason || "(no detail)"}`);
    return;
  }
  const n = r.news;
  if (r.skipped) {
    console.log(`⏭️  SKIP: ${r.reason} | ${n.originalTitle}`.slice(0, 90));
    console.log(`    policy=${n.sourcePolicy} (${n.sourcePolicyReason})`);
    console.log(`    note: ${n.pipelineNote}`);
    return;
  }
  const mockTag = r.mock ? " [MOCK]" : "";
  console.log(`หัวข้อ (ไทย): ${n.thaiTitle}${mockTag}`);
  console.log(`สถานะ      : ${n.validationStatus}`);
  console.log(`confidence : ${n.aiConfidence}`);
  const nc = r.localCheck.numberCheck || { missing: [], unexpected: [] };
  console.log(`local check: conf=${r.localCheck.localConfidence} banned=${r.localCheck.bannedWords.length} missingNums=${nc.missing.length} unexpectedNums=${nc.unexpected.length}`);
  if (r.aiValidation) {
    console.log(`AI check   : valid=${r.aiValidation.isValid} numMatch=${r.aiValidation.numbersMatch} advice=${r.aiValidation.investmentAdviceFound} added=${r.aiValidation.addedInformationFound}`);
  } else {
    console.log(`AI check   : (none)`);
  }
  console.log(`note       : ${n.pipelineNote}`);
  if (verbose && n.thaiSummary) {
    console.log(`\nสรุป: ${n.thaiSummary}`);
    console.log(`\nเนื้อหา (${(n.thaiContent || []).length} ย่อหน้า):`);
    (n.thaiContent || []).forEach((p, i) =>
      console.log(`  [${i + 1}] ${p.slice(0, 200)}${p.length > 200 ? "…" : ""}`)
    );
    console.log(`\nkeyFacts: ${(n.keyFacts || []).join(" / ")}`);
    console.log(`ตัวเลข: ${(n.mentionedNumbers || []).join(", ")}`);
    console.log(`imageKeywords: ${(n.imageSearchKeywords || []).join(", ")}`);
    console.log(`\nเครดิต: ${n.credit}`);
    console.log(`ลิงก์ต้นฉบับ: ${n.sourceUrl}`);
  }
}

async function runBatch(args) {
  line("═");
  console.log("โหมด: ดึงข่าว Kitco → source policy gate → AI pipeline");
  console.log(
    `Mode: ${args.mock ? "MOCK (ไม่เสียเงิน)" : args.real ? "REAL API" : `AUTO (${config.openai.apiKey ? "มี key → REAL" : "ไม่มี key → MOCK"})`}`
  );
  console.log(`Limit: ${args.limit} ข่าวที่จะประมวลผล`);
  line("═");

  // 1) ดึงรายการข่าว
  const { items } = await fetchDigest({ maxPerSection: args.max });
  log.info(`digest ได้ ${items.length} รายการที่ผ่านทุกขั้นตอน Phase 2`);

  // 2) Source policy gate
  line();
  console.log("\n🛂 Source Policy Gate\n");
  const { canProcess, blocked } = partitionByPolicy(items);
  console.log(`  ส่งเข้า AI ได้ (TRUSTED)    : ${canProcess.length}`);
  console.log(`  ห้ามส่ง (NEEDS_REVIEW)     : ${blocked.length}`);
  if (blocked.length) {
    console.log("\n  รายการที่ถูก block:");
    const byReason = {};
    blocked.forEach((b) => {
      byReason[b.reason] = (byReason[b.reason] || 0) + 1;
    });
    for (const [reason, count] of Object.entries(byReason)) {
      console.log(`    - ${reason}: ${count} รายการ`);
    }
    blocked.slice(0, 5).forEach((b) =>
      console.log(`    • "${b.news.source}" → ${b.reason} | ${(b.news.originalTitle || "").slice(0, 50)}`)
    );
  }

  if (canProcess.length === 0) {
    console.log("\n⚠️  ไม่มีข่าวที่ผ่าน source policy — หยุด");
    return;
  }

  // 3) ดึงเนื้อหาเต็มจำกัดจำนวน + ประมวลผล AI
  const limit = args.limit || Math.min(2, canProcess.length);
  const toFetch = canProcess.slice(0, limit);
  line();
  console.log(`\n📄 ดึงเนื้อหาเต็ม ${toFetch.length} บทความ + ประมวลผล AI...\n`);

  const { results: fetched, errors } = await fetchArticles(toFetch);
  if (errors.length) {
    console.log(`⚠️  ดึงเนื้อหาล้มเหลว ${errors.length}: ${errors.map((e) => e.error.message).join("; ")}`);
  }

  costTracker.reset();
  // QC รอบ 1: โหมด resolution ชัดเจน
  //   --real → requireReal (ไม่มี key → fail fast ที่นี่ ก่อนเข้า pipeline)
  //   --mock → forceMock
  //   AUTO   → มี key real, ไม่มี key mock (mock=true ชัดเจน)
  const requireReal = args.real === true;
  const forceMock = args.mock === true && !args.real;
  if (requireReal && !config.openai.apiKey) {
    throw new Error(
      "MISSING_OPENAI_API_KEY: โหมด --real ต้องการ OPENAI_API_KEY แต่ไม่พบ " +
        "ใน .env — ห้าม fallback เป็น mock ตามนโยบาย QC รอบ 1 " +
        "(ตั้งค่า key ใน backend/.env หรือรันด้วย --mock)"
    );
  }
  const batch = await processBatch(fetched, { forceMock, requireReal });

  // 4) รายงานผล
  line();
  console.log("\n📊 ผลการประมวลผล AI pipeline\n");
  console.log(`  validated (85-100) : ${batch.validated.length}`);
  console.log(`  needs_review (70-84): ${batch.needsReview.length}`);
  console.log(`  rejected (<70)      : ${batch.rejected.length}`);
  console.log(`  failed              : ${batch.failed.length}`);

  const all = [...batch.validated, ...batch.needsReview, ...batch.rejected, ...batch.failed];
  all.forEach((r) => {
    console.log("");
    printResult(r, false);
  });

  // 5) Cost
  line();
  console.log("\n💰 Cost Tracking\n");
  costTracker.print({ info: (m) => console.log(m) });

  // 6) ยืนยันกฎสำคัญ (QC รอบ 1)
  line();
  console.log("\n✅ ยืนยันกฎ Phase 3 (QC รอบ 1)");

  // กฎ A: Reuters/external ต้องไม่ถูกส่งเข้า AI
  const leaked = all.filter(
    (r) =>
      r.news &&
      r.news.sourcePolicy === "needs_review" &&
      !r.skipped
  );
  console.log(
    `  A. Reuters/external รั่วเข้า AI : ${leaked.length} ${leaked.length === 0 ? "✅" : "❌"}`
  );

  // กฎ B: ผลที่ประมวลผลด้วย mock ต้องไม่มี validated
  const mockValidated = all.filter(
    (r) => r.mock === true && r.news && r.news.validationStatus === "validated"
  );
  console.log(
    `  B. mock → validated (ห้ามเกิด)  : ${mockValidated.length} ${mockValidated.length === 0 ? "✅" : "❌"}`
  );

  // กฎ C: AUTO/real ต้องไม่มี validated ถ้าไม่ได้เรียกจริง
  const anyValidated = batch.validated.length;
  const calledReal = requireReal && config.openai.apiKey;
  console.log(
    `  C. validated ทั้งหมด             : ${anyValidated} ${calledReal || anyValidated === 0 ? "(ok)" : "⚠️ ตรวจสอบ"}`
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const t0 = Date.now();
  try {
    if (args.article) {
      await runSingleArticle(args.article, args);
    } else {
      await runBatch(args);
    }
    console.log(`\n⏱  ใช้เวลา ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log("\n✅ ทดสอบ Phase 3 เสร็จสิ้น");
  } catch (err) {
    if (err instanceof StructureError) {
      console.error(`\n🛑 StructureError: ${err.message}`);
    } else {
      console.error(`\n❌ ล้มเหลว: ${err.message}`);
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}

main();
