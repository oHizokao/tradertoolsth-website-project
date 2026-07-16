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
  function brokerCard(b) {
    return `<article class="card card--hover broker-card">
      <div class="card__head">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="broker-hero__logo" style="width:48px;height:48px;font-size:var(--fs-md);color:${h.esc(
            b.logoColor
          )}">${h.esc(b.shortName)}</div>
          <div>
            <h3 class="card__title">${h.esc(b.name)}</h3>
            <div class="stars" aria-label="${b.rating} จาก 5">${h.stars(
      b.rating
    )}</div>
          </div>
        </div>
        <div class="score">
          <span class="score__num">${h.num(b.score, 1)}</span>
          <span class="score__max">/10</span>
        </div>
      </div>
      <div class="broker-card__specs">
        <div class="spec">
          <span class="spec__label">ใบอนุญาต</span>
          <span class="spec__value">${h.esc(b.license)}</span>
        </div>
        <div class="spec">
          <span class="spec__label">Spread</span>
          <span class="spec__value">${h.esc(b.spread)}</span>
        </div>
        <div class="spec">
          <span class="spec__label">ฝากขั้นต่ำ</span>
          <span class="spec__value">$${h.num(b.minDeposit, 0)}</span>
        </div>
        <div class="spec">
          <span class="spec__label">Platform</span>
          <span class="spec__value">${h.esc(b.platform.join(", "))}</span>
        </div>
      </div>
      <p style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:12px">${h.esc(
        h.truncate(b.overview, 110)
      )}</p>
      <a href="broker-detail.html?slug=${encodeURIComponent(
        b.slug
      )}" class="btn btn--soft btn--sm btn--block">ดูรีวิวเต็ม</a>
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
    // currency badge + ธงประเทศ (ใช้ emoji flag จากรหัสสกุลเงิน)
    const flag = currencyFlag(e.currency || e.country);
    const currencyCell = `<span class="cluster"><span aria-hidden="true">${h.esc(flag)}</span><span class="badge">${h.esc(
      e.currency || e.country || ""
    )}</span></span>`;
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

  /** แปลงรหัสสกุลเงิน (USD/EUR/...) → emoji ธงประเทศ (ใช้ regional indicator) */
  function currencyFlag(currency) {
    const COUNTRY_TO_FLAG = {
      USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵", AUD: "🇦🇺",
      NZD: "🇳🇿", CAD: "🇨🇦", CHF: "🇨🇭", CNY: "🇨🇳", HKD: "🇭🇰",
      SGD: "🇸🇬", KRW: "🇰🇷", INR: "🇮🇳", MXN: "🇲🇽", BRL: "🇧🇷",
      ZAR: "🇿🇦", TRY: "🇹🇷", RUB: "🇷🇺", SEK: "🇸🇪", NOK: "🇳🇴",
      DKK: "🇩🇰", PLN: "🇵🇱", THB: "🇹🇭", IDR: "🇮🇩", MYR: "🇲🇾",
      PHP: "🇵🇭", VND: "🇻🇳", TWD: "🇹🇼", SAR: "🇸🇦", AED: "🇦🇪",
    };
    return COUNTRY_TO_FLAG[currency] || "🏳️";
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
    knowledgeCard,
  };
})();
