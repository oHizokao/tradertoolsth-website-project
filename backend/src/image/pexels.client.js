/* ============================================================
   Pexels Client — ค้นหารูปภาพจาก Pexels API
   ------------------------------------------------------------
   คุณสมบัติ:
   - ใช้ native fetch (Node 20+) — ไม่เพิ่ม dependency
   - PEXELS_API_KEY จาก config.pexels.apiKey
   - timeout + retry + exponential backoff
   - Rate limit: Pexels free = 200 req/hr → delay ระหว่าง keyword
   - Mock/fallback เมื่อไม่มี API key (ห้าม crash)
   - ห้าม log API key เด็ดขาด (ใช้ Authorization header แบบตรง)
   - ค้นหาเฉพาะรูปแนวนอน orientation=landscape
   - ไม่ดาวน์โหลดหรือเก็บไฟล์รูป — เก็บเฉพาะ URL + metadata
   ============================================================ */

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { rateLimiter } from "./rateLimiter.js";

const log = logger.make("pexels");

const PEXELS_API_BASE = "https://api.pexels.com/v1";

// รูป fallback สำหรับใช้เมื่อค้นหาไม่ได้ (license: Pexels License)
export const FALLBACK_IMAGE = Object.freeze({
  imageUrl: "",
  imageSource: "Pexels",
  imageAuthor: "",
  imageAuthorUrl: "https://www.pexels.com",
  imageLicense: "Pexels License",
  imageSourceUrl: "https://www.pexels.com",
  imageSearchKeywords: [],
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * แปลง Pexels photo object → image metadata ที่ต้องการ
 * ไม่ดาวน์โหลดหรือเก็บไฟล์ — เก็บเฉพาะ URL + metadata
 *
 * @param {object} photo Pexels photo object
 * @param {string[]} searchKeywords คำที่ใช้ค้นหา (เก็บ reference)
 * @returns {object} metadata ครบทุก field
 */
export function mapPhotoToMetadata(photo, searchKeywords = []) {
  if (!photo) return { ...FALLBACK_IMAGE, imageSearchKeywords: searchKeywords };

  // เลือก URL ขนาดใหญ่ที่สุดที่ Pexels ให้ (landscape)
  const src = photo.src || {};
  const imageUrl =
    src.large2x || src.large || src.medium || src.original || "";

  return {
    imageUrl,
    imageSource: "Pexels",
    imageAuthor: photo.photographer || "",
    imageAuthorUrl: photo.photographer_url || "https://www.pexels.com",
    imageLicense: "Pexels License",
    imageSourceUrl: photo.url || "https://www.pexels.com",
    imageSearchKeywords: searchKeywords,
  };
}

/**
 * ค้นหารูปภาพจาก Pexels API
 *
 * @param {string} query คำค้นหา
 * @param {object} opts
 *   - perPage: จำนวนรูปต่อหน้า (default 15)
 *   - timeoutMs: timeout ต่อ request
 *   - retries: จำนวน retry
 *   - _mockPhotos: inject mock สำหรับ test (array หรือ null = throw)
 * @returns {Promise<object[]>} รายการ photo objects จาก Pexels
 * @throws {Error} เมื่อ API ล้มเหลวทุก retry
 */
export async function searchPhotos(query, opts = {}) {
  const apiKey = config.pexels.apiKey;
  const timeoutMs = opts.timeoutMs ?? config.pexels.timeoutMs ?? 15000;
  const retries = opts.retries ?? config.pexels.retries ?? 2;
  const perPage = opts.perPage ?? 15;

  // ---- DI hook สำหรับ test ----
  if (opts._mockPhotos !== undefined) {
    if (opts._mockPhotos === null) {
      throw new Error("_test_injected_pexels_failure");
    }
    log.debug(`searchPhotos mock: query="${query}" photos=${opts._mockPhotos.length}`);
    return opts._mockPhotos;
  }

  // ---- ไม่มี API key → mock fallback ----
  if (!apiKey) {
    log.warn("ไม่พบ PEXELS_API_KEY — คืนรายการรูปว่าง (ใช้ fallback)");
    return [];
  }

  // ---- ตรวจ global rate limit ก่อน request จริง ----
  // acquire() จะ throw ถ้าเกิน limit ให้ caller จัดการ
  rateLimiter.acquire();

  const url = new URL(`${PEXELS_API_BASE}/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", "landscape");

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // ไม่ log Authorization header (API key)
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: apiKey, // Pexels ใช้ key ตรง ไม่มี "Bearer"
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `Pexels HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`
        );
      }

      const data = await res.json();
      const photos = Array.isArray(data.photos) ? data.photos : [];
      log.debug(
        `searchPhotos OK: query="${query}" found=${photos.length} (attempt ${attempt + 1})`
      );
      return photos;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const aborted = err.name === "AbortError";
      log.warn(
        `Pexels search attempt ${attempt + 1}/${retries + 1} failed: ${err.message}` +
          (aborted ? " (timeout)" : "")
      );
      if (attempt < retries) {
        // exponential backoff: 1s, 2s, ...
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  // ล้มเหลวทุก retry
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Pexels search failed for query: "${query}"`);
}

// re-export สำหรับ test เข้าถึง singleton ได้
export { rateLimiter };
