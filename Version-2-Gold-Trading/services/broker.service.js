/* ============================================================
   Service Layer — Broker Service
   ------------------------------------------------------------
   - ปัจจุบันอ่านข้อมูลที่ตรวจสอบแล้วจาก data/brokers.js
   - จุดเชื่อมระบบจริง (Backend CMS): กำหนด TT.BrokerService.setEndpoint()
     หรือแก้ API_ENDPOINT แล้วระบบจะสลับไปใช้ fetch อัตโนมัติ
   - รองรับ filter (ตาม regulator / platform) และ compare (ตาม slug)
   ============================================================ */

window.TT = window.TT || {};

TT.BrokerService = (function () {
  // ปล่อยให้ CMS กำหนดภายหลังได้ผ่าน setEndpoint(); ปัจจุบันใช้ข้อมูลในเครื่อง
  let API_ENDPOINT = null;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function localBrokers() {
    return (TT.brokers || []).slice();
  }

  /** ดึงรายการ regulator ทั้งหมดที่มีในระบบ (เพื่อสร้าง filter options) */
  function listRegulators() {
    const set = new Set();
    localBrokers().forEach((b) => {
      (b.regulations || []).forEach((r) => {
        if (r && r.regulator) set.add(r.regulator);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  /** ดึงรายการ platform ทั้งหมด (เพื่อสร้าง filter options) */
  function listPlatforms() {
    const set = new Set();
    localBrokers().forEach((b) => {
      (b.platforms || []).forEach((p) => set.add(p));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  /**
   * ดึงรายการโบรกเกอร์ พร้อมตัวกรอง (filter) และการเรียงลำดับ
   * @param {object} opts
   *   - regulator: string (กรองเฉพาะที่มี regulator นี้)
   *   - platform: string (กรองเฉพาะที่มี platform นี้)
   *   - search: string (ค้นหาใน name)
   *   - sort: "name" | "updated" (default "name" — เรียงตามชื่อ ไม่ใช่คะแนน)
   */
  async function fetchBrokers(opts = {}) {
    if (!API_ENDPOINT) {
      await delay(180);
      let list = localBrokers();

      if (opts.regulator) {
        list = list.filter((b) =>
          (b.regulations || []).some((r) => r.regulator === opts.regulator)
        );
      }
      if (opts.platform) {
        list = list.filter((b) => (b.platforms || []).includes(opts.platform));
      }
      if (opts.search) {
        const q = String(opts.search).trim().toLowerCase();
        if (q) {
          list = list.filter((b) => b.name.toLowerCase().includes(q));
        }
      }

      const sort = opts.sort || "name";
      if (sort === "updated") {
        list.sort((a, b) => String(b.verifiedAt).localeCompare(String(a.verifiedAt)));
      } else {
        list.sort((a, b) => a.name.localeCompare(b.name, "th"));
      }
      return list;
    }

    // Backend mode — ส่ง query string ไปตามที่ CMS กำหนด
    try {
      const params = new URLSearchParams();
      if (opts.regulator) params.set("regulator", opts.regulator);
      if (opts.platform) params.set("platform", opts.platform);
      if (opts.search) params.set("q", opts.search);
      if (opts.sort) params.set("sort", opts.sort);
      const qs = params.toString();
      const url = qs ? `${API_ENDPOINT}?${qs}` : API_ENDPOINT;
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.error("[BrokerService] fetch error:", err);
      throw err;
    }
  }

  async function getBySlug(slug) {
    if (!API_ENDPOINT) {
      await delay(100);
      return localBrokers().find((b) => b.slug === slug) || null;
    }
    try {
      const res = await fetch(`${API_ENDPOINT}/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.error("[BrokerService] getBySlug error:", err);
      throw err;
    }
  }

  /**
   * เปรียบเทียบหลายโบรกเกอร์พร้อมกัน (สำหรับหน้า compare)
   * @param {string[]} slugs
   * @returns Promise<Broker[]>
   */
  async function compare(slugs = []) {
    if (!API_ENDPOINT) {
      await delay(120);
      const want = new Set((slugs || []).filter(Boolean));
      return localBrokers().filter((b) => want.has(b.slug));
    }
    try {
      const params = new URLSearchParams({ slugs: (slugs || []).join(",") });
      const res = await fetch(`${API_ENDPOINT}/compare?${params.toString()}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.error("[BrokerService] compare error:", err);
      throw err;
    }
  }

  function setEndpoint(url) {
    API_ENDPOINT = url || null;
  }

  return {
    fetchBrokers,
    getBySlug,
    compare,
    listRegulators,
    listPlatforms,
    setEndpoint,
    isLive: () => !!API_ENDPOINT,
  };
})();
