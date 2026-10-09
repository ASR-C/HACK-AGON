/* Applies server/schema.sql to the configured MySQL server, creating the
   database first if it does not exist yet. Destructive by design: the schema
   drops and recreates every HackAgon table. Run `npm run seed` afterwards. */

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const config = require("./config");

(async () => {
  const bare = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    ...(config.db.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    multipleStatements: true
  });

  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  console.log(`Applying schema to ${config.db.host}:${config.db.port} ...`);
  await bare.query(sql);
  await bare.end();

  const check = await mysql.createConnection({
    host: config.db.host, port: config.db.port,
    user: config.db.user, password: config.db.password,
    database: config.db.database,
    ...(config.db.ssl ? { ssl: { rejectUnauthorized: true } } : {})
  });
  const [tables] = await check.query("SHOW TABLES");
  const [ver] = await check.query("SELECT VERSION() AS v");
  await check.end();

  console.log(`MySQL ${ver[0].v} — database "${config.db.database}" ready with ${tables.length} tables.`);
  console.log("Next: npm run seed");
})().catch(err => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
