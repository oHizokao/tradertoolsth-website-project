/* ============================================================
   Card Components — Signal / News / Broker / Calendar / Knowledge
   ============================================================ */

window.TT = window.TT || {};

TT.cards = (function () {
  const h = TT.h;

  // ---------- Signal Card ----------
  function signalCard(s) {
    const dirText = s.direction === "buy" ? "BUY" : "SELL";
    const dirClass = s.direction === "buy" ? "badge--buy" : "badge--sell";
    const tierBadge =
      s.tier === "premium"
        ? `<span class="badge badge--premium">PREMIUM</span>`
        : `<span class="badge badge--demo">DEMO</span>`;
    const statusDot =
      s.status === "active"
        ? `<span class="dot dot--live"></span>`
        : `<span class="dot dot--closed"></span>`;
    const statusText = h.statusText(s.status);
    const tp = Array.isArray(s.takeProfit)
      ? s.takeProfit.map((t) => h.num(t, t > 100 ? 0 : 2)).join(" / ")
      : h.num(s.takeProfit, 2);

    const pnlBlock =
      s.status === "closed"
        ? `<span class="${
            s.result === "win" ? "text-buy" : "text-sell"
          }">${s.result === "win" ? "+" : ""}${s.pnlPips} pips</span>`
        : `<span>${statusText}</span>`;

    return `<article class="card card--hover card--glow signal-card" data-signal="${s.id}">
      <div class="card__head">
        <div class="cluster">
          <span class="badge ${dirClass}">${dirText}</span>
          ${tierBadge}
        </div>
        <div class="cluster">
          <span class="badge">${h.esc(s.symbol)}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <h3 class="card__title">${h.esc(s.name)}</h3>
        <span class="text-muted" style="font-size:var(--fs-xs)">${h.formatTime(
          s.time,
          { timeOnly: true }
        )}</span>
      </div>
      <div class="signal-row">
        <div class="signal-field">
          <span class="signal-field__label">Entry</span>
          <span class="signal-field__value">${h.num(s.entry, 2)}</span>
        </div>
        <div class="signal-field">
          <span class="signal-field__label">Stop Loss</span>
          <span class="signal-field__value text-sell">${h.num(s.stopLoss, 2)}</span>
        </div>
        <div class="signal-field">
          <span class="signal-field__label">Take Profit</span>
          <span class="signal-field__value text-buy">${tp}</span>
        </div>
        <div class="signal-field">
          <span class="signal-field__label">สถานะ</span>
          <span class="signal-field__value" style="display:inline-flex;align-items:center;gap:6px">
            ${statusDot} ${statusText}
          </span>
        </div>
      </div>
      ${
        s.note
          ? `<p style="margin-top:12px;font-size:var(--fs-sm);color:var(--text-secondary)">${h.esc(
              s.note
            )}</p>`
          : ""
      }
      <div class="signal-card__footer">
        <span>${h.formatTime(s.time)}</span>
        ${pnlBlock}
      </div>
    </article>`;
  }

  // ---------- News Card ----------
  function newsCard(n) {
    const catLabel = n.category === "gold" ? "ทองคำ" : "Forex";
    const catBadge =
      n.category === "gold" ? "badge--lime" : "badge--accent";
    return `<article class="card card--hover news-card">
      <a href="news-detail.html?slug=${encodeURIComponent(
        n.slug
      )}" class="news-card__media" aria-label="${h.esc(n.title)}">
        <img src="${h.esc(n.cover)}" alt="${h.esc(
      n.title
    )}" loading="lazy" onerror="this.style.display='none'">
        <span class="badge ${catBadge} news-card__cat">${catLabel}</span>
      </a>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="badge badge--${n.impact}">${h.impactText(n.impact)} Impact</span>
        <span class="text-muted" style="font-size:var(--fs-xs)">${n.readMinutes} นาที</span>
      </div>
      <h3 class="news-card__title">
        <a href="news-detail.html?slug=${encodeURIComponent(
          n.slug
        )}" style="color:inherit">${h.esc(n.title)}</a>
      </h3>
      <p class="news-card__excerpt">${h.esc(n.excerpt)}</p>
      <div class="news-card__meta">
        <span>${h.formatBangkok(n.sourcePublishedAt || n.publishedAt, { prefix: "" })}</span>
        <a href="news-detail.html?slug=${encodeURIComponent(
          n.slug
        )}" class="section-link">อ่านต่อ</a>
      </div>
    </article>`;
  }

  // ---------- Broker Card ----------
  // แสดงเฉพาะข้อมูลที่ตรวจสอบได้จากแหล่งทางการ
  // ไม่แสดง score / stars / spread / โบนัส เพราะไม่มีแหล่งอ้างอิงที่ตรวจสอบได้
  function brokerCard(b) {
    const status = h.verificationStatusInfo(b.verificationStatus);
    const regs = (b.regulations || [])
      .map((r) => `<span class="badge badge--ghost">${h.esc(r.regulator)}</span>`)
      .join("");
    const minDeposits = (b.accountTypes || [])
      .map((a) => {
        const v =
          a.minDepositUsd === null || a.minDepositUsd === undefined
            ? "—"
            : a.minDepositUsd === 0
            ? "ไม่ระบุขั้นต่ำ"
            : `$${h.num(a.minDepositUsd, 0)}`;
        return `${h.esc(a.name)}: <span class="num">${v}</span>`;
      })
      .join(" · ");
    return `<article class="card card--hover broker-card">
      <div class="card__head">
        <div style="display:flex;align-items:center;gap:12px;min-width:0">
          <div class="broker-hero__logo" style="width:48px;height:48px;font-size:var(--fs-md);color:${h.esc(
            b.logoColor
          )}">${h.esc(b.shortName)}</div>
          <div style="min-width:0">
            <h3 class="card__title">${h.esc(b.name)}</h3>
            <span class="badge ${status.cls}" style="margin-top:4px">${h.esc(status.label)}</span>
          </div>
        </div>
        <label class="broker-compare-toggle" title="เลือกเพื่อเปรียบเทียบ">
          <input type="checkbox" class="broker-compare__cb" data-slug="${h.esc(
            b.slug
          )}" aria-label="เลือก ${h.esc(b.name)} เพื่อเปรียบเทียบ">
          <span class="broker-compare__mark"></span>
        </label>
      </div>

      <div class="broker-card__regs" style="margin:10px 0;min-height:24px">${regs}</div>

      <div class="broker-card__specs">
        <div class="spec">
          <span class="spec__label">ฝากขั้นต่ำ (รายบัญชี)</span>
          <span class="spec__value">${minDeposits || h.orPending(null)}</span>
        </div>
        <div class="spec">
          <span class="spec__label">Platform</span>
          <span class="spec__value">${h.esc((b.platforms || []).join(", "))}</span>
        </div>
        <div class="spec">
          <span class="spec__label">ช่องทางฝากถอน</span>
          <span class="spec__value">${
            b.fundingMethods && b.fundingMethods.length
              ? h.esc(h.truncate(b.fundingMethods.join(", "), 60))
              : h.orPending(null)
          }</span>
        </div>
        <div class="spec">
          <span class="spec__label">ตรวจสอบเมื่อ</span>
          <span class="spec__value num">${h.esc(b.verifiedAt)}</span>
        </div>
      </div>

      <p style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:12px">${h.esc(
        h.truncate(b.overview, 130)
      )}</p>

      <div class="cluster" style="gap:8px">
        <a href="broker-detail.html?slug=${encodeURIComponent(
          b.slug
        )}" class="btn btn--soft btn--sm btn--block">ดูรายละเอียด &amp; แหล่งอ้างอิง</a>
      </div>
    </article>`;
  }

  // ---------- Calendar Row ----------
  // รองรับทั้ง field ใหม่จาก API (scheduledAtUtc/eventName/actual/forecast/previous/isTentative)
  // และ field เดิม (time/event) เพื่อ backward-compat
  function calendarRow(e) {
    const impact = e.impact || "low";
    const impactBadge = `<span class="badge badge--${impact}">${h.impactText(
      impact
    )}</span>`;
    // time แบบ Asia/Bangkok ไม่พึ่ง timezone เครื่อง — ใช้ scheduledAtUtc แล้ว +7
    const iso = e.scheduledAtUtc || e.time;
    const timeCell = e.isTentative
      ? `<span class="num text-muted" title="เวลายังไม่แน่นอน">~${h.formatBangkok(iso, { timeOnly: true, prefix: "" })}</span>`
      : `<span class="num">${h.formatBangkok(iso, { timeOnly: true, prefix: "" })}</span>`;
    // currency badge + ไฟล์ภาพธงประเทศจากรหัสสกุลเงิน
    const currency = String(e.currency || e.country || "").trim().toUpperCase();
    const flag = currencyFlagSrc(currency);
    const currencyCell = `<span class="cluster"><img class="currency-flag" src="${h.esc(flag)}" alt="ธง ${h.esc(
      currency
    )}" width="24" height="16" loading="lazy"><span class="badge">${h.esc(currency)}</span></span>`;
    // Actual: ถ้ามี ใช้สีตามทิศทาง (เทียบ forecast); ถ้าไม่มี แสดง —
    const actualCell = e.actual
      ? `<span class="num ${actualDirectionClass(e)}">${h.esc(e.actual)}</span>`
      : `<span class="text-muted">—</span>`;
    const eventCell = e.isTentative
      ? `${h.esc(e.eventName || e.event)} <span class="badge badge--ghost" title="เวลายังไม่แน่นอน">Tentative</span>`
      : h.esc(e.eventName || e.event);
    return `<tr>
      <td>${timeCell}</td>
      <td>${currencyCell}</td>
      <td>${impactBadge}</td>
      <td>${eventCell}</td>
      <td class="num">${e.previous ? h.esc(e.previous) : `<span class="text-muted">—</span>`}</td>
      <td class="num">${e.forecast ? h.esc(e.forecast) : `<span class="text-muted">—</span>`}</td>
      <td>${actualCell}</td>
    </tr>`;
  }

  /** แปลงรหัสสกุลเงิน (USD/EUR/...) → ไฟล์ภาพธงใน assets/flags */
  function currencyFlagSrc(currency) {
    const code = String(currency || "").trim().toUpperCase();
    const CURRENCY_TO_FILE = {
      USD: "us", EUR: "eu", GBP: "gb", JPY: "jp", AUD: "au",
      NZD: "nz", CAD: "ca", CHF: "ch",
      US: "us", USA: "us", GB: "gb", UK: "gb", EU: "eu",
      JP: "jp", AU: "au", NZ: "nz", CA: "ca", CH: "ch",
    };
    return `assets/flags/${CURRENCY_TO_FILE[code] || "global"}.svg`;
  }

  /** กำหนดสี Actual: actual > forecast → text-buy, < → text-sell, เท่ากัน/เทียบไม่ได้ → ปกติ */
  function actualDirectionClass(e) {
    const a = parseNumeric(e.actual);
    const f = parseNumeric(e.forecast);
    if (a == null || f == null) return "";
    if (a > f) return "text-buy";
    if (a < f) return "text-sell";
    return "";
  }

  /** parse "0.3%" / "235K" / "-1.2B" → number (สำหรับเทียบทิศทาง Actual) */
  function parseNumeric(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([KMBT]?)%?$/i);
    if (!m) return null;
    const num = parseFloat(m[1]);
    const mult = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()] || 1;
    return num * mult;
  }

  // ---------- EA Card ----------
  // รองรับทั้ง field ดิบจาก API (platform string, type, coverImage) และ normalized
  // (TT.EAService.normalizeOne จะแปลงให้แล้ว แต่ card ยังทำงานได้แม้ไม่ normalize)
  function eaCard(ea) {
    if (!ea) return "";
    const id = encodeURIComponent(ea.id || ea.slug || "");
    const name = h.esc(ea.name || "EA");
    const desc = h.esc(h.truncate(ea.description || ea.excerpt || "", 130));

    // platform — รองรับ array (normalized) และ string ดิบ ("mt4"|"mt5"|"both")
    const platforms = normalizePlatforms(ea);
    const platformBadges = platforms
      .map((p) => {
        const cls = /mt5/i.test(p) ? "badge--accent" : "badge--teal";
        return `<span class="badge ${cls}">${h.esc(p)}</span>`;
      })
      .join("");

    // ราคา/ประเภท: ใช้ type ("free"|"paid") เป็นหลัก, fallback ไป price
    const priceNum = Number(ea.price);
    const type = String(ea.type || "").toLowerCase();
    const isFree =
      type === "free" || (!type && !isNaN(priceNum) && priceNum === 0);
    const priceBlock = isFree
      ? `<span class="ea-card__price ea-card__price--free">ฟรี</span>`
      : `<span class="ea-card__price">$${h.num(isNaN(priceNum) ? 0 : priceNum, 2)}</span>`;

    // กลยุทธ์
    const strategy = ea.strategy ? h.esc(ea.strategy) : "";

    // เวอร์ชัน
    const version = ea.version ? h.esc(ea.version) : "";

    // วันที่อัปเดต — publishedAt หรือ updatedAt
    const updatedIso = ea.updatedAt || ea.updated_at || ea.publishedAt || ea.date;
    const updated = updatedIso ? h.formatBangkok(updatedIso, { prefix: "" }) : "";

    // รูปปก — coverImage (relative path หรือ URL)
    const cover = ea.cover || ea.image || ea.coverImage || "";

    const coverBlock = cover
      ? `<div class="ea-card__cover">
          <img src="${h.esc(cover)}" alt="${name}" loading="lazy" onerror="this.parentNode.classList.add('is-broken')">
        </div>`
      : `<div class="ea-card__cover ea-card__cover--placeholder" aria-hidden="true">
          ${eaCoverPlaceholder(ea)}
        </div>`;

    return `<article class="card card--hover ea-card" data-ea-id="${id}">
      ${coverBlock}
      <div class="ea-card__body">
        <div class="card__head ea-card__head">
          <div class="cluster ea-card__platforms">${platformBadges}</div>
          ${priceBlock}
        </div>
        <h3 class="card__title ea-card__title">${name}</h3>
        <p class="ea-card__desc">${desc}</p>
        <div class="ea-card__specs">
          ${strategy ? `<span class="spec-mini"><span class="spec-mini__label">กลยุทธ์</span><span class="spec-mini__value">${strategy}</span></span>` : ""}
          ${version ? `<span class="spec-mini"><span class="spec-mini__label">เวอร์ชัน</span><span class="spec-mini__value">v${version}</span></span>` : ""}
          ${updated ? `<span class="spec-mini"><span class="spec-mini__label">อัปเดต</span><span class="spec-mini__value">${updated}</span></span>` : ""}
        </div>
        <div class="ea-card__footer">
          <button type="button" class="btn btn--soft btn--sm ea-card__detail-btn" data-ea-detail="${id}">
            ${TT.icon("knowledge", 14)} ดูรายละเอียด
          </button>
          <a href="${ea.downloadUrl || ea.purchaseUrl || "#"}"
             class="btn ${isFree ? "btn--primary" : "btn--teal"} btn--sm ea-card__cta"
             ${ea.downloadUrl || ea.purchaseUrl ? "" : 'aria-disabled="true" role="button"'}>
            ${isFree ? "ดาวน์โหลด" : "ซื้อเลย"}
            ${TT.icon("arrow", 14)}
          </a>
        </div>
      </div>
    </article>`;
  }

  /** normalize platform เป็น array ของ label ที่แสดงได้ — รองรับทั้ง array, string enum */
  function normalizePlatforms(ea) {
    if (Array.isArray(ea.platforms)) return ea.platforms;
    if (Array.isArray(ea.platform)) return ea.platform;
    const p = String(ea.platform || "").toLowerCase();
    if (p === "both") return ["MT4", "MT5"];
    if (p === "mt4") return ["MT4"];
    if (p === "mt5") return ["MT5"];
    if (p) return [ea.platform];
    return [];
  }

  /** placeholder รูปปก EA แบบ inline SVG — ไม่ใช้รูปภายนอก */
  function eaCoverPlaceholder(ea) {
    const initial = String(ea.name || "EA").trim().charAt(0).toUpperCase() || "E";
    // unique id สำหรับ SVG gradient (sanitized เป็น alnum, กัน collision ระหว่างการ์ด)
    const raw = String(ea.id || ea.slug || ea.name || "x")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 12) || "x";
    const gid = "eaGrad" + raw;
    return `<span class="ea-cover-ph__letter">${h.esc(initial)}</span>
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0d2943"/>
            <stop offset="100%" stop-color="#061a30"/>
          </linearGradient>
        </defs>
        <rect width="200" height="120" fill="url(#${gid})"/>
        <path d="M0,90 L40,70 L75,80 L110,50 L150,60 L200,30 L200,120 L0,120 Z"
              fill="rgba(229,179,63,0.18)"/>
        <path d="M0,95 L40,75 L75,85 L110,55 L150,65 L200,35"
              fill="none" stroke="rgba(229,179,63,0.45)" stroke-width="1.5"/>
      </svg>`;
  }

  // ---------- Knowledge Card ----------
  function knowledgeCard(k) {
    return `<article class="card card--hover knowledge-card">
      <span class="knowledge-card__num">${h.esc(k.category)}</span>
      <h3 class="knowledge-card__title">
        <a href="knowledge.html#${encodeURIComponent(
          k.slug
        )}" style="color:inherit">${h.esc(k.title)}</a>
      </h3>
      <p class="knowledge-card__desc">${h.esc(k.excerpt)}</p>
      <div class="news-card__meta" style="margin-top:12px">
        <span>${k.readMinutes} นาทีอ่าน</span>
        <a href="knowledge.html#${encodeURIComponent(
          k.slug
        )}" class="section-link">อ่าน</a>
      </div>
    </article>`;
  }

  return {
    signalCard,
    newsCard,
    brokerCard,
    calendarRow,
    currencyFlagSrc,
    knowledgeCard,
    eaCard,
  };
})();
