/* OTP lifecycle: create -> email -> verify, with the PRD's limits.
   Codes are stored bcrypt-hashed, so a database leak does not leak codes.
   Rules (PRD 3): 5 minute expiry, 5 attempts, 60 second resend cooldown. */

const bcrypt = require("bcryptjs");
const db = require("../db");
const mail = require("./mail");
const config = require("../config");
const { uid, now, otpCode, bad, notFound } = require("./util");

const EXPIRY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_MS = 60 * 1000;

/* Newest code row for one target. Email wins when both are given. */
async function newest({ email, mobile, purpose }) {
  if (email) return db.one("SELECT * FROM otps WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1", [email, purpose]);
  if (mobile) return db.one("SELECT * FROM otps WHERE mobile = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1", [mobile, purpose]);
  return null;
}

/* Expire anything still open for this target+purpose so only one code is live. */
async function supersede(target, purpose) {
  if (target.email) {
    await db.run("UPDATE otps SET verified = 0, expires_at = 0 WHERE email = ? AND purpose = ? AND expires_at > ?", [target.email, purpose, now()]);
  } else if (target.mobile) {
    await db.run("UPDATE otps SET verified = 0, expires_at = 0 WHERE mobile = ? AND purpose = ? AND expires_at > ?", [target.mobile, purpose, now()]);
  }
}

async function requestOtp({ email = null, mobile = null, purpose = "signup", userId = null, name = null, meta = null }) {
  if (!email && !mobile) bad("Give an email or a mobile number.");
  const normEmail = email ? String(email).trim().toLowerCase() : null;
  const normMobile = mobile ? String(mobile).replace(/\D/g, "").slice(-10) : null;

  // 60s cooldown measured against the newest code for this target/purpose.
  const last = await newest({ email: normEmail, mobile: normMobile, purpose });
  if (last && now() < Number(last.resend_at)) {
    return { ok: false, msg: "Wait a moment before asking for another code.", retryInSecs: Math.ceil((Number(last.resend_at) - now()) / 1000), otpId: last.id };
  }

  await supersede({ email: normEmail, mobile: normMobile }, purpose);

  const code = otpCode();
  const id = uid("otp");
  await db.run(
    `INSERT INTO otps (id,email,mobile,code_hash,purpose,user_id,created_at,expires_at,attempts,max_attempts,resend_at,verified,meta)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`,
    [id, normEmail, normMobile, bcrypt.hashSync(code, 8), purpose, userId, now(), now() + EXPIRY_MS, 0, MAX_ATTEMPTS, now() + RESEND_MS, meta ? JSON.stringify(meta) : null]
  );

  let mailed = false, mailError = null;
  if (normEmail) {
    if (!mail.enabled()) {
      mailError = "Mail is not configured on this server.";
    } else {
      try {
        await mail.sendVerificationEmail(normEmail, { name, code, purpose, expiresMin: EXPIRY_MS / 60000 });
        mailed = true;
      } catch (e) { mailError = e.message; }
    }
  }

  const out = {
    ok: true,
    otpId: id,
    expiresAt: now() + EXPIRY_MS,
    resendAt: now() + RESEND_MS,
    maxAttempts: MAX_ATTEMPTS,
    channel: mailed ? "email" : (mailError ? "none" : "sms"),
    mailed
  };
  if (mailError) out.mailError = mailError;
  // Only while EXPOSE_OTP_IN_RESPONSE=true, so you can test before trusting the mailbox.
  if (config.exposeOtp) out.devCode = code;
  return out;
}

async function getOtp(id) {
  const row = await db.one("SELECT * FROM otps WHERE id = ?", [id]);
  if (!row) return null;
  return row;
}

async function verifyOtp(id, code) {
  const o = await getOtp(id);
  if (!o) return { ok: false, msg: "That code expired. Ask for a new one." };
  if (now() > Number(o.expires_at)) return { ok: false, msg: "That code expired. Ask for a new one." };
  if (Number(o.attempts) >= Number(o.max_attempts)) return { ok: false, msg: "Too many tries. Request a fresh code." };
  if (o.verified) return { ok: true, alreadyVerified: true, otp: o };

  const attempts = Number(o.attempts) + 1;
  const matched = bcrypt.compareSync(String(code || "").trim(), o.code_hash);
  await db.run("UPDATE otps SET attempts = ?, verified = ? WHERE id = ?", [attempts, matched ? 1 : 0, id]);

  if (!matched) return { ok: false, msg: "That code didn't match. Try once more.", left: Number(o.max_attempts) - attempts };
  return { ok: true, otp: await getOtp(id) };
}

async function canResend(id) {
  const o = await getOtp(id);
  return !!(o && now() >= Number(o.resend_at));
}

/* Verify the newest live code for a target without an id (e.g. forgot-password page). */
async function latestFor({ email, mobile, purpose }) {
  const row = await newest({
    email: email ? String(email).trim().toLowerCase() : null,
    mobile: mobile ? String(mobile).replace(/\D/g, "").slice(-10) : null,
    purpose
  });
  if (!row) notFound("No code has been sent yet.");
  return row;
}

module.exports = { requestOtp, verifyOtp, getOtp, canResend, latestFor, EXPIRY_MS, MAX_ATTEMPTS, RESEND_MS };
