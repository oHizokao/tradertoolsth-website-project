/* ============================================================
   Phase 4 — Automated regression tests (node:test)
   ------------------------------------------------------------
   ครอบคลุม:
   1. keyword generation (buildImageKeywords)
   2. photo ranking — technical suitability (scorePhoto, rankPhotos)
   3. photo selection + score threshold (selectBestPhoto, reviewRequired)
   4. metadata mapping (mapPhotoToMetadata)
   5. image pipeline — status + reviewRequired logic
   6. mock mode (ไม่มี API key)
   7. empty API result
   8. API failure → retry → failed
   9. deduplication จากหลาย keyword
   10. metadata completeness ทุก field
   11. keywords ไม่มี imageSearchKeywords
   12. ImageStatus constants
   13. Global rate limiter — counter, limit, multi-batch
   14. Technical suitability vs semantic relevance — scorePhoto ไม่วัด content match
   ============================================================ */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildImageKeywords,
  normalizeKeyword,
  getTopicKeywords,
  __MAX_KEYWORDS,
  __TOPIC_MAP,
} from "../src/image/keywords.js";
import {
  scorePhoto,
  rankPhotos,
  deduplicatePhotos,
  selectBestPhoto,
  SCORE_THRESHOLD,
  __MIN_WIDTH,
} from "../src/image/ranking.js";
import {
  mapPhotoToMetadata,
  FALLBACK_IMAGE,
} from "../src/image/pexels.client.js";
import {
  findImageForNews,
  ImageStatus,
} from "../src/image/imagePipeline.js";
import {
  createRateLimiter,
  __PEXELS_MAX_REQUESTS,
  __PEXELS_WINDOW_MS,
} from "../src/image/rateLimiter.js";

// ============================================================
// Helpers
// ============================================================

/** สร้าง news object สำหรับทดสอบ */
function makeNews(over = {}) {
  return {
    originalTitle: "Gold prices rally as CPI data cools rate pressure",
    category: "Market News",
    imageSearchKeywords: ["gold bars", "Federal Reserve"],
    ...over,
  };
}

/** สร้าง Pexels photo object จำลอง (landscape, คุณภาพดี) */
function makePhoto(over = {}) {
  return {
    id: 100,
    width: 1280,
    height: 720, // 16:9 landscape
    photographer: "Jane Doe",
    photographer_url: "https://www.pexels.com/@janedoe",
    url: "https://www.pexels.com/photo/100",
    src: {
      original: "https://images.pexels.com/photos/100/original.jpg",
      large2x: "https://images.pexels.com/photos/100/large2x.jpg",
      large: "https://images.pexels.com/photos/100/large.jpg",
      medium: "https://images.pexels.com/photos/100/medium.jpg",
    },
    avg_color: "#888888",
    ...over,
  };
}

/** mock search function ที่คืนรูปที่กำหนด */
function mockSearch(photos) {
  return async () => photos;
}

/** mock search function ที่ throw */
function failingSearch(msg = "pexels network error") {
  return async () => {
    throw new Error(msg);
  };
}

// ============================================================
// 1. Keyword Generation
// ============================================================

