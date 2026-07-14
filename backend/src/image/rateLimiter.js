/* ============================================================
   Rate Limiter — จำกัดจำนวน request ต่อช่วงเวลา (global/process level)
   ------------------------------------------------------------
   ใช้ Sliding Window algorithm:
   - เก็บ timestamp ของทุก request ที่ผ่านมาใน window ปัจจุบัน
   - ก่อน request ใหม่ → ตรวจว่าจำนวนใน window ยังไม่เกิน limit
   - ถ้าเกิน → throw error พร้อมบอกเวลาที่ต้องรอ

   Pexels free plan: 200 requests/hour (default)
   https://www.pexels.com/api/documentation/#ratelimiting

   ทำไมต้องมี global rate limiter (ไม่ใช่แค่ delay 500ms):
   - delay 500ms ระหว่าง keyword ≈ 7,200 req/hr ถ้ารันต่อเนื่อง
   - ในทางปฏิบัติอาจมีหลาย batch/session เรียกพร้อมกัน
   - global counter ป้องกัน limit breach ข้ามทุก call ใน process
   ============================================================ */

import { logger } from "../utils/logger.js";

const log = logger.make("rate-limiter");

class RateLimiter {
  /**
   * @param {number} maxRequests จำนวน request สูงสุดใน window
   * @param {number} windowMs ขนาด window (ms) — default 1 hour
   */
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    /** @type {number[]} timestamps ของ request ใน window ปัจจุบัน */
    this._timestamps = [];
    /** Injectable สำหรับ test — override ด้วย fake clock */
    this._nowFn = () => Date.now();
  }

  _now() {
    return this._nowFn();
  }

  /**
   * ลบ timestamps ที่หมดอายุออกจาก sliding window
   */
  _prune() {
    const cutoff = this._now() - this.windowMs;
    // เก็บเฉพาะ timestamps ที่ยังอยู่ใน window
    let i = 0;
    while (i < this._timestamps.length && this._timestamps[i] <= cutoff) {
      i++;
    }
    if (i > 0) this._timestamps.splice(0, i);
  }

  /**
   * จำนวน request ใน window ปัจจุบัน
   */
  getCount() {
    this._prune();
    return this._timestamps.length;
  }

  /**
   * จำนวน request ที่ยังเหลือใน window ปัจจุบัน
   */
  getRemaining() {
    this._prune();
    return Math.max(0, this.maxRequests - this._timestamps.length);
  }

  /**
   * ตรวจว่าสามารถส่ง request ได้โดยไม่เกิน limit
   */
  canAcquire() {
    this._prune();
    return this._timestamps.length < this.maxRequests;
  }

  /**
   * ขอ "slot" สำหรับ 1 request
   * ถ้าเกิน limit → throw Error พร้อมบอกเวลาที่ต้องรอ
   *
   * @throws {Error} PEXELS_RATE_LIMIT เมื่อเกิน limit
   */
  acquire() {
    this._prune();
    const count = this._timestamps.length;
    if (count >= this.maxRequests) {
      // คำนวณเวลาที่ต้องรอ (เมื่อ oldest timestamp หมดอายุ)
      const oldest = this._timestamps[0];
      const waitMs = Math.max(0, oldest + this.windowMs - this._now());
      const waitSec = Math.ceil(waitMs / 1000);
      throw new Error(
        `PEXELS_RATE_LIMIT: เกิน ${this.maxRequests} requests ` +
          `ใน ${Math.round(this.windowMs / 1000)}s window ` +
          `(ปัจจุบัน=${count}, รอ ~${waitSec}s หรือลด PEXELS_HTTP_RETRIES)`
      );
    }
    this._timestamps.push(this._now());
    log.debug(
      `rate-limit acquire: ${this._timestamps.length}/${this.maxRequests} ` +
        `(remaining=${this.maxRequests - this._timestamps.length})`
    );
  }

  /**
   * สถานะปัจจุบันของ rate limiter
   */
  getStats() {
    this._prune();
    return {
      count: this._timestamps.length,
      limit: this.maxRequests,
      windowMs: this.windowMs,
      remaining: this.maxRequests - this._timestamps.length,
    };
  }

  /**
   * Reset (สำหรับ test เท่านั้น)
   */
  reset() {
    this._timestamps = [];
  }
}

// ค่า default ตาม Pexels free plan
const PEXELS_MAX_REQUESTS = 200;
const PEXELS_WINDOW_MS = 3_600_000; // 1 hour

/**
 * Singleton instance — ใช้ร่วมกันทั้ง process
 * ทุก call ไป searchPhotos() จะผ่าน instance เดียวกันนี้
 */
export const rateLimiter = new RateLimiter(
  PEXELS_MAX_REQUESTS,
  PEXELS_WINDOW_MS
);

/**
 * สร้าง instance ใหม่สำหรับ test (ไม่กระทบ singleton)
 * @param {number} maxRequests
 * @param {number} windowMs
 */
export function createRateLimiter(maxRequests, windowMs) {
  return new RateLimiter(maxRequests, windowMs);
}

// export constants สำหรับ test
export const __PEXELS_MAX_REQUESTS = PEXELS_MAX_REQUESTS;
export const __PEXELS_WINDOW_MS = PEXELS_WINDOW_MS;
