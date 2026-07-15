/* ============================================================
   CLI — verify-news (Phase 8)
   ------------------------------------------------------------
   ตรวจสอบ 3 ข่าวล่าสุดที่ scraper ดึงจาก Kitco
   ------------------------------------------------------------
   คำสั่ง:  npm run scrape:verify

   ขอบเขตของคำสั่งนี้ (AUTOMATED เท่านั้น):
   1. ดึง digest สดจาก Kitco ผ่าน fetchDigest (เป็นข้อมูลที่ scraper
      ดึงมาเอง — ไม่ใช่แหล่งอิสระแยกจาก scraper)
   2. เลือก 3 ข่าวล่าสุดตาม sourcePublishedAt ผ่าน selectTopNews
   3. แสดง title / sourceUrl / sourcePublishedAt (UTC) / Bangkok time
      รายรายการทีละข่าว
   4. AUTOMATED CHECKS (ตรวจภายในข้อมูลที่ดึงมา):
      A) ได้ครบ 3 ข่าว
      B) ทุกข่าวมี title + sourceUrl + sourcePublishedAt ครบ
      C) ไม่มี sourceUrl ซ้ำกัน
      D) sourcePublishedAt เรียงใหม่ → เก่า ถูกต้อง

   สิ่งที่คำสั่งนี้ตรวจไม่ได้ (ต้องทำ MANUAL VERIFICATION แยก):
   - การเทียบ title/URL/time กับหน้า Kitco Digest/Latest News จริง
     (ต้องเปิดเบราว์เซอร์ดูด้วยตา หรือบันทึกหลักฐานแยก)
   - คำสั่งนี้ใช้ข้อมูลที่ scraper ดึงมาเอง จึงไม่สามารถยืนยันได้ว่า
     scraper อ่าน field ถูกต้องเทียบกับแหล่งอิสระ — ต้องตรวจด้วยมือ

   กฎ:
   - ห้ามเรียก OpenAI หรือ Pexels (ไม่ใช้ AI/image API)
   - ห้ามเดาเวลา — ใช้เฉพาะ sourcePublishedAt ที่อ่านจาก Kitco จริง
   - ถ้า AUTOMATED CHECKS ไม่ผ่าน → รายงาน FAIL พร้อมสาเหตุรายข่าว
   - ถ้า AUTOMATED CHECKS ผ่าน → รายงาน PASS (automated) และเตือนให้
     ทำ MANUAL VERIFICATION กับหน้า Kitco จริงก่อนรายงานสำเร็จเต็ม
   ============================================================ */

import { fetchDigest, selectTopNews, StructureError } from "../scraper/kitco.scraper.js";
import { toBangkokString } from "../utils/date.js";

const VERIFY_COUNT = 3;

function line(c = "─", n = 72) {
  console.log(c.repeat(n));
}

function pad(label, width = 20) {
  return label.padEnd(width);
}

function showItem(rank, item) {
  const utc = item.sourcePublishedAt || "(ไม่มี)";
  const bkk = item.sourcePublishedAt
    ? toBangkokString(item.sourcePublishedAt, { prefix: "" })
    : "(ไม่มี)";
  console.log(`#${rank}`);
  console.log(`  ${pad("title:")}            ${item.originalTitle || "(ว่าง)"}`);
  console.log(`  ${pad("sourceUrl:")}        ${item.sourceUrl || "(ว่าง)"}`);
  console.log(`  ${pad("sourcePublishedAt:")} ${utc} (UTC)`);
  console.log(`  ${pad("Bangkok time:")}     ${bkk}`);
}