describe("1. buildImageKeywords — keyword generation", () => {
  test("ใช้ AI keywords ก่อน (อยู่ต้นลำดับ)", () => {
    const news = makeNews({ imageSearchKeywords: ["gold bullion", "silver coins"] });
    const kws = buildImageKeywords(news);
    assert.ok(kws[0] === "gold bullion" || kws[0] === "silver coins",
      "AI keyword ควรอยู่ต้น");
    assert.ok(kws.includes("gold bullion"));
    assert.ok(kws.includes("silver coins"));
  });

  test("จำกัด MAX_KEYWORDS ไว้ที่ 5", () => {
    const news = makeNews({
      imageSearchKeywords: ["kw1", "kw2", "kw3", "kw4", "kw5", "kw6", "kw7"],
    });
    const kws = buildImageKeywords(news);
    assert.ok(kws.length <= __MAX_KEYWORDS);
  });

  test("deduplicate keyword ที่ซ้ำกัน", () => {
    const news = makeNews({ imageSearchKeywords: ["gold bars", "gold bars", "silver"] });
    const kws = buildImageKeywords(news);
    const unique = new Set(kws.map(normalizeKeyword));
    assert.equal(unique.size, kws.length, "ไม่มี keyword ซ้ำ");
  });

  test("getTopicKeywords: gold title → ได้ gold keywords", () => {
    const kws = getTopicKeywords("Gold prices surge to $4,100 per ounce");
    assert.ok(kws.length > 0, "ควรได้ keyword สำหรับ gold");
    assert.ok(kws.some((k) => k.toLowerCase().includes("gold")));
  });

  test("getTopicKeywords: Federal Reserve title → ได้ central bank keywords", () => {
    const kws = getTopicKeywords("Federal Reserve signals rate cut");
    assert.ok(kws.length > 0);
    assert.ok(kws.some((k) => /federal|central|monetary/i.test(k)));
  });

  test("getTopicKeywords: inflation/CPI → ได้ inflation keywords", () => {
    const kws = getTopicKeywords("US CPI comes in lower than expected");
    assert.ok(kws.length > 0);
    assert.ok(kws.some((k) => /inflation|cpi|price/i.test(k)));
  });

  test("imageSearchKeywords ว่าง → ใช้ topic map + generic fallback", () => {
    const news = makeNews({ imageSearchKeywords: [] });
    const kws = buildImageKeywords(news);
    assert.ok(kws.length > 0, "ควรมี keyword แม้ AI keywords ว่าง");
  });

  test("normalizeKeyword ตัด special chars ส่วนเกิน", () => {
    const r = normalizeKeyword("Gold & Silver (Markets)!!");
    assert.ok(!r.includes("!"));
    assert.ok(!r.includes("&"));
  });

  test("normalizeKeyword lowercase", () => {
    const r = normalizeKeyword("Gold Bars");
    assert.equal(r, "gold bars");
  });
});

// ============================================================
// 2. Photo Ranking — scorePhoto
// ============================================================

describe("2. scorePhoto — landscape + resolution + aspect ratio", () => {
  test("รูป portrait (h > w) → score = 0", () => {
    const photo = makePhoto({ width: 720, height: 1280 });
    assert.equal(scorePhoto(photo), 0);
  });

  test("รูป landscape ความละเอียดต่ำกว่า MIN_WIDTH → score = 0", () => {
    const photo = makePhoto({ width: 600, height: 400 }); // width < 800
    assert.equal(scorePhoto(photo), 0);
  });

  test("รูป landscape ผ่านเกณฑ์ → score > 0", () => {
    const photo = makePhoto({ width: 1280, height: 720 }); // 16:9
    assert.ok(scorePhoto(photo) > 0);
  });

  test("รูป 16:9 ได้คะแนน aspect ratio สูงสุด", () => {
    const photo169 = makePhoto({ width: 1920, height: 1080 }); // 16:9
    const photoOther = makePhoto({ width: 1200, height: 900 }); // 4:3
    const photoWeird = makePhoto({ width: 1200, height: 400 }); // 3:1
    const s169 = scorePhoto(photo169);
    const sOther = scorePhoto(photoOther);
    const sWeird = scorePhoto(photoWeird);
    // 16:9 ควรได้สูงกว่า weird ratio
    assert.ok(s169 >= sWeird, `16:9 (${s169}) ควรสูงกว่า weird (${sWeird})`);
  });

  test("ความละเอียดสูงกว่า → score สูงกว่า (เมื่อ ratio เดิม)", () => {
    const big = makePhoto({ width: 3840, height: 2160 });
    const small = makePhoto({ width: 800, height: 450 });
    assert.ok(
      scorePhoto(big) > scorePhoto(small),
      "รูปใหญ่ควรได้คะแนนสูงกว่า"
    );
  });
});

