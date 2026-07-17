/* ============================================================
   Multipart/form-data parser (RFC 2388 lite)
   ------------------------------------------------------------
   ใช้สำหรับอ่านไฟล์จาก HTTP request body
   port จาก contentApi.js (Phase 14) มาเป็น shared util เพื่อ reuse

   กฎ QC:
   - จำกัดขนาด body รวม (maxBytes)
   - แยก fields (text) vs file (binary buffer)
   - return เดียว file แรกที่เจอในแต่ละ fieldName
     (caller ส่ง fieldName ที่ต้องการมาแยกเอง)
   ============================================================ */

/** Error class สำหรับ multipart parse errors */
export class MultipartError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "MultipartError";
    this.code = code;
    this.extra = extra;
  }
}

/**
 * parse multipart/form-data จาก buffer + boundary
 * @returns {{ fields: object, files: Map<string, {filename, contentType, buffer, size}> }}
 */
export function parseMultipartBuffer(buffer, boundary) {
  const fields = {};
  const files = new Map();
  const delim = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(buffer, delim);

  for (const part of parts) {
    if (part.length === 0) continue;
    // ข้าม closing boundary (--boundary--)
    if (part.length <= 4 && part.toString("utf8").includes("--")) continue;

    // แยก header / body ด้วย \r\n\r\n
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString("utf8");
    const bodyBuf = part.slice(headerEnd + 4);
    // ตัด trailing \r\n
    const trimmedBody =
      bodyBuf.length >= 2 &&
      bodyBuf[bodyBuf.length - 2] === 0x0d &&
      bodyBuf[bodyBuf.length - 1] === 0x0a
        ? bodyBuf.slice(0, -2)
        : bodyBuf;

    const nameMatch = /name="([^"]+)"/i.exec(headerStr);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    const filenameMatch = /filename="([^"]*)"/i.exec(headerStr);
    const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(headerStr);

    if (filenameMatch) {
      // file part — เก็บเป็น Map (key = fieldName)
      // ถ้า fieldName ซ้ำ → เก็บไฟล์สุดท้าย (caller ควรส่ง fieldName ไม่ซ้ำ)
      files.set(fieldName, {
        fieldName,
        filename: filenameMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : "application/octet-stream",
        buffer: trimmedBody,
        size: trimmedBody.length,
      });
    } else {
      // text field — เก็บเป็น object (key = fieldName)
      fields[fieldName] = trimmedBody.toString("utf8");
    }
  }
  return { fields, files };
}

/**
 * อ่าน multipart request body ทั้งหมดเป็น buffer
 * @param {IncomingMessage} req
 * @param {number} maxBytes — limit รวมของ body
 * @returns {Promise<{ buffer: Buffer, boundary: string }>}
 * @throws {MultipartError} เมื่อ content-type ผิด / body ใหญ่เกิน
 */
export async function readMultipartRequest(req, maxBytes) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    throw new MultipartError(
      "invalid_content_type",
      "ต้องเป็น multipart/form-data"
    );
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes + 1024) {
      throw new MultipartError(
        "file_too_large",
        `request body ใหญ่เกิน ${maxBytes} bytes`,
        { maxSize: maxBytes }
      );
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return { buffer, boundary };
}

/** split buffer ด้วย delimiter (return ส่วนที่อยู่ระหว่าง delimiter) */
function splitBuffer(buf, delim) {
  const parts = [];
  let start = 0;
  let idx;
  while ((idx = buf.indexOf(delim, start)) !== -1) {
    if (start > 0) {
      // เอาส่วนหลัง delimiter ก่อนหน้านี้ (ข้าม \r\n นำหน้า)
      let chunkStart = start;
      if (
        chunkStart >= 2 &&
        buf[chunkStart] === 0x0d &&
        buf[chunkStart + 1] === 0x0a
      ) {
        chunkStart += 2;
      }
      parts.push(buf.slice(chunkStart, idx));
    }
    start = idx + delim.length;
  }
  // part สุดท้าย
  if (start < buf.length) {
    let chunkStart = start;
    if (
      chunkStart >= 2 &&
      buf[chunkStart] === 0x0d &&
      buf[chunkStart + 1] === 0x0a
    ) {
      chunkStart += 2;
    }
    parts.push(buf.slice(chunkStart));
  }
  return parts;
}
