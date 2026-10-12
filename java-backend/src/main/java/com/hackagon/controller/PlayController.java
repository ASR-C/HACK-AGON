package com.hackagon.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hackagon.service.DatabaseService;
import com.hackagon.service.DomainService;
import com.hackagon.service.JudgeService;
import com.hackagon.service.RepoService;
import com.hackagon.util.HttpException;
import com.hackagon.util.IdUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Judging, submissions, practice mode, mistake book, achievements, and notifications.
 * Mirrors server/routes/play.js.
 */
@RestController
@RequestMapping("/api/play")
public class PlayController extends BaseController {

    private final DomainService domain;
    private final RepoService repo;
    private final JudgeService judgeService;
    private final ObjectMapper mapper;

    private static final int MAX_CODE = 60000;

    public PlayController(DatabaseService db, DomainService domain, RepoService repo, JudgeService judgeService, ObjectMapper mapper) {
        super(db);
        this.domain = domain;
        this.repo = repo;
        this.judgeService = judgeService;
        this.mapper = mapper;
    }

    private Map<String, Object> loadJudgeable(String id) {
        Optional<Map<String, Object>> row = domain.getQuestionRow(id, true);
        if (row.isEmpty()) throw HttpException.notFound("No question with that id.");
        return repo.shapeQuestionAdmin(row.get());
    }

    @SuppressWarnings("unchecked")
    private void checkLang(Map<String, Object> q, String lang) {
        List<String> langs = (List<String>) q.get("languages");
        if (langs != null && !langs.contains(lang)) {
            throw HttpException.bad("That question isn't set for " + lang + ".");
        }
    }

    // ---------- in-room submission ----------

    @PostMapping("/submit")
    public Map<String, Object> submit(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");
        String roomId = (String) body.get("roomId");
        String questionId = (String) body.get("questionId");
        String lang = (String) body.get("lang");
        String code = (String) body.get("code");

        if (roomId == null || questionId == null || lang == null) throw HttpException.bad("roomId, questionId and lang are required.");
        if (code == null || code.trim().isEmpty()) throw HttpException.bad("There's no code to judge.");
        if (code.length() > MAX_CODE) throw HttpException.bad("That submission is too large.");

        Map<String, Object> room = domain.requireRoom(roomId);
        Optional<Map<String, Object>> player = domain.getPlayer(roomId, userId);
        if (player.isEmpty()) throw HttpException.forbidden("You're not in that room.");
        if (Boolean.TRUE.equals(player.get().get("locked"))) throw new HttpException(423, "You're locked out of this match.");
        if ("ended".equals(room.get("status"))) throw HttpException.conflict("That room has already finished.");
        @SuppressWarnings("unchecked")
        List<String> qIds = (List<String>) room.get("questionIds");
        if (qIds == null || !qIds.contains(questionId)) throw HttpException.forbidden("That question isn't part of this room.");

        Map<String, Object> q = loadJudgeable(questionId);
        checkLang(q, lang);

        Map<String, Object> out = domain.recordSubmission(roomId, userId, questionId, lang, code);
        return Map.of(
            "ok", true,
            "verdict", out.get("verdict"),
            "submission", out.get("submission"),
            "scored", out.get("player"),
            "board", domain.scoreboard(domain.playersOf(roomId))
        );
    }

    // ---------- standalone practice run ----------

