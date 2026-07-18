/* ============================================================
   Service Layer — Signal Service (Market Status)
   ------------------------------------------------------------
   แหล่งข้อมูล: ระบบราคาตลาดสดของเว็บ (/api/market-ticker ผ่าน
   TT.MarketTickerService) — เป็นข้อมูลจริงที่ตรวจสอบได้

   ความซื่อสัตย์ของข้อมูล (fail-closed):
   - ระบบ EA/MT5 trade feed ยังไม่ได้เชื่อมต่อจริง → เราจะไม่
     แต่งสัญญาณซื้อขาย (Entry/SL/TP) หรือราคาขึ้นมาเอง
   - แทนที่จะแสดงสัญญาณจำลอง เรา "อนุมานสถานะตลาด/ทางเทคนิค"
     จากราคาจริง (price, change%, direction, history) ของแบ็กเอนด์
     ที่อนุญาต — แสดงเป็น "โมเมนตัม" (ขาขึ้น/ขาลง/นิ่ง) ไม่ใช่คำสั่งเทรด
   - แสดงแหล่งข้อมูล + เวลาอัปเดตอย่างชัดเจน และบอกตามจริงเมื่อ
     แหล่ง EA ยังไม่พร้อมใช้งาน
   - ไม่ hardcode ราคา ไม่ส่ง token/secret ใด ๆ
   ============================================================ */

window.TT = window.TT || {};

