/* Accounts: signup, login, OTP verify, password reset, profile, payout details.
   Passwords are bcrypt-hashed (PRD 3); the demo digest is gone. */

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const otp = require("../lib/otp");
const auth = require("../lib/auth");
const D = require("../lib/domain");
const config = require("../config");
const { uid, now, HttpError, bad, wrap } = require("../lib/util");

const router = express.Router();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/i;

function ageFromDob(dob) {
  if (!dob) return 0;
  const b = new Date(dob), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

async function validateNewUser(d) {
  const errs = {};
  if (!d.name || d.name.trim().length < 2) errs.name = "Tell us what to call you.";
  if (!USERNAME_RE.test(d.username || "")) errs.username = "3–20 characters, letters, numbers or underscore.";
  if (!EMAIL_RE.test(d.email || "")) errs.email = "That email doesn't look right.";
  if (!/^[0-9]{10}$/.test(String(d.mobile || "").replace(/\D/g, "").slice(-10))) errs.mobile = "Enter a 10-digit mobile number.";
  if (!d.password || d.password.length < 8) errs.password = "Use at least 8 characters.";
  if (!d.dob) errs.dob = "We need your date of birth.";
  else if (ageFromDob(d.dob) < 13) errs.dob = "You need to be 13 or older to play.";

  const email = String(d.email || "").trim().toLowerCase();
  const username = String(d.username || "").trim().toLowerCase();
  const mobile = String(d.mobile || "").replace(/\D/g, "").slice(-10);
  if (await db.one("SELECT id FROM users WHERE email = ?", [email])) errs.email = "That email is already registered.";
  if (await db.one("SELECT id FROM users WHERE username = ?", [username])) errs.username = "That username is taken.";
  if (await db.one("SELECT id FROM users WHERE mobile = ?", [mobile])) errs.mobile = "That number is already registered.";
  return errs;
}

/* ---------- signup ---------- */
router.post("/signup", wrap(async (req, res) => {
  const d = req.body || {};
  const errs = await validateNewUser(d);
  if (Object.keys(errs).length) throw new HttpError(422, "Check the highlighted fields.", { errs });

  const id = uid("u");
  const email = d.email.trim().toLowerCase();
  const isAdmin = config.adminEmails.includes(email) ? 1 : 0;
  await db.run(
    `INSERT INTO users (id,name,username,email,mobile,password_hash,dob,verified,bio,langs,payout,org,is_admin,stats,created_at)
     VALUES (?,?,?,?,?,?,?,0,'',?,NULL,NULL,?,?,?)`,
    [id, d.name.trim(), d.username.trim().toLowerCase(), email,
     String(d.mobile).replace(/\D/g, "").slice(-10), bcrypt.hashSync(d.password, 10),
     d.dob, JSON.stringify(["javascript"]), isAdmin,
     JSON.stringify(Object.assign({}, D.FRESH_STATS)), now()]
  );

  const sent = await otp.requestOtp({ email, purpose: "signup", userId: id, name: d.name.trim() });
  res.json({ ok: true, userId: id, email, otp: sent, needVerify: true });
}));

/* ---------- verify ---------- */
/* Metadata only — the code itself is stored hashed and never leaves the server. */
router.get("/otp/:id/meta", wrap(async (req, res) => {
  const row = await otp.getOtp(req.params.id);
  if (!row) throw new HttpError(404, "That code expired. Ask for a new one.");
  const maskEmail = e => {
    const [n, d] = String(e).split("@");
    return (n.slice(0, 2) + "***") + "@" + (d || "");
  };
  const maskMobile = m => "····· " + String(m).slice(-4);
  res.json({
    ok: true,
    meta: {
      otpId: row.id, purpose: row.purpose, channel: row.email ? "email" : "sms",
      target: row.email ? maskEmail(row.email) : (row.mobile ? maskMobile(row.mobile) : null),
      expiresAt: Number(row.expires_at), resendAt: Number(row.resend_at),
      attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
      verified: !!row.verified, userId: row.user_id || null
    }
  });
}));

router.post("/verify", wrap(async (req, res) => {
  const { otpId, code, email, purpose = "signup" } = req.body || {};
  let row = otpId ? await otp.getOtp(otpId) : await otp.latestFor({ email, purpose });
  if (!row) throw new HttpError(404, "That code expired. Ask for a new one.");

  const result = await otp.verifyOtp(row.id, code);
  if (!result.ok) throw new HttpError(400, result.msg, { left: result.left, otpId: row.id });

  if (row.user_id) {
    await db.run("UPDATE users SET verified = 1 WHERE id = ? AND verified = 0", [row.user_id]);
    const user = await auth.userById(row.user_id);
    return res.json({ ok: true, activated: true, user, token: auth.sign(user) });
  }
  res.json({ ok: true, activated: false });
}));

router.post("/resend", wrap(async (req, res) => {
  const { otpId, email, mobile, purpose = "signup", name } = req.body || {};
  let target = { email, mobile, purpose };
  if (otpId) {
    const row = await otp.getOtp(otpId);
    if (!row) throw new HttpError(404, "That code expired. Ask for a new one.");
    if (now() < Number(row.resend_at)) {
      throw new HttpError(429, "Hold on — you can ask for a new code in a moment.",
        { retryInSecs: Math.ceil((Number(row.resend_at) - now()) / 1000) });
    }
    target = { email: row.email, mobile: row.mobile, purpose: row.purpose, userId: row.user_id, meta: row.meta || null };
  }
  const sent = await otp.requestOtp(Object.assign({ name }, target));
  if (!sent.ok) throw new HttpError(429, sent.msg, { retryInSecs: sent.retryInSecs });
  res.json({ ok: true, otp: sent });
}));

/* ---------- login ---------- */
router.post("/login", wrap(async (req, res) => {
  const identifier = String((req.body || {}).identifier || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  if (!identifier || !password) {
    throw new HttpError(422, "Enter your email or username and password.");
  }
  const row = await db.one("SELECT * FROM users WHERE email = ? OR username = ?", [identifier, identifier]);
  if (!row) throw new HttpError(401, "No account with that email or username.");
  if (!bcrypt.compareSync(password, row.password_hash)) throw new HttpError(401, "Wrong password. Try again.");

  if (!row.verified) {
    const sent = await otp.requestOtp({ email: row.email, purpose: "login", userId: row.id, name: row.name });
    return res.json({ ok: false, needVerify: true, userId: row.id, email: row.email, otp: sent, msg: "Your account isn't verified yet. Finish the OTP step." });
  }
  const user = auth.shapeUser(row);
  res.json({ ok: true, user, token: auth.sign(user) });
}));

/* ---------- forgot / reset ---------- */
router.post("/forgot", wrap(async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const row = await db.one("SELECT id,name,email FROM users WHERE email = ?", [email]);
  // Never reveal whether an address has an account; just don't send anything.
  if (!row) return res.json({ ok: true, sent: false });
  const sent = await otp.requestOtp({ email: row.email, purpose: "forgot", userId: row.id, name: row.name });
  res.json({ ok: true, sent: sent.ok !== false, otp: sent.ok === false ? undefined : sent, retryInSecs: sent.retryInSecs });
}));

router.post("/reset", wrap(async (req, res) => {
  const { otpId, code, email, password } = req.body || {};
  if (!password || password.length < 8) throw new HttpError(422, "New password needs 8+ characters.");
  const row = otpId ? await otp.getOtp(otpId) : await otp.latestFor({ email, purpose: "forgot" });
  if (!row || row.purpose !== "forgot") throw new HttpError(404, "Start the reset again — that code isn't valid.");
  const result = await otp.verifyOtp(row.id, code);
  if (!result.ok) throw new HttpError(400, result.msg, { left: result.left, otpId: row.id });
  if (!row.user_id) throw new HttpError(400, "That code isn't tied to an account.");

  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(password, 10), row.user_id]);
  const user = await auth.userById(row.user_id);
  res.json({ ok: true, user, token: auth.sign(user) });
}));

