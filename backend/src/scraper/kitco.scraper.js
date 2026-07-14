/* ============================================================
   Kitco Scraper — รุ่นแรก
   ------------------------------------------------------------
   ดึงข่าวจาก Kitco News Digest โดยไม่ใช้ Firecrawl

   หลักการ:
   - หน้า /news/digest ถูก Next.js ส่ง HTML + embedded JSON
     ใน <script id="__NEXT_DATA__"> (server-rendered)
   - รายการข่าวอยู่ใน props.pageProps.dehydratedState.queries
     แยกตาม queryKey:
       * newsByCategoryGeneric  -> nodeListByCategory.items
       * digestLatestNews       -> nodeListQueue.items
       * digestStreetTalk       -> nodeList.items
       * newsOTWList            -> nodeList.items
   - เนื้อหาเต็มไม่อยู่ใน list → เปิดแต่ละ article แยก
     แล้วอ่าน props.pageProps.articleData.bodyWithEmbeddedMedia.value
   - ดึง HTML ด้วย native fetch (Node 22) + timeout/retry
     หากโครงสร้างเปลี่ยน → โยน StructureError เพื่อหยุดปลอดภัย

   หมายเหตุ: ใช้ cheerio เฉพาะตอนล้าง HTML body เป็น plain text
   ============================================================ */

import { load as cheerioLoad } from "cheerio";

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getText } from "../utils/httpClient.js";
import { duplicateHash } from "../utils/hash.js";
import { createEmptyNews, NewsStatus } from "../utils/schema.js";
import { isRelevant, tagTopic } from "../utils/filter.js";
import { checkAge } from "../utils/date.js";
import { dedupeList } from "../store/duplicate.js";

const log = logger.make("kitco");
const BASE = "https://www.kitco.com";
const DIGEST_URL = `${BASE}/news/digest?sitetype=fullsite`;

// แมป queryKey ชื่อ → ชื่อ section ที่เราใช้ + ฟิลด์ที่เก็บ items
const SECTION_RESOLVERS = {
  newsByCategoryGeneric: (q) => {
    const sub = q.queryKey[1] || {};
    const alias = sub.urlAlias || "";
    // แปลง /news/category/commodities -> Market News
    // /news/category/mining -> Mining
    let label = "Market News";
    if (alias.includes("/mining")) label = "Mining";
    return {
      label,
      items: q.state.data?.nodeListByCategory?.items || [],
    };
  },
  digestLatestNews: (q) => ({
    label: "Latest Metals News",
    items: q.state.data?.nodeListQueue?.items || [],
  }),
  digestStreetTalk: (q) => ({
    label: "Street Talk",
    items: q.state.data?.nodeList?.items || [],
  }),
  newsOTWList: (q) => ({
    label: "Off The Wire",
    items: q.state.data?.nodeList?.items || [],
  }),
};

class StructureError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "StructureError";
  }
}

// ---------- HTML / JSON extraction ----------

/**
 * ดึง __NEXT_DATA__ JSON จากหน้า Kitco
 */
async function fetchNextData(url) {
  const html = await getText(url);
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) {
    throw new StructureError(
      `ไม่พบ __NEXT_DATA__ ที่ ${url} — โครงสร้าง Kitco อาจเปลี่ยน`
    );
  }
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
    throw new StructureError(`parse __NEXT_DATA__ ไม่ได้: ${err.message}`);
  }
  const queries =
    data?.props?.pageProps?.dehydratedState?.queries;
  if (!queries) {
    throw new StructureError(
      `ไม่พบ dehydratedState.queries — โครงสร้าง Kitco อาจเปลี่ยน`
    );
  }
  return { data, queries, html };
}

// ---------- Normalizers ----------