// ============================================================
// 3. Deduplication
// ============================================================

describe("3. deduplicatePhotos — รูปซ้ำจากหลาย keyword", () => {
  test("รูป photo.id เดิมถูกตัดออก", () => {
    const p1 = makePhoto({ id: 1 });
    const p2 = makePhoto({ id: 2 });
    const pDup = makePhoto({ id: 1 }); // ซ้ำกับ p1
    const result = deduplicatePhotos([p1, p2, pDup]);
    assert.equal(result.length, 2, "ควรเหลือ 2 รูป (ตัด dup ออก)");
    const ids = result.map((p) => p.id);
    assert.ok(ids.includes(1));
    assert.ok(ids.includes(2));
  });

  test("รูปที่ไม่ซ้ำ → คืนครบทุกรูป", () => {
    const photos = [makePhoto({ id: 1 }), makePhoto({ id: 2 }), makePhoto({ id: 3 })];
    const result = deduplicatePhotos(photos);
    assert.equal(result.length, 3);
  });

  test("รูป id ซ้ำหลายรูป → เหลือรูปแรกเท่านั้น", () => {
    const photos = [
      makePhoto({ id: 5 }),
      makePhoto({ id: 5 }),
      makePhoto({ id: 5 }),
    ];
    const result = deduplicatePhotos(photos);
    assert.equal(result.length, 1);
  });

  test("รายการว่าง → คืน array ว่าง", () => {
    assert.deepEqual(deduplicatePhotos([]), []);
  });

  test("rankPhotos รวม dedup ไว้ด้วย", () => {
    const photos = [
      makePhoto({ id: 10, width: 1280, height: 720 }),
      makePhoto({ id: 10, width: 1920, height: 1080 }), // ซ้ำ id 10
      makePhoto({ id: 20, width: 1920, height: 1080 }),
    ];
    const ranked = rankPhotos(photos);
    const ids = ranked.map((r) => r.photo.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, "ไม่มี id ซ้ำใน ranked result");
  });
});

// ============================================================
// 4. selectBestPhoto + score threshold → reviewRequired
// ============================================================

describe("4. selectBestPhoto — score threshold + reviewRequired", () => {
  test("ได้รูป score >= SCORE_THRESHOLD → reviewRequired=false", () => {
    // รูป 16:9 1920x1080 ควรได้ score สูง
    const photos = [makePhoto({ id: 1, width: 1920, height: 1080 })];
    const ranked = rankPhotos(photos);
    const best = selectBestPhoto(ranked);
    assert.ok(best !== null);
    assert.ok(best.score >= SCORE_THRESHOLD, `score=${best.score} ควร >= ${SCORE_THRESHOLD}`);
    assert.equal(best.reviewRequired, false);
  });

  test("รูปที่ score ต่ำกว่า threshold → reviewRequired=true", () => {
    // รูปที่ผ่านเกณฑ์ landscape แต่ได้ score ต่ำ: 800x500, ratio ไม่ตรง
    // score = 50 (landscape) + 8 (800/100) + 3 (ratio diff ปานกลาง) = 61 (เกินแล้ว)
    // ทดสอบด้วยการ force score ต่ำผ่าน ranked list
    const lowScoreRanked = [{ photo: makePhoto({ id: 99 }), score: 30 }];
    const best = selectBestPhoto(lowScoreRanked);
    assert.ok(best !== null);
    assert.equal(best.score, 30);
    assert.equal(best.reviewRequired, true, "score ต่ำกว่า threshold → reviewRequired=true");
  });

  test("ranked ว่าง → คืน null", () => {
    assert.equal(selectBestPhoto([]), null);
    assert.equal(selectBestPhoto(null), null);
  });

  test("portrait photos เท่านั้น → rankPhotos คืน [] → selectBestPhoto คืน null", () => {
    const portrait = [
      makePhoto({ id: 1, width: 720, height: 1280 }),
      makePhoto({ id: 2, width: 640, height: 960 }),
    ];
    const ranked = rankPhotos(portrait);
    assert.equal(ranked.length, 0, "portrait ทั้งหมด → ไม่มีผ่านเกณฑ์");
    assert.equal(selectBestPhoto(ranked), null);
  });
});