/* ---------- session ---------- */
router.get("/me", auth.required, wrap(async (req, res) => {
  res.json({
    ok: true, user: req.user,
    achievements: await D.achievementsFor(req.user.id),
    mistakes: (await db.q("SELECT * FROM mistakes WHERE user_id = ? ORDER BY at DESC LIMIT 100", [req.user.id])).map(require("../lib/repo").shapeMistake),
    notifications: (await db.q("SELECT * FROM notifications WHERE user_id = ? ORDER BY at DESC LIMIT 50", [req.user.id])).map(require("../lib/repo").shapeNotification)
  });
}));

router.patch("/me", auth.required, wrap(async (req, res) => {
  const patch = req.body || {};
  const fields = [];
  const params = [];
  const allowed = { name: "name", bio: "bio" };
  for (const k of Object.keys(allowed)) {
    if (patch[k] !== undefined) { fields.push(`${allowed[k]} = ?`); params.push(String(patch[k]).slice(0, 500)); }
  }
  if (Array.isArray(patch.langs)) { fields.push("langs = ?"); params.push(JSON.stringify(patch.langs.map(String).slice(0, 10))); }
  if (patch.org !== undefined) {
    const org = patch.org && typeof patch.org === "object" ? {
      name: String(patch.org.name || "").slice(0, 100),
      status: ["pending", "approved", "rejected"].includes(patch.org.status) ? patch.org.status : "pending",
      requestedAt: Number(patch.org.requestedAt) || Date.now()
    } : null;
    if (org && org.name.length < 3) throw new HttpError(422, "Organisation name needs 3+ characters.");
    fields.push("org = ?"); params.push(JSON.stringify(org));
  }
  if (patch.payout !== undefined) { fields.push("payout = ?"); params.push(JSON.stringify(patch.payout && typeof patch.payout === "object" ? patch.payout : null)); }
  if (!fields.length) throw new HttpError(400, "Nothing to update.");
  params.push(req.user.id);
  await db.run(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, params);
  res.json({ ok: true, user: await auth.userById(req.user.id) });
}));

