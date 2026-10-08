/* Row <-> object mapping. The API returns exactly the shapes the front-end
   store already used, so pages need no structural changes once they hydrate
   from the server. */

const { int } = require("./util");

function shapePlayer(r) {
  return {
    userId: r.user_id, name: r.name, username: r.username,
    joinedAt: int(r.joined_at), score: int(r.score), solved: r.solved || [],
    eliminated: !!r.eliminated, elimReason: r.elim_reason || "", eliminatedAt: r.eliminated_at ? int(r.eliminated_at) : null,
    violations: int(r.violations), camera: r.camera || "n/a",
    lastCorrectAt: r.last_correct_at ? int(r.last_correct_at) : null,
    locked: !!r.locked, lockReason: r.lock_reason || "", lockedAt: r.locked_at ? int(r.locked_at) : null
  };
}

function shapeRoom(r, players) {
  return {
    id: r.id, type: r.type, hostId: r.host_id, hostName: r.host_name, name: r.name,
    format: r.format, size: int(r.size), squadSize: r.squad_size ? int(r.squad_size) : null,
    langs: r.langs || [], topics: r.topics || [], questionIds: r.question_ids || [],
    durationMin: int(r.duration_min), timePerQ: r.time_per_q ? int(r.time_per_q) : null,
    visibility: r.visibility, inviteCode: r.invite_code || null,
    prizePoolPaise: int(r.prize_pool_paise), entryFeePaise: int(r.entry_fee_paise),
    tournamentMode: !!r.tournament_mode, snapshotSecs: int(r.snapshot_secs),
    status: r.status, startTime: r.start_time ? int(r.start_time) : null,
    players: players || [], platform: !!r.platform,
    prizePreset: r.prize_preset || null, split: r.split || null, minPlayers: int(r.min_players),
    funded: !!r.funded, org: r.org || null, resultsLocked: !!r.results_locked,
    payoutBlocked: !!r.payout_blocked, finalBoard: r.final_board || null,
    createdAt: int(r.created_at)
  };
}

/* Public question view: hidden test cases and the editorial approach stay server-side. */
function shapeQuestionPublic(r) {
  return {
    id: r.id, title: r.title, topics: r.topics || [], difficulty: r.difficulty,
    points: int(r.points), timeLimitMin: int(r.time_limit_min), memoryLimitMB: int(r.memory_limit_mb),
    languages: r.languages || [], statement: r.statement, samples: r.samples || [],
    sig: r.sig || null, hint: r.hint || "", unordered: !!r.unordered,
    starters: r.starters || {}, custom: !!r.custom, retired: !!r.retired,
    updatedAt: int(r.updated_at),
    caseCount: Array.isArray(r.cases) ? r.cases.length : 0
  };
}

/* Admin view adds the hidden tests + approach. */
function shapeQuestionAdmin(r) {
  return Object.assign(shapeQuestionPublic(r), {
    cases: r.cases || [], approach: r.approach || ""
  });
}

const shapeBook = r => ({
  id: r.id, title: r.title, author: r.author, subject: r.subject, licence: r.licence, url: r.url,
  status: r.status, submittedBy: r.submitted_by || null, note: r.note || "",
  createdAt: int(r.created_at), decidedAt: r.decided_at ? int(r.decided_at) : null
});

const shapeAchievement = r => ({
  id: r.id, name: r.name, desc: r.descr, metric: r.metric, target: int(r.target), icon: r.icon
});

const shapeMistake = r => ({
  id: r.id, userId: r.user_id, questionId: r.question_id, roomId: r.room_id || null,
  lastCode: r.last_code || "", failingCase: r.failing_case || null,
  solved: !!r.solved, solvedAt: r.solved_at ? int(r.solved_at) : null, at: int(r.at)
});

const shapeSubmission = r => ({
  id: r.id, roomId: r.room_id, userId: r.user_id, questionId: r.question_id,
  lang: r.lang, code: r.code, passed: int(r.passed), total: int(r.total), ok: !!r.ok,
  timeMs: int(r.time_ms), simulated: !!r.simulated, at: int(r.at)
});

const shapeViolation = r => ({ id: r.id, roomId: r.room_id, userId: r.user_id, type: r.type, at: int(r.at) });

const shapeDispute = r => ({
  id: r.id, roomId: r.room_id, userId: r.user_id, reason: r.reason,
  status: r.status, resolution: r.resolution || "", at: int(r.at)
});

const shapeLedger = r => ({
  id: r.id, userId: r.user_id || null, type: r.type, amountPaise: int(r.amount_paise),
  note: r.note, roomId: r.room_id || null, at: int(r.at)
});

const shapePayment = r => ({
  id: r.id, roomId: r.room_id, userId: r.user_id, amountPaise: int(r.amount_paise),
  kind: r.kind, status: r.status, at: int(r.at)
});

const shapePayout = r => ({
  id: r.id, roomId: r.room_id, userId: r.user_id, amountPaise: int(r.amount_paise),
  rank: int(r.finish_rank), status: r.status, at: int(r.at)
});

const shapeNotification = r => ({
  id: r.id, userId: r.user_id, type: r.type, roomId: r.room_id || null, reason: r.reason || "", at: int(r.at)
});

module.exports = {
  shapePlayer, shapeRoom, shapeQuestionPublic, shapeQuestionAdmin, shapeBook,
  shapeAchievement, shapeMistake, shapeSubmission, shapeViolation, shapeDispute,
  shapeLedger, shapePayment, shapePayout, shapeNotification
};
