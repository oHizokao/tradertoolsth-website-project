/* ============================================================
   Upload Service — อัปโหลดไฟล์ EA + รูปปกอย่างปลอดภัย
   ------------------------------------------------------------
   กฎ QC (security hardening):
   - อนุญาตเฉพาะนามสกุลที่กำหนด (whitelist + magic-bytes check)
   - ตรวจขนาดไฟล์ (max bytes)
   - เปลี่ยนชื่อไฟล์เป็น random hex + ext (กัน collision + path traversal)
   - ห้ามใช้ชื่อไฟล์ที่ user ส่งมา (rename เสมอ)
   - เขียนไปยัง dir ที่ resolve แบบ safe (อยู่ใต้ uploadsRoot เท่านั้น)
   - ตรวจ path traversal (.. หรือ absolute path)
   - ห้าม expose dir แบบ writable ผ่าน static (ทำใน api/server.js)
   - ไม่ใช้ mock upload หรือ fake success — เขียนไฟล์จริง
   ============================================================ */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, stat, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { logger } from "../utils/logger.js";

const log = logger.make("upload");

/** whitelist นามสกุลไฟล์ EA (case-insensitive) */
export const EA_ALLOWED_EXTENSIONS = Object.freeze(["ex4", "ex5", "set", "zip"]);
/** whitelist นามสกุลรูปปก */
export const IMAGE_ALLOWED_EXTENSIONS = Object.freeze([
  "png",
  "jpg",
  "jpeg",
  "webp",
]);

/** magic bytes สำหรับ validation (เช็คไฟล์จริง ไม่ใช่แค่นามสกุล) */
const MAGIC_BYTES = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff],
  jpeg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF
  // ex4/ex5 ไม่มี magic bytes ที่ stable → ข้ามการเช็คนี้ (ใช้ extension + size)
  // zip (PK..)
  zip: [0x50, 0x4b, 0x03, 0x04],
};

/** ขนาดสูงสุด (bytes) — default: EA 50MB, image 10MB */
export const EA_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * สร้าง upload service bound กับ uploadsRoot
 * @param {object} opts { uploadsRoot: absolute path ของ uploads dir }
 */
