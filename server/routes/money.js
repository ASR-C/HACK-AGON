/* Money: prize funding, entry fees held in escrow, settlement with the 1%
   platform fee, refunds, and the ledger. Everything is integer paise.
   No real payment gateway is wired here — charges are recorded as if captured,
   which is what the PRD's Razorpay step will replace. */

const express = require("express");
const db = require("../db");
const R = require("../lib/repo");
const D = require("../lib/domain");
const auth = require("../lib/auth");
const { int, platformFee, HttpError, forbidden, bad, wrap } = require("../lib/util");

const router = express.Router();

router.post("/rooms/:id/fund", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host funds the prize pool.");
  if (!room.prizePoolPaise) bad("This room has no prize pool to fund.");
  if (room.funded) return res.json({ ok: true, already: true, room });
  res.json({ ok: true, room: await D.fundPrize(room.id, req.user.id), gateway: "simulated" });
}));

router.post("/rooms/:id/entry", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (!room.entryFeePaise) bad("This room is free to enter.");
  const existing = await db.one(
    "SELECT id FROM payments WHERE room_id = ? AND user_id = ? AND kind = 'entry' AND status IN ('escrow','released')",
    [room.id, req.user.id]
  );
  if (existing) return res.json({ ok: true, already: true });
  await D.payEntry(room.id, req.user.id);
  await D.joinRoom(room.id, req.user.id);
  res.json({ ok: true, escrowedPaise: room.entryFeePaise, room: await D.getRoomFull(room.id), gateway: "simulated" });
}));

router.post("/rooms/:id/settle", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host settles the prize.");
  res.json({ ok: true, ...(await D.settlePayouts(room.id)) });
}));

router.post("/rooms/:id/refund", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host can refund entries.");
  const n = await D.refundAll(room.id, String((req.body || {}).reason || "").slice(0, 200));
  res.json({ ok: true, refunded: n });
}));

/* The host sees their own room's money; the platform-wide view stays admin-only. */
router.get("/rooms/:id/summary", auth.required, wrap(async (req, res) => {
  const room = await D.requireRoom(req.params.id);
  if (room.hostId !== req.user.id && !req.user.isAdmin) forbidden("Only the host sees this room's money.");

  const sum = async (where, params) => int((await db.one(`SELECT COALESCE(SUM(amount_paise),0) AS t FROM payments WHERE ${where}`, params)).t);
  const escrowPaise = await sum("room_id = ? AND kind = 'entry' AND status = 'escrow'", [room.id]);
  const releasedPaise = await sum("room_id = ? AND kind = 'entry' AND status = 'released'", [room.id]);
  const refundedPaise = await sum("room_id = ? AND status = 'refunded'", [room.id]);
  const entries = int((await db.one(
    "SELECT COUNT(*) AS c FROM payments WHERE room_id = ? AND kind = 'entry' AND status IN ('escrow','released')", [room.id]
  )).c);
  const payouts = (await db.q("SELECT * FROM payouts WHERE room_id = ? ORDER BY finish_rank", [room.id])).map(R.shapePayout);

  res.json({
    ok: true,
    summary: {
      prizePoolPaise: room.prizePoolPaise, funded: room.funded,
      platformFeePaise: platformFee(room.prizePoolPaise),
      netPrizePaise: Math.max(0, room.prizePoolPaise - platformFee(room.prizePoolPaise)),
      entryFeePaise: room.entryFeePaise, entries, escrowPaise, releasedPaise, refundedPaise,
      payoutBlocked: room.payoutBlocked, payouts
    }
  });
}));

/* my own money */
router.get("/me/ledger", auth.required, wrap(async (req, res) => {
  const rows = await db.q("SELECT * FROM ledger WHERE user_id = ? ORDER BY at DESC LIMIT 200", [req.user.id]);
  const payouts = await db.q("SELECT * FROM payouts WHERE user_id = ? ORDER BY at DESC LIMIT 50", [req.user.id]);
  const payments = await db.q("SELECT * FROM payments WHERE user_id = ? ORDER BY at DESC LIMIT 50", [req.user.id]);
  res.json({
    ok: true,
    ledger: rows.map(R.shapeLedger),
    payouts: payouts.map(R.shapePayout),
    payments: payments.map(R.shapePayment),
    balancePaise: rows.reduce((t, r) => t + int(r.amount_paise), 0)
  });
}));

/* platform-wide oversight — admin only */
router.get("/totals", auth.adminOnly, wrap(async (_req, res) => {
  res.json({ ok: true, totals: await D.moneyTotals() });
}));

router.get("/ledger", auth.adminOnly, wrap(async (req, res) => {
  const limit = Math.min(500, Math.max(1, int(req.query.limit) || 100));
  const rows = await db.q("SELECT * FROM ledger ORDER BY at DESC LIMIT ?", [limit]);
  res.json({ ok: true, ledger: rows.map(R.shapeLedger) });
}));

router.get("/payments", auth.adminOnly, wrap(async (req, res) => {
  const rows = req.query.status
    ? await db.q("SELECT * FROM payments WHERE status = ? ORDER BY at DESC LIMIT 300", [String(req.query.status)])
    : await db.q("SELECT * FROM payments ORDER BY at DESC LIMIT 300");
  res.json({ ok: true, payments: rows.map(R.shapePayment) });
}));

router.get("/payouts", auth.adminOnly, wrap(async (req, res) => {
  const rows = req.query.status
    ? await db.q("SELECT * FROM payouts WHERE status = ? ORDER BY at DESC LIMIT 300", [String(req.query.status)])
    : await db.q("SELECT * FROM payouts ORDER BY at DESC LIMIT 300");
  res.json({ ok: true, payouts: rows.map(R.shapePayout) });
}));

module.exports = router;
