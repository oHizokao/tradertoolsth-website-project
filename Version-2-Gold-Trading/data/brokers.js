/* ============================================================
   Broker Review Data — Verified from official primary sources
   ------------------------------------------------------------
   นโยบายข้อมูล (Content Policy):
   - ทุก claim สำคัญ (license, account, deposit/withdraw, platform)
     มี URL แหล่งข้อมูลทางการใน object `sources`
   - ฟิลด์ที่ยังยืนยันไม่ได้จากแหล่งทางการจะถูกตั้งค่าเป็น
     null และมี verified: false พร้อมเหตุผลใน `verificationNote`
   - ห้ามใส่ score / spread / โบนัส / ความเร็วถอน ถ้าไม่มีแหล่งอ้างอิง
   - ห้ามใช้คำกล่าวอ้างความเป็น "ที่สุด" หรือชี้นำให้ลงทุน
   - โครงสร้างนี้ออกแบบให้ Backend CMS สามารถนำเข้า (import) ได้โดยตรง
     ผ่าน JSON Schema เดียวกัน (ดู TT.brokerSchema)
   ============================================================ */

window.TT = window.TT || {};

/**
 * JSON Schema descriptor — ใช้เป็นสัญญา (contract) ระหว่าง Frontend
 * กับ Backend CMS ในอนาคต ฟิลด์ไหนบังคับ / ไม่บังคับ / ชนิดใด ระบุไว้ที่นี่
 * ทีม Backend สามารถวาง schema นี้ลง CMS แล้ว map ได้ทันที
 */
TT.brokerSchema = {
  version: "2.0",
  required: [
    "id",
    "slug",
    "name",
    "officialUrl",
    "platforms",
    "verifiedAt",
    "verificationStatus",
    "sources",
  ],
  fields: {
    id: "string (unique key)",
    slug: "string (URL slug, unique)",
    name: "string (display name)",
    shortName: "string (logo abbreviation)",
    logoColor: "string (hex, for placeholder logo)",
    officialUrl: "string (official website, https)",
    platforms: "string[] (verified platform names)",
    accountTypes:
      "Array<{ name, minDepositUsd|null, note? }> (null = รอตรวจสอบ)",
    regulations:
      "Array<{ regulator, entity, licenseNo|null, brokerPageUrl, registryUrl, registryVerified }>",
    fundingMethods: "string[]|null (null = รอตรวจสอบ)",
    highlights: "string[] (จุดเด่นที่ตรวจสอบได้จากแหล่งทางการ)",
    considerations: "string[] (ข้อควรพิจารณาที่ตรวจสอบได้)",
    suitableFor: "string (เหมาะกับใคร — บรรยายตามข้อเท็จจริง ไม่ชี้นำ)",
    overview: "string (ภาพรวมกลาง ๆ ไม่ชี้นำให้ลงทุน)",
    riskWarningUrl: "string (ลิงก์หน้า risk disclosure ทางการ)",
    verifiedAt: "string (ISO date YYYY-MM-DD)",
    verificationStatus: "'verified' | 'partial' | 'pending'",
    verificationNote: "string (คำอธิบายสถานะการตรวจสอบ)",
    sources: "Array<{ field, url, label, verifiedAt }>",
  },
};

/**
 * Methodology — "วิธีให้คะแนน" / เกณฑ์การรีวิว
 * แสดงต่อสาธารณะเพื่อความโปร่งใส ห้ามแก้เป็น claim ที่ไม่ตรวจสอบได้
 */
TT.brokerMethodology = {
  title: "วิธีการรวบรวมและตรวจสอบข้อมูลโบรกเกอร์",
  updatedAt: "2026-07-16",
  criteria: [
    {
      label: "แหล่งข้อมูลหลักเท่านั้น",
      desc: "เราเก็บข้อมูลจากเว็บไซต์ทางการของโบรกเกอร์ และหน้า registry ของหน่วยงานกำกับดูแล (regulator) เท่านั้น ไม่นำข้อมูลจากบล็อก ฟอรัม หรือรีวิวบุคคลที่สามมาแสดงเป็นข้อเท็จจริง",
    },
    {
      label: "แสดงเฉพาะข้อมูลที่ตรวจสอบได้",
      desc: "ฟิลด์ใดที่ไม่สามารถยืนยันจากแหล่งทางการได้ (เช่น spread แบบเรียลไทม์ โบนัส ความเร็วถอนเงิน) จะแสดงเป็น “รอตรวจสอบ” แทนการเดา และไม่แสดงคะแนนรวม",
    },
    {
      label: "ไม่จัดอันดับ/ให้คะแนน",
      desc: "เราไม่ได้ให้คะแนนหรือจัดอันดับโบรกเกอร์ เนื่องจากความเหมาะสมขึ้นกับเป้าหมายและเขตอำนาจศาลของผู้ใช้แต่ละท่าน เราจึงนำเสนอข้อเท็จจริงที่ตรวจสอบได้เพื่อให้ผู้ใช้ตัดสินใจด้วยตนเอง",
    },
    {
      label: "ลิงก์อ้างอิงทุก claim",
      desc: "ทุกข้อความสำคัญจะมีลิงก์ไปยังแหล่งข้อมูลต้นทาง พร้อมวันที่ตรวจสอบ เพื่อให้ผู้ใช้ตรวจสอบซ้ำได้ด้วยตนเอง",
    },
    {
      label: "ภูมิภาคและนิติบุคคล",
      desc: "โบรกเกอร์ระดับสากลมักดำเนินงานหลายนิติบุคคลในเขตอำนาจศาลต่างกัน ข้อมูล เช่น ฝากขั้นต่ำ/ช่องทางฝากถอน อาจแตกต่างกันตามภูมิภาค ผู้ใช้ควรตรวจสอบกับนิติบุคคลที่ให้บริการแก่ท่าน",
    },
  ],
};

