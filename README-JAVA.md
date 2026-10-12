# HackAgon — Java Spring Boot Backend Migration & Updates

This document describes the complete conversion of the HackAgon Node.js/Express backend to a **Java Spring Boot backend**, alongside the room host enhancements, player removal handling, and practice duel fixes.

---

## 1. Java Backend Architecture (`java-backend/`)

The Java backend has **100% feature parity** with the original JavaScript backend. All REST endpoints and response JSON shapes match the frontend expectations in `js/api.js` and `js/store.js` exactly.

### Package Structure
```
java-backend/
├── pom.xml                                   # Spring Boot 3.2, Web, Security, JDBC, MySQL, Jackson
├── src/main/resources/
│   └── application.properties                # TiDB Cloud MySQL config, JWT secret, Groq model, port
└── src/main/java/com/hackagon/
    ├── HackAgonApplication.java              # Main Spring Boot entry point
    ├── config/
    │   └── SecurityConfig.java               # JWT OncePerRequestFilter, stateless security, CORS
    ├── util/
    │   ├── IdUtil.java                       # Prefix UUIDs, 6-char invite codes, OTP, platform fee
    │   └── HttpException.java                # HTTP exception mapping to { ok: false, error: "..." }
    ├── service/
    │   ├── DatabaseService.java              # JdbcTemplate wrapper (q, one, run, ping)
    │   ├── JwtService.java                   # HS256 JWT issue and validation
    │   ├── RepoService.java                  # Snake_case DB to camelCase JSON model shaping
    │   ├── OtpService.java                   # OTP code generation, verify, expiry, and email delivery
    │   ├── DomainService.java                # Room lifecycle, scoring, money, ledger, achievements
    │   └── JudgeService.java                 # Multi-language test case evaluation engine
    └── controller/
        ├── BaseController.java               # User extraction, requireUser(), shapeUser()
        ├── GlobalExceptionHandler.java       # Centralized JSON error formatting
        ├── AuthController.java               # /api/auth (signup, login, OTP verify, password reset)
        ├── RoomsController.java              # /api/rooms (CRUD, join, leave, start, eliminate/remove)
        ├── ContentController.java            # /api/bootstrap, questions, books, taxonomies
        ├── PlayController.java               # /api/play (submit, practice, mistakes, achievements)
        ├── ProctorController.java            # /api/proctor (violations, locks, camera, snapshots)
        ├── MoneyController.java              # /api/money (prize fund, entry fees, settle, refunds)
        ├── AiController.java                 # /api/ai (hint, explain, coach via Groq API)
        ├── AdminController.java              # /api/admin (question bank, books, users, disputes)
        └── HealthController.java             # /health (plain 200 ok) & /api/health (JSON diagnostics)
```

---

## 2. API Endpoint Parity Mapping

| Feature | Original Node.js Route | New Java Controller |
|---|---|---|
| Health Check | `GET /health`, `GET /api/health` in `index.js` | `HealthController.java` |
| Authentication | `routes/auth.js` | `AuthController.java` |
| Content & Bootstrap | `routes/content.js` | `ContentController.java` |
| Rooms & Duels | `routes/rooms.js` | `RoomsController.java` |
| Code Play & Judge | `routes/play.js` | `PlayController.java` & `JudgeService.java` |
| Proctoring & Camera | `routes/proctor.js` | `ProctorController.java` |
| Money & Escrow | `routes/money.js` | `MoneyController.java` |
| AI Coding Coach | `routes/ai.js` | `AiController.java` |
| Admin Console | `routes/admin.js` | `AdminController.java` |

---

## 3. UI Fixes & Enhancements

### A. Host Match Controls in Waiting Room (`match.html`)
- **"Start Match Now" Button**: Added directly into the waiting lobby for the host. When the minimum required players join, the host can start immediately without switching pages.
- **Lobby Player List & Removal**: The waiting room now displays all joined players. The host has a red **"Remove"** button beside every player to kick unauthorized participants before the match starts.
- **Removal Bug Solved**: Previously, a player removed from the lobby or live match was not redirected and could remain on the page. Now:
  1. Both the waiting room (`lobbyTimer`) and live match (`pollTimer`) check if the current user still has a valid seat.
  2. If the host kicks or eliminates the user, the removed player is notified immediately via toast/elimination banner and redirected back to `arena.html`.
  3. The server endpoint `POST /api/rooms/:id/eliminate` and `POST /api/rooms/:id/remove-player` now cleanly removes players in both `open` (lobby) and `live` states.

### B. Observe Match Progress (`match.html` & `host-dashboard.html`)
- **"Observe Progress" Header Button**: When a match is live, the room host has a dedicated **"Observe Progress"** button in the top navigation bar of `match.html`.
- **Host Dashboard Integration**: Opens `host-dashboard.html?room=<id>` where the host can view live participant scores, real-time proctor camera snapshots, violation audit logs, and trigger lock/unlock/elimination controls.

### C. Practice Duel Improvements (`duel.html`)
- **Auto Question Selection**: Previously, if a user did not check any questions before clicking "Find a practice opponent", the duel creation would fail with an error. Now, the system automatically selects questions from the question bank if none are selected.
- **Instant Matchmaking Queue**: Polling for opponents checks every 5 seconds, offers a shareable link and code, and auto-starts the duel as soon as the opponent joins.

---

## 4. How to Run the Java Backend

### Requirements
- Java 17 or higher (Java 25 is installed on this machine).
- Maven 3.8+ (or run with Maven).

### Running with Maven
From the project root:
```bash
cd java-backend
mvn spring-boot:run
```

Or build a standalone JAR:
```bash
cd java-backend
mvn clean package -DskipTests
java -jar target/hackagon-server-1.0.0.jar
```

The Spring Boot server starts on port `8080` (or `PORT` from `.env`) and serves both the API (`/api/**`) and static frontend HTML/CSS/JS files directly.
