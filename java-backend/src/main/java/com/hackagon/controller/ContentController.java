package com.hackagon.controller;

import com.hackagon.service.DatabaseService;
import com.hackagon.service.DomainService;
import com.hackagon.service.RepoService;
import com.hackagon.util.HttpException;
import com.hackagon.util.IdUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Public and read-mostly content controller.
 * Implements /api/bootstrap, /api/questions, /api/books, /api/taxonomies, /api/achievements.
 * Mirrors server/routes/content.js.
 */
@RestController
@RequestMapping("/api")
public class ContentController extends BaseController {

    private final DomainService domain;
    private final RepoService repo;
    private final boolean exposeOtp;
    private final String groqModel;
    private final boolean groqConfigured;

    public ContentController(DatabaseService db, DomainService domain, RepoService repo,
                             @Value("${hackagon.expose-otp:false}") boolean exposeOtp,
                             @Value("${hackagon.groq.model:openai/gpt-oss-120b}") String groqModel,
                             @Value("${hackagon.groq.api-key:}") String groqKey) {
        super(db);
        this.domain = domain;
        this.repo = repo;
        this.exposeOtp = exposeOtp;
        this.groqModel = groqModel;
        this.groqConfigured = groqKey != null && !groqKey.isBlank();
    }

    // ---------- taxonomies ----------

    public Map<String, Object> taxonomies() {
        List<Map<String, Object>> topics = db.q("SELECT * FROM topics ORDER BY label");
        List<Map<String, Object>> languages = db.q("SELECT * FROM languages ORDER BY label");
        List<Map<String, Object>> prizePresets = db.q("SELECT * FROM prize_presets ORDER BY id");

        List<Map<String, Object>> topicsFormatted = topics.stream()
            .map(t -> Map.of("id", t.get("id"), "label", t.get("label")))
            .collect(Collectors.toList());

        List<Map<String, Object>> langsFormatted = languages.stream()
            .map(l -> Map.of("id", l.get("id"), "label", l.get("label")))
            .collect(Collectors.toList());

        List<Map<String, Object>> presetsFormatted = prizePresets.stream()
            .map(p -> {
                Map<String, Object> m = new HashMap<>();
                m.put("id", p.get("id"));
                m.put("label", p.get("label"));
                m.put("split", p.get("split") != null ? repo.shapeBook(p).getOrDefault("split", Map.of()) : Map.of());
                return m;
            }).collect(Collectors.toList());

        List<String> allLangs = languages.stream().map(l -> l.get("id").toString()).collect(Collectors.toList());

        return Map.of(
            "topics", topicsFormatted,
            "languages", langsFormatted,
            "prizePresets", presetsFormatted,
            "ALL_LANGS", allLangs
        );
    }

    public List<Map<String, Object>> books(String status) {
        String sql = status != null
            ? "SELECT * FROM books WHERE status = ? ORDER BY subject, title"
            : "SELECT * FROM books WHERE status <> 'rejected' ORDER BY subject, title";
        List<Map<String, Object>> rows = status != null ? db.q(sql, status) : db.q(sql);
        return rows.stream().map(repo::shapeBook).collect(Collectors.toList());
    }

    // ---------- bootstrap ----------

    @GetMapping("/bootstrap")
    public Map<String, Object> bootstrap(HttpServletRequest req) {
        List<Map<String, Object>> questions = domain.listQuestionsPublic(Map.of());
        List<Map<String, Object>> allBooks = books("approved");
        List<Map<String, Object>> achievements = db.q("SELECT * FROM achievements")
            .stream().map(repo::shapeAchievement).collect(Collectors.toList());
        Map<String, Object> tax = taxonomies();

        Map<String, Object> filter = new HashMap<>();
        filter.put("status", List.of("open", "live", "draft"));
        List<Map<String, Object>> rooms = domain.listRooms(filter);

        List<Map<String, Object>> platformRooms = db.q(
            "SELECT id,name,topics,duration_min,question_ids FROM rooms WHERE platform = 1 ORDER BY created_at"
        ).stream().map(r -> Map.of(
            "name", r.get("name"),
            "topics", r.get("topics") != null ? r.get("topics") : List.of(),
            "durationMin", r.get("duration_min") != null ? r.get("duration_min") : 15,
            "questions", r.get("question_ids") != null ? r.get("question_ids") : List.of()
        )).collect(Collectors.toList());

        Map<String, Object> seed = new LinkedHashMap<>(tax);
        seed.put("questions", questions);
        seed.put("books", allBooks);
        seed.put("achievements", achievements);
        seed.put("platformRooms", platformRooms);

        Map<String, Object> me = optionalUser(req).orElse(null);
        String authHeader = req.getHeader("Authorization");
        String token = (authHeader != null && authHeader.startsWith("Bearer ")) ? authHeader.substring(7) : null;

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("ok", true);
        payload.put("server", Map.of(
            "time", IdUtil.now(),
            "mail", Map.of("enabled", true, "exposeOtp", exposeOtp),
            "ai", Map.of("enabled", groqConfigured, "model", groqModel)
        ));
        payload.put("seed", seed);
        payload.put("rooms", rooms.stream().filter(r -> !Boolean.TRUE.equals(r.get("platform")) || !"draft".equals(r.get("status"))).collect(Collectors.toList()));
        payload.put("me", me);
        payload.put("token", token);
        return payload;
    }

