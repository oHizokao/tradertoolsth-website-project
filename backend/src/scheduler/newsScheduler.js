import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

const log = logger.make("scheduler");

export function createNewsScheduler(updater, opts = {}) {
  const intervalMinutes = Math.max(
    1,
    opts.intervalMinutes ?? config.scheduler.intervalMinutes
  );
  const intervalMs = intervalMinutes * 60 * 1000;
  let timer = null;
  let lastRun = null;
  let lastResult = null;
  let lastError = null;

  async function runNow() {
    lastRun = new Date().toISOString();
    try {
      lastResult = await updater.run(opts.runOptions || {});
      lastError = null;
      return lastResult;
    } catch (error) {
      lastError = error.message;
      log.error(`scheduled update failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  function start() {
    if (timer) return false;
    timer = setInterval(() => void runNow(), intervalMs);
    log.info(`scheduler started: every ${intervalMinutes} minutes`);
    if (opts.runOnStart ?? config.scheduler.runOnStart) void runNow();
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    return true;
  }

  function status() {
    return {
      enabled: !!timer,
      running: updater.running,
      intervalMinutes,
      lastRun,
      lastResult,
      lastError,
    };
  }

  return { start, stop, runNow, status };
}
