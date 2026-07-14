/* ============================================================
   CLI — ทดสอบ Kitco Scraper รุ่นแรก
   ------------------------------------------------------------
   โหมดเริ่มต้น: ดึงรายการข่าวจาก Digest (กรองแล้ว) แบบจำกัดจำนวน
   --article    : เปิดบทความเดี่ยวเพื่อดึงเนื้อหาเต็ม
   --max N      : จำกัดจำนวนรายการต่อ section (default จาก env)
   --open N     : เปิดเนื้อหาเต็ม N บทความแรกจากรายการที่ดึงได้
   --sections   : แสดงเฉพาะสถิติ section ไม่ดึงเนื้อหา

   ตัวอย่าง:
     node src/cli/test-scrape.js                  # ดึงรายการข่าว
     node src/cli/test-scrape.js --max 5          # จำกัด 5/section
     node src/cli/test-scrape.js --open 2         # ดึง list + เปิด 2 บทความ
     node src/cli/test-scrape.js --article <URL>  # เปิดบทความเดี่ยว

   หมายเหตุ: ไม่มีการเชื่อม OpenAI / Pexels / เผยแพร่ — เป็นเพียงการตรวจ scraping
   ============================================================ */

import { fetchDigest, fetchArticle, fetchArticles, StructureError } from "../scraper/kitco.scraper.js";
import { logger } from "../utils/logger.js";

const log = logger.make("test");

function parseArgs(argv) {
  const out = {
    article: null,
    max: null,
    open: 0,
    sectionsOnly: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--article") out.article = argv[++i] || null;
    else if (a === "--max") out.max = Number(argv[++i]) || null;
    else if (a === "--open") out.open = Number(argv[++i]) || 0;
    else if (a === "--sections") out.sectionsOnly = true;
  }
  return out;
}

function line(c = "─", n = 64) {
  console.log(c.repeat(n));
}

async function runSingleArticle(url) {
  line("═");
  console.log(`โหมด: เปิดบทความเดี่ยว`);
  console.log(`URL : ${url}`);
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
  line();
  console.log("✅ ดึงบทความสำเร็จ\n");
  console.log(`หัวข้อ      : ${news.originalTitle}`);
  console.log(`ผู้เขียน     : ${news.originalAuthor || "-"}`);
  console.log(`แหล่ง       : ${news.source}`);
  console.log(`หมวด       : ${news.category}`);
  console.log(`เผยแพร่เมื่อ : ${news.originalPublishedAt}`);
  console.log(`duplicateHash: ${news.duplicateHash}`);
  console.log(`ความยาวเนื้อหา: ${news.originalContent.length} ตัวอักษร`);
  line();
  console.log("เนื้อหา (800 ตัวแรก):\n");
  console.log(news.originalContent.slice(0, 800) + (news.originalContent.length > 800 ? " …" : ""));
}

