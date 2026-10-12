package com.hackagon.controller;

import com.hackagon.service.DatabaseService;
import com.hackagon.service.DomainService;
import com.hackagon.service.RepoService;
import com.hackagon.util.HttpException;
import com.hackagon.util.IdUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Proctoring REST controller: tab-lock violations, hard locks, camera gate, snapshots.
 * Mirrors server/routes/proctor.js.
 */
@RestController
@RequestMapping("/api/proctor")
public class ProctorController extends BaseController {

    private final DomainService domain;
    private final RepoService repo;
    private final String snapshotsDir;

    private static final Set<String> VIOLATION_TYPES = Set.of(
        "tab-switch", "blur", "exit-fullscreen", "context-menu", "copy", "cut", "paste", "devtools", "other"
    );
    private static final int MAX_SNAPSHOT_BYTES = 400 * 1024;
    private static final Pattern DATA_URL_PAT = Pattern.compile("^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$");

    public ProctorController(DatabaseService db, DomainService domain, RepoService repo,
                             @Value("${hackagon.snapshots-dir:server/data/snapshots}") String snapshotsDir) {
        super(db);
        this.domain = domain;
        this.repo = repo;
        this.snapshotsDir = snapshotsDir;
        new File(snapshotsDir).mkdirs();
    }