    // ---------- questions ----------

    @GetMapping("/questions")
    public Map<String, Object> listQuestions(@RequestParam Map<String, String> params) {
        return Map.of("ok", true, "questions", domain.listQuestionsPublic(params));
    }

    @GetMapping("/questions/{id}")
    public Map<String, Object> getQuestion(@PathVariable String id) {
        Optional<Map<String, Object>> row = domain.getQuestionRow(id, false);
        if (row.isEmpty()) throw HttpException.notFound("No question with that id.");
        return Map.of("ok", true, "question", repo.shapeQuestionPublic(row.get()));
    }

    // ---------- books ----------

    @GetMapping("/books")
    public Map<String, Object> listBooks(@RequestParam(required = false) String subject) {
        List<Map<String, Object>> list = books("approved");
        List<Map<String, Object>> filtered = (subject != null && !subject.isBlank())
            ? list.stream().filter(b -> subject.equalsIgnoreCase((String) b.get("subject"))).collect(Collectors.toList())
            : list;
        Set<String> subjects = list.stream().map(b -> (String) b.get("subject")).filter(Objects::nonNull).collect(Collectors.toCollection(LinkedHashSet::new));
        return Map.of("ok", true, "books", filtered, "subjects", subjects);
    }

    @PostMapping("/books")
    public Map<String, Object> submitBook(@RequestBody Map<String, Object> b, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String title = b.get("title") != null ? b.get("title").toString().trim() : "";
        if (title.length() < 2) throw HttpException.bad("The book needs a title.");
        String url = b.get("url") != null ? b.get("url").toString().trim() : "";
        if (!url.startsWith("http://") && !url.startsWith("https://")) throw HttpException.bad("Add a link we can check the licence at.");
        String licence = b.get("licence") != null ? b.get("licence").toString().trim() : "";
        if (licence.length() < 3) throw HttpException.bad("Tell us the licence — the library only lists free or open-licence books.");

        String id = IdUtil.uid("bk");
        String author = b.get("author") != null ? b.get("author").toString().trim() : "Unknown";
        String subject = b.get("subject") != null ? b.get("subject").toString().trim() : "General";

        db.run(
            "INSERT INTO books (id,title,author,subject,licence,url,status,submitted_by,created_at) VALUES (?,?,?,?,?,?, 'pending', ?, ?)",
            id, title.substring(0, Math.min(title.length(), 200)), author.substring(0, Math.min(author.length(), 200)),
            subject.substring(0, Math.min(subject.length(), 120)), licence.substring(0, Math.min(licence.length(), 120)),
            url.substring(0, Math.min(url.length(), 500)), user.get("id"), IdUtil.now()
        );

        Optional<Map<String, Object>> created = db.one("SELECT * FROM books WHERE id = ?", id);
        return Map.of("ok", true, "book", created.map(repo::shapeBook).orElse(Map.of()));
    }

    // ---------- taxonomies ----------

    @GetMapping("/taxonomies")
    public Map<String, Object> getTaxonomies() {
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.putAll(taxonomies());
        return res;
    }

    // ---------- achievements ----------

    @GetMapping("/achievements")
    public Map<String, Object> getAchievements(HttpServletRequest req) {
        String userId = currentUserId(req);
        return Map.of("ok", true, "achievements", domain.achievementsFor(userId));
    }
}
