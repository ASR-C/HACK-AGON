package com.hackagon.controller;

import com.hackagon.service.DatabaseService;
import com.hackagon.service.DomainService;
import com.hackagon.service.JwtService;
import com.hackagon.service.OtpService;
import com.hackagon.service.RepoService;
import com.hackagon.util.HttpException;
import com.hackagon.util.IdUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * Authentication controller — mirrors routes/auth.js from the Node.js server.
 *
 * POST /api/auth/signup       — create account
 * POST /api/auth/login        — login (supports email OR username)
 * GET  /api/auth/otp/{id}/meta— OTP metadata (masked target, expiresAt)
 * POST /api/auth/verify       — verify OTP
 * POST /api/auth/resend       — resend OTP
 * POST /api/auth/forgot       — request password reset OTP
 * POST /api/auth/reset        — reset password with OTP
 * GET  /api/auth/me           — get current user profile with achievements & mistakes
 * PATCH /api/auth/me          — update profile
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController extends BaseController {

    private final JwtService jwt;
    private final OtpService otpService;
    private final DomainService domainService;
    private final RepoService repoService;
    private final boolean exposeOtp;
    private final List<String> adminEmails;

    public AuthController(DatabaseService db, JwtService jwt, OtpService otpService,
                          DomainService domainService, RepoService repoService,
                          @Value("${hackagon.expose-otp:false}") boolean exposeOtp,
                          @Value("${hackagon.admin-emails:akshatrathorerevoluate@gmail.com}") String adminEmailsStr) {
        super(db);
        this.jwt           = jwt;
        this.otpService    = otpService;
        this.domainService = domainService;
        this.repoService   = repoService;
        this.exposeOtp     = exposeOtp;
        this.adminEmails   = Arrays.stream(adminEmailsStr.split(","))
                .map(String::trim).map(String::toLowerCase).toList();
    }

    // ---------- signup ----------

    @PostMapping("/signup")
    public ResponseEntity<Map<String, Object>> signup(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) throw HttpException.bad("Missing signup parameters.");
        String email    = str(body.get("email")).toLowerCase().trim();
        String password = str(body.get("password"));
        String name     = str(body.get("name")).trim();
        String username = str(body.get("username")).toLowerCase().trim();
        String mobile   = str(body.get("mobile")).replaceAll("\\D", "");
        if (mobile.length() > 10) mobile = mobile.substring(mobile.length() - 10);
        String dob      = str(body.get("dob"));

        Map<String, String> errs = new LinkedHashMap<>();
        if (name.length() < 2)            errs.put("name", "Give us at least a two-character name.");
        if (email.length() < 5 || !email.contains("@")) errs.put("email", "Enter a valid email.");
        if (username.length() < 3)        errs.put("username", "At least 3 characters, please.");
        if (mobile.length() != 10)        errs.put("mobile", "Enter a 10-digit mobile number.");
        if (password.length() < 8)        errs.put("password", "Password must be at least 8 characters.");

        if (db.one("SELECT id FROM users WHERE email = ?", email).isPresent())
            errs.put("email", "That email is already registered — try logging in.");
        if (db.one("SELECT id FROM users WHERE username = ?", username).isPresent())
            errs.put("username", "That username is taken.");
        if (!mobile.isEmpty() && db.one("SELECT id FROM users WHERE mobile = ?", mobile).isPresent())
            errs.put("mobile", "That number is already registered.");

        if (!errs.isEmpty()) {
            throw new HttpException(422, "Check the highlighted fields.", Map.of("errs", errs));
        }

        String id     = IdUtil.uid("u");
        String hash   = BCrypt.hashpw(password, BCrypt.gensalt(10));
        int isAdmin   = adminEmails.contains(email) ? 1 : 0;
        long now      = IdUtil.now();

        String freshStats = "{\"gamesPlayed\":0,\"gamesWon\":0,\"duelsPlayed\":0,\"duelsWon\":0,\"problemsSolved\":0,\"streakDays\":0,\"violationsCount\":0}";

        db.run("INSERT INTO users (id,name,username,email,mobile,password_hash,dob,verified,bio,langs,payout,org,is_admin,stats,created_at) " +
               "VALUES (?,?,?,?,?,?,?,0,'',?,NULL,NULL,?,?,?)",
               id, name.substring(0, Math.min(name.length(), 120)), username, email, mobile, hash,
               dob.isBlank() ? null : dob, "[\"javascript\"]", isAdmin, freshStats, now);

        Map<String, Object> sent = otpService.requestOtp(email, mobile, "signup", id, name, null);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("userId", id);
        resp.put("email", email);
        resp.put("otp", sent);
        resp.put("needVerify", true);
        return ResponseEntity.status(201).body(resp);
    }

    // ---------- login ----------

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) throw new HttpException(422, "Enter your email or username and password.");

        // Support identifier, email, or username keys from client
        String identifier = "";
        if (body.get("identifier") != null) identifier = str(body.get("identifier")).toLowerCase().trim();
        else if (body.get("email") != null) identifier = str(body.get("email")).toLowerCase().trim();
        else if (body.get("username") != null) identifier = str(body.get("username")).toLowerCase().trim();

        String password = str(body.get("password"));

        if (identifier.isBlank() || password.isBlank()) {
            throw new HttpException(422, "Enter your email or username and password.");
        }

        // Look up user by EITHER email OR username
        Optional<Map<String, Object>> row = db.one("SELECT * FROM users WHERE email = ? OR username = ?", identifier, identifier);
        if (row.isEmpty()) throw new HttpException(401, "No account with that email or username.");
        Map<String, Object> user = row.get();

        String hash = user.get("password_hash") != null ? user.get("password_hash").toString() : "";
        if (hash.isBlank() || !BCrypt.checkpw(password, hash)) {
            throw new HttpException(401, "Wrong password. Try again.");
        }

        boolean verified = IdUtil.toBool(user.get("verified"));

        if (!verified) {
            String uEmail = user.get("email") != null ? user.get("email").toString() : null;
            String uMobile = user.get("mobile") != null ? user.get("mobile").toString() : null;
            String uName = user.get("name") != null ? user.get("name").toString() : null;
            Map<String, Object> sent = otpService.requestOtp(uEmail, uMobile, "login", user.get("id").toString(), uName, null);

            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", false);
            resp.put("needVerify", true);
            resp.put("userId", user.get("id"));
            resp.put("email", uEmail);
            resp.put("otp", sent);
            resp.put("msg", "Your account isn't verified yet. Finish the OTP step.");
            return resp;
        }

        boolean isAdmin = IdUtil.toBool(user.get("is_admin"));
        String token = jwt.issue(user.get("id").toString(), user.get("username").toString(), isAdmin);
        return Map.of("ok", true, "user", publicProfile(user), "token", token);
    }

    // ---------- OTP metadata ----------

    @GetMapping("/otp/{id}/meta")
    public Map<String, Object> otpMeta(@PathVariable("id") String id) {
        Optional<Map<String, Object>> row = otpService.getOtp(id);
        if (row.isEmpty()) throw new HttpException(404, "That code expired. Ask for a new one.");
        Map<String, Object> o = row.get();

        String email = o.get("email") != null ? o.get("email").toString() : null;
        String mobile = o.get("mobile") != null ? o.get("mobile").toString() : null;
        String target = null;
        if (email != null && email.contains("@")) {
            String[] parts = email.split("@", 2);
            target = (parts[0].length() > 2 ? parts[0].substring(0, 2) + "***" : parts[0] + "***") + "@" + parts[1];
        } else if (mobile != null && mobile.length() >= 4) {
            target = "····· " + mobile.substring(mobile.length() - 4);
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("otpId", o.get("id"));
        meta.put("purpose", o.get("purpose"));
        meta.put("channel", email != null ? "email" : "sms");
        meta.put("target", target);
        meta.put("expiresAt", IdUtil.toLong(o.get("expires_at")));
        meta.put("resendAt", IdUtil.toLong(o.get("resend_at")));
        meta.put("attempts", IdUtil.toInt(o.get("attempts")));
        meta.put("maxAttempts", o.get("max_attempts") != null ? IdUtil.toInt(o.get("max_attempts")) : OtpService.MAX_ATTEMPTS);
        meta.put("verified", IdUtil.toBool(o.get("verified")));
        meta.put("userId", o.get("user_id"));

        return Map.of("ok", true, "meta", meta);
    }

    // ---------- verify ----------

    @PostMapping("/verify")
    public Map<String, Object> verify(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) throw HttpException.bad("Missing verification parameters.");
        String otpId   = str(body.get("otpId"));
        String code    = str(body.get("code"));
        if (code.isBlank() && body.get("otp") != null) code = str(body.get("otp"));
        String email   = str(body.get("email")).toLowerCase().trim();
        String purpose = body.get("purpose") != null ? str(body.get("purpose")) : "signup";

        Optional<Map<String, Object>> rowOpt = !otpId.isBlank()
                ? otpService.getOtp(otpId)
                : otpService.latestFor(email, null, purpose);

        if (rowOpt.isEmpty()) throw new HttpException(404, "That code expired. Ask for a new one.");
        Map<String, Object> row = rowOpt.get();

        Map<String, Object> result = otpService.verifyOtp(row.get("id").toString(), code);
        if (!Boolean.TRUE.equals(result.get("ok"))) {
            Map<String, Object> extra = new LinkedHashMap<>();
            if (result.get("left") != null) extra.put("left", result.get("left"));
            extra.put("otpId", row.get("id"));
            throw new HttpException(400, result.getOrDefault("msg", "Wrong verification code.").toString(), extra);
        }

        Object userId = row.get("user_id");
        if (userId != null && !userId.toString().isBlank()) {
            db.run("UPDATE users SET verified = 1 WHERE id = ? AND verified = 0", userId);
            Optional<Map<String, Object>> uRow = db.one("SELECT * FROM users WHERE id = ?", userId);
            if (uRow.isPresent()) {
                Map<String, Object> user = uRow.get();
                boolean isAdmin = IdUtil.toBool(user.get("is_admin"));
                String token = jwt.issue(user.get("id").toString(), user.get("username").toString(), isAdmin);
                return Map.of("ok", true, "activated", true, "user", publicProfile(user), "token", token);
            }
        }

        return Map.of("ok", true, "activated", false);
    }

    // ---------- resend ----------

    @PostMapping("/resend")
    public Map<String, Object> resend(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) throw HttpException.bad("Missing resend parameters.");
        String otpId   = str(body.get("otpId"));
        String email   = str(body.get("email")).toLowerCase().trim();
        String mobile  = str(body.get("mobile"));
        String purpose = body.get("purpose") != null ? str(body.get("purpose")) : "signup";
        String name    = str(body.get("name"));
        String userId  = null;

        if (!otpId.isBlank()) {
            Optional<Map<String, Object>> rowOpt = otpService.getOtp(otpId);
            if (rowOpt.isEmpty()) throw new HttpException(404, "That code expired. Ask for a new one.");
            Map<String, Object> row = rowOpt.get();
            long resendAt = IdUtil.toLong(row.get("resend_at"));
            if (IdUtil.now() < resendAt) {
                int retryInSecs = (int) Math.ceil((resendAt - IdUtil.now()) / 1000.0);
                throw new HttpException(429, "Hold on — you can ask for a new code in a moment.", Map.of("retryInSecs", retryInSecs));
            }
            if (row.get("email") != null) email = row.get("email").toString();
            if (row.get("mobile") != null) mobile = row.get("mobile").toString();
            if (row.get("purpose") != null) purpose = row.get("purpose").toString();
            if (row.get("user_id") != null) userId = row.get("user_id").toString();
        }

        Map<String, Object> sent = otpService.requestOtp(email, mobile, purpose, userId, name, null);
        if (Boolean.FALSE.equals(sent.get("ok"))) {
            throw new HttpException(429, sent.getOrDefault("msg", "Please wait.").toString(), sent);
        }
        return Map.of("ok", true, "otp", sent);
    }

    // ---------- forgot password ----------

    @PostMapping("/forgot")
    public Map<String, Object> forgot(@RequestBody(required = false) Map<String, Object> body) {
        String email = body != null ? str(body.get("email")).toLowerCase().trim() : "";
        Optional<Map<String, Object>> row = db.one("SELECT id, name, email FROM users WHERE email = ?", email);
        if (row.isEmpty()) {
            // Keep reply neutral for security
            return Map.of("ok", true, "sent", false);
        }
        Map<String, Object> user = row.get();
        Map<String, Object> sent = otpService.requestOtp(email, null, "forgot",
                user.get("id").toString(), user.get("name") != null ? user.get("name").toString() : null, null);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("sent", !Boolean.FALSE.equals(sent.get("ok")));
        if (!Boolean.FALSE.equals(sent.get("ok"))) resp.put("otp", sent);
        if (sent.get("retryInSecs") != null) resp.put("retryInSecs", sent.get("retryInSecs"));
        return resp;
    }

    // ---------- reset password ----------

    @PostMapping("/reset")
    public Map<String, Object> reset(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) throw HttpException.bad("Missing reset parameters.");
        String otpId    = str(body.get("otpId"));
        String code     = str(body.get("code"));
        String email    = str(body.get("email")).toLowerCase().trim();
        String password = str(body.get("password"));

        if (password.length() < 8) {
            throw new HttpException(422, "New password needs 8+ characters.");
        }

        Optional<Map<String, Object>> rowOpt = !otpId.isBlank()
                ? otpService.getOtp(otpId)
                : otpService.latestFor(email, null, "forgot");

        if (rowOpt.isEmpty() || !"forgot".equals(rowOpt.get().get("purpose"))) {
            throw new HttpException(404, "Start the reset again — that code isn't valid.");
        }
        Map<String, Object> row = rowOpt.get();

        // If code provided, verify it; otherwise ensure already verified
        if (!code.isBlank()) {
            Map<String, Object> result = otpService.verifyOtp(row.get("id").toString(), code);
            if (!Boolean.TRUE.equals(result.get("ok"))) {
                throw new HttpException(400, result.getOrDefault("msg", "Wrong verification code.").toString(),
                        Map.of("left", result.getOrDefault("left", 0), "otpId", row.get("id")));
            }
        } else {
            boolean verified = IdUtil.toBool(row.get("verified"));
            if (!verified) throw new HttpException(400, "Verify your code first.");
        }

        Object userId = row.get("user_id");
        if (userId == null) throw new HttpException(400, "That code isn't tied to an account.");

        String hash = BCrypt.hashpw(password, BCrypt.gensalt(10));
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", hash, userId);
        db.run("UPDATE otps SET expires_at = 0 WHERE id = ?", row.get("id"));

        Optional<Map<String, Object>> uRow = db.one("SELECT * FROM users WHERE id = ?", userId);
        if (uRow.isEmpty()) throw new HttpException(404, "Account not found.");
        Map<String, Object> user = uRow.get();
        boolean isAdmin = IdUtil.toBool(user.get("is_admin"));
        String token = jwt.issue(user.get("id").toString(), user.get("username").toString(), isAdmin);
        return Map.of("ok", true, "user", publicProfile(user), "token", token);
    }

    // ---------- me ----------

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = user.get("id").toString();

        List<Map<String, Object>> achievements = domainService.achievementsFor(userId);
        List<Map<String, Object>> mistakes = db.q("SELECT * FROM mistakes WHERE user_id = ? ORDER BY at DESC LIMIT 100", userId)
                .stream().map(repoService::shapeMistake).toList();
        List<Map<String, Object>> notifications = db.q("SELECT * FROM notifications WHERE user_id = ? ORDER BY at DESC LIMIT 50", userId)
                .stream().map(repoService::shapeNotification).toList();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("user", user);
        out.put("achievements", achievements);
        out.put("mistakes", mistakes);
        out.put("notifications", notifications);
        return out;
    }

    @PatchMapping("/me")
    public Map<String, Object> updateMe(@RequestBody(required = false) Map<String, Object> patch, HttpServletRequest req) {
        if (patch == null || patch.isEmpty()) throw HttpException.bad("Nothing to update.");
        Map<String, Object> user = requireUser(req);
        List<String> sets = new ArrayList<>();
        List<Object> params = new ArrayList<>();

        if (patch.containsKey("name") && patch.get("name") != null) {
            String n = str(patch.get("name")).trim();
            if (n.length() >= 2) {
                sets.add("name = ?");
                params.add(n.substring(0, Math.min(n.length(), 120)));
            }
        }
        if (patch.containsKey("bio")) {
            sets.add("bio = ?");
            params.add(str(patch.get("bio")).substring(0, Math.min(str(patch.get("bio")).length(), 500)));
        }
        if (patch.containsKey("mobile")) {
            String m = str(patch.get("mobile")).replaceAll("\\D", "");
            if (m.length() > 10) m = m.substring(m.length() - 10);
            sets.add("mobile = ?");
            params.add(m);
        }
        if (patch.containsKey("payout")) {
            sets.add("payout = ?");
            try {
                params.add(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(patch.get("payout")));
            } catch (Exception e) {
                params.add(null);
            }
        }
        if (patch.containsKey("langs") && patch.get("langs") instanceof List) {
            sets.add("langs = ?");
            try {
                params.add(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(patch.get("langs")));
            } catch (Exception e) {
                params.add("[\"javascript\"]");
            }
        }

        if (sets.isEmpty()) throw HttpException.bad("Nothing to update.");
        params.add(user.get("id"));
        db.run("UPDATE users SET " + String.join(", ", sets) + " WHERE id = ?", params.toArray());

        Optional<Map<String, Object>> updated = db.one("SELECT * FROM users WHERE id = ?", user.get("id"));
        return Map.of("ok", true, "user", updated.map(this::publicProfile).orElseThrow());
    }

    // ---------- helpers ----------

    private static String str(Object v) {
        return v == null ? "" : v.toString();
    }

    private Map<String, Object> publicProfile(Map<String, Object> r) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id",        r.get("id"));
        out.put("name",      r.get("name"));
        out.put("username",  r.get("username"));
        out.put("email",     r.get("email"));
        out.put("mobile",    r.get("mobile"));
        out.put("dob",       r.get("dob") != null ? r.get("dob").toString() : null);
        out.put("bio",       r.getOrDefault("bio", ""));
        out.put("verified",  IdUtil.toBool(r.get("verified")));
        out.put("isAdmin",   IdUtil.toBool(r.get("is_admin")));
        out.put("org",       r.get("org"));
        out.put("stats",     r.get("stats"));
        out.put("payout",    r.get("payout"));
        out.put("createdAt", IdUtil.toLong(r.get("created_at")));
        return out;
    }
}