TT.SignalService = (function () {
  // EA/MT5 trade feed ยังไม่ได้เชื่อมต่อจริง — ไม่แสดงสัญญาณเทรดจำลอง
  const EA_FEED_CONNECTED = false;

  // Whitelist ของ symbol ที่รองรับ — เป็น single source of truth
  // (ใช้ทั้งฝั่ง list และหน้า detail ของ signal)
  // tv = TradingView symbol ที่ผ่านการตรวจสอบแล้ว (exchange:ticker)
  const SYMBOL_META = {
    XAUUSD: { label: "ทองคำ XAU/USD",   assetClass: "metals",    tv: "OANDA:XAUUSD" },
    XAGUSD: { label: "เงิน XAG/USD",     assetClass: "metals",    tv: "OANDA:XAGUSD" },
    EURUSD: { label: "ยูโร EUR/USD",     assetClass: "forex",     tv: "FX:EURUSD" },
    GBPUSD: { label: "ปอนด์ GBP/USD",    assetClass: "forex",     tv: "FX:GBPUSD" },
    USDJPY: { label: "เยน USD/JPY",      assetClass: "forex",     tv: "FX:USDJPY" },
    BTCUSD: { label: "บิตคอยน์ BTC/USD", assetClass: "crypto",    tv: "BITSTAMP:BTCUSD" },
    DXY:    { label: "ดัชนีดอลลาร์ DXY", assetClass: "index",     tv: "TVC:DXY" },
    OIL:    { label: "น้ำมันดิบ WTI",     assetClass: "commodity", tv: "TVC:USOIL" },
  };

  const ASSET_LABELS = {
    metals: "โลหะมีค่า",
    forex: "ฟอเร็กซ์",
    crypto: "คริปโตเคอร์เรนซี",
    index: "ดัชนี",
    commodity: "พลังงาน",
    other: "อื่น ๆ",
  };

  function isNum(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  /**
   * อนุมาน "สถานะตลาด" จากข้อมูลจริง
   * - ใช้ changePercent เป็นสัญญาณหลัก + slope ของ history เป็นตัวยืนยัน
   * - ผลลัพธ์เป็น "โมเมนตัม" (ขาขึ้น/ขาลง/นิ่ง) ไม่ใช่คำสั่ง BUY/SELL
   * - threshold เข้มข้นตามเทคนิคเพื่อให้ไม่ over-signal ในตลาดที่แคบ
   */
  function deriveStatus(changePercent, history) {
    const pct = isNum(changePercent) ? changePercent : 0;

    // slope ของ history (แรก→ล่าสุด) เป็นเปอร์เซ็นต์ — ยืนยันทิศทาง
    let slope = 0;
    if (Array.isArray(history) && history.length >= 2) {
      const first = history[0];
      const last = history[history.length - 1];
      if (isNum(first) && isNum(last) && first !== 0) {
        slope = ((last - first) / Math.abs(first)) * 100;
      }
    }

    const combined = pct * 0.7 + slope * 0.3;
    const mag = Math.abs(combined);

    let status, statusLabel, statusEn;
    if (combined > 0.15) {
      status = "bullish";
      statusLabel = "ขาขึ้น";
      statusEn = "Bullish";
    } else if (combined < -0.15) {
      status = "bearish";
      statusLabel = "ขาลง";
      statusEn = "Bearish";
    } else {
      status = "neutral";
      statusLabel = "นิ่ง";
      statusEn = "Neutral";
    }

    let strength, strengthLabel;
    if (mag >= 1) {
      strength = "strong";
      strengthLabel = "แรง";
    } else if (mag >= 0.4) {
      strength = "moderate";
      strengthLabel = "ปานกลาง";
    } else {
      strength = "weak";
      strengthLabel = "อ่อน";
    }

    return { status, statusLabel, statusEn, strength, strengthLabel, score: combined };
  }

  /** แปลง market ticker item → derived market-status signal */
  function deriveOne(item) {
    if (!item || typeof item !== "object") return null;
    const meta = SYMBOL_META[item.symbol] || {};
    const assetClass = meta.assetClass || item.assetClass || "other";
    const changePercent = isNum(item.changePercent)
      ? item.changePercent
      : isNum(item.percent)
        ? item.percent
        : null;
    const derived = deriveStatus(changePercent, item.history);

    return {
      id: item.symbol,
      symbol: item.symbol,
      label: meta.label || item.label || item.symbol,
      assetClass,
      assetLabel: ASSET_LABELS[assetClass] || ASSET_LABELS.other,
      price: isNum(item.price) ? item.price : null,
      change: isNum(item.change) ? item.change : null,
      changePercent,
      // direction ดิบจาก backend (เทียบกับจุดก่อนหน้า) — ใช้แสดงทิศทางล่าสุด
      direction: item.direction === "up" || item.direction === "down"
        ? item.direction
        : "flat",
      status: derived.status,
      statusLabel: derived.statusLabel,
      statusEn: derived.statusEn,
      strength: derived.strength,
      strengthLabel: derived.strengthLabel,
      score: derived.score,
      source: typeof item.source === "string" && item.source ? item.source : null,
      sourceUrl: typeof item.sourceUrl === "string" && item.sourceUrl ? item.sourceUrl : null,
      updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : null,
      stale: item.stale === true,
      unavailable: item.unavailable === true,
      unavailableReason: item.unavailableReason || null,
      history: Array.isArray(item.history) ? item.history.filter(isNum) : [],
      tv: meta.tv || null,
    };
  }

  /** แปลง snapshot ของ MarketTickerService → derived bundle */
  function deriveAll(snap) {
    const items = (snap && Array.isArray(snap.items)) ? snap.items : [];
    // แยก available (มีราคาจริง) ออกจาก unavailable (ไม่มีแหล่งข้อมูล)
    const all = items.map(deriveOne).filter(Boolean);
    const signals = all.filter((s) => !s.unavailable && s.price !== null);
    const unavailable = all.filter((s) => s.unavailable || s.price === null);

    return {
      status: snap ? snap.status : "init", // init|loading|live|stale|unavailable|empty
      updatedAt: snap && snap.updatedAt ? snap.updatedAt : null,
      stale: !!(snap && snap.stale),
      signals,
      unavailable,
      total: all.length,
    };
  }

  // ---------- live subscription (idempotent) ----------
  let latest = null;
  const subs = new Set();
  let bound = false;

  function ensureBound() {
    const svc = TT.MarketTickerService;
    if (!svc || bound) return;
    bound = true;
    // ทำเครื่องหมายว่าเรา bind แล้ว (กัน bind ซ้ำในหน้าเดียวกัน)
    svc.__signalBound = true;
    svc.subscribe((snap) => {
      latest = deriveAll(snap);
      subs.forEach((fn) => {
        try {
          fn(latest);
        } catch (e) {
          console.warn("[SignalService] subscriber error:", e);
        }
      });
    });
  }

  /** subscribe เพื่อรับ derived bundle ทุกครั้งที่ตลาดอัปเดต */
  function subscribe(cb) {
    if (typeof cb !== "function") return () => {};
    subs.add(cb);
    ensureBound();
    const svc = TT.MarketTickerService;
    if (svc) {
      if (latest) {
        try {
          cb(latest);
        } catch (e) {
          console.warn("[SignalService] subscriber error:", e);
        }
      }
      svc.start();
    } else {
      // ไม่มี MarketTickerService → แจ้ง unavailable ตามตรง
      latest = deriveAll({ status: "unavailable", items: [] });
      try {
        cb(latest);
      } catch (e) { /* noop */ }
    }
    return () => subs.delete(cb);
  }

  /** snapshot ล่าสุด (derived) — สำหรับอ่านค่าปัจจุบัน */
  function getSnapshot() {
    if (latest) return latest;
    ensureBound();
    const svc = TT.MarketTickerService;
    if (svc) {
      latest = deriveAll(svc.getSnapshot ? svc.getSnapshot() : null);
    }
    return latest || deriveAll(null);
  }

  /** refresh ทันที (manual) */
  function refresh() {
    const svc = TT.MarketTickerService;
    if (svc && typeof svc.refresh === "function") return svc.refresh();
  }

  // ---------- backward-compat API (used by signal.js) ----------
  /**
   * คืนรายการ derived signals ตาม filter
   * @param {object} filter { assetClass?: string, momentum?: "all"|"up"|"down"|"flat" }
   */
  async function fetchSignals(filter = {}) {
    const snap = getSnapshot();
    let list = snap.signals.slice();
    if (filter.assetClass && filter.assetClass !== "all") {
      list = list.filter((s) => s.assetClass === filter.assetClass);
    }
    if (filter.momentum && filter.momentum !== "all") {
      list = list.filter((s) => s.direction === filter.momentum);
    }
    return list;
  }

  /** สถิติที่อนุมานจากข้อมูลจริง (ไม่ใช่ win rate/pips แบบ EA) */
  async function getStats() {
    const snap = getSnapshot();
    const signals = snap.signals;
    const up = signals.filter((s) => s.direction === "up").length;
    const down = signals.filter((s) => s.direction === "down").length;
    const flat = signals.length - up - down;
    return {
      total: signals.length,
      unavailable: snap.unavailable.length,
      up,
      down,
      flat,
      updatedAt: snap.updatedAt,
      stale: snap.stale,
    };
  }

  /**
   * resolve symbol จาก URL → known-safe { key, known, tv, label, assetClass, assetLabel }
   * ใช้สำหรับหน้า detail — ถ้าไม่อยู่ใน whitelist ให้ fallback ไป XAUUSD อย่างปลอดภัย
   */
  function resolveSymbol(raw) {
    const key = String(raw == null ? "" : raw)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const entry = SYMBOL_META[key];
    if (entry) {
      return {
        key,
        known: true,
        tv: entry.tv,
        label: entry.label,
        assetClass: entry.assetClass,
        assetLabel: ASSET_LABELS[entry.assetClass] || ASSET_LABELS.other,
      };
    }
    const fb = SYMBOL_META.XAUUSD;
    return {
      key,
      known: false,
      tv: fb.tv,
      label: fb.label,
      assetClass: fb.assetClass,
      assetLabel: ASSET_LABELS[fb.assetClass] || ASSET_LABELS.other,
    };
  }

  return {
    // สถานะเชื่อมระบบ
    isLive: true, // ข้อมูลสถานะตลาดสดพร้อมใช้ (มาจาก market ticker)
    eaConnected: EA_FEED_CONNECTED,
    source: "ข้อมูลตลาดสด (Market Ticker API)",
    sourceType: "market_data", // market_data | ea_mt5
    // API
    fetchSignals,
    getStats,
    subscribe,
    getSnapshot,
    refresh,
    resolveSymbol,
    // metadata (single source of truth)
    SYMBOL_META,
    ASSET_LABELS,
    ASSET_FILTERS: [
      { key: "all", label: "ทั้งหมด" },
      { key: "metals", label: "โลหะมีค่า" },
      { key: "forex", label: "ฟอเร็กซ์" },
      { key: "crypto", label: "คริปโต" },
      { key: "index", label: "ดัชนี" },
      { key: "commodity", label: "พลังงาน" },
    ],
    MOMENTUM_FILTERS: [
      { key: "all", label: "ทั้งหมด" },
      { key: "up", label: "ขาขึ้น" },
      { key: "down", label: "ขาลง" },
      { key: "flat", label: "นิ่ง" },
    ],
  };
})();
