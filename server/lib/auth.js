const jwt = require("jsonwebtoken");
const db = require("../db");
const config = require("../config");
const { HttpError, forbidden } = require("./util");

const PUBLIC_USER_FIELDS = `id, name, username, email, mobile, dob, verified, bio, langs, payout, org, is_admin, stats, created_at`;

function sign(user) {
  return jwt.sign({ sub: user.id, u: user.username, a: user.is_admin ? 1 : 0 }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

/* Rows -> the object shape the front-end already uses. */
function shapeUser(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, username: row.username, email: row.email, mobile: row.mobile,
    dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : (row.dob || null),
    verified: !!row.verified, bio: row.bio || "", langs: row.langs || ["javascript"],
    payout: row.payout || null, org: row.org || null, isAdmin: !!row.is_admin,
    stats: row.stats || {}, createdAt: Number(row.created_at)
  };
}

async function userById(id) {
  if (!id) return null;
  const row = await db.one(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = ?`, [id]);
  return shapeUser(row);
}

/* Optional auth: attaches req.user when a valid token is present, never throws. */
async function optional(req, _res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : (req.query.token || null);
    if (token) {
      const payload = jwt.verify(token, config.jwt.secret);
      req.user = await userById(payload.sub);
      req.token = token;
    }
  } catch (e) { /* bad/expired token = anonymous */ }
  next();
}

async function required(req, _res, next) {
  await new Promise(r => optional(req, _res, r));
  if (!req.user) return next(new HttpError(401, "Sign in to do that."));
  next();
}

async function adminOnly(req, _res, next) {
  await new Promise(r => optional(req, _res, r));
  if (!req.user) return next(new HttpError(401, "Sign in to do that."));
  if (!req.user.isAdmin) return next(new HttpError(403, "That needs an admin account."));
  next();
}

module.exports = { sign, shapeUser, userById, optional, required, adminOnly, PUBLIC_USER_FIELDS };