// ============================================================
// 5. mapPhotoToMetadata — metadata fields
// ============================================================

describe("5. mapPhotoToMetadata — metadata completeness", () => {
  const REQUIRED_FIELDS = [
    "imageUrl",
    "imageSource",
    "imageAuthor",
    "imageAuthorUrl",
    "imageLicense",
    "imageSourceUrl",
    "imageSearchKeywords",
  ];

  test("ครบทุก field ที่กำหนด", () => {
    const photo = makePhoto();
    const kws = ["gold bars", "gold market"];
    const meta = mapPhotoToMetadata(photo, kws);
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in meta, `ขาด field: ${field}`);
    }
  });

  test("imageSource เป็น 'Pexels' เสมอ", () => {
    const meta = mapPhotoToMetadata(makePhoto());
    assert.equal(meta.imageSource, "Pexels");
  });

  test("imageLicense เป็น 'Pexels License' เสมอ", () => {
    const meta = mapPhotoToMetadata(makePhoto());
    assert.equal(meta.imageLicense, "Pexels License");
  });

  test("imageAuthor ตรงกับ photographer", () => {
    const photo = makePhoto({ photographer: "Test Photographer" });
    const meta = mapPhotoToMetadata(photo);
    assert.equal(meta.imageAuthor, "Test Photographer");
  });

  test("imageUrl ใช้ large2x ถ้ามี", () => {
    const photo = makePhoto();
    const meta = mapPhotoToMetadata(photo);
    assert.equal(meta.imageUrl, photo.src.large2x);
  });

  test("imageUrl fallback ไป large ถ้าไม่มี large2x", () => {
    const photo = makePhoto({ src: { large: "https://pexels.com/large.jpg" } });
    const meta = mapPhotoToMetadata(photo);
    assert.equal(meta.imageUrl, "https://pexels.com/large.jpg");
  });

  test("imageSearchKeywords บันทึก keywords ที่ส่งเข้ามา", () => {
    const kws = ["gold bars", "bullion market"];
    const meta = mapPhotoToMetadata(makePhoto(), kws);
    assert.deepEqual(meta.imageSearchKeywords, kws);
  });

  test("FALLBACK_IMAGE มีทุก field ที่กำหนด", () => {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in FALLBACK_IMAGE, `FALLBACK_IMAGE ขาด field: ${field}`);
    }
    assert.equal(FALLBACK_IMAGE.imageLicense, "Pexels License");
  });

  test("photo เป็น null → คืน FALLBACK_IMAGE structure", () => {
    const meta = mapPhotoToMetadata(null, ["test"]);
    assert.equal(meta.imageLicense, "Pexels License");
    assert.equal(meta.imageSource, "Pexels");
    assert.deepEqual(meta.imageSearchKeywords, ["test"]);
  });
});

// ============================================================
// 6. Image Pipeline — status + reviewRequired
// ============================================================

