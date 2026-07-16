/* ============================================================
   Calendar Service — sync, cache, fallback, public read API
   ------------------------------------------------------------
   กฎ QC (ตามที่ Codex กำหนด):
   - sync ทุก 5 นาที (config.calendar.syncIntervalSeconds)
   - มี manual refresh function
   - ป้องกัน sync ซ้อน (in-flight lock)
   - ใช้ timeout/retry จาก httpClient (จำกัด retries)
   - rate limit อย่างสุภาพ (sync interval ควบคุม)
   - ถ้า source ล้มเหลว → คืน cache ล่าสุด + stale=true
   - response มี updatedAt / stale / source / items
   - ห้ามใช้คำว่า "realtime" ใช้ "อัปเดตอัตโนมัติ" / "ข้อมูลล่าสุดจากการซิงก์"
   ============================================================ */

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  fetchCalendar,
  SOURCE_NAME,
  SOURCE_URL,
} from "./forexFactory.scraper.js";

const log = logger.make("cal-service");

/**
 * สร้าง calendar service bound กับ repository
 * @param {object} repo calendarRepository instance
 * @param {object} [opts] override (สำหรับ test)
 */
export function createCalendarService(repo, opts = {}) {
  // in-flight lock: กัน sync ซ้อน (manual + scheduled พร้อมกัน)
  let syncInFlight = false;

  const cfg = {
    enabled: opts.enabled ?? config.calendar.enabled,
    url: opts.url ?? config.calendar.calendarUrl,
    sourceName: opts.sourceName ?? config.calendar.sourceName,
    sourceUrl: opts.sourceUrl ?? SOURCE_URL,
    syncIntervalSeconds: opts.syncIntervalSeconds ?? config.calendar.syncIntervalSeconds,
    staleAfterSeconds: opts.staleAfterSeconds ?? config.calendar.staleAfterSeconds,
    httpTimeoutMs: opts.httpTimeoutMs ?? config.calendar.httpTimeoutMs,
    httpRetries: opts.httpRetries ?? config.calendar.httpRetries,
    maxEventAgeHours: opts.maxEventAgeHours ?? config.calendar.maxEventAgeHours,
    // injectable fetch (สำหรับ test: จำลอง source สำเร็จ/ล้มเหลว)
    fetchFn: opts.fetchFn ?? defaultFetch,
  };

  /**
   * Sync (ดึง + upsert + prune + update meta)
   * - ป้องกัน sync ซ้อนด้วย syncInFlight flag
   * - ถ้า source ล้มเหลว → ไม่ลบ cache เก่า, บันทึก last_error
   * @param {object} [callOpts] { force?: boolean }
   * @returns {Promise<{ ok: boolean, saved: number, total: number, skipped: boolean, stale: boolean, source: string }>}
   */
  async function sync(callOpts = {}) {
    if (syncInFlight) {
      log.info("sync already in-flight → skip");
      return { ok: false, saved: 0, total: 0, skipped: true, stale: isStale(), source: cfg.sourceName };
    }
    syncInFlight = true;
    try {
      const events = await cfg.fetchFn({
        url: cfg.url,
        sourceName: cfg.sourceName,
        sourceUrl: cfg.sourceUrl,
        timeoutMs: cfg.httpTimeoutMs,
        retries: cfg.httpRetries,
      });
      const { saved, total } = repo.upsertMany(events);
      const now = new Date().toISOString();
      // prune events เก่า (กัน cache บวม)
      const cutoff = new Date(Date.now() - cfg.maxEventAgeHours * 3_600_000).toISOString();
      const pruned = repo.pruneOlderThan(cutoff);
      repo.setSyncMeta({
        lastSyncAt: now,
        lastSyncOk: true,
        lastError: null,
        lastEventCount: total,
        sourceName: cfg.sourceName,
      });
      log.info(
        `sync ok: ${events.length} fetched, ${saved} saved/updated, ${pruned} pruned`
      );
      return {
        ok: true,
        saved,
        total,
        skipped: false,
        stale: false,
        source: cfg.sourceName,
      };
    } catch (err) {
      // source ล้มเหลว → คืน cache เดิม, บันทึก error (ห้ามลบ cache)
      log.warn(`sync failed: ${err.message} — keeping last cache`);
      repo.setSyncMeta({
        lastSyncOk: false,
        lastError: String(err.message || err).slice(0, 300),
        sourceName: cfg.sourceName,
      });
      return {
        ok: false,
        saved: 0,
        total: repo.count(),
        skipped: false,
        stale: isStale(),
        source: cfg.sourceName,
        error: err.message,
      };
    } finally {
      syncInFlight = false;
    }
  }

  /**
   * ตรวจว่า cache stale หรือไม่ (เกิน staleAfterSeconds นับจาก lastSyncAt)
   * stale=true เมื่อ: ไม่เคย sync สำเร็จ, หรือ sync สำเร็จล่าสุดเกินเกณฑ์
   * @returns {boolean}
   */
  function isStale() {
    const meta = repo.getSyncMeta();
    if (!meta || !meta.lastSyncAt) return true; // ไม่เคย sync
    if (!meta.lastSyncOk) return true; // sync ล่าสุดล้มเหลว
    const ageMs = Date.now() - new Date(meta.lastSyncAt).getTime();
    return ageMs > cfg.staleAfterSeconds * 1000;
  }

  /**
   * updatedAt ล่าสุด (lastSyncAt) — สำหรับ response envelope
   * ถ้าไม่เคย sync → null
   */
  function getUpdatedAt() {
    const meta = repo.getSyncMeta();
    return meta?.lastSyncAt ?? null;
  }

  /**
   * อ่าน events พร้อม envelope { items, updatedAt, stale, source }
   * — คืน cache เสมอ แม้ stale (fallback เมื่อ source ล่ม)
   *
   * @param {object} q { fromUtc?, toUtc?, currency?, impact? }
   * @returns {{ items: object[], updatedAt: string|null, stale: boolean, source: string }}
   */
  function readEvents(q = {}) {
    const items = repo.listRange(q);
    return {
      items,
      updatedAt: getUpdatedAt(),
      stale: isStale(),
      source: cfg.sourceName,
    };
  }

  /**
   * อ่าน upcoming events พร้อม envelope
   * @param {object} q { limit?, currency?, impact? }
   */
  function readUpcoming(q = {}) {
    const items = repo.listUpcoming(q);
    return {
      items,
      updatedAt: getUpdatedAt(),
      stale: isStale(),
      source: cfg.sourceName,
    };
  }

  /** สถานะ service (สำหรับ health/debug) */
  function getStatus() {
    const meta = repo.getSyncMeta();
    return {
      enabled: cfg.enabled,
      syncInFlight,
      source: cfg.sourceName,
      lastSyncAt: meta?.lastSyncAt ?? null,
      lastSyncOk: meta?.lastSyncOk ?? false,
      lastError: meta?.lastError ?? null,
      lastEventCount: meta?.lastEventCount ?? null,
      cachedEvents: repo.count(),
      stale: isStale(),
    };
  }

  return {
    sync,
    readEvents,
    readUpcoming,
    isStale,
    getUpdatedAt,
    getStatus,
    // expose สำหรับ scheduler
    _isInFlight: () => syncInFlight,
    _config: cfg,
  };
}

/** default fetch wrapper: เรียก fetchCalendar ของ scraper */
async function defaultFetch(fetchOpts) {
  return fetchCalendar(fetchOpts);
}

/**
 * สร้าง scheduler ที่ sync ทุก syncIntervalSeconds
 * - คืน { start, stop, isRunning }
 * - ไม่ sync ซ้อนกับ manual (syncInFlight กันอยู่แล้ว)
 */
export function createCalendarScheduler(service) {
  let timer = null;
  const intervalMs = Math.max(
    60,
    (service._config.syncIntervalSeconds || 300) * 1000
  );

  function start() {
    if (timer) return false;
    // sync รอบแรกหลัง start (ไม่ force เพื่อไม่ให้กระทบ source)
    timer = setInterval(() => {
      service.sync().catch((err) =>
        log.error(`scheduled calendar sync failed: ${err.message}`)
      );
    }, intervalMs);
    log.info(
      `calendar scheduler armed: every ${service._config.syncIntervalSeconds}s`
    );
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    return true;
  }

  function isRunning() {
    return timer !== null;
  }

  return { start, stop, isRunning };
}
