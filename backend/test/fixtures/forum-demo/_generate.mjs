// Generate safe demo fixture files for Forum testing.
// Outputs: PNG (minimal valid), PDF (text), ZIP (text-only), TXT
// All files are small, contain DEMO ONLY content, no executables.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));

// ---------- helpers ----------
function crc32buf(buf) {
  // node:zlib.crc32 ต้องการ string|buffer; ensure Buffer
  return crc32(buf) >>> 0;
}
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

// minimal valid PNG (8×8 white-ish with no real text — text conveyed via filename + alt in DB)
function buildPng(width = 32, height = 16) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR
  const ihdrData = Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])]); // 8-bit RGB
  const ihdr = chunk("IHDR", ihdrData);
  // IDAT — raw RGB rows, filtered (filter byte 0 per row)
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      // simple gradient-ish fill (RGB) — visually distinct demo placeholder
      const off = y * (rowBytes + 1) + 1 + x * 3;
      raw[off] = 0xf0; // R
      raw[off + 1] = 0xc0; // G
      raw[off + 2] = 0x40; // B
    }
  }
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}
function chunk(type, data) {
  const len = u32(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = u32(crc32buf(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

// minimal valid PDF with one page of text
function buildPdf(text) {
  const lines = [];
  const offsets = [];
  let pos = 0;
  function push(s) { lines.push(s); pos += Buffer.byteLength(s, "latin1"); }
  function offset() { return pos; }
  push("%PDF-1.4\n");
  // object 1: catalog
  offsets[1] = offset();
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  // object 2: pages
  offsets[2] = offset();
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  // object 3: page
  offsets[3] = offset();
  push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n");
  // object 4: content stream
  const escText = String(text).replace(/([()\\])/g, "\\$1").slice(0, 800);
  const content = `BT /F1 11 Tf 72 720 Td (${escText}) Tj ET`;
  offsets[4] = offset();
  push(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  // object 5: font
  offsets[5] = offset();
  push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  // xref
  const xrefStart = offset();
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++) {
    push(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.from(lines.join(""), "latin1");
}

// minimal valid ZIP containing one text file (no executable)
function buildZip(innerName, innerText) {
  const nameBuf = Buffer.from(innerName, "utf8");
  const content = Buffer.from(innerText, "utf8");
  const compressed = deflateSync(content);
  const crc = crc32buf(content);

  // local file header
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20), // version needed
    u16(0),  // flags
    u16(8),  // compression: deflate
    u16(0), u16(0), // mod time, date
    u32(crc),
    u32(compressed.length),
    u32(content.length),
    u16(nameBuf.length),
    u16(0),
    nameBuf,
    compressed,
  ]);

  const central = Buffer.concat([
    u32(0x02014b50),
    u16(20), u16(20),
    u16(0), u16(8),
    u16(0), u16(0),
    u32(crc),
    u32(compressed.length),
    u32(content.length),
    u16(nameBuf.length),
    u16(0), u16(0), u16(0), u16(0),
    u32(0),
    u32(0), // local header offset
    nameBuf,
  ]);

  const endRecord = Buffer.concat([
    u32(0x06054b50),
    u16(0), u16(0),
    u16(1), u16(1),
    u32(central.length),
    u32(local.length),
    u16(0),
  ]);
  return Buffer.concat([local, central, endRecord]);
}

// ---------- generate ----------
const note = "[DEMO ONLY — ข้อมูลสาธิตสำหรับทดสอบระบบ ไม่ใช่คำแนะนำการลงทุนจริง]";

mkdirSync(here, { recursive: true });

// 1. PDF — demo EA notes (using PDF instead of TXT because .txt is not in
//    forum upload whitelist; keeping fixtures within allowed extensions)
writeFileSync(
  resolve(here, "demo-ea-notes.pdf"),
  buildPdf(`Demo EA Notes (DEMO ONLY). ${note}. แนวคิด EA ทดลองเพื่อศึกษา logic เท่านั้น — ไม่ใช่โค้ดพร้อมใช้ ไม่ใช่ executable`)
);

// 2. PNG — small placeholder
writeFileSync(resolve(here, "demo-indicator-preview.png"), buildPng(32, 16));

// 3. PDF — checklist
writeFileSync(
  resolve(here, "demo-trading-checklist.pdf"),
  buildPdf(`Demo Trading Checklist (DEMO ONLY). ${note}. 1) ตรวจสภาพตลาด 2) กำหนด risk 3) วางแผน exit. ไม่ใช่คำแนะนำจริง`)
);

// 4. PDF — broker questions
writeFileSync(
  resolve(here, "demo-broker-questions.pdf"),
  buildPdf(`Demo Broker Questions (DEMO ONLY). ${note}. ตัวอย่างคำถาม: license? spread? ฝากขั้นต่ำ? ไม่ใช่ข้อเสนอจริง`)
);

// 5. ZIP — text-only inner
writeFileSync(
  resolve(here, "demo-template.zip"),
  buildZip(
    "demo-template.txt",
    `Demo Template (DEMO ONLY)\n${note}\n\nเนื้อหาภายใน zip เป็นไฟล์ข้อความสาธิตเท่านั้น ไม่มี executable\n`
  )
);

console.log("fixtures generated in", here);
console.log("files:", [
  "demo-ea-notes.pdf",
  "demo-indicator-preview.png",
  "demo-trading-checklist.pdf",
  "demo-broker-questions.pdf",
  "demo-template.zip",
].join(", "));
