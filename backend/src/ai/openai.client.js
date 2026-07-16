/* ============================================================
   OpenAI Client — เรียก OpenAI Chat Completions API
   ------------------------------------------------------------
   คุณสมบัติ:
   - ใช้ native fetch (ไม่ต้องลง dependency เพิ่ม)
   - retry + timeout + backoff
   - บันทึก usage ลง costTracker อัตโนมัติ
   - **mock mode**: ถ้าไม่มี API key → คืนผลจำลองเพื่อทดสอบ pipeline
     โดยไม่เสียเงิน (ใช้สำหรับ dev/test เท่านั้น)
   - ห้าม log API key เด็ดขาด (logger redact อยู่แล้ว)
   ============================================================ */

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { costTracker } from "./costTracker.js";

const log = logger.make("openai");
const API_URL = "https://api.openai.com/v1/chat/completions";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * สร้าง mock response สำหรับทดสอบ (ไม่เรียก API จริง)
 * คืน JSON string ที่คล้ายกับ output จริง เพื่อให้ pipeline ทำงานได้
 */
function mockChatCompletion(messages, model) {
  // หาข้อความระบบเพื่อเดาว่าเป็น task อะไร
  const sysText = messages.find((m) => m.role === "system")?.content || "";
  const userText = messages.find((m) => m.role === "user")?.content || "";

  let content;
  if (sysText.includes("เรียบเรียงข่าว") || sysText.includes("rewriter")) {
    content = JSON.stringify({
      thaiTitle: "[MOCK] ทองคำขยับหลังข้อมูลเงินเฟ้อ",
      thaiSummary:
        "[MOCK สรุป] ราคาทองคำปรับตัวขึ้นหลังข้อมูลเงินเฟ้อออกมาต่ำกว่าคาด ตลาดเริ่มคาดการลดดอกเบี้ย",
      thaiContent: [
        "[MOCK เนื้อหา 1] ราคาทองคำปรับตัวขึ้นในการซื้อขายช่วงเอเชีย",
        "[MOCK เนื้อหา 2] นักวิเคราะห์มองว่าแนวโน้มยังเป็นบวกในระยะกลาง",
      ],
      marketFactors: "[MOCK ปัจจัยต่อตลาดทองคำ] ดอกเบี้ย, ดอลลาร์, เงินเฟ้อ",
      keyFacts: ["[MOCK fact 1]", "[MOCK fact 2]"],
      mentionedNumbers: [],
      imageSearchKeywords: ["gold bars financial market", "Federal Reserve"],
    });
  } else if (sysText.includes("ตรวจสอบ") || sysText.includes("validator")) {
    // Mock validator — คืนผลปลอมที่ผ่าน schema ครบทุก safety field (QC รอบ 2 Finding 2)
    // แต่ระบุ mockOnly=true เพื่อให้ pipeline รู้ว่าผลนี้ไม่น่าเชื่อถือ
    // และห้าม validated (สถานะสูงสุด = needs_review)
    content = JSON.stringify({
      isValid: true,
      mockOnly: true,
      bannedWordsFound: [],
      investmentAdviceFound: false,
      numbersMatch: true,
      numberMismatches: [],
      addedInformationFound: false,
      confidence: 80,
      notes: "[MOCK validation — ไม่ใช่ผลจริง ห้ามใช้เพื่อ validated]",
    });
  } else {
    content = "[MOCK completion for: " + (userText.slice(0, 60)) + "]";
  }

  return {
    id: "mock-" + Date.now(),
    object: "chat.completion",
    model,
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
    ],
    usage: {
      prompt_tokens: Math.ceil(userText.length / 4) + 200,
      completion_tokens: Math.ceil(content.length / 4) + 100,
      total_tokens: 0,
    },
    _mock: true,
  };
}

/**
 * เรียก OpenAI Chat Completions
 *
 * @param {object} opts
 *   - messages: [{role, content}]
 *   - model: ชื่อโมเดล (default จาก config)
 *   - temperature: default 0.3 (ข่าวต้องนิ่ง)
 *   - responseFormat: 'json' หรือ 'text'
 *   - timeoutMs, retries
 *   - forceMock: บังคับ mock (ทดสอบ)
 * @returns {Promise<{ content: string, usage: object, raw: object, mock: boolean }>}
 */
export async function chat(opts = {}) {
  const messages = opts.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages ต้องเป็น array ที่ไม่ว่าง");
  }

  const model = opts.model || config.openai.model;
  const temperature = opts.temperature ?? 0.3;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const retries = opts.retries ?? 2;
  const apiKey = config.openai.apiKey;

  // ---- Mock vs Real resolution (QC รอบ 1: ปิดช่องโหว่) ----
  // - requireReal=true: ต้องเรียกจริงเท่านั้น ถ้าไม่มี key → throw (ห้าม fallback mock)
  // - forceMock=true: บังคับ mock
  // - AUTO (ค่าเริ่มต้น): มี key → real, ไม่มี key → mock (แต่ mock=true ชัดเจน)
  const requireReal = opts.requireReal === true;
  if (requireReal && !apiKey) {
    // fail fast — ห้าม fallback เป็น mock เด็ดขาด
    throw new Error(
      "MISSING_OPENAI_API_KEY: โหมด --real ต้องการ OPENAI_API_KEY แต่ไม่พบ " +
        "(ห้าม fallback เป็น mock ตามนโยบาย QC)"
    );
  }
  const useMock = opts.forceMock || !apiKey;
  if (useMock) {
    if (opts.forceMock) {
      log.debug("forceMock — ใช้ผลจำลอง");
    } else {
      log.warn(
        "ไม่พบ OPENAI_API_KEY — ใช้โหมด mock (ผลลัพธ์จำลอง ไม่เรียก API จริง)"
      );
    }
    const mock = mockChatCompletion(messages, model);
    costTracker.estimate(
      model,
      JSON.stringify(messages).length,
      mock.choices[0].message.content.length
    );
    return {
      content: mock.choices[0].message.content,
      usage: mock.usage,
      raw: mock,
      mock: true,
    };
  }

  // โหมดจริง
  const body = {
    model,
    messages,
    temperature,
  };
  if (opts.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`, // ไม่ log
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      const usage = data.usage || null;
      if (usage) costTracker.record(model, usage);

      log.debug(`chat OK (model=${model}, tok=${usage?.total_tokens || "?"})`);
      return { content, usage, raw: data, mock: false };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const aborted = err.name === "AbortError";
      log.warn(
        `OpenAI call attempt ${attempt + 1}/${retries + 1} failed: ${err.message}` +
          (aborted ? " (timeout)" : "")
      );
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("OpenAI call failed");
}

/** helper: สร้าง messages แล้วเรียก chat แบบ JSON mode */
export async function chatJson(opts = {}) {
  const res = await chat({ ...opts, responseFormat: "json" });
  let parsed;
  try {
    parsed = JSON.parse(res.content);
  } catch (err) {
    // บางครั้ง model ห่อ JSON ใน ```json ... ``` หรือมีข้อความนำ
    const m = res.content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        throw new Error(`แยก JSON ไม่ได้: ${err.message}`);
      }
    } else {
      throw new Error(`แยก JSON ไม่ได้: ${err.message}`);
    }
  }
  return { ...res, json: parsed };
}
