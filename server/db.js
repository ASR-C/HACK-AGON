const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4_unicode_ci",
  // JSON columns come back parsed already; keep numbers as JS numbers.
  supportBigNumbers: true,
  bigNumberStrings: false
});

async function q(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
async function one(sql, params) {
  const rows = await q(sql, params);
  return rows[0] || null;
}
async function run(sql, params) {
  const [res] = await pool.execute(sql, params);
  return res;
}

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function ping() {
  const r = await one("SELECT VERSION() AS v");
  return r && r.v;
}

module.exports = { pool, q, one, run, tx, ping };
