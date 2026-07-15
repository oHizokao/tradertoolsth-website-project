/* ============================================================
   Auto Pilot Repository — settings + atomic lock
   ------------------------------------------------------------
   กฎ QC (safety):
   - lock ผ่าน atomic conditional UPDATE (CAS): acquire ได้เฉพาะ
     เมื่อ status='idle' AND emergency_stop=0 — ไม่ hold transaction ค้าง
   - release ผูกด้วย lock_token (กัน release ของคนอื่น)
   - ทุก update atomic + return changes count (truthy = สำเร็จ)
   - emergency_stop ตั้งได้ตลอด (atomic) — รอบที่รันอยู่จะเห็น flag
   ============================================================ */

import { logger } from "../utils/logger.js";

const log = logger.make("auto-pilot-repo");

/**
 * สร้าง repository bound กับ db instance
 * @param {Database} db
 */
export function createAutoPilotRepository(db) {
  /** อ่าน singleton settings (row id='singleton') */
  function getStatus() {
    const row = db
      .prepare("SELECT * FROM auto_pilot_settings WHERE id = 'singleton'")
      .get();
    if (!row) {
      // ไม่ควรเกิดเพราะ bootstrap ใน migration — แต่กันไว้
      return {
        enabled: false,
        status: "off",
        maxPerRun: 3,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        emergencyStop: false,
        lockToken: null,
        updatedAt: null,
      };
    }
    return {
      enabled: !!row.enabled,
      status: row.status,
      maxPerRun: row.max_per_run,
      lastRunAt: row.last_run_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
      emergencyStop: !!row.emergency_stop,
      lockToken: row.lock_token,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Acquire lock แบบ atomic (CAS)
   * - สำเร็จเฉพาะเมื่อ status='idle' AND emergency_stop=0
   * - เปลี่ยน status='running' + เก็บ lock_token
   * @param {string} lockToken UUID ของรอบนี้
   * @returns {boolean} true=acquired, false=ไม่ได้ (มีคนรันอยู่หรือ emergency)
   */
  function acquireLock(lockToken) {
    const info = db
      .prepare(
        "UPDATE auto_pilot_settings " +
          "SET status = 'running', lock_token = ?, updated_at = ? " +
          "WHERE id = 'singleton' AND status = 'idle' AND emergency_stop = 0"
      )
      .run(lockToken, new Date().toISOString());
    const acquired = info.changes > 0;
    log.debug(`acquireLock token=${lockToken.slice(0, 8)} acquired=${acquired}`);
    return acquired;
  }

  /**
   * Release lock โดยเฉพาะ owner (ตรวจ lock_token)
   * @param {string} lockToken UUID ของรอบที่จะ release
   * @param {string} newStatus 'idle' | 'stopped_error'
   * @returns {boolean} true=released
   */
  function releaseLock(lockToken, newStatus) {
    const info = db
      .prepare(
        "UPDATE auto_pilot_settings " +
          "SET status = ?, lock_token = NULL, updated_at = ? " +
          "WHERE id = 'singleton' AND lock_token = ?"
      )
      .run(newStatus, new Date().toISOString(), lockToken);
    return info.changes > 0;
  }

  /**
   * เปิด/ปิด Auto Pilot (database switch)
   * enable=true → status='idle' (พร้อมรัน)
   * enable=false → status='off'
   * ห้าม enable ถ้า emergency_stop ตั้งอยู่ (ต้อง clear ก่อน)
   */
  function setEnabled(enable) {
    if (enable) {
      const info = db
        .prepare(
          "UPDATE auto_pilot_settings " +
            "SET enabled = 1, status = 'idle', updated_at = ? " +
            "WHERE id = 'singleton' AND emergency_stop = 0"
        )
        .run(new Date().toISOString());
      return info.changes > 0;
    }
    const info = db
      .prepare(
        "UPDATE auto_pilot_settings " +
          "SET enabled = 0, status = 'off', updated_at = ? " +
          "WHERE id = 'singleton'"
      )
      .run(new Date().toISOString());
    return info.changes > 0;
  }

  /** ตั้ง emergency_stop (atomic, ทำได้ตลอด) */
  function setEmergencyStop(stop) {
    const info = db
      .prepare(
        "UPDATE auto_pilot_settings " +
          "SET emergency_stop = ?, updated_at = ? " +
          "WHERE id = 'singleton'"
      )
      .run(stop ? 1 : 0, new Date().toISOString());
    return info.changes > 0;
  }

  /** ล้าง emergency_stop + คืน status เป็น idle (ถ้า enabled) */
  function clearEmergencyStop() {
    const info = db
      .prepare(
        "UPDATE auto_pilot_settings " +
          "SET emergency_stop = 0, status = CASE WHEN enabled = 1 THEN 'idle' ELSE 'off' END, " +
          "updated_at = ? " +
          "WHERE id = 'singleton'"
      )
      .run(new Date().toISOString());
    return info.changes > 0;
  }

  /** บันทึก timestamps ของรอบ + ล้าง lastError (เมื่อสำเร็จ) */
  function recordRunSuccess(timestamp) {
    const info = db
      .prepare(
        "UPDATE auto_pilot_settings " +
          "SET last_run_at = ?, last_success_at = ?, last_error = NULL, updated_at = ? " +
          "WHERE id = 'singleton'"
      )
      .run(timestamp, timestamp, new Date().toISOString());
    return info.changes > 0;
  }

  /** บันทึก last_run_at + last_error (เมื่อล้มเหลว) */
  function recordRunError(timestamp, errorMsg) {
    const info = db
      .prepare(
        "UPDATE auto_pilot_settings " +
          "SET last_run_at = ?, last_error = ?, updated_at = ? " +
          "WHERE id = 'singleton'"
      )
      .run(timestamp, String(errorMsg).slice(0, 500), new Date().toISOString());
    return info.changes > 0;
  }

  /** อัปเดต max_per_run */
  function setMaxPerRun(n) {
    const clamped = Math.max(1, Math.min(3, Math.floor(n)));
    const info = db
      .prepare(
        "UPDATE auto_pilot_settings SET max_per_run = ?, updated_at = ? WHERE id = 'singleton'"
      )
      .run(clamped, new Date().toISOString());
    return clamped;
  }

  return {
    getStatus,
    acquireLock,
    releaseLock,
    setEnabled,
    setEmergencyStop,
    clearEmergencyStop,
    recordRunSuccess,
    recordRunError,
    setMaxPerRun,
  };
}
