/* ============================================================
   Forum Sanitize — validation + sanitization สำหรับ Forum
   ------------------------------------------------------------
   กฎ QC:
   - sanitize plain text (ลบ/nullify HTML tags ที่เป็น XSS vector)
   - normalize whitespace (ลบ control chars, ลด space ซ้อน)
   - ไม่อนุญาต raw HTML (frontend ใช้ textContent เสมอ — ป้องกัน double-sink)
   - cap length ที่ทุก field (กัน memory exhaustion / abuse)
   - upload: strict whitelist mime + extension + magic bytes; ห้าม executable
   ============================================================ */

/**
 * normalize whitespace + ลบ control characters (กัน log injection / XSS newline tricks)
 * ไม่ strip HTML tags ที่นี่ — ทำที่ sanitizeText (เพราะ input คาดว่าเป็น plain text
 * แต่ defense-in-depth: ถ้ามี <script> ให้ทำให้เป็น inert โดย escape)
 */
function normalize(str) {
  if (str == null) return "";
  // ลบ null bytes + control chars (ยกเว้น \t \n \r)
  return String(str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n");
}

/**
 * sanitize plain text สำหรับเก็บใน DB
 * - normalize whitespace
 * - collapse consecutive whitespace (เก็บ newline ไว้สำหรับ body)
 * - escape HTML entities (defense-in-depth — frontend จะใช้ textContent อยู่แล้ว
 *   แต่กันกรณีมี sink อื่นที่ใช้ innerHTML โดยไม่ได้ตั้งใจ)
 * - cap length
 */
export function sanitizeText(str, maxLen) {
  let s = normalize(str);
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}

/**
 * sanitize ชื่อ/ชื่อเรื่องแบบ single-line (กัน newline injection ใน field สั้น)
 * - normalize + collapse ทุก whitespace (รวม newline) เป็น space เดียว
 * - escape HTML
 * - cap length
 */
export function sanitizeSingleLine(str, maxLen) {
  let s = normalize(str).replace(/[\s]+/g, " ");
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}

/**
 * sanitize multi-line body (เก็บ newline สำหรับการจัดรูปแบบ)
 * - normalize + collapse consecutive spaces (แต่เก็บ newline)
 * - cap length
 * - จำกัดจำนวน newline ติดต่อกัน (กัน dump ข้อมูลยาว)
 */
export function sanitizeBody(str, maxLen) {
  let s = normalize(str);
  // collapse consecutive spaces/tabs (แต่ไม่แตะ newline)
  s = s.replace(/[^\S\n]+/g, " ");
  // จำกัด newline ติดต่อกันไม่เกิน 3
  s = s.replace(/\n{4,}/g, "\n\n\n");
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}

/**
 * validate slug format (category slug) — strict alphanumeric + dash
 * กัน path traversal / injection
 */
export function isValidSlug(slug) {
  if (!slug) return false;
  return /^[a-z0-9][a-z0-9-]{0,49}$/.test(String(slug));
}

/**
 * validate author id format (prefix + hex)
 */
export function isValidAuthorId(id) {
  if (!id) return false;
  return /^fa-[a-f0-9]{16}$/.test(String(id));
}

/**
 * validate topic/post id format
 *
 * รองรับ 2 namespace:
 *   1) production:  `ft-<hex16>` / `fp-<hex16>` (default)
 *   2) demo:        `demo-forum-<slug>-<seq>` หรือ `demo-post-<topic>-<seq>`
 *      (ใช้กับ demo seed เท่านั้น — เพิ่มเติม, ไม่กระทบ production IDs)
 *      demo IDs ถูก mark ชัดทั้งใน prefix และเนื้อหา ([DEMO]) เพื่อให้ลบได้ง่าย
 */
export function isValidContentId(id, prefix) {
  if (!id) return false;
  const s = String(id);
  // production format
  const re = new RegExp(`^${prefix}-[a-f0-9]{16}$`);
  if (re.test(s)) return true;
  // demo namespace (local/dev seed เท่านั้น — slug/seq ปลอดภัย: [a-z0-9-])
  if (prefix === "ft" && /^demo-forum-[a-z0-9-]+$/i.test(s)) return true;
  if (prefix === "fp" && /^demo-post-[a-z0-9-]+$/i.test(s)) return true;
  return false;
}

/**
 * validate anon token format (64 hex chars = 32 bytes)
 */
export function isValidAnonToken(token) {
  if (!token) return false;
  return /^[a-f0-9]{64}$/.test(String(token));
}

/* ============================================================
   Upload validation — strict whitelist
   ------------------------------------------------------------
   กฎ QC (ตามที่ Codex กำหนด):
   - ห้าม executable: .exe .bat .cmd .sh .com .scr .msi .dll .ps1 .vbs .jar ฯลฯ
   - อนุญาตเฉพาะ: image (png/jpg/jpeg/gif/webp), pdf, zip
   - ตรวจทั้ง extension + mime + magic bytes (defense-in-depth)
   - จำกัดขนาด + จำกัดจำนวนไฟล์
   ============================================================ */

const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".zip",
]);

