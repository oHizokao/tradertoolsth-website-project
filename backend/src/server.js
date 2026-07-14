import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config/env.js";
import { openDb, closeDb } from "./store/db.js";
import { createNewsRepository } from "./store/newsRepository.js";
import { createNewsUpdater } from "./pipeline/runNewsUpdate.js";
import { createNewsScheduler } from "./scheduler/newsScheduler.js";
import { createHttpServer, listen } from "./api/server.js";
import { logger } from "./utils/logger.js";

const log = logger.make("server");
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");
const db = openDb();
const repo = createNewsRepository(db);
const updater = createNewsUpdater({ db, repo });
const scheduler = createNewsScheduler(updater);
const server = createHttpServer({
  repo,
  updater,
  scheduler,
  projectRoot,
  siteVersion: config.server.siteVersion,
  adminToken: config.server.adminToken,
});

const address = await listen(server, {
  host: config.server.host,
  port: config.server.port,
});

if (config.scheduler.enabled) scheduler.start();

const shownHost = address.address === "::" ? "localhost" : address.address;
log.info(`website ready: http://${shownHost}:${address.port}/`);
log.info(`V1: http://${shownHost}:${address.port}/v1/ | V2: http://${shownHost}:${address.port}/v2/`);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`shutting down (${signal})`);
  scheduler.stop();
  await new Promise((resolveClose) => server.close(resolveClose));
  closeDb();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
