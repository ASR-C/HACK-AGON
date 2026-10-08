/* Admin console API: question bank, book licences, accounts and roles,
   disputes. Every route here requires an admin token (PRD 3: roles are
   checked server-side on every request, never trusted from the browser). */

const express = require("express");
const db = require("../db");
const R = require("../lib/repo");
const D = require("../lib/domain");
const auth = require("../lib/auth");
const { uid, now, int, HttpError, notFound, bad, forbidden, wrap } = require("../lib/util");

const router = express.Router();
router.use(auth.adminOnly);

/* ================= question bank ================= */
function validateQuestion(d) {
  const errs = {};
  if (!d.title || String(d.title).trim().length < 3) errs.title = "Give the question a title of 3+ characters.";
  if (!d.statement || String(d.statement).trim().length < 20) errs.statement = "Write a statement players can actually solve from (20+ characters).";
  if (!Array.isArray(d.topics) || !d.topics.length) errs.topics = "Pick at least one topic.";
  if (!Array.isArray(d.languages) || !d.languages.length) errs.languages = "Pick at least one language.";
  if (!(int(d.points) > 0)) errs.points = "Points must be above zero.";
  if (!Array.isArray(d.cases) || !d.cases.length) errs.cases = "Add at least one hidden test case.";
  (d.cases || []).forEach((c, i) => {
    if (!c || !Array.isArray(c.args)) errs["case" + i] = `Hidden case ${i + 1} needs an args array.`;
    else if (c.expected === undefined) errs["case" + i] = `Hidden case ${i + 1} needs an expected value.`;
  });
  if (!Array.isArray(d.samples) || !d.samples.length) errs.samples = "Add at least one visible sample.";
  return errs;
}

router.get("/questions", wrap(async (req, res) => {
  const rows = await db.q("SELECT * FROM questions ORDER BY retired, difficulty, title");
  res.json({ ok: true, questions: rows.map(R.shapeQuestionAdmin) });
}));

router.get("/questions/:id", wrap(async (req, res) => {
  const row = await D.getQuestionRow(req.params.id, { includeHidden: true });
  if (!row) notFound("No question with that id.");
  res.json({ ok: true, question: R.shapeQuestionAdmin(row) });
}));

router.post("/questions", wrap(async (req, res) => {
  const d = req.body || {};
  const errs = validateQuestion(d);
  if (Object.keys(errs).length) throw new HttpError(422, "That question isn't ready to save.", { errs });

  const id = String(d.id || uid("q")).slice(0, 40);
  const existing = await db.one("SELECT id, custom FROM questions WHERE id = ?", [id]);
  const values = [
    id, String(d.title).trim().slice(0, 160), JSON.stringify(d.topics), String(d.difficulty || "easy").slice(0, 12),
    int(d.points), int(d.timeLimitMin) || 15, int(d.memoryLimitMB) || 256, JSON.stringify(d.languages),
    String(d.statement), JSON.stringify(d.samples), JSON.stringify(d.sig || null), String(d.hint || "").slice(0, 2000),
    JSON.stringify(d.cases), d.unordered ? 1 : 0, String(d.approach || "").slice(0, 4000),
    JSON.stringify(d.starters || null), now(), now()
  ];

  if (existing) {
    await db.run(
      `UPDATE questions SET title=?,topics=?,difficulty=?,points=?,time_limit_min=?,memory_limit_mb=?,languages=?,
        statement=?,samples=?,sig=?,hint=?,cases=?,unordered=?,approach=?,starters=?,updated_at=? WHERE id=?`,
      [values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], values[10],
       values[11], values[12], values[13], values[14], values[15], values[17], id]
    );
  } else {
    await db.run(
      `INSERT INTO questions (id,title,topics,difficulty,points,time_limit_min,memory_limit_mb,languages,statement,
        samples,sig,hint,cases,unordered,approach,starters,custom,retired,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?)`,
      [values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9],
       values[10], values[11], values[12], values[13], values[14], values[15], values[16], values[17]]
    );
  }
  res.json({ ok: true, question: R.shapeQuestionAdmin(await D.getQuestionRow(id, { includeHidden: true })) });
}));

/* Retiring hides a question from new rooms but keeps it resolvable for rooms
   already running — a hard delete would break a live match. */
router.post("/questions/:id/retire", wrap(async (req, res) => {
  const row = await db.one("SELECT id FROM questions WHERE id = ?", [req.params.id]);
  if (!row) notFound("No question with that id.");
  await db.run("UPDATE questions SET retired = 1, updated_at = ? WHERE id = ?", [now(), row.id]);
  res.json({ ok: true, retired: true });
}));

router.post("/questions/:id/restore", wrap(async (req, res) => {
  await db.run("UPDATE questions SET retired = 0, updated_at = ? WHERE id = ?", [now(), req.params.id]);
  res.json({ ok: true, retired: false });
}));

router.delete("/questions/:id", wrap(async (req, res) => {
  const row = await db.one("SELECT id, custom FROM questions WHERE id = ?", [req.params.id]);
  if (!row) notFound("No question with that id.");
  if (!row.custom) throw new HttpError(409, "Seeded questions can only be retired, not deleted — rooms may still reference them.");
  const used = await db.one("SELECT COUNT(*) AS c FROM rooms WHERE JSON_CONTAINS(question_ids, ?)", [JSON.stringify(row.id)]);
  if (int(used.c) > 0) throw new HttpError(409, `${used.c} room(s) still use this question. Retire it instead.`);
  await db.run("DELETE FROM questions WHERE id = ?", [row.id]);
  res.json({ ok: true, deleted: true });
}));

