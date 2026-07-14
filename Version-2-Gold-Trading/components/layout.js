/* ============================================================
   Layout Components — Navbar + Footer + Ticker (v3)
   Navy header with dropdown, login/signup; navy footer
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
      { href: "calendar.html", label: "ปฏิทินเศรษฐกิจ" },
      { href: "faq.html", label: "คำถามที่พบบ่อย" },
    ];
    const toolsDropdown = `<div class="nav-item--has-drop">
      <a href="calendar.html" class="${
        ["calendar", "faq"].includes(activeKey) ? "is-active" : ""
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
      <a href="brokers.html" class="${activeKey === "brokers" ? "is-active" : ""}" data-nav="brokers">โบรกเกอร์</a>`;

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
          <button class="nav-icon-btn" aria-label="ค้นหา">${TT.icon("search", 20)}</button>
          <button class="nav-icon-btn nav-theme-btn" aria-label="เปลี่ยนธีม">☾</button>
          <button class="nav-lang" aria-label="เปลี่ยนภาษา">TH</button>
          <span class="nav-divider"></span>
          <a href="contact.html" class="btn btn--ghost-light btn--sm">เข้าสู่ระบบ</a>
          <a href="contact.html" class="btn btn--teal btn--sm">สมัครสมาชิก</a>
          <button class="nav-toggle" id="navToggle" aria-label="เปิด/ปิดเมนู" aria-expanded="false" aria-controls="navLinks">
            <span></span>
          </button>
        </div>
      </div>
    </header>`;
  }

  // ---------- Ticker tape ----------
  function ticker() {
    const items = (TT.ticker || [])
      .map(
        (t) => `<span class="ticker-tape__item">
          <span class="pair">${TT.h.esc(t.pair)}</span>
          <span>${TT.h.esc(t.price)}</span>
          <span class="${t.dir === "up" ? "text-buy" : "text-sell"}">${TT.h.esc(
          t.change
        )}</span>
        </span>`
      )
      .join("");
    return `<div class="ticker-tape" aria-label="ราคาตลาดล่าสุด">
      <div class="ticker-tape__track">${items}${items}</div>
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
          <span>ระบบข่าวเชื่อม API แล้ว • ส่วนอื่นเป็นข้อมูลตัวอย่าง</span>
        </div>
      </div>
    </footer>`;
  }

  // ---------- Page shell ----------
  function page({ active, main, titleSuffix }) {
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
  }

  return { navbar, footer, ticker, page, logo, initNavbar };
})();

TT.navbar = TT.layout.navbar;
TT.footer = TT.layout.footer;
TT.page = TT.layout.page;
