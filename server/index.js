/* HackAgon server — single origin: the API and the static front-end.
   Start with `npm start` in server/, then open http://localhost:8080. */

const path = require("path");
const express = require("express");
const cors = require("cors");

const config = require("./config");
const db = require("./db");
const mail = require("./lib/mail");
const groq = require("./lib/groq");
const { HttpError, now } = require("./lib/util");

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* tiny request log */
app.use((req, res, next) => {
  const t = now();
  res.on("finish", () => {
    if (req.path.startsWith("/api")) console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${now() - t}ms)`);
  });
  next();
});

app.get("/api/health", async (_req, res) => {
  let dbVersion = null, dbError = null;
  try { dbVersion = await db.ping(); } catch (e) { dbError = e.message; }
  res.json({
    ok: !dbError,
    time: now(),
    db: dbError ? { connected: false, error: dbError } : { connected: true, version: dbVersion, name: config.db.database },
    mail: { enabled: mail.enabled(), exposeOtp: config.exposeOtp },
    ai: { enabled: groq.configured(), model: config.groq.model }
  });
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api", require("./routes/content"));
app.use("/api/rooms", require("./routes/rooms"));
app.use("/api/play", require("./routes/play"));
app.use("/api/proctor", require("./routes/proctor"));
app.use("/api/money", require("./routes/money"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/ai", require("./routes/ai"));

/* unknown API route -> JSON 404, not the HTML shell */
app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "No such endpoint." }));

/* the front-end */
app.use(express.static(config.root, { extensions: ["html"], maxAge: "0" }));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.root, "index.html")));

/* error handler */
app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : (err.status || 500);
  if (status >= 500) console.error(err);
  res.status(status).json({
    ok: false,
    error: err.message || "Something broke on our side.",
    errs: err.extra && err.extra.errs ? err.extra.errs : undefined,
    ...(err.extra && typeof err.extra === "object" && !err.extra.errs ? err.extra : {})
  });
});

(async () => {
  try {
    const v = await db.ping();
    console.log(`MySQL ${v} — connected to "${config.db.database}".`);
  } catch (e) {
    console.error("Cannot reach MySQL:", e.message);
    console.error("Start the server, check server/.env, then run: npm run migrate && npm run seed");
    process.exit(1);
  }

  if (mail.enabled()) {
    const m = await mail.verify();
    console.log(m.ok ? `Gmail SMTP ready (${config.mail.user}).` : `Gmail SMTP failed: ${m.reason}`);
  } else {
    console.log("Mail not configured — OTP codes will not be emailed. Set EMAIL_* in server/.env.");
  }
  console.log(groq.configured() ? `Groq coach ready (${config.groq.model}).` : "GROQ_API_KEY missing — AI coach disabled.");

  app.listen(config.port, () => {
    console.log(`\nHackAgon running at http://localhost:${config.port}`);
    console.log(`API base       http://localhost:${config.port}/api`);
    console.log(`Health check   http://localhost:${config.port}/api/health\n`);
  });
})();
