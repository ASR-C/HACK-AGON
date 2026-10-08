/* Domain logic that touches several tables at once: rooms, scoring, money,
   achievements. Kept out of the route files so the rules live in one place. */

const db = require("../db");
const R = require("./repo");
const { judge } = require("./judge");
const { uid, now, int, platformFee, HttpError, notFound } = require("./util");

const FRESH_STATS = {
  roomsPlayed: 0, roomsWon: 0, tournamentsWon: 0, duelsWon: 0,
  perfectRooms: 0, cleanProctored: 0, mistakesSolved: 0, rating: 0
};

/* ---------- rooms ---------- */
async function playersOf(roomId) {
  const rows = await db.q("SELECT * FROM room_players WHERE room_id = ? ORDER BY joined_at ASC", [roomId]);
  return rows.map(R.shapePlayer);
}

async function getRoomFull(id) {
  const row = await db.one("SELECT * FROM rooms WHERE id = ?", [id]);
  if (!row) return null;
  return R.shapeRoom(row, await playersOf(id));
}

async function getRoomRow(id) {
  return db.one("SELECT * FROM rooms WHERE id = ?", [id]);
}

async function requireRoom(id) {
  const room = await getRoomFull(id);
  if (!room) notFound("No room with that id.");
  return room;
}

async function listRooms(f = {}) {
  const where = [];
  const params = [];
  if (f.type) { where.push("type = ?"); params.push(f.type); }
  if (f.status) {
    const list = [].concat(f.status);
    where.push(`status IN (${list.map(() => "?").join(",")})`);
    params.push(...list);
  }
  if (f.hostId) { where.push("host_id = ?"); params.push(f.hostId); }
  if (f.q) { where.push("LOWER(name) LIKE ?"); params.push("%" + String(f.q).toLowerCase() + "%"); }
  if (f.topic) { where.push("JSON_CONTAINS(topics, ?)"); params.push(JSON.stringify(f.topic)); }
  if (f.lang) { where.push("JSON_CONTAINS(langs, ?)"); params.push(JSON.stringify(f.lang)); }
  if (f.visibility) { where.push("visibility = ?"); params.push(f.visibility); }

  const sql = "SELECT * FROM rooms" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY created_at DESC LIMIT 200";
  const rows = await db.q(sql, params);
  if (!rows.length) return [];

  const ids = rows.map(r => r.id);
  const players = await db.q(`SELECT * FROM room_players WHERE room_id IN (${ids.map(() => "?").join(",")}) ORDER BY joined_at ASC`, ids);
  const byRoom = new Map();
  players.forEach(p => {
    if (!byRoom.has(p.room_id)) byRoom.set(p.room_id, []);
    byRoom.get(p.room_id).push(R.shapePlayer(p));
  });
  return rows.map(r => R.shapeRoom(r, byRoom.get(r.id) || []));
}

async function getPlayer(roomId, userId) {
  const row = await db.one("SELECT * FROM room_players WHERE room_id = ? AND user_id = ?", [roomId, userId]);
  return row ? R.shapePlayer(row) : null;
}

async function joinRoom(roomId, userId) {
  const room = await requireRoom(roomId);
  const user = await db.one("SELECT id,name,username,verified FROM users WHERE id = ?", [userId]);
  if (!user) throw new HttpError(404, "No account with that id.");
  const existing = await getPlayer(roomId, userId);
  if (existing) return { ok: true, already: true, room };
  if (room.players.length >= room.size) throw new HttpError(409, "That room is full.");
  if (room.status === "ended") throw new HttpError(409, "That room has already finished.");

  await db.run(
    `INSERT INTO room_players (room_id,user_id,name,username,joined_at,score,solved,eliminated,violations,camera)
     VALUES (?,?,?,?,?,0,'[]',0,0,?)`,
    [roomId, userId, user.name, user.username, now(), room.tournamentMode ? "pending" : "n/a"]
  );
  return { ok: true, room: await getRoomFull(roomId) };
}

async function leaveRoom(roomId, userId) {
  await db.run("DELETE FROM room_players WHERE room_id = ? AND user_id = ?", [roomId, userId]);
}

/* ---------- questions ---------- */
async function getQuestionRow(id, { includeHidden = false } = {}) {
  const cols = includeHidden ? "*" : "id,title,topics,difficulty,points,time_limit_min,memory_limit_mb,languages,statement,samples,sig,hint,unordered,starters,custom,retired,updated_at,cases";
  const row = await db.one(`SELECT ${cols} FROM questions WHERE id = ?`, [id]);
  return row;
}

