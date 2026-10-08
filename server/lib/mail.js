/* Gmail SMTP through a Google App Password (2FA must be on for the account).
   Port 465 = implicit TLS. The app password goes in .env, never in source. */

const nodemailer = require("nodemailer");
const config = require("../config");

let transporter = null;
if (config.mail.enabled) {
  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: { user: config.mail.user, pass: config.mail.pass },
    pool: true,
    maxConnections: 3
  });
}

const enabled = () => !!transporter;

async function verify() {
  if (!transporter) return { ok: false, reason: "EMAIL_* not configured" };
  try { await transporter.verify(); return { ok: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* One shared template so every HackAgon mail looks the same. */
function shell(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#F6EDE0;padding:28px;font-family:Georgia,serif;color:#2A211B">
  <div style="max-width:520px;margin:0 auto;background:#FFFDF8;border:2px solid #2A211B;border-radius:14px;box-shadow:6px 6px 0 #B4523A;overflow:hidden">
    <div style="background:#B4523A;color:#F6EDE0;padding:14px 20px;font-weight:700;letter-spacing:.02em">${escapeHtml(config.mail.fromName)}</div>
    <div style="padding:22px 20px">
      <h1 style="margin:0 0 10px;font-size:20px">${escapeHtml(title)}</h1>
      ${body}
    </div>
    <div style="padding:12px 20px;border-top:1px dashed #C9B79C;font-size:12px;color:#6B5B4C">
      You are getting this because an account action was requested on HackAgon. If it wasn't you, ignore this mail.
    </div>
  </div></body></html>`;
}

async function sendVerificationEmail(to, { name, code, purpose, expiresMin = 5 }) {
  if (!transporter) throw new Error("Mail is not configured on this server.");
  const label = { signup: "confirm your new account", login: "sign in", forgot: "reset your password", payout: "verify a payout change", contact: "confirm your contact details" }[purpose] || "verify your identity";
  const html = shell("Your verification code", `
    <p style="margin:0 0 14px;line-height:1.5">Hi ${escapeHtml(name || "there")} &mdash; here is the code to ${escapeHtml(label)}.</p>
    <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;letter-spacing:.35em;font-weight:700;text-align:center;background:#F3E7D3;border:2px dashed #B4523A;border-radius:12px;padding:16px 8px;margin:0 0 14px">${escapeHtml(code)}</div>
    <p style="margin:0;line-height:1.5;font-size:14px">It expires in <strong>${expiresMin} minutes</strong> and allows five attempts. Never share it &mdash; HackAgon staff will not ask for it.</p>`);
  const info = await transporter.sendMail({
    from: `"${config.mail.fromName}" <${config.mail.user}>`,
    to,
    subject: `${code} is your ${config.mail.fromName} verification code`,
    text: `Your ${config.mail.fromName} code is ${code}. It expires in ${expiresMin} minutes.`,
    html
  });
  return info;
}

async function sendPlain(to, subject, title, paragraph) {
  if (!transporter) throw new Error("Mail is not configured on this server.");
  return transporter.sendMail({
    from: `"${config.mail.fromName}" <${config.mail.user}>`,
    to, subject,
    text: paragraph,
    html: shell(title, `<p style="margin:0;line-height:1.6">${paragraph}</p>`)
  });
}

module.exports = { enabled, verify, sendVerificationEmail, sendPlain };