// ค่าคงที่วันที่ตรวจสอบรอบล่าสุด
const VERIFIED_AT = "2026-07-16";

/**
 * รายการโบรกเกอร์ — ทั้งหมดตรวจสอบจากแหล่งทางการ ณ วันที่ VERIFIED_AT
 * เรียงตามชื่อ (A→Z) ไม่ใช่การจัดอันดับ
 */
TT.brokers = [
  /* ----------------------------------------------------------
     1) Exness
     ---------------------------------------------------------- */
  {
    id: "broker-exness",
    slug: "exness",
    name: "Exness",
    shortName: "EXN",
    logoColor: "#a3e635",
    officialUrl: "https://www.exness.com",
    platforms: ["MetaTrader 4", "MetaTrader 5", "Exness Terminal", "Exness Trade (mobile)"],
    accountTypes: [
      { name: "Standard", minDepositUsd: null, note: "ระบุประเภทบัญชีมาตรฐาน ฝากขั้นต่ำรอตรวจสอบจากหน้าทางการที่เข้าถึงได้" },
      { name: "Professional (Raw Spread / Zero / Pro)", minDepositUsd: null, note: "รอตรวจสอบจำนวนฝากขั้นต่ำจากหน้าบัญชีทางการ" },
      { name: "Demo", minDepositUsd: 0, note: "บัญชีทดลอง ไม่ใช้เงินจริง" },
    ],
    regulations: [
      {
        regulator: "FSA Seychelles",
        entity: "Exness (SC) Ltd",
        licenseNo: "SD025",
        brokerPageUrl: "https://www.exness.com/regulation/",
        registryUrl: "https://www.fsaseychelles.sc/regulated-entities/",
        registryVerified: false,
      },
      {
        regulator: "CySEC (Cyprus)",
        entity: "Exness (Cy) Ltd",
        licenseNo: "178/12",
        brokerPageUrl: "https://www.exness.com/regulation/",
        registryUrl: "https://www.cysec.gov.cy/en-GB/entities/investment-firms/cypriot/",
        registryVerified: false,
        note: "ตามข้อมูลโบรกเกอร์ ไม่ให้บริการลูกค้ารายย่อยภายใต้นิติบุคคลนี้",
      },
      {
        regulator: "FCA (United Kingdom)",
        entity: "Exness (UK) Ltd",
        licenseNo: "730729",
        brokerPageUrl: "https://www.exness.com/regulation/",
        registryUrl: "https://register.fca.org.uk/",
        registryVerified: false,
        note: "ตามข้อมูลโบรกเกอร์ ไม่ให้บริการลูกค้ารายย่อยภายใต้นิติบุคคลนี้",
      },
    ],
    fundingMethods: null, // รอตรวจสอบ — หน้าแสดงวิธีการฝากถอนถูกจำกัดเขตภูมิภาค ไม่สามารถยืนยันรายการได้
    highlights: [
      "ระบุนิติบุคคลและใบอนุญาตหลายแห่งบนหน้า Regulation อย่างเป็นทางการ",
      "รองรับแพลตฟอร์ม MetaTrader 4 / 5 และแอป Exness Trade",
    ],
    considerations: [
      "ข้อมูลบัญชี/ฝากขั้นต่ำและช่องทางฝากถอนขึ้นกับนิติบุคคลและภูมิภาค ควรตรวจสอบกับเอนทิตีที่ให้บริการแก่ท่าน",
      "registry ของบางหน่วยงานกำกับดูแลเป็นระบบแบบโต้ตอบ ผู้ใช้ควรค้นหาเลขใบอนุญาตใน registry โดยตรงเพื่อยืนยัน",
    ],
    suitableFor: "ผู้ที่ต้องการเปรียบเทียบข้อมูลโบรกเกอร์ก่อนตัดสินใจด้วยตนเอง",
    overview:
      "Exness เป็นโบรกเกอร์ที่เปิดเผยข้อมูลนิติบุคคลและใบอนุญาตหลายแห่งบนเว็บไซต์ทางการ รายละเอียดบัญชีและช่องทางฝากถอนแตกต่างกันตามภูมิภาค",
    riskWarningUrl: "https://www.exness.com/regulation/",
    verifiedAt: VERIFIED_AT,
    verificationStatus: "partial",
    verificationNote:
      "ยืนยันได้: เว็บไซต์ทางการ, แพลตฟอร์ม, รายชื่อนิติบุคคล/ใบอนุญาต (ตามข้อมูลโบรกเกอร์), หน้า risk warning. รอตรวจสอบ: ฝากขั้นต่ำรายบัญชี, รายการช่องทางฝากถอน, และการยืนยันใน registry ของแต่ละหน่วยงานกำกับดูแล",
    sources: [
      { field: "เว็บไซต์ทางการ", url: "https://www.exness.com", label: "exness.com", verifiedAt: VERIFIED_AT },
      { field: "แพลตฟอร์ม", url: "https://www.exness.com/regulation/", label: "หน้า Regulation (แสดงรายการแพลตฟอร์ม)", verifiedAt: VERIFIED_AT },
      { field: "นิติบุคคล/ใบอนุญาต", url: "https://www.exness.com/regulation/", label: "หน้า Regulation", verifiedAt: VERIFIED_AT },
      { field: "Risk warning", url: "https://www.exness.com/regulation/", label: "หน้า Regulation (footer)", verifiedAt: VERIFIED_AT },
    ],
  },

  /* ----------------------------------------------------------
     2) IC Markets
     ---------------------------------------------------------- */
  {
    id: "broker-icmarkets",
    slug: "icmarkets",
    name: "IC Markets",
    shortName: "ICM",
    logoColor: "#2dd4ff",
    officialUrl: "https://www.icmarkets.com",
    platforms: ["MetaTrader 4", "MetaTrader 5", "cTrader"],
    accountTypes: [
      { name: "Raw Spread", minDepositUsd: 200 },
      { name: "Standard", minDepositUsd: 200 },
      { name: "cTrader Raw", minDepositUsd: 200 },
      { name: "Raw Pro", minDepositUsd: 2000 },
    ],
    regulations: [
      {
        regulator: "ASIC (Australia)",
        entity: "International Capital Markets Pty Ltd",
        licenseNo: "335692 (AFSL)",
        brokerPageUrl: "https://www.icmarkets.com.au/en/company/regulation",
        registryUrl: "https://connectonline.asic.gov.au/",
        registryVerified: false,
      },
      {
        regulator: "CySEC (Cyprus)",
        entity: "IC Markets (EU) Ltd",
        licenseNo: "362/18",
        brokerPageUrl: "https://www.icmarkets.eu/en/company/regulation",
        registryUrl: "https://www.cysec.gov.cy/en-GB/entities/investment-firms/cypriot/",
        registryVerified: false,
      },
      {
        regulator: "SCB (Bahamas)",
        entity: "IC Markets Ltd",
        licenseNo: "SIA-F214",
        brokerPageUrl: "https://www.icmarkets.com/intl/en/company/regulation",
        registryUrl: "https://www.scb.gov.bs/registered-firms/",
        registryVerified: false,
      },
      {
        regulator: "FSA Seychelles",
        entity: "Raw Trading Ltd",
        licenseNo: "SD018",
        brokerPageUrl: "https://www.icmarkets.com/global/en/company/regulation",
        registryUrl: "https://www.fsaseychelles.sc/licenses/",
        registryVerified: false,
      },
    ],
    fundingMethods: [
      "Visa", "Mastercard", "Wire Transfer", "BPay", "POLi",
      "Skrill", "Neteller", "FasaPay", "Rapid", "UnionPay", "PayPal", "Crypto",
    ],
    highlights: [
      "เปิดเผยข้อมูลนิติบุคคลและเลขใบอนุญาต 4 แห่งบนเว็บทางการรายภูมิภาค",
      "รองรับ MetaTrader 4 / 5 และ cTrader",
    ],
    considerations: [
      "ฝากขั้นต่ำและช่องทางฝากถอนขึ้นกับนิติบุคคล/ภูมิภาคที่ให้บริการ",
      "เลขใบอนุญาตระบุโดยโบรกเกอร์ ผู้ใช้ควรค้นยืนยันใน registry ของหน่วยงานกำกับดูแลอีกครั้ง",
    ],
    suitableFor: "ผู้ที่ต้องการตรวจสอบข้อมูลใบอนุญาตและประเภทบัญชีหลายแบบก่อนตัดสินใจ",
    overview:
      "IC Markets ดำเนินงานหลายนิติบุคคลในเขตอำนาจศาลต่างกัน และเปิดเผยรายละเอียดใบอนุญาตบนเว็บไซต์ทางการรายภูมิภาค",
    riskWarningUrl: "https://www.icmarkets.com/en/company/legal-documents",
    verifiedAt: VERIFIED_AT,
    verificationStatus: "partial",
    verificationNote:
      "ยืนยันได้: เว็บไซต์ทางการ, แพลตฟอร์ม, ประเภทบัญชี, ฝากขั้นต่ำ, ช่องทางฝากถอน, นิติบุคคล/เลขใบอนุญาต (ตามข้อมูลโบรกเกอร์). รอตรวจสอบ: การยืนยันใน registry ของแต่ละหน่วยงานกำกับดูแล (ระบบ registry เป็นแบบโต้ตอบ)",
    sources: [
      { field: "เว็บไซต์ทางการ", url: "https://www.icmarkets.com/", label: "icmarkets.com", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี/ฝากขั้นต่ำ", url: "https://www.icmarkets.com/en/trading-accounts/overview", label: "Trading accounts overview", verifiedAt: VERIFIED_AT },
      { field: "ช่องทางฝากถอน", url: "https://www.icmarkets.com/en/trading-accounts/funding", label: "Funding page", verifiedAt: VERIFIED_AT },
      { field: "นิติบุคคล ASIC", url: "https://www.icmarkets.com.au/en/company/regulation", label: "IC Markets AU regulation", verifiedAt: VERIFIED_AT },
      { field: "นิติบุคคล CySEC", url: "https://www.icmarkets.eu/en/company/regulation", label: "IC Markets EU regulation", verifiedAt: VERIFIED_AT },
      { field: "Risk disclosure", url: "https://www.icmarkets.com/en/company/legal-documents", label: "Legal documents", verifiedAt: VERIFIED_AT },
    ],
  },

  /* ----------------------------------------------------------
     3) InstaForex
     ---------------------------------------------------------- */
  {
    id: "broker-instaforex",
    slug: "instaforex",
    name: "InstaForex",
    shortName: "INF",
    logoColor: "#f59e0b",
    officialUrl: "https://www.instaforex.com",
    platforms: ["MetaTrader 4", "MetaTrader 5", "MultiTerminal", "WebTerminal", "Mobile"],
    accountTypes: [
      { name: "Insta.Standard", minDepositUsd: 1 },
      { name: "Insta.Pro", minDepositUsd: 100 },
      { name: "Insta.Zero", minDepositUsd: 100 },
      { name: "Insta.Raw", minDepositUsd: 100 },
      { name: "Insta.Cent", minDepositUsd: 1 },
    ],
    regulations: [
      {
        regulator: "BVI FSC (British Virgin Islands)",
        entity: "InstaFinance Ltd.",
        licenseNo: "SIBA/L/14/1082",
        brokerPageUrl: "https://www.instaforex.com/regulation",
        registryUrl: "https://www.bvifsc.vc/engaged-businesses",
        registryVerified: false,
        note: "เลขใบอนุญาตระบุโดยโบรกเกอร์ — ระบบ BVI FSC ไม่สามารถเข้าถึง/deep-link ได้ในรอบตรวจสอบนี้",
      },
      {
        regulator: "FSC Saint Vincent (registration)",
        entity: "Insta Service Ltd.",
        licenseNo: "IBC22945",
        brokerPageUrl: "https://www.instaforex.com/regulation",
        registryUrl: null,
        registryVerified: false,
        note: "การจดทะเบียนบริษัท (company registration) ไม่ใช่ใบอนุญาตกำกับดูแลโบรกเกอร์ในความหมายเดียวกับ CySEC/ASIC",
      },
    ],
    fundingMethods: null, // รอตรวจสอบ — หน้ารายการวิธีการอยู่หลังล็อกอิน
    highlights: [
      "มีประเภทบัญชีหลายแบบ ฝากขั้นต่ำเริ่มต้นต่ำตามข้อมูลหน้าทางการ",
      "รองรับ MetaTrader 4 / 5 และแพลตฟอร์มเสริม",
    ],
    considerations: [
      "นิติบุคคลที่ระบุเป็นการจดทะเบียนใน Saint Vincent ซึ่งไม่ใช่ใบอนุญาตกำกับดูแลแบบเดียวกับหน่วยงานอย่าง CySEC/ASIC",
      "รายการช่องทางฝากถอนอยู่หลังระบบล็อกอิน ยังไม่สามารถยืนยันจากหน้าสาธารณะได้",
    ],
    suitableFor: "ผู้ที่ให้ความสำคัญกับการตรวจสอบใบอนุญาตและสถานะการกำกับดูแลด้วยตนเอง",
    overview:
      "InstaForex เปิดเผยประเภทบัญชีและฝากขั้นต่ำบนหน้าทางการ ส่วนข้อมูลใบอนุญาตและช่องทางฝากถอนควรตรวจสอบเพิ่มเติมกับแหล่งทางการ",
    riskWarningUrl: "https://www.instaforex.com/account_types",
    verifiedAt: VERIFIED_AT,
    verificationStatus: "partial",
    verificationNote:
      "ยืนยันได้: เว็บไซต์ทางการ, แพลตฟอร์ม, ประเภทบัญชี/ฝากขั้นต่ำ, ข้อความ risk disclosure. รอตรวจสอบ: รายการช่องทางฝากถอน, การยืนยันใบอนุญาตใน registry ของ BVI FSC",
    sources: [
      { field: "เว็บไซต์ทางการ", url: "https://www.instaforex.com/", label: "instaforex.com", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี/ฝากขั้นต่ำ", url: "https://www.instaforex.com/account_types", label: "Account types", verifiedAt: VERIFIED_AT },
      { field: "แพลตฟอร์ม", url: "https://www.instaforex.com/trading_platform", label: "Trading platforms", verifiedAt: VERIFIED_AT },
      { field: "นิติบุคคล/ใบอนุญาต", url: "https://www.instaforex.com/regulation", label: "Regulation page", verifiedAt: VERIFIED_AT },
      { field: "Risk disclosure", url: "https://www.instaforex.com/account_types", label: "Footer risk disclosure", verifiedAt: VERIFIED_AT },
    ],
  },

  /* ----------------------------------------------------------
     4) Pepperstone
     ---------------------------------------------------------- */
  {
    id: "broker-pepperstone",
    slug: "pepperstone",
    name: "Pepperstone",
    shortName: "PEP",
    logoColor: "#38bdf8",
    officialUrl: "https://pepperstone.com",
    platforms: ["MetaTrader 4", "MetaTrader 5", "cTrader", "TradingView", "Pepperstone Trading Platform"],
    accountTypes: [
      { name: "Standard", minDepositUsd: 10, note: "ฝากขั้นต่ำตามหน้าทางการที่แสดง (อาจแตกต่างตามนิติบุคคล/ภูมิภาค)" },
      { name: "Razor", minDepositUsd: 10, note: "ฝากขั้นต่ำตามหน้าทางการที่แสดง (อาจแตกต่างตามนิติบุคคล/ภูมิภาค)" },
    ],
    regulations: [
      {
        regulator: "SCB (Bahamas)",
        entity: "Pepperstone Markets Limited",
        licenseNo: "SIA-F217",
        brokerPageUrl: "https://pepperstone.com/en/about-us/who-we-are/",
        registryUrl: "https://www.scb.gov.bs/",
        registryVerified: false,
      },
      {
        regulator: "ASIC (Australia)",
        entity: null,
        licenseNo: null,
        brokerPageUrl: "https://pepperstone.com/en/about-us/who-we-are/",
        registryUrl: "https://connectonline.asic.gov.au/",
        registryVerified: false,
        note: "โบรกเกอร์ระบุว่าอยู่ภายใต้ ASIC — เลขใบอนุญาต AFSL รอยืนยันใน ASIC Connect",
      },
      {
        regulator: "FCA (United Kingdom)",
        entity: null,
        licenseNo: null,
        brokerPageUrl: "https://pepperstone.com/en/about-us/who-we-are/",
        registryUrl: "https://register.fca.org.uk/",
        registryVerified: false,
        note: "โบรกเกอร์ระบุว่าอยู่ภายใต้ FCA — เลข FRN รอยืนยันใน FCA register",
      },
      {
        regulator: "CySEC / DFSA / SCA / CMA / BaFin",
        entity: null,
        licenseNo: null,
        brokerPageUrl: "https://pepperstone.com/en/about-us/who-we-are/",
        registryUrl: null,
        registryVerified: false,
        note: "โบรกเกอร์ระบุกลุ่มหน่วยงานกำกับดูแลเพิ่มเติม — รอยืนยันเลขใบอนุญาตรายตัว",
      },
    ],
    fundingMethods: [
      "Bank wire", "Credit/Debit card", "Skrill", "Neteller", "PayPal",
      "Google Pay", "Apple Pay", "PayID", "Bpay",
    ],
    highlights: [
      "รองรับหลายแพลตฟอร์ม รวมถึง TradingView และ cTrader",
      "กลุ่มโบรกเกอร์ระบุหน่วยงานกำกับดูแลหลายแห่งในหน้า About ทางการ",
    ],
    considerations: [
      "ฝากขั้นต่ำและช่องทางฝากถอนขึ้นกับนิติบุคคล/ภูมิภาค (ข้อมูลที่แสดงมาจากหน้าของนิติบุคคล SCB)",
      "เลขใบอนุญาตของ ASIC/FCA/CySEC ฯลฯ รอยืนยันใน registry ของแต่ละหน่วยงาน",
    ],
    suitableFor: "ผู้ที่ต้องการเปรียบเทียบแพลตฟอร์มและตรวจสอบสถานะกำกับดูแลด้วยตนเอง",
    overview:
      "Pepperstone เป็นกลุ่มโบรกเกอร์ที่ระบุหน่วยงานกำกับดูแลหลายแห่ง และรองรับหลายแพลตฟอร์ม รายละเอียดบัญชีขึ้นกับนิติบุคคลที่ให้บริการ",
    riskWarningUrl: "https://pepperstone.com/en/legal-documents/",
    verifiedAt: VERIFIED_AT,
    verificationStatus: "partial",
    verificationNote:
      "ยืนยันได้: เว็บไซต์ทางการ, แพลตฟอร์ม, ประเภทบัญชี, ฝากขั้นต่ำ (หน้านิติบุคคล SCB), ช่องทางฝากถอน (หน้านิติบุคคล AU), กลุ่มหน่วยงานกำกับดูแล. รอตรวจสอบ: เลขใบอนุญาตของ ASIC/FCA/CySEC และอื่น ๆ ใน registry",
    sources: [
      { field: "เว็บไซต์ทางการ", url: "https://pepperstone.com/en/", label: "pepperstone.com", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี/ฝากขั้นต่ำ", url: "https://pepperstone.com/en/ways-to-trade/trading-accounts/", label: "Trading accounts", verifiedAt: VERIFIED_AT },
      { field: "ช่องทางฝากถอน", url: "https://pepperstone.com/en-au/support/deposits-and-withdrawals/", label: "Deposits & withdrawals (AU)", verifiedAt: VERIFIED_AT },
      { field: "แพลตฟอร์ม", url: "https://pepperstone.com/en/platforms/trading-platforms/", label: "Trading platforms", verifiedAt: VERIFIED_AT },
      { field: "กลุ่มหน่วยงานกำกับดูแล", url: "https://pepperstone.com/en/about-us/who-we-are/", label: "About / Who we are", verifiedAt: VERIFIED_AT },
      { field: "Risk warning", url: "https://pepperstone.com/en/legal-documents/", label: "Legal documents", verifiedAt: VERIFIED_AT },
    ],
  },

  /* ----------------------------------------------------------
     5) Vantage
     ---------------------------------------------------------- */
  {
    id: "broker-vantage",
    slug: "vantage",
    name: "Vantage",
    shortName: "VAN",
    logoColor: "#60a5fa",
    officialUrl: "https://www.vantagemarkets.com",
    platforms: ["MetaTrader 4", "MetaTrader 5", "ProTrader", "WebTrader", "Vantage mobile app"],
    accountTypes: [
      { name: "Standard STP", minDepositUsd: 0, note: "ไม่มีฝากขั้นต่ำตามหน้าบัญชี AU (อาจแตกต่างตามนิติบุคคล)" },
      { name: "Raw ECN", minDepositUsd: 500, note: "ฝากขั้นต่ำตามหน้าบัญชี AU" },
      { name: "Pro ECN", minDepositUsd: 20000, note: "ฝากขั้นต่ำตามหน้าบัญชี AU" },
    ],
    regulations: [
      {
        regulator: "ASIC (Australia)",
        entity: "Vantage Global Prime Pty Ltd",
        licenseNo: "428901 (AFSL)",
        brokerPageUrl: "https://www.vantagemarkets.com/en-au/",
        registryUrl: "https://connectonline.asic.gov.au/",
        registryVerified: false,
      },
      {
        regulator: "FCA (United Kingdom)",
        entity: "Vantage Global Prime Ltd",
        licenseNo: "590299 (FRN)",
        brokerPageUrl: "https://www.vantagemarkets.com/en-au/",
        registryUrl: "https://register.fca.org.uk/",
        registryVerified: false,
        note: "เลข FRN ตามข้อมูลโบรกเกอร์ — FCA register เป็นระบบแบบโต้ตอบ ควรค้นยืนยันอีกครั้ง",
      },
      {
        regulator: "VFSC (Vanuatu)",
        entity: "Vantage Global Limited",
        licenseNo: null,
        brokerPageUrl: "https://www.vantagemarkets.com/en-au/",
        registryUrl: "https://www.vfsc.vu/",
        registryVerified: false,
        note: "ตามข้อมูลโบรกเกอร์ — ระบบ VFSC ปรับปรุงใหม่ ยังค้น deep-link ไม่ได้",
      },
    ],
    fundingMethods: [
      "Bank wire transfer", "Visa/Mastercard", "Skrill", "Neteller",
      "FasaPay", "BPay (AU)", "Crypto (USDT)",
    ],
    highlights: [
      "รองรับ MetaTrader 4 / 5 และ ProTrader",
      "เปิดเผยนิติบุคคลและหน่วยงานกำกับดูแลใน footer ของเว็บทางการ",
    ],
    considerations: [
      "ฝากขั้นต่ำและช่องทางฝากถอนขึ้นกับนิติบุคคล/ภูมิภาค (ข้อมูลที่แสดงมาจากหน้านิติบุคคล AU)",
      "deep-link ของ VFSC/CIMA ยังไม่สามารถยืนยันได้ ควรตรวจสอบใน registry โดยตรง",
    ],
    suitableFor: "ผู้ที่ต้องการตรวจสอบนิติบุคคลและสถานะกำกับดูแลก่อนตัดสินใจ",
    overview:
      "Vantage (เดิม Vantage FX) ดำเนินงานหลายนิติบุคคลและระบุหน่วยงานกำกับดูแลในเว็บไซต์ทางการ รายละเอียดบัญชีขึ้นกับนิติบุคคลที่ให้บริการ",
    riskWarningUrl: "https://www.vantagemarkets.com/en-au/legal/",
    verifiedAt: VERIFIED_AT,
    verificationStatus: "partial",
    verificationNote:
      "ยืนยันได้: เว็บไซต์ทางการ, แพลตฟอร์ม, ประเภทบัญชี/ฝากขั้นต่ำ (นิติบุคคล AU), ช่องทางฝากถอน (AU), นิติบุคคล/เลขใบอนุญาต (ตามข้อมูลโบรกเกอร์). รอตรวจสอบ: การยืนยันใน registry ของ ASIC/FCA/VFSC",
    sources: [
      { field: "เว็บไซต์ทางการ", url: "https://www.vantagemarkets.com/", label: "vantagemarkets.com", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี/ฝากขั้นต่ำ (Standard STP)", url: "https://www.vantagemarkets.com/en-au/trading-accounts/standard-stp/", label: "Standard STP account", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี (Raw ECN)", url: "https://www.vantagemarkets.com/en-au/trading-accounts/raw-ecn/", label: "Raw ECN account", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี (Pro ECN)", url: "https://www.vantagemarkets.com/en-au/trading-accounts/pro-ecn/", label: "Pro ECN account", verifiedAt: VERIFIED_AT },
      { field: "ช่องทางฝากถอน", url: "https://www.vantagemarkets.com/en-au/deposit-and-withdrawal/", label: "Deposit & withdrawal (AU)", verifiedAt: VERIFIED_AT },
      { field: "Risk warning", url: "https://www.vantagemarkets.com/en-au/legal/", label: "Legal (AU)", verifiedAt: VERIFIED_AT },
    ],
  },

  /* ----------------------------------------------------------
     6) VT Markets
     ---------------------------------------------------------- */
  {
    id: "broker-vtmarkets",
    slug: "vtmarkets",
    name: "VT Markets",
    shortName: "VT",
    logoColor: "#34d399",
    officialUrl: "https://www.vtmarkets.com",
    platforms: ["MetaTrader 5", "MetaTrader 4", "TradingView", "WebTrader", "VT Markets App"],
    accountTypes: [
      { name: "Standard STP", minDepositUsd: 50 },
      { name: "RAW ECN", minDepositUsd: 200 },
      { name: "PRO ECN", minDepositUsd: 10000 },
      { name: "Cent Account (STP/ECN)", minDepositUsd: 50 },
      { name: "Swap Free", minDepositUsd: 50 },
    ],
    regulations: [
      {
        regulator: "FSC Mauritius",
        entity: "VT Markets Limited",
        licenseNo: "GB23202269",
        brokerPageUrl: "https://www.vtmarkets.com/regulation/",
        registryUrl: "https://www.fscmauritius.org/en/regulated-entities",
        registryVerified: false,
      },
      {
        regulator: "FSCA South Africa",
        entity: "VT Markets (Pty) Ltd",
        licenseNo: "FSP 50865",
        brokerPageUrl: "https://www.vtmarkets.com/regulation/",
        registryUrl: "https://www.fscaconsumerportal.co.za/Firm/FirmSearchMainTab",
        registryVerified: false,
        note: "ทำหน้าที่เป็น intermediary เท่านั้น",
      },
      {
        regulator: "CMA UAE (Dubai Branch)",
        entity: "VT Markets (Pty) Ltd – Dubai Branch",
        licenseNo: "20200000299",
        brokerPageUrl: "https://www.vtmarkets.com/regulation/",
        registryUrl: null,
        registryVerified: false,
        note: "Introduction & Promotion เท่านั้น ไม่มีการ execution",
      },
    ],
    fundingMethods: [
      "Bank Transfer", "Visa/Mastercard", "UnionPay", "Skrill", "Neteller",
      "FasaPay", "STICPAY", "bitwallet", "Rapid Transfer", "Trustly",
      "Bitcoin (BTC)", "USDT/USDC",
    ],
    highlights: [
      "มีประเภทบัญชีหลายแบบ รวมถึงบัญชี Cent และ Swap Free",
      "รองรับหลายแพลตฟอร์มและระบุนิติบุคคล/ใบอนุญาตบนหน้า Regulation ทางการ",
    ],
    considerations: [
      "นิติบุคคล Dubai ทำหน้าที่ Introduction & Promotion เท่านั้น ไม่มีการ execution",
      "registry ของ FSC Mauritius / FSCA เป็นระบบแบบโต้ตอบ ควรค้นยืนยันเลขใบอนุญาตอีกครั้ง",
    ],
    suitableFor: "ผู้ที่ต้องการเปรียบเทียบประเภทบัญชีและตรวจสอบสถานะกำกับดูแลด้วยตนเอง",
    overview:
      "VT Markets ระบุนิติบุคคลและใบอนุญาตหลายแห่งบนเว็บไซต์ทางการ และมีประเภทบัญชีให้เปรียบเทียบหลายแบบ",
    riskWarningUrl: "https://www.vtmarkets.com/regulation/",
    verifiedAt: VERIFIED_AT,
    verificationStatus: "partial",
    verificationNote:
      "ยืนยันได้: เว็บไซต์ทางการ, แพลตฟอร์ม, ประเภทบัญชี/ฝากขั้นต่ำ, ช่องทางฝากถอน, นิติบุคคล/เลขใบอนุญาต (ตามข้อมูลโบรกเกอร์). รอตรวจสอบ: การยืนยันใน registry ของ FSC Mauritius / FSCA",
    sources: [
      { field: "เว็บไซต์ทางการ", url: "https://www.vtmarkets.com", label: "vtmarkets.com", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี (ตัวอย่าง Standard STP)", url: "https://www.vtmarkets.com/standard-stp/", label: "Standard STP account", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี (RAW ECN)", url: "https://www.vtmarkets.com/raw-ecn/", label: "RAW ECN account", verifiedAt: VERIFIED_AT },
      { field: "ช่องทางฝากถอน", url: "https://www.vtmarkets.com/deposit-withdrawal/", label: "Deposit & withdrawal", verifiedAt: VERIFIED_AT },
      { field: "นิติบุคคล/ใบอนุญาต", url: "https://www.vtmarkets.com/regulation/", label: "Regulation page", verifiedAt: VERIFIED_AT },
      { field: "Risk warning", url: "https://www.vtmarkets.com/regulation/", label: "Regulation page (footer)", verifiedAt: VERIFIED_AT },
    ],
  },

  /* ----------------------------------------------------------
     7) XM
     ---------------------------------------------------------- */
  {
    id: "broker-xm",
    slug: "xm",
    name: "XM",
    shortName: "XM",
    logoColor: "#f97316",
    officialUrl: "https://www.xm.com",
    platforms: ["MetaTrader 4", "MetaTrader 5", "XM App"],
    accountTypes: [
      { name: "Standard", minDepositUsd: 5 },
      { name: "Ultra Low", minDepositUsd: 5 },
      { name: "Shares", minDepositUsd: 10000 },
      { name: "Demo", minDepositUsd: 0 },
    ],
    regulations: [
      {
        regulator: "FSC Belize",
        entity: "XM Global Limited",
        licenseNo: "8557558",
        brokerPageUrl: "https://www.xm.com/regulation",
        registryUrl: "https://www.belizefsc.org.bz/licensed-service-providers/",
        registryVerified: false,
        note: "เลขใบอนุญาตระบุโดยโบรกเกอร์ — registry เป็นระบบแบบโต้ตอบ ผู้ใช้ควรค้นยืนยันในหน้า licensed service providers",
      },
    ],
    fundingMethods: null, // รอตรวจสอบ — หน้า deposit/withdrawal ทางการคืน 404 ในรอบตรวจสอบนี้
    highlights: [
      "มีประเภทบัญชีหลายแบบ ฝากขั้นต่ำเริ่มต้นต่ำตามข้อมูลหน้าทางการ",
      "รองรับ MetaTrader 4 / 5 และแอป XM",
    ],
    considerations: [
      "หน้ารายละเอียดฝากถอนสาธารณะไม่สามารถเข้าถึงได้ในรอบตรวจสอบนี้ ควรตรวจสอบกับโบรกเกอร์โดยตรง",
      "นิติบุคคลที่ตรวจพบบนเว็บทางการปัจจุบันคือ XM Global Limited ภายใต้ FSC Belize",
    ],
    suitableFor: "ผู้ที่ต้องการตรวจสอบข้อมูลบัญชีและสถานะกำกับดูแลด้วยตนเอง",
    overview:
      "XM เปิดเผยประเภทบัญชีและฝากขั้นต่ำบนหน้าทางการ ส่วนช่องทางฝากถอนควรตรวจสอบกับโบรกเกอร์โดยตรงเนื่องจากหน้าสาธารณะเข้าถึงไม่ได้ในรอบตรวจสอบนี้",
    riskWarningUrl: "https://www.xm.com/legal-documents",
    verifiedAt: VERIFIED_AT,
    verificationStatus: "partial",
    verificationNote:
      "ยืนยันได้: เว็บไซต์ทางการ, แพลตฟอร์ม, ประเภทบัญชี/ฝากขั้นต่ำ, นิติบุคคล/เลขใบอนุญาต (FSC Belize), risk warning. รอตรวจสอบ: รายการช่องทางฝากถอน (หน้าทางการคืน 404), และการยืนยันใน registry ของ FSC Belize",
    sources: [
      { field: "เว็บไซต์ทางการ", url: "https://www.xm.com/", label: "xm.com", verifiedAt: VERIFIED_AT },
      { field: "ประเภทบัญชี/ฝากขั้นต่ำ", url: "https://www.xm.com/account-types", label: "Account types", verifiedAt: VERIFIED_AT },
      { field: "แพลตฟอร์ม", url: "https://www.xm.com/platforms", label: "Platforms", verifiedAt: VERIFIED_AT },
      { field: "นิติบุคคล/ใบอนุญาต", url: "https://www.xm.com/regulation", label: "Regulation page", verifiedAt: VERIFIED_AT },
      { field: "Risk warning / legal", url: "https://www.xm.com/legal-documents", label: "Legal documents", verifiedAt: VERIFIED_AT },
    ],
  },
];

/**
 * Affiliate disclosure — แสดงทุกหน้าที่เกี่ยวกับโบรกเกอร์
 */
TT.brokerAffiliateDisclosure =
  "เพื่อรักษาการดำเนินงานของเว็บไซต์ TraderToolsTH ลิงก์บางลิงก์ในส่วนรีวิวโบรกเกอร์อาจเป็นลิงก์พันธมิตร (affiliate) " +
  "อย่างไรก็ตาม ข้อมูลที่นำเสนอไม่ได้จัดทำขึ้นเพื่อโปรโมทหรือชี้นำให้เปิดบัญชี และไม่จัดอันดับว่าโบรกเกอร์ใดดีกว่ากัน " +
  "การตัดสินใจและความรับผิดชอบทั้งหมดเป็นของผู้ใช้ ควรตรวจสอบข้อมูลกับโบรกเกอร์และหน่วยงานกำกับดูแลโดยตรงเสมอ";
