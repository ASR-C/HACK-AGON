const crypto = require("crypto");

/* Same id shape the front-end used, so existing links and stored rows keep working. */
function uid(prefix) {
  return (prefix || "id") + "_" + crypto.randomBytes(5).toString("hex") + Date.now().toString(36).slice(-4);
}
const now = () => Date.now();

/* ---------- money: integer paise only ---------- */
const inrToPaise = n => Math.round((Number(n) || 0) * 100);
const paiseToInr = p => (Number(p) || 0) / 100;
const platformFee = pool => Math.round((Number(pool) || 0) * 0.01); // 1% of the pool (PRD 5)

function inviteCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
}
function otpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}
function looseEqual(expected, got, unordered) {
  if (unordered && Array.isArray(expected) && Array.isArray(got)) {
    const norm = x => x.slice().sort((p, q) => (typeof p === "number" ? p - q : String(p).localeCompare(String(q))));
    return deepEqual(norm(expected), norm(got));
  }
  return deepEqual(expected, got);
}
const safe = v => { try { return typeof v === "string" ? v : JSON.stringify(v); } catch (e) { return String(v); } };

/* ---------- HTTP helpers ---------- */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}
const bad = (msg, extra) => { throw new HttpError(400, msg, extra); };
const notFound = (msg) => { throw new HttpError(404, msg || "Not found."); };
const forbidden = (msg) => { throw new HttpError(403, msg || "Not allowed."); };

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* MySQL returns BIGINT as a number by default; be explicit where money matters. */
const int = v => Number(v || 0);

/* Row -> the camelCase object shape the front-end store already expects. */
function mapKeys(row, map) {
  const out = {};
  for (const k of Object.keys(row)) out[map[k] || k] = row[k];
  return out;
}

module.exports = {
  uid, now, int, mapKeys,
  inrToPaise, paiseToInr, platformFee,
  inviteCode, otpCode,
  deepEqual, looseEqual, safe,
  HttpError, bad, notFound, forbidden, wrap
};
