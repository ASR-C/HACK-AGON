package com.hackagon.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Row-to-map shaping layer.
 * Mirrors repo.js: converts snake_case database column names into the
 * camelCase JSON objects the browser store already expects.
 */
@Service
public class RepoService {

    private final ObjectMapper mapper;

    public RepoService(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    // ---------- helpers ----------

    private long i(Object v) {
        if (v == null) return 0L;
        if (v instanceof Number n) return n.longValue();
        try { return Long.parseLong(v.toString()); } catch (Exception e) { return 0L; }
    }

    private boolean bool(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.intValue() != 0;
        return "1".equals(v.toString()) || "true".equalsIgnoreCase(v.toString());
    }

    @SuppressWarnings("unchecked")
    private <T> T json(Object v, T dflt) {
        if (v == null) return dflt;
        if (v instanceof String s) {
            try {
                if (dflt instanceof List) {
                    return (T) mapper.readValue(s, new TypeReference<List<Object>>(){});
                }
                return (T) mapper.readValue(s, Object.class);
            } catch (Exception e) { return dflt; }
        }
        return dflt;
    }

    private List<Object> jsonList(Object v) {
        Object r = json(v, new ArrayList<>());
        if (r instanceof List<?> l) return (List<Object>) l;
        return new ArrayList<>();
    }

    private Map<String, Object> jsonMap(Object v) {
        Object r = json(v, new HashMap<>());
        if (r instanceof Map<?,?> m) return (Map<String, Object>) m;
        return new HashMap<>();
    }

    // ---------- shapePlayer ----------

    public Map<String, Object> shapePlayer(Map<String, Object> r) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("userId",       r.get("user_id"));
        p.put("name",         r.get("name"));
        p.put("username",     r.get("username"));
        p.put("joinedAt",     i(r.get("joined_at")));
        p.put("score",        i(r.get("score")));
        p.put("solved",       jsonList(r.get("solved")));
        p.put("eliminated",   bool(r.get("eliminated")));
        p.put("elimReason",   r.getOrDefault("elim_reason", ""));
        p.put("eliminatedAt", r.get("eliminated_at") != null ? i(r.get("eliminated_at")) : null);
        p.put("violations",   i(r.get("violations")));
        p.put("camera",       r.getOrDefault("camera", "n/a"));
        p.put("lastCorrectAt",r.get("last_correct_at") != null ? i(r.get("last_correct_at")) : null);
        p.put("locked",       bool(r.get("locked")));
        p.put("lockReason",   r.getOrDefault("lock_reason", ""));
        p.put("lockedAt",     r.get("locked_at") != null ? i(r.get("locked_at")) : null);
        return p;
    }

    // ---------- shapeRoom ----------

