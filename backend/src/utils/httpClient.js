/* ============================================================
   HTTP Client — fetch พร้อม timeout, retry, rate limit
   ใช้ native fetch ของ Node 22 (ไม่ต้องลง dependency)
   ============================================================ */

import { config } from "../config/env.js";
import { logger } from "./logger.js";

const log = logger.make("http");

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * ดึง HTML/text พร้อม timeout + retry
 * @param {string} url
 * @param {object} opts { headers, timeoutMs, retries, accept }
 */
export async function getText(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? config.scraper.httpTimeoutMs;
  const retries = opts.retries ?? config.scraper.httpRetries;
  const headers = {
    "User-Agent": DEFAULT_UA,
    Accept: opts.accept || "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
    ...(opts.headers || {}),
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      log.debug(`GET ${url} -> ${text.length} bytes (attempt ${attempt + 1})`);
      return text;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const aborted = err.name === "AbortError";
      log.warn(
        `GET ${url} failed attempt ${attempt + 1}/${retries + 1}: ${err.message}` +
          (aborted ? " (timeout)" : "")
      );
      if (attempt < retries) {
        // backoff เล็กน้อย: 1s, 2s, ...
        await sleep(1000 * (attempt + 1));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`fetch failed: ${url}`);
}

/**
 * ดึง JSON (สำหรับเรียก API ในอนาคต เช่น OpenAI / Pexels)
 */
export async function getJson(url, opts = {}) {
  const text = await getText(url, {
    ...opts,
    accept: "application/json",
  });
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON from ${url}: ${err.message}`);
  }
}