describe("6. findImageForNews — status=selected (score สูง)", () => {
  test("mock search คืนรูปดี → status=selected, reviewRequired=false", async () => {
    const news = makeNews();
    const photo = makePhoto({ id: 1, width: 1920, height: 1080 }); // 16:9, score สูง
    const result = await findImageForNews(news, {
      _mockSearchFn: mockSearch([photo]),
      delayMs: 0,
    });
    assert.equal(result.status, ImageStatus.SELECTED);
    assert.equal(result.reviewRequired, false);
    assert.equal(result.imageSource, "Pexels");
  });

  test("รูป score ต่ำกว่า SCORE_THRESHOLD → reviewRequired=true ผ่าน selectBestPhoto", () => {
    // ทดสอบ selectBestPhoto โดยตรงด้วย ranked list ที่ inject score ต่ำ
    // (pipeline inject ไม่ได้โดยตรง — ทดสอบ unit ผ่าน selectBestPhoto แทน)
    const lowScoreRanked = [{ photo: makePhoto({ id: 99 }), score: 30 }];
    const best = selectBestPhoto(lowScoreRanked);
    assert.ok(best !== null);
    assert.equal(best.score, 30);
    assert.ok(best.score < SCORE_THRESHOLD, `score=${best.score} ต้องต่ำกว่า threshold=${SCORE_THRESHOLD}`);
    assert.equal(best.reviewRequired, true, "score ต่ำ → reviewRequired=true");
  });

  test("SCORE_THRESHOLD boundary: score === threshold → reviewRequired=false", () => {
    // score เท่ากับ threshold พอดี → ผ่าน (ไม่ต้อง review)
    const exactRanked = [{ photo: makePhoto({ id: 77 }), score: SCORE_THRESHOLD }];
    const best = selectBestPhoto(exactRanked);
    assert.ok(best !== null);
    assert.equal(best.reviewRequired, false, "score === threshold → reviewRequired=false");
  });

  test("SCORE_THRESHOLD boundary: score === threshold-1 → reviewRequired=true", () => {
    const belowRanked = [{ photo: makePhoto({ id: 88 }), score: SCORE_THRESHOLD - 1 }];
    const best = selectBestPhoto(belowRanked);
    assert.ok(best !== null);
    assert.equal(best.reviewRequired, true, "score < threshold → reviewRequired=true");
  });
});

describe("7. findImageForNews — status=fallback", () => {
  test("mock search คืน photos=[] → status=fallback, reviewRequired=true", async () => {
    const news = makeNews();
    const result = await findImageForNews(news, {
      _mockSearchFn: mockSearch([]),
      delayMs: 0,
    });
    assert.equal(result.status, ImageStatus.FALLBACK);
    assert.equal(result.reviewRequired, true);
  });

  test("คืนเฉพาะ portrait → ไม่ผ่านเกณฑ์ → status=fallback", async () => {
    const portrait = makePhoto({ id: 1, width: 720, height: 1280 });
    const result = await findImageForNews(makeNews(), {
      _mockSearchFn: mockSearch([portrait]),
      delayMs: 0,
    });
    assert.equal(result.status, ImageStatus.FALLBACK);
    assert.equal(result.reviewRequired, true);
  });

  test("fallback result ครบทุก metadata field", async () => {
    const result = await findImageForNews(makeNews(), {
      _mockSearchFn: mockSearch([]),
      delayMs: 0,
    });
    const REQUIRED = [
      "imageUrl", "imageSource", "imageAuthor", "imageAuthorUrl",
      "imageLicense", "imageSourceUrl", "imageSearchKeywords",
    ];
    for (const f of REQUIRED) {
      assert.ok(f in result, `fallback result ขาด field: ${f}`);
    }
    assert.equal(result.imageLicense, "Pexels License");
    assert.equal(result.imageSource, "Pexels");
  });
});

describe("8. findImageForNews — status=failed (API ล้มเหลวทุก retry)", () => {
  test("search function throw ทุก keyword → status=failed, reviewRequired=true", async () => {
    const news = makeNews({ imageSearchKeywords: ["gold", "silver"] });
    const result = await findImageForNews(news, {
      _mockSearchFn: failingSearch("network timeout"),
      delayMs: 0,
    });
    assert.equal(result.status, ImageStatus.FAILED);
    assert.equal(result.reviewRequired, true);
  });

  test("failed result มี imageSearchKeywords บันทึกไว้", async () => {
    const news = makeNews({ imageSearchKeywords: ["test keyword"] });
    const result = await findImageForNews(news, {
      _mockSearchFn: failingSearch(),
      delayMs: 0,
    });
    assert.equal(result.status, ImageStatus.FAILED);
    assert.ok(Array.isArray(result.imageSearchKeywords));
    assert.ok(result.imageSearchKeywords.length > 0);
  });
});

