package com.hackagon.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hackagon.util.HttpException;
import com.hackagon.util.IdUtil;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Core domain logic — mirrors domain.js from the Node.js server.
 * All room lifecycle, scoring, money, judge integration, and achievement operations live here.
 */
@Service
public class DomainService {

    private final DatabaseService db;
    private final RepoService repo;
    private final JudgeService judgeService;
    private final ObjectMapper mapper;

    public static final Map<String, Integer> FRESH_STATS = Map.of(
        "roomsPlayed", 0, "roomsWon", 0, "tournamentsWon", 0, "duelsWon", 0,
        "perfectRooms", 0, "cleanProctored", 0, "mistakesSolved", 0, "rating", 0
    );

    public DomainService(DatabaseService db, RepoService repo, JudgeService judgeService, ObjectMapper mapper) {
        this.db = db;
        this.repo = repo;
        this.judgeService = judgeService;
        this.mapper = mapper;
    }

    // ========== players ==========

    public List<Map<String, Object>> playersOf(String roomId) {
        return db.q("SELECT * FROM room_players WHERE room_id = ? ORDER BY joined_at ASC", roomId)
                 .stream().map(repo::shapePlayer).collect(Collectors.toList());
    }

    // ========== rooms ==========

    public Map<String, Object> getRoomFull(String id) {
        Optional<Map<String, Object>> row = db.one("SELECT * FROM rooms WHERE id = ?", id);
        if (row.isEmpty()) return null;
        return repo.shapeRoom(row.get(), playersOf(id));
    }

    public Map<String, Object> requireRoom(String id) {
        Map<String, Object> room = getRoomFull(id);
        if (room == null) throw HttpException.notFound("No room with that id.");
        return room;
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> listRooms(Map<String, Object> f) {
        List<String> where = new ArrayList<>();
        List<Object> params = new ArrayList<>();

        if (f.containsKey("type")) { where.add("type = ?"); params.add(f.get("type")); }
        if (f.containsKey("status")) {
            Object s = f.get("status");
            List<String> statuses = s instanceof List ? (List<String>) s : List.of(s.toString());
            String placeholders = statuses.stream().map(x -> "?").collect(Collectors.joining(","));
            where.add("status IN (" + placeholders + ")");
            params.addAll(statuses);
        }
        if (f.containsKey("hostId")) { where.add("host_id = ?"); params.add(f.get("hostId")); }
        if (f.containsKey("q"))      { where.add("LOWER(name) LIKE ?"); params.add("%" + f.get("q").toString().toLowerCase() + "%"); }
        if (f.containsKey("topic"))  { where.add("JSON_CONTAINS(topics, ?)"); params.add("\"" + f.get("topic") + "\""); }
        if (f.containsKey("lang"))   { where.add("JSON_CONTAINS(langs, ?)"); params.add("\"" + f.get("lang") + "\""); }
        if (f.containsKey("visibility")) { where.add("visibility = ?"); params.add(f.get("visibility")); }

        String sql = "SELECT * FROM rooms" + (where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where)) + " ORDER BY created_at DESC LIMIT 200";
        List<Map<String, Object>> rows = db.q(sql, params.toArray());
        if (rows.isEmpty()) return new ArrayList<>();

        List<String> ids = rows.stream().map(r -> r.get("id").toString()).collect(Collectors.toList());
        String inClause = ids.stream().map(x -> "?").collect(Collectors.joining(","));
        List<Map<String, Object>> allPlayers = db.q(
            "SELECT * FROM room_players WHERE room_id IN (" + inClause + ") ORDER BY joined_at ASC", ids.toArray());

        Map<String, List<Map<String, Object>>> byRoom = new HashMap<>();
        for (Map<String, Object> p : allPlayers) {
            String rid = p.get("room_id").toString();
            byRoom.computeIfAbsent(rid, k -> new ArrayList<>()).add(repo.shapePlayer(p));
        }
        return rows.stream().map(r -> repo.shapeRoom(r, byRoom.getOrDefault(r.get("id").toString(), new ArrayList<>())))
                   .collect(Collectors.toList());
    }

