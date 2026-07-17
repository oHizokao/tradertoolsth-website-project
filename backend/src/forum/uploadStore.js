/* ============================================================
   Forum Upload Store — บันทึกไฟล์แนบอย่างปลอดภัย
   ------------------------------------------------------------
   กฎ QC:
   - path traversal defense: stored path ถูก resolve และตรวจว่าอยู่ใต้ uploadDir
   - ชื่อไฟล์ที่เก็บ (storedName) ถูก generate ใหม่ทั้งหมด (ไม่ใช้ชื่อผู้ใช้ส่ง)
   - ไม่ exec ไฟล์ — เสิร์ฟเป็น static เท่านั้น
   - subdirectory per year/month เพื่อกระจายไฟล์
   ============================================================ */

import { mkdir, writeFile, stat, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve, join, sep, dirname } from "node:path";
import { logger } from "../utils/logger.js";

const log = logger.make("forum-upload");

/**
 * สร้าง upload store bound กับ uploadDir (absolute path)
 * @param {object} opts { uploadDir (absolute), maxBytes, maxFiles }
 */
export function createUploadStore(opts = {}) {
  const uploadDir = resolve(opts.uploadDir);
  const maxBytes = Math.max(1, Number(opts.maxBytes || 5 * 1024 * 1024));
  const maxFiles = Math.max(1, Math.min(20, Number(opts.maxFiles || 4)));

  /**
   * บันทึก buffer ลงดิสก์อย่างปลอดภัย
   * @param {object} entry { buffer, ext (".png" ...), mime }
   * @returns {Promise<{ storedName, storedPath (relative), absolutePath, byteSize }>}
   */
  async function save({ buffer, ext, mime }) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error("invalid_buffer");
    }
    if (buffer.length > maxBytes) {
      const err = new Error("file_too_large");
      err.code = "file_too_large";
      throw err;
    }

    // generate storedName (ไม่ใช้ชื่อผู้ใช้ส่ง)
    const safeExt = String(ext || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
    const id = randomBytes(16).toString("hex");
    const storedName = `${id}${safeExt}`;

    // subdirectory: yyyy/mm (กระจายไฟล์ + กัน directory ใหญ่เกินไป)
    const now = new Date();
    const subDir = join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0")
    );
    const targetDir = resolve(uploadDir, subDir);

    // path traversal defense: หลัง resolve ต้องอยู่ใต้ uploadDir
    if (targetDir !== uploadDir && !targetDir.startsWith(uploadDir + sep)) {
      throw new Error("path_traversal_blocked");
    }

    await mkdir(targetDir, { recursive: true });
    const absolutePath = join(targetDir, storedName);
    // ตรวจอีกครั้งหลัง join
    if (absolutePath !== targetDir && !absolutePath.startsWith(targetDir + sep)) {
      throw new Error("path_traversal_blocked");
    }

    await writeFile(absolutePath, buffer, { mode: 0o644 });
    // storedPath เก็บเป็น relative (forward slash) เพื่อ portability
    const storedPath = `${subDir.split(sep).join("/")}/${storedName}`;

    log.debug(`saved ${buffer.length} bytes → ${storedPath}`);
    return {
      storedName,
      storedPath,
      absolutePath,
      byteSize: buffer.length,
    };
  }

  /**
   * resolve relative storedPath → absolute (safe) หรือ null ถ้า path traversal
   * ใช้สำหรับ static serve
   */
  function resolveSafe(relativePath) {
    if (!relativePath) return null;
    // ปฏิเสธ absolute path / drive / parent traversal ใน input
    const cleaned = String(relativePath).replace(/\\/g, "/");
    if (
      cleaned.startsWith("/") ||
      /^[a-zA-Z]:/.test(cleaned) ||
      cleaned.includes("..")
    ) {
      return null;
    }
    const abs = resolve(uploadDir, cleaned);
    if (abs !== uploadDir && !abs.startsWith(uploadDir + sep)) return null;
    return abs;
  }

  /** stat ไฟล์ (สำหรับ static serve) */
  async function statSafe(relativePath) {
    const abs = resolveSafe(relativePath);
    if (!abs) return null;
    try {
      const info = await stat(abs);
      if (!info.isFile()) return null;
      return { abs, size: info.size };
    } catch {
      return null;
    }
  }

  /** ลบไฟล์ที่บันทึกไว้เมื่อขั้นตอนบันทึก metadata ล้มเหลว */
  async function removeStored(relativePath) {
    const abs = resolveSafe(relativePath);
    if (!abs) return false;
    try {
      await unlink(abs);
      return true;
    } catch (err) {
      if (err?.code === "ENOENT") return false;
      throw err;
    }
  }

  return {
    save,
    removeStored,
    resolveSafe,
    statSafe,
    uploadDir,
    maxBytes,
    maxFiles,
  };
}
