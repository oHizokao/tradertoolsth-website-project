import { config } from "../config/env.js";
import { openDb, closeDb } from "../store/db.js";
import { createNewsRepository } from "../store/newsRepository.js";
import { createNewsUpdater } from "../pipeline/runNewsUpdate.js";

async function main() {
  if (!config.openai.apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add a newly rotated key to backend/.env first.");
  }
  if (!config.pexels.apiKey) {
    console.warn("PEXELS_API_KEY is missing: articles will be held for image review.");
  }
  const db = openDb();
  const repo = createNewsRepository(db);
  const updater = createNewsUpdater({ db, repo });
  const report = await updater.run();
  console.log(JSON.stringify(report, null, 2));
  closeDb();
  if (!report.ok || report.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  closeDb();
  process.exitCode = 1;
});
