/* ============================================================
   Link-integrity test — Version-2-Gold-Trading frontend
   ------------------------------------------------------------
   Statically scans every *.html and *.js under the frontend dir
   for local navigation (href="..." + location.href assigns) and
   asserts:
     - local .html targets resolve to an existing page
     - no javascript: URLs
     - no empty / "undefined" hrefs
     - external (http(s):, //, mailto:, tel:, data:) and pure-anchors
       are preserved (not flagged)
   Dynamic hrefs (href="${...}") that begin with a literal local
   page (e.g. "signal.html?symbol=${...}") are resolved against
   the literal leading segment; fully-dynamic hrefs are skipped
   because they are runtime/external URLs that cannot be resolved
   statically.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";

const projectRoot = resolve(process.cwd(), "..");
const FRONTEND_DIR = join(projectRoot, "Version-2-Gold-Trading");

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      // skip asset/vendor dirs — only scan first-level source files
      if (name === "assets" || name === "node_modules" || name === "data") continue;
      listFiles(p, out);
    } else if (st.isFile()) {
      const ext = extname(name);
      if (ext === ".html" || ext === ".js") out.push(p);
    }
  }
  return out;
}

function isExternal(url) {
  return (
    /^https?:\/\//i.test(url) ||
    url.startsWith("//") ||
    url.startsWith("mailto:") ||
    url.startsWith("tel:") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  );
}

function isPureAnchor(url) {
  return url.startsWith("#");
}

// Extract a literal leading local page from a (possibly dynamic) href.
// Returns the .html filename if statically resolvable, else null.
function localHtmlTarget(raw) {
  let v = raw.trim();
  if (!v) return null;
  if (isExternal(v) || isPureAnchor(v)) return null;
  // strip <base>-style absolute site root
  v = v.replace(/^\/Version-2-Gold-Trading\//, "");
  // take the leading literal run up to the first '?', '#', or template '${'
  const m = /^([^\s?#${]*)/.exec(v);
  if (!m) return null;
  const seg = m[1];
  if (!seg) return null;
  // must be a local page reference ending in .html
  if (!/\.html$/i.test(seg)) return null;
  return seg;
}

function collectHrefs(text) {
  const out = [];
  // href="..." and href='...'
  const re = /href=(["'])([^"']*)\1/gi;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ value: m[2], raw: m[0] });
  // location.href = "..." / location.assign("...")
  const re2 = /location\.(?:href\s*=|assign\()\s*["']([^"']+)["']/gi;
  while ((m = re2.exec(text)) !== null) out.push({ value: m[1], raw: m[0] });
  return out;
}

test("frontend navigations: every local href resolves; no javascript:/empty hrefs", () => {
  assert.ok(
    existsSync(FRONTEND_DIR),
    `frontend dir missing: ${FRONTEND_DIR} (run from backend/)`,
  );
  const files = listFiles(FRONTEND_DIR);
  assert.ok(files.length > 0, "no frontend files scanned");

  const existingHtml = new Set(
    readdirSync(FRONTEND_DIR).filter((f) => f.endsWith(".html")),
  );

  const problems = [];
  let scannedHrefs = 0;
  let localChecked = 0;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = file.replace(FRONTEND_DIR + "/", "").replace(/\\/g, "/");
    for (const { value, raw } of collectHrefs(text)) {
      scannedHrefs++;
      const v = value.trim();

      // hard rules
      if (/^javascript:/i.test(v)) {
        problems.push(`${rel}: javascript: URL → ${raw}`);
        continue;
      }
      if (v === "" || /^undefined$/i.test(v)) {
        problems.push(`${rel}: empty/undefined href → ${raw}`);
        continue;
      }

      const target = localHtmlTarget(v);
      if (target) {
        localChecked++;
        if (!existingHtml.has(target)) {
          problems.push(`${rel}: broken local href → "${v}" (missing ${target})`);
        }
      }
      // external / pure-anchor / fully-dynamic → OK (preserved)
    }
  }

  assert.ok(
    localChecked > 0,
    "expected to check at least one local href (scanner sanity)",
  );
  assert.equal(
    problems.length,
    0,
    `broken frontend links:\n${problems.join("\n")}`,
  );
});
