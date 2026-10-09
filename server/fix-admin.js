const mysql = require("mysql2/promise");
const config = require("./config");

(async () => {
  const c = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ...(config.db.ssl ? { ssl: { rejectUnauthorized: true } } : {})
  });

  // Strip admin from every account
  await c.query("UPDATE users SET is_admin = 0");

  // Grant admin only to the owner's email
  const [res] = await c.query(
    "UPDATE users SET is_admin = 1 WHERE email = ?",
    ["akshatrathorerevoluate@gmail.com"]
  );
  console.log("Admin granted to akshatrathorerevoluate@gmail.com:", res.affectedRows, "row(s) updated");

  // Print current user list
  const [rows] = await c.query("SELECT email, is_admin FROM users ORDER BY created_at");
  console.log("\nAll users:");
  rows.forEach(r => console.log(` ${r.is_admin ? "[ADMIN]" : "[user] "} ${r.email}`));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
