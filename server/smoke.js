/* One-shot API smoke test: OTP resend -> verify -> login -> create room ->
   submit code -> settle prize. Run with the server already up.
   Usage: node smoke.js [email] [password] */

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;
const EMAIL = process.argv[2];
const PASS = process.argv[3];

let token = null;
async function call(method, path, body, opts = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ "Content-Type": "application/json" }, token && !opts.anon ? { Authorization: "Bearer " + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text.slice(0, 200) }; }
  if (!res.ok && !opts.soft) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return { status: res.status, json };
}
const ok = (label, cond, extra) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!EMAIL || !PASS) {
    throw new Error("Usage: node smoke.js <email> <password>");
  }

  /* --- login (may ask for verification first) --- */
  let login = await call("POST", "/auth/login", { identifier: EMAIL, password: PASS }, { anon: true, soft: true });
  if (login.json.needVerify) {
    console.log("Account not verified yet — running the OTP flow over HTTP.");
    let otpId = login.json.otp && login.json.otp.otpId;
    let code = login.json.otp && login.json.otp.devCode;
    if (!code) {
      const wait = (login.json.otp && login.json.otp.retryInSecs) || 60;
      console.log(`  resend cooldown: waiting ${wait + 1}s`);
      await sleep((wait + 1) * 1000);
      const r = await call("POST", "/auth/resend", { otpId }, { anon: true });
      otpId = r.json.otp.otpId; code = r.json.otp.devCode;
      ok("resend after cooldown", r.json.ok && !!code, "channel=" + r.json.otp.channel + " mailed=" + r.json.otp.mailed);
    }
    const wrong = await call("POST", "/auth/verify", { otpId, code: "000000" }, { anon: true, soft: true });
    ok("wrong code rejected", wrong.status === 400, wrong.json.error + " left=" + wrong.json.left);
    const good = await call("POST", "/auth/verify", { otpId, code }, { anon: true });
    ok("correct code activates account", good.json.ok && good.json.activated);
    token = good.json.token;
    login = await call("POST", "/auth/login", { identifier: EMAIL, password: PASS }, { anon: true });
  }
  token = login.json.token;
  ok("login returns a JWT", !!token, "user=" + login.json.user.username + " admin=" + login.json.user.isAdmin);

  /* --- me --- */
  const me = await call("GET", "/auth/me");
  ok("GET /auth/me", me.json.user.email === EMAIL, `achievements=${me.json.achievements.length} mistakes=${me.json.mistakes.length}`);

  /* --- bootstrap --- */
  const boot = await call("GET", "/bootstrap", undefined, { anon: true });
  ok("bootstrap hides hidden tests", !("cases" in boot.json.seed.questions[0]), `questions=${boot.json.seed.questions.length} rooms=${boot.json.rooms.length}`);

  /* --- admin --- */
  const adminUsers = await call("GET", "/admin/users", undefined, { soft: true });
  ok("admin gate honours isAdmin", adminUsers.status === 200 && Array.isArray(adminUsers.json.users), "users=" + (adminUsers.json.users || []).length);

  /* --- create a funded tournament --- */
  const created = await call("POST", "/rooms", {
    name: "Smoke Test Tournament", format: "Solo", type: "tournament", size: 8,
    langs: ["javascript"], topics: ["arrays"], questionIds: ["q-two-sum", "q-largest"],
    durationMin: 20, visibility: "Public", prizePoolPaise: 50000, entryFeePaise: 5000,
    prizePreset: "winner-all", split: { 1: 100 }, publish: true, funded: false, minPlayers: 1
  });
  const room = created.json.room;
  ok("create tournament (unfunded = draft)", created.status === 201 && room.status === "draft", "id=" + room.id + " pool=" + room.prizePoolPaise + "p");
  ok("host auto-joined", room.players.length === 1 && room.players[0].userId === me.json.user.id);

  await call("POST", `/money/rooms/${room.id}/fund`);
  const funded = (await call("GET", `/rooms/${room.id}`, undefined, { anon: true })).json.room;
  ok("funding the pool opens the room", funded.funded && funded.status === "open");

  await call("POST", `/money/rooms/${room.id}/entry`);
  ok("entry fee escrowed", true);

  const started = await call("POST", `/rooms/${room.id}/start`);
  ok("host starts the room", started.json.room.status === "live");

  /* --- submit: correct solution, judged server-side --- */
  const goodCode = `function solve(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i].sort((a,b)=>a-b);
    seen.set(nums[i], i);
  }
  return [];
}`;
  const sub = await call("POST", "/play/submit", { roomId: room.id, questionId: "q-two-sum", lang: "javascript", code: goodCode });
  ok("correct JS passes all hidden cases", sub.json.verdict.ok && !sub.json.verdict.simulated, `${sub.json.verdict.passed}/${sub.json.verdict.total} in ${sub.json.verdict.timeMs}ms, scored +${sub.json.scored && sub.json.scored.gained}`);

  const badCode = `function solve(nums, target) { return [0, 1]; }`;
  const bad = await call("POST", "/play/submit", { roomId: room.id, questionId: "q-largest", lang: "javascript", code: badCode });
  ok("wrong answer fails + books a mistake", !bad.json.verdict.ok, `${bad.json.verdict.passed}/${bad.json.verdict.total}`);

  const mistakes = await call("GET", "/play/mistakes");
  ok("mistake book has the failure", mistakes.json.mistakes.some(m => m.questionId === "q-largest"));

  const sim = await call("POST", "/play/submit", { roomId: room.id, questionId: "q-largest", lang: "python", code: "def solve(arr):\n    best = arr[0]\n    for x in arr:\n        if x > best:\n            best = x\n    return best\n" });
  ok("non-JS verdict is flagged simulated", sim.json.verdict.simulated === true, `passed=${sim.json.verdict.passed}/${sim.json.verdict.total}`);

  /* --- proctoring --- */
  const viol = await call("POST", `/proctor/${room.id}/violations`, { type: "tab-switch" });
  ok("violation locks the player server-side", viol.json.locked === true, "reason=" + viol.json.lockReason);
  const lockedSubmit = await call("POST", "/play/submit", { roomId: room.id, questionId: "q-two-sum", lang: "javascript", code: goodCode }, { soft: true });
  ok("locked player cannot submit", lockedSubmit.status === 423, lockedSubmit.json.error);
  await call("POST", `/proctor/${room.id}/unlock`, { userId: me.json.user.id });
  ok("host can lift the lock", true);

  /* --- settle --- */
  await call("POST", `/rooms/${room.id}/finalise`);
  const settle = await call("POST", `/money/rooms/${room.id}/settle`);
  const fee = Math.round(50000 * 0.01);
  ok("settlement: 1% fee then rank-1 prize", settle.json.fee === fee && settle.json.made[0].amountPaise === 50000 - fee,
    `fee=${settle.json.fee}p prize=${settle.json.made[0].amountPaise}p`);

  const money = await call("GET", "/money/me/ledger");
  ok("ledger records escrow + fee + prize", money.json.ledger.length >= 3,
    money.json.ledger.map(l => `${l.type}:${l.amountPaise}`).join(" "));

  /* --- AI coach on Groq --- */
  const hint = await call("POST", "/ai/hint", { questionId: "q-two-sum" }, { soft: true });
  ok("Groq hint", hint.status === 200 && hint.json.hint.length > 40, (hint.json.hint || hint.json.error || "").slice(0, 90).replace(/\n/g, " "));
  const explain = await call("POST", "/ai/explain", { questionId: "q-largest", lang: "javascript", code: badCode }, { soft: true });
  ok("Groq failure explanation", explain.status === 200 && explain.json.explanation.length > 40, (explain.json.explanation || explain.json.error || "").slice(0, 90).replace(/\n/g, " "));

  /* --- totals --- */
  const totals = await call("GET", "/money/totals", undefined, { soft: true });
  ok("admin money totals", totals.status === 200, JSON.stringify(totals.json.totals));

  console.log("\nSmoke test finished.");
})().catch(e => { console.error("\nSMOKE TEST ERROR:", e.message); process.exit(1); });