/* ================= library licences ================= */
router.get("/books", wrap(async (req, res) => {
  const rows = req.query.status
    ? await db.q("SELECT * FROM books WHERE status = ? ORDER BY created_at DESC", [String(req.query.status)])
    : await db.q("SELECT * FROM books WHERE status <> 'approved' ORDER BY created_at DESC");
  res.json({ ok: true, books: rows.map(R.shapeBook) });
}));

router.post("/books/:id/decide", wrap(async (req, res) => {
  const status = ["approved", "rejected", "pending"].includes((req.body || {}).status) ? req.body.status : null;
  if (!status) bad("status must be approved, rejected or pending.");
  const row = await db.one("SELECT * FROM books WHERE id = ?", [req.params.id]);
  if (!row) notFound("No such book submission.");
  await db.run("UPDATE books SET status = ?, note = ?, decided_at = ? WHERE id = ?",
    [status, String((req.body || {}).note || "").slice(0, 1000), now(), row.id]);
  if (row.submitted_by) await D.notify(row.submitted_by, "book-" + status, null, (req.body || {}).note || "");
  res.json({ ok: true, book: R.shapeBook(await db.one("SELECT * FROM books WHERE id = ?", [row.id])) });
}));

/* ================= accounts ================= */
router.get("/users", wrap(async (req, res) => {
  const s = String(req.query.q || "").trim().toLowerCase();
  const rows = s
    ? await db.q(
        `SELECT ${auth.PUBLIC_USER_FIELDS} FROM users
         WHERE LOWER(name) LIKE ? OR LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR mobile LIKE ?
         ORDER BY created_at DESC LIMIT 300`,
        [`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`]
      )
    : await db.q(`SELECT ${auth.PUBLIC_USER_FIELDS} FROM users ORDER BY created_at DESC LIMIT 300`);
  res.json({ ok: true, users: rows.map(auth.shapeUser) });
}));

router.post("/users/:id/admin", wrap(async (req, res) => {
  const row = await db.one("SELECT id FROM users WHERE id = ?", [req.params.id]);
  if (!row) notFound("No account with that id.");
  const val = (req.body || {}).isAdmin === false ? 0 : 1;
  if (row.id === req.user.id && val === 0) throw new HttpError(409, "You can't remove your own admin role while you're using it.");
  await db.run("UPDATE users SET is_admin = ? WHERE id = ?", [val, row.id]);
  res.json({ ok: true, user: await auth.userById(row.id) });
}));

router.post("/users/:id/verify", wrap(async (req, res) => {
  await db.run("UPDATE users SET verified = 1 WHERE id = ?", [req.params.id]);
  res.json({ ok: true, user: await auth.userById(req.params.id) });
}));

/* ================= disputes ================= */
router.get("/disputes", wrap(async (req, res) => {
  const rows = req.query.status
    ? await db.q("SELECT * FROM disputes WHERE status = ? ORDER BY at DESC", [String(req.query.status)])
    : await db.q("SELECT * FROM disputes ORDER BY at DESC LIMIT 200");
  const disputes = rows.map(R.shapeDispute);
  const rooms = {};
  for (const d of Array.from(new Set(disputes.map(x => x.roomId)))) {
    const r = await D.getRoomFull(d);
    if (r) rooms[d] = { id: r.id, name: r.name, status: r.status, payoutBlocked: r.payoutBlocked, prizePoolPaise: r.prizePoolPaise };
  }
  res.json({ ok: true, disputes, rooms });
}));

router.post("/disputes/:id/resolve", wrap(async (req, res) => {
  const row = await db.one("SELECT * FROM disputes WHERE id = ?", [req.params.id]);
  if (!row) notFound("No such dispute.");
  const resolution = String((req.body || {}).resolution || "").trim();
  if (resolution.length < 5) bad("Write down what you decided.");
  await db.run("UPDATE disputes SET status = 'resolved', resolution = ? WHERE id = ?", [resolution.slice(0, 2000), row.id]);
  await db.run("UPDATE rooms SET payout_blocked = 0 WHERE id = ?", [row.room_id]);
  await D.notify(row.user_id, "dispute-resolved", row.room_id, resolution.slice(0, 200));
  res.json({ ok: true, dispute: R.shapeDispute(await db.one("SELECT * FROM disputes WHERE id = ?", [row.id])) });
}));

/* ================= proctoring review ================= */
router.get("/rooms/:id/proctoring", wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  const [violations, snapshots] = await Promise.all([
    db.q("SELECT * FROM violations WHERE room_id = ? ORDER BY at", [room.id]),
    db.q("SELECT * FROM snapshots WHERE room_id = ? ORDER BY at DESC LIMIT 200", [room.id])
  ]);
  res.json({ ok: true, room: { id: room.id, name: room.name, status: room.status }, violations: violations.map(R.shapeViolation), snapshots: snapshots.map(s => ({ id: s.id, userId: s.user_id, at: int(s.at), path: s.path })) });
}));

module.exports = router;
