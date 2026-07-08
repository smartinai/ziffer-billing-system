import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

let pool;

function databaseSslConfig() {
  return config.databaseSsl ? { rejectUnauthorized: false } : false;
}

export function isDatabaseConfigured() {
  return Boolean(config.databaseUrl);
}

export function getDatabasePool() {
  if (!isDatabaseConfigured()) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: databaseSslConfig()
    });
  }

  return pool;
}

export async function query(text, params = []) {
  const database = getDatabasePool();
  if (!database) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return database.query(text, params);
}

export async function checkDatabase() {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      ok: true,
      message: "DATABASE_URL is not configured. The app is running without database-backed invoice features."
    };
  }

  try {
    const result = await query("select current_database() as database_name, now() as checked_at");
    return {
      configured: true,
      ok: true,
      database: result.rows[0]?.database_name || "",
      checkedAt: result.rows[0]?.checked_at || new Date().toISOString()
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      message: error.message || "Database check failed."
    };
  }
}

export async function closeDatabase() {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}
