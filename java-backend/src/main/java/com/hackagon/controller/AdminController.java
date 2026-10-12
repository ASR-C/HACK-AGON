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
 * Admin console REST controller: question bank management, book licences,
 * accounts and roles, dispute resolution, and proctoring review.
 * All endpoints require an admin token. Mirrors server/routes/admin.js.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController extends BaseController {

    private final DomainService domain;
    private final RepoService repo;
    private final ObjectMapper mapper;

    public AdminController(DatabaseService db, DomainService domain, RepoService repo, ObjectMapper mapper) {
        super(db);
        this.domain = domain;
        this.repo = repo;
        this.mapper = mapper;
    }

    private void requireAdmin(HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        if (!Boolean.TRUE.equals(user.get("isAdmin"))) {
            throw HttpException.forbidden("Only an admin can use the admin console.");
        }
    }

    // ================= question bank =================

    @GetMapping("/questions")
    public Map<String, Object> listQuestions(HttpServletRequest req) {
        requireAdmin(req);
        List<Map<String, Object>> rows = db.q("SELECT * FROM questions ORDER BY retired, difficulty, title");
        return Map.of("ok", true, "questions", rows.stream().map(repo::shapeQuestionAdmin).collect(Collectors.toList()));
    }

    @GetMapping("/questions/{id}")
    public Map<String, Object> getQuestion(@PathVariable String id, HttpServletRequest req) {
        requireAdmin(req);
        Optional<Map<String, Object>> row = domain.getQuestionRow(id, true);
        if (row.isEmpty()) throw HttpException.notFound("No question with that id.");
        return Map.of("ok", true, "question", repo.shapeQuestionAdmin(row.get()));
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/questions")
    public Map<String, Object> saveQuestion(@RequestBody Map<String, Object> d, HttpServletRequest req) {
        requireAdmin(req);

        String title = d.get("title") != null ? d.get("title").toString().trim() : "";
        String statement = d.get("statement") != null ? d.get("statement").toString().trim() : "";
        if (title.length() < 3) throw HttpException.bad("Give the question a title of 3+ characters.");
        if (statement.length() < 20) throw HttpException.bad("Write a statement players can actually solve from (20+ characters).");

        List<?> topics = (List<?>) d.get("topics");
        List<?> langs = (List<?>) d.get("languages");
        if (topics == null || topics.isEmpty()) throw HttpException.bad("Pick at least one topic.");
        if (langs == null || langs.isEmpty()) throw HttpException.bad("Pick at least one language.");

        long points = d.get("points") != null ? ((Number) d.get("points")).longValue() : 0L;
        if (points <= 0) throw HttpException.bad("Points must be above zero.");

        List<?> cases = (List<?>) d.get("cases");
        if (cases == null || cases.isEmpty()) throw HttpException.bad("Add at least one hidden test case.");

        String id = d.get("id") != null && !d.get("id").toString().isBlank()
            ? d.get("id").toString().trim()
            : IdUtil.uid("q");

        Optional<Map<String, Object>> existing = db.one("SELECT id, custom FROM questions WHERE id = ?", id);
        long now = IdUtil.now();

        try {
            String topicsJson = mapper.writeValueAsString(topics);
            String langsJson = mapper.writeValueAsString(langs);
            String samplesJson = mapper.writeValueAsString(d.getOrDefault("samples", List.of()));
            String sigJson = mapper.writeValueAsString(d.get("sig"));
            String casesJson = mapper.writeValueAsString(cases);
            String startersJson = mapper.writeValueAsString(d.get("starters"));

            int timeLimit = d.get("timeLimitMin") != null ? ((Number) d.get("timeLimitMin")).intValue() : 15;
            int memLimit = d.get("memoryLimitMB") != null ? ((Number) d.get("memoryLimitMB")).intValue() : 256;
            String diff = d.get("difficulty") != null ? d.get("difficulty").toString() : "easy";
            String hint = d.get("hint") != null ? d.get("hint").toString() : "";
            String approach = d.get("approach") != null ? d.get("approach").toString() : "";
            int unordered = Boolean.TRUE.equals(d.get("unordered")) ? 1 : 0;

            if (existing.isPresent()) {
                db.run(
                    "UPDATE questions SET title=?,topics=?,difficulty=?,points=?,time_limit_min=?,memory_limit_mb=?,languages=?," +
                    "statement=?,samples=?,sig=?,hint=?,cases=?,unordered=?,approach=?,starters=?,updated_at=? WHERE id=?",
                    title, topicsJson, diff, points, timeLimit, memLimit, langsJson,
                    statement, samplesJson, sigJson, hint, casesJson, unordered, approach, startersJson, now, id
                );
            } else {
                db.run(
                    "INSERT INTO questions (id,title,topics,difficulty,points,time_limit_min,memory_limit_mb,languages,statement," +
                    "samples,sig,hint,cases,unordered,approach,starters,custom,retired,created_at,updated_at) " +
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?)",
                    id, title, topicsJson, diff, points, timeLimit, memLimit, langsJson, statement,
                    samplesJson, sigJson, hint, casesJson, unordered, approach, startersJson, now, now
                );
            }
        } catch (Exception ex) {
            throw new RuntimeException("Could not serialise question JSON: " + ex.getMessage(), ex);
        }

        return Map.of("ok", true, "question", repo.shapeQuestionAdmin(domain.getQuestionRow(id, true).get()));
    }

    @PostMapping("/questions/{id}/retire")
    public Map<String, Object> retireQuestion(@PathVariable String id, HttpServletRequest req) {
        requireAdmin(req);
        Optional<Map<String, Object>> row = db.one("SELECT id FROM questions WHERE id = ?", id);
        if (row.isEmpty()) throw HttpException.notFound("No question with that id.");
        db.run("UPDATE questions SET retired = 1, updated_at = ? WHERE id = ?", IdUtil.now(), id);
        return Map.of("ok", true, "retired", true);
    }

    @PostMapping("/questions/{id}/restore")
    public Map<String, Object> restoreQuestion(@PathVariable String id, HttpServletRequest req) {
        requireAdmin(req);
        db.run("UPDATE questions SET retired = 0, updated_at = ? WHERE id = ?", IdUtil.now(), id);
        return Map.of("ok", true, "retired", false);
    }

    @DeleteMapping("/questions/{id}")
    public Map<String, Object> deleteQuestion(@PathVariable String id, HttpServletRequest req) {
        requireAdmin(req);
        Optional<Map<String, Object>> row = db.one("SELECT id, custom FROM questions WHERE id = ?", id);
        if (row.isEmpty()) throw HttpException.notFound("No question with that id.");
        if (!Boolean.TRUE.equals(row.get().get("custom")) && !"1".equals(String.valueOf(row.get().get("custom")))) {
            throw new HttpException(409, "Seeded questions can only be retired, not deleted — rooms may still reference them.");
        }
        db.run("DELETE FROM questions WHERE id = ?", id);
        return Map.of("ok", true, "deleted", true);
    }

    // ================= library =================

    @GetMapping("/books")
    public Map<String, Object> listBooksAdmin(@RequestParam(required = false) String status, HttpServletRequest req) {
        requireAdmin(req);
        List<Map<String, Object>> rows = status != null && !status.isBlank()
            ? db.q("SELECT * FROM books WHERE status = ? ORDER BY created_at DESC", status)
            : db.q("SELECT * FROM books WHERE status <> 'approved' ORDER BY created_at DESC");
        return Map.of("ok", true, "books", rows.stream().map(repo::shapeBook).collect(Collectors.toList()));
    }

    @PostMapping("/books/{id}/decide")
    public Map<String, Object> decideBook(@PathVariable String id,
                                          @RequestBody Map<String, Object> body,
                                          HttpServletRequest req) {
        requireAdmin(req);
        String status = body != null && body.get("status") != null ? body.get("status").toString() : null;
        if (!Set.of("approved", "rejected", "pending").contains(status)) {
            throw HttpException.bad("status must be approved, rejected or pending.");
        }
        Optional<Map<String, Object>> row = db.one("SELECT * FROM books WHERE id = ?", id);
        if (row.isEmpty()) throw HttpException.notFound("No such book submission.");

        String note = body.get("note") != null ? body.get("note").toString() : "";
        db.run("UPDATE books SET status = ?, note = ?, decided_at = ? WHERE id = ?", status, note, IdUtil.now(), id);
        if (row.get().get("submitted_by") != null) {
            domain.notify(row.get().get("submitted_by").toString(), "book-" + status, null, note);
        }
        return Map.of("ok", true, "book", repo.shapeBook(db.one("SELECT * FROM books WHERE id = ?", id).get()));
    }

    // ================= users =================

    @GetMapping("/users")
    public Map<String, Object> listUsers(@RequestParam(required = false) String q, HttpServletRequest req) {
        requireAdmin(req);
        List<Map<String, Object>> rows;
        if (q != null && !q.isBlank()) {
            String s = "%" + q.trim().toLowerCase() + "%";
            rows = db.q("SELECT id,name,username,email,mobile,is_admin,org,stats,created_at,payout FROM users WHERE LOWER(name) LIKE ? OR LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR mobile LIKE ? ORDER BY created_at DESC LIMIT 300", s, s, s, s);
        } else {
            rows = db.q("SELECT id,name,username,email,mobile,is_admin,org,stats,created_at,payout FROM users ORDER BY created_at DESC LIMIT 300");
        }
        return Map.of("ok", true, "users", rows.stream().map(this::shapeUser).collect(Collectors.toList()));
    }

    @PostMapping("/users/{id}/admin")
    public Map<String, Object> setAdmin(@PathVariable String id,
                                        @RequestBody Map<String, Object> body,
                                        HttpServletRequest req) {
        Map<String, Object> me = requireUser(req);
        if (!Boolean.TRUE.equals(me.get("isAdmin"))) throw HttpException.forbidden("Only admins can set roles.");

        Optional<Map<String, Object>> row = db.one("SELECT id FROM users WHERE id = ?", id);
        if (row.isEmpty()) throw HttpException.notFound("No account with that id.");

        boolean isAdmin = !Boolean.FALSE.equals(body.get("isAdmin"));
        if (row.get().get("id").equals(me.get("id")) && !isAdmin) {
            throw new HttpException(409, "You can't remove your own admin role while you're using it.");
        }

        db.run("UPDATE users SET is_admin = ? WHERE id = ?", isAdmin ? 1 : 0, id);
        return Map.of("ok", true, "user", shapeUser(db.one("SELECT id,name,username,email,mobile,is_admin,org,stats,created_at,payout FROM users WHERE id = ?", id).get()));
    }

    @PostMapping("/users/{id}/verify")
    public Map<String, Object> verifyUser(@PathVariable String id, HttpServletRequest req) {
        requireAdmin(req);
        db.run("UPDATE users SET verified = 1 WHERE id = ?", id);
        return Map.of("ok", true, "user", shapeUser(db.one("SELECT id,name,username,email,mobile,is_admin,org,stats,created_at,payout FROM users WHERE id = ?", id).get()));
    }

    // ================= disputes =================

    @GetMapping("/disputes")
    public Map<String, Object> listDisputes(@RequestParam(required = false) String status, HttpServletRequest req) {
        requireAdmin(req);
        List<Map<String, Object>> rows = status != null && !status.isBlank()
            ? db.q("SELECT * FROM disputes WHERE status = ? ORDER BY at DESC", status)
            : db.q("SELECT * FROM disputes ORDER BY at DESC LIMIT 200");

        List<Map<String, Object>> disputes = rows.stream().map(repo::shapeDispute).collect(Collectors.toList());
        Map<String, Object> roomsMap = new HashMap<>();
        for (Map<String, Object> d : disputes) {
            String roomId = (String) d.get("roomId");
            if (roomId != null && !roomsMap.containsKey(roomId)) {
                Map<String, Object> r = domain.getRoomFull(roomId);
                if (r != null) {
                    roomsMap.put(roomId, Map.of(
                        "id", r.get("id"),
                        "name", r.get("name"),
                        "status", r.get("status"),
                        "payoutBlocked", r.get("payoutBlocked"),
                        "prizePoolPaise", r.get("prizePoolPaise")
                    ));
                }
            }
        }
        return Map.of("ok", true, "disputes", disputes, "rooms", roomsMap);
    }

    @PostMapping("/disputes/{id}/resolve")
    public Map<String, Object> resolveDispute(@PathVariable String id,
                                              @RequestBody Map<String, Object> body,
                                              HttpServletRequest req) {
        requireAdmin(req);
        Optional<Map<String, Object>> row = db.one("SELECT * FROM disputes WHERE id = ?", id);
        if (row.isEmpty()) throw HttpException.notFound("No such dispute.");

        String resolution = body != null && body.get("resolution") != null ? body.get("resolution").toString().trim() : "";
        if (resolution.length() < 5) throw HttpException.bad("Write down what you decided.");

        db.run("UPDATE disputes SET status = 'resolved', resolution = ? WHERE id = ?", resolution, id);
        db.run("UPDATE rooms SET payout_blocked = 0 WHERE id = ?", row.get().get("room_id"));
        domain.notify((String) row.get().get("user_id"), "dispute-resolved", (String) row.get().get("room_id"), resolution);

        return Map.of("ok", true, "dispute", repo.shapeDispute(db.one("SELECT * FROM disputes WHERE id = ?", id).get()));
    }

    // ================= proctoring review =================

    @GetMapping("/rooms/{id}/proctoring")
    public Map<String, Object> proctoringReview(@PathVariable String id, HttpServletRequest req) {
        requireAdmin(req);
        Map<String, Object> room = domain.requireRoom(id);
        List<Map<String, Object>> violations = db.q("SELECT * FROM violations WHERE room_id = ? ORDER BY at", id)
            .stream().map(repo::shapeViolation).collect(Collectors.toList());
        List<Map<String, Object>> snapshots = db.q("SELECT * FROM snapshots WHERE room_id = ? ORDER BY at DESC LIMIT 200", id)
            .stream().map(s -> Map.of("id", s.get("id"), "userId", s.get("user_id"), "at", ((Number) s.get("at")).longValue(), "path", s.get("path")))
            .collect(Collectors.toList());

        return Map.of(
            "ok", true,
            "room", Map.of("id", room.get("id"), "name", room.get("name"), "status", room.get("status")),
            "violations", violations,
            "snapshots", snapshots
        );
    }
}
