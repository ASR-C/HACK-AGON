-- ============================================================
-- HackAgon — MySQL schema
-- Field names mirror the front-end store shape so a page can
-- hydrate straight from the API. All *_at columns are epoch
-- milliseconds (BIGINT) to match the client clock exactly.
-- Money is integer paise everywhere — never a float.
-- ============================================================

CREATE DATABASE IF NOT EXISTS hackagon
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hackagon;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS ach_state;
DROP TABLE IF EXISTS achievements;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS disputes;
DROP TABLE IF EXISTS ledger;
DROP TABLE IF EXISTS payouts;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS snapshots;
DROP TABLE IF EXISTS violations;
DROP TABLE IF EXISTS mistakes;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS room_players;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS otps;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS prize_presets;
DROP TABLE IF EXISTS languages;
DROP TABLE IF EXISTS topics;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------- accounts ------------------------------------------
CREATE TABLE users (
  id            VARCHAR(32)  NOT NULL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  username      VARCHAR(24)  NOT NULL,
  email         VARCHAR(190) NOT NULL,
  mobile        VARCHAR(16)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,          -- bcrypt, salted (PRD 3)
  dob           DATE         NULL,
  verified      TINYINT(1)   NOT NULL DEFAULT 0,
  bio           TEXT         NULL,
  langs         JSON         NULL,              -- ["java","python",...]
  payout        JSON         NULL,              -- {upi,bank,ifsc,holderName,status,...}
  org           JSON         NULL,              -- {name,status,requestedAt}
  is_admin      TINYINT(1)   NOT NULL DEFAULT 0,
  stats         JSON         NOT NULL,          -- counters, all start at 0
  created_at    BIGINT       NOT NULL,
  UNIQUE KEY uq_users_email    (email),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_mobile   (mobile)
) ENGINE=InnoDB;

-- ---------- one-time codes ------------------------------------
CREATE TABLE otps (
  id          VARCHAR(32)  NOT NULL PRIMARY KEY,
  email       VARCHAR(190) NULL,
  mobile      VARCHAR(16)  NULL,
  code_hash   VARCHAR(100) NOT NULL,             -- bcrypt of the 6-digit code
  purpose     VARCHAR(20)  NOT NULL,              -- signup|login|forgot|payout|contact
  user_id     VARCHAR(32)  NULL,
  created_at  BIGINT       NOT NULL,
  expires_at  BIGINT       NOT NULL,
  attempts    INT          NOT NULL DEFAULT 0,
  max_attempts INT         NOT NULL DEFAULT 5,
  resend_at   BIGINT       NOT NULL,
  verified    TINYINT(1)   NOT NULL DEFAULT 0,
  meta        JSON         NULL,                -- pending change carried until the code is confirmed
  KEY ix_otps_lookup (email, purpose, created_at),
  KEY ix_otps_mobile (mobile, purpose, created_at)
) ENGINE=InnoDB;