/** ทำให้ item ข่าว (จากหลายรูปแบบ) เป็นมาตรฐานเดียว */
function normalizeItem(raw, section) {
  // Street Talk ใช้ฟิลด์ `url` ซึ่งอาจเป็น full URL ของเว็บภายนอก
  // (เช่น https://www.mining.com/...) ส่วน article อื่นใช้ `urlAlias` (relative path)
  const rawUrl = raw.urlAlias || raw.url || "";
  const isExternal = /^https?:\/\//i.test(rawUrl);
  const urlAlias = isExternal ? "" : rawUrl; // urlAlias เก็บเฉพาะ relative path
  const sourceUrl = isExternal ? rawUrl : urlAlias ? `${BASE}${urlAlias}` : "";

  const sourceName =
    (raw.source && (raw.source.name || raw.source)) || "";
  const authorName =
    (raw.author && (raw.author.name || raw.author)) || "";
  const categoryName =
    (raw.category && raw.category.name) || "";

  return {
    id: String(raw.id ?? ""),
    section,
    source: sourceName,
    sourceUrl,
    urlAlias,
    isExternal,
    originalTitle: raw.title || raw.teaserHeadline || "",
    originalAuthor: authorName,
    originalPublishedAt: raw.createdAt || null,
    category: categoryName,
    teaser: raw.teaserSnippet || "",
    topics: tagTopic({
      title: raw.title,
      teaserSnippet: raw.teaserSnippet,
      category: { name: categoryName },
    }),
  };
}

// ---------- Public API ----------

/**
 * ดึงรายการข่าวทั้งหมดจาก Digest (รวม 5 sections)
 *
 * ลำดับการประมวลผล (ตามข้อกำหนด QC):
 *   1. รวม items จากทุก query ที่ resolve เป็น label เดียวกันเข้าด้วยกันก่อน
 *      (เช่น newsByCategoryGeneric หลาย query อาจเป็น "Market News")
 *   2. กรองเฉพาะข่าวที่เกี่ยวข้อง (isRelevant)
 *   3. กรองอายุข่าว (maxAgeHours, default 48) — ข่าวเก่าถูกตัด
 *      หากอ่านวันที่ไม่ได้ → แยกไป needsReview (ไม่อยู่ในผลลัพธ์หลัก)
 *   4. dedupeList ข้าม section ทั้งหมด — คืนเฉพาะ accepted
 *   5. ตัดตาม maxPerSection (หลังรวม label แล้ว)
 *
 * @param {object} opts { maxPerSection, maxAgeHours, sections }
 * @returns {Promise<{
 *   items: NormalizedItem[],          // accepted เท่านั้น (dedupe แล้ว)
 *   needsReview: NormalizedItem[],    // อ่านวันที่ไม่ได้ — ให้ตรวจด้วยมือ
 *   sections: Array,                  // สถิติรวมต่อ label (ไม่ซ้ำ)
 *   stats: { htmlBytes, totalRaw, totalRelevant, totalAgedOut, beforeDedupe, afterDedupe }
 * }>}
 */