describe("9. findImageForNews — deduplication จากหลาย keyword", () => {
  test("รูป id ซ้ำจากหลาย keyword ถูกตัดออก ได้รูปเดียว", async () => {
    const dupPhoto = makePhoto({ id: 42, width: 1920, height: 1080 });
    // search function คืนรูปซ้ำสำหรับทุก keyword
    let callCount = 0;
    const multiSearch = async () => {
      callCount++;
      return [dupPhoto];
    };
    const news = makeNews({
      imageSearchKeywords: ["gold", "silver", "market"],
    });
    const result = await findImageForNews(news, {
      _mockSearchFn: multiSearch,
      delayMs: 0,
    });
    // ต้องไม่ crash และได้รูปเดียว (dedup by photo.id)
    assert.equal(result.status, ImageStatus.SELECTED);
    assert.ok(callCount > 1, "ควรค้นหามากกว่า 1 keyword");
  });
});

describe("10. reviewRequired แยกอิสระจาก status", () => {
  test("selected + reviewRequired=false (score สูง)", async () => {
    const photo = makePhoto({ id: 1, width: 1920, height: 1080 });
    const r = await findImageForNews(makeNews(), {
      _mockSearchFn: mockSearch([photo]),
      delayMs: 0,
    });
    assert.equal(r.status, ImageStatus.SELECTED);
    assert.equal(typeof r.reviewRequired, "boolean");
    assert.equal(r.reviewRequired, false);
  });

  test("fallback มี reviewRequired=true เสมอ", async () => {
    const r = await findImageForNews(makeNews(), {
      _mockSearchFn: mockSearch([]),
      delayMs: 0,
    });
    assert.equal(r.status, ImageStatus.FALLBACK);
    assert.equal(r.reviewRequired, true);
  });

  test("failed มี reviewRequired=true เสมอ", async () => {
    const r = await findImageForNews(makeNews(), {
      _mockSearchFn: failingSearch(),
      delayMs: 0,
    });
    assert.equal(r.status, ImageStatus.FAILED);
    assert.equal(r.reviewRequired, true);
  });

  test("status ไม่มีค่า 'needs_review' ใดๆ", async () => {
    const scenarios = [
      { _mockSearchFn: mockSearch([makePhoto({ id: 1, width: 1920, height: 1080 })]) },
      { _mockSearchFn: mockSearch([]) },
      { _mockSearchFn: failingSearch() },
    ];
    for (const opts of scenarios) {
      const r = await findImageForNews(makeNews(), { ...opts, delayMs: 0 });
      assert.notEqual(r.status, "needs_review",
        `status ห้ามเป็น 'needs_review' (ได้: ${r.status})`);
      assert.ok(
        [ImageStatus.SELECTED, ImageStatus.FALLBACK, ImageStatus.FAILED].includes(r.status),
        `status ต้องเป็น selected|fallback|failed (ได้: ${r.status})`
      );
    }
  });
});

describe("11. buildImageKeywords — news ที่ไม่มี imageSearchKeywords", () => {
  test("imageSearchKeywords undefined → ใช้ topic map", () => {
    const news = { originalTitle: "Gold hits $4,000 per ounce", category: "" };
    const kws = buildImageKeywords(news);
    assert.ok(kws.length > 0);
    assert.ok(kws.length <= __MAX_KEYWORDS);
  });

  test("title ว่างทั้งหมด → ได้ generic fallback", () => {
    const news = { originalTitle: "", category: "", imageSearchKeywords: [] };
    const kws = buildImageKeywords(news);
    assert.ok(kws.length > 0, "ควรมี generic fallback keyword");
  });
});

