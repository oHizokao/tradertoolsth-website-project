import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..", "..", "Version-2-Gold-Trading");

const topic = {
  id: "ft-0123456789abcdef",
  title: "ทดสอบโครงสร้างการ์ดกระทู้",
  body: "เนื้อหาสำหรับตรวจ smoke test ของหน้า Forum",
  categorySlug: "general",
  authorName: "Tester",
  createdAt: "2026-07-17T00:00:00.000Z",
  lastActivityAt: "2026-07-17T00:00:00.000Z",
  replyCount: 2,
  viewCount: 10,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function render(scriptName, url, serviceOverrides = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url,
    runScripts: "outside-only",
  });
  await new Promise((resolveTick) => dom.window.setTimeout(resolveTick, 0));

  dom.window.TT = {
    site: { name: "TraderToolsTH" },
    icon: () => "",
    h: {
      esc: escapeHtml,
      truncate: (value, max) => String(value ?? "").slice(0, max),
      formatBangkok: () => "17 ก.ค. 2026 07:00 น.",
      query: (name) => new URL(dom.window.location.href).searchParams.get(name),
    },
    layout: {
      ticker: () => "",
      page: ({ main }) => `<main id="main">${main}</main>`,
      initNavbar: () => {},
    },
    ForumService: {
      listCategories: async () => [
        { slug: "general", name: "พูดคุยทั่วไป", description: "พูดคุย", topicCount: 1 },
      ],
      getCategory: async () => ({
        slug: "general",
        name: "พูดคุยทั่วไป",
        description: "พูดคุย",
        topicCount: 1,
      }),
      getStats: async () => ({ topics: 1, posts: 2, members: 1 }),
      listTopics: async () => ({ items: [topic], total: 1, hasMore: false }),
      hasIdentity: () => false,
      ...serviceOverrides,
    },
  };

  const source = readFileSync(resolve(frontend, scriptName), "utf8");
  dom.window.eval(source);
  await new Promise((resolveTick) => dom.window.setTimeout(resolveTick, 20));
  return dom;
}

function assertValidForumCard(document) {
  assert.equal(document.querySelectorAll("a a").length, 0, "ต้องไม่มีลิงก์ซ้อนลิงก์");
  assert.equal(document.querySelectorAll(".forum-card-link").length, 1);
  assert.equal(document.querySelectorAll(".forum-cat-pill--link").length, 1);
  assert.match(document.querySelector(".forum-card-link").getAttribute("href"), /forum-topic\.html/);
  assert.match(document.querySelector(".forum-cat-pill--link").getAttribute("href"), /forum-category\.html/);
}

test("Forum timeline renders valid independent topic/category links", async () => {
  const dom = await render("forum.js", "http://127.0.0.1/forum.html");
  assertValidForumCard(dom.window.document);
  dom.window.close();
});

test("Forum category timeline renders valid independent topic/category links", async () => {
  const dom = await render(
    "forum-category.js",
    "http://127.0.0.1/forum-category.html?category=general"
  );
  assertValidForumCard(dom.window.document);
  dom.window.close();
});