    @SuppressWarnings("unchecked")
    @PostMapping("/practice")
    public Map<String, Object> practice(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");
        String questionId = (String) body.get("questionId");
        String lang = (String) body.get("lang");
        String code = (String) body.get("code");

        if (questionId == null || lang == null) throw HttpException.bad("questionId and lang are required.");
        if (code == null || code.trim().isEmpty()) throw HttpException.bad("There's no code to judge.");
        if (code.length() > MAX_CODE) throw HttpException.bad("That submission is too large.");

        Map<String, Object> q = loadJudgeable(questionId);
        checkLang(q, lang);

        Map<String, Object> verdict = judgeService.judge(q, lang, code);
        boolean ok = Boolean.TRUE.equals(verdict.get("ok"));

        boolean mistakeSolved = false;
        Optional<Map<String, Object>> m = db.one("SELECT * FROM mistakes WHERE user_id = ? AND question_id = ?", userId, questionId);
        if (m.isPresent()) {
            Map<String, Object> row = m.get();
            boolean isSolved = Boolean.TRUE.equals(row.get("solved")) || "1".equals(String.valueOf(row.get("solved")));
            if (!isSolved) {
                if (ok) {
                    db.run("UPDATE mistakes SET solved = 1, solved_at = ? WHERE id = ?", IdUtil.now(), row.get("id"));
                    domain.bumpStat(userId, "mistakesSolved", 1);
                    mistakeSolved = true;
                } else {
                    List<Map<String, Object>> results = (List<Map<String, Object>>) verdict.get("results");
                    Map<String, Object> failing = results != null ? results.stream().filter(r -> !Boolean.TRUE.equals(r.get("pass"))).findFirst().orElse(null) : null;
                    String failingJson;
                    try { failingJson = mapper.writeValueAsString(failing); } catch (Exception e) { failingJson = "null"; }
                    db.run("UPDATE mistakes SET last_code = ?, failing_case = ?, at = ? WHERE id = ?",
                           code, failingJson, IdUtil.now(), row.get("id"));
                }
            }
        } else if (!ok) {
            List<Map<String, Object>> results = (List<Map<String, Object>>) verdict.get("results");
            Map<String, Object> failing = results != null ? results.stream().filter(r -> !Boolean.TRUE.equals(r.get("pass"))).findFirst().orElse(null) : null;
            String failingJson;
            try { failingJson = mapper.writeValueAsString(failing); } catch (Exception e) { failingJson = "null"; }
            db.run("INSERT INTO mistakes (id,user_id,question_id,room_id,last_code,failing_case,solved,at) VALUES (?,?,?,NULL,?,?,0,?)",
                   IdUtil.uid("m"), userId, questionId, code, failingJson, IdUtil.now());
        }

        List<Map<String, Object>> newly = mistakeSolved ? domain.recomputeAchievements(userId) : List.of();
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("verdict", verdict);
        res.put("mistakeSolved", mistakeSolved);
        res.put("newAchievements", newly);
        res.put("approach", ok ? q.get("approach") : null);
        return res;
    }

    // ---------- mistake book ----------

    @GetMapping("/mistakes")
    public Map<String, Object> mistakes(HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");
        List<Map<String, Object>> rows = db.q("SELECT * FROM mistakes WHERE user_id = ? ORDER BY at DESC LIMIT 200", userId);
        List<Map<String, Object>> mistakes = rows.stream().map(repo::shapeMistake).collect(Collectors.toList());

        List<String> qIds = mistakes.stream().map(m -> (String) m.get("questionId")).filter(Objects::nonNull).distinct().collect(Collectors.toList());
        List<Map<String, Object>> questions = new ArrayList<>();
        if (!qIds.isEmpty()) {
            String placeholders = qIds.stream().map(x -> "?").collect(Collectors.joining(","));
            String sql = "SELECT id,title,topics,difficulty,points,languages,statement,samples,sig,hint,starters,unordered,retired,updated_at,time_limit_min,memory_limit_mb,approach FROM questions WHERE id IN (" + placeholders + ")";
            questions = db.q(sql, qIds.toArray()).stream().map(r -> {
                Map<String, Object> shaped = new LinkedHashMap<>(repo.shapeQuestionPublic(r));
                shaped.put("approach", r.get("approach") != null ? r.get("approach").toString() : "");
                return shaped;
            }).collect(Collectors.toList());
        }

        return Map.of("ok", true, "mistakes", mistakes, "questions", questions);
    }

    // ---------- submissions ----------

    @GetMapping("/submissions")
    public Map<String, Object> submissions(@RequestParam(required = false) String roomId, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");
        List<Object> params = new ArrayList<>();
        params.add(userId);
        String sql = "SELECT * FROM submissions WHERE user_id = ?";
        if (roomId != null && !roomId.isBlank()) {
            sql += " AND room_id = ?";
            params.add(roomId);
        }
        sql += " ORDER BY at DESC LIMIT 100";
        List<Map<String, Object>> rows = db.q(sql, params.toArray());
        return Map.of("ok", true, "submissions", rows.stream().map(repo::shapeSubmission).collect(Collectors.toList()));
    }

    // ---------- achievements + inbox ----------

    @GetMapping("/achievements")
    public Map<String, Object> achievements(HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");
        List<Map<String, Object>> newly = domain.recomputeAchievements(userId);
        return Map.of("ok", true, "achievements", domain.achievementsFor(userId), "newly", newly);
    }

    @GetMapping("/notifications")
    public Map<String, Object> notifications(HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");
        List<Map<String, Object>> rows = db.q("SELECT * FROM notifications WHERE user_id = ? ORDER BY at DESC LIMIT 50", userId);
        return Map.of("ok", true, "notifications", rows.stream().map(repo::shapeNotification).collect(Collectors.toList()));
    }
}