async function runList(args) {
  line("═");
  console.log("โหมด: ดึงรายการข่าว Kitco News Digest");
  console.log(
    `จำกัด: ${args.max ? args.max + " รายการ/section" : "ค่า default จาก env"}`
  );
  line("═");

  const opts = args.max ? { maxPerSection: args.max } : {};
  const { items, needsReview, sections, skipped, stats } =
    await fetchDigest(opts);

  // สถิติต่อ section (รวม query ที่ label เดียวกันแล้ว)
  line();
  console.log("📊 สถิติต่อ section (label รวมแล้ว)\n");
  console.log(
    "section".padEnd(22) +
      "raw".padStart(6) +
      "relevant".padStart(10) +
      "fresh".padStart(7) +
      "agedOut".padStart(9) +
      "noDate".padStart(7)
  );
  line("·");
  for (const s of sections) {
    console.log(
      s.section.padEnd(22) +
        String(s.rawCount).padStart(6) +
        String(s.relevant).padStart(10) +
        String(s.fresh).padStart(7) +
        String(s.agedOut).padStart(9) +
        String(s.unreadableDate).padStart(7)
    );
  }
  console.log(
    "TOTAL".padEnd(22) +
      String(stats.totalRaw).padStart(6) +
      String(stats.totalRelevant).padStart(10) +
      String(stats.totalRelevant - stats.totalAgedOut - needsReview.length).padStart(7) +
      String(stats.totalAgedOut).padStart(9) +
      String(needsReview.length).padStart(7)
  );
  console.log(`\nHTML ที่ดึง: ${(stats.htmlBytes / 1024).toFixed(1)} KB`);

  // สรุป pipeline รวม (ก่อน/หลัง dedupe)
  line();
  console.log("\n🔁 สรุป pipeline (ก่อน/หลัง dedupe)");
  console.log(`   raw (รวมทุก section)  : ${stats.totalRaw}`);
  console.log(`   relevant (ผ่าน filter) : ${stats.totalRelevant}`);
  console.log(`   fresh (ผ่าน age <${stats.maxAgeHours}h) : ${stats.totalRelevant - stats.totalAgedOut - needsReview.length}`);
  console.log(`   ก่อน dedupe            : ${stats.beforeDedupe}`);
  console.log(`   หลัง dedupe (ACCEPTED) : ${stats.afterDedupe}`);
  console.log(`   ข่าวซ้ำที่ตัด           : ${stats.duplicates}`);
  console.log(`   ข่าวเก่าถูกตัด          : ${stats.totalAgedOut}`);
  console.log(`   อ่านวันที่ไม่ได้ (review): ${needsReview.length}`);

  if (skipped && skipped.length) {
    console.log("\n   รายการซ้ำที่ถูกตัด:");
    skipped.slice(0, 8).forEach((s) =>
      console.log(
        `   - [${s.reason}] ${(s.item.originalTitle || "").slice(0, 50)}`
      )
    );
    if (skipped.length > 8)
      console.log(`   … และอีก ${skipped.length - 8} รายการ`);
  }

  if (needsReview.length) {
    console.log(
      `\n   ⚠️  อ่านวันที่ไม่ได้ → needs_review (${needsReview.length} รายการ)`
    );
    needsReview.slice(0, 5).forEach((n) =>
      console.log(`   - ${n.originalTitle} | date=${n.originalPublishedAt}`)
    );
  }

  // ยืนยันผลลัพธ์สุดท้ายไม่มี URL ซ้ำ
  line();
  const urlSeen = new Set();
  let dupInResult = 0;
  for (const it of items) {
    const key = (it.sourceUrl || "").toLowerCase();
    if (!key) continue;
    if (urlSeen.has(key)) dupInResult++;
    else urlSeen.add(key);
  }
  console.log(
    `\n✅ ยืนยันผลลัพธ์สุดท้าย: ${items.length} รายการ | URL ซ้ำในผลลัพธ์: ${dupInResult}`
  );
  if (dupInResult > 0) {
    console.log("   ❌ ยังมี URL ซ้ำ — ต้องแก้!");
  } else {
    console.log("   ✅ ไม่มี URL ซ้ำ — ผ่าน");
  }

  line();
  console.log(`\n📰 รายการข่าวที่ผ่านทุกขั้นตอน (${items.length} รายการ)\n`);
  items.slice(0, 30).forEach((it, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. [${it.section.padEnd(20)}] ${it.originalTitle}`
    );
    console.log(
      `     ${it.originalPublishedAt} | ${it.source} | topics: ${it.topics.join(",") || "-"}`
    );
    console.log(`     ${it.sourceUrl}`);
  });
  if (items.length > 30) console.log(`   … และอีก ${items.length - 30} รายการ`);

  // เปิดเนื้อหาเต็ม N บทความ
  if (args.open > 0) {
    line();
    const toOpen = items.slice(0, args.open);
    console.log(`\n📄 เปิดเนื้อหาเต็ม ${toOpen.length} บทความ...\n`);
    const { results, errors } = await fetchArticles(toOpen);
    results.forEach((n, i) => {
      line("·");
      console.log(`[${i + 1}] ${n.originalTitle}`);
      console.log(
        `    author=${n.originalAuthor || "-"} | len=${n.originalContent.length} chars | hash=${n.duplicateHash}`
      );
      console.log(`    ${n.originalContent.slice(0, 150).replace(/\n/g, " ")} …`);
    });
    if (errors.length) {
      console.log(`\n⚠️  บทความที่ล้มเหลว: ${errors.length}`);
      errors.forEach((e) =>
        console.log(`    - ${e.error.message} (${e.item.sourceUrl})`)
      );
    }
    return;
  }

  if (args.sectionsOnly) return;

  console.log(
    `\nℹ️  เคล็ด: เรียก --open 2 เพื่อทดสอบเปิดเนื้อหาเต็ม 2 บทความ`
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const t0 = Date.now();
  try {
    if (args.article) {
      await runSingleArticle(args.article);
    } else {
      await runList(args);
    }
    console.log(`\n⏱  ใช้เวลา ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log("\n✅ ทดสอบเสร็จสิ้น");
  } catch (err) {
    if (err instanceof StructureError) {
      console.error(`\n🛑 StructureError: ${err.message}`);
      console.error(
        "   ระบบหยุดปลอดภัย — กรุณาตรวจโครงสร้าง Kitco และอัปเดต scraper"
      );
    } else {
      console.error(`\n❌ ล้มเหลว: ${err.message}`);
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}

main();
