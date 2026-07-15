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
      <div class="v2-news-list">
        ${items.slice(0, 3).map((item, index) => `<a class="v2-news-item" href="news-detail.html?slug=${encodeURIComponent(item.slug)}">
          <img src="${h.esc(item.cover)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1610375461246-83df859d849d?w=800&auto=format&fit=crop&q=70'">
          <div>
            <div class="v2-news-meta"><span class="v2-news-tag v2-news-tag--${index}">${index === 0 ? "เศรษฐกิจ" : index === 1 ? "ทองคำ" : "น้ำมัน"}</span><time>${index + 1} ชั่วโมงที่แล้ว</time></div>
            <strong>${h.esc(h.truncate(item.title, 56))}</strong>
            <p>${h.esc(h.truncate(item.excerpt, 62))}</p>
          </div>
        </a>`).join("")}
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
      <div class="v2-calendar-body">${rows.map((row) => `<div class="v2-calendar-row"><span>${row[0]}</span><span class="v2-event"><b class="v2-mini-flag v2-mini-flag--${row[1]}"></b><small>${row[2]}</small>${row[3]}</span><span class="v2-impact" aria-label="ความสำคัญ ${row[4]} ระดับ">${[0, 1, 2].map((dot) => `<i class="${dot < row[4] ? "is-on" : ""}"></i>`).join("")}</span><span>${row[5]}</span><span>${row[6]}</span></div>`).join("")}</div>
      <footer class="v2-calendar-foot"><span>เวลาปัจจุบัน: 09:45 น. (GMT+7)</span><span>อัปเดตอัตโนมัติ <i></i></span></footer>
    </article>`;
  }

  function toolsPanel() {
    const tools = [
      { icon: "calculator", tone: "teal", name: "Position Size Calculator", desc: "คำนวณขนาดการเทรดที่เหมาะสมตามความเสี่ยงของคุณ", href: "knowledge.html#risk-management" },
      { icon: "shield", tone: "gold", name: "Margin Calculator", desc: "คำนวณมาร์จินและเปอร์เซ็นต์การใช้มาร์จิน", href: "knowledge.html#forex-basics" },
      { icon: "chart", tone: "blue", name: "Pip Value Calculator", desc: "คำนวณมูลค่าของ Pip ในแต่ละคู่เงินได้อย่างแม่นยำ", href: "knowledge.html#forex-basics" },
    ];
    return `<article class="v2-panel v2-tools-panel">
      <header class="v2-panel-head"><h2>เครื่องมือสำหรับโบรกเกอร์</h2><a href="knowledge.html">ดูทั้งหมด →</a></header>
      <div class="v2-tools-list">${tools.map((tool) => `<a href="${tool.href}" class="v2-tool-row"><span class="v2-tool-icon v2-tool-icon--${tool.tone}">${TT.icon(tool.icon, 28)}</span><span><strong>${tool.name}</strong><small>${tool.desc}</small></span><b>›</b></a>`).join("")}</div>
    </article>`;
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
    </main>`;
    document.getElementById("app").innerHTML = `${TT.layout.navbar("home")}${TT.layout.ticker()}${main}`;
    document.title = "TraderToolsTH — Gold Trading Desk";
    TT.layout.initNavbar();
    drawSignalSpark();
    window.addEventListener("resize", drawSignalSpark, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", render);
})();
