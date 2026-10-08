/* Proctoring: tab-lock violations, hard locks, camera gate, snapshots.
   A lock is stored server-side, so refreshing the page cannot reopen a match
   (PRD 6). Snapshot images are written to server/data/snapshots. */

const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const R = require("../lib/repo");
const D = require("../lib/domain");
const auth = require("../lib/auth");
const config = require("../config");
const { uid, now, int, HttpError, notFound, bad, forbidden, wrap } = require("../lib/util");

const router = express.Router();

const VIOLATION_TYPES = ["tab-switch", "blur", "exit-fullscreen", "context-menu", "copy", "cut", "paste", "devtools", "other"];
const MAX_SNAPSHOT_BYTES = 400 * 1024; // a small JPEG from the camera gate

fs.mkdirSync(config.snapshotsDir, { recursive: true });

async function seat(req, roomId) {
  const room = await D.requireRoom(roomId);
  const player = await D.getPlayer(roomId, req.user.id);
  if (!player) throw new HttpError(403, "You're not in that room.");
  return { room, player };
}

router.post("/:roomId/violations", auth.required, wrap(async (req, res) => {
  const { roomId } = req.params;
  const type = VIOLATION_TYPES.includes(req.body && req.body.type) ? req.body.type : "other";
  const { room, player } = await seat(req, roomId);
  if (!room.tournamentMode) return res.json({ ok: true, recorded: false, locked: false, reason: "This room isn't proctored." });

  const id = uid("v");
  await db.run("INSERT INTO violations (id,room_id,user_id,type,at) VALUES (?,?,?,?,?)", [id, roomId, req.user.id, type, now()]);
  const count = int(player.violations) + 1;
  await db.run("UPDATE room_players SET violations = ? WHERE room_id = ? AND user_id = ?", [count, roomId, req.user.id]);

  const reason = `Tab-lock violation: ${type}`;
  await db.run("UPDATE room_players SET locked = 1, lock_reason = ?, locked_at = ? WHERE room_id = ? AND user_id = ?",
    [reason, now(), roomId, req.user.id]);
  await D.notify(room.hostId, "violation", roomId, `${req.user.name} triggered ${type}`);

  res.json({ ok: true, violation: { id, roomId, userId: req.user.id, type, at: now() }, violations: count, locked: true, lockReason: reason });
}));

router.get("/:roomId/violations", auth.required, wrap(async (req, res) => {
  const { room, player } = await seat(req, req.params.roomId);
  const mine = !(room.hostId === req.user.id || req.user.isAdmin);
  const rows = mine
    ? await db.q("SELECT * FROM violations WHERE room_id = ? AND user_id = ? ORDER BY at", [room.id, req.user.id])
    : await db.q("SELECT * FROM violations WHERE room_id = ? ORDER BY at", [room.id]);
  res.json({ ok: true, violations: rows.map(R.shapeViolation), locked: !!player.locked, lockReason: player.lockReason || "" });
}));

router.post("/:roomId/lock", auth.required, wrap(async (req, res) => {
  const { roomId } = req.params;
  const room = await D.requireRoom(roomId);
  const isHost = room.hostId === req.user.id || req.user.isAdmin;
  const target = isHost ? String((req.body || {}).userId || req.user.id) : req.user.id;
  if (!isHost && target !== req.user.id) forbidden("Only the host can lock someone else.");
  const reason = String((req.body || {}).reason || "Match locked").slice(0, 200);
  await db.run("UPDATE room_players SET locked = 1, lock_reason = ?, locked_at = ? WHERE room_id = ? AND user_id = ?",
    [reason, now(), roomId, target]);
  res.json({ ok: true, locked: true, userId: target, reason });
}));

router.post("/:roomId/unlock", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.roomId);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host can lift a lock.");
  await db.run("UPDATE room_players SET locked = 0, lock_reason = NULL, locked_at = NULL WHERE room_id = ? AND user_id = ?",
    [room.id, String((req.body || {}).userId)]);
  res.json({ ok: true });
}));

/* ---------- camera gate ---------- */
router.post("/:roomId/camera", auth.required, wrap(async (req, res) => {
  const { room } = await seat(req, req.params.roomId);
  if (!room.tournamentMode) return res.json({ ok: true, camera: "n/a", required: false });
  const state = ["ok", "denied", "pending"].includes((req.body || {}).state) ? req.body.state : "pending";
  await db.run("UPDATE room_players SET camera = ? WHERE room_id = ? AND user_id = ?", [state, room.id, req.user.id]);

  if (state === "ok") {
    const clean = int((await db.one("SELECT COUNT(*) AS c FROM violations WHERE room_id = ? AND user_id = ?", [room.id, req.user.id])).c) === 0;
    if (clean && room.status === "ended") await D.bumpStat(req.user.id, "cleanProctored", 1);
  }
  res.json({ ok: true, camera: state, required: true });
}));

/* ---------- snapshots ---------- */
router.post("/:roomId/snapshots", auth.required, express.json({ limit: "1mb" }), wrap(async (req, res) => {
  const { room } = await seat(req, req.params.roomId);
  if (!room.tournamentMode) return res.json({ ok: true, stored: false, reason: "This room isn't proctored." });

  const dataUrl = String((req.body || {}).image || "");
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) bad("Snapshot must be a jpeg/png/webp data URL.");
  const buf = Buffer.from(match[2], "base64");
  if (buf.length > MAX_SNAPSHOT_BYTES) bad("Snapshot is too large.");

  const id = uid("snap");
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const file = path.join(config.snapshotsDir, `${room.id}_${req.user.id}_${id}.${ext}`);
  fs.writeFileSync(file, buf);
  await db.run("INSERT INTO snapshots (id,room_id,user_id,path,at) VALUES (?,?,?,?,?)", [id, room.id, req.user.id, path.basename(file), now()]);

  const count = int((await db.one("SELECT COUNT(*) AS c FROM snapshots WHERE room_id = ?", [room.id])).c);
  res.json({ ok: true, stored: true, id, snapshots: count });
}));

router.get("/:roomId/snapshots", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.roomId);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host can review snapshots.");
  const rows = await db.q("SELECT * FROM snapshots WHERE room_id = ? ORDER BY at DESC LIMIT 100", [room.id]);
  res.json({ ok: true, snapshots: rows.map(s => ({ id: s.id, userId: s.user_id, at: int(s.at), path: s.path })) });
}));

/* The host reviews real frames, so serve them back — never publicly. */
router.get("/:roomId/snapshots/:snapId", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.roomId);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host can review snapshots.");
  const row = await db.one("SELECT * FROM snapshots WHERE id = ? AND room_id = ?", [req.params.snapId, room.id]);
  if (!row) notFound("No snapshot with that id.");
  const file = path.join(config.snapshotsDir, path.basename(row.path));
  if (!fs.existsSync(file)) notFound("That image is no longer on disk.");
  const ext = path.extname(file).slice(1).toLowerCase();
  res.type(ext === "jpg" ? "jpeg" : ext).send(fs.readFileSync(file));
}));

module.exports = router;