    private Map<String, Object> seat(HttpServletRequest req, String roomId) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(roomId);
        Optional<Map<String, Object>> player = domain.getPlayer(roomId, (String) user.get("id"));
        if (player.isEmpty()) throw HttpException.forbidden("You're not in that room.");
        return Map.of("room", room, "player", player.get(), "user", user);
    }

    // ---------- violations ----------

    @PostMapping("/{roomId}/violations")
    public Map<String, Object> recordViolation(@PathVariable String roomId,
                                               @RequestBody(required = false) Map<String, Object> body,
                                               HttpServletRequest req) {
        Map<String, Object> s = seat(req, roomId);
        Map<String, Object> room = (Map<String, Object>) s.get("room");
        Map<String, Object> player = (Map<String, Object>) s.get("player");
        Map<String, Object> user = (Map<String, Object>) s.get("user");
        String userId = (String) user.get("id");

        if (!Boolean.TRUE.equals(room.get("tournamentMode"))) {
            return Map.of("ok", true, "recorded", false, "locked", false, "reason", "This room isn't proctored.");
        }

        String rawType = body != null && body.get("type") != null ? body.get("type").toString() : "other";
        String type = VIOLATION_TYPES.contains(rawType) ? rawType : "other";

        String id = IdUtil.uid("v");
        long now = IdUtil.now();
        db.run("INSERT INTO violations (id,room_id,user_id,type,at) VALUES (?,?,?,?,?)", id, roomId, userId, type, now);

        long count = ((Number) player.getOrDefault("violations", 0)).longValue() + 1;
        db.run("UPDATE room_players SET violations = ? WHERE room_id = ? AND user_id = ?", count, roomId, userId);

        String reason = "Tab-lock violation: " + type;
        db.run("UPDATE room_players SET locked = 1, lock_reason = ?, locked_at = ? WHERE room_id = ? AND user_id = ?",
               reason, now, roomId, userId);
        domain.notify((String) room.get("hostId"), "violation", roomId, user.get("name") + " triggered " + type);

        return Map.of(
            "ok", true,
            "violation", Map.of("id", id, "roomId", roomId, "userId", userId, "type", type, "at", now),
            "violations", count,
            "locked", true,
            "lockReason", reason
        );
    }

    @GetMapping("/{roomId}/violations")
    public Map<String, Object> getViolations(@PathVariable String roomId, HttpServletRequest req) {
        Map<String, Object> s = seat(req, roomId);
        Map<String, Object> room = (Map<String, Object>) s.get("room");
        Map<String, Object> player = (Map<String, Object>) s.get("player");
        Map<String, Object> user = (Map<String, Object>) s.get("user");

        boolean isHost = room.get("hostId").equals(user.get("id")) || Boolean.TRUE.equals(user.get("isAdmin"));
        List<Map<String, Object>> rows = !isHost
            ? db.q("SELECT * FROM violations WHERE room_id = ? AND user_id = ? ORDER BY at", room.get("id"), user.get("id"))
            : db.q("SELECT * FROM violations WHERE room_id = ? ORDER BY at", room.get("id"));

        return Map.of(
            "ok", true,
            "violations", rows.stream().map(repo::shapeViolation).collect(Collectors.toList()),
            "locked", Boolean.TRUE.equals(player.get("locked")),
            "lockReason", player.getOrDefault("lockReason", "")
        );
    }

    // ---------- lock / unlock ----------

    @PostMapping("/{roomId}/lock")
    public Map<String, Object> lock(@PathVariable String roomId,
                                    @RequestBody(required = false) Map<String, Object> body,
                                    HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(roomId);
        boolean isHost = room.get("hostId").equals(user.get("id")) || Boolean.TRUE.equals(user.get("isAdmin"));
        String target = isHost && body != null && body.get("userId") != null ? body.get("userId").toString() : (String) user.get("id");
        if (!isHost && !target.equals(user.get("id"))) throw HttpException.forbidden("Only the host can lock someone else.");

        String reason = body != null && body.get("reason") != null ? body.get("reason").toString().trim() : "Match locked";
        db.run("UPDATE room_players SET locked = 1, lock_reason = ?, locked_at = ? WHERE room_id = ? AND user_id = ?",
               reason, IdUtil.now(), roomId, target);
        return Map.of("ok", true, "locked", true, "userId", target, "reason", reason);
    }

    @PostMapping("/{roomId}/unlock")
    public Map<String, Object> unlock(@PathVariable String roomId,
                                      @RequestBody(required = false) Map<String, Object> body,
                                      HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(roomId);
        if (!room.get("hostId").equals(user.get("id")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host can lift a lock.");

        String target = body != null && body.get("userId") != null ? body.get("userId").toString() : "";
        db.run("UPDATE room_players SET locked = 0, lock_reason = NULL, locked_at = NULL WHERE room_id = ? AND user_id = ?",
               room.get("id"), target);
        return Map.of("ok", true);
    }

    // ---------- camera ----------

    @PostMapping("/{roomId}/camera")
    public Map<String, Object> camera(@PathVariable String roomId,
                                      @RequestBody(required = false) Map<String, Object> body,
                                      HttpServletRequest req) {
        Map<String, Object> s = seat(req, roomId);
        Map<String, Object> room = (Map<String, Object>) s.get("room");
        Map<String, Object> user = (Map<String, Object>) s.get("user");
        String userId = (String) user.get("id");

        if (!Boolean.TRUE.equals(room.get("tournamentMode"))) {
            return Map.of("ok", true, "camera", "n/a", "required", false);
        }

        String rawState = body != null && body.get("state") != null ? body.get("state").toString() : "pending";
        String state = Set.of("ok", "denied", "pending").contains(rawState) ? rawState : "pending";

        db.run("UPDATE room_players SET camera = ? WHERE room_id = ? AND user_id = ?", state, room.get("id"), userId);

        if ("ok".equals(state)) {
            Optional<Map<String, Object>> countRow = db.one("SELECT COUNT(*) AS c FROM violations WHERE room_id = ? AND user_id = ?", room.get("id"), userId);
            long c = countRow.map(m -> ((Number) m.get("c")).longValue()).orElse(0L);
            if (c == 0 && "ended".equals(room.get("status"))) {
                domain.bumpStat(userId, "cleanProctored", 1);
            }
        }
        return Map.of("ok", true, "camera", state, "required", true);
    }

    // ---------- snapshots ----------

    @PostMapping("/{roomId}/snapshots")
    public Map<String, Object> snapshot(@PathVariable String roomId,
                                        @RequestBody Map<String, Object> body,
                                        HttpServletRequest req) {
        Map<String, Object> s = seat(req, roomId);
        Map<String, Object> room = (Map<String, Object>) s.get("room");
        Map<String, Object> user = (Map<String, Object>) s.get("user");
        String userId = (String) user.get("id");

        if (!Boolean.TRUE.equals(room.get("tournamentMode"))) {
            return Map.of("ok", true, "stored", false, "reason", "This room isn't proctored.");
        }

        String dataUrl = body != null && body.get("image") != null ? body.get("image").toString() : "";
        Matcher m = DATA_URL_PAT.matcher(dataUrl);
        if (!m.matches()) throw HttpException.bad("Snapshot must be a jpeg/png/webp data URL.");

        byte[] buf = Base64.getDecoder().decode(m.group(2));
        if (buf.length > MAX_SNAPSHOT_BYTES) throw HttpException.bad("Snapshot is too large.");

        String id = IdUtil.uid("snap");
        String ext = "jpeg".equalsIgnoreCase(m.group(1)) ? "jpg" : m.group(1).toLowerCase();
        String filename = room.get("id") + "_" + userId + "_" + id + "." + ext;
        File file = new File(snapshotsDir, filename);

        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(buf);
        } catch (Exception ex) {
            throw new RuntimeException("Failed saving snapshot: " + ex.getMessage(), ex);
        }

        db.run("INSERT INTO snapshots (id,room_id,user_id,path,at) VALUES (?,?,?,?,?)", id, room.get("id"), userId, filename, IdUtil.now());
        Optional<Map<String, Object>> countRow = db.one("SELECT COUNT(*) AS c FROM snapshots WHERE room_id = ?", room.get("id"));
        long count = countRow.map(r -> ((Number) r.get("c")).longValue()).orElse(0L);

        return Map.of("ok", true, "stored", true, "id", id, "snapshots", count);
    }

    @GetMapping("/{roomId}/snapshots")
    public Map<String, Object> listSnapshots(@PathVariable String roomId, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(roomId);
        if (!room.get("hostId").equals(user.get("id")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host can review snapshots.");

        List<Map<String, Object>> rows = db.q("SELECT * FROM snapshots WHERE room_id = ? ORDER BY at DESC LIMIT 100", room.get("id"));
        List<Map<String, Object>> snapshots = rows.stream().map(r -> Map.of(
            "id", r.get("id"),
            "userId", r.get("user_id"),
            "at", ((Number) r.get("at")).longValue(),
            "path", r.get("path")
        )).collect(Collectors.toList());
        return Map.of("ok", true, "snapshots", snapshots);
    }

    @GetMapping("/{roomId}/snapshots/{snapId}")
    public ResponseEntity<byte[]> getSnapshot(@PathVariable String roomId,
                                              @PathVariable String snapId,
                                              HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(roomId);
        if (!room.get("hostId").equals(user.get("id")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host can review snapshots.");

        Optional<Map<String, Object>> row = db.one("SELECT * FROM snapshots WHERE id = ? AND room_id = ?", snapId, room.get("id"));
        if (row.isEmpty()) throw HttpException.notFound("No snapshot with that id.");

        File file = new File(snapshotsDir, new File(row.get().get("path").toString()).getName());
        if (!file.exists()) throw HttpException.notFound("That image is no longer on disk.");

        try {
            byte[] bytes = Files.readAllBytes(file.toPath());
            MediaType mediaType = file.getName().endsWith(".png") ? MediaType.IMAGE_PNG : MediaType.IMAGE_JPEG;
            return ResponseEntity.ok().contentType(mediaType).body(bytes);
        } catch (Exception ex) {
            throw new RuntimeException("Could not read snapshot file: " + ex.getMessage(), ex);
        }
    }
}