async function main() {
  console.log("🔍 verify-news: ตรวจสอบ 3 ข่าวล่าสุดที่ scraper ดึงจาก Kitco\n");
  console.log("   หมายเหตุ: คำสั่งนี้ตรวจข้อมูลที่ scraper ดึงมาเอง (AUTOMATED)");
  console.log("           การเทียบกับหน้า Kitco จริงต้องทำ MANUAL VERIFICATION แยก\n");
  line("═");
  console.log("ขั้นตอนที่ 1: ดึง digest สดจาก Kitco (ผ่าน scraper)...");
  const t0 = Date.now();
  const digest = await fetchDigest();
  console.log(
    `  ได้ ${digest.items.length} ข่าว (หลัง filter + dedupe ข้าม section) ` +
      `ใน ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  console.log(`  ข่าวที่อ่านวันที่ไม่ได้ (needsReview): ${digest.needsReview.length}`);

  console.log("\nขั้นตอนที่ 2: เลือก 3 ข่าวล่าสุดตาม sourcePublishedAt...");
  const { latest, needsReview } = selectTopNews(digest.items, VERIFY_COUNT);
  console.log(`  latest: ${latest.length}, needsReview: ${needsReview.length}`);

  console.log("\nขั้นตอนที่ 3: แสดง 3 ข่าวล่าสุดรายรายการ (เพื่อ MANUAL VERIFICATION)");
  line();
  console.log(`\n=== 3 ข่าวล่าสุดที่ scraper ดึงได้ ===\n`);
  latest.forEach((item, i) => {
    showItem(i + 1, item);
    if (i < latest.length - 1) console.log("");
  });

  // ---------- AUTOMATED CHECKS ----------
  console.log("\n");
  line();
  console.log("ขั้นตอนที่ 4: AUTOMATED CHECKS (ตรวจภายในข้อมูลที่ดึงมา)\n");

  const failures = [];

  // ตรวจ A: ต้องได้ครบ 3 ข่าว
  if (latest.length < VERIFY_COUNT) {
    failures.push(
      `จำนวนข่าวไม่ครบ: ได้ ${latest.length} แต่ต้องการ ${VERIFY_COUNT}`
    );
  }

  // ตรวจ B: ทุกข่าวต้องมี title + sourceUrl + sourcePublishedAt
  latest.forEach((item, i) => {
    const rank = i + 1;
    if (!item.originalTitle) {
      failures.push(`#${rank}: ไม่มี title`);
    }
    if (!item.sourceUrl) {
      failures.push(`#${rank}: ไม่มี sourceUrl`);
    }
    if (!item.sourcePublishedAt) {
      failures.push(`#${rank}: ไม่มี sourcePublishedAt`);
    }
  });

  // ตรวจ C: ไม่มี sourceUrl ซ้ำกัน
  const urlSeen = new Set();
  latest.forEach((item, i) => {
    const key = (item.sourceUrl || "").toLowerCase();
    if (key) {
      if (urlSeen.has(key)) {
        failures.push(`#${i + 1}: sourceUrl ซ้ำกับข่าวอื่น (${key})`);
      }
      urlSeen.add(key);
    }
  });

  // ตรวจ D: sourcePublishedAt เรียงใหม่ → เก่า ถูกต้อง
  for (let i = 1; i < latest.length; i++) {
    const prev = new Date(latest[i - 1].sourcePublishedAt).getTime();
    const curr = new Date(latest[i].sourcePublishedAt).getTime();
    if (Number.isFinite(prev) && Number.isFinite(curr) && curr > prev) {
      failures.push(
        `ลำดับผิด: #${i + 1} (${latest[i].sourcePublishedAt}) ` +
          `ใหม่กว่า #${i} (${latest[i - 1].sourcePublishedAt})`
      );
    }
  }

  // ---------- สรุปผล ----------
  line("═");
  if (failures.length === 0) {
    console.log(
      "\n✅ PASS (AUTOMATED) — 3 ข่าวมี title/sourceUrl/sourcePublishedAt ครบ " +
        "และเรียงใหม่→เก่าถูกต้อง\n"
    );
    console.log("⚠️  ยังไม่ถือว่าสำเร็จเต็ม — ต้องทำ MANUAL VERIFICATION ต่อ:");
    console.log("   เปิด https://www.kitco.com/news/digest เทียบกับผลข้างต้นด้วยตา:");
    console.log("     - title ของ 3 ข่าวแรกตรงกันไหม");
    console.log("     - URL ของ 3 ข่าวแรกตรงกันไหม");
    console.log("     - เวลาเผยแพร่ของ 3 ข่าวแรกตรงกันไหม");
    console.log("   หากไม่ตรง ห้ามรายงานว่าสำเร็จ ให้แสดงสาเหตุและแก้ scraper ต่อ\n");
    process.exitCode = 0;
  } else {
    console.log(`\n❌ FAIL (AUTOMATED) — พบ ${failures.length} ปัญหา:\n`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log("");
    console.log("⚠️  ห้ามรายงานว่าสำเร็จ — ตรวจสอบและแก้ scraper ต่อ\n");
    process.exitCode = 1;
  }

  console.log(`⏱  ใช้เวลารวม ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function run() {
  try {
    await main();
  } catch (err) {
    console.log("");
    if (err instanceof StructureError) {
      console.error(`🛑 FAIL — StructureError: ${err.message}`);
      console.error("   ระบบหยุดปลอดภัย — กรุณาตรวจโครงสร้าง Kitco และอัปเดต scraper");
    } else {
      console.error(`❌ FAIL — ${err.message}`);
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}

run();
