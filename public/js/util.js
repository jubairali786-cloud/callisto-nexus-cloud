const Util = (() => {
  function money(n, currency) {
    const v = Number(n || 0);
    const s = v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency ? `${currency} ${s}` : s;
  }
  function dateStr(d) {
    if (!d) return "—";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function qs(params) {
    return Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }

  // ---- number to words (for "Amount in words" on printed documents) ----
  const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function threeDigits(n) {
    let s = "";
    if (n >= 100) { s += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) s += " and "; }
    if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += "-" + ONES[n % 10]; }
    else if (n > 0) { s += ONES[n]; }
    return s;
  }
  function numberToWords(num) {
    num = Math.floor(Math.abs(num));
    if (num === 0) return "Zero";
    const parts = [];
    const crore = Math.floor(num / 10000000); num %= 10000000; // not used for AED but harmless
    const million = Math.floor(num / 1000000); num %= 1000000;
    const thousand = Math.floor(num / 1000); num %= 1000;
    const rest = num;
    if (million) parts.push(threeDigits(million) + " Million");
    if (thousand) parts.push(threeDigits(thousand) + " Thousand");
    if (rest) parts.push(threeDigits(rest));
    return parts.join(" ").trim();
  }
  function amountInWords(total, currency, minorUnitName) {
    const whole = Math.floor(total);
    const minor = Math.round((total - whole) * 100);
    let s = `${currency} ${numberToWords(whole)} Only`;
    if (minor > 0) s = `${currency} ${numberToWords(whole)} and ${numberToWords(minor)} ${minorUnitName || "Fils"} Only`;
    return s;
  }

  return { money, dateStr, todayISO, escapeHtml, uid, debounce, qs, numberToWords, amountInWords };
})();
