package com.hackagon.controller;

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
 * Money controller: prize funding, entry fee escrow, settlement, refund, and ledger.
 * Mirrors server/routes/money.js.
 */
@RestController
@RequestMapping("/api/money")
public class MoneyController extends BaseController {

    private final DomainService domain;
    private final RepoService repo;

    public MoneyController(DatabaseService db, DomainService domain, RepoService repo) {
        super(db);
        this.domain = domain;
        this.repo = repo;
    }

    private void requireAdmin(HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        if (!Boolean.TRUE.equals(user.get("isAdmin"))) {
            throw HttpException.forbidden("Only an admin can see platform-wide finances.");
        }
    }

    // ---------- prize fund ----------

    @PostMapping("/rooms/{id}/fund")
    public Map<String, Object> fundPrize(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        if (!room.get("hostId").equals(user.get("id")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host funds the prize pool.");
        long prizePool = ((Number) room.get("prizePoolPaise")).longValue();
        if (prizePool <= 0) throw HttpException.bad("This room has no prize pool to fund.");
        if (Boolean.TRUE.equals(room.get("funded")))
            return Map.of("ok", true, "already", true, "room", room);

        return Map.of("ok", true, "room", domain.fundPrize(id, (String) user.get("id")), "gateway", "simulated");
    }

    // ---------- entry fee ----------

    @PostMapping("/rooms/{id}/entry")
    public Map<String, Object> payEntry(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");
        Map<String, Object> room = domain.requireRoom(id);
        long entryFee = ((Number) room.get("entryFeePaise")).longValue();
        if (entryFee <= 0) throw HttpException.bad("This room is free to enter.");

        Optional<Map<String, Object>> existing = db.one(
            "SELECT id FROM payments WHERE room_id = ? AND user_id = ? AND kind = 'entry' AND status IN ('escrow','released')",
            id, userId
        );
        if (existing.isPresent()) return Map.of("ok", true, "already", true);

        domain.payEntry(id, userId);
        domain.joinRoom(id, userId);
        return Map.of("ok", true, "escrowedPaise", entryFee, "room", domain.getRoomFull(id), "gateway", "simulated");
    }

    // ---------- settle ----------

    @PostMapping("/rooms/{id}/settle")
    public Map<String, Object> settle(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        if (!room.get("hostId").equals(user.get("id")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host settles the prize.");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.putAll(domain.settlePayouts(id));
        return out;
    }

    // ---------- refund ----------

    @PostMapping("/rooms/{id}/refund")
    public Map<String, Object> refund(@PathVariable String id,
                                      @RequestBody(required = false) Map<String, Object> body,
                                      HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        if (!room.get("hostId").equals(user.get("id")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host can refund entries.");

        String reason = body != null && body.get("reason") != null ? body.get("reason").toString().trim() : "";
        int count = domain.refundAll(id, reason);
        return Map.of("ok", true, "refunded", count);
    }

    // ---------- room summary ----------

    @GetMapping("/rooms/{id}/summary")
    public Map<String, Object> summary(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        Map<String, Object> room = domain.requireRoom(id);
        if (!room.get("hostId").equals(user.get("id")) && !Boolean.TRUE.equals(user.get("isAdmin")))
            throw HttpException.forbidden("Only the host sees this room's money.");

        long escrowPaise = db.one("SELECT COALESCE(SUM(amount_paise),0) AS t FROM payments WHERE room_id = ? AND kind = 'entry' AND status = 'escrow'", id)
            .map(m -> ((Number) m.get("t")).longValue()).orElse(0L);
        long releasedPaise = db.one("SELECT COALESCE(SUM(amount_paise),0) AS t FROM payments WHERE room_id = ? AND kind = 'entry' AND status = 'released'", id)
            .map(m -> ((Number) m.get("t")).longValue()).orElse(0L);
        long refundedPaise = db.one("SELECT COALESCE(SUM(amount_paise),0) AS t FROM payments WHERE room_id = ? AND status = 'refunded'", id)
            .map(m -> ((Number) m.get("t")).longValue()).orElse(0L);
        long entries = db.one("SELECT COUNT(*) AS c FROM payments WHERE room_id = ? AND kind = 'entry' AND status IN ('escrow','released')", id)
            .map(m -> ((Number) m.get("c")).longValue()).orElse(0L);

        List<Map<String, Object>> payouts = db.q("SELECT * FROM payouts WHERE room_id = ? ORDER BY finish_rank", id)
            .stream().map(repo::shapePayout).collect(Collectors.toList());

        long prizePool = ((Number) room.get("prizePoolPaise")).longValue();
        long platformFee = IdUtil.platformFee(prizePool);

        Map<String, Object> summ = new LinkedHashMap<>();
        summ.put("prizePoolPaise", prizePool);
        summ.put("funded", room.get("funded"));
        summ.put("platformFeePaise", platformFee);
        summ.put("netPrizePaise", Math.max(0, prizePool - platformFee));
        summ.put("entryFeePaise", room.get("entryFeePaise"));
        summ.put("entries", entries);
        summ.put("escrowPaise", escrowPaise);
        summ.put("releasedPaise", releasedPaise);
        summ.put("refundedPaise", refundedPaise);
        summ.put("payoutBlocked", room.get("payoutBlocked"));
        summ.put("payouts", payouts);

        return Map.of("ok", true, "summary", summ);
    }

    // ---------- me / ledger ----------

    @GetMapping("/me/ledger")
    public Map<String, Object> myLedger(HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");

        List<Map<String, Object>> ledger = db.q("SELECT * FROM ledger WHERE user_id = ? ORDER BY at DESC LIMIT 200", userId)
            .stream().map(repo::shapeLedger).collect(Collectors.toList());
        List<Map<String, Object>> payouts = db.q("SELECT * FROM payouts WHERE user_id = ? ORDER BY at DESC LIMIT 50", userId)
            .stream().map(repo::shapePayout).collect(Collectors.toList());
        List<Map<String, Object>> payments = db.q("SELECT * FROM payments WHERE user_id = ? ORDER BY at DESC LIMIT 50", userId)
            .stream().map(repo::shapePayment).collect(Collectors.toList());

        long balance = ledger.stream().mapToLong(l -> ((Number) l.get("amountPaise")).longValue()).sum();

        return Map.of(
            "ok", true,
            "ledger", ledger,
            "payouts", payouts,
            "payments", payments,
            "balancePaise", balance
        );
    }

    // ---------- admin financials ----------

    @GetMapping("/totals")
    public Map<String, Object> totals(HttpServletRequest req) {
        requireAdmin(req);
        return Map.of("ok", true, "totals", domain.moneyTotals());
    }

    @GetMapping("/ledger")
    public Map<String, Object> adminLedger(@RequestParam(defaultValue = "100") int limit, HttpServletRequest req) {
        requireAdmin(req);
        int lim = Math.min(500, Math.max(1, limit));
        List<Map<String, Object>> rows = db.q("SELECT * FROM ledger ORDER BY at DESC LIMIT ?", lim);
        return Map.of("ok", true, "ledger", rows.stream().map(repo::shapeLedger).collect(Collectors.toList()));
    }

    @GetMapping("/payments")
    public Map<String, Object> adminPayments(@RequestParam(required = false) String status, HttpServletRequest req) {
        requireAdmin(req);
        List<Map<String, Object>> rows = status != null && !status.isBlank()
            ? db.q("SELECT * FROM payments WHERE status = ? ORDER BY at DESC LIMIT 300", status)
            : db.q("SELECT * FROM payments ORDER BY at DESC LIMIT 300");
        return Map.of("ok", true, "payments", rows.stream().map(repo::shapePayment).collect(Collectors.toList()));
    }

    @GetMapping("/payouts")
    public Map<String, Object> adminPayouts(@RequestParam(required = false) String status, HttpServletRequest req) {
        requireAdmin(req);
        List<Map<String, Object>> rows = status != null && !status.isBlank()
            ? db.q("SELECT * FROM payouts WHERE status = ? ORDER BY at DESC LIMIT 300", status)
            : db.q("SELECT * FROM payouts ORDER BY at DESC LIMIT 300");
        return Map.of("ok", true, "payouts", rows.stream().map(repo::shapePayout).collect(Collectors.toList()));
    }
}