export async function fetchDigest(opts = {}) {
  const maxPerSection = opts.maxPerSection ?? config.scraper.maxPerSection;
  const maxAgeHours = opts.maxAgeHours ?? config.scraper.maxAgeHours;
  const wantSections =
    opts.sections ||
    [
      "Latest Metals News",
      "Market News",
      "Mining",
      "Street Talk",
      "Off The Wire",
    ];

  const { queries, html } = await fetchNextData(DIGEST_URL);

  // 1) รวม items ตาม label (กัน label ซ้ำ)
  //    map: label -> { rawItems: [], }
  const byLabel = new Map();
  for (const q of queries) {
    const keyName = q.queryKey && q.queryKey[0];
    const resolver = SECTION_RESOLVERS[keyName];
    if (!resolver) continue;
    const { label, items } = resolver(q);
    if (!wantSections.includes(label)) continue;
    if (!byLabel.has(label)) byLabel.set(label, { rawItems: [] });
    byLabel.get(label).rawItems.push(...items);
  }

  if (byLabel.size === 0) {
    throw new StructureError(
      "ไม่พบ section ที่คาดไว้เลย — โครงสร้าง queryKey ของ Kitco อาจเปลี่ยน"
    );
  }

  // 2) ประมวลผลแต่ละ label: normalize → relevant → age filter
  const sectionStats = [];
  const acceptedByLabel = new Map(); // label -> NormalizedItem[]
  const needsReview = [];
  let totalRaw = 0;
  let totalRelevant = 0;
  let totalAgedOut = 0;

  for (const [label, { rawItems }] of byLabel) {
    totalRaw += rawItems.length;
    const normalized = rawItems.map((it) => normalizeItem(it, label));
    const relevant = normalized.filter(isRelevant);
    totalRelevant += relevant.length;

    let fresh = 0;
    let agedOut = 0;
    let unreadable = 0;
    const kept = [];
    for (const item of relevant) {
      const age = checkAge(item.originalPublishedAt, maxAgeHours);
      if (age.reason === "unreadable_date") {
        unreadable++;
        needsReview.push(item); // อ่านวันที่ไม่ได้ → needs_review
        continue;
      }
      if (!age.ok) {
        agedOut++;
        continue;
      }
      kept.push(item);
      fresh++;
    }
    totalAgedOut += agedOut;

    sectionStats.push({
      section: label,
      rawCount: rawItems.length, // รวมจากทุก query ที่เป็น label เดียวกันแล้ว
      relevant: relevant.length,
      fresh, // ผ่าน age filter
      agedOut,
      unreadableDate: unreadable,
    });
    acceptedByLabel.set(label, kept);
    log.info(
      `section "${label}": ${rawItems.length} raw → ${relevant.length} relevant → ${fresh} fresh (${agedOut} aged, ${unreadable} unreadable)`
    );
  }

  // 3) รวม accepted ทั้งหมดเข้าด้วยกัน แล้ว dedupe ข้าม section
  //    (dedupeList ตรวจซ้ำทั้ง url, hash, ชื่อเหมือน, ชื่อคล้าย)
  const beforeDedupe = [];
  for (const [, list] of acceptedByLabel) beforeDedupe.push(...list);

  // ตัดตาม maxPerSection ต่อ label ก่อน dedupe เพื่อให้ limit เป็น per-section จริง
  // (ถ้าไม่ตัดก่อน dedupe ข่าวจาก label ใหญ่อาจถูกกีดกัน label เล็ก)
  const limitedBeforeDedupe = [];
  for (const [label, list] of acceptedByLabel) {
    const sliced = list.slice(0, maxPerSection);
    limitedBeforeDedupe.push(...sliced);
  }

  const { accepted, skipped } = dedupeList(limitedBeforeDedupe, []);
  const afterDedupe = accepted.length;

  log.info(
    `digest fetched: ${totalRaw} raw → ${totalRelevant} relevant → ${beforeDedupe.length} fresh → (limit ${maxPerSection}/section) → ${limitedBeforeDedupe.length} → dedupe → ${afterDedupe} accepted`,
    {
      agedOut: totalAgedOut,
      needsReview: needsReview.length,
      duplicates: skipped.length,
    }
  );

  return {
    items: accepted, // dedupe แล้ว — ไม่มี URL ซ้ำ
    needsReview,
    sections: sectionStats,
    skipped,
    stats: {
      htmlBytes: html.length,
      totalRaw,
      totalRelevant,
      totalAgedOut,
      beforeDedupe: limitedBeforeDedupe.length,
      afterDedupe,
      duplicates: skipped.length,
      maxAgeHours,
    },
  };
}

/**
 * ล้าง HTML body ของบทความให้เป็น plain text สะอาด
 * - เก็บโครง <p> → คั่นด้วยบรรทัดว่าง
 * - ตัดโฆษณา / related / nav ที่อาจติดมา (เผื่อไว้)
 */
function cleanBodyHtml(htmlBody) {
  if (!htmlBody) return "";
  const $ = cheerioLoad(`<div id="root">${htmlBody}</div>`);
  // ตัดสิ่งที่ไม่ใช่เนื้อข่าว
  $(
    "script,style,noscript,iframe,aside,.ad,.ads,.advert,.related,.newsletter,.promo"
  ).remove();
  // รวมข้อความตาม block
  const blocks = [];
  $("#root")
    .find("p,h1,h2,h3,h4,li,blockquote")
    .each((_, el) => {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      if (txt) blocks.push(txt);
    });
  // fallback ถ้าไม่มี block tag เลย ให้เอา text ทั้งหมด
  let text = blocks.join("\n\n").trim();
  if (!text) {
    text = $("#root").text().replace(/\s+/g, " ").trim();
  }
  return text;
}

/**
 * เปิดบทความเดี่ยวและดึงเนื้อหาเต็ม
 * คืน object ที่พร้อม map เข้า News schema
 *
 * @param {NormalizedItem} item
 * @returns {Promise<object>} full news object (status: fetched)
 */