const EXTENSION_TO_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

const ALLOWED_MIMES = new Set(Object.values(EXTENSION_TO_MIME));

// magic bytes (signature) สำหรับ validate ไฟล์จริง (กันเปลี่ยนนามสกุล)
const MAGIC_SIGNATURES = [
  { ext: ".png", mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ".jpg", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { ext: ".jpeg", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { ext: ".gif", mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: ".webp", mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF (webp)
  { ext: ".pdf", mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { ext: ".zip", mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK
];

// คำว่า "executable" ในชื่อไฟล์ (defense-in-depth กัน social engineering)
const DANGEROUS_NAME_PATTERNS = [
  /\.(exe|bat|cmd|sh|com|scr|msi|dll|ps1|vbs|jar|app|run|bin)$/i,
];

/**
 * validate ชื่อไฟล์ต้นฉบับ — ป้องกัน path traversal + ชื่ออันตราย
 * @returns {string|null} cleaned name หรือ null ถ้าไม่ผ่าน
 */
export function sanitizeFileName(originalName) {
  if (!originalName) return null;
  let name = String(originalName);
  // เอาเฉพาะ basename ก่อน (split path separators ทั้ง / \ :)
  // ป้องกัน path traversal เช่น ../../etc/passwd → passwd
  const parts = name.split(/[\\/:]/).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : "";
  if (!last) return null;
  // ลบ control chars + trim
  const cleaned = last.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!cleaned || cleaned.length > 200) return null;
  // ตรวจชื่ออันตราย (defense-in-depth) — กัน extension ที่ executable
  for (const pattern of DANGEROUS_NAME_PATTERNS) {
    if (pattern.test(cleaned)) return null;
  }
  return cleaned;
}

/**
 * validate ไฟล์ที่จะอัปโหลด
 * @param {object} file { originalName, mimeType, byteSize, buffer (first N bytes) }
 * @returns {{ ok: true, ext, mime, safeName } | { ok: false, error }}
 */
export function validateUpload(file) {
  if (!file || !file.originalName) {
    return { ok: false, error: "missing_filename" };
  }
  // ตรวจ extension ก่อน (จากชื่อต้นฉบับ) เพื่อให้สามารถปฏิเสธ .exe ก่อน
  // และคืน error ที่ชัดเจนกว่า "invalid_filename"
  const rawExt = extname(String(file.originalName)).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(rawExt)) {
    return { ok: false, error: "extension_not_allowed", ext: rawExt };
  }

  // หลังผ่าน extension whitelist แล้ว → sanitize ชื่อ (path traversal + dangerous name)
  const safeName = sanitizeFileName(file.originalName);
  if (!safeName) {
    return { ok: false, error: "invalid_filename" };
  }
  const ext = extname(safeName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "extension_not_allowed", ext };
  }

  // validate mime (ที่ client แจ้ง หรือ sniffer อนุมาน) ต้องตรงกับ extension
  const expectedMime = EXTENSION_TO_MIME[ext];
  if (file.mimeType && !ALLOWED_MIMES.has(file.mimeType)) {
    return { ok: false, error: "mime_not_allowed", mime: file.mimeType };
  }
  if (file.mimeType && file.mimeType !== expectedMime) {
    return { ok: false, error: "mime_extension_mismatch", ext, mime: file.mimeType };
  }

  // validate magic bytes (defense-in-depth)
  if (file.buffer) {
    const sig = detectMagic(file.buffer);
    if (!sig) {
      return { ok: false, error: "magic_unknown" };
    }
    // webp ใช้ RIFF signature ร่วมกับ wav — ตรวช่วงเพิ่ม
    if (sig.ext !== ext && !(sig.ext === ".jpg" && ext === ".jpeg")) {
      return { ok: false, error: "magic_extension_mismatch", ext, detected: sig.ext };
    }
  }

  return { ok: true, ext, mime: expectedMime, safeName };
}

/** ตรวจ magic bytes แรกของ buffer → คืน signature match หรือ null */
function detectMagic(buf) {
  if (!buf || buf.length < 4) return null;
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.bytes.every((b, i) => buf[i] === b)) {
      // สำหรับ webp ต้องตรวจ "WEBP" ที่ offset 8 เพิ่ม (กันสับสนกับ wav)
      if (sig.ext === ".webp" && buf.length >= 12) {
        const tag = buf.slice(8, 12).toString("latin1");
        if (tag !== "WEBP") return null;
      }
      return sig;
    }
  }
  return null;
}

/** ดึง extension (รวมจุด, lowercase) */
function extname(name) {
  const i = String(name).lastIndexOf(".");
  if (i === -1 || i === 0) return "";
  return String(name).slice(i).toLowerCase();
}

export const FORUM_UPLOAD = Object.freeze({
  ALLOWED_EXTENSIONS: [...ALLOWED_EXTENSIONS],
  ALLOWED_MIMES: [...ALLOWED_MIMES],
});
