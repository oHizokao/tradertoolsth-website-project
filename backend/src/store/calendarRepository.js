/* ============================================================
   Calendar Repository — CRUD + upsert + query สำหรับ calendar_events
   ------------------------------------------------------------
   กฎ QC (เหมือน newsRepository):
   - ทุก query ใช้ parameterized (? placeholders) เท่านั้น
   - upsert ด้วย source_event_id (deterministic hash)
     → ถ้ามี Actual ใหม่ อัปเดต record เดิม ไม่สร้างซ้ำ
   - last_updated บันทึกทุกครั้ง (sync + update)
   - ไม่กระทบตาราง news ใดๆ ทั้งสิ้น
   ============================================================ */

import { logger } from "../utils/logger.js";

const log = logger.make("cal-repo");

/**
 * สร้าง repository bound กับ db instance
 * @param {Database} db
 */
export function createCalendarRepository(db) {
  // ---- UPSERT (insert หรือ update Actual ถ้ามีใหม่) ----
  const upsertStmt = db.prepare(
    `INSERT INTO calendar_events
       (source_event_id, source_name, source_url, event_name, country, currency,
        impact, scheduled_at_utc, scheduled_at_bangkok, actual, forecast, previous,
        revised, detail_url, is_tentative, last_updated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_event_id) DO UPDATE SET
       source_name = excluded.source_name,
       source_url = excluded.source_url,
       event_name = excluded.event_name,
       country = excluded.country,
       currency = excluded.currency,
       impact = excluded.impact,
       scheduled_at_utc = excluded.scheduled_at_utc,
       scheduled_at_bangkok = excluded.scheduled_at_bangkok,
       -- actual/revised: อัปเดตเฉพาะเมื่อค่าใหม่ไม่ใช่ NULL (กันเขียนทับ Actual ด้วย NULL)
       actual = CASE WHEN excluded.actual IS NOT NULL THEN excluded.actual ELSE calendar_events.actual END,
       forecast = CASE WHEN excluded.forecast IS NOT NULL THEN excluded.forecast ELSE calendar_events.forecast END,
       previous = CASE WHEN excluded.previous IS NOT NULL THEN excluded.previous ELSE calendar_events.previous END,
       revised = CASE WHEN excluded.revised IS NOT NULL THEN excluded.revised ELSE calendar_events.revised END,
       detail_url = excluded.detail_url,
       is_tentative = excluded.is_tentative,
       last_updated = excluded.last_updated
     WHERE
       -- อัปเดตเฉพาะเมื่อมีข้อมูลที่เปลี่ยนแปลงจริง (กันเขียน last_updated โดยไม่จำเป็น)
       calendar_events.actual IS NOT excluded.actual
       OR calendar_events.forecast IS NOT excluded.forecast
       OR calendar_events.previous IS NOT excluded.previous
       OR calendar_events.revised IS NOT excluded.revised
       OR calendar_events.event_name IS NOT excluded.event_name
       OR calendar_events.impact IS NOT excluded.impact`
  );

  /**
   * Upsert event เดี่ยว (insert หรือ update Actual/Forecast/Previous ถ้ามีใหม่)
   * @param {object} ev normalized event
   * @returns {{ upserted: boolean, id: string }}
   */
  function upsertEvent(ev) {
    const now = new Date().toISOString();
    const info = upsertStmt.run(
      ev.sourceEventId,
      ev.sourceName,
      ev.sourceUrl ?? null,
      ev.eventName,
      ev.country ?? ev.currency ?? null,
      ev.currency ?? null,
      ev.impact,
      ev.scheduledAtUtc,
      ev.scheduledAtBangkok ?? null,
      ev.actual ?? null,
      ev.forecast ?? null,
      ev.previous ?? null,
      ev.revised ?? null,
      ev.detailUrl ?? null,
      ev.isTentative ? 1 : 0,
      ev.lastUpdated || now,
      now
    );
    const upserted = info.changes > 0;
    return { upserted, id: ev.sourceEventId };
  }

  /**
   * Upsert batch ใน transaction เดียว (กัน race + เร็ว)
   * @param {object[]} events normalized events
   * @returns {{ saved: number, total: number }}
   */
  function upsertMany(events) {
    if (!Array.isArray(events) || events.length === 0) {
      return { saved: 0, total: 0 };
    }
    const tx = db.transaction((items) => {
      let saved = 0;
      for (const ev of items) {
        const r = upsertEvent(ev);
        if (r.upserted) saved++;
      }
      return saved;
    });
    const saved = tx(events);
    log.debug(`upsertMany: saved/updated ${saved}/${events.length}`);
    return { saved, total: events.length };
  }

  // ---- QUERY ----
  /**
   * ดึง events ในช่วง [fromUtc, toUtc] (inclusive) เรียงเวลาเก่า→ใหม่
   * @param {object} opts { fromUtc?, toUtc?, currency?, impact? }
   * @returns {object[]}
   */
  function listRange(opts = {}) {
    const { fromUtc, toUtc, currency, impact } = opts;
    const where = [];
    const params = [];
    if (fromUtc) {
      where.push("scheduled_at_utc >= ?");
      params.push(fromUtc);
    }
    if (toUtc) {
      where.push("scheduled_at_utc <= ?");
      params.push(toUtc);
    }
    if (currency && String(currency).toLowerCase() !== "all") {
      where.push("currency = ?");
      params.push(String(currency).toUpperCase());
    }
    if (impact && String(impact).toLowerCase() !== "all") {
      where.push("impact = ?");
      params.push(String(impact).toLowerCase());
    }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const rows = db
      .prepare(
        `SELECT * FROM calendar_events ${whereSql}
         ORDER BY scheduled_at_utc ASC`
      )
      .all(...params);
    return rows.map(rowToEvent);
  }

  /**
   * ดึง upcoming events (เวลา >= nowUtc) เรียงเครือ
   * @param {object} opts { limit?, currency?, impact?, nowUtc? }
   * @returns {object[]}
   */
  function listUpcoming(opts = {}) {
    const nowUtc = opts.nowUtc || new Date().toISOString();
    const limit = Math.max(1, Math.min(200, Math.floor(opts.limit || 10)));
    const where = ["scheduled_at_utc >= ?"];
    const params = [nowUtc];
    if (opts.currency && String(opts.currency).toLowerCase() !== "all") {
      where.push("currency = ?");
      params.push(String(opts.currency).toUpperCase());
    }
    if (opts.impact && String(opts.impact).toLowerCase() !== "all") {
      where.push("impact = ?");
      params.push(String(opts.impact).toLowerCase());
    }
    const rows = db
      .prepare(
        `SELECT * FROM calendar_events
         WHERE ${where.join(" AND ")}
         ORDER BY scheduled_at_utc ASC
         LIMIT ?`
      )
      .all(...params, limit);
    return rows.map(rowToEvent);
  }

  function getBySourceEventId(id) {
    const row = db
      .prepare("SELECT * FROM calendar_events WHERE source_event_id = ?")
      .get(id);
    return row ? rowToEvent(row) : null;
  }

  function count() {
    return db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get().n;
  }

  /**
   * ลบ events ที่เก่ากว่า cutoffUtc (prune cache)
   */
  function pruneOlderThan(cutoffUtc) {
    if (!cutoffUtc) return 0;
    const info = db
      .prepare("DELETE FROM calendar_events WHERE scheduled_at_utc < ?")
      .run(cutoffUtc);
    return info.changes;
  }

  // ---- SYNC META (singleton row) ----
  function getSyncMeta() {
    const row = db
      .prepare("SELECT * FROM calendar_sync_meta WHERE id = 'singleton'")
      .get();
    return row ? rowToSyncMeta(row) : null;
  }

  function setSyncMeta(patch) {
    const now = new Date().toISOString();
    // upsert singleton
    db.prepare(
      `INSERT INTO calendar_sync_meta
         (id, last_sync_at, last_sync_ok, last_error, last_event_count, source_name, updated_at)
       VALUES ('singleton', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_sync_at = COALESCE(excluded.last_sync_at, calendar_sync_meta.last_sync_at),
         last_sync_ok = excluded.last_sync_ok,
         last_error = excluded.last_error,
         last_event_count = COALESCE(excluded.last_event_count, calendar_sync_meta.last_event_count),
         source_name = COALESCE(excluded.source_name, calendar_sync_meta.source_name),
         updated_at = excluded.updated_at`
    ).run(
      patch.lastSyncAt ?? null,
      patch.lastSyncOk ? 1 : 0,
      patch.lastError ?? null,
      patch.lastEventCount ?? null,
      patch.sourceName ?? null,
      now
    );
  }

  /** ล้างทั้งหมด (ใช้ใน test เท่านั้น) */
  function clearAll() {
    db.prepare("DELETE FROM calendar_events").run();
    db.prepare("DELETE FROM calendar_sync_meta").run();
  }

  return {
    upsertEvent,
    upsertMany,
    listRange,
    listUpcoming,
    getBySourceEventId,
    count,
    pruneOlderThan,
    getSyncMeta,
    setSyncMeta,
    clearAll,
  };
}

/** แปลง DB row → event object (camelCase + boolean) */
export function rowToEvent(row) {
  if (!row) return null;
  return {
    sourceEventId: row.source_event_id,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    eventName: row.event_name,
    country: row.country,
    currency: row.currency,
    impact: row.impact,
    scheduledAtUtc: row.scheduled_at_utc,
    scheduledAtBangkok: row.scheduled_at_bangkok,
    actual: row.actual,
    forecast: row.forecast,
    previous: row.previous,
    revised: row.revised,
    detailUrl: row.detail_url,
    isTentative: !!row.is_tentative,
    lastUpdated: row.last_updated,
    createdAt: row.created_at,
  };
}

/** แปลง DB row → sync meta object */
export function rowToSyncMeta(row) {
  if (!row) return null;
  return {
    id: row.id,
    lastSyncAt: row.last_sync_at,
    lastSyncOk: !!row.last_sync_ok,
    lastError: row.last_error,
    lastEventCount: row.last_event_count,
    sourceName: row.source_name,
    updatedAt: row.updated_at,
  };
}