    public Map<String, Object> shapeRoom(Map<String, Object> r, List<Map<String, Object>> players) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id",             r.get("id"));
        out.put("type",           r.get("type"));
        out.put("hostId",         r.get("host_id"));
        out.put("hostName",       r.get("host_name"));
        out.put("name",           r.get("name"));
        out.put("format",         r.get("format"));
        out.put("size",           i(r.get("size")));
        out.put("squadSize",      r.get("squad_size") != null ? i(r.get("squad_size")) : null);
        out.put("langs",          jsonList(r.get("langs")));
        out.put("topics",         jsonList(r.get("topics")));
        out.put("questionIds",    jsonList(r.get("question_ids")));
        out.put("durationMin",    i(r.get("duration_min")));
        out.put("timePerQ",       r.get("time_per_q") != null ? i(r.get("time_per_q")) : null);
        out.put("visibility",     r.get("visibility"));
        out.put("inviteCode",     r.get("invite_code"));
        out.put("prizePoolPaise", i(r.get("prize_pool_paise")));
        out.put("entryFeePaise",  i(r.get("entry_fee_paise")));
        out.put("tournamentMode", bool(r.get("tournament_mode")));
        out.put("snapshotSecs",   i(r.get("snapshot_secs")));
        out.put("status",         r.get("status"));
        out.put("startTime",      r.get("start_time") != null ? i(r.get("start_time")) : null);
        out.put("players",        players != null ? players : new ArrayList<>());
        out.put("platform",       bool(r.get("platform")));
        out.put("prizePreset",    r.get("prize_preset"));
        out.put("split",          r.get("split") != null ? jsonMap(r.get("split")) : null);
        out.put("minPlayers",     i(r.get("min_players")));
        out.put("funded",         bool(r.get("funded")));
        out.put("org",            r.get("org") != null ? jsonMap(r.get("org")) : null);
        out.put("resultsLocked",  bool(r.get("results_locked")));
        out.put("payoutBlocked",  bool(r.get("payout_blocked")));
        out.put("finalBoard",     r.get("final_board") != null ? json(r.get("final_board"), new ArrayList<>()) : null);
        out.put("createdAt",      i(r.get("created_at")));
        return out;
    }

    // ---------- shapeQuestion (public view) ----------

    public Map<String, Object> shapeQuestionPublic(Map<String, Object> r) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id",            r.get("id"));
        out.put("title",         r.get("title"));
        out.put("topics",        jsonList(r.get("topics")));
        out.put("difficulty",    r.get("difficulty"));
        out.put("points",        i(r.get("points")));
        out.put("timeLimitMin",  i(r.get("time_limit_min")));
        out.put("memoryLimitMB", i(r.get("memory_limit_mb")));
        out.put("languages",     jsonList(r.get("languages")));
        out.put("statement",     r.get("statement"));
        out.put("samples",       jsonList(r.get("samples")));
        out.put("sig",           r.get("sig") != null ? jsonMap(r.get("sig")) : null);
        out.put("hint",          r.getOrDefault("hint", ""));
        out.put("unordered",     bool(r.get("unordered")));
        out.put("starters",      r.get("starters") != null ? jsonMap(r.get("starters")) : new HashMap<>());
        out.put("custom",        bool(r.get("custom")));
        out.put("retired",       bool(r.get("retired")));
        out.put("updatedAt",     i(r.get("updated_at")));
        // caseCount: count of hidden test cases (array length)
        Object cases = r.get("cases");
        int caseCount = 0;
        if (cases instanceof String s) {
            try {
                List<?> list = mapper.readValue(s, new TypeReference<List<?>>(){});
                caseCount = list.size();
            } catch (Exception ignored) {}
        }
        out.put("caseCount", caseCount);
        return out;
    }

    /** Admin view: adds the hidden test cases and editorial approach. */
    public Map<String, Object> shapeQuestionAdmin(Map<String, Object> r) {
        Map<String, Object> out = shapeQuestionPublic(r);
        out.put("cases",    jsonList(r.get("cases")));
        out.put("approach", r.getOrDefault("approach", ""));
        return out;
    }

    // ---------- other shapes ----------

    public Map<String, Object> shapeBook(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("title", r.get("title"));
        m.put("author", r.get("author"));
        m.put("subject", r.get("subject"));
        m.put("licence", r.get("licence"));
        m.put("url", r.get("url"));
        m.put("status", r.get("status"));
        m.put("submittedBy", r.get("submitted_by"));
        m.put("note", r.getOrDefault("note", ""));
        m.put("createdAt", i(r.get("created_at")));
        m.put("decidedAt", r.get("decided_at") != null ? i(r.get("decided_at")) : null);
        return m;
    }

    public Map<String, Object> shapeAchievement(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("name", r.get("name"));
        m.put("desc", r.getOrDefault("descr", r.getOrDefault("desc", "")));
        m.put("metric", r.get("metric"));
        m.put("target", i(r.get("target")));
        m.put("icon", r.get("icon"));
        return m;
    }

    public Map<String, Object> shapeMistake(Map<String, Object> r) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id",          r.get("id"));
        out.put("userId",      r.get("user_id"));
        out.put("questionId",  r.get("question_id"));
        out.put("roomId",      r.get("room_id"));
        out.put("lastCode",    r.getOrDefault("last_code", ""));
        out.put("failingCase", r.get("failing_case"));
        out.put("solved",      bool(r.get("solved")));
        out.put("solvedAt",    r.get("solved_at") != null ? i(r.get("solved_at")) : null);
        out.put("at",          i(r.get("at")));
        return out;
    }

    public Map<String, Object> shapeSubmission(Map<String, Object> r) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id",         r.get("id"));
        out.put("roomId",     r.get("room_id"));
        out.put("userId",     r.get("user_id"));
        out.put("questionId", r.get("question_id"));
        out.put("lang",       r.get("lang"));
        out.put("code",       r.get("code"));
        out.put("passed",     i(r.get("passed")));
        out.put("total",      i(r.get("total")));
        out.put("ok",         bool(r.get("ok")));
        out.put("timeMs",     i(r.get("time_ms")));
        out.put("simulated",  bool(r.get("simulated")));
        out.put("at",         i(r.get("at")));
        return out;
    }

    public Map<String, Object> shapeViolation(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("roomId", r.get("room_id"));
        m.put("userId", r.get("user_id"));
        m.put("type", r.get("type"));
        m.put("at", i(r.get("at")));
        return m;
    }

    public Map<String, Object> shapeNotification(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("userId", r.get("user_id"));
        m.put("type", r.get("type"));
        m.put("roomId", r.get("room_id"));
        m.put("reason", r.getOrDefault("reason", ""));
        m.put("at", i(r.get("at")));
        return m;
    }

    public Map<String, Object> shapeLedger(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("userId", r.get("user_id"));
        m.put("type", r.get("type"));
        m.put("amountPaise", i(r.get("amount_paise")));
        m.put("note", r.get("note"));
        m.put("roomId", r.get("room_id"));
        m.put("at", i(r.get("at")));
        return m;
    }

    public Map<String, Object> shapePayment(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("roomId", r.get("room_id"));
        m.put("userId", r.get("user_id"));
        m.put("amountPaise", i(r.get("amount_paise")));
        m.put("kind", r.get("kind"));
        m.put("status", r.get("status"));
        m.put("at", i(r.get("at")));
        return m;
    }

    public Map<String, Object> shapePayout(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("roomId", r.get("room_id"));
        m.put("userId", r.get("user_id"));
        m.put("amountPaise", i(r.get("amount_paise")));
        m.put("rank", i(r.get("finish_rank")));
        m.put("status", r.get("status"));
        m.put("at", i(r.get("at")));
        return m;
    }

    public Map<String, Object> shapeDispute(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("roomId", r.get("room_id"));
        m.put("userId", r.get("user_id"));
        m.put("reason", r.get("reason"));
        m.put("status", r.get("status"));
        m.put("resolution", r.getOrDefault("resolution", ""));
        m.put("at", i(r.get("at")));
        return m;
    }
}
