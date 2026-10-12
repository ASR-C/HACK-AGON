package com.hackagon.util;

import java.security.SecureRandom;
import java.util.HexFormat;

/**
 * Mirrors the Node.js uid() and inviteCode() utility functions.
 * Generates the same id shapes so existing stored rows keep working.
 */
public class IdUtil {
    private static final SecureRandom RNG = new SecureRandom();

    /** Generates "prefix_<5 random hex bytes><4 chars of epoch base36>" */
    public static String uid(String prefix) {
        byte[] bytes = new byte[5];
        RNG.nextBytes(bytes);
        String hex = HexFormat.of().formatHex(bytes);
        long ts = System.currentTimeMillis();
        String base36 = Long.toString(ts, 36);
        String tsSlice = base36.length() >= 4 ? base36.substring(base36.length() - 4) : base36;
        return (prefix != null ? prefix : "id") + "_" + hex + tsSlice;
    }

    /** 6-character uppercase invite code (same entropy as the Node version). */
    public static String inviteCode() {
        byte[] bytes = new byte[4];
        RNG.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes).toUpperCase().substring(0, 6);
    }

    /** 6-digit numeric OTP (100000–999999). */
    public static String otpCode() {
        int code = 100000 + RNG.nextInt(900000);
        return String.valueOf(code);
    }

    public static long now() {
        return System.currentTimeMillis();
    }

    /** Integer money: paise from rupees. */
    public static long inrToPaise(Number n) {
        return Math.round((n == null ? 0 : n.doubleValue()) * 100);
    }

    /** 1% platform fee on the prize pool (same as the JS version). */
    public static long platformFee(long poolPaise) {
        return Math.round(poolPaise * 0.01);
    }

    public static boolean toBool(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.intValue() != 0;
        return "1".equals(v.toString()) || "true".equalsIgnoreCase(v.toString());
    }

    public static long toLong(Object v) {
        if (v == null) return 0L;
        if (v instanceof Number n) return n.longValue();
        try { return Long.parseLong(v.toString().trim()); } catch (Exception e) { return 0L; }
    }

    public static int toInt(Object v) {
        if (v == null) return 0;
        if (v instanceof Number n) return n.intValue();
        try { return Integer.parseInt(v.toString().trim()); } catch (Exception e) { return 0; }
    }
}
