/* ============================================================
   Cost Tracker — ติดตามการใช้ token และค่าใช้จ่าย OpenAI
   (ตามข้อกำหนด: ระบบต้องมี Cost Tracking)
   ============================================================ */

// ราคาต่อ 1M token (USD) — อ้างอิงราคา gpt-4o-mini (อัปเดตได้ตามจริง)
// source: OpenAI pricing (อาจเปลี่ยน — ใช้ค่าประมาณการ)
const PRICING_PER_M = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
};

const DEFAULT_RATE = { input: 0.15, output: 0.6 }; // fallback

function rateFor(model) {
  return PRICING_PER_M[model] || DEFAULT_RATE;
}

class CostTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.calls = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.totalCostUsd = 0;
    this.byModel = {}; // model -> {calls, prompt, completion, cost}
  }

  /** บันทึกการใช้งาน 1 ครั้ง (รับจาก usage object ของ OpenAI) */
  record(model, usage) {
    if (!usage) return;
    const pt = usage.prompt_tokens || 0;
    const ct = usage.completion_tokens || 0;
    const tt = usage.total_tokens || pt + ct;
    const rate = rateFor(model);
    const cost = (pt / 1_000_000) * rate.input + (ct / 1_000_000) * rate.output;

    this.calls += 1;
    this.promptTokens += pt;
    this.completionTokens += ct;
    this.totalTokens += tt;
    this.totalCostUsd += cost;

    if (!this.byModel[model]) {
      this.byModel[model] = { calls: 0, prompt: 0, completion: 0, cost: 0 };
    }
    this.byModel[model].calls += 1;
    this.byModel[model].prompt += pt;
    this.byModel[model].completion += ct;
    this.byModel[model].cost += cost;
  }

  /** ประมาณค่าใช้จ่ายหากไม่มี usage จริง (mock/test) */
  estimate(model, promptChars, completionChars) {
    // สมมุติ ~4 chars/token
    const pt = Math.ceil(promptChars / 4);
    const ct = Math.ceil(completionChars / 4);
    this.record(model, { prompt_tokens: pt, completion_tokens: ct });
  }

  summary() {
    return {
      calls: this.calls,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      totalCostUsd: Number(this.totalCostUsd.toFixed(6)),
      totalCostThb: Number((this.totalCostUsd * 36).toFixed(4)), // อัตราประมาณ
      byModel: this.byModel,
    };
  }

  /** ปริ้นต์สรุปแบบอ่านง่าย */
  print(logger) {
    const s = this.summary();
    const fmt = (n) => n.toLocaleString();
    logger.info("── Cost Tracking ──");
    logger.info(`  calls         : ${s.calls}`);
    logger.info(`  prompt tokens : ${fmt(s.promptTokens)}`);
    logger.info(`  output tokens : ${fmt(s.completionTokens)}`);
    logger.info(`  total tokens  : ${fmt(s.totalTokens)}`);
    logger.info(`  cost (USD)    : $${s.totalCostUsd.toFixed(6)}`);
    logger.info(`  cost (THB ~)  : ฿${s.totalCostThb.toFixed(4)}`);
    for (const [model, m] of Object.entries(s.byModel)) {
      logger.info(
        `  [${model}] ${m.calls} calls, ${fmt(m.prompt + m.completion)} tok, $${m.cost.toFixed(6)}`
      );
    }
  }
}

export const costTracker = new CostTracker();
export { CostTracker };