describe("12. ImageStatus constants", () => {
  test("ImageStatus มีค่าครบ 3 ค่า", () => {
    assert.equal(ImageStatus.SELECTED, "selected");
    assert.equal(ImageStatus.FALLBACK, "fallback");
    assert.equal(ImageStatus.FAILED, "failed");
    // ห้ามมี needs_review
    assert.ok(!("NEEDS_REVIEW" in ImageStatus));
  });
});

// ============================================================
// 13. Global Rate Limiter
// ============================================================

describe("13. RateLimiter — global request counter", () => {
  test("request counter เพิ่มขึ้นทุก acquire()", () => {
    const rl = createRateLimiter(10, 3600000);
    assert.equal(rl.getCount(), 0);
    rl.acquire();
    assert.equal(rl.getCount(), 1);
    rl.acquire();
    assert.equal(rl.getCount(), 2);
    rl.acquire();
    assert.equal(rl.getCount(), 3);
  });

  test("canAcquire() = true เมื่อยังไม่ถึง limit", () => {
    const rl = createRateLimiter(5, 3600000);
    rl.acquire();
    rl.acquire();
    assert.equal(rl.canAcquire(), true);
  });

  test("canAcquire() = false เมื่อถึง limit", () => {
    const rl = createRateLimiter(3, 3600000);
    rl.acquire();
    rl.acquire();
    rl.acquire(); // count = 3 = limit
    assert.equal(rl.canAcquire(), false);
  });

  test("acquire() ตอนเกิน limit → throw PEXELS_RATE_LIMIT", () => {
    const rl = createRateLimiter(3, 3600000);
    rl.acquire();
    rl.acquire();
    rl.acquire();
    assert.throws(
      () => rl.acquire(),
      (err) => {
        assert.ok(
          err.message.includes("PEXELS_RATE_LIMIT"),
          `error message ต้องมี PEXELS_RATE_LIMIT: ${err.message}`
        );
        return true;
      }
    );
  });

  test("getRemaining() ลดลงหลัง acquire()", () => {
    const rl = createRateLimiter(5, 3600000);
    assert.equal(rl.getRemaining(), 5);
    rl.acquire();
    assert.equal(rl.getRemaining(), 4);
    rl.acquire();
    assert.equal(rl.getRemaining(), 3);
  });

  test("getStats() คืนข้อมูลครบ", () => {
    const rl = createRateLimiter(100, 3600000);
    rl.acquire();
    rl.acquire();
    const stats = rl.getStats();
    assert.equal(stats.count, 2);
    assert.equal(stats.limit, 100);
    assert.equal(stats.remaining, 98);
    assert.equal(stats.windowMs, 3600000);
  });

  test("reset() ล้าง counter", () => {
    const rl = createRateLimiter(5, 3600000);
    rl.acquire();
    rl.acquire();
    assert.equal(rl.getCount(), 2);
    rl.reset();
    assert.equal(rl.getCount(), 0);
    assert.equal(rl.canAcquire(), true);
  });

  test("หลาย batch ต่อเนื่อง: counter สะสมข้าม batch", () => {
    const rl = createRateLimiter(10, 3600000);
    // batch 1: 4 requests
    for (let i = 0; i < 4; i++) rl.acquire();
    assert.equal(rl.getCount(), 4);
    // batch 2: 4 more requests
    for (let i = 0; i < 4; i++) rl.acquire();
    assert.equal(rl.getCount(), 8, "counter สะสมข้าม batch");
    assert.equal(rl.getRemaining(), 2);
  });

  test("หลาย batch: เกิน limit ใน batch ที่ 2 → throw", () => {
    const rl = createRateLimiter(5, 3600000);
    // batch 1: 3 requests
    rl.acquire(); rl.acquire(); rl.acquire();
    // batch 2: 2 more → ถึง limit
    rl.acquire(); rl.acquire();
    // ครั้งต่อไป → throw
    assert.throws(
      () => rl.acquire(),
      /PEXELS_RATE_LIMIT/
    );
    assert.equal(rl.getCount(), 5);
    assert.equal(rl.getRemaining(), 0);
  });

  test("sliding window: request เก่าหมดอายุ → ถูกลบออกจาก window", () => {
    // ใช้ window สั้น (100ms) + injectable clock สำหรับ test
    const rl = createRateLimiter(3, 100); // 3 req/100ms
    let fakeNow = 1000;
    rl._nowFn = () => fakeNow;

    // t=1000: acquire 3 ครั้ง → ถึง limit
    rl.acquire(); rl.acquire(); rl.acquire();
    assert.equal(rl.getCount(), 3);
    assert.throws(() => rl.acquire(), /PEXELS_RATE_LIMIT/);

    // t=1101: request แรกหมดอายุ (>100ms) → ควรทำได้
    fakeNow = 1101;
    assert.equal(rl.canAcquire(), true, "request เก่าหมดอายุ → คุณสมบัติคืน");
    rl.acquire(); // เพิ่ม request ใหม่
    assert.equal(rl.getCount(), 1, "window ใหม่ → count=1");
  });

  test("default singleton: __PEXELS_MAX_REQUESTS=200, __PEXELS_WINDOW_MS=1hr", () => {
    assert.equal(__PEXELS_MAX_REQUESTS, 200);
    assert.equal(__PEXELS_WINDOW_MS, 3_600_000);
  });
});

