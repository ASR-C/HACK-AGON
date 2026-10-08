/* AI coach on Groq. Three jobs:
   - hint:      nudge towards an approach without handing over the solution
   - explain:   walk through why a submission failed its hidden tests
   - coach:     general study help for a topic or a mistake in the book
   The hidden test cases never leave the server: the model only sees the
   failing input and a bug-class description, not the expected output. */

const express = require("express");
const db = require("../db");
const R = require("../lib/repo");
const D = require("../lib/domain");
const auth = require("../lib/auth");
const groq = require("../lib/groq");
const config = require("../config");
const { HttpError, notFound, bad, wrap } = require("../lib/util");

const router = express.Router();

const SYSTEM = [
  "You are HackAgon's coding coach for Indian college students practising data structures and algorithms.",
  "Be concrete, encouraging and brief. Plain English, short sentences, no filler.",
  "Never paste a full working solution unless the student explicitly asks after failing twice.",
  "Never reveal hidden test case outputs. Describe the shape of the failing input and the class of bug.",
  "Answer in markdown with at most three short sections. Keep code snippets under 15 lines."
].join(" ");

/* Cheap in-memory limiter: 12 calls per user per minute. */
const hits = new Map();
function throttle(userId) {
  const t = Date.now();
  const list = (hits.get(userId) || []).filter(x => t - x < 60000);
  if (list.length >= 12) throw new HttpError(429, "That's a lot of coaching in one minute. Give it a moment.");
  list.push(t);
  hits.set(userId, list);
}

async function ask(messages, maxTokens = 1400) {
  if (!groq.configured()) throw new HttpError(503, "The AI coach isn't configured on this server yet (GROQ_API_KEY).");
  return groq.chat([{ role: "system", content: SYSTEM }, ...messages], { maxTokens, temperature: 0.4 });
}

router.post("/hint", auth.required, wrap(async (req, res) => {
  throttle(req.user.id);
  const row = await D.getQuestionRow(String((req.body || {}).questionId || ""), { includeHidden: true });
  if (!row) notFound("No question with that id.");
  const q = R.shapeQuestionAdmin(row);

  const attempts = (await db.one(
    "SELECT COUNT(*) AS c FROM submissions WHERE user_id = ? AND question_id = ? AND ok = 0", [req.user.id, q.id]
  )).c;

  const out = await ask([
    { role: "user", content: `Question: ${q.title}\n${q.statement.replace(/<[^>]+>/g, "")}\nTopics: ${q.topics.join(", ")}\nDifficulty: ${q.difficulty}\nThe student has failed ${attempts} time(s). Give ${Number(attempts) >= 2 ? "the approach outline plus a short skeleton" : "one hint that points at the right data structure or recurrence, without code"}.\nOfficial approach (for your reference, do not copy verbatim): ${q.approach || "n/a"}` }
  ]);
  res.json({ ok: true, hint: out.text, model: out.model, attempts: Number(attempts) });
}));

router.post("/explain", auth.required, wrap(async (req, res) => {
  throttle(req.user.id);
  const { questionId, lang, code } = req.body || {};
  const row = await D.getQuestionRow(String(questionId || ""), { includeHidden: true });
  if (!row) notFound("No question with that id.");
  const q = R.shapeQuestionAdmin(row);
  if (typeof code !== "string" || !code.trim()) bad("There's no code to explain.");
  if (code.length > 20000) bad("That code is too long to review.");

  // Re-judge server-side so the explanation matches reality, not the client's claim.
  const { judge } = require("../lib/judge");
  const verdict = judge(q, lang || "javascript", code);
  const failing = (verdict.results || []).filter(r => !r.pass).slice(0, 2);
  const failingDesc = failing.map(f => {
    const args = (q.cases[f.i] || {}).args;
    return `case ${f.i + 1} with input ${JSON.stringify(args).slice(0, 400)}${f.error ? " — threw: " + f.error : " — wrong answer"}`;
  }).join("; ") || "all cases passed";

  const out = await ask([
    { role: "user", content: `Language: ${lang}\nStudent code:\n\`\`\`${lang}\n${code.slice(0, 8000)}\n\`\`\`\nPassed ${verdict.passed}/${verdict.total} hidden cases. Failing: ${failingDesc}.\nExplain the bug class and the fix to make. Do not state the expected outputs. ${verdict.compileError ? "Compile/runtime error: " + verdict.compileError : ""}` }
  ], 1600);
  res.json({ ok: true, explanation: out.text, verdict: { passed: verdict.passed, total: verdict.total, ok: verdict.ok, simulated: verdict.simulated, compileError: verdict.compileError }, model: out.model });
}));

router.post("/coach", auth.required, wrap(async (req, res) => {
  throttle(req.user.id);
  const { topic, question: text, mistakeId } = req.body || {};
  let context = "";

  if (mistakeId) {
    const m = await db.one("SELECT * FROM mistakes WHERE id = ? AND user_id = ?", [String(mistakeId), req.user.id]);
    if (!m) notFound("That mistake isn't in your book.");
    const qRow = await D.getQuestionRow(m.question_id, { includeHidden: false });
    if (qRow) {
      const q = R.shapeQuestionPublic(qRow);
      context = `They previously failed "${q.title}" (${q.topics.join(", ")}, ${q.difficulty}).`;
    }
  }

  const prompt = String(text || "").trim().slice(0, 2000);
  if (!prompt && !topic) bad("Ask something, or name a topic.");
  const out = await ask([
    { role: "user", content: `${context}\nTopic: ${topic || "general"}\nStudent asks: ${prompt || "Give me a short study plan for this topic and one practice question to try."}` }
  ], 1600);
  res.json({ ok: true, answer: out.text, model: out.model, provider: "groq", configured: groq.configured() });
}));

router.get("/status", wrap(async (_req, res) => {
  res.json({ ok: true, enabled: groq.configured(), model: config.groq.model });
}));

module.exports = router;
