/* ============================================================
   Logger — เขียนไป console พร้อม timestamp + level
   ในอนาคตเปลี่ยนเป็นเขียนลง file ได้ที่นี่ที่เดียว
   ห้าม log API key หรือ secret ใดๆ
   ============================================================ */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || "info"] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function fmt(level, tag, msg, extra) {
  const base = `[${ts()}] ${level.toUpperCase()} [${tag}] ${msg}`;
  if (extra === undefined) return base;
  // ทำความสะอาด: ถ้ามี field ที่คล้าย secret ให้ซ่อน
  const safe =
    extra && typeof extra === "object"
      ? JSON.stringify(redact(extra))
      : String(extra);
  return `${base} ${safe}`;
}

// ซ่อน field ที่อาจเป็น secret กันลืม
const SECRET_KEYS = /^(api[_-]?key|apikey|secret|token|password|auth)$/i;
function redact(obj) {
  if (Array.isArray(obj)) return obj.map(redact);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SECRET_KEYS.test(k) ? "***" : redact(v);
    }
    return out;
  }
  return obj;
}

function make(tag) {
  return {
    info: (msg, extra) =>
      currentLevel >= LEVELS.info && console.log(fmt("info", tag, msg, extra)),
    warn: (msg, extra) =>
      currentLevel >= LEVELS.warn && console.warn(fmt("warn", tag, msg, extra)),
    error: (msg, extra) =>
      currentLevel >= LEVELS.error &&
      console.error(fmt("error", tag, msg, extra)),
    debug: (msg, extra) =>
      currentLevel >= LEVELS.debug && console.log(fmt("debug", tag, msg, extra)),
  };
}

export const logger = { make };
