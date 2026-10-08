/* Seeds MySQL from the same content file the front-end build shipped with
   (js/seed.js), so the question bank, library, achievements, taxonomies and
   platform practice rooms are identical in both worlds.

   Run: npm run migrate && npm run seed
   Re-running is safe — it upserts content rows and skips existing rooms. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const db = require("./db");
const D = require("./lib/domain");
const { uid, now, inviteCode } = require("./lib/util");

const SEED_FILE = path.join(__dirname, "..", "js", "seed.js");

function loadSeedContent() {
  const code = fs.readFileSync(SEED_FILE, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "seed.js" });
  const seed = sandbox.window.HACKAGON_SEED;
  if (!seed || !Array.isArray(seed.questions)) throw new Error("js/seed.js did not expose HACKAGON_SEED.");
  return seed;
}

async function main() {
  const SEED = loadSeedContent();
  console.log(`Loaded ${SEED.questions.length} questions, ${SEED.books.length} books, ${SEED.achievements.length} achievements from js/seed.js`);

  /* --- taxonomies --- */
  for (const t of SEED.topics) {
    await db.run("INSERT INTO topics (id,label) VALUES (?,?) ON DUPLICATE KEY UPDATE label = VALUES(label)", [t.id, t.label]);
  }
  for (const l of SEED.languages) {
    await db.run("INSERT INTO languages (id,label) VALUES (?,?) ON DUPLICATE KEY UPDATE label = VALUES(label)", [l.id, l.label]);
  }
  for (const p of SEED.prizePresets) {
    await db.run("INSERT INTO prize_presets (id,label,split) VALUES (?,?,?) ON DUPLICATE KEY UPDATE label = VALUES(label), split = VALUES(split)",
      [p.id, p.label, JSON.stringify(p.split || {})]);
  }
  console.log(`  topics ${SEED.topics.length}, languages ${SEED.languages.length}, prize presets ${SEED.prizePresets.length}`);

  /* --- question bank (hidden tests included; never sent to the browser) --- */
  for (const q of SEED.questions) {
    const t = now();
    await db.run(
      `INSERT INTO questions (id,title,topics,difficulty,points,time_limit_min,memory_limit_mb,languages,statement,
         samples,sig,hint,cases,unordered,approach,starters,custom,retired,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), topics=VALUES(topics), difficulty=VALUES(difficulty), points=VALUES(points),
         time_limit_min=VALUES(time_limit_min), memory_limit_mb=VALUES(memory_limit_mb), languages=VALUES(languages),
         statement=VALUES(statement), samples=VALUES(samples), sig=VALUES(sig), hint=VALUES(hint),
         cases=VALUES(cases), unordered=VALUES(unordered), approach=VALUES(approach), starters=VALUES(starters),
         retired=0, updated_at=VALUES(updated_at)`,
      [q.id, q.title, JSON.stringify(q.topics), q.difficulty, q.points, q.timeLimitMin || 15, q.memoryLimitMB || 256,
       JSON.stringify(q.languages), q.statement, JSON.stringify(q.samples || []), JSON.stringify(q.sig || null),
       q.hint || "", JSON.stringify(q.cases || []), q.unordered ? 1 : 0, q.approach || "",
       JSON.stringify(q.starters || null), t, t]
    );
  }
  console.log(`  questions ${SEED.questions.length}`);

  /* --- free / open-licence library --- */
  for (const b of SEED.books) {
    await db.run(
      `INSERT INTO books (id,title,author,subject,licence,url,status,submitted_by,created_at,decided_at)
       VALUES (?,?,?,?,?,?, 'approved', NULL, ?, NULL)
       ON DUPLICATE KEY UPDATE title=VALUES(title), author=VALUES(author), subject=VALUES(subject),
         licence=VALUES(licence), url=VALUES(url)`,
      [b.id, b.title, b.author, b.subject, b.licence, b.url, now()]
    );
  }
  console.log(`  books ${SEED.books.length}`);

  /* --- achievements --- */
  for (const a of SEED.achievements) {
    await db.run(
      `INSERT INTO achievements (id,name,descr,metric,target,icon) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), descr=VALUES(descr), metric=VALUES(metric), target=VALUES(target), icon=VALUES(icon)`,
      [a.id, a.name, a.desc, a.metric, a.target, a.icon]
    );
  }
  console.log(`  achievements ${SEED.achievements.length}`);

  /* --- platform-run practice rooms --- */
  const existing = await db.one("SELECT COUNT(*) AS c FROM rooms WHERE platform = 1");
  if (Number(existing.c) === 0) {
    SEED.platformRooms.forEach((pr, i) => {
      const start = now() + (i * 3 + 1) * 60 * 1000;
      return db.run(
        `INSERT INTO rooms (id,type,host_id,host_name,name,format,size,squad_size,langs,topics,question_ids,
           duration_min,time_per_q,visibility,invite_code,prize_pool_paise,entry_fee_paise,tournament_mode,
           snapshot_secs,status,start_time,platform,prize_preset,split,min_players,funded,org,results_locked,
           payout_blocked,final_board,created_at)
         VALUES (?, 'room','u_hackagon','HackAgon',?, 'Solo',100,NULL,?,?,?,?,NULL,'Public',NULL,0,0,0,25,?,?,1,NULL,NULL,2,1,NULL,0,0,NULL,?)`,
        [uid("room"), pr.name, JSON.stringify(SEED.ALL_LANGS), JSON.stringify(pr.topics), JSON.stringify(pr.questions),
         pr.durationMin, i === 0 ? "live" : "open", i === 0 ? now() - 60000 : start, now()]
      );
    });
    await db.run(
      `INSERT INTO rooms (id,type,host_id,host_name,name,format,size,squad_size,langs,topics,question_ids,
         duration_min,time_per_q,visibility,invite_code,prize_pool_paise,entry_fee_paise,tournament_mode,
         snapshot_secs,status,start_time,platform,prize_preset,split,min_players,funded,org,results_locked,
         payout_blocked,final_board,created_at)
       VALUES (?, 'duel','u_hackagon','HackAgon','Open Practice Duel','Duel',2,NULL,?,?,?,20,NULL,'Public',NULL,0,0,0,25,'open',NULL,1,NULL,NULL,2,1,NULL,0,0,NULL,?)`,
      [uid("room"), JSON.stringify(SEED.ALL_LANGS), JSON.stringify(["arrays", "strings"]), JSON.stringify(["q-two-sum", "q-anagram"]), now()]
    );
    console.log(`  platform rooms ${SEED.platformRooms.length + 1}`);
  } else {
    console.log(`  platform rooms already present (${existing.c}) — skipped`);
  }

  /* --- summary --- */
  const [counts] = await db.q(`
    SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM questions) AS questions,
           (SELECT COUNT(*) FROM books) AS books, (SELECT COUNT(*) FROM rooms) AS rooms,
           (SELECT COUNT(*) FROM achievements) AS achievements`);
  console.log("\nDatabase now holds:", counts);
  console.log("Tip: list your admin addresses in server/.env as ADMIN_EMAILS=a@b.com,c@d.com");
  console.log("     or promote one later with: node make-admin.js you@example.com");
  await db.pool.end();
}

main().catch(async err => {
  console.error("Seed failed:", err.message);
  try { await db.pool.end(); } catch (e) { /* ignore */ }
  process.exit(1);
});
