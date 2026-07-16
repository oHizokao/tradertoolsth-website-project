/* ============================================================
   TraderToolsTH — Helpers
   ============================================================ */

window.TT = window.TT || {};

TT.h = {
  // HTML escape
  esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  // จัดรูปแบบเวลาเป็นภาษาไทย
  formatTime(iso, opts = {}) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d)) return "-";
    const time = d.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (opts.timeOnly) return time + " น.";
    const date = d.toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return `${date} • ${time} น.`;
  },

  formatDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d)) return "-";
    return d.toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  },

  // Phase 8: แปลง ISO (UTC) → เวลา Asia/Bangkok สำหรับ "เผยแพร่เมื่อ ..."
  // ไม่พึ่ง timezone เครื่องรัน (รวม offset +7 เอง)
  // รองรับ label ที่ backend ส่งมาเลย หรือคำนวณใหม่จาก sourcePublishedAt
  formatBangkok(iso, opts = {}) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d)) return "-";
    const bangkokMs = d.getTime() + 7 * 3_600_000;
    const dt = new Date(bangkokMs);
    const TH_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
    const day = String(dt.getUTCDate()).padStart(2, "0");
    const month = TH_SHORT[dt.getUTCMonth()];
    const year = dt.getUTCFullYear();
    const hh = String(dt.getUTCHours()).padStart(2, "0");
    const mm = String(dt.getUTCMinutes()).padStart(2, "0");
    if (opts.timeOnly) return `${hh}:${mm} น.`;
    const body = `${day} ${month} ${year} ${hh}:${mm} น.`;
    const prefix = opts.prefix != null ? opts.prefix : "เผยแพร่เมื่อ ";
    return `${prefix}${body}`;
  },

  // Phase 8: เวลาที่ระบบนำเข้า (importedAt) — ข้อมูลภายใน ไม่ใช่ตัวเรียงหลัก
  formatImported(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d)) return "-";
    const bangkokMs = d.getTime() + 7 * 3_600_000;
    const dt = new Date(bangkokMs);
    const TH_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
    const day = String(dt.getUTCDate()).padStart(2, "0");
    const month = TH_SHORT[dt.getUTCMonth()];
    const year = dt.getUTCFullYear();
    const hh = String(dt.getUTCHours()).padStart(2, "0");
    const mm = String(dt.getUTCMinutes()).padStart(2, "0");
    return `นำเข้าระบบ ${day} ${month} ${year} ${hh}:${mm} น.`;
  },

  // วันในสัปดาห์ภาษาไทย
  weekdayTh(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัส","ศุกร์","เสาร์"][d.getDay()];
  },

  // สีตามทิศทาง
  dirText(dir) {
    return dir === "buy" ? "BUY" : "SELL";
  },

  dirBadgeClass(dir) {
    return "badge--" + (dir === "buy" ? "buy" : "sell");
  },

  impactText(impact) {
    return { high: "สูง", medium: "กลาง", low: "ต่ำ" }[impact] || impact;
  },

  impactBadgeClass(impact) {
    return "badge--" + impact;
  },

  statusText(status) {
    return { active: "เปิดอยู่", closed: "ปิดแล้ว" }[status] || status;
  },

  // ดึง query param
  query(name) {
    const params = new URLSearchParams(location.search);
    return params.get(name);
  },

  // ตัดข้อความ
  truncate(str, len = 120) {
    if (!str) return "";
    return str.length > len ? str.slice(0, len).trim() + "…" : str;
  },

  // แปลงตัวเลขเป็นจำนวนเงินแบบ mono
  num(v, digits = 2) {
    if (v == null || isNaN(v)) return "-";
    return Number(v).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  },

  // ดาวตามคะแนน 1-5
  stars(rating) {
    const full = Math.round(rating);
    return "★★★★★☆☆☆☆☆".slice(5 - full, 10 - full);
  },

  // จำลอง lazy reveal ด้วย IntersectionObserver
  revealOnScroll() {
    const els = document.querySelectorAll(".reveal");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    els.forEach((el) => io.observe(el));
  },

  // แสดง loading skeleton
  loading(container, count = 3) {
    if (!container) return;
    container.innerHTML = Array.from({ length: count })
      .map(
        () => `<div class="card">
          <div class="skeleton" style="height:14px;width:40%;margin-bottom:12px"></div>
          <div class="skeleton" style="height:18px;width:80%;margin-bottom:8px"></div>
          <div class="skeleton" style="height:14px;width:100%;margin-bottom:6px"></div>
          <div class="skeleton" style="height:14px;width:60%"></div>
        </div>`
      )
      .join("");
  },

  // แสดง empty state
  empty(container, title = "ยังไม่มีข้อมูล", desc = "") {
    if (!container) return;
    container.innerHTML = `<div class="state">
      <div class="state__title">${TT.h.esc(title)}</div>
      ${desc ? `<p>${TT.h.esc(desc)}</p>` : ""}
    </div>`;
  },

  // แสดง error state
  error(container, msg = "เกิดข้อผิดพลาดในการโหลดข้อมูล") {
    if (!container) return;
    container.innerHTML = `<div class="state">
      <div class="state__title">⚠️ ${TT.h.esc(msg)}</div>
      <p>กรุณาลองใหม่อีกครั้ง หรือรีเฟรชหน้าเว็บ</p>
    </div>`;
  },
};