export function createUploadService(opts = {}) {
  const uploadsRoot = resolve(opts.uploadsRoot);

  /** ดึงนามสกุลไฟล์พร้อมจุด (lowercase, no leading dot) */
  function getExt(filename) {
    if (!filename || typeof filename !== "string") return "";
    const idx = filename.lastIndexOf(".");
    if (idx === -1 || idx === filename.length - 1) return "";
    return filename.slice(idx + 1).toLowerCase();
  }

  /** ตรวจ magic bytes (head ของ buffer) ว่าตรงกับ type หรือไม่ */
  function matchesMagicBytes(buf, type) {
    const magic = MAGIC_BYTES[type];
    if (!magic) return true; // ไม่มี rule → skip (เช่น ex4/ex5/set)
    if (!buf || buf.length < magic.length) return false;
    return magic.every((byte, i) => buf[i] === byte);
  }

  /** สุ่มชื่อไฟล์ใหม่ (hex + ext) */
  function makeSafeFilename(ext) {
    const rand = randomBytes(12).toString("hex");
    return `${rand}.${ext}`;
  }

  /**
   * resolve path ปลอดภัยใต้ uploadsRoot — ห้าม path traversal
   * @returns {string|null} absolute path ถ้าปลอดภัย, null ถ้าเป็น traversal
   */
  function safeResolve(subdir, filename) {
    // subdir ต้องเป็น relative, ไม่มี ..
    if (!subdir || typeof subdir !== "string") return null;
    if (/^[/\\]/.test(subdir)) return null; // ห้าม absolute
    if (/(^|[/\\])\.\.([/\\]|$)/.test(subdir)) return null; // ห้าม ..
    // filename ต้องไม่มี path separator
    if (!filename || typeof filename !== "string") return null;
    if (/[/\\]/.test(filename)) return null;
    if (/(^|[/\\])\.\.([/\\]|$)/.test(filename)) return null;
    const target = resolve(uploadsRoot, subdir, filename);
    // ตรวจอีกครั้งว่าอยู่ใต้ uploadsRoot
    if (target !== uploadsRoot && !target.startsWith(uploadsRoot + sep)) return null;
    return target;
  }

  /**
   * ตรวจไฟล์ที่จะอัปโหลด
   * @throws Error เมื่อไฟล์ไม่ผ่าน validation
   */
  function validateFile({ filename, size, allowedExtensions, maxBytes, kind }) {
    const ext = getExt(filename);
    if (!ext) {
      throw new UploadError("missing_extension", "ไฟล์ต้องมีนามสกุล");
    }
    if (!allowedExtensions.includes(ext)) {
      throw new UploadError(
        "extension_not_allowed",
        `นามสกุล .${ext} ไม่ได้รับอนุญาต`,
        { allowed: allowedExtensions }
      );
    }
    if (typeof size !== "number" || size <= 0) {
      throw new UploadError("invalid_size", "ขนาดไฟล์ไม่ถูกต้อง");
    }
    if (size > maxBytes) {
      throw new UploadError("file_too_large", `ไฟล์ใหญ่เกิน ${maxBytes} bytes`, {
        maxSize: maxBytes,
        size,
      });
    }
    return { ext, kind };
  }

  /**
   * อ่าน stream ไปยัง buffer พร้อมเช็คขนาด (limit ด้วย maxBytes)
   * - ถ้า stream ใหญ่เกิน maxBytes → reject ทันที (abort)
   * - return buffer + final size
   */
  async function streamToBuffer(source, maxBytes) {
    const chunks = [];
    let total = 0;
    const reader = source[Symbol.asyncIterator]
      ? source
      : Readable.from(source);
    for await (const chunk of reader) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new UploadError("file_too_large", `ไฟล์ใหญ่เกิน ${maxBytes} bytes`, {
          maxSize: maxBytes,
          size: total,
        });
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * เขียนไฟล์ไปยัง path ปลอดภัย (สร้าง dir ถ้ายังไม่มี)
   * - ใช้ atomic-ish write: เขียนไป temp ก่อน แล้ว move (เพื่อกันไฟล์ครึ่งๆ กลางๆ)
   *   แต่เพื่อความเรียบง่ายและไม่พึ่ง fs.rename ข้าม device — เขียนตรงๆ แต่ตรวจขนาดหลังเขียน
   */
  async function writeFileAtomic(targetPath, buffer) {
    await mkdir(resolve(targetPath, ".."), { recursive: true });
    await writeFile(targetPath, buffer);
    // ตรวจขนาดจริงหลังเขียน (defense in depth)
    const info = await stat(targetPath);
    if (info.size !== buffer.length) {
      throw new UploadError("write_size_mismatch", "เขียนไฟล์ไม่ครบ");
    }
    return info.size;
  }

  /**
   * อัปโหลดไฟล์ (EA หรือรูป)
   * @param {object} input
   *   - source: Readable stream หรือ Buffer หรือ async iterable
   *   - filename: ชื่อไฟล์ที่ user ส่งมา (จะถูกเปลี่ยนชื่อ)
   *   - declaredSize: ขนาดที่ declare (optional, จาก content-length)
   *   - kind: "ea" | "image"
   *   - subdir: subdir ใต้ uploadsRoot (default ตาม kind)
   * @returns {{ ok: true, path: string, filename: string, size: number, mime: string, ext: string }}
   */
  async function upload(input) {
    const { source, filename, kind } = input;
    const declaredSize = input.declaredSize;
    const subdir = input.subdir || (kind === "ea" ? "ea-files" : "images");

    const allowedExtensions =
      kind === "ea" ? EA_ALLOWED_EXTENSIONS : IMAGE_ALLOWED_EXTENSIONS;
    const maxBytes = kind === "ea" ? EA_MAX_BYTES : IMAGE_MAX_BYTES;

    // 1) pre-validate (extension + declared size)
    const { ext } = validateFile({
      filename,
      size: declaredSize || 1, // ถ้าไม่มี declared size ให้ข้าม size check ตรงนี้ (จะเช็คที่ buffer)
      allowedExtensions,
      maxBytes,
      kind,
    });

    // 2) read source → buffer พร้อม limit ขนาด
    const buffer = await streamToBuffer(source, maxBytes);
    const actualSize = buffer.length;

    // 3) re-validate size จริง
    if (actualSize > maxBytes) {
      throw new UploadError("file_too_large", `ไฟล์ใหญ่เกิน ${maxBytes} bytes`, {
        maxSize: maxBytes,
        size: actualSize,
      });
    }

    // 4) magic bytes check (image/zip เท่านั้น — ex4/ex5/set skip)
    if (!matchesMagicBytes(buffer, ext)) {
      throw new UploadError("magic_bytes_mismatch", `ไฟล์ .${ext} ไม่ตรง signature`);
    }

    // 5) generate safe filename + resolve path (ป้องกัน traversal)
    const safeName = makeSafeFilename(ext);
    const targetPath = safeResolve(subdir, safeName);
    if (!targetPath) {
      throw new UploadError("path_resolution_failed", "ไม่สามารถ resolve path ได้");
    }

    // 6) write file
    const writtenSize = await writeFileAtomic(targetPath, buffer);

    // 7) return relative path (ใต้ uploadsRoot) — ไม่คืน absolute
    const relPath = targetPath
      .slice(uploadsRoot.length)
      .replace(/^[\\/]+/, "")
      .replace(/\\/g, "/");
    const mime = guessMime(ext);

    log.info(`uploaded ${kind} ${relPath} (${writtenSize} bytes)`);

    return {
      ok: true,
      path: relPath,
      filename: safeName,
      size: writtenSize,
      mime,
      ext,
    };
  }

  /**
   * อัปโหลด EA file
   * @param {object} input { source, filename, declaredSize? }
   */
  async function uploadEa(input) {
    return upload({ ...input, kind: "ea" });
  }

  /**
   * อัปโหลดรูปปก
   * @param {object} input { source, filename, declaredSize? }
   */
  async function uploadImage(input) {
    return upload({ ...input, kind: "image" });
  }

  /** คืน absolute path ของไฟล์ relative (สำหรับ serve ผ่าน controlled handler) */
  function resolvePublicPath(relPath) {
    if (!relPath || typeof relPath !== "string") return null;
    // ห้าม path traversal
    if (/^[/\\]/.test(relPath) || /(^|[/\\])\.\.([/\\]|$)/.test(relPath)) return null;
    const target = resolve(uploadsRoot, relPath);
    if (target !== uploadsRoot && !target.startsWith(uploadsRoot + sep)) return null;
    return target;
  }

  /** ลบไฟล์ที่ service นี้สร้างไว้ โดยยอมรับเฉพาะ relative path ใต้ uploadsRoot */
  async function removeUpload(relPath) {
    const target = resolvePublicPath(relPath);
    if (!target) return false;
    try {
      await unlink(target);
      return true;
    } catch (err) {
      if (err && err.code === "ENOENT") return false;
      throw err;
    }
  }

  return {
    upload,
    uploadEa,
    uploadImage,
    removeUpload,
    resolvePublicPath,
    uploadsRoot,
    validateFile,
    EA_ALLOWED_EXTENSIONS,
    IMAGE_ALLOWED_EXTENSIONS,
    EA_MAX_BYTES,
    IMAGE_MAX_BYTES,
  };
}

/** คาดเดา MIME type จากนามสกุล */
function guessMime(ext) {
  const map = {
    ex4: "application/octet-stream",
    ex5: "application/octet-stream",
    set: "text/plain",
    zip: "application/zip",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return map[ext] || "application/octet-stream";
}

/** Error class สำหรับ upload validation errors (พร้อม code) */
export class UploadError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.extra = extra;
  }
}

/** คำนวณ SHA-256 ของ buffer (optional — สำหรับ integrity check ในอนาคต) */
export function sha256OfFile(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
