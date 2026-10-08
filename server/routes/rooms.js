/* Rooms, duels and tournaments: creation, joining, lifecycle, scoreboard. */

const express = require("express");
const db = require("../db");
const D = require("../lib/domain");
const auth = require("../lib/auth");
const { uid, now, int, inviteCode, HttpError, notFound, bad, forbidden, wrap } = require("../lib/util");

const router = express.Router();

const str = (v, max, dflt) => String(v === undefined || v === null ? dflt : v).slice(0, max);

router.get("/", wrap(async (req, res) => {
  const f = {};
  if (req.query.type) f.type = req.query.type;
  if (req.query.status) f.status = String(req.query.status).split(",");
  if (req.query.hostId) f.hostId = req.query.hostId;
  if (req.query.topic) f.topic = req.query.topic;
  if (req.query.lang) f.lang = req.query.lang;
  if (req.query.q) f.q = req.query.q;
  res.json({ ok: true, rooms: await D.listRooms(f) });
}));

/* ---------- create ---------- */
router.post("/", auth.required, wrap(async (req, res) => {
  const d = req.body || {};
  if (!d.name || str(d.name, 200, "").trim().length < 3) bad("Give the room a name of 3+ characters.");

  const langs = Array.isArray(d.langs) && d.langs.length ? d.langs.map(String).slice(0, 8) : ["javascript"];
  const topics = Array.isArray(d.topics) ? d.topics.map(String).slice(0, 12) : [];
  let questionIds = Array.isArray(d.questionIds) ? d.questionIds.map(String) : [];

  if (!questionIds.length) {
    // No hand-picked list: fill from the bank by topic/language/difficulty.
    const where = [];
    const params = [];
    if (topics.length) {
      where.push("(" + topics.map(() => "JSON_CONTAINS(topics, ?)").join(" OR ") + ")");
      params.push(...topics.map(t => JSON.stringify(t)));
    }
    if (d.difficulty) { where.push("difficulty = ?"); params.push(String(d.difficulty)); }
    where.push("retired = 0");
    const rows = await db.q(
      `SELECT id FROM questions WHERE ${where.join(" AND ")} ORDER BY RAND() LIMIT 20`, params
    );
    questionIds = rows.map(r => r.id);
  }
  if (!questionIds.length) bad("No questions match those filters — widen the topics or pick questions by hand.");

  const size = Math.max(2, Math.min(500, int(d.size) || 10));
  const entryFeePaise = Math.max(0, int(d.entryFeePaise));
  const prizePoolPaise = Math.max(0, int(d.prizePoolPaise));
  const isTourney = d.type === "tournament" || entryFeePaise > 0 || prizePoolPaise > 0;
  const visibility = d.visibility === "Private" ? "Private" : "Public";
  const funded = isTourney ? !!d.funded : true;

  const id = uid("room");
  await db.run(
    `INSERT INTO rooms
      (id,type,host_id,host_name,name,format,size,squad_size,langs,topics,question_ids,duration_min,time_per_q,
       visibility,invite_code,prize_pool_paise,entry_fee_paise,tournament_mode,snapshot_secs,status,start_time,
       platform,prize_preset,split,min_players,funded,org,results_locked,payout_blocked,final_board,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 0,?,?,?,?,?, 0,0,NULL,?)`,
    [id, isTourney ? "tournament" : (d.type === "duel" ? "duel" : "room"),
     req.user.id, req.user.name, str(d.name, 160, "").trim(),
     str(d.format, 20, "Solo"), size, d.squadSize ? int(d.squadSize) : null,
     JSON.stringify(langs), JSON.stringify(topics), JSON.stringify(questionIds),
     Math.max(1, Math.min(600, int(d.durationMin) || 60)), d.timePerQ ? int(d.timePerQ) : null,
     visibility, visibility === "Private" ? inviteCode() : null,
     prizePoolPaise, entryFeePaise, d.tournamentMode ? 1 : 0, Math.max(5, int(d.snapshotSecs) || 25),
     isTourney && !funded ? "draft" : (d.publish ? "open" : "draft"),
     d.startTime ? int(d.startTime) : null,
     str(d.prizePreset, 30, "") || null, d.split ? JSON.stringify(d.split) : null,
     Math.max(1, int(d.minPlayers) || 2), funded ? 1 : 0,
     JSON.stringify(d.org && typeof d.org === "object" ? d.org : (req.user.org || null)), now()]
  );

  // The host is in the room they just made.
  await D.joinRoom(id, req.user.id);
  res.status(201).json({ ok: true, room: await D.getRoomFull(id) });
}));

/* ---------- read one ---------- */
router.get("/:id", auth.optional, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  const viewerIsPlayer = !!(req.user && room.players.some(p => p.userId === req.user.id));
  const isHost = !!(req.user && req.user.id === room.hostId);
  const out = Object.assign({}, room);
  if (out.visibility === "Private" && !viewerIsPlayer && !isHost && !(req.user && req.user.isAdmin)) {
    forbidden("That room is private. Ask the host for the invite code.");
  }
  if (!viewerIsPlayer && !isHost && !(req.user && req.user.isAdmin)) out.inviteCode = null;
  res.json({ ok: true, room: out });
}));

router.get("/code/:code", auth.optional, wrap(async (req, res) => {
  const row = await db.one("SELECT id FROM rooms WHERE invite_code = ?", [String(req.params.code).trim().toUpperCase()]);
  if (!row) notFound("No room uses that code.");
  res.json({ ok: true, room: await D.getRoomFull(row.id) });
}));