-- ---------- content -------------------------------------------
CREATE TABLE topics (
  id    VARCHAR(40) NOT NULL PRIMARY KEY,
  label VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE languages (
  id    VARCHAR(20) NOT NULL PRIMARY KEY,
  label VARCHAR(40) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE prize_presets (
  id    VARCHAR(30) NOT NULL PRIMARY KEY,
  label VARCHAR(60) NOT NULL,
  split JSON        NOT NULL
) ENGINE=InnoDB;

CREATE TABLE questions (
  id             VARCHAR(40)  NOT NULL PRIMARY KEY,
  title          VARCHAR(160) NOT NULL,
  topics         JSON         NOT NULL,
  difficulty     VARCHAR(12)  NOT NULL DEFAULT 'easy',
  points         INT          NOT NULL DEFAULT 100,
  time_limit_min INT          NOT NULL DEFAULT 15,
  memory_limit_mb INT         NOT NULL DEFAULT 256,
  languages      JSON         NOT NULL,
  statement      MEDIUMTEXT   NOT NULL,
  samples        JSON         NOT NULL,
  sig            JSON         NULL,
  hint           TEXT         NULL,
  cases          JSON         NOT NULL,          -- hidden tests, never sent to the browser
  unordered      TINYINT(1)   NOT NULL DEFAULT 0,
  approach       TEXT         NULL,
  starters       JSON         NULL,
  custom         TINYINT(1)   NOT NULL DEFAULT 0,-- admin-authored vs seeded
  retired        TINYINT(1)   NOT NULL DEFAULT 0,
  created_at     BIGINT       NOT NULL,
  updated_at     BIGINT       NOT NULL,
  KEY ix_questions_retired (retired)
) ENGINE=InnoDB;

CREATE TABLE books (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  author        VARCHAR(200) NOT NULL,
  subject       VARCHAR(120) NOT NULL,
  licence       VARCHAR(120) NOT NULL,
  url           VARCHAR(500) NOT NULL,
  status        VARCHAR(12)  NOT NULL DEFAULT 'approved', -- approved|pending|rejected
  submitted_by  VARCHAR(32)  NULL,
  note          TEXT         NULL,
  created_at    BIGINT       NOT NULL,
  decided_at    BIGINT       NULL,
  KEY ix_books_status (status)
) ENGINE=InnoDB;

CREATE TABLE achievements (
  id     VARCHAR(40)  NOT NULL PRIMARY KEY,
  name   VARCHAR(80)  NOT NULL,
  descr  VARCHAR(200) NOT NULL,
  metric VARCHAR(40)  NOT NULL,
  target INT          NOT NULL,
  icon   VARCHAR(30)  NOT NULL DEFAULT 'star'
) ENGINE=InnoDB;

CREATE TABLE ach_state (
  user_id         VARCHAR(32) NOT NULL,
  achievement_id  VARCHAR(40) NOT NULL,
  progress        INT         NOT NULL DEFAULT 0,
  unlocked_at     BIGINT      NULL,
  PRIMARY KEY (user_id, achievement_id)
) ENGINE=InnoDB;

-- ---------- rooms / tournaments -------------------------------
CREATE TABLE rooms (
  id              VARCHAR(32)  NOT NULL PRIMARY KEY,
  type            VARCHAR(16)  NOT NULL,          -- room|duel|tournament
  host_id         VARCHAR(32)  NOT NULL,
  host_name       VARCHAR(120) NOT NULL,
  name            VARCHAR(160) NOT NULL,
  format          VARCHAR(20)  NOT NULL DEFAULT 'Solo',
  size            INT          NOT NULL DEFAULT 10,
  squad_size      INT          NULL,
  langs           JSON         NOT NULL,
  topics          JSON         NOT NULL,
  question_ids    JSON         NOT NULL,
  duration_min    INT          NOT NULL DEFAULT 60,
  time_per_q      INT          NULL,
  visibility      VARCHAR(12)  NOT NULL DEFAULT 'Public',
  invite_code     VARCHAR(10)  NULL,
  prize_pool_paise BIGINT      NOT NULL DEFAULT 0,
  entry_fee_paise BIGINT       NOT NULL DEFAULT 0,
  tournament_mode TINYINT(1)   NOT NULL DEFAULT 0,
  snapshot_secs   INT          NOT NULL DEFAULT 25,
  status          VARCHAR(12)  NOT NULL DEFAULT 'draft', -- draft|open|live|ended
  start_time      BIGINT       NULL,
  platform        TINYINT(1)   NOT NULL DEFAULT 0,
  prize_preset    VARCHAR(30)  NULL,
  split           JSON         NULL,
  min_players     INT          NOT NULL DEFAULT 2,
  funded          TINYINT(1)   NOT NULL DEFAULT 0,
  org             JSON         NULL,             -- copied from the host at creation
  results_locked  TINYINT(1)   NOT NULL DEFAULT 0,
  payout_blocked  TINYINT(1)   NOT NULL DEFAULT 0,
  final_board     JSON         NULL,
  created_at      BIGINT       NOT NULL,
  KEY ix_rooms_status (status, type),
  KEY ix_rooms_host   (host_id),
  UNIQUE KEY uq_rooms_invite (invite_code)
) ENGINE=InnoDB;

CREATE TABLE room_players (
  room_id        VARCHAR(32) NOT NULL,
  user_id        VARCHAR(32) NOT NULL,
  name           VARCHAR(120) NOT NULL,
  username       VARCHAR(24)  NOT NULL,
  joined_at      BIGINT       NOT NULL,
  score          INT          NOT NULL DEFAULT 0,
  solved         JSON         NOT NULL,
  eliminated     TINYINT(1)   NOT NULL DEFAULT 0,
  elim_reason    VARCHAR(200) NULL,
  eliminated_at  BIGINT       NULL,
  violations     INT          NOT NULL DEFAULT 0,
  camera         VARCHAR(12)  NOT NULL DEFAULT 'n/a',
  last_correct_at BIGINT      NULL,
  locked         TINYINT(1)   NOT NULL DEFAULT 0,
  lock_reason    VARCHAR(200) NULL,
  locked_at      BIGINT       NULL,
  PRIMARY KEY (room_id, user_id),
  KEY ix_rp_user (user_id),
  CONSTRAINT fk_rp_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- play ------------------------------------------------
CREATE TABLE submissions (
  id          VARCHAR(32) NOT NULL PRIMARY KEY,
  room_id     VARCHAR(32) NOT NULL,
  user_id     VARCHAR(32) NOT NULL,
  question_id VARCHAR(40) NOT NULL,
  lang        VARCHAR(20) NOT NULL,
  code        MEDIUMTEXT  NOT NULL,
  passed      INT         NOT NULL DEFAULT 0,
  total       INT         NOT NULL DEFAULT 0,
  ok          TINYINT(1)  NOT NULL DEFAULT 0,
  time_ms     INT         NOT NULL DEFAULT 0,
  simulated   TINYINT(1)  NOT NULL DEFAULT 0,
  at          BIGINT      NOT NULL,
  KEY ix_sub_room (room_id, user_id),
  KEY ix_sub_user_q (user_id, question_id)
) ENGINE=InnoDB;

CREATE TABLE mistakes (
  id           VARCHAR(32) NOT NULL PRIMARY KEY,
  user_id      VARCHAR(32) NOT NULL,
  question_id  VARCHAR(40) NOT NULL,
  room_id      VARCHAR(32) NULL,
  last_code    MEDIUMTEXT  NULL,
  failing_case JSON        NULL,
  solved       TINYINT(1)  NOT NULL DEFAULT 0,
  solved_at    BIGINT      NULL,
  at           BIGINT      NOT NULL,
  UNIQUE KEY uq_mistake (user_id, question_id),
  KEY ix_mistakes_user (user_id, at)
) ENGINE=InnoDB;

-- ---------- proctoring -----------------------------------------
CREATE TABLE violations (
  id      VARCHAR(32) NOT NULL PRIMARY KEY,
  room_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  type    VARCHAR(40) NOT NULL,
  at      BIGINT      NOT NULL,
  KEY ix_viol (room_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE snapshots (
  id      VARCHAR(32)  NOT NULL PRIMARY KEY,
  room_id VARCHAR(32)  NOT NULL,
  user_id VARCHAR(32)  NOT NULL,
  path    VARCHAR(255) NULL,
  at      BIGINT       NOT NULL,
  KEY ix_snap (room_id, user_id, at)
) ENGINE=InnoDB;

-- ---------- money ------------------------------------------------
CREATE TABLE payments (
  id           VARCHAR(32) NOT NULL PRIMARY KEY,
  room_id      VARCHAR(32) NULL,
  user_id      VARCHAR(32) NULL,
  amount_paise BIGINT      NOT NULL,
  kind         VARCHAR(20) NOT NULL,   -- prize-fund|entry
  status       VARCHAR(16) NOT NULL,   -- captured|escrow|released|refunded
  at           BIGINT      NOT NULL,
  KEY ix_pay_room (room_id, status),
  KEY ix_pay_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE payouts (
  id           VARCHAR(32) NOT NULL PRIMARY KEY,
  room_id      VARCHAR(32) NOT NULL,
  user_id      VARCHAR(32) NOT NULL,
  amount_paise BIGINT      NOT NULL,
  finish_rank  INT         NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'paid',
  at           BIGINT      NOT NULL,
  KEY ix_po_room (room_id),
  KEY ix_po_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE ledger (
  id           VARCHAR(32)  NOT NULL PRIMARY KEY,
  user_id      VARCHAR(32)  NULL,       -- NULL = platform-side entry
  type         VARCHAR(24)  NOT NULL,   -- entry-fee|prize-fund|prize|refund|platform-fee
  amount_paise BIGINT       NOT NULL,
  note         VARCHAR(255) NOT NULL,
  room_id      VARCHAR(32)  NULL,
  at           BIGINT       NOT NULL,
  KEY ix_led_user (user_id, at),
  KEY ix_led_type (type)
) ENGINE=InnoDB;

-- ---------- trust & inbox --------------------------------------
CREATE TABLE disputes (
  id         VARCHAR(32) NOT NULL PRIMARY KEY,
  room_id    VARCHAR(32) NOT NULL,
  user_id    VARCHAR(32) NOT NULL,
  reason     TEXT        NOT NULL,
  status     VARCHAR(12) NOT NULL DEFAULT 'open',
  resolution TEXT        NULL,
  at         BIGINT      NOT NULL,
  KEY ix_disp_status (status)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id      VARCHAR(32)  NOT NULL PRIMARY KEY,
  user_id VARCHAR(32)  NOT NULL,
  type    VARCHAR(30)  NOT NULL,
  room_id VARCHAR(32)  NULL,
  reason  VARCHAR(255) NULL,
  at      BIGINT       NOT NULL,
  KEY ix_notif (user_id, at)
) ENGINE=InnoDB;
