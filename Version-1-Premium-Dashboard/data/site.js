/* ============================================================
   Mock Data — Site config & ticker
   ============================================================ */

window.TT = window.TT || {};

TT.site = {
  name: "TraderToolsTH",
  tagline: "เครื่องมือเทรดเดอร์ครบวงจร",
  description:
    "รวมข่าวตลาด Signal ปฏิทินเศรษฐกิจ รีวิว Broker และความรู้การเทรด ไว้ในแบรนด์เดียว",
  email: "support@tradertoolsth.com",
  line: "@tradertoolsth",
  telegram: "t.me/tradertoolsth",
  facebook: "facebook.com/tradertoolsth",
  nav: [
    { href: "home.html", label: "หน้าแรก", key: "home" },
    { href: "signal.html", label: "Signal", key: "signal" },
    { href: "news.html", label: "ข่าว", key: "news" },
    { href: "calendar.html", label: "ปฏิทินข่าว", key: "calendar" },
    { href: "brokers.html", label: "Broker", key: "brokers" },
    { href: "knowledge.html", label: "ความรู้", key: "knowledge" },
    { href: "faq.html", label: "FAQ", key: "faq" },
    { href: "contact.html", label: "ติดต่อเรา", key: "contact" },
  ],
  riskWarning:
    "การเทรด Forex และสินทรัพย์ที่มีหลักประกัน (leveraged products) มีความเสี่ยงสูง อาจทำให้สูญเสียเงินทุนทั้งหมด ควรใช้เงินที่ไม่กระทบความเป็นอยู่ Signal และข้อมูลบนเว็บไซต์เป็นเพียงแนวทาง ไม่ใช่คำแนะนำให้ซื้อหรือขาย",
};

TT.ticker = [
  { pair: "XAUUSD", price: "2,365.40", change: "+0.82%", dir: "up" },
  { pair: "EURUSD", price: "1.0892", change: "+0.31%", dir: "up" },
  { pair: "GBPUSD", price: "1.2785", change: "+0.24%", dir: "up" },
  { pair: "USDJPY", price: "161.45", change: "-0.18%", dir: "down" },
  { pair: "BTCUSD", price: "58,920", change: "+1.45%", dir: "up" },
  { pair: "AUDUSD", price: "0.6712", change: "-0.12%", dir: "down" },
  { pair: "USDCAD", price: "1.3648", change: "+0.05%", dir: "up" },
  { pair: "DXY", price: "104.32", change: "-0.22%", dir: "down" },
];