    public Optional<Map<String, Object>> getPlayer(String roomId, String userId) {
        return db.one("SELECT * FROM room_players WHERE room_id = ? AND user_id = ?", roomId, userId)
                 .map(repo::shapePlayer);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> joinRoom(String roomId, String userId) {
        Map<String, Object> room = requireRoom(roomId);
        Optional<Map<String, Object>> user = db.one("SELECT id,name,username,verified FROM users WHERE id = ?", userId);
        if (user.isEmpty()) throw HttpException.notFound("No account with that id.");

        Optional<Map<String, Object>> existing = getPlayer(roomId, userId);
        if (existing.isPresent()) return Map.of("ok", true, "already", true, "room", room);

        List<Map<String, Object>> players = (List<Map<String, Object>>) room.get("players");
        long size = ((Number) room.get("size")).longValue();
        if (players.size() >= size) throw HttpException.conflict("That room is full.");
        if ("ended".equals(room.get("status"))) throw HttpException.conflict("That room has already finished.");

        String camera = Boolean.TRUE.equals(room.get("tournamentMode")) ? "pending" : "n/a";
        db.run("INSERT INTO room_players (room_id,user_id,name,username,joined_at,score,solved,eliminated,violations,camera) VALUES (?,?,?,?,?,0,'[]',0,0,?)",
               roomId, userId, user.get().get("name"), user.get().get("username"), IdUtil.now(), camera);

        return Map.of("ok", true, "room", getRoomFull(roomId));
    }

    public void leaveRoom(String roomId, String userId) {
        db.run("DELETE FROM room_players WHERE room_id = ? AND user_id = ?", roomId, userId);
    }

    // ========== questions ==========

    public Optional<Map<String, Object>> getQuestionRow(String id, boolean includeHidden) {
        String cols = includeHidden ? "*" : "id,title,topics,difficulty,points,time_limit_min,memory_limit_mb,languages,statement,samples,sig,hint,unordered,starters,custom,retired,updated_at,cases,approach";
        return db.one("SELECT " + cols + " FROM questions WHERE id = ?", id);
    }

    public List<Map<String, Object>> listQuestionsPublic(Map<String, String> f) {
        List<String> where = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        where.add("retired = 0");

        if (f.containsKey("language")) { where.add("JSON_CONTAINS(languages, ?)"); params.add("\"" + f.get("language") + "\""); }
        if (f.containsKey("topic"))    { where.add("JSON_CONTAINS(topics, ?)"); params.add("\"" + f.get("topic") + "\""); }
        if (f.containsKey("difficulty")) { where.add("difficulty = ?"); params.add(f.get("difficulty")); }
        if (f.containsKey("q") && !f.get("q").isBlank()) {
            where.add("(LOWER(title) LIKE ? OR LOWER(CAST(topics AS CHAR)) LIKE ?)");
            params.add("%" + f.get("q").toLowerCase() + "%");
            params.add("%" + f.get("q").toLowerCase() + "%");
        }

        String sql = "SELECT id,title,topics,difficulty,points,time_limit_min,memory_limit_mb,languages,statement,samples,sig,hint,unordered,starters,custom,retired,updated_at,cases,approach FROM questions WHERE " +
                     String.join(" AND ", where) + " ORDER BY difficulty, title LIMIT 500";
        return db.q(sql, params.toArray()).stream().map(repo::shapeQuestionPublic).collect(Collectors.toList());
    }

    // ========== scoring & submissions ==========

    public List<Map<String, Object>> scoreboard(List<Map<String, Object>> players) {
        List<Map<String, Object>> active = players.stream()
            .filter(p -> !Boolean.TRUE.equals(p.get("eliminated")) && !Boolean.TRUE.equals(p.get("locked")))
            .sorted(Comparator
                .<Map<String, Object>>comparingLong(p -> -((Number) p.get("score")).longValue())
                .thenComparingLong(p -> p.get("lastCorrectAt") != null
                    ? ((Number) p.get("lastCorrectAt")).longValue()
                    : Long.MAX_VALUE))
            .collect(Collectors.toList());
        List<Map<String, Object>> ranked = new ArrayList<>();
        for (int i = 0; i < active.size(); i++) {
            Map<String, Object> row = new LinkedHashMap<>(active.get(i));
            row.put("rank", i + 1);
            ranked.add(row);
        }
        return ranked;
    }

    public List<Map<String, Object>> board(String roomId) {
        return scoreboard(playersOf(roomId));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> recordSubmission(String roomId, String userId, String questionId, String lang, String code) {
        Optional<Map<String, Object>> qRow = getQuestionRow(questionId, true);
        if (qRow.isEmpty()) throw HttpException.notFound("No such question.");
        Map<String, Object> q = repo.shapeQuestionAdmin(qRow.get());
        Map<String, Object> room = requireRoom(roomId);

        Map<String, Object> verdict = judgeService.judge(q, lang, code);
        String subId = IdUtil.uid("sub");
        boolean ok = Boolean.TRUE.equals(verdict.get("ok"));
        long passed = ((Number) verdict.get("passed")).longValue();
        long total = ((Number) verdict.get("total")).longValue();
        long timeMs = ((Number) verdict.get("timeMs")).longValue();
        boolean simulated = Boolean.TRUE.equals(verdict.get("simulated"));

        db.run(
            "INSERT INTO submissions (id,room_id,user_id,question_id,lang,code,passed,total,ok,time_ms,simulated,at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            subId, roomId, userId, questionId, lang, code, passed, total, ok ? 1 : 0, timeMs, simulated ? 1 : 0, IdUtil.now()
        );

        Optional<Map<String, Object>> playerOpt = getPlayer(roomId, userId);
        Map<String, Object> updated = null;

        if (playerOpt.isPresent()) {
            Map<String, Object> player = playerOpt.get();
            List<String> solved = (List<String>) player.getOrDefault("solved", new ArrayList<>());
            if (ok && !solved.contains(questionId)) {
                long startTime = room.get("startTime") != null ? ((Number) room.get("startTime")).longValue() : 0L;
                double elapsedSecs = startTime > 0 ? (IdUtil.now() - startTime) / 1000.0 : 0;
                long durMin = ((Number) room.get("durationMin")).longValue();
                long timeBonus = Math.max(0, Math.round((durMin * 60 - elapsedSecs) / 60) * 2);
                long points = ((Number) q.get("points")).longValue();
                long gained = points + timeBonus;
                List<String> newSolved = new ArrayList<>(solved);
                newSolved.add(questionId);
                long newScore = ((Number) player.get("score")).longValue() + gained;

                try {
                    String solvedJson = mapper.writeValueAsString(newSolved);
                    db.run("UPDATE room_players SET solved = ?, score = score + ?, last_correct_at = ? WHERE room_id = ? AND user_id = ?",
                           solvedJson, gained, IdUtil.now(), roomId, userId);
                    updated = Map.of("gained", gained, "score", newScore, "solved", newSolved);
                } catch (Exception ignored) {}
            }
        }

        if (!ok) {
            List<Map<String, Object>> results = (List<Map<String, Object>>) verdict.get("results");
            Map<String, Object> failing = results != null ? results.stream().filter(r -> !Boolean.TRUE.equals(r.get("pass"))).findFirst().orElse(null) : null;
            String failingJson;
            try { failingJson = mapper.writeValueAsString(failing); } catch (Exception e) { failingJson = "null"; }
            db.run(
                "INSERT INTO mistakes (id,user_id,question_id,room_id,last_code,failing_case,solved,at) VALUES (?,?,?,?,?,?,0,?) " +
                "ON DUPLICATE KEY UPDATE last_code = VALUES(last_code), failing_case = VALUES(failing_case), solved = 0, solved_at = NULL, room_id = VALUES(room_id), at = VALUES(at)",
                IdUtil.uid("m"), userId, questionId, roomId, code, failingJson, IdUtil.now()
            );
        } else {
            Optional<Map<String, Object>> m = db.one("SELECT * FROM mistakes WHERE user_id = ? AND question_id = ?", userId, questionId);
            if (m.isPresent() && !Boolean.TRUE.equals(m.get().get("solved"))) {
                db.run("UPDATE mistakes SET solved = 1, solved_at = ? WHERE id = ?", IdUtil.now(), m.get().get("id"));
                bumpStat(userId, "mistakesSolved", 1);
            }
        }

        Map<String, Object> subMap = db.one("SELECT * FROM submissions WHERE id = ?", subId).map(repo::shapeSubmission).orElse(Map.of());
        return Map.of("submission", subMap, "verdict", verdict, "player", updated != null ? updated : Map.of(), "room", getRoomFull(roomId));
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> finaliseRoom(String roomId) {
        Map<String, Object> room = requireRoom(roomId);
        List<Map<String, Object>> players = (List<Map<String, Object>>) room.get("players");
        List<Map<String, Object>> ranked = scoreboard(players);

        for (Map<String, Object> row : ranked) bumpStat((String) row.get("userId"), "roomsPlayed", 1);

        if (!ranked.isEmpty()) {
            Map<String, Object> top = ranked.get(0);
            String topId = (String) top.get("userId");
            bumpStat(topId, "rating", 12 + Math.max(0, (int)(((Number)top.get("score")).longValue() / 20)));
            if ("room".equals(room.get("type"))) bumpStat(topId, "roomsWon", 1);
            if ("Duel".equals(room.get("format"))) bumpStat(topId, "duelsWon", 1);
            List<Object> qIds = (List<Object>) room.get("questionIds");
            List<Object> solved = (List<Object>) top.get("solved");
            if (qIds != null && solved != null && solved.size() >= qIds.size())
                bumpStat(topId, "perfectRooms", 1);
            recomputeAchievements(topId);
        }

        String boardJson;
        try { boardJson = mapper.writeValueAsString(ranked); }
        catch (Exception e) { boardJson = "[]"; }

        db.run("UPDATE rooms SET status = 'ended', results_locked = 1, final_board = ? WHERE id = ?", boardJson, roomId);
        return ranked;
    }

    // ========== stats & achievements ==========

    public void bumpStat(String userId, String key, long delta) {
        Optional<Map<String, Object>> row = db.one("SELECT stats FROM users WHERE id = ?", userId);
        if (row.isEmpty()) return;
        Map<String, Object> stats = mergeStats(row.get().get("stats"));
        long cur = stats.get(key) != null ? ((Number) stats.get(key)).longValue() : 0L;
        stats.put(key, cur + delta);
        try {
            String json = mapper.writeValueAsString(stats);
            db.run("UPDATE users SET stats = ? WHERE id = ?", json, userId);
        } catch (Exception ignored) {}
    }

    public void bumpStats(String userId, Map<String, Object> patch) {
        patch.forEach((k, v) -> {
            if (v instanceof Number n) bumpStat(userId, k, n.longValue());
        });
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> mergeStats(Object raw) {
        Map<String, Object> base = new LinkedHashMap<>(FRESH_STATS);
        if (raw instanceof String s && !s.isBlank()) {
            try {
                Map<String, Object> parsed = mapper.readValue(s, new TypeReference<Map<String, Object>>(){});
                base.putAll(parsed);
            } catch (Exception ignored) {}
        }
        return base;
    }

    public List<Map<String, Object>> recomputeAchievements(String userId) {
        Optional<Map<String, Object>> user = db.one("SELECT stats FROM users WHERE id = ?", userId);
        if (user.isEmpty()) return new ArrayList<>();
        Map<String, Object> stats = mergeStats(user.get().get("stats"));
        List<Map<String, Object>> defs = db.q("SELECT * FROM achievements").stream().map(repo::shapeAchievement).collect(Collectors.toList());
        List<Map<String, Object>> state = db.q("SELECT * FROM ach_state WHERE user_id = ?", userId);
        Map<String, Map<String, Object>> have = state.stream().collect(Collectors.toMap(s -> s.get("achievement_id").toString(), s -> s, (a, b) -> a));

        List<Map<String, Object>> newly = new ArrayList<>();
        for (Map<String, Object> a : defs) {
            String id = (String) a.get("id");
            String metric = (String) a.get("metric");
            long target = ((Number) a.get("target")).longValue();
            long currentVal = stats.get(metric) != null ? ((Number) stats.get(metric)).longValue() : 0L;
            long progress = Math.min(currentVal, target);
            Map<String, Object> cur = have.get(id);

            if (cur == null) {
                db.run("INSERT INTO ach_state (user_id,achievement_id,progress,unlocked_at) VALUES (?,?,?,?)",
                       userId, id, progress, progress >= target ? IdUtil.now() : null);
                if (progress >= target) newly.add(a);
            } else if (cur.get("unlocked_at") == null && progress >= target) {
                db.run("UPDATE ach_state SET progress = ?, unlocked_at = ? WHERE user_id = ? AND achievement_id = ?",
                       progress, IdUtil.now(), userId, id);
                newly.add(a);
            } else if (((Number) cur.get("progress")).longValue() != progress) {
                db.run("UPDATE ach_state SET progress = ? WHERE user_id = ? AND achievement_id = ?",
                       progress, userId, id);
            }
        }
        return newly;
    }

    public List<Map<String, Object>> achievementsFor(String userId) {
        List<Map<String, Object>> defs = db.q("SELECT * FROM achievements").stream().map(repo::shapeAchievement).collect(Collectors.toList());
        List<Map<String, Object>> state = userId != null ? db.q("SELECT * FROM ach_state WHERE user_id = ?", userId) : new ArrayList<>();
        Map<String, Map<String, Object>> have = state.stream().collect(Collectors.toMap(s -> s.get("achievement_id").toString(), s -> s, (a, b) -> a));

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> a : defs) {
            Map<String, Object> row = new LinkedHashMap<>(a);
            Map<String, Object> s = have.get(a.get("id").toString());
            long progress = s != null ? ((Number) s.get("progress")).longValue() : 0L;
            long target = ((Number) a.get("target")).longValue();
            row.put("progress", progress);
            row.put("pct", target > 0 ? Math.round((double) progress / target * 100) : 0);
            row.put("unlockedAt", s != null ? s.get("unlocked_at") : null);
            row.put("unlocked", s != null && s.get("unlocked_at") != null);
            result.add(row);
        }
        return result;
    }

    // ========== money ==========

    public void ledgerAdd(String userId, String type, long amountPaise, String note, String roomId) {
        db.run("INSERT INTO ledger (id,user_id,type,amount_paise,note,room_id,at) VALUES (?,?,?,?,?,?,?)",
               IdUtil.uid("led"), userId, type, amountPaise, note, roomId, IdUtil.now());
    }

    public Map<String, Object> fundPrize(String roomId, String payerUserId) {
        Map<String, Object> room = requireRoom(roomId);
        long pool = ((Number) room.get("prizePoolPaise")).longValue();
        db.run("INSERT INTO payments (id,room_id,user_id,amount_paise,kind,status,at) VALUES (?,?,?,?,'prize-fund','captured',?)",
               IdUtil.uid("pay"), roomId, payerUserId, pool, IdUtil.now());
        ledgerAdd(payerUserId, "prize-fund", -pool, "Prize pool funded for " + room.get("name"), roomId);
        db.run("UPDATE rooms SET funded = 1, status = IF(status = 'draft','open',status) WHERE id = ?", roomId);
        return getRoomFull(roomId);
    }

    public void payEntry(String roomId, String userId) {
        Map<String, Object> room = requireRoom(roomId);
        long entryFee = ((Number) room.get("entryFeePaise")).longValue();
        if (entryFee <= 0) throw HttpException.bad("This room has no entry fee.");
        db.run("INSERT INTO payments (id,room_id,user_id,amount_paise,kind,status,at) VALUES (?,?,?,?,'entry','escrow',?)",
               IdUtil.uid("pay"), roomId, userId, entryFee, IdUtil.now());
        ledgerAdd(userId, "entry-fee", -entryFee, "Entry fee held in escrow: " + room.get("name"), roomId);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> settlePayouts(String roomId) {
        Map<String, Object> room = requireRoom(roomId);
        if (!"tournament".equals(room.get("type")) || ((Number) room.get("prizePoolPaise")).longValue() <= 0)
            throw HttpException.bad("Only funded tournaments settle a prize.");
        if (Boolean.TRUE.equals(room.get("payoutBlocked")))
            throw HttpException.conflict("A dispute is open on this room, so payouts are on hold.");

        List<Map<String, Object>> rows = scoreboard((List<Map<String, Object>>) room.get("players"));
        long prizePool = ((Number) room.get("prizePoolPaise")).longValue();
        long fee = IdUtil.platformFee(prizePool);
        long net = prizePool - fee;
        Map<String, Object> split = room.get("split") instanceof Map ? (Map<String, Object>) room.get("split") : Map.of("1", 100);

        List<Map<String, Object>> made = new ArrayList<>();
        for (String rankStr : split.keySet()) {
            int rank = Integer.parseInt(rankStr);
            double pct = Double.parseDouble(split.get(rankStr).toString());
            long amount = Math.round(net * pct / 100.0);
            Map<String, Object> winner = rows.stream().filter(b -> ((Number) b.get("rank")).intValue() == rank).findFirst().orElse(null);
            if (winner == null || amount <= 0) continue;

            String winnerId = (String) winner.get("userId");
            db.run("INSERT INTO payouts (id,room_id,user_id,amount_paise,finish_rank,status,at) VALUES (?,?,?,?,?,'paid',?)",
                   IdUtil.uid("po"), roomId, winnerId, amount, rank, IdUtil.now());
            ledgerAdd(winnerId, "prize", amount, "Rank " + rank + " prize for " + room.get("name"), roomId);
            made.add(Map.of("rank", rank, "userId", winnerId, "name", winner.get("name"), "amountPaise", amount));
            if (rank == 1) bumpStat(winnerId, "tournamentsWon", 1);
        }

        ledgerAdd(null, "platform-fee", fee, "Platform fee (1%) for " + room.get("name"), roomId);
        db.run("UPDATE payments SET status = 'released' WHERE room_id = ? AND kind = 'entry' AND status = 'escrow'", roomId);
        db.run("UPDATE rooms SET status = 'ended', results_locked = 1 WHERE id = ?", roomId);
        return Map.of("made", made, "fee", fee, "net", net, "board", rows);
    }

    public int refundAll(String roomId, String reason) {
        Map<String, Object> room = requireRoom(roomId);
        List<Map<String, Object>> held = db.q("SELECT * FROM payments WHERE room_id = ? AND kind = 'entry' AND status = 'escrow'", roomId);
        for (Map<String, Object> p : held) {
            db.run("UPDATE payments SET status = 'refunded' WHERE id = ?", p.get("id"));
            ledgerAdd((String) p.get("user_id"), "refund", ((Number) p.get("amount_paise")).longValue(),
                      reason != null && !reason.isBlank() ? reason : "Refund: " + room.get("name"), roomId);
        }
        return held.size();
    }

    public Map<String, Object> moneyTotals() {
        Optional<Map<String, Object>> escrow = db.one("SELECT COALESCE(SUM(amount_paise),0) AS s FROM payments WHERE status = 'escrow'");
        Optional<Map<String, Object>> entries = db.one("SELECT COALESCE(SUM(amount_paise),0) AS s FROM payments WHERE kind = 'entry' AND status <> 'refunded'");
        Optional<Map<String, Object>> prizes = db.one("SELECT COALESCE(SUM(amount_paise),0) AS s FROM ledger WHERE type = 'prize'");
        Optional<Map<String, Object>> refunds = db.one("SELECT COALESCE(SUM(amount_paise),0) AS s FROM ledger WHERE type = 'refund'");
        Optional<Map<String, Object>> fees = db.one("SELECT COALESCE(SUM(amount_paise),0) AS s FROM ledger WHERE type = 'platform-fee'");

        long escrowVal = escrow.map(m -> ((Number) m.get("s")).longValue()).orElse(0L);
        long entriesVal = entries.map(m -> ((Number) m.get("s")).longValue()).orElse(0L);
        long prizesVal = prizes.map(m -> ((Number) m.get("s")).longValue()).orElse(0L);
        long refundsVal = refunds.map(m -> ((Number) m.get("s")).longValue()).orElse(0L);
        long feesVal = fees.map(m -> ((Number) m.get("s")).longValue()).orElse(0L);

        return Map.of(
            "escrowHeld", escrowVal,
            "entriesPaid", entriesVal,
            "prizesPaid", prizesVal,
            "refunds", refundsVal,
            "fees", feesVal
        );
    }

    // ========== notifications ==========

    public void notify(String userId, String type, String roomId, String reason) {
        db.run("INSERT INTO notifications (id,user_id,type,room_id,reason,at) VALUES (?,?,?,?,?,?)",
               IdUtil.uid("n"), userId, type, roomId, reason, IdUtil.now());
    }
}
