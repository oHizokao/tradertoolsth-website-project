/* ============================================================
   Page — Home (v6 — Reference Match)
   Compact premium-finance dashboard based on the approved visual reference.
   ============================================================ */

(function () {
  const h = TT.h;

  // ---------- Sparkline SVG (เส้นบาก area fill ต่ำมาก) ----------
  function sparkline(points, color, w = 120, hgt = 28) {
    if (!points || points.length < 2) return "";
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const step = w / (points.length - 1);
    const d = points
      .map((p, i) => {
        const x = i * step;
        const y = hgt - ((p - min) / range) * (hgt - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const id = "sp-" + color.replace(/[^a-z0-9]/gi, "");
    return `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity="0.15"/>
          <stop offset="1" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${d} L${w},${hgt} L0,${hgt} Z" fill="url(#${id})"/>
      <path d="${d}" stroke="${color}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  // ---------- Market ticker cards (hero right) ----------
  function marketCards() {
    const data = [
      { pair: "EURUSD", price: "1.08123", change: "+0.00345 (+0.32%)", dir: "up", color: "#10c7b5", points: [1.076, 1.078, 1.077, 1.080, 1.079, 1.083, 1.081] },
      { pair: "XAUUSD", price: "2,334.68", change: "+18.54 (+0.80%)", dir: "up", color: "#f0aa00", points: [2310, 2318, 2322, 2315, 2332, 2340, 2335] },
      { pair: "USDJPY", price: "156.789", change: "-0.256 (-0.16%)", dir: "down", color: "#377cf5", points: [156.5, 156.9, 156.6, 157.1, 156.7, 156.9, 156.78] },
      { pair: "BTCUSD", price: "66,245.10", change: "+1,245.80 (+1.92%)", dir: "up", color: "#10c7b5", points: [64000, 64800, 64600, 65500, 65100, 66000, 66245] },
    ];
    return `<div class="hero__market">
      ${data
        .map(
          (m) => `<div class="market-card">
            <div class="market-card__head">
              <span class="market-card__pair">${h.esc(m.pair)}</span>
            </div>
            <div class="market-card__price mono">${h.esc(m.price)}</div>
            <div class="market-card__change market-card__change--${m.dir}">${h.esc(
            m.change
          )}</div>
            <div class="market-card__spark">${sparkline(m.points, m.color)}</div>
          </div>`
        )
        .join("")}
    </div>`;
  }

  // ---------- Trust strip (in hero, variant --hero) ----------
  function trustStrip() {
    const items = [
      { icon: "zap", color: "", title: "อัปเดตไว", desc: "ข้อมูลล่าสุดตลอดเวลา" },
      { icon: "shield", color: "--teal", title: "เชื่อถือได้", desc: "คัดกรองคุณภาพ" },
      { icon: "gauge", color: "--gold", title: "เหมาะกับทุกระดับ", desc: "มือใหม่ถึงมืออาชีพ" },
      { icon: "layers", color: "", title: "เครื่องมือครบ", desc: "ใช้งานง่ายในที่เดียว" },
    ];
    return `<div class="trust-strip trust-strip--hero">
      ${items
        .map(
          (it) => `<div class="trust-item">
            <span class="trust-item__icon${it.color}">${TT.icon(it.icon, 22)}</span>
            <div class="trust-item__text">
              <strong>${h.esc(it.title)}</strong>
              <span>${h.esc(it.desc)}</span>
            </div>
          </div>`
        )
        .join("")}
    </div>`;
  }

  // ---------- Dash card head ----------
  function dashHead(icon, iconColor, title, subtitle, link) {
    return `<div class="dash-card__head">
      <div class="dash-card__title">
        <div>
          <h3>${h.esc(title)}</h3>
        </div>
      </div>
      ${link ? `<a href="${link.href}" class="dash-card__more">${h.esc(link.label)}</a>` : ""}
    </div>`;
  }

  function render() {
    const main = `
      <!-- ===== HERO (Navy, 42/58) ===== -->
      <section class="hero">
        <div class="container hero__inner">

          <!-- Left: headline + CTA -->
          <div class="hero__content">
            <h1>ข้อมูลครบ เครื่องมือชัด<br><span class="accent-word">เทรดมั่นใจ</span> ในทุกจังหวะตลาด</h1>
            <p class="hero__lead">แหล่งรวมสัญญาณ ข่าวสาร บทวิเคราะห์ และเครื่องมือช่วยเทรด<br>ออกแบบมาเพื่อเทรดเดอร์ทุกระดับ</p>
            <div class="hero__cta">
              <a href="signal.html" class="btn btn--primary btn--lg">ดูสัญญาณล่าสุด <span aria-hidden="true">→</span></a>
              <a href="knowledge.html" class="btn btn--ghost-light btn--lg">เริ่มเรียนรู้ ${TT.icon("knowledge", 16)}</a>
            </div>
          </div>

          <!-- Right: market ticker + trust strip -->
          <div class="hero__right">
            ${marketCards()}
            ${trustStrip()}
          </div>

        </div>
      </section>

      <!-- ===== DASHBOARD (Light) ===== -->
      <div class="dashboard">
        <div class="container">

          <!-- Row 1: Signal | News | Gold | Calendar -->
          <div class="dash-row">

            <!-- 1. Signal -->
            <div class="card card--accent-top-teal">
              ${dashHead("signal", "--teal", "สัญญาณล่าสุด", "", { href: "signal.html", label: "ดูทั้งหมด" })}
              <div id="homeSignal" class="stack"></div>
            </div>

            <!-- 2. News -->
            <div class="card card--accent-top">
              ${dashHead("news", "", "ข่าวสาร Forex", "", { href: "news.html", label: "ดูทั้งหมด" })}
              <div id="homeNews" class="stack"></div>
            </div>

            <!-- 3. Gold -->
            <div class="card card--accent-top-gold gold-card">
              ${dashHead("trend", "--gold", "ทองคำ (XAUUSD)", "", { href: "news.html", label: "ดูเพิ่มเติม" })}
              <div class="cluster--between" style="display:flex;align-items:baseline;margin-bottom:8px">
                <div>
                  <div class="price mono">2,334.68 <small>USD/OZ</small></div>
                  <div class="text-buy mono gold-change">+18.54 (+0.80%)</div>
                </div>
                <div class="range-tabs" id="goldRange">
                  <button data-range="1D" class="is-active">1D</button>
                  <button data-range="1W">1W</button>
                  <button data-range="1M">1M</button>
                  <button data-range="3M">3M</button>
                  <button data-range="1Y">1Y</button>
                </div>
              </div>
              <div class="gold-chart" id="goldChart"></div>
            </div>

            <!-- 4. Calendar -->
            <div class="card card--accent-top">
              ${dashHead("calendar", "", "ปฏิทินเศรษฐกิจ", "", { href: "calendar.html", label: "ดูทั้งหมด" })}
              <div id="homeCalendar" class="stack"></div>
            </div>

          </div>

          <!-- Row 2: Broker | Tools | Knowledge | Premium CTA -->
          <div class="dash-row">

            <!-- 1. Broker -->
            <div class="card card--accent-top">
              ${dashHead("broker", "", "โบรกเกอร์แนะนำ", "", { href: "brokers.html", label: "ดูทั้งหมด" })}
              <div id="homeBroker" class="stack"></div>
            </div>

            <!-- 2. Tools -->
            <div class="card card--accent-top-teal">
              ${dashHead("layers", "--teal", "เครื่องมือยอดนิยม", "", null)}
              <div id="homeTools" class="stack"></div>
            </div>

            <!-- 3. Knowledge -->
            <div class="card card--accent-top">
              ${dashHead("knowledge", "", "เรียนรู้เทรด", "", { href: "knowledge.html", label: "ดูทั้งหมด" })}
              <div id="homeKnowledge" class="stack"></div>
            </div>

            <!-- 4. Premium CTA (navy card) -->
            <div class="premium-card">
              <div>
                <h3>อัปเกรดการเทรดของคุณ</h3>
                <p>เข้าถึงสัญญาณพรีเมียม บทวิเคราะห์เชิงลึก และเครื่องมือขั้นสูง</p>
                <ul class="premium-card__list">
                  <li>สัญญาณคุณภาพสูง</li>
                  <li>บทวิเคราะห์รายวัน</li>
                  <li>ไม่มีโฆษณา</li>
                </ul>
              </div>
              <div class="premium-card__visual" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
              <a href="contact.html" class="btn btn--primary btn--sm">ดูแพ็กเกจพรีเมียม</a>
            </div>

          </div>

          <div class="home-utility-strip">
            <div class="home-social"><span>เชื่อมต่อกับเรา</span><a href="contact.html" aria-label="LINE">${TT.icon("line", 18)}</a><a href="contact.html" aria-label="Telegram">${TT.icon("telegram", 18)}</a><a href="contact.html" aria-label="Facebook">${TT.icon("facebook", 18)}</a><a href="mailto:${h.esc(TT.site.email)}" aria-label="Email">${TT.icon("mail", 18)}</a></div>
            <span>${TT.icon("clock", 18)} อัปเดตทุกวัน</span>
            <span>${TT.icon("user", 18)} ทีมซัพพอร์ตคนไทย</span>
            <span>${TT.icon("contact", 18)} ใช้งานครบในที่เดียว</span>
          </div>

          <!-- Risk warning -->
          <div class="alert alert--warn" style="margin-top:8px">
            <span class="alert__icon">${TT.icon("warning", 18)}</span>
            <div>
              <strong>คำเตือนความเสี่ยง:</strong> ${h.esc(TT.site.riskWarning)}
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.classList.add("home-ref");
    document.getElementById("app").innerHTML = TT.layout.page({
      active: "home",
      main,
    });
    document.title = `${TT.site.name} — ${TT.site.tagline}`;
    TT.layout.initNavbar();
    TT.h.revealOnScroll();

    loadSignal();
    loadNews();
    loadCalendar();
    loadBroker();
    loadTools();
    loadKnowledge();
    drawGoldChart("1D");
    bindGoldRange();
  }

  // ---------- Loaders ----------
  async function loadSignal() {
    const el = document.getElementById("homeSignal");
    if (!el) return;
    TT.h.loading(el, 2);
    try {
      const list = await TT.SignalService.fetchSignals({ status: "active" });
      if (!list.length) return TT.h.empty(el, "ยังไม่มีสัญญาณเปิดอยู่");
      el.innerHTML = list
        .slice(0, 3)
        .map((s) => {
          const dirClass = s.direction === "buy" ? "badge--buy" : "badge--sell";
          const tierBadge =
            s.tier === "premium"
              ? `<span class="badge badge--premium">PREMIUM</span>`
              : `<span class="badge badge--demo">DEMO</span>`;
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div class="cluster--between" style="display:flex;margin-bottom:6px">
              <div class="cluster" style="gap:6px">
                <span class="badge ${dirClass}">${s.direction === "buy" ? "BUY" : "SELL"}</span>
                ${tierBadge}
                <span class="badge">${h.esc(s.symbol)}</span>
              </div>
              <span class="mono text-muted" style="font-size:var(--fs-xs)">${h.formatTime(s.time, { timeOnly: true })}</span>
            </div>
            <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:6px;font-size:var(--fs-xs)">
              <div><span class="text-muted">Entry</span><br><span class="mono" style="font-weight:600">${h.num(s.entry, 2)}</span></div>
              <div><span class="text-muted">SL</span><br><span class="mono text-sell" style="font-weight:600">${h.num(s.stopLoss, 2)}</span></div>
              <div><span class="text-muted">TP</span><br><span class="mono text-buy" style="font-weight:600">${h.num(s.takeProfit[0], 2)}</span></div>
            </div>
          </div>`;
        })
        .join("");
    } catch (e) {
      TT.h.error(el);
    }
  }

  async function loadNews() {
    const el = document.getElementById("homeNews");
    if (!el) return;
    TT.h.loading(el, 3);
    try {
      const list = await TT.NewsService.fetchNews("all", 3);
      if (!list.length) return TT.h.empty(el);
      el.innerHTML = list
        .map(
          (n) => `<a href="news-detail.html?slug=${encodeURIComponent(
            n.slug
          )}" style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit">
            <div style="width:52px;height:52px;border-radius:8px;overflow:hidden;flex-shrink:0;background:var(--color-surface-2)">
              <img src="${h.esc(n.cover)}" alt="${h.esc(n.title)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.style.display='none'">
            </div>
            <div style="flex:1;min-width:0">
              <span class="badge badge--${n.category === "gold" ? "gold" : "accent"}" style="font-size:0.62rem;margin-bottom:4px">${n.category === "gold" ? "ทองคำ" : "Forex"}</span>
              <div style="font-family:var(--font-display);font-weight:600;font-size:var(--fs-xs);color:var(--text-primary);line-height:1.3;margin-bottom:2px">${h.esc(h.truncate(n.title, 55))}</div>
              <div class="mono text-muted" style="font-size:var(--fs-xs)">${h.formatTime(n.publishedAt, { timeOnly: true })}</div>
            </div>
          </a>`
        )
        .join("");
    } catch (e) {
      TT.h.error(el);
    }
  }

  async function loadCalendar() {
    const el = document.getElementById("homeCalendar");
    if (!el) return;
    TT.h.loading(el, 4);
    try {
      const today = new Date();
      const all = await TT.CalendarService.fetchEvents({ date: today });
      const list = all.slice(0, 4);
      if (!list.length) return TT.h.empty(el, "ไม่มีเหตุการณ์วันนี้");
      el.innerHTML = list
        .map(
          (e) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
            <span class="mono text-accent" style="font-size:var(--fs-xs);font-weight:600;min-width:42px">${h.formatTime(e.time, { timeOnly: true })}</span>
            <span class="badge" style="font-size:0.6rem">${h.esc(e.currency)}</span>
            <span class="badge badge--${e.impact}" style="font-size:0.6rem">${h.impactText(e.impact)}</span>
            <span style="flex:1;font-size:var(--fs-xs);color:var(--text-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.esc(e.event)}</span>
          </div>`
        )
        .join("");
    } catch (e) {
      TT.h.error(el);
    }
  }

  async function loadBroker() {
    const el = document.getElementById("homeBroker");
    if (!el) return;
    TT.h.loading(el, 1);
    try {
      const list = await TT.BrokerService.fetchBrokers();
      const b = list[0];
      if (!b) return TT.h.empty(el);
      el.innerHTML = `<div class="home-broker__top">
          <div class="broker-hero__logo home-broker__logo" style="color:${h.esc(b.logoColor)}">${h.esc(b.shortName)}</div>
          <div class="home-broker__identity">
            <div class="home-broker__name">${h.esc(b.name)}</div>
            <div class="home-broker__meta">สเปรดต่ำ ฝากถอนได้เร็ว รองรับภาษาไทย</div>
            <div class="stars">${h.stars(b.rating)} <span>${h.num(b.rating, 1)}</span></div>
          </div>
          <a href="broker-detail.html?slug=${encodeURIComponent(b.slug)}" class="btn btn--primary btn--sm">เปิดบัญชี</a>
        </div>
        <div class="home-broker__specs">
          <div><span>สเปรดเริ่มต้น</span><strong>${h.esc(b.spread)}</strong></div>
          <div><span>ฝากขั้นต่ำ</span><strong>$${h.num(b.minDeposit, 0)}</strong></div>
          <div><span>เลเวอเรจสูงสุด</span><strong>1:500</strong></div>
          <div><span>โบนัส</span><strong>Welcome Bonus</strong></div>
        </div>`;
    } catch (e) {
      TT.h.error(el);
    }
  }

  function loadTools() {
    const el = document.getElementById("homeTools");
    if (!el) return;
    const tools = (TT.tools || []).slice(0, 4);
    el.innerHTML = tools
      .map(
        (t) => `<a href="${t.href}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit">
          <span class="tool-card__icon${t.color === "teal" ? "--teal" : t.color === "gold" ? "--gold" : ""}" style="width:36px;height:36px;border-radius:8px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex-shrink:0">${TT.icon(t.icon, 18)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-display);font-weight:600;font-size:var(--fs-xs);color:var(--text-primary)">${h.esc(t.name)}</div>
            <div style="font-size:var(--fs-xs);color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.esc(t.desc)}</div>
          </div>
        </a>`
      )
      .join("");
  }

  function loadKnowledge() {
    const el = document.getElementById("homeKnowledge");
    if (!el) return;
    const list = (TT.knowledge || []).slice(0, 3);
    el.innerHTML = list
      .map(
        (k) => `<a href="knowledge.html#${encodeURIComponent(k.slug)}" style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit">
          <span style="font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--accent);font-weight:600;min-width:18px">→</span>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-display);font-weight:600;font-size:var(--fs-xs);color:var(--text-primary);line-height:1.3;margin-bottom:2px">${h.esc(h.truncate(k.title, 50))}</div>
            <div class="mono text-muted" style="font-size:var(--fs-xs)">${h.esc(k.category)} · ${k.readMinutes} นาที</div>
          </div>
        </a>`
      )
      .join("");
  }

  // ---------- Gold chart ----------
  function drawGoldChart(range = "1D") {
    const el = document.getElementById("goldChart");
    if (!el) return;
    const datasets = {
      "1D": [2350, 2352, 2348, 2355, 2360, 2358, 2362, 2365],
      "1W": [2330, 2340, 2335, 2345, 2350, 2360, 2358, 2365],
      "1M": [2300, 2320, 2310, 2335, 2340, 2325, 2350, 2365],
      "3M": [2250, 2280, 2270, 2310, 2290, 2330, 2340, 2365],
      "1Y": [2100, 2180, 2150, 2240, 2200, 2300, 2330, 2365],
    };
    const points = datasets[range] || datasets["1D"];
    const min = Math.min(...points);
    const max = Math.max(...points);
    const rangeVal = max - min || 1;
    const w = 280;
    const hgt = 90;
    const step = w / (points.length - 1);
    const d = points
      .map((p, i) => {
        const x = i * step;
        const y = hgt - ((p - min) / rangeVal) * (hgt - 8) - 4;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" style="width:100%;height:100%">
      <defs>
        <linearGradient id="goldArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#D8A62A" stop-opacity="0.2"/>
          <stop offset="1" stop-color="#D8A62A" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${d} L${w},${hgt} L0,${hgt} Z" fill="url(#goldArea)"/>
      <path d="${d}" stroke="#D8A62A" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function bindGoldRange() {
    const el = document.getElementById("goldRange");
    if (!el) return;
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      el.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      drawGoldChart(btn.dataset.range);
    });
  }

  document.addEventListener("DOMContentLoaded", render);
})();
