/* ============================================================
   Service Layer — EA Hub Service
   ------------------------------------------------------------
   ดึงรายการ EA จาก public Content API + ส่ง EA ใหม่ผ่าน public
   submission endpoint (Phase 16)

   Contract (Frontend ↔ Backend):
     PUBLIC (ไม่ต้อง auth):
       GET  /api/content/ea                 → { items, total, limit, offset }
       GET  /api/content/ea/:slug           → EAProduct
       POST /api/ea/submissions             multipart/form-data
         fields: name, description, platform, version, strategy?,
                 contactName?, contactEmail?
         files:  ea (required), cover (optional)
         → 201 { ok, id, status: "pending_review" }
         → 400/403/413/429 (validation/origin/size/rate-limit)
     ADMIN (auth + cookie path=/api/admin):
       GET  /api/admin/content/ea           list all statuses
       POST /api/admin/content/ea/:id/publish   publish gate

   กฎ QC:
   - public submit ไม่ส่ง status/published/price/downloadUrl
     (server บังคับ status=pending_review, price=0/free)
   - แสดง error จริงเมื่อ API ล้มเหลว — ห้าม mock success
   ============================================================ */

window.TT = window.TT || {};

TT.EAService = (function () {
  const API_BASE =
    (typeof TT !== "undefined" && TT.apiBase) || "/api";

  const ENDPOINT_LIST = `${API_BASE}/content/ea`;
  const ENDPOINT_DETAIL = (slug) =>
    `${API_BASE}/content/ea/${encodeURIComponent(slug)}`;
  // Phase 16 — public submission endpoint (ไม่ใช่ admin)
  const ENDPOINT_SUBMIT = `${API_BASE}/ea/submissions`;

  let listCache = null;

  /**
   * โหลดรายการ EA ที่ published จาก public Content API
   * @returns {Promise<EAProduct[]>}
   * @throws {Error} ถ้า fetch ไม่สำเร็จ / API ยังไม่พร้อม
   */
  async function fetchEAs({ force = false } = {}) {
    if (listCache && !force) return listCache.slice();

    const res = await fetch(ENDPOINT_LIST, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.products)
      ? data.products
      : [];

    listCache = normalizeAll(items);
    return listCache.slice();
  }

  function normalizeAll(items) {
    return items.map(normalizeOne);
  }

  function normalizeOne(ea) {
    if (!ea) return ea;
    // platform: backend ส่ง "mt4" | "mt5" | "both" → array สำหรับ UI
    let platforms;
    if (Array.isArray(ea.platform)) {
      platforms = ea.platform;
    } else {
      const p = String(ea.platform || "").toLowerCase();
      if (p === "both") platforms = ["MT4", "MT5"];
      else if (p === "mt4") platforms = ["MT4"];
      else if (p === "mt5") platforms = ["MT5"];
      else if (p) platforms = [ea.platform];
      else platforms = [];
    }

    const cover = resolveCover(ea.coverImage || ea.cover || ea.image);
    const priceNum = Number(ea.price);
    const type =
      ea.type || (!isNaN(priceNum) && priceNum > 0 ? "paid" : "free");

    return {
      ...ea,
      platforms,
      platform: platforms,
      cover,
      image: cover,
      type,
      isFree: type === "free" || (!isNaN(priceNum) && priceNum === 0),
      price: isNaN(priceNum) ? 0 : priceNum,
    };
  }

  function resolveCover(relPath) {
    if (!relPath) return "";
    if (/^(https?:)?\/\//i.test(relPath) || /^data:/i.test(relPath)) {
      return relPath;
    }
    const root = API_BASE.replace(/\/api\/?$/, "");
    const clean = relPath.replace(/^\/+/, "");
    return `${root}/${clean}`;
  }

  async function getBySlug(slug) {
    if (!slug) return null;
    if (listCache) {
      const found = listCache.find(
        (e) => e.slug === slug || String(e.id) === String(slug)
      );
      if (found) return found;
    }
    try {
      const res = await fetch(ENDPOINT_DETAIL(slug), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return normalizeOne(data);
    } catch (e) {
      return null;
    }
  }

  /**
   * ตรวจข้อมูลฝั่ง browser ก่อนส่ง
   * NOTE: public submit ไม่มี price/status — server บังคับ price=0, status=pending_review
   */
  function validateSubmission(payload) {
    const errors = [];

    if (!payload.name || !payload.name.trim()) {
      errors.push("กรุณากรอกชื่อ EA");
    } else if (payload.name.trim().length < 3) {
      errors.push("ชื่อ EA ต้องมีอย่างน้อย 3 ตัวอักษร");
    } else if (payload.name.trim().length > 200) {
      errors.push("ชื่อ EA ต้องไม่เกิน 200 ตัวอักษร");
    }

    if (!payload.description || payload.description.trim().length < 20) {
      errors.push("คำอธิบายต้องมีอย่างน้อย 20 ตัวอักษร");
    } else if (payload.description.trim().length > 8000) {
      errors.push("คำอธิบายต้องไม่เกิน 8000 ตัวอักษร");
    }

    const validPlatforms = ["MT4", "MT5"];
    if (!validPlatforms.includes(payload.platform)) {
      errors.push("กรุณาเลือกแพลตฟอร์ม (MT4 หรือ MT5)");
    }

    if (!payload.version || !String(payload.version).trim()) {
      errors.push("กรุณากรอกเวอร์ชัน");
    } else if (String(payload.version).trim().length > 60) {
      errors.push("เวอร์ชันต้องไม่เกิน 60 ตัวอักษร");
    }

    if (payload.strategy && String(payload.strategy).trim().length > 200) {
      errors.push("ประเภทกลยุทธ์ต้องไม่เกิน 200 ตัวอักษร");
    }

    // รูปปก — ถ้ามี ต้องเป็นไฟล์รูป
    if (payload.coverFile) {
      if (!/^image\/(png|jpe?g|webp)$/i.test(payload.coverFile.type)) {
        errors.push("รูปปกต้องเป็นไฟล์ PNG, JPG หรือ WEBP");
      } else if (payload.coverFile.size > 10 * 1024 * 1024) {
        errors.push("ขนาดรูปปกต้องไม่เกิน 10MB");
      }
    }

    // ไฟล์ EA — บังคับ (backend whitelist: ex4, ex5, set, zip)
    if (!payload.eaFile) {
      errors.push("กรุณาแนบไฟล์ EA (.ex4 / .ex5 / .set / .zip)");
    } else {
      const okExt = /\.(ex4|ex5|set|zip)$/i.test(payload.eaFile.name || "");
      if (!okExt) {
        errors.push(
          "ไฟล์ EA ต้องเป็น .ex4 .ex5 .set หรือ .zip เท่านั้น"
        );
      } else if (payload.eaFile.size > 50 * 1024 * 1024) {
        errors.push("ขนาดไฟล์ EA ต้องไม่เกิน 50MB");
      }
    }

    // อีเมล — ถ้ากรอก ต้องถูก format
    if (payload.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contactEmail)) {
      errors.push("รูปแบบอีเมลไม่ถูกต้อง");
    }

    return { ok: errors.length === 0, errors };
  }

  /**
   * ส่ง EA submission ผ่าน public endpoint (multipart/form-data)
   * ไม่ส่ง status/published/price/downloadUrl — server บังคับทั้งหมด
   * @throws {Error} เมื่อ validation ไม่ผ่าน หรือ API ล้มเหลว
   */
  async function submitEA(payload, onProgress) {
    // 1) client-side validation ก่อน
    const check = validateSubmission(payload);
    if (!check.ok) {
      const err = new Error("validation_failed");
      err.code = "validation_failed";
      err.errors = check.errors;
      throw err;
    }

    // 2) build multipart form — ส่งเฉพาะ field ที่ public endpoint รับ
    const form = new FormData();
    form.append("name", payload.name.trim());
    form.append("description", payload.description.trim());
    form.append("platform", payload.platform.toLowerCase()); // mt4 | mt5
    form.append("version", String(payload.version).trim());
    if (payload.strategy) form.append("strategy", payload.strategy.trim());
    if (payload.contactName) form.append("contactName", payload.contactName.trim());
    if (payload.contactEmail) form.append("contactEmail", payload.contactEmail.trim());

    if (payload.coverFile) form.append("cover", payload.coverFile);
    if (payload.eaFile) form.append("ea", payload.eaFile);

    // 3) ส่งจริงผ่าน XHR (รองรับ upload progress)
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", ENDPOINT_SUBMIT, true);
      xhr.setRequestHeader("Accept", "application/json");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && typeof onProgress === "function") {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        let body = null;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (_) {
          body = null;
        }

        // success — server คืน { ok, id, status: "pending_review" }
        if (xhr.status >= 200 && xhr.status < 300) {
          if (!body || body.ok !== true) {
            // contract violation — แสดง error จริง ไม่ fake success
            const err = new Error("invalid_response");
            err.code = "invalid_response";
            err.status = xhr.status;
            err.body = body;
            return reject(err);
          }
          // invalidate cache เพื่อให้รายการ refresh หลัง admin publish
          listCache = null;
          return resolve({
            ok: true,
            id: body.id || null,
            slug: body.slug || null,
            status: body.status || "pending_review",
          });
        }

        // ล้มเหลว — map error code → human message (ไม่ mock success)
        const retryAfter = xhr.getResponseHeader("retry-after");
        const err = new Error("submit_failed");
        err.code = (body && body.error) || "submit_failed";
        err.status = xhr.status;
        err.retryAfter = retryAfter ? parseInt(retryAfter, 10) : null;
        err.serverError = mapServerError(xhr.status, body, retryAfter);
        reject(err);
      };

      xhr.onerror = () => {
        const err = new Error("network_error");
        err.code = "network_error";
        err.serverError =
          "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต";
        reject(err);
      };

      xhr.ontimeout = () => {
        const err = new Error("timeout");
        err.code = "timeout";
        err.serverError = "หมดเวลารอการตอบกลับจากเซิร์ฟเวอร์";
        reject(err);
      };

      xhr.timeout = 120_000;
      xhr.send(form);
    });
  }

  /** map HTTP status + body → ข้อความภาษาไทยที่เข้าใจง่าย */
  function mapServerError(status, body, retryAfter) {
    const code = body && body.error;
    // specific error codes จาก backend
    if (code === "validation_failed" && body.details) {
      return "ข้อมูลไม่ถูกต้อง: " + body.details.join(", ");
    }
    if (code === "rate_limited") {
      const sec = retryAfter ? ` กรุณารอ ${retryAfter} วินาที` : "";
      return "ส่งบ่อยเกินไป —" + sec + " แล้วลองอีกครั้ง";
    }
    if (code === "origin_not_allowed") {
      return "คำขอถูกปฏิเสธด้วยเหตุผลด้านความปลอดภัย (origin)";
    }
    if (code === "ea_file_required") {
      return "กรุณาแนบไฟล์ EA";
    }
    if (code === "extension_not_allowed") {
      return "นามสกุลไฟล์ไม่ได้รับอนุญาต — อนุญาตเฉพาะ .ex4 .ex5 .set .zip";
    }
    if (code === "file_too_large") {
      return "ไฟล์ใหญ่เกินขนาดที่กำหนด";
    }
    if (code === "magic_bytes_mismatch") {
      return "ไฟล์ไม่ตรงกับลายเซ็นดิจิทัลของนามสกุล — อาจเป็นไฟล์ปลอม";
    }
    if (code === "upload_failed" || code === "upload_parse_failed") {
      return (body && body.message) || "การอัปโหลดล้มเหลว";
    }
    // generic HTTP status fallback
    if (status === 0) return "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้";
    if (status === 400) return "ข้อมูลที่ส่งไม่ถูกต้อง";
    if (status === 403) return "คำขอถูกปฏิเสธ";
    if (status === 404) return "ยังไม่พบบริการรับ EA ในขณะนี้";
    if (status === 413) return "ไฟล์ใหญ่เกินขนาดที่กำหนด";
    if (status === 429) return "ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
    if (status >= 500) return "เซิร์ฟเวอร์ขัดข้อง กรุณาลองใหม่ภายหลัง";
    return `เซิร์ฟเวอร์ตอบกลับด้วยสถานะ ${status}`;
  }

  function clearCache() {
    listCache = null;
  }

  return {
    fetchEAs,
    getBySlug,
    submitEA,
    validateSubmission,
    clearCache,
    normalizeOne,
    isLive: true,
    endpoints: { list: ENDPOINT_LIST, submit: ENDPOINT_SUBMIT },
  };
})();
