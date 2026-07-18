/* ============================================================
   Layout Components — Navbar + Footer + Ticker (v3)
   Navy header with dropdown and contact/admin links; navy footer
   ============================================================ */

window.TT = window.TT || {};

TT.layout = (function () {
  const SITE = () => TT.site;

  // ---------- Logo — compact gold trading bars ----------
  function logo(size = 36) {
    return `<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>`;
  }

  function brandName() {
    return `<b>TraderTools<span class="brand__th">TH</span></b>`;
  }

  // ---------- Navbar ----------
  function navbar(activeKey = "") {
    const s = SITE();
    const toolsDrop = [
      { href: "market.html", label: "ภาพรวมตลาด" },
      { href: "calendar.html", label: "ปฏิทินเศรษฐกิจ" },
      { href: "broker-tools.html", label: "เครื่องมือโบรกเกอร์" },
      { href: "ea.html", label: "EA Hub" },
      { href: "faq.html", label: "คำถามที่พบบ่อย" },
    ];
    const toolsDropdown = `<div class="nav-item--has-drop">
      <a href="calendar.html" class="${
        ["market", "calendar", "faq", "ea", "broker-tools"].includes(activeKey) ? "is-active" : ""
      }" aria-haspopup="true">
        เครื่องมือ
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>
      <div class="nav-dropdown" role="menu">
        ${toolsDrop
          .map(
            (t) =>
              `<a href="${t.href}" role="menuitem">${TT.h.esc(t.label)}</a>`
          )
          .join("")}
      </div>
    </div>`;

    const linksWithDrop = `
      <a href="home.html" class="${activeKey === "home" ? "is-active" : ""}" data-nav="home">หน้าหลัก</a>
      ${toolsDropdown}
      <a href="signal.html" class="${activeKey === "signal" ? "is-active" : ""}" data-nav="signal">สัญญาณเทรด</a>
      <a href="news.html" class="${activeKey === "news" ? "is-active" : ""}" data-nav="news">ข่าวสาร</a>
      <a href="knowledge.html" class="${activeKey === "knowledge" ? "is-active" : ""}" data-nav="knowledge">บทวิเคราะห์</a>
      <a href="brokers.html" class="${activeKey === "brokers" ? "is-active" : ""}" data-nav="brokers">โบรกเกอร์</a>
      <a href="forum.html" class="${activeKey === "forum" ? "is-active" : ""}" data-nav="forum">ฟอรัม</a>
      <a href="contact.html" class="nav-mobile-only">ติดต่อเรา</a>
      <a href="admin.html" class="nav-mobile-only">หลังบ้าน</a>`;

    return `<header class="navbar" id="navbar">
      <div class="container navbar__inner">
        <a href="home.html" class="brand" aria-label="${TT.h.esc(
          s.name
        )} - หน้าแรก">
          ${logo(38)}
          <span class="brand__name">
            ${brandName()}
            <span>Trading Tools</span>
          </span>
        </a>
        <nav class="nav-links" id="navLinks" aria-label="เมนูหลัก">
          ${linksWithDrop}
        </nav>
        <div class="nav-actions">
          <a href="contact.html" class="btn btn--ghost-light btn--sm">ติดต่อเรา</a>
          <a href="admin.html" class="btn btn--teal btn--sm">หลังบ้าน</a>
          <button class="nav-toggle" id="navToggle" aria-label="เปิด/ปิดเมนู" aria-expanded="false" aria-controls="navLinks">
            <span></span>
          </button>
        </div>
      </div>
    </header>`;
  }

  // ---------- Ticker tape ----------
  // Markup คงที่ (ไม่ขึ้นกับข้อมูล) — ข้อมูลจะถูก render ทีหลังโดย initTicker()
  // ผ่าน subscribe ของ MarketTickerService เพื่อให้ refresh แล้ว motion ไม่ reset
  function ticker() {
    return `<div class="ticker-tape ticker-tape--infographic" id="marketTicker" data-ticker-state="loading" aria-label="ราคาตลาดล่าสุด">
      <div class="ticker-tape__label">
        <span class="ticker-tape__live-dot" aria-hidden="true"></span>
        <span class="ticker-tape__live-text">ราคาอ้างอิงตลาด</span>
      </div>
      <button class="ticker-tape__play" id="tickerPlayBtn" type="button" aria-label="หยุด/เล่นการเลื่อนราคา" aria-pressed="false">
        <svg class="ticker-tape__play-icon ticker-tape__play-icon--pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        <svg class="ticker-tape__play-icon ticker-tape__play-icon--play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7V5z"/></svg>
      </button>
      <div class="ticker-tape__viewport" id="tickerViewport">
        <div class="ticker-tape__track" id="tickerTrack" aria-live="polite">
          <!-- skeleton (loading) -->
          <div class="ticker-tape__skeleton" aria-hidden="true">
            ${Array.from({ length: 7 })
              .map(
                () =>
                  `<span class="ticker-tape__skeleton-item"><span class="ticker-tape__sk-bar"></span><span class="ticker-tape__sk-bar ticker-tape__sk-bar--w2"></span><span class="ticker-tape__sk-bar ticker-tape__sk-bar--w3"></span></span>`
              )
              .join("")}
          </div>
        </div>
      </div>
      <div class="ticker-tape__meta" id="tickerMeta" aria-live="polite">
        <span class="ticker-tape__status-badge" data-badge hidden></span>
        <span class="ticker-tape__updated" data-updated hidden></span>
      </div>
    </div>`;
  }

  // ---------- Footer ----------
  function footer() {
    const s = SITE();
    const year = new Date().getFullYear();
    const navCols = [
      { title: "บริการ", links: s.nav.slice(1, 5) },
      { title: "ข้อมูล", links: s.nav.slice(4, 8) },
    ];

    return `<footer class="footer">
      <div class="container">
        <div class="footer__top">
          <div class="footer__brand">
            <a href="home.html" class="brand">
              ${logo(32)}
              <span class="brand__name">
                ${brandName()}
                <span>Trading Tools</span>
              </span>
            </a>
            <p>${TT.h.esc(s.description)}</p>
            <div class="footer__social">
              <a href="contact.html" aria-label="LINE" title="LINE">${TT.icon("line", 18)}</a>
              <a href="contact.html" aria-label="Telegram" title="Telegram">${TT.icon("telegram", 18)}</a>
              <a href="contact.html" aria-label="Facebook" title="Facebook">${TT.icon("facebook", 18)}</a>
              <a href="mailto:${TT.h.esc(s.email)}" aria-label="Email" title="Email">${TT.icon("mail", 18)}</a>
            </div>
          </div>
          ${navCols
            .map(
              (col) => `<div class="footer__col">
                <h4>${TT.h.esc(col.title)}</h4>
                <ul>
                  ${col.links
                    .map(
                      (l) =>
                        `<li><a href="${l.href}">${TT.h.esc(l.label)}</a></li>`
                    )
                    .join("")}
                </ul>
              </div>`
            )
            .join("")}
          <div class="footer__col">
            <h4>คำเตือนความเสี่ยง</h4>
            <div class="footer__risk">${TT.h.esc(s.riskWarning)}</div>
          </div>
        </div>
        <div class="footer__bottom">
          <span>© ${year} ${TT.h.esc(
      s.name
    )} — สงวนลิขสิทธิ์</span>
          <span>ข่าว ปฏิทินเศรษฐกิจ และราคาตลาดเชื่อมต่อข้อมูลจริงแล้ว</span>
        </div>
      </div>
    </footer>`;
  }

  // ---------- Page shell ----------
  function page({ active, main, titleSuffix }) {
    document.body.classList.remove("home-v2");
    document.body.classList.add("subpage-v2");
    return `${navbar(active)}
    <main id="main">
      ${main}
    </main>
    ${footer()}`;
  }

  // ---------- Behaviours ----------
  function initNavbar() {
    const navbarEl = document.getElementById("navbar");
    const toggle = document.getElementById("navToggle");
    const links = document.getElementById("navLinks");

    if (toggle) {
      toggle.addEventListener("click", () => {
        const open = document.body.classList.toggle("nav-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      links &&
        links.querySelectorAll("a").forEach((a) =>
          a.addEventListener("click", () => {
            document.body.classList.remove("nav-open");
            toggle.setAttribute("aria-expanded", "false");
          })
        );
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && document.body.classList.contains("nav-open")) {
          document.body.classList.remove("nav-open");
          toggle.setAttribute("aria-expanded", "false");
          toggle.focus();
        }
      });
    }

    // เริ่ม Live Market ticker ทุกครั้งที่หน้า render navbar/ticker
    // (idempotent: initTicker กัน bind ซ้ำเอง)
    initTicker();
  }

  // ---------- Ticker behaviour ----------
  // สังเกต: ทุก element id จะ unique ต่อ document — แต่ ticker อาจถูก render
  // ใหม่ใน SPA-like flow ของหน้า จึงอ้างผ่าน root element ที่รับเข้ามา
  const REDUCED_MOTION = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  function fmtPrice(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    // ≥ 100: แสดง 2 ทศนิยมเสมอ (มาตรฐานตลาดทอง/forex majors/crypto)
    // < 100: อนุญาตถึง 5 ทศนิยม (เช่น 1.0892)
    if (n >= 100) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
  }

  function fmtPct(p) {
    if (typeof p !== "number" || !Number.isFinite(p)) return "—";
    const sign = p > 0 ? "+" : "";
    return sign + p.toFixed(2) + "%";
  }

  function fmtChange(c) {
    if (typeof c !== "number" || !Number.isFinite(c)) return "—";
    const sign = c > 0 ? "+" : "";
    return sign + c.toFixed(2);
  }

  function fmtUpdated(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return "อัปเดตเมื่อ " + d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  /** สร้าง markup ของ item หนึ่งตัว */
  function renderItem(t) {
    const dir = t.direction || "flat";
    const dirClass = dir === "up" ? "up" : dir === "down" ? "down" : "flat";
    const changeClass = dir === "up" ? "text-buy" : dir === "down" ? "text-sell" : "text-muted";
    const sparkPoints =
      dir === "up"
        ? "1,13 8,10 14,11 20,6 27,8 34,3 41,1"
        : dir === "down"
        ? "1,2 8,5 14,4 20,9 27,7 34,13 41,15"
        : "1,8 41,8";
    const label = TT.h.esc(t.label || t.symbol);
    const symbol = TT.h.esc(t.symbol);
    return `<a href="signal.html?symbol=${symbol}" class="ticker-tape__item ticker-link" data-dir="${dirClass}">
      <span class="ticker-tape__status ticker-tape__status--${dirClass}" aria-hidden="true"></span>
      <span class="pair" title="${label}">${symbol}<span class="ticker-tape__label-sm">${label}</span></span>
      <span class="ticker-tape__price">${TT.h.esc(fmtPrice(t.price))}</span>
      <span class="${changeClass} ticker-tape__chg">${TT.h.esc(fmtChange(t.change))}</span>
      <span class="${changeClass} ticker-tape__pct">${TT.h.esc(fmtPct(t.changePercent))}</span>
      <svg class="ticker-tape__spark ticker-tape__spark--${dirClass}" viewBox="0 0 42 16" aria-hidden="true">
        <polyline points="${sparkPoints}" />
      </svg>
    </span>`;
  }

  /** ตรวจว่า ticker นี้กำลังเล่นอยู่หรือถูก pause */
  function tickerStateClass(root) {
    return root.classList.contains("is-paused") ? "paused" : "playing";
  }

  /** ตั้ง motion (เปิด/ปิด) โดยไม่ทำลาย transform ปัจจุบัน */
  function applyMotion(root, track) {
    const paused = root.classList.contains("is-paused");
    if (paused) {
      track.classList.add("is-motion-off");
      track.style.animationPlayState = "paused";
    } else {
      track.classList.remove("is-motion-off");
      track.style.animationPlayState = "running";
    }
  }

  function bindControls(root) {
    const playBtn = root.querySelector("#tickerPlayBtn");
    const track = root.querySelector("#tickerTrack");
    if (!playBtn || !track) return;

    // หยุด motion ตอน focus เท่านั้น เพื่อไม่ให้แถบค้างเมื่อเมาส์/ตัวชี้เปิดหน้าอยู่เหนือ ticker
    const pause = () => {
      track.style.animationPlayState = "paused";
    };
    const resume = () => {
      if (root.classList.contains("is-paused")) return; // ผู้ใจตั้ง pause ไว้ → ไม่เล่น
      track.style.animationPlayState = "running";
    };
    root.addEventListener("focusin", pause);
    root.addEventListener("focusout", resume);

    // ปุ่ม pause/play
    const togglePlay = () => {
      const pausedNow = root.classList.toggle("is-paused");
      playBtn.setAttribute("aria-pressed", pausedNow ? "true" : "false");
      playBtn.setAttribute(
        "aria-label",
        pausedNow ? "เล่นการเลื่อนราคาต่อ" : "หยุดการเลื่อนราคา"
      );
      root.setAttribute("data-user-paused", pausedNow ? "true" : "false");
      applyMotion(root, track);
    };
    playBtn.addEventListener("click", togglePlay);

    // ถ้า OS ตั้ง reduced-motion ไว้ → ปิด motion เริ่มต้น และ sync อัตโนมัติ
    const syncReduced = () => applyMotion(root, track);
    if (REDUCED_MOTION.addEventListener) {
      REDUCED_MOTION.addEventListener("change", syncReduced);
    } else if (REDUCED_MOTION.addListener) {
      REDUCED_MOTION.addListener(syncReduced);
    }
    syncReduced();
  }

  /**
   * render รายการลงใน track — ใช้เทคนิค "duplicate track" (สองชุดต่อกัน)
   * เพื่อให้ marquee เลื่อนต่อเนื่อง loop โดยไม่กระตุก
   * สำคัญ: ไม่แตะ root เอง ทำให้ position ปัจจุบันไม่ reset
   */
  /**
   * ลายเซ็นของรายการปัจจุบันใน track — ใช้ตรวจว่าข้อมูลใหม่ "เหมือนเดิม"
   * (เรียง symbol เดียวกัน) หรือไม่ ถ้าเหมือนเดิม → patch ค่าเฉพาะ
   * โดยไม่ rebuild markup เพื่อไม่ให้ marquee animation reset (ห้ามกระตุก)
   */
  function itemsSignature(items) {
    if (!items || !items.length) return "";
    // case-insensitive + label-inclusive เพื่อ patch ได้แม้ symbol ส่งต่าง case
    return items.map((t) => String(t.symbol).toUpperCase()).join("|");
  }

  /** patch ค่าใน item DOM nodes ที่มีอยู่แล้ว (price/change/pct/status/spark) */
  function patchItems(root, items) {
    const rows = root.querySelectorAll(".ticker-tape__row");
    if (!rows.length) return false;
    rows.forEach((row) => {
      const nodes = row.querySelectorAll(".ticker-tape__item");
      items.forEach((t, i) => {
        const node = nodes[i];
        if (!node) return;
        const dir = t.direction || "flat";
        const dirClass = dir === "up" ? "up" : dir === "down" ? "down" : "flat";
        const changeClass = dir === "up" ? "text-buy" : dir === "down" ? "text-sell" : "text-muted";
        node.setAttribute("data-dir", dirClass);
        node.setAttribute("class", "ticker-tape__item");

        const status = node.querySelector(".ticker-tape__status");
        if (status) status.setAttribute("class", "ticker-tape__status ticker-tape__status--" + dirClass);

        const price = node.querySelector(".ticker-tape__price");
        if (price) price.textContent = fmtPrice(t.price);

        const chg = node.querySelector(".ticker-tape__chg");
        if (chg) {
          chg.textContent = fmtChange(t.change);
          chg.setAttribute("class", changeClass + " ticker-tape__chg");
        }
        const pct = node.querySelector(".ticker-tape__pct");
        if (pct) {
          pct.textContent = fmtPct(t.changePercent);
          pct.setAttribute("class", changeClass + " ticker-tape__pct");
        }
        const spark = node.querySelector(".ticker-tape__spark");
        if (spark) {
          spark.setAttribute(
            "points",
            dir === "up"
              ? "1,13 8,10 14,11 20,6 27,8 34,3 41,1"
              : dir === "down"
              ? "1,2 8,5 14,4 20,9 27,7 34,13 41,15"
              : "1,8 41,8"
          );
          spark.setAttribute("class", "ticker-tape__spark ticker-tape__spark--" + dirClass);
        }
      });
    });
    return true;
  }

  function renderItems(root, items) {
    const track = root.querySelector("#tickerTrack");
    if (!track) return;
    if (!items || items.length === 0) {
      track.innerHTML = `<div class="ticker-tape__empty">ยังไม่มีข้อมูลราคา</div>`;
      applyMotion(root, track);
      return;
    }

    // smart-update: ถ้าเรียง symbol เหมือนเดิม → patch ค่า ไม่ rebuild (กัน reset motion)
    const prevSig = track.getAttribute("data-sig") || "";
    const sig = itemsSignature(items);
    if (prevSig === sig) {
      if (patchItems(root, items)) {
        applyMotion(root, track);
        return;
      }
    }

    // rebuild (กรณีแรก หรือ symbol เปลี่ยน)
    const set = items.map(renderItem).join("");
    // duplicate เพื่อ seamless loop (track กว้างพอเลื่อนต่อ)
    track.innerHTML = `<div class="ticker-tape__row">${set}</div><div class="ticker-tape__row ticker-tape__row--clone" aria-hidden="true">${set}</div>`;
    track.setAttribute("data-sig", sig);
    applyMotion(root, track);
  }

  function renderStatus(root, snap) {
    const badge = root.querySelector('[data-badge]');
    const updated = root.querySelector('[data-updated]');
    const liveText = root.querySelector(".ticker-tape__live-text");
    const liveDot = root.querySelector(".ticker-tape__live-dot");

    let badgeText = "";
    let badgeKind = ""; // "" | "live" | "stale" | "error" | "empty"
    let updatedText = "";
    let liveLabel = "ราคาอ้างอิงตลาด";

    switch (snap.status) {
      case "loading":
        badgeText = ""; // skeleton แสดงอยู่ใน track
        liveLabel = "กำลังโหลด…";
        break;
      case "live":
        badgeText = "Live";
        badgeKind = "live";
        updatedText = fmtUpdated(snap.updatedAt) || fmtUpdated(new Date().toISOString());
        liveLabel = "ราคาอ้างอิงตลาด";
        break;
      case "stale":
        badgeText = "ข้อมูลล่าสุดที่มี";
        badgeKind = "stale";
        updatedText = fmtUpdated(snap.updatedAt);
        liveLabel = "ราคาอ้างอิงล่าสุด";
        break;
      case "unavailable":
        badgeText = "ไม่สามารถอัปเดตราคาได้";
        badgeKind = "error";
        liveLabel = "ราคาอ้างอิงไม่พร้อม";
        break;
      case "empty":
        badgeText = "ยังไม่มีข้อมูลราคา";
        badgeKind = "empty";
        liveLabel = "ไม่มีข้อมูลราคา";
        break;
      default:
        break;
    }

    root.setAttribute("data-ticker-state", snap.status);

    if (badge) {
      if (badgeText) {
        badge.textContent = badgeText;
        badge.setAttribute("class", "ticker-tape__status-badge ticker-tape__status-badge--" + badgeKind);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
    if (updated) {
      if (updatedText) {
        updated.textContent = updatedText;
        updated.hidden = false;
      } else {
        updated.hidden = true;
      }
    }
    if (liveText) liveText.textContent = liveLabel;
    if (liveDot) {
      liveDot.setAttribute(
        "data-live",
        snap.status === "live" ? "live" : snap.status === "stale" ? "stale" : "off"
      );
    }
  }

  /**
   * initTicker — bind ตัวจัดการและ subscribe กับ service
   * idempotent: ถ้าเรียกซ้ำในหน้าเดียวกัน จะไม่ bind ซ้ำ
   * auto-inject: ถ้าหน้านี้ยังไม่มี #marketTicker (เช่น admin/contact/faq)
   * จะแทรก ticker เข้าไปเป็น first child ของ #main (หรือใต้ #navbar)
   * เพื่อให้ ticker ปรากฏในทุกหน้าที่มี header — โดยไม่แตะ JS ของหน้านั้น
   */
  function initTicker() {
    // opt-out: หน้าที่ติด class "no-ticker" จะไม่เริ่ม ticker
    // (เช่น EA Hub — ไม่จำเป็นต้องโหลดราคา, กัน warning จาก fetch ที่อาจ fail)
    if (document.body.classList.contains("no-ticker")) return;

    let root = document.getElementById("marketTicker");

    // Auto-inject: ถ้าหน้านี้ยังไม่มี ticker → สร้างและแทรกใต้ header
    if (!root) {
      const main = document.getElementById("main");
      const navbarEl = document.getElementById("navbar");
      const tmp = document.createElement("div");
      tmp.innerHTML = ticker().trim();
      root = tmp.firstElementChild;
      if (!root) return;

      if (main && main.firstChild) {
        // แทรกเป็น first child ของ main (ก่อน section.page)
        main.insertBefore(root, main.firstChild);
      } else if (main) {
        main.appendChild(root);
      } else if (navbarEl && navbarEl.parentNode) {
        // fallback: แทรกหลัง navbar
        navbarEl.parentNode.insertBefore(root, navbarEl.nextSibling);
      } else {
        return;
      }
    }

    if (root.dataset.ttBound === "1") return; // กัน bind ซ้ำ
    root.dataset.ttBound = "1";

    bindControls(root);

    // subscribe กับ service → update track + status เท่านั้น (ไม่ re-render root)
    const svc = TT.MarketTickerService;
    if (!svc) {
      renderStatus(root, { status: "unavailable" });
      return;
    }

    svc.subscribe((snap) => {
      renderStatus(root, snap);
      if (snap.status === "unavailable" || snap.status === "empty") {
        // ถ้าไม่มีข้อมูลเลย → แสดงข้อความใน track แทน skeleton
        const track = root.querySelector("#tickerTrack");
        if (track) {
          if (snap.status === "empty") {
            track.innerHTML = `<div class="ticker-tape__empty">ยังไม่มีข้อมูลราคา</div>`;
          } else {
            track.innerHTML = `<div class="ticker-tape__empty ticker-tape__empty--error">ไม่สามารถอัปเดตราคาได้</div>`;
          }
          applyMotion(root, track);
        }
      } else if (snap.items && snap.items.length) {
        renderItems(root, snap.items);
      }
    });

    // เริ่มดึงข้อมูล + auto-refresh
    svc.start();
  }

  return { navbar, footer, ticker, page, logo, initNavbar, initTicker };
})();

TT.navbar = TT.layout.navbar;
TT.footer = TT.layout.footer;
TT.page = TT.layout.page;
