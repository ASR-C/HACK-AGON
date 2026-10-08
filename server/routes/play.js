/* Judging and learning: in-room submissions, standalone practice runs,
   the mistake book, achievements and the notification inbox. */

const express = require("express");
const db = require("../db");
const R = require("../lib/repo");
const D = require("../lib/domain");
const auth = require("../lib/auth");
const { judge } = require("../lib/judge");
const { uid, now, HttpError, notFound, bad, wrap } = require("../lib/util");

const router = express.Router();

const MAX_CODE = 60000;

async function loadJudgeable(id) {
  const row = await D.getQuestionRow(id, { includeHidden: true });
  if (!row) notFound("No question with that id.");
  return R.shapeQuestionAdmin(row);
}

function checkLang(q, lang) {
  if (!q.languages.includes(lang)) throw new HttpError(400, `That question isn't set for ${lang}.`);
}

/* ---------- in-room submission: judged and scored server-side ---------- */
router.post("/submit", auth.required, wrap(async (req, res) => {
  const { roomId, questionId, lang, code } = req.body || {};
  if (!roomId || !questionId || !lang) bad("roomId, questionId and lang are required.");
  if (typeof code !== "string" || !code.trim()) bad("There's no code to judge.");
  if (code.length > MAX_CODE) bad("That submission is too large.");

  const room = await D.requireRoom(roomId);
  const player = await D.getPlayer(roomId, req.user.id);
  if (!player) throw new HttpError(403, "You're not in that room.");
  if (player.locked) throw new HttpError(423, "You're locked out of this match.");
  if (room.status === "ended") throw new HttpError(409, "That room has already finished.");
  if (!room.questionIds.includes(questionId)) throw new HttpError(403, "That question isn't part of this room.");

  const q = await loadJudgeable(questionId);
  checkLang(q, lang);

  const out = await D.recordSubmission(roomId, req.user.id, questionId, lang, code);
  res.json({
    ok: true,
    verdict: out.verdict,
    submission: out.submission,
    scored: out.player,
    board: D.scoreboard((await D.playersOf(roomId)))
  });
}));

/* ---------- standalone practice run (Learning page retry, no room) ---------- */
router.post("/practice", auth.required, wrap(async (req, res) => {
  const { questionId, lang, code } = req.body || {};
  if (!questionId || !lang) bad("questionId and lang are required.");
  if (typeof code !== "string" || !code.trim()) bad("There's no code to judge.");
  if (code.length > MAX_CODE) bad("That submission is too large.");

  const q = await loadJudgeable(questionId);
  checkLang(q, lang);
  const verdict = judge(q, lang, code);

  let mistakeSolved = false;
  const m = await db.one("SELECT * FROM mistakes WHERE user_id = ? AND question_id = ?", [req.user.id, questionId]);
  if (m && !m.solved) {
    if (verdict.ok) {
      await db.run("UPDATE mistakes SET solved = 1, solved_at = ? WHERE id = ?", [now(), m.id]);
      await D.bumpStat(req.user.id, "mistakesSolved", 1);
      mistakeSolved = true;
    } else {
      const failing = (verdict.results || []).find(x => !x.pass) || null;
      await db.run("UPDATE mistakes SET last_code = ?, failing_case = ?, at = ? WHERE id = ?",
        [code, JSON.stringify(failing), now(), m.id]);
    }
  } else if (!m && !verdict.ok) {
    const failing = (verdict.results || []).find(x => !x.pass) || null;
    await db.run("INSERT INTO mistakes (id,user_id,question_id,room_id,last_code,failing_case,solved,at) VALUES (?,?,?,NULL,?,?,0,?)",
      [uid("m"), req.user.id, questionId, code, JSON.stringify(failing), now()]);
  }

  const newly = mistakeSolved ? await D.recomputeAchievements(req.user.id) : [];
  res.json({ ok: true, verdict, mistakeSolved, newAchievements: newly, approach: verdict.ok ? q.approach : null });
}));

/* ---------- mistake book ---------- */
router.get("/mistakes", auth.required, wrap(async (req, res) => {
  const rows = await db.q("SELECT * FROM mistakes WHERE user_id = ? ORDER BY at DESC LIMIT 200", [req.user.id]);
  const mistakes = rows.map(R.shapeMistake);
  const ids = Array.from(new Set(mistakes.map(m => m.questionId)));
  let questions = [];
  if (ids.length) {
    // The editorial is included here and nowhere else public: these are questions
    // the student has already failed, which is exactly when the PRD says to show it.
    const qrows = await db.q(
      `SELECT id,title,topics,difficulty,points,languages,statement,samples,sig,hint,starters,unordered,retired,updated_at,time_limit_min,memory_limit_mb,approach
       FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`, ids
    );
    questions = qrows.map(r => Object.assign(R.shapeQuestionPublic(r), { approach: r.approach || "" }));
  }
  res.json({ ok: true, mistakes, questions });
}));

router.get("/submissions", auth.required, wrap(async (req, res) => {
  const params = [req.user.id];
  let sql = "SELECT * FROM submissions WHERE user_id = ?";
  if (req.query.roomId) { sql += " AND room_id = ?"; params.push(req.query.roomId); }
  sql += " ORDER BY at DESC LIMIT 100";
  res.json({ ok: true, submissions: (await db.q(sql, params)).map(R.shapeSubmission) });
}));

/* ---------- achievements + inbox ---------- */
router.get("/achievements", auth.required, wrap(async (req, res) => {
  const newly = await D.recomputeAchievements(req.user.id);
  res.json({ ok: true, achievements: await D.achievementsFor(req.user.id), newly });
}));

router.get("/notifications", auth.required, wrap(async (req, res) => {
  const rows = await db.q("SELECT * FROM notifications WHERE user_id = ? ORDER BY at DESC LIMIT 50", [req.user.id]);
  res.json({ ok: true, notifications: rows.map(R.shapeNotification) });
}));

module.exports = router;
