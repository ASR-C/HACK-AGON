package com.hackagon.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hackagon.util.HttpException;
import com.hackagon.util.IdUtil;
import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * OTP lifecycle service matching server/lib/otp.js.
 * Manages 6-digit verification codes in the `otps` table with 5-minute expiry,
 * 5 attempts limit, 60-second resend cooldown, and bcrypt hashing.
 */
@Service
public class OtpService {

    public static final long EXPIRY_MS = 5 * 60 * 1000L;
    public static final int MAX_ATTEMPTS = 5;
    public static final long RESEND_MS = 60 * 1000L;

    private final DatabaseService db;
    private final JavaMailSender mailSender;
    private final ObjectMapper mapper;
    private final boolean exposeOtp;
    private final String fromEmail;
    private final String brevoApiKey;
    private final String brevoSender;
    private final String fromName;

    public OtpService(DatabaseService db,
                      @Autowired(required = false) JavaMailSender mailSender,
                      ObjectMapper mapper,
                      @Value("${hackagon.expose-otp:false}") boolean exposeOtp,
                      @Value("${spring.mail.username:}") String fromEmail,
                      @Value("${hackagon.brevo.api-key:}") String brevoApiKey,
                      @Value("${hackagon.brevo.sender:}") String brevoSender,
                      @Value("${hackagon.mail.from-name:HackAgon}") String fromName) {
        this.db = db;
        this.mailSender = mailSender;
        this.mapper = mapper;
        this.exposeOtp = exposeOtp;
        this.fromEmail = fromEmail;
        this.brevoApiKey = brevoApiKey;
        this.brevoSender = brevoSender;
        this.fromName = fromName;
    }

    public Optional<Map<String, Object>> getOtp(String id) {
        if (id == null || id.isBlank()) return Optional.empty();
        return db.one("SELECT * FROM otps WHERE id = ?", id);
    }

    public Optional<Map<String, Object>> latestFor(String email, String mobile, String purpose) {
        if (email != null && !email.isBlank()) {
            return db.one("SELECT * FROM otps WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1",
                    email.trim().toLowerCase(), purpose);
        }
        if (mobile != null && !mobile.isBlank()) {
            String normMobile = mobile.replaceAll("\\D", "");
            if (normMobile.length() > 10) normMobile = normMobile.substring(normMobile.length() - 10);
            return db.one("SELECT * FROM otps WHERE mobile = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1",
                    normMobile, purpose);
        }
        return Optional.empty();
    }

