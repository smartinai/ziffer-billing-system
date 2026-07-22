import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const { Pool } = pg;

let pool;
const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
let expectedMigrationIdPromise;

function expectedMigrationId() {
  if (!expectedMigrationIdPromise) {
    expectedMigrationIdPromise = fs.readdir(migrationsDirectory)
      .then((files) => files.filter((file) => file.endsWith(".sql")).sort().at(-1)?.replace(/\.sql$/i, "") || "");
  }
  return expectedMigrationIdPromise;
}

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
      ok: false,
      message: "Database readiness is not configured."
    };
  }

  try {
    const migrationId = await expectedMigrationId();
    const result = await query(
      `select current_database() as database_name,
              clock_timestamp() as checked_at,
              exists(select 1 from schema_migrations where id = $1) as migration_ready`,
      [migrationId]
    );
    const migrationReady = Boolean(result.rows[0]?.migration_ready);
    return {
      configured: true,
      ok: migrationReady,
      database: result.rows[0]?.database_name || "",
      checkedAt: result.rows[0]?.checked_at || new Date().toISOString(),
      expectedMigration: migrationId,
      migrationReady,
      message: migrationReady ? "" : "The database schema is not ready for this application release."
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      message: "Database readiness check failed."
    };
  }
}

export async function closeDatabase() {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}