export async function fetchArticle(item) {
  if (!item.sourceUrl) throw new Error("item ไม่มี sourceUrl");

  // Street Talk ส่วนใหญ่เป็นลิงก์ข่าวจากเว็บภายนอก (Mining.com, Economic Times ฯลฯ)
  // ไม่ใช่บทความ Kitco จึงไม่มี __NEXT_DATA__ — เก็บเฉพาะ metadata ไม่ดึงเนื้อหา
  if (item.isExternal) {
    const news = createEmptyNews();
    news.id = `kitco-street-${item.id}`;
    news.source = item.source || "Street Talk (external)";
    news.sourceUrl = item.sourceUrl;
    news.originalTitle = item.originalTitle;
    news.originalAuthor = item.originalAuthor;
    news.originalPublishedAt = item.originalPublishedAt;
    news.category = item.category;
    news.originalContent = ""; // external — ไม่ดึงเนื้อหาต้นทาง
    news.duplicateHash = duplicateHash({
      urlAlias: item.urlAlias || item.sourceUrl,
      title: news.originalTitle,
    });
    news.topics = item.topics;
    news.section = item.section;
    news.teaser = item.teaser;
    news.isExternal = true;
    news.validationStatus = NewsStatus.FETCHED;
    news.publishStatus = NewsStatus.FETCHED;
    log.info(
      `external link (Street Talk) — เก็บ metadata เท่านั้น: ${news.originalTitle}`.slice(0, 80)
    );
    return news;
  }

  const { data } = await fetchNextData(item.sourceUrl);
  const art =
    data?.props?.pageProps?.articleData ||
    data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data
      ?.nodeByUrlAlias;

  if (!art) {
    throw new StructureError(
      `ไม่พบ articleData ที่ ${item.sourceUrl} — โครงสร้างอาจเปลี่ยน`
    );
  }

  const rawBody = art.bodyWithEmbeddedMedia?.value || "";
  const cleanText = cleanBodyHtml(rawBody);

  if (!cleanText) {
    log.warn(`body ว่างหลังล้าง: ${item.sourceUrl}`);
  }

  const news = createEmptyNews();
  news.id = `kitco-${art.id ?? item.id}`;
  news.source = art.source?.name || item.source || "Kitco News";
  news.sourceUrl = item.sourceUrl;
  news.originalTitle = art.title || item.originalTitle;
  news.originalAuthor =
    art.author?.name || item.originalAuthor || "";
  news.originalPublishedAt = art.createdAt || item.originalPublishedAt;
  news.category = art.category?.name || item.category || "";
  news.originalContent = cleanText;
  news.duplicateHash = duplicateHash({
    urlAlias: item.urlAlias,
    title: news.originalTitle,
  });
  news.topics = item.topics;
  news.section = item.section;
  news.teaser = art.teaserSnippet || item.teaser || "";
  news.validationStatus = NewsStatus.FETCHED;
  news.publishStatus = NewsStatus.FETCHED;

  return news;
}

/**
 * Rate-limited helper: เปิดหลายบทความตามลำดับ พร้อมหน่วงเวลา
 * คืน { results: News[], errors: [{item, error}] }
 */
export async function fetchArticles(items, opts = {}) {
  const delayMs = opts.delayMs ?? config.scraper.articleDelayMs;
  const results = [];
  const errors = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const news = await fetchArticle(item);
      results.push(news);
      log.info(
        `article ${i + 1}/${items.length} OK: "${news.originalTitle}".slice(0,60) (${news.originalContent.length} chars)`
      );
    } catch (err) {
      errors.push({ item, error: err });
      const level = err instanceof StructureError ? "error" : "warn";
      log[level](`article ${i + 1}/${items.length} FAIL: ${err.message}`, {
        url: item.sourceUrl,
      });
      if (err instanceof StructureError) {
        // โครงสร้างเปลี่ยน → หยุดปลอดภัย
        log.error(
          "StructureError ตรวจพบ — หยุดการ scrape ที่เหลือเพื่อความปลอดภัย"
        );
        break;
      }
    }
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { results, errors };
}

export { StructureError };