    public Map<String, Object> requestOtp(String email, String mobile, String purpose,
                                         String userId, String name, Map<String, Object> meta) {
        String normEmail = (email != null && !email.isBlank()) ? email.trim().toLowerCase() : null;
        String normMobile = (mobile != null && !mobile.isBlank()) ? mobile.replaceAll("\\D", "") : null;
        if (normMobile != null && normMobile.length() > 10) {
            normMobile = normMobile.substring(normMobile.length() - 10);
        }

        if (normEmail == null && normMobile == null) {
            throw HttpException.bad("Give an email or a mobile number.");
        }

        long now = IdUtil.now();

        // Check 60-second cooldown
        Optional<Map<String, Object>> last = latestFor(normEmail, normMobile, purpose);
        if (last.isPresent()) {
            long resendAt = IdUtil.toLong(last.get().get("resend_at"));
            if (now < resendAt) {
                int retryInSecs = (int) Math.ceil((resendAt - now) / 1000.0);
                Map<String, Object> cooldownResp = new LinkedHashMap<>();
                cooldownResp.put("ok", false);
                cooldownResp.put("msg", "Wait a moment before asking for another code.");
                cooldownResp.put("retryInSecs", retryInSecs);
                cooldownResp.put("otpId", last.get().get("id"));
                return cooldownResp;
            }
        }

        // Expire older active codes for this target and purpose
        if (normEmail != null) {
            db.run("UPDATE otps SET verified = 0, expires_at = 0 WHERE email = ? AND purpose = ? AND expires_at > ?",
                    normEmail, purpose, now);
        } else {
            db.run("UPDATE otps SET verified = 0, expires_at = 0 WHERE mobile = ? AND purpose = ? AND expires_at > ?",
                    normMobile, purpose, now);
        }

        String code = IdUtil.otpCode();
        String id = IdUtil.uid("otp");
        String codeHash = BCrypt.hashpw(code, BCrypt.gensalt(8));
        String metaJson = null;
        if (meta != null) {
            try { metaJson = mapper.writeValueAsString(meta); } catch (Exception ignored) {}
        }

        db.run("INSERT INTO otps (id, email, mobile, code_hash, purpose, user_id, created_at, expires_at, attempts, max_attempts, resend_at, verified, meta) " +
               "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)",
               id, normEmail, normMobile, codeHash, purpose, userId, now, now + EXPIRY_MS, MAX_ATTEMPTS, now + RESEND_MS, metaJson);

        boolean mailed = false;
        String mailError = null;
        if (normEmail != null) {
            try {
                mailed = sendEmail(normEmail, name, code, purpose);
            } catch (Exception e) {
                mailError = e.getMessage();
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("otpId", id);
        out.put("expiresAt", now + EXPIRY_MS);
        out.put("resendAt", now + RESEND_MS);
        out.put("maxAttempts", MAX_ATTEMPTS);
        out.put("channel", mailed ? "email" : (normEmail != null ? "none" : "sms"));
        out.put("mailed", mailed);
        if (mailError != null) out.put("mailError", mailError);
        if (exposeOtp) {
            out.put("devCode", code);
            out.put("otp", code);
        }
        return out;
    }

    public Map<String, Object> verifyOtp(String id, String code) {
        Optional<Map<String, Object>> opt = getOtp(id);
        if (opt.isEmpty()) return Map.of("ok", false, "msg", "That code expired. Ask for a new one.");
        Map<String, Object> o = opt.get();

        long now = IdUtil.now();
        long expiresAt = IdUtil.toLong(o.get("expires_at"));
        int attempts = IdUtil.toInt(o.get("attempts"));
        int maxAttempts = o.get("max_attempts") != null ? IdUtil.toInt(o.get("max_attempts")) : MAX_ATTEMPTS;

        if (now > expiresAt) return Map.of("ok", false, "msg", "That code expired. Ask for a new one.");
        if (attempts >= maxAttempts) return Map.of("ok", false, "msg", "Too many tries. Request a fresh code.");

        boolean alreadyVerified = IdUtil.toBool(o.get("verified"));
        if (alreadyVerified) {
            return Map.of("ok", true, "alreadyVerified", true, "otp", o);
        }

        int nextAttempts = attempts + 1;
        String codeHash = o.get("code_hash") != null ? o.get("code_hash").toString() : "";
        boolean matched = false;
        try {
            matched = BCrypt.checkpw(code != null ? code.trim() : "", codeHash);
        } catch (Exception ignored) {}

        db.run("UPDATE otps SET attempts = ?, verified = ? WHERE id = ?", nextAttempts, matched ? 1 : 0, id);

        if (!matched) {
            int left = Math.max(0, maxAttempts - nextAttempts);
            return Map.of("ok", false, "msg", "That code didn't match. Try once more.", "left", left);
        }

        return Map.of("ok", true, "otp", getOtp(id).orElse(o));
    }

    private boolean sendEmail(String toEmail, String name, String code, String purpose) {
        String subject = "Your HackAgon verification code: " + code;
        String greeting = (name != null && !name.isBlank()) ? "Hi " + name + "," : "Hello,";
        String action = "signup".equalsIgnoreCase(purpose) ? "finish creating your account" :
                        "forgot".equalsIgnoreCase(purpose) ? "reset your password" : "log in to HackAgon";

        String textContent = greeting + "\n\nUse the following 6-digit code to " + action + ": " + code +
                             "\n\nThis code expires in 5 minutes. If you did not request this, you can ignore this email.";

        String html = "<div style=\"font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px;\">" +
                      "<h2 style=\"color:#b4523a;\">HackAgon</h2>" +
                      "<p>" + greeting + "</p>" +
                      "<p>Use the following 6-digit code to " + action + ":</p>" +
                      "<div style=\"font-size:32px;font-weight:bold;letter-spacing:6px;color:#2a211b;padding:12px 0;\">" + code + "</div>" +
                      "<p style=\"color:#666;font-size:12px;\">This code expires in 5 minutes. If you did not request this, you can ignore this email.</p>" +
                      "</div>";

        // 1. Try Brevo HTTPS API first (highly reliable, no outbound port blocking)
        if (brevoApiKey != null && !brevoApiKey.isBlank()) {
            boolean brevoSent = sendViaBrevo(toEmail, subject, textContent, html);
            if (brevoSent) return true;
        }

        // 2. Fallback to Spring Mail / JavaMailSender SMTP
        if (mailSender == null) return false;
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            String sender = (brevoSender != null && !brevoSender.isBlank()) ? brevoSender :
                            (fromEmail != null && !fromEmail.isBlank()) ? fromEmail : "noreply@hackagon.local";
            helper.setFrom(sender, (fromName != null && !fromName.isBlank()) ? fromName : "HackAgon");
            helper.setTo(toEmail);
            helper.setSubject(subject);
            helper.setText(html, true);
            mailSender.send(message);
            return true;
        } catch (Exception e) {
            System.err.println("SMTP mail failed: " + e.getMessage());
            return false;
        }
    }

    private boolean sendViaBrevo(String toEmail, String subject, String textContent, String htmlContent) {
        if (brevoApiKey == null || brevoApiKey.isBlank()) return false;
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            String senderEmail = (brevoSender != null && !brevoSender.isBlank()) ? brevoSender : fromEmail;
            body.put("sender", Map.of("name", (fromName != null && !fromName.isBlank()) ? fromName : "HackAgon", "email", senderEmail));
            body.put("to", List.of(Map.of("email", toEmail)));
            body.put("subject", subject);
            body.put("textContent", textContent);
            body.put("htmlContent", htmlContent);

            String json = mapper.writeValueAsString(body);

            HttpClient client = HttpClient.newHttpClient();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("https://api.brevo.com/v3/smtp/email"))
                    .header("api-key", brevoApiKey.trim())
                    .header("content-type", "application/json")
                    .header("accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                return true;
            } else {
                System.err.println("Brevo API error " + response.statusCode() + ": " + response.body());
                return false;
            }
        } catch (Exception e) {
            System.err.println("Brevo exception: " + e.getMessage());
            return false;
        }
    }
}
