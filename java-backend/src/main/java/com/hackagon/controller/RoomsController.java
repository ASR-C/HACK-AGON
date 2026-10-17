package com.hackagon.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hackagon.service.DatabaseService;
import com.hackagon.service.DomainService;
import com.hackagon.service.RepoService;
import com.hackagon.util.HttpException;
import com.hackagon.util.IdUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Rooms, duels and tournaments REST controller.
 * Implements all the endpoints from the Node.js routes/rooms.js file.
 *
 * POST /api/rooms              — create room
 * GET  /api/rooms              — list rooms
 * GET  /api/rooms/:id          — get one room
 * GET  /api/rooms/code/:code   — get room by invite code
 * POST /api/rooms/:id/join     — join a room
 * POST /api/rooms/:id/leave    — leave a room
 * PATCH /api/rooms/:id         — host updates room
 * POST /api/rooms/:id/start    — host starts match
 * POST /api/rooms/:id/eliminate — host eliminates player
 * GET  /api/rooms/:id/board    — live scoreboard
 * POST /api/rooms/:id/finalise — lock results
 * POST /api/rooms/:id/disputes — raise dispute
 */
@RestController
@RequestMapping("/api/rooms")
public class RoomsController extends BaseController {

    private final DomainService domain;
    private final RepoService   repo;
    private final ObjectMapper  mapper;

    public RoomsController(DatabaseService db, DomainService domain, RepoService repo, ObjectMapper mapper) {
        super(db);
        this.domain = domain;
        this.repo   = repo;
        this.mapper = mapper;
    }

    // ---------- list ----------

    @GetMapping
    public Map<String, Object> listRooms(@RequestParam Map<String, String> params, HttpServletRequest req) {
        Map<String, Object> f = new HashMap<>();
        if (params.containsKey("type"))   f.put("type", params.get("type"));
        if (params.containsKey("status")) f.put("status", Arrays.asList(params.get("status").split(",")));
        if (params.containsKey("hostId")) f.put("hostId", params.get("hostId"));
        if (params.containsKey("topic"))  f.put("topic", params.get("topic"));
        if (params.containsKey("lang"))   f.put("lang", params.get("lang"));
        if (params.containsKey("q"))      f.put("q", params.get("q"));
        return Map.of("ok", true, "rooms", domain.listRooms(f));
    }

    // ---------- create ----------

    @PostMapping
    public org.springframework.http.ResponseEntity<Map<String, Object>> createRoom(
            @RequestBody Map<String, Object> body, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId  = (String) user.get("id");
        String name    = str(body.get("name"), 200, "").trim();
        if (name.length() < 3) throw HttpException.bad("Give the room a name of 3+ characters.");

        List<String> langs   = asList(body.get("langs"),    "javascript");
        List<String> topics  = asList(body.get("topics"),   null);
        List<String> qIds    = asList(body.get("questionIds"), null);

        // Auto-fill questions from bank if none provided
        if (qIds.isEmpty()) {
            List<Object> wh = new ArrayList<>();
            List<Object> pr = new ArrayList<>();
            if (!topics.isEmpty()) {
                String tClause = topics.stream().map(t -> "JSON_CONTAINS(topics, ?)").collect(Collectors.joining(" OR "));
                wh.add("(" + tClause + ")");
                topics.forEach(t -> pr.add("\"" + t + "\""));
            }
            if (body.containsKey("difficulty")) { wh.add("difficulty = ?"); pr.add(body.get("difficulty")); }
            wh.add("retired = 0");
            String sql = "SELECT id FROM questions WHERE " + String.join(" AND ", wh.stream().map(Object::toString).collect(Collectors.toList())) + " ORDER BY RAND() LIMIT 20";
            qIds = db.q(sql, pr.toArray()).stream().map(r -> r.get("id").toString()).collect(Collectors.toList());
        }
        if (qIds.isEmpty()) throw HttpException.bad("No questions match those filters — widen the topics or pick questions by hand.");

        int size = Math.max(2, Math.min(500, toInt(body.get("size"), 10)));
        long entryFee = Math.max(0, toLong(body.get("entryFeePaise"), 0));
        long prizePool = Math.max(0, toLong(body.get("prizePoolPaise"), 0));
        boolean isTourney = "tournament".equals(body.get("type")) || entryFee > 0 || prizePool > 0;
        String visibility = "Private".equals(body.get("visibility")) ? "Private" : "Public";
        boolean funded    = isTourney ? Boolean.TRUE.equals(body.get("funded")) : true;
        boolean publish   = !Boolean.FALSE.equals(body.get("publish"));

        String roomType = isTourney ? "tournament" : ("duel".equals(body.get("type")) ? "duel" : "room");
        String status   = isTourney && !funded ? "draft" : (publish ? "open" : "draft");
        String invCode  = "Private".equals(visibility) ? IdUtil.inviteCode() : null;

        String id = IdUtil.uid("room");
        try {
            db.run(
                "INSERT INTO rooms (id,type,host_id,host_name,name,format,size,squad_size,langs,topics,question_ids," +
                "duration_min,time_per_q,visibility,invite_code,prize_pool_paise,entry_fee_paise,tournament_mode," +
                "snapshot_secs,status,start_time,platform,prize_preset,split,min_players,funded,org,results_locked," +
                "payout_blocked,final_board,created_at) " +
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,0,0,NULL,?)",
                id, roomType, userId, user.get("name"), name.substring(0, Math.min(name.length(), 160)),
                str(body.get("format"), 20, "Solo"), size,
                body.containsKey("squadSize") ? toInt(body.get("squadSize"), 4) : null,
                toJson(langs), toJson(topics), toJson(qIds),
                Math.max(1, Math.min(600, toInt(body.get("durationMin"), 60))),
                body.containsKey("timePerQ") && body.get("timePerQ") != null ? toInt(body.get("timePerQ"), 0) : null,
                visibility, invCode, prizePool, entryFee,
                Boolean.TRUE.equals(body.get("tournamentMode")) ? 1 : 0,
                Math.max(5, toInt(body.get("snapshotSecs"), 25)),
                status, body.containsKey("startTime") ? toLong(body.get("startTime"), 0) : null,
                body.containsKey("prizePreset") ? str(body.get("prizePreset"), 30, "") : null,
                body.containsKey("split") ? toJson(body.get("split")) : null,
                Math.max(1, toInt(body.get("minPlayers"), 2)),
                funded ? 1 : 0,
                body.containsKey("org") ? toJson(body.get("org")) : null,
                IdUtil.now()
            );
        } catch (Exception e) { throw new RuntimeException(e); }