/* ---------- changing email / mobile: prove the new one first (PRD 3) ---------- */
router.post("/me/contact", auth.required, wrap(async (req, res) => {
  const d = req.body || {};
  const email = String(d.email || "").trim().toLowerCase();
  const mobile = String(d.mobile || "").replace(/\D/g, "").slice(-10);
  const errs = {};
  if (!EMAIL_RE.test(email)) errs.email = "That email doesn't look right.";
  if (!/^[0-9]{10}$/.test(mobile)) errs.mobile = "Enter a 10-digit mobile number.";
  const sameEmail = email === req.user.email, sameMobile = mobile === req.user.mobile;
  if (sameEmail && sameMobile) throw new HttpError(400, "Nothing to change — those are already your details.");
  if (!sameEmail && await db.one("SELECT id FROM users WHERE email = ?", [email])) errs.email = "That email is already registered.";
  if (!sameMobile && await db.one("SELECT id FROM users WHERE mobile = ?", [mobile])) errs.mobile = "That number is already registered.";
  if (Object.keys(errs).length) throw new HttpError(422, "Check the highlighted fields.", { errs });

  // No SMS gateway is attached to this build, so the code always travels by email:
  // to the new address when it changed, otherwise to the one already on the account.
  const out = await otp.requestOtp({
    email: sameEmail ? req.user.email : email,
    mobile,
    purpose: "contact", userId: req.user.id, name: req.user.name,
    meta: { email, mobile }
  });
  if (!out.ok) throw new HttpError(429, out.msg, { retryInSecs: out.retryInSecs, otpId: out.otpId });
  out.sentTo = sameEmail ? req.user.email : email;
  out.provesOwnershipOf = sameEmail ? "mobile" : "email";
  res.json({ ok: true, otp: out });
}));

router.post("/me/contact/confirm", auth.required, wrap(async (req, res) => {
  const { otpId, code } = req.body || {};
  const row = await otp.getOtp(String(otpId || ""));
  if (!row || row.user_id !== req.user.id) throw new HttpError(400, "That code isn't yours. Ask for a fresh one.");
  if (row.purpose !== "contact") throw new HttpError(400, "That code was issued for something else.");
  const v = await otp.verifyOtp(row.id, code);
  if (!v.ok) throw new HttpError(400, v.msg, { left: v.left });

  const pending = row.meta || {};
  if (!pending.email || !pending.mobile) throw new HttpError(400, "That code has no pending change attached.");
  const clash = await db.one("SELECT id FROM users WHERE (email = ? OR mobile = ?) AND id <> ?", [pending.email, pending.mobile, req.user.id]);
  if (clash) throw new HttpError(409, "Someone claimed those details while you were entering the code.");
  await db.run("UPDATE users SET email = ?, mobile = ? WHERE id = ?", [pending.email, pending.mobile, req.user.id]);
  await db.run("UPDATE otps SET meta = NULL WHERE id = ?", [row.id]);
  res.json({ ok: true, user: await auth.userById(req.user.id) });
}));

router.post("/password", auth.required, wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const row = await db.one("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!bcrypt.compareSync(String(oldPassword || ""), row.password_hash)) throw new HttpError(401, "Current password is wrong.");
  if (!newPassword || newPassword.length < 8) throw new HttpError(422, "New password needs 8+ characters.");
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(newPassword, 10), req.user.id]);
  res.json({ ok: true });
}));

/* ---------- payout details (UPI / bank) ----------
   Changing payout details holds payouts for 24h (PRD 5). */
router.post("/payout", auth.required, wrap(async (req, res) => {
  const p = req.body || {};
  if (!p.upi && !(p.accountNumber && p.ifsc)) throw new HttpError(422, "Add a UPI id or a bank account + IFSC.");
  const payout = {
    upi: p.upi || "", bankName: p.bankName || "", accountNumber: p.accountNumber || "",
    ifsc: p.ifsc || "", holderName: p.holderName || "", status: "pending",
    holdUntil: now() + 24 * 3600 * 1000, savedAt: now()
  };
  await db.run("UPDATE users SET payout = ? WHERE id = ?", [JSON.stringify(payout), req.user.id]);
  res.json({ ok: true, payout });
}));

router.post("/payout/verify", auth.required, wrap(async (req, res) => {
  const user = await db.one("SELECT name, payout FROM users WHERE id = ?", [req.user.id]);
  if (!user || !user.payout) throw new HttpError(400, "Save your payout details first.");
  const profileName = String(user.name).trim().toLowerCase();
  const returned = String((req.body || {}).holderName || "").trim().toLowerCase();
  const match = !!returned && (profileName.includes(returned.split(" ")[0]) || returned.includes(profileName.split(" ")[0]));
  const payout = Object.assign({}, user.payout, {
    status: match ? "verified" : "flagged", holderName: returned, verifiedAt: now()
  });
  await db.run("UPDATE users SET payout = ? WHERE id = ?", [JSON.stringify(payout), req.user.id]);
  res.json({ ok: true, match, payout });
}));

router.post("/logout", wrap(async (_req, res) => res.json({ ok: true })));

module.exports = router;
module.exports.ageFromDob = ageFromDob;
