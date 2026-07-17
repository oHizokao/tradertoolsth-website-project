/* ============================================================
   Forum Rate Limiter — sliding window per author
   ------------------------------------------------------------
   กฎ QC:
   - rate limit การโพสต์ (create topic + reply) ต่อ author
   - ใช้ sliding window (token bucket แบบง่าย)
   - in-memory (ไม่ persist — reset เมื่อ restart ซึ่งเป็นที่ยอมรับได้
     สำหรับ anti-spam พื้นฐาน)
   - injectable now() สำหรับ test
   ============================================================ */

/**
 * สร้าง rate limiter
 * @param {object} opts { windowSeconds, burst, now? }
 *   - windowSeconds: ระยะเวลา window ที่นับ (default 30s)
 *   - burst: จำนวน action สูงสุดใน window (default 3)
 *   - now: function คืน timestamp ปัจจุบัน (ms) — injectable สำหรับ test
 */
export function createRateLimiter(opts = {}) {
  const windowMs = Math.max(1, Number(opts.windowSeconds || 30)) * 1000;
  const burst = Math.max(1, Number(opts.burst || 3));
  const now = opts.now || (() => Date.now());

  // map key → array ของ timestamp ที่อยู่ใน window
  const buckets = new Map();

  /**
   * ตรวจ + บันทึก action (ถ้าผ่าน)
   * @param {string} key (ปกติคือ authorId)
   * @returns {{ allowed: boolean, retryAfterMs: number, remaining: number }}
   */
  function tryConsume(key) {
    const t = now();
    const k = String(key || "anon");
    const arr = buckets.get(k) || [];
    // prune timestamps ที่เลย window แล้ว
    const fresh = arr.filter((ts) => t - ts < windowMs);

    if (fresh.length >= burst) {
      // คำนวณ retry-after: เวลา timestamp ที่เก่าที่สุดใน window จะหลุด
      const oldest = fresh[0];
      const retryAfterMs = oldest + windowMs - t;
      buckets.set(k, fresh);
      return { allowed: false, retryAfterMs: Math.max(1, retryAfterMs), remaining: 0 };
    }

    fresh.push(t);
    buckets.set(k, fresh);
    return { allowed: true, retryAfterMs: 0, remaining: burst - fresh.length };
  }

  /** peek โดยไม่ consume (สำหรับ check-only) */
  function peek(key) {
    const t = now();
    const k = String(key || "anon");
    const arr = buckets.get(k) || [];
    const fresh = arr.filter((ts) => t - ts < windowMs);
    buckets.set(k, fresh);
    return {
      allowed: fresh.length < burst,
      remaining: Math.max(0, burst - fresh.length),
    };
  }

  /** reset bucket ของ key (ใช้ใน test) */
  function reset(key) {
    if (key === undefined || key === null) buckets.clear();
    else buckets.delete(String(key));
  }

  return {
    tryConsume,
    peek,
    reset,
    windowMs,
    burst,
  };
}
