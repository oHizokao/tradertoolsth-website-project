/* ============================================================
   Page — Contact
   ============================================================ */

(function () {
  const h = TT.h;

  function render() {
    const s = TT.site;
    const main = `
      <section class="page">
        <div class="container">
          <div class="page-head">
            <span class="eyebrow">${TT.icon("contact", 14)} Get in touch</span>
            <h1>ติดต่อ <span class="text-grad-blue">เรา</span></h1>
            <p>ทีมงานพร้อมตอบทุกคำถาม เลือกช่องทางที่สะดวก หรือกรอกแบบฟอร์มด้านล่าง</p>
          </div>

          <div class="contact-grid">
            <!-- Channels -->
            <div>
              <div class="section-header" style="margin-bottom:20px">
                <div class="section-title">
                  <span class="eyebrow">Channels</span>
                  <h2 style="font-size:var(--fs-xl)">ช่องทางติดต่อ</h2>
                </div>
              </div>
              <div class="stack">
                <a href="https://line.me/ti/p/~${h.esc(s.line.replace('@',''))}" target="_blank" rel="noopener" class="contact-channel">
                  <span class="contact-channel__icon">${TT.icon("line", 22)}</span>
                  <div>
                    <div class="contact-channel__label">LINE</div>
                    <div class="contact-channel__value">${h.esc(s.line)}</div>
                  </div>
                </a>
                <a href="https://${h.esc(
                  s.telegram
                )}" target="_blank" rel="noopener" class="contact-channel">
                  <span class="contact-channel__icon">${TT.icon(
                    "telegram",
                    22
                  )}</span>
                  <div>
                    <div class="contact-channel__label">Telegram</div>
                    <div class="contact-channel__value">${h.esc(s.telegram)}</div>
                  </div>
                </a>
                <a href="https://${h.esc(
                  s.facebook
                )}" target="_blank" rel="noopener" class="contact-channel">
                  <span class="contact-channel__icon">${TT.icon(
                    "facebook",
                    22
                  )}</span>
                  <div>
                    <div class="contact-channel__label">Facebook</div>
                    <div class="contact-channel__value">${h.esc(s.facebook)}</div>
                  </div>
                </a>
                <a href="mailto:${h.esc(s.email)}" class="contact-channel">
                  <span class="contact-channel__icon">${TT.icon("mail", 22)}</span>
                  <div>
                    <div class="contact-channel__label">Email</div>
                    <div class="contact-channel__value">${h.esc(s.email)}</div>
                  </div>
                </a>
              </div>

              <div class="alert" style="margin-top:20px">
                <span class="alert__icon">${TT.icon("clock", 18)}</span>
                <div>เวลาตอบกลับ: จันทร์-ศุกร์ 9:00-18:00 น. (ภายใน 24 ชม.)</div>
              </div>
            </div>

            <!-- Form -->
            <div class="card">
              <h3 style="margin-bottom:16px">ส่งข้อความถึงเรา</h3>
              <form id="contactForm" novalidate>
                <div class="field--row">
                  <div class="field">
                    <label for="name">ชื่อ <span class="text-sell">*</span></label>
                    <input type="text" id="name" name="name" required placeholder="ชื่อของคุณ">
                  </div>
                  <div class="field">
                    <label for="email">อีเมล <span class="text-sell">*</span></label>
                    <input type="email" id="email" name="email" required placeholder="you@example.com">
                  </div>
                </div>
                <div class="field">
                  <label for="subject">หัวข้อ</label>
                  <select id="subject" name="subject">
                    <option value="signal">สอบถามเรื่อง Signal</option>
                    <option value="broker">สอบถามเรื่อง Broker</option>
                    <option value="premium">สนใจ Premium</option>
                    <option value="other">อื่น ๆ</option>
                  </select>
                </div>
                <div class="field">
                  <label for="message">ข้อความ <span class="text-sell">*</span></label>
                  <textarea id="message" name="message" required placeholder="รายละเอียดที่ต้องการสอบถาม..."></textarea>
                </div>
                <div id="formMsg" style="margin-bottom:12px"></div>
                <button type="submit" class="btn btn--primary btn--block btn--lg">
                  ${TT.icon("mail", 18)} ส่งข้อความ
                </button>
                <p class="disclosure" style="margin-top:12px">
                  * ยังไม่มีระบบส่งเมลจริงในระยะแรก การส่งฟอร์มนี้เป็นการสาธิต กรุณาติดต่อผ่านช่องทางด้านซ้ายเพื่อรับการตอบกลับจริง
                </p>
              </form>
            </div>
          </div>

          <!-- FAQ shortcut -->
          <div class="card" style="margin-top:32px;text-align:center">
            <h3 style="margin-bottom:8px">ลองดู FAQ ก่อนไหม?</h3>
            <p class="text-secondary" style="margin-bottom:16px">คำถามที่พบบ่อยอาจมีคำตอบที่คุณหาอยู่แล้ว</p>
            <a href="faq.html" class="btn btn--ghost">${TT.icon("faq", 16)} ไปที่ FAQ</a>
          </div>
        </div>
      </section>
    `;

    document.getElementById("app").innerHTML = TT.layout.page({
      active: "contact",
      main,
    });
    TT.layout.initNavbar();
    bindForm();
  }

  function bindForm() {
    const form = document.getElementById("contactForm");
    const msg = document.getElementById("formMsg");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name = (data.get("name") || "").toString().trim();
      const email = (data.get("email") || "").toString().trim();
      const message = (data.get("message") || "").toString().trim();

      if (!name || !email || !message) {
        msg.innerHTML = `<div class="alert alert--warn"><span class="alert__icon">${TT.icon(
          "warning",
          16
        )}</span><div>กรุณากรอกชื่อ อีเมล และข้อความให้ครบ</div></div>`;
        return;
      }

      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) {
        msg.innerHTML = `<div class="alert alert--warn"><span class="alert__icon">${TT.icon(
          "warning",
          16
        )}</span><div>รูปแบบอีเมลไม่ถูกต้อง</div></div>`;
        return;
      }

      // สาธิต: ยังไม่ส่งจริง
      msg.innerHTML = `<div class="alert" style="border-color:var(--border-accent);background:var(--accent-soft)"><span class="alert__icon text-accent">${TT.icon(
        "check",
        16
      )}</span><div>ส่งข้อความสำเร็จ (โหมดสาธิต) — ทีมงานจะติดต่อกลับผ่านช่องทางอื่น</div></div>`;
      form.reset();
    });
  }

  document.addEventListener("DOMContentLoaded", render);
})();
