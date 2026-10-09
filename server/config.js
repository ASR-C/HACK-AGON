require("dotenv").config({ path: __dirname + "/.env" });

const path = require("path");

const bool = (v, d) => (v === undefined || v === "" ? d : String(v).toLowerCase() === "true");
const num = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));

const config = {
  port: num(process.env.PORT, 3000),
  root: path.resolve(__dirname, ".."),
  db: {
    host: process.env.DB_HOST || "localhost",
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
    database: process.env.DB_NAME || "hackagon",
    ssl: bool(process.env.DB_SSL, false)
  },
  jwt: {
    secret: process.env.JWT_SECRET || "hackagon-insecure-dev-secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d"
  },
  groq: {
    key: process.env.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b"
  },
  mail: {
    host: process.env.EMAIL_HOST || "",
    port: num(process.env.EMAIL_PORT, 465),
    secure: bool(process.env.EMAIL_SECURE, num(process.env.EMAIL_PORT, 465) === 465),
    user: process.env.EMAIL_USER || "",
    pass: process.env.EMAIL_APP_PASSWORD || "",
    fromName: process.env.EMAIL_FROM_NAME || "HackAgon"
  },
  exposeOtp: bool(process.env.EXPOSE_OTP_IN_RESPONSE, false),
  // Addresses that get the admin role automatically when they sign up.
  adminEmails: String(process.env.ADMIN_EMAILS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
  snapshotsDir: path.join(__dirname, "data", "snapshots")
};

config.mail.enabled = !!(config.mail.host && config.mail.user && config.mail.pass);

module.exports = config;
