/* Promote an account to admin (or demote it with --off).
   Usage: node make-admin.js someone@example.com [--off] */

const db = require("./db");

(async () => {
  const args = process.argv.slice(2);
  const off = args.includes("--off");
  const target = args.find(a => !a.startsWith("--"));
  if (!target) {
    console.log("Usage: node make-admin.js <email-or-username> [--off]");
    process.exit(1);
  }
  const id = String(target).trim().toLowerCase();
  const row = await db.one("SELECT id, name, username, email, is_admin FROM users WHERE email = ? OR username = ?", [id, id]);
  if (!row) {
    console.log(`No account matches "${target}". Sign up first, then re-run this.`);
    const all = await db.q("SELECT username, email FROM users ORDER BY created_at DESC LIMIT 10");
    if (all.length) console.table(all);
    process.exit(1);
  }
  await db.run("UPDATE users SET is_admin = ? WHERE id = ?", [off ? 0 : 1, row.id]);
  console.log(`${row.name} (@${row.username}, ${row.email}) is ${off ? "no longer" : "now"} an admin.`);
  await db.pool.end();
})().catch(async err => {
  console.error("Failed:", err.message);
  try { await db.pool.end(); } catch (e) { /* ignore */ }
  process.exit(1);
});