        // Host joins their own room
        domain.joinRoom(id, userId);

        Map<String, Object> room = domain.getRoomFull(id);
        return org.springframework.http.ResponseEntity.status(201).body(Map.of("ok", true, "room", room));
    }

    // ---------- get by invite code ----------

    @GetMapping("/code/{code}")
    public Map<String, Object> getByCode(@PathVariable String code, HttpServletRequest req) {
        Optional<Map<String, Object>> row = db.one("SELECT id FROM rooms WHERE invite_code = ?",
                code.trim().toUpperCase());
        if (row.isEmpty()) throw HttpException.notFound("No room uses that code.");
        return Map.of("ok", true, "room", domain.getRoomFull(row.get().get("id").toString()));
    }

    // ---------- get one ----------

    @GetMapping("/{id}")
    public Map<String, Object> getRoom(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> room = domain.requireRoom(id);
        Optional<Map<String, Object>> optUser = optionalUser(req);
        boolean isHost = optUser.map(u -> u.get("id").equals(room.get("hostId"))).orElse(false);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> players = (List<Map<String, Object>>) room.get("players");
        boolean isPlayer = optUser.map(u -> players.stream().anyMatch(p -> u.get("id").equals(p.get("userId")))).orElse(false);
        boolean isAdmin  = optUser.map(u -> Boolean.TRUE.equals(u.get("isAdmin"))).orElse(false);

        if ("Private".equals(room.get("visibility")) && !isPlayer && !isHost && !isAdmin) {
            throw HttpException.forbidden("That room is private. Ask the host for the invite code.");
        }
        Map<String, Object> out = new LinkedHashMap<>(room);
        if (!isPlayer && !isHost && !isAdmin) out.put("inviteCode", null);
        return Map.of("ok", true, "room", out);
    }

    // ---------- join ----------

    @PostMapping("/{id}/join")
    public Map<String, Object> joinRoom(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        long entryFee = toLong(room.get("entryFeePaise"), 0);
        if (entryFee > 0) {
            Optional<Map<String, Object>> paid = db.one(
                "SELECT id FROM payments WHERE room_id = ? AND user_id = ? AND kind = 'entry' AND status IN ('escrow','released')",
                room.get("id"), user.get("id"));
            if (paid.isEmpty()) throw new HttpException(402, "This room has an entry fee. Pay it to take a seat.",
                    Map.of("entryFeePaise", entryFee));
        }

        Map<String, Object> result = domain.joinRoom(room.get("id").toString(), user.get("id").toString());
        Map<String, Object> joinedRoom = (Map<String, Object>) result.get("room");

        // Duel auto-start when 2 players join
        if ("duel".equals(room.get("type")) && "open".equals(((Map<String,Object>)joinedRoom).get("status"))) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> players = (List<Map<String, Object>>) joinedRoom.get("players");
            if (players.size() >= 2) {
                db.run("UPDATE rooms SET status = 'live', start_time = ? WHERE id = ? AND status = 'open'",
                       IdUtil.now(), room.get("id"));
                joinedRoom = domain.getRoomFull(room.get("id").toString());
            }
        }
        return Map.of("ok", true, "already", Boolean.TRUE.equals(result.get("already")), "room", joinedRoom);
    }

    // ---------- leave ----------

    @PostMapping("/{id}/leave")
    public Map<String, Object> leaveRoom(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        if ("live".equals(room.get("status")) && Boolean.TRUE.equals(room.get("tournamentMode"))) {
            throw HttpException.forbidden("You can't leave a proctored match once it's running.");
        }
        domain.leaveRoom(room.get("id").toString(), user.get("id").toString());
        return Map.of("ok", true, "room", domain.getRoomFull(id));
    }

    // ---------- host: update ----------

    @PatchMapping("/{id}")
    public Map<String, Object> updateRoom(@PathVariable String id,
                                          @RequestBody Map<String, Object> patch,
                                          HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        if (!user.get("id").equals(room.get("hostId")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host can change this room.");
        if ("live".equals(room.get("status")) || "ended".equals(room.get("status")))
            throw HttpException.conflict("That room is already running or finished.");

        List<String> sets = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        Map<String, String> simple = Map.of("name","name","format","format","visibility","visibility","prizePreset","prize_preset");
        simple.forEach((k, col) -> { if (patch.containsKey(k)) { sets.add(col + " = ?"); params.add(str(patch.get(k), 160, "")); } });
        Map<String, String> nums = Map.of("size","size","durationMin","duration_min","timePerQ","time_per_q","snapshotSecs","snapshot_secs","minPlayers","min_players","entryFeePaise","entry_fee_paise","prizePoolPaise","prize_pool_paise");
        nums.forEach((k, col) -> { if (patch.containsKey(k) && patch.get(k) != null) { sets.add(col + " = ?"); params.add(toLong(patch.get(k), 0)); } });
        if (patch.containsKey("langs")) { sets.add("langs = ?"); params.add(toJson(patch.get("langs"))); }
        if (patch.containsKey("topics")) { sets.add("topics = ?"); params.add(toJson(patch.get("topics"))); }
        if (patch.containsKey("questionIds")) { sets.add("question_ids = ?"); params.add(toJson(patch.get("questionIds"))); }
        if (patch.containsKey("split")) { sets.add("split = ?"); params.add(toJson(patch.get("split"))); }
        if (patch.containsKey("status")) { sets.add("status = ?"); params.add(str(patch.get("status"), 12, "")); }
        if (sets.isEmpty()) throw HttpException.bad("Nothing to update.");

        params.add(room.get("id"));
        db.run("UPDATE rooms SET " + String.join(", ", sets) + " WHERE id = ?", params.toArray());
        if ("Private".equals(patch.get("visibility")) && room.get("inviteCode") == null) {
            db.run("UPDATE rooms SET invite_code = ? WHERE id = ?", IdUtil.inviteCode(), room.get("id"));
        }
        return Map.of("ok", true, "room", domain.getRoomFull(id));
    }

    // ---------- host: start ----------

    @PostMapping("/{id}/start")
    public Map<String, Object> startRoom(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        boolean isHost = user.get("id").equals(room.get("hostId")) || Boolean.TRUE.equals(user.get("isAdmin"));
        if (!isHost)
            throw HttpException.forbidden("Only the host of this room is allowed to start the match.");
        if ("ended".equals(room.get("status"))) throw HttpException.conflict("That room has already finished.");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> players = (List<Map<String, Object>>) room.get("players");
        if (players == null || players.isEmpty())
            throw HttpException.conflict("Need at least 1 player in the room to start.");
        if ("tournament".equals(room.get("type")) && !Boolean.TRUE.equals(room.get("funded")))
            throw HttpException.conflict("Fund the prize pool before starting.");
        db.run("UPDATE rooms SET status = 'live', start_time = ? WHERE id = ?", IdUtil.now(), id);
        return Map.of("ok", true, "room", domain.getRoomFull(id));
    }

    // ---------- host: eliminate / remove player ----------

    @PostMapping({"/{id}/eliminate", "/{id}/remove-player"})
    public Map<String, Object> eliminatePlayer(@PathVariable String id,
                                               @RequestBody Map<String, Object> body,
                                               HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        if (!user.get("id").equals(room.get("hostId")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host can eliminate or remove a player.");
        String userId = str(body.get("userId"), 100, "");
        String reason = str(body.get("reason"), 200, "Removed by room host");
        Optional<Map<String, Object>> player = domain.getPlayer(id, userId);
        if (player.isEmpty()) throw HttpException.notFound("That player isn't in this room.");

        if ("open".equals(room.get("status")) || "draft".equals(room.get("status"))) {
            // Remove from room in waiting lobby
            domain.leaveRoom(id, userId);
            domain.notify(userId, "removed", id, reason);
        } else {
            // Eliminate from live or finished match
            db.run("UPDATE room_players SET eliminated = 1, elim_reason = ?, eliminated_at = ?, score = 0 WHERE room_id = ? AND user_id = ?",
                   reason, IdUtil.now(), id, userId);
            domain.notify(userId, "eliminated", id, reason);
        }
        return Map.of("ok", true, "room", domain.getRoomFull(id));
    }

    // ---------- scoreboard ----------

    @GetMapping("/{id}/board")
    public Map<String, Object> getBoard(@PathVariable String id) {
        Map<String, Object> room = domain.requireRoom(id);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> players = (List<Map<String, Object>>) room.get("players");
        return Map.of("ok", true, "board", domain.scoreboard(players), "status", room.get("status"));
    }

    // ---------- finalise ----------

    @PostMapping("/{id}/finalise")
    public Map<String, Object> finaliseRoom(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        boolean isHost = user.get("id").equals(room.get("hostId")) || Boolean.TRUE.equals(user.get("isAdmin"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> players = (List<Map<String, Object>>) room.get("players");
        boolean isPlayer = players != null && players.stream().anyMatch(p -> user.get("id").equals(p.get("userId")));
        
        long startTime = toLong(room.get("startTime"), 0);
        long durationMin = toLong(room.get("durationMin"), 60);
        boolean timeExpired = startTime > 0 && (IdUtil.now() >= startTime + durationMin * 60000);
        @SuppressWarnings("unchecked")
        List<String> qIds = (List<String>) room.get("questionIds");
        int totalQ = qIds != null ? qIds.size() : 0;
        boolean duelFinished = "duel".equals(room.get("type")) && players != null && players.stream().anyMatch(p -> {
            @SuppressWarnings("unchecked")
            List<String> solved = (List<String>) p.get("solved");
            return solved != null && solved.size() >= totalQ;
        });

        if (!isHost && !(isPlayer && (timeExpired || duelFinished)))
            throw HttpException.forbidden("Only the host can close this room.");
        if (Boolean.TRUE.equals(room.get("resultsLocked")))
            return Map.of("ok", true, "board", room.getOrDefault("finalBoard", new ArrayList<>()), "alreadyLocked", true);
        List<Map<String, Object>> board = domain.finaliseRoom(id);
        return Map.of("ok", true, "board", board, "room", domain.getRoomFull(id));
    }

    // ---------- disputes ----------

    @PostMapping("/{id}/disputes")
    public Map<String, Object> raiseDispute(@PathVariable String id,
                                            @RequestBody Map<String, Object> body,
                                            HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        String reason = str(body.get("reason"), 2000, "").trim();
        if (reason.length() < 10) throw HttpException.bad("Give us at least a sentence so an admin can act on it.");
        String did = IdUtil.uid("d");
        db.run("INSERT INTO disputes (id,room_id,user_id,reason,status,at) VALUES (?,?,?,?,'open',?)",
               did, room.get("id"), user.get("id"), reason.substring(0, Math.min(reason.length(), 2000)), IdUtil.now());
        db.run("UPDATE rooms SET payout_blocked = 1 WHERE id = ?", room.get("id"));
        domain.notify(room.get("hostId").toString(), "dispute", id, reason.substring(0, Math.min(reason.length(), 200)));
        return Map.of("ok", true, "dispute", Map.of("id", did, "roomId", room.get("id"),
                "userId", user.get("id"), "reason", reason, "status", "open", "at", IdUtil.now()));
    }

    // ---------- helpers ----------

    private String str(Object v, int max, String dflt) {
        String s = v == null ? dflt : v.toString();
        return s == null ? "" : s.substring(0, Math.min(s.length(), max));
    }

    private int toInt(Object v, int dflt) {
        if (v == null) return dflt;
        try { return (int) Math.round(Double.parseDouble(v.toString())); } catch (Exception e) { return dflt; }
    }

    private long toLong(Object v, long dflt) {
        if (v == null) return dflt;
        try { return Math.round(Double.parseDouble(v.toString())); } catch (Exception e) { return dflt; }
    }

    @SuppressWarnings("unchecked")
    private List<String> asList(Object v, String dflt) {
        if (v instanceof List<?> l) return l.stream().map(Object::toString).collect(Collectors.toList());
        return dflt != null ? List.of(dflt) : new ArrayList<>();
    }

    private String toJson(Object v) {
        try { return mapper.writeValueAsString(v); } catch (Exception e) { return "null"; }
    }
}
