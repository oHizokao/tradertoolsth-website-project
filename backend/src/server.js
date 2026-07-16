import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config/env.js";
import { openDb, closeDb } from "./store/db.js";
import { createNewsRepository } from "./store/newsRepository.js";
import { createAutoPilotRepository } from "./store/autoPilotRepository.js";
import { createAuditRepository } from "./store/auditRepository.js";
import { createNewsUpdater } from "./pipeline/runNewsUpdate.js";
import { createNewsScheduler } from "./scheduler/newsScheduler.js";
import { createAutoPilot } from "./autopilot/autoPilot.js";
import { createHttpServer, listen } from "./api/server.js";
import { logger } from "./utils/logger.js";

const log = logger.make("server");
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");
const db = openDb();
const repo = createNewsRepository(db);
const apRepo = createAutoPilotRepository(db);
const auditRepo = createAuditRepository(db);
const ctx = { db, repo };
const updater = createNewsUpdater(ctx);
const scheduler = createNewsScheduler(updater);
const autoPilot = createAutoPilot({ repo, apRepo, auditRepo });
const server = createHttpServer({
  repo,
  updater,
  scheduler,
  autoPilot,
  auditRepo,
  projectRoot,
  siteVersion: config.server.siteVersion,
  adminToken: config.server.adminToken,
  adminAllowedOrigins: config.server.adminAllowedOrigins,
});

const address = await listen(server, {
  host: config.server.host,
  port: config.server.port,
});

// Phase 9 — Auto Pilot scheduler: รันเฉพาะเมื่อ env allowed
// run-once ภายในเช็ค DB enabled อีกทีด้วย (autoPilot.canRun)
let autoPilotTimer = null;
function startAutoPilotScheduler() {
  if (autoPilotTimer) return false;
  const intervalMs = Math.max(1, config.autoPilot.intervalMinutes) * 60 * 1000;
  autoPilotTimer = setInterval(() => {
    // เช็ค env+DB ทั้งคู่ก่อน trigger (safety)
    if (!autoPilot.canRun()) return;
    log.info("auto pilot scheduled tick — triggering runOnce");
    autoPilot.runOnce().catch((err) =>
      log.error(`auto pilot scheduled run failed: ${err.message}`)
    );
  }, intervalMs);
  log.info(`auto pilot scheduler armed: every ${config.autoPilot.intervalMinutes} min (env allowed=${config.autoPilot.enabled})`);
  return true;
}
function stopAutoPilotScheduler() {
  if (!autoPilotTimer) return false;
  clearInterval(autoPilotTimer);
  autoPilotTimer = null;
  return true;
}

// ค่าเริ่มต้น: scheduler ทั้งคู่ปิด — เปิดเฉพาะเมื่อ env อนุญาตเท่านั้น
if (config.scheduler.enabled) scheduler.start();
if (config.autoPilot.enabled) startAutoPilotScheduler();

const shownHost = address.address === "::" ? "localhost" : address.address;
log.info(`website ready: http://${shownHost}:${address.port}/`);
log.info(`site: http://${shownHost}:${address.port}/Version-2-Gold-Trading/home.html`);
log.info(`admin: http://${shownHost}:${address.port}/Version-2-Gold-Trading/admin.html`);
log.info(`Auto Pilot: env=${config.autoPilot.enabled ? "allowed" : "off"} (DB setting ควบคุมการรันจริง)`);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`shutting down (${signal})`);
  scheduler.stop();
  stopAutoPilotScheduler();
  await new Promise((resolveClose) => server.close(resolveClose));
  closeDb();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
