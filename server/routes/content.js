/* Read-mostly content: question bank (public view), library, taxonomies,
   plus the one-shot bootstrap payload every page loads on boot. */

const express = require("express");
const db = require("../db");
const R = require("../lib/repo");
const D = require("../lib/domain");
const auth = require("../lib/auth");
const mail = require("../lib/mail");
const groq = require("../lib/groq");
const config = require("../config");
const { uid, now, HttpError, notFound, bad, wrap } = require("../lib/util");

const router = express.Router();

async function taxonomies() {
  const [topics, languages, prizePresets] = await Promise.all([
    db.q("SELECT * FROM topics ORDER BY label"),
    db.q("SELECT * FROM languages ORDER BY label"),
    db.q("SELECT * FROM prize_presets ORDER BY id")
  ]);
  return {
    topics: topics.map(t => ({ id: t.id, label: t.label })),
    languages: languages.map(l => ({ id: l.id, label: l.label })),
    prizePresets: prizePresets.map(p => ({ id: p.id, label: p.label, split: p.split || {} })),
    ALL_LANGS: languages.map(l => l.id)
  };
}

async function books(status) {
  const sql = status ? "SELECT * FROM books WHERE status = ? ORDER BY subject, title" : "SELECT * FROM books WHERE status <> 'rejected' ORDER BY subject, title";
  const rows = await db.q(sql, status ? [status] : []);
  return rows.map(R.shapeBook);
}

/* ---------- bootstrap: everything a page needs in one round trip ---------- */
router.get("/bootstrap", auth.optional, wrap(async (req, res) => {
  const [questions, allBooks, achievements, tax, rooms] = await Promise.all([
    D.listQuestionsPublic(),
    books("approved"),
    db.q("SELECT * FROM achievements"),
    taxonomies(),
    D.listRooms({ status: ["open", "live", "draft"] })
  ]);

  const payload = {
    ok: true,
    server: {
      time: now(),
      mail: { enabled: mail.enabled(), exposeOtp: config.exposeOtp },
      ai: { enabled: groq.configured(), model: config.groq.model }
    },
    seed: Object.assign({
      questions,
      books: allBooks,
      achievements: achievements.map(R.shapeAchievement),
      platformRooms: (await db.q("SELECT id,name,topics,duration_min,question_ids FROM rooms WHERE platform = 1 ORDER BY created_at")).map(r => ({
        name: r.name, topics: r.topics, durationMin: r.duration_min, questions: r.question_ids
      }))
    }, tax),
    rooms: rooms.filter(r => !r.platform || r.status !== "draft"),
    me: req.user || null,
    token: req.token || null
  };
  res.json(payload);
}));

/* ---------- questions ---------- */
router.get("/questions", wrap(async (req, res) => {
  res.json({ ok: true, questions: await D.listQuestionsPublic(req.query) });
}));

router.get("/questions/:id", wrap(async (req, res) => {
  const row = await D.getQuestionRow(req.params.id);
  if (!row) notFound("No question with that id.");
  res.json({ ok: true, question: R.shapeQuestionPublic(row) });
}));

/* ---------- library ---------- */
router.get("/books", wrap(async (req, res) => {
  const list = await books("approved");
  const subject = req.query.subject ? String(req.query.subject).toLowerCase() : null;
  res.json({
    ok: true,
    books: subject ? list.filter(b => b.subject.toLowerCase() === subject) : list,
    subjects: Array.from(new Set(list.map(b => b.subject)))
  });
}));

router.post("/books", auth.required, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.title || String(b.title).trim().length < 2) bad("The book needs a title.");
  if (!b.url || !/^https?:\/\/.+/.test(String(b.url))) bad("Add a link we can check the licence at.");
  if (!b.licence || String(b.licence).trim().length < 3) bad("Tell us the licence — the library only lists free or open-licence books.");
  const id = uid("bk");
  await db.run(
    "INSERT INTO books (id,title,author,subject,licence,url,status,submitted_by,created_at) VALUES (?,?,?,?,?,?, 'pending', ?, ?)",
    [id, String(b.title).trim().slice(0, 200), String(b.author || "Unknown").trim().slice(0, 200),
     String(b.subject || "General").trim().slice(0, 120), String(b.licence).trim().slice(0, 120),
     String(b.url).trim().slice(0, 500), req.user.id, now()]
  );
  res.json({ ok: true, book: R.shapeBook(await db.one("SELECT * FROM books WHERE id = ?", [id])) });
}));

/* ---------- taxonomies ---------- */
router.get("/taxonomies", wrap(async (_req, res) => res.json({ ok: true, ...(await taxonomies()) })));

router.get("/achievements", auth.optional, wrap(async (req, res) => {
  res.json({ ok: true, achievements: await D.achievementsFor(req.user ? req.user.id : null) });
}));

module.exports = router;
