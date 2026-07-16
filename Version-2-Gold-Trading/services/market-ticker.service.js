/* ============================================================
   Service Layer — Market Ticker Service (V2)
   ------------------------------------------------------------
   - ดึงราคาตลาดจาก /api/market-ticker (เว็บเราเอง ห้ามเรียกเว็บนอก)
   - validate response, timeout, error handling
   - cache ใน memory (เฉพาะข้อมูลล่าสุด) เพื่อ fallback ตอน API ล่ม
   - refresh ทุก 30 วินาที (auto) + รองรับ subscribe เพื่อ UI update
   - ถ้า API ล่ม ใช้ cache ล่าสุด (stale=true); ถ้าไม่มี cache ส่ง unavailable
   - ไม่ hardcode ราคา ใด ๆ ทั้งสิ้น

   API contract ที่ frontend รอ:
     GET /api/market-ticker
     200 → { items: Item[], updatedAt: string, stale: boolean }
     Item = {
       symbol: string,        // เช่น "XAUUSD"
       label?: string,        // เช่น "Gold"
       price: number,
       change: number,
       changePercent: number,
       direction: "up" | "down" | "flat",
       updatedAt?: string,
       stale?: boolean
     }
   ============================================================ */

window.TT = window.TT || {};

TT.MarketTickerService = (function () {
  const API_ENDPOINT = "/api/market-ticker";
  const REFRESH_MS = 30 * 1000; // 30 วินาที
  const REQUEST_TIMEOUT_MS = 7000; // 7 วินาที
  const MAX_ITEMS = 64;

  // ---------- internal state ----------
  // cache = snapshot ล่าสุดที่เคยดึงสำเร็จจาก API (ใช้ fallback)
  let cache = null; // { items: Item[], updatedAt, stale, fetchedAt }
  let lastError = null; // Error ล่าสุด (ใช้แสดง badge error)
  let status = "init"; // "init" | "loading" | "live" | "stale" | "unavailable" | "empty"
  let timer = null;
  let inFlight = null;
  const subscribers = new Set();

  // ---------- helpers ----------
  function nowMs() {
    return Date.now();
  }

  function isNum(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function isNonEmptyStr(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  /** normalize direction → "up" | "down" | "flat" */
  function normDir(v, change) {
    if (v === "up" || v === "down" || v === "flat") return v;
    if (isNum(change)) {
      if (change > 0) return "up";
      if (change < 0) return "down";
    }
    return "flat";
  }

  /** validate + normalize หนึ่ง item (คืน null ถ้าผิด format) */
  function normItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!isNonEmptyStr(raw.symbol)) return null;
    if (!isNum(raw.price)) return null;

    const change = isNum(raw.change) ? raw.change : null;
    const changePercent = isNum(raw.changePercent)
      ? raw.changePercent
      : isNum(raw.percent)
        ? raw.percent
        : null;
    const direction = normDir(raw.direction, change);

    return {
      symbol: String(raw.symbol).trim(),
      label: isNonEmptyStr(raw.label) ? String(raw.label) : String(raw.symbol),
      price: raw.price,
      change,
      changePercent,
      direction,
      updatedAt: isNonEmptyStr(raw.updatedAt) ? raw.updatedAt : null,
      stale: raw.stale === true,
      assetClass: isNonEmptyStr(raw.assetClass) ? raw.assetClass : "other",
      source: isNonEmptyStr(raw.source) ? raw.source : null,
      history: Array.isArray(raw.history)
        ? raw.history.filter(isNum).slice(-24)
        : [],
    };
  }

  /** validate + normalize ทั้ง envelope */
  function normEnvelope(payload) {
    // ยอมรับทั้ง { items: [...] } และ plain array (defense-in-depth)
    let items = null;
    let updatedAt = null;
    let stale = false;
    if (Array.isArray(payload)) {
      items = payload;
    } else if (payload && typeof payload === "object" && Array.isArray(payload.items)) {
      items = payload.items;
      updatedAt = isNonEmptyStr(payload.updatedAt) ? payload.updatedAt : null;
      stale = payload.stale === true;
    } else {
      return null; // format ไม่รู้จัก
    }

    const cleaned = items
      .map(normItem)
      .filter(Boolean)
      .map((item) => (stale ? { ...item, stale: true } : item))
      .slice(0, MAX_ITEMS);

    if (cleaned.length === 0) return null;

    return { items: cleaned, updatedAt, stale };
  }

  /** fetch พร้อม timeout (AbortController) */
  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }

  // ---------- notify ----------
  function snapshot() {
    if (cache) {
      return {
        status,
        items: cache.items.slice(),
        updatedAt: cache.updatedAt,
        stale: cache.stale,
        error: null,
      };
    }
    return {
      status,
      items: [],
      updatedAt: null,
      stale: false,
      error: lastError ? String(lastError.message || lastError) : null,
    };
  }

  function emit() {
    const snap = snapshot();
    subscribers.forEach((fn) => {
      try {
        fn(snap);
      } catch (e) {
        // กัน subscriber ตัวใดตัวหนึ่งพังแล้วกระทบตัวอื่น
        console.warn("[MarketTicker] subscriber error:", e);
      }
    });
  }

  // ---------- core fetch ----------
  async function load() {
    // กัน concurrent: ให้ทุกคนรอ in-flight เดียวกัน
    if (inFlight) return inFlight;

    status = "loading";
    emit();

    inFlight = (async () => {
      try {
        const res = await fetchWithTimeout(API_ENDPOINT, REQUEST_TIMEOUT_MS);
        if (!res.ok) throw new Error("HTTP " + res.status);

        const text = await res.text();
        let payload = null;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch (e) {
            throw new Error("Invalid JSON");
          }
        }

        const env = normEnvelope(payload);
        if (!env) {
          // format ผิด หรือไม่มี items → ถือว่า empty
          // แต่ถ้ามี cache เก่า ให้ใช้ cache (stale)
          if (cache) {
            status = "stale";
            cache = { ...cache, stale: true, fetchedAt: nowMs() };
          } else {
            status = "empty";
          }
          emit();
          return;
        }

        cache = {
          items: env.items,
          updatedAt: env.updatedAt,
          stale: env.stale,
          fetchedAt: nowMs(),
        };
        lastError = null;
        status = cache.stale ? "stale" : "live";
        emit();
      } catch (err) {
        // API ล่ม → ใช้ cache ล่าสุด; ถ้าไม่มี cache → unavailable
        lastError = err;
        if (cache) {
          status = "stale";
          cache = { ...cache, stale: true };
        } else {
          status = "unavailable";
        }
        console.warn("[MarketTicker] API unavailable:", err && err.message ? err.message : err);
        emit();
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  // ---------- public API ----------
  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    subscribers.add(fn);
    // ส่ง snapshot ปัจจุบันให้ทันที
    try {
      fn(snapshot());
    } catch (e) {
      console.warn("[MarketTicker] subscriber error:", e);
    }
    return () => subscribers.delete(fn);
  }

  function start() {
    if (timer) return; // กันตั้งซ้ำ
    load();
    timer = setInterval(load, REFRESH_MS);

    // refresh ทันทีเมื่อ tab กลับมา active (แต่ลด spam ด้วย visibility throttle)
    document.addEventListener("visibilitychange", onVisible);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    document.removeEventListener("visibilitychange", onVisible);
  }

  function onVisible() {
    if (document.visibilityState === "visible") {
      load();
    }
  }

  /** force refresh ทันที (manual) */
  function refresh() {
    return load();
  }

  return {
    start,
    stop,
    refresh,
    subscribe,
    getSnapshot: snapshot,
    REFRESH_MS,
    API_ENDPOINT,
  };
})();
