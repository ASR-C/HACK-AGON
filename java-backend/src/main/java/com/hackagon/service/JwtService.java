package com.hackagon.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/**
 * JWT signing and validation.
 * Token shape matches the Node.js server so existing browser tokens
 * continue to work when switching backends.
 */
@Service
public class JwtService {

    private final SecretKey key;
    private final long expiryMs;

    public JwtService(
            @Value("${hackagon.jwt.secret:hackagon-dev-secret-change-in-production}") String secret,
            @Value("${hackagon.jwt.expiry-ms:2592000000}") long expiryMs) {
        // Pad the secret to at least 32 bytes so HS256 is always valid
        String padded = secret.length() < 32 ? secret + "0".repeat(32 - secret.length()) : secret;
        this.key = Keys.hmacShaKeyFor(padded.getBytes(StandardCharsets.UTF_8));
        this.expiryMs = expiryMs;
    }

    /** Issue a JWT for an authenticated user. Claims mirror the Node.js payload. */
    public String issue(String userId, String username, boolean isAdmin) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .subject(userId)
                .claim("username", username)
                .claim("isAdmin", isAdmin)
                .issuedAt(new Date(now))
                .expiration(new Date(now + expiryMs))
                .signWith(key)
                .compact();
    }

    /** Validate a token and return its claims, or null if invalid/expired. */
    public Map<String, Object> validateAndExtract(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Map<String, Object> out = new HashMap<>(claims);
            out.put("sub", claims.getSubject());
            return out;
        } catch (Exception e) {
            return null;
        }
    }
}