async function listQuestionsPublic(f = {}) {
  const where = ["retired = 0"];
  const params = [];
  if (f.language) { where.push("JSON_CONTAINS(languages, ?)"); params.push(JSON.stringify(f.language)); }
  if (f.topic) { where.push("JSON_CONTAINS(topics, ?)"); params.push(JSON.stringify(f.topic)); }
  if (f.difficulty) { where.push("difficulty = ?"); params.push(f.difficulty); }
  if (f.q) { where.push("(LOWER(title) LIKE ? OR LOWER(CAST(topics AS CHAR)) LIKE ?)"); params.push("%" + f.q.toLowerCase() + "%", "%" + f.q.toLowerCase() + "%"); }
  const rows = await db.q(
    `SELECT id,title,topics,difficulty,points,time_limit_min,memory_limit_mb,languages,statement,samples,sig,hint,unordered,starters,custom,retired,updated_at,cases
     FROM questions WHERE ${where.join(" AND ")} ORDER BY difficulty, title LIMIT 500`, params
  );
  return rows.map(R.shapeQuestionPublic);
}

/* ---------- play: judge, score, mistakes ---------- */
async function recordSubmission(roomId, userId, questionId, lang, code) {
  const qRow = await getQuestionRow(questionId, { includeHidden: true });
  if (!qRow) throw new HttpError(404, "No such question.");
  const q = R.shapeQuestionAdmin(qRow);
  const room = await requireRoom(roomId);

  const verdict = judge(q, lang, code);
  const subId = uid("sub");
  await db.run(
    `INSERT INTO submissions (id,room_id,user_id,question_id,lang,code,passed,total,ok,time_ms,simulated,at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [subId, roomId, userId, questionId, lang, code, verdict.passed, verdict.total, verdict.ok ? 1 : 0, verdict.timeMs, verdict.simulated ? 1 : 0, now()]
  );

  const player = await getPlayer(roomId, userId);
  let updated = null;
  if (player && verdict.ok && !(player.solved || []).includes(questionId)) {
    const elapsedSecs = room.startTime ? (now() - room.startTime) / 1000 : 0;
    const timeBonus = Math.max(0, Math.round((room.durationMin * 60 - elapsedSecs) / 60) * 2);
    const gained = q.points + timeBonus;
    const solved = (player.solved || []).concat(questionId);
    await db.run(
      "UPDATE room_players SET solved = ?, score = score + ?, last_correct_at = ? WHERE room_id = ? AND user_id = ?",
      [JSON.stringify(solved), gained, now(), roomId, userId]
    );
    updated = { gained, score: player.score + gained, solved };
  }

  if (!verdict.ok) {
    const failing = (verdict.results || []).find(x => !x.pass) || null;
    await db.run(
      `INSERT INTO mistakes (id,user_id,question_id,room_id,last_code,failing_case,solved,at)
       VALUES (?,?,?,?,?,?,0,?)
       ON DUPLICATE KEY UPDATE last_code = VALUES(last_code), failing_case = VALUES(failing_case),
                               solved = 0, solved_at = NULL, room_id = VALUES(room_id), at = VALUES(at)`,
      [uid("m"), userId, questionId, roomId, code, JSON.stringify(failing), now()]
    );
  } else {
    const m = await db.one("SELECT * FROM mistakes WHERE user_id = ? AND question_id = ?", [userId, questionId]);
    if (m && !m.solved) {
      await db.run("UPDATE mistakes SET solved = 1, solved_at = ? WHERE id = ?", [now(), m.id]);
      await bumpStat(userId, "mistakesSolved", 1);
    }
  }

  return { submission: R.shapeSubmission(await db.one("SELECT * FROM submissions WHERE id = ?", [subId])), verdict, player: updated, room: await getRoomFull(roomId) };
}

async function bumpStat(userId, key, delta) {
  const row = await db.one("SELECT stats FROM users WHERE id = ?", [userId]);
  if (!row) return null;
  const stats = Object.assign({}, FRESH_STATS, row.stats || {});
  stats[key] = int(stats[key]) + delta;
  await db.run("UPDATE users SET stats = ? WHERE id = ?", [JSON.stringify(stats), userId]);
  return stats;
}

async function setStats(userId, patch) {
  const row = await db.one("SELECT stats FROM users WHERE id = ?", [userId]);
  if (!row) return null;
  const stats = Object.assign({}, FRESH_STATS, row.stats || {}, patch);
  await db.run("UPDATE users SET stats = ? WHERE id = ?", [JSON.stringify(stats), userId]);
  return stats;
}

function scoreboard(players) {
  return (players || []).filter(p => !p.eliminated && !p.locked)
    .slice().sort((a, b) => (b.score - a.score) || ((a.lastCorrectAt || Infinity) - (b.lastCorrectAt || Infinity)))
    .map((p, i) => Object.assign({}, p, { rank: i + 1 }));
}

async function board(roomId) {
  return scoreboard(await playersOf(roomId));
}

/* ---------- results ---------- */
async function finaliseRoom(roomId) {
  const room = await requireRoom(roomId);
  const rows = scoreboard(room.players);
  const top = rows[0];

  for (const row of rows) await bumpStat(row.userId, "roomsPlayed", 1);

  if (top) {
    const patch = { rating: 12 + Math.floor(top.score / 20) };
    if (room.type === "room") patch.roomsWon = 1;
    if (room.format === "Duel") patch.duelsWon = 1;
    if (room.questionIds.length && top.solved.length === room.questionIds.length) patch.perfectRooms = 1;
    await bumpStats(top.userId, patch);
    await recomputeAchievements(top.userId);
  }

  await db.run("UPDATE rooms SET status = 'ended', results_locked = 1, final_board = ? WHERE id = ?", [JSON.stringify(rows), roomId]);
  return rows;
}

async function bumpStats(userId, patch) {
  for (const k of Object.keys(patch)) await bumpStat(userId, k, patch[k]);
}

/* ---------- money ---------- */
async function ledgerAdd(userId, type, amountPaise, note, roomId) {
  const id = uid("led");
  await db.run(
    "INSERT INTO ledger (id,user_id,type,amount_paise,note,room_id,at) VALUES (?,?,?,?,?,?,?)",
    [id, userId || null, type, amountPaise, note, roomId || null, now()]
  );
  return id;
}

async function fundPrize(roomId, payerUserId) {
  const room = await requireRoom(roomId);
  await db.run("INSERT INTO payments (id,room_id,user_id,amount_paise,kind,status,at) VALUES (?,?,?,?,?, 'captured', ?)",
    [uid("pay"), roomId, payerUserId, room.prizePoolPaise, "prize-fund", now()]);
  await ledgerAdd(payerUserId, "prize-fund", -room.prizePoolPaise, "Prize pool funded for " + room.name, roomId);
  await db.run("UPDATE rooms SET funded = 1, status = IF(status = 'draft','open',status) WHERE id = ?", [roomId]);
  return getRoomFull(roomId);
}

async function payEntry(roomId, userId) {
  const room = await requireRoom(roomId);
  if (!room.entryFeePaise) throw new HttpError(400, "This room has no entry fee.");
  await db.run("INSERT INTO payments (id,room_id,user_id,amount_paise,kind,status,at) VALUES (?,?,?,?,?, 'escrow', ?)",
    [uid("pay"), roomId, userId, room.entryFeePaise, "entry", now()]);
  await ledgerAdd(userId, "entry-fee", -room.entryFeePaise, "Entry fee held in escrow: " + room.name, roomId);
  return { ok: true };
}

async function settlePayouts(roomId) {
  const room = await requireRoom(roomId);
  if (room.type !== "tournament" || !room.prizePoolPaise) throw new HttpError(400, "Only funded tournaments settle a prize.");
  if (room.payoutBlocked) throw new HttpError(409, "A dispute is open on this room, so payouts are on hold.");

  const rows = scoreboard(room.players);
  const fee = platformFee(room.prizePoolPaise);
  const net = room.prizePoolPaise - fee;
  const split = room.split && Object.keys(room.split).length ? room.split : { 1: 100 };
  const made = [];

  for (const rankStr of Object.keys(split)) {
    const rank = Number(rankStr);
    const amount = Math.round(net * Number(split[rankStr]) / 100);
    const winner = rows.find(b => b.rank === rank);
    if (!winner || amount <= 0) continue;
    await db.run("INSERT INTO payouts (id,room_id,user_id,amount_paise,finish_rank,status,at) VALUES (?,?,?,?,?, 'paid', ?)",
      [uid("po"), roomId, winner.userId, amount, rank, now()]);
    await ledgerAdd(winner.userId, "prize", amount, `Rank ${rank} prize for ${room.name}`, roomId);
    made.push({ rank, userId: winner.userId, name: winner.name, amountPaise: amount });
    if (rank === 1) await bumpStat(winner.userId, "tournamentsWon", 1);
  }

  await ledgerAdd(null, "platform-fee", fee, `Platform fee (1%) for ${room.name}`, roomId);
  await db.run("UPDATE payments SET status = 'released' WHERE room_id = ? AND kind = 'entry' AND status = 'escrow'", [roomId]);
  await db.run("UPDATE rooms SET status = 'ended', results_locked = 1 WHERE id = ?", [roomId]);
  return { made, fee, net, board: rows };
}

async function refundAll(roomId, reason) {
  const room = await requireRoom(roomId);
  const held = await db.q("SELECT * FROM payments WHERE room_id = ? AND kind = 'entry' AND status = 'escrow'", [roomId]);
  for (const p of held) {
    await db.run("UPDATE payments SET status = 'refunded' WHERE id = ?", [p.id]);
    await ledgerAdd(p.user_id, "refund", int(p.amount_paise), reason || ("Refund: " + room.name), roomId);
  }
  return held.length;
}

async function moneyTotals() {
  const [escrow] = await db.q("SELECT COALESCE(SUM(amount_paise),0) AS s FROM payments WHERE status = 'escrow'");
  const [entries] = await db.q("SELECT COALESCE(SUM(amount_paise),0) AS s FROM payments WHERE kind = 'entry' AND status <> 'refunded'");
  const sumLedger = async type => {
    const [r] = await db.q("SELECT COALESCE(SUM(amount_paise),0) AS s FROM ledger WHERE type = ?", [type]);
    return int(r.s);
  };
  return {
    escrowHeld: int(escrow.s), entriesPaid: int(entries.s),
    prizesPaid: await sumLedger("prize"), refunds: await sumLedger("refund"),
    fees: await sumLedger("platform-fee")
  };
}

/* ---------- achievements ---------- */
async function recomputeAchievements(userId) {
  const user = await db.one("SELECT stats FROM users WHERE id = ?", [userId]);
  if (!user) return [];
  const stats = Object.assign({}, FRESH_STATS, user.stats || {});
  const defs = (await db.q("SELECT * FROM achievements")).map(R.shapeAchievement);
  const state = await db.q("SELECT * FROM ach_state WHERE user_id = ?", [userId]);
  const have = new Map(state.map(s => [s.achievement_id, s]));
  const newly = [];

  for (const a of defs) {
    const progress = Math.min(int(stats[a.metric]), a.target);
    const cur = have.get(a.id);
    if (!cur) {
      await db.run("INSERT INTO ach_state (user_id,achievement_id,progress,unlocked_at) VALUES (?,?,?,?)",
        [userId, a.id, progress, progress >= a.target ? now() : null]);
      if (progress >= a.target) newly.push(a);
    } else if (!cur.unlocked_at && progress >= a.target) {
      await db.run("UPDATE ach_state SET progress = ?, unlocked_at = ? WHERE user_id = ? AND achievement_id = ?", [progress, now(), userId, a.id]);
      newly.push(a);
    } else if (int(cur.progress) !== progress) {
      await db.run("UPDATE ach_state SET progress = ? WHERE user_id = ? AND achievement_id = ?", [progress, userId, a.id]);
    }
  }
  return newly;
}

async function achievementsFor(userId) {
  const defs = (await db.q("SELECT * FROM achievements")).map(R.shapeAchievement);
  const state = userId ? await db.q("SELECT * FROM ach_state WHERE user_id = ?", [userId]) : [];
  const have = new Map(state.map(s => [s.achievement_id, s]));
  let stats = FRESH_STATS;
  if (userId) {
    const u = await db.one("SELECT stats FROM users WHERE id = ?", [userId]);
    if (u) stats = Object.assign({}, FRESH_STATS, u.stats || {});
  }
  return defs.map(a => {
    const s = have.get(a.id);
    const progress = s ? int(s.progress) : 0;
    return Object.assign({}, a, {
      progress, pct: a.target ? Math.round(progress / a.target * 100) : 0,
      unlockedAt: s && s.unlocked_at ? int(s.unlocked_at) : null,
      unlocked: !!(s && s.unlocked_at)
    });
  });
}

/* ---------- notifications ---------- */
async function notify(userId, type, roomId, reason) {
  const id = uid("n");
  await db.run("INSERT INTO notifications (id,user_id,type,room_id,reason,at) VALUES (?,?,?,?,?,?)",
    [id, userId, type, roomId || null, reason || null, now()]);
  return id;
}

module.exports = {
  FRESH_STATS, playersOf, getRoomFull, getRoomRow, requireRoom, listRooms, getPlayer, joinRoom, leaveRoom,
  getQuestionRow, listQuestionsPublic, recordSubmission, scoreboard, board, finaliseRoom,
  bumpStat, bumpStats, setStats, ledgerAdd, fundPrize, payEntry, settlePayouts, refundAll, moneyTotals,
  recomputeAchievements, achievementsFor, notify
};