/* ---------- join / leave ---------- */
router.post("/:id/join", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  const paid = !room.entryFeePaise ||
    !!(await db.one("SELECT id FROM payments WHERE room_id = ? AND user_id = ? AND kind = 'entry' AND status IN ('escrow','released')", [room.id, req.user.id]));
  if (!paid) throw new HttpError(402, "This room has an entry fee. Pay it to take a seat.", { entryFeePaise: room.entryFeePaise });

  const result = await D.joinRoom(room.id, req.user.id);
  res.json({ ok: true, already: !!result.already, room: result.room });
}));

router.post("/:id/leave", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.status === "live" && room.tournamentMode) forbidden("You can't leave a proctored match once it's running.");
  await D.leaveRoom(room.id, req.user.id);
  res.json({ ok: true, room: await D.getRoomFull(room.id) });
}));

/* ---------- host controls ---------- */
router.patch("/:id", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host can change this room.");
  if (room.status === "live" || room.status === "ended") throw new HttpError(409, "That room is already running or finished.");

  const patch = req.body || {};
  const sets = [], params = [];
  const simple = { name: "name", format: "format", visibility: "visibility", prizePreset: "prize_preset" };
  for (const k of Object.keys(simple)) {
    if (patch[k] !== undefined) { sets.push(`${simple[k]} = ?`); params.push(str(patch[k], 160, "")); }
  }
  if (patch.org !== undefined) { sets.push("org = ?"); params.push(JSON.stringify(patch.org && typeof patch.org === "object" ? patch.org : null)); }
  const nums = { size: "size", durationMin: "duration_min", timePerQ: "time_per_q", snapshotSecs: "snapshot_secs", minPlayers: "min_players", entryFeePaise: "entry_fee_paise", prizePoolPaise: "prize_pool_paise" };
  for (const k of Object.keys(nums)) {
    if (patch[k] !== undefined && patch[k] !== null) { sets.push(`${nums[k]} = ?`); params.push(int(patch[k])); }
  }
  if (Array.isArray(patch.langs)) { sets.push("langs = ?"); params.push(JSON.stringify(patch.langs)); }
  if (Array.isArray(patch.topics)) { sets.push("topics = ?"); params.push(JSON.stringify(patch.topics)); }
  if (Array.isArray(patch.questionIds)) { sets.push("question_ids = ?"); params.push(JSON.stringify(patch.questionIds)); }
  if (patch.split) { sets.push("split = ?"); params.push(JSON.stringify(patch.split)); }
  if (patch.status) { sets.push("status = ?"); params.push(str(patch.status, 12, "")); }
  if (!sets.length) bad("Nothing to update.");

  params.push(room.id);
  await db.run(`UPDATE rooms SET ${sets.join(", ")} WHERE id = ?`, params);
  if (patch.visibility === "Private" && !room.inviteCode) {
    await db.run("UPDATE rooms SET invite_code = ? WHERE id = ?", [inviteCode(), room.id]);
  }
  res.json({ ok: true, room: await D.getRoomFull(room.id) });
}));

router.post("/:id/start", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host can start this room.");
  if (room.status === "ended") throw new HttpError(409, "That room has already finished.");
  if (room.players.length < room.minPlayers) {
    throw new HttpError(409, `You need at least ${room.minPlayers} players to start. ${room.players.length} so far.`);
  }
  if (room.type === "tournament" && !room.funded) throw new HttpError(409, "Fund the prize pool before starting.");
  await db.run("UPDATE rooms SET status = 'live', start_time = ? WHERE id = ?", [now(), room.id]);
  res.json({ ok: true, room: await D.getRoomFull(room.id) });
}));

router.post("/:id/eliminate", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host can eliminate a player.");
  if (room.status !== "live") throw new HttpError(409, "This room isn't live, so its results can't be changed.");
  const { userId, reason } = req.body || {};
  const p = await D.getPlayer(room.id, userId);
  if (!p) notFound("That player isn't in this room.");
  await db.run("UPDATE room_players SET eliminated = 1, elim_reason = ?, eliminated_at = ?, score = 0 WHERE room_id = ? AND user_id = ?",
    [str(reason, 200, ""), now(), room.id, userId]);
  await D.notify(userId, "eliminated", room.id, str(reason, 200, ""));
  res.json({ ok: true, room: await D.getRoomFull(room.id) });
}));

router.get("/:id/board", wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  res.json({ ok: true, board: D.scoreboard(room.players), status: room.status });
}));

router.post("/:id/finalise", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host can close this room.");
  if (room.resultsLocked) return res.json({ ok: true, board: room.finalBoard || [], alreadyLocked: true });
  const rows = await D.finaliseRoom(room.id);
  res.json({ ok: true, board: rows, room: await D.getRoomFull(room.id) });
}));

/* ---------- disputes ---------- */
router.post("/:id/disputes", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  const reason = String((req.body || {}).reason || "").trim();
  if (reason.length < 10) bad("Give us at least a sentence so an admin can act on it.");
  const id = uid("d");
  await db.run("INSERT INTO disputes (id,room_id,user_id,reason,status,at) VALUES (?,?,?,?, 'open', ?)", [id, room.id, req.user.id, reason.slice(0, 2000), now()]);
  await db.run("UPDATE rooms SET payout_blocked = 1 WHERE id = ?", [room.id]);
  await D.notify(room.hostId, "dispute", room.id, reason.slice(0, 200));
  res.json({ ok: true, dispute: { id, roomId: room.id, userId: req.user.id, reason, status: "open", at: now() } });
}));

module.exports = router;
