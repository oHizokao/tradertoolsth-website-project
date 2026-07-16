/* ============================================================
   TraderToolsTH — Version 2: Gold Trading Desk
   Dark navy trading portal inspired by the approved reference.
   ============================================================ */

(function () {
  const h = TT.h;

  function candleChart() {
    const closes = [36, 40, 34, 46, 49, 43, 55, 63, 60, 54, 68, 74, 71, 78, 84, 80, 88, 92, 87, 95, 101, 98, 107, 112, 108, 118, 122, 116, 126, 132];
    const min = 28;
    const max = 138;
    return `<div class="v2-candles" aria-hidden="true">
      ${closes.map((close, index) => {
        const open = index ? closes[index - 1] : close - 4;
        const high = Math.max(open, close) + 5 + (index % 3);
        const low = Math.min(open, close) - 4 - (index % 2);
        const top = 100 - ((high - min) / (max - min)) * 100;
        const height = ((high - low) / (max - min)) * 100;
        const bodyTop = ((high - Math.max(open, close)) / (high - low)) * 100;
        const bodyHeight = Math.max(13, (Math.abs(close - open) / (high - low)) * 100);
        return `<span class="v2-candle ${close >= open ? "is-up" : "is-down"}" style="--x:${index * 3.32}%;--top:${top.toFixed(1)}%;--height:${height.toFixed(1)}%;--body-top:${bodyTop.toFixed(1)}%;--body-height:${bodyHeight.toFixed(1)}%"><i></i></span>`;
      }).join("")}
      <span class="v2-ma v2-ma--one"></span>
      <span class="v2-ma v2-ma--two"></span>
      <span class="v2-ma v2-ma--three"></span>
    </div>`;
  }

  function sparkline() {
    return `<div class="v2-spark" aria-hidden="true"><canvas id="v2SignalSpark"></canvas></div>`;
  }

  function drawSignalSpark() {
    const canvas = document.getElementById("v2SignalSpark");
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const points = [58, 47, 54, 38, 50, 44, 61, 55, 67, 62, 78, 70, 84, 75, 88, 80, 91, 76, 85, 79, 94, 90, 103];
    const min = Math.min(...points);
    const max = Math.max(...points);
    const step = box.width / (points.length - 1);
    ctx.beginPath();
    points.forEach((value, index) => {
      const x = index * step;
      const y = box.height - 7 - ((value - min) / (max - min)) * (box.height - 15);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#25bca8";
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(37, 188, 168, .35)";
    ctx.shadowBlur = 6;
    ctx.stroke();
  }

  function signalPanel() {
    return `<article class="v2-panel v2-signal-panel">
      <header class="v2-panel-head">
        <h2>SIGNAL <span>ล่าสุด</span></h2>
        <span class="v2-live"><i></i> อัปเดตเมื่อ 09:45 น.</span>
      </header>
      <div class="v2-signal-symbol">
        <div class="v2-flags"><span class="v2-flag-us"></span><span class="v2-flag-jp"></span></div>
        <div>
          <div class="v2-symbol-line"><strong>USDJPY</strong><span class="v2-buy">BUY</span></div>
          <small>แบบโมเมนตัม</small>
        </div>
      </div>
      <div class="v2-signal-trend"><span>แนวโน้ม</span><strong>แนวโน้มขาขึ้น</strong></div>
      <div class="v2-signal-stats">
        <div><span>ราคาเข้า</span><strong>155.32</strong></div>
        <div><span>เป้าหมาย</span><strong>156.80</strong></div>
        <div><span>จุดตัดขาดทุน</span><strong>154.60</strong></div>
        <div><span>ความเชื่อมั่น</span><strong class="v2-stars">★★★★<b>☆</b></strong></div>
      </div>
      ${sparkline()}
      <a href="signal.html" class="v2-panel-link">ดูสัญญาณทั้งหมด <span>→</span></a>
    </article>`;
  }

  function newsPanel() {
    const items = (TT.news || []).filter((item) => ["gold-fed-2026-07", "gold-china-demand-2026", "oil-gold-correlation-2026"].includes(item.id));
    return `<article class="v2-panel v2-news-panel">
      <header class="v2-panel-head"><h2>ข่าวสารการตลาด</h2><a href="news.html">ดูทั้งหมด →</a></header>
      <div class="v2-news-list" id="homeNewsList">
        ${
          items.length
            ? items.slice(0, 3).map((item, index) => `<a class="v2-news-item" href="news-detail.html?slug=${encodeURIComponent(item.slug)}">
          <img src="${h.esc(item.cover)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1610375461246-83df859d849d?w=800&auto=format&fit=crop&q=70'">
          <div>
            <div class="v2-news-meta"><span class="v2-news-tag v2-news-tag--${index}">${index === 0 ? "เศรษฐกิจ" : index === 1 ? "ทองคำ" : "น้ำมัน"}</span><time>${index + 1} ชั่วโมงที่แล้ว</time></div>
            <strong>${h.esc(h.truncate(item.title, 56))}</strong>
            <p>${h.esc(h.truncate(item.excerpt, 62))}</p>
          </div>
        </a>`).join("")
            : `<div class="state"><div class="state__title">ยังไม่มีข่าวล่าสุด</div><a href="news.html" class="btn btn--ghost btn--sm">ดูข่าวทั้งหมด</a></div>`
        }
      </div>
    </article>`;
  }

  function calendarPanel() {
    const rows = [
      ["08:30", "us", "USD", "Non-Farm Payrolls", 3, "190K", "175K"],
      ["08:30", "us", "USD", "Average Hourly Earnings", 2, "0.3%", "0.4%"],
      ["10:00", "us", "USD", "ISM Services PMI", 2, "52.0", "49.4"],
      ["14:00", "gb", "GBP", "BoE Governor Speech", 1, "–", "–"],
      ["19:30", "us", "USD", "FOMC Member Speech", 2, "–", "–"],
    ];
    return `<article class="v2-panel v2-calendar-panel">
      <header class="v2-panel-head"><h2>ปฏิทินเศรษฐกิจ</h2><a href="calendar.html">ดูทั้งหมด →</a></header>
      <div class="v2-calendar-head"><span>เวลา</span><span>เหตุการณ์</span><span>ความสำคัญ</span><span>คาดการณ์</span><span>ก่อนหน้า</span></div>
      <div class="v2-calendar-body" id="homeCalendarList">${rows.map((row) => `<div class="v2-calendar-row"><span>${row[0]}</span><span class="v2-event"><b class="v2-mini-flag v2-mini-flag--${row[1]}"></b><small>${row[2]}</small>${row[3]}</span><span class="v2-impact" aria-label="ความสำคัญ ${row[4]} ระดับ">${[0, 1, 2].map((dot) => `<i class="${dot < row[4] ? "is-on" : ""}"></i>`).join("")}</span><span>${row[5]}</span><span>${row[6]}</span></div>`).join("")}</div>
      <footer class="v2-calendar-foot" id="homeCalendarStatus"><span>กำลังโหลดปฏิทินล่าสุด…</span><span>เชื่อมต่อข้อมูลจริง <i></i></span></footer>
    </article>`;
  }

  function timeAgo(iso) {
    const ms = Date.now() - new Date(iso || 0).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "ล่าสุด";
    const hours = Math.floor(ms / 3600000);
    if (hours < 1) return "ไม่ถึง 1 ชั่วโมงที่แล้ว";
    if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
    return `${Math.floor(hours / 24)} วันที่แล้ว`;
  }

  function impactLevel(impact) {
    return impact === "high" ? 3 : impact === "medium" ? 2 : 1;
  }

  function flagClass(currency) {
    const code = String(currency || "").toLowerCase();
    if (code === "usd") return "us";
    if (code === "gbp") return "gb";
    if (code === "jpy") return "jp";
    if (code === "eur") return "eu";
    return "global";
  }

  async function hydrateLiveNews() {
    const el = document.getElementById("homeNewsList");
    if (!el || !TT.NewsService) return;
    const page = await TT.NewsService.fetchNews("all", { limit: 3, offset: 0 });
    const items = page.items || [];
    if (!items.length) {
      el.innerHTML = `<div class="state"><div class="state__title">ยังไม่มีข่าวล่าสุด</div><a href="news.html" class="btn btn--ghost btn--sm">ดูข่าวทั้งหมด</a></div>`;
      return;
    }
    el.innerHTML = items.map((item, index) => `<a class="v2-news-item" href="news-detail.html?slug=${encodeURIComponent(item.slug || item.id)}">
      <img src="${h.esc(item.cover || "assets/images/news-gold.jpg")}" alt="" loading="lazy">
      <div><div class="v2-news-meta"><span class="v2-news-tag v2-news-tag--${index}">${item.category === "forex" ? "Forex" : "ทองคำ"}</span><time>${h.esc(timeAgo(item.publishedAt || item.sourcePublishedAt))}</time></div>
      <strong>${h.esc(h.truncate(item.title || "", 56))}</strong><p>${h.esc(h.truncate(item.excerpt || "", 62))}</p></div>
    </a>`).join("");
  }

  async function hydrateLiveCalendar() {
    const el = document.getElementById("homeCalendarList");
    const status = document.getElementById("homeCalendarStatus");
    if (!el || !TT.CalendarService) return;
    const envelope = await TT.CalendarService.fetchUpcoming({ limit: 5 });
    const items = envelope.items || [];
    if (!items.length) {
      el.innerHTML = `<div class="state"><div class="state__title">ยังไม่มีเหตุการณ์ที่กำลังจะมาถึง</div><a href="calendar.html" class="btn btn--ghost btn--sm">ดูปฏิทินทั้งหมด</a></div>`;
    } else {
      el.innerHTML = items.map((item) => {
        const level = impactLevel(item.impact);
        const time = String(item.scheduledAtBangkok || "").slice(11, 16) || "—";
        const currency = String(item.currency || item.country || "—").toUpperCase();
        return `<a class="v2-calendar-row" href="calendar.html#${encodeURIComponent(item.id || "upcoming")}"><span>${h.esc(time)}</span><span class="v2-event"><b class="v2-mini-flag v2-mini-flag--${flagClass(currency)}"></b><small>${h.esc(currency)}</small>${h.esc(h.truncate(item.eventName || "", 28))}</span><span class="v2-impact" aria-label="ความสำคัญ ${level} ระดับ">${[0, 1, 2].map((dot) => `<i class="${dot < level ? "is-on" : ""}"></i>`).join("")}</span><span>${h.esc(item.forecast || "—")}</span><span>${h.esc(item.previous || "—")}</span></a>`;
      }).join("");
    }
    if (status) {
      const updated = envelope.updatedAt ? new Date(envelope.updatedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "—";
      status.innerHTML = `<span>อัปเดตล่าสุด ${updated} น. (GMT+7)</span><span>${envelope.stale ? "ข้อมูลล่าสุดที่มี" : "อัปเดตอัตโนมัติ"} <i></i></span>`;
    }
  }

  function toolsPanel() {
    const tools = [
      { icon: "calculator", tone: "teal", name: "Position Size Calculator", desc: "คำนวณขนาดการเทรดที่เหมาะสมตามความเสี่ยงของคุณ", href: "broker-tools.html#lot-size" },
      { icon: "shield", tone: "gold", name: "Margin Calculator", desc: "คำนวณมาร์จินและเปอร์เซ็นต์การใช้มาร์จิน", href: "broker-tools.html#margin" },
      { icon: "chart", tone: "blue", name: "Pip Value Calculator", desc: "คำนวณมูลค่าของ Pip ในแต่ละคู่เงินได้อย่างแม่นยำ", href: "broker-tools.html#swap" },
    ];
    return `<article class="v2-panel v2-tools-panel">
      <header class="v2-panel-head"><h2>เครื่องมือสำหรับโบรกเกอร์</h2><a href="broker-tools.html">ดูทั้งหมด →</a></header>
      <div class="v2-tools-list">${tools.map((tool) => `<a href="${tool.href}" class="v2-tool-row"><span class="v2-tool-icon v2-tool-icon--${tool.tone}">${TT.icon(tool.icon, 28)}</span><span><strong>${tool.name}</strong><small>${tool.desc}</small></span><b>›</b></a>`).join("")}</div>
    </article>`;
  }

  /* ============================================================
     Quick Access — ฟีเจอร์หลัก 3 รายการ (EA Hub / Community / Broker Tools)
     ============================================================ */
  function quickAccessSection() {
    const cards = [
      {
        icon: "ea",
        tone: "teal",
        title: "EA Hub",
        desc: "แหล่งรวม Expert Advisor สำหรับ MT4/MT5 ดาวน์โหลดและแบ่งปัน EA พร้อมส่งผลงานของคุณเข้าระบบรีวิว",
        cta: "ดู EA ทั้งหมด",
        href: "ea.html",
      },
      {
        icon: "forum",
        tone: "gold",
        title: "Community Forum",
        desc: "พูดคุยแลกเปลี่ยนความรู้การเทรดกับชุมชนเทรดเดอร์ไทย ตั้งกระทู้ ถาม-ตอบ และแบ่งปันประสบการณ์ได้ฟรี",
        cta: "เข้าร่วมชุมชน",
        href: "forum.html",
      },
      {
        icon: "calculator",
        tone: "blue",
        title: "เครื่องมือโบรกเกอร์",
        desc: "คำนวณ Lot Size, Margin, Swap และเปรียบเทียบต้นทุนการเทรดระหว่างโบรกเกอร์อย่างแม่นยำ",
        cta: "ใช้เครื่องมือ",
        href: "broker-tools.html",
      },
    ];
    return `<section class="v2-quick-access" aria-label="ฟีเจอร์หลักของเว็บไซต์">
      <div class="v2-shell">
        <header class="v2-quick-access__head">
          <h2>ฟีเจอร์เด่นของ TraderToolsTH</h2>
          <p>เครื่องมือและชุมชนที่ช่วยให้คุณเทรดอย่างมีประสิทธิภาพ</p>
        </header>
        <div class="v2-quick-access__grid">
          ${cards
            .map(
              (c) => `<a href="${c.href}" class="v2-qa-card v2-qa-card--${c.tone}" aria-label="${h.esc(c.title)} — ${h.esc(c.cta)}">
            <span class="v2-qa-card__icon" aria-hidden="true">${TT.icon(c.icon, 30)}</span>
            <span class="v2-qa-card__body">
              <strong>${h.esc(c.title)}</strong>
              <small>${h.esc(c.desc)}</small>
            </span>
            <span class="v2-qa-card__cta">${h.esc(c.cta)} <span aria-hidden="true">→</span></span>
          </a>`
            )
            .join("")}
        </div>
      </div>
    </section>`;
  }

  /* ============================================================
     EA ล่าสุด — ดึงจาก GET /api/content/ea (TT.EAService)
     ============================================================ */
  function eaSection() {
    return `<section class="v2-community" aria-label="EA และกระทู้ล่าสุด">
      <div class="v2-shell v2-community-grid">
        <article class="v2-panel v2-ea-panel">
          <header class="v2-panel-head">
            <h2>EA ล่าสุด</h2>
            <a href="ea.html">ดูทั้งหมด →</a>
          </header>
          <div class="v2-ea-list" id="homeEAList" aria-live="polite">
            <div class="v2-state-loading">กำลังโหลด EA ล่าสุด…</div>
          </div>
        </article>
        <article class="v2-panel v2-forum-panel">
          <header class="v2-panel-head">
            <h2>กระทู้ Community ล่าสุด</h2>
            <a href="forum.html">ดูทั้งหมด →</a>
          </header>
          <div class="v2-forum-list" id="homeForumList" aria-live="polite">
            <div class="v2-state-loading">กำลังโหลดกระทู้ล่าสุด…</div>
          </div>
        </article>
      </div>
    </section>`;
  }

  async function hydrateLatestEA() {
    const el = document.getElementById("homeEAList");
    if (!el) return;
    if (!TT.EAService) {
      el.innerHTML = `<div class="v2-state-empty"><strong>ยังไม่มี EA ที่เผยแพร่</strong><a href="ea.html" class="btn btn--ghost btn--sm">ไปที่ EA Hub</a></div>`;
      return;
    }
    try {
      const all = await TT.EAService.fetchEAs();
      const items = Array.isArray(all) ? all.slice(0, 3) : [];
      if (!items.length) {
        el.innerHTML = `<div class="v2-state-empty"><strong>ยังไม่มี EA ที่เผยแพร่</strong><span>เมื่อมี EA ใหม่ผ่านการรีวิวจะแสดงที่นี่</span><a href="ea.html" class="btn btn--ghost btn--sm">ไปที่ EA Hub</a></div>`;
        return;
      }
      el.innerHTML = items
        .map((ea) => {
          const slug = encodeURIComponent(ea.slug || ea.id || "");
          const title = h.esc(h.truncate(ea.name || ea.title || "EA", 48));
          const desc = h.esc(h.truncate(ea.description || ea.desc || ea.strategy || "", 80));
          const platforms = (ea.platforms || []).map((p) => h.esc(p)).join(" · ");
          const typeBadge = ea.isFree
            ? `<span class="v2-tag v2-tag--free">ฟรี</span>`
            : `<span class="v2-tag v2-tag--paid">เสียเงิน</span>`;
          return `<a class="v2-ea-item" href="ea.html${slug ? "?ea=" + slug : ""}">
            <div class="v2-ea-item__head">
              ${typeBadge}
              ${platforms ? `<span class="v2-ea-item__platforms">${platforms}</span>` : ""}
            </div>
            <strong>${title}</strong>
            <p>${desc}</p>
          </a>`;
        })
        .join("");
    } catch (e) {
      el.innerHTML = `<div class="v2-state-error"><strong>ไม่สามารถโหลด EA ได้ในขณะนี้</strong><span>กรุณาลองใหม่ภายหลัง หรือเข้าดูที่ EA Hub โดยตรง</span><a href="ea.html" class="btn btn--ghost btn--sm">ไปที่ EA Hub</a></div>`;
    }
  }

  async function hydrateLatestForumTopics() {
    const el = document.getElementById("homeForumList");
    if (!el) return;
    if (!TT.ForumService) {
      el.innerHTML = `<div class="v2-state-empty"><strong>บริการ Community ยังไม่พร้อม</strong><a href="forum.html" class="btn btn--ghost btn--sm">ไปที่ Forum</a></div>`;
      return;
    }
    try {
      const page = await TT.ForumService.listTopics({ limit: 5, sort: "recent" });
      const items = (page && page.items) || [];
      if (!items.length) {
        el.innerHTML = `<div class="v2-state-empty"><strong>ยังไม่มีกระทู้ในชุมชน</strong><span>เป็นคนแรกที่เริ่มสนทนาได้เลย</span><a href="forum.html" class="btn btn--ghost btn--sm">เข้าร่วม Forum</a></div>`;
        return;
      }
      el.innerHTML = items
        .map((t) => {
          const id = encodeURIComponent(t.id || t.slug || "");
          const title = h.esc(h.truncate(t.title || "ไม่มีชื่อกระทู้", 60));
          const author = h.esc(t.authorName || t.author || "สมาชิก");
          const replies = Number(t.postCount || t.replies || 0);
          const cat = t.categoryName || t.category || "";
          const catBadge = cat ? `<span class="v2-forum-item__cat">${h.esc(cat)}</span>` : "";
          return `<a class="v2-forum-item" href="forum-topic.html${id ? "?id=" + id : ""}">
            ${catBadge}
            <strong>${title}</strong>
            <div class="v2-forum-item__meta">
              <span>โดย ${author}</span>
              <span>•</span>
              <span>${replies} ความเห็น</span>
            </div>
          </a>`;
        })
        .join("");
    } catch (e) {
      const code = (e && (e.code || e.message)) || "";
      el.innerHTML = `<div class="v2-state-error"><strong>ไม่สามารถโหลดกระทู้ได้ในขณะนี้</strong><span>อาจเป็นเพราะบริการ Community ยังไม่เปิดให้ใช้งาน${code ? " (" + h.esc(String(code)) + ")" : ""}</span><a href="forum.html" class="btn btn--ghost btn--sm">ไปที่ Forum</a></div>`;
    }
  }

  function featureStrip() {
    const features = [
      ["target", "teal", "สัญญาณคุณภาพ", "อัปเดตเรียลไทม์ แม่นยำ", "โดยนักวิเคราะห์มืออาชีพ"],
      ["clock", "gold", "เครื่องมือครบครัน", "ช่วยให้คุณวางแผนและจัดการ", "การเทรดได้อย่างมีประสิทธิภาพ"],
      ["news", "blue", "ข่าวสารทันเหตุการณ์", "ติดตามข่าวสำคัญที่ส่งผล", "ต่อตลาดก่อนใคร"],
      ["shield", "teal", "ปลอดภัย เชื่อถือได้", "ข้อมูลจากแหล่งที่เชื่อถือได้", "100%"],
    ];
    return `<section class="v2-feature-strip">${features.map((f) => `<div class="v2-feature"><span class="v2-feature-icon v2-feature-icon--${f[1]}">${TT.icon(f[0], 30)}</span><div><strong>${f[2]}</strong><span>${f[3]}<br>${f[4]}</span></div></div>`).join("")}</section>`;
  }

  function render() {
    document.body.classList.add("home-v2");
    const main = `<main id="main" class="v2-main">
      <section class="v2-hero">
        <div class="v2-shell v2-hero-grid">
          <div class="v2-hero-copy">
            <h1>เทรดด้วยข้อมูล<br><span>ได้เปรียบทุกจังหวะตลาด</span></h1>
            <p>เครื่องมืออัจฉริยะ สัญญาณคุณภาพ และข่าวสารที่สำคัญ<br>ช่วยให้คุณเทรดอย่างมั่นใจในทุกสภาวะตลาด</p>
            <div class="v2-actions"><a href="signal.html" class="v2-btn v2-btn--primary">เริ่มใช้งานฟรี <span>→</span></a><a href="knowledge.html" class="v2-btn v2-btn--outline">ดูเครื่องมือทั้งหมด</a></div>
            <div class="v2-proof"><span>${TT.icon("shield", 25)} <b>เชื่อถือได้</b><small>ใช้งานโดยเทรดเดอร์กว่า 50,000+ คน</small></span><span>${TT.icon("star", 25)} <b>อัปเดตเรียลไทม์</b><small>ข้อมูลไว แม่นยำ</small></span></div>
          </div>
          <div class="v2-chart-stage">${candleChart()}</div>
          ${signalPanel()}
        </div>
      </section>
      <section class="v2-dashboard"><div class="v2-shell v2-dashboard-grid">${newsPanel()}${calendarPanel()}${toolsPanel()}</div>${featureStrip()}</section>
      ${quickAccessSection()}
      ${eaSection()}
    </main>`;
    document.getElementById("app").innerHTML = `${TT.layout.navbar("home")}${TT.layout.ticker()}${main}`;
    document.title = "TraderToolsTH — Gold Trading Desk";
    TT.layout.initNavbar();
    TT.layout.initTicker();
    drawSignalSpark();
    Promise.allSettled([
      hydrateLiveNews(),
      hydrateLiveCalendar(),
      hydrateLatestEA(),
      hydrateLatestForumTopics(),
    ]);
    window.addEventListener("resize", drawSignalSpark, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", render);
})();