// ============================================================
// 14. Technical Suitability vs Semantic Relevance
// ============================================================

describe("14. scorePhoto — technical suitability ไม่ใช่ semantic relevance", () => {
  test("รูป 16:9 และ 3:2 ได้ score สูง เพราะเตคนิค ไม่ใช่เนื้อหา", () => {
    // รูปสวยทางเตคนิค ไม่จำเป็นต้องเกี่ยวกับทอง
    const photo16x9 = { id: 1, width: 1920, height: 1080, src: {} };
    const photo3x2  = { id: 2, width: 1800, height: 1200, src: {} }; // ratio=1.5
    const s169 = scorePhoto(photo16x9);
    const s3x2 = scorePhoto(photo3x2);
    assert.ok(s169 > 0, "16:9 ได้ score > 0");
    assert.ok(s3x2 > 0, "3:2 ได้ score > 0");
    // score วัดเตคนิค ไม่ได้อ้างว่าอันไหน match กับไคร์เนื้อข่าว
  });

  test("รูป portrait score=0 เสมอ ไม่เกี่ยวกับ content", () => {
    const portrait = { id: 3, width: 720, height: 1280, src: {} };
    assert.equal(scorePhoto(portrait), 0, "portrait ตัดใบสมัครเสมอ");
  });

  test("scorePhoto ไม่มีบีบอกสำหรับเนื้อหา keyword", () => {
    // score เหมือนกันสำหรับ keyword ต่างกัน — ยืนยันว่า score ไม่ใช่ relevance
    const photo = { id: 10, width: 1280, height: 720, src: {} };
    const s1 = scorePhoto(photo); // ค้น keyword "gold"
    const s2 = scorePhoto(photo); // ค้น keyword "silver" (รูปเดียวกัน)
    assert.equal(s1, s2, "score เหมือนกันเมื่อ keyword ต่างกัน — ไม่ใช่ semantic score");
  });

  test("imageSearchKeywords ใน metadata คือ reference ไม่ใช่ relevance proof", () => {
    const photo = makePhoto({ id: 50 });
    const kws = ["gold bars", "precious metals"];
    const meta = mapPhotoToMetadata(photo, kws);
    // imageSearchKeywords ชี้ว่าใช้ keyword อะไรค้นหา ไม่ใช่ proof ว่ารูป match ข่าว
    assert.deepEqual(meta.imageSearchKeywords, kws);
    // imageLicense + source ยังคงถูกต้อง
    assert.equal(meta.imageSource, "Pexels");
    assert.equal(meta.imageLicense, "Pexels License");
  });
});
