import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

dotenv.config();

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(projectRoot, "migrations");
const dryRun = process.argv.includes("--dry-run");
const throughMigration = process.argv.find((argument) => argument.startsWith("--through="))?.slice("--through=".length) || "";

async function listMigrationFiles() {
  const files = await fs.readdir(migrationsDir);
  return files.filter((file) => file.endsWith(".sql")).sort();
}

function migrationId(file) {
  return file.replace(/\.sql$/i, "");
}

function migrationName(file) {
  return file.replace(/^\d+[_-]?/, "").replace(/\.sql$/i, "");
}

function databaseSslConfig() {
  return process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
  `);
}

async function appliedMigrationIds(client) {
  const result = await client.query("select id from schema_migrations order by id");
  return new Set(result.rows.map((row) => row.id));
}

async function runMigration(client, file) {
  const id = migrationId(file);
  const name = migrationName(file);
  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");

  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into schema_migrations (id, name) values ($1, $2)", [id, name]);
    await client.query("commit");
    console.log(`Applied ${file}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  const allFiles = await listMigrationFiles();
  const files = throughMigration
    ? allFiles.filter((file) => migrationId(file) <= throughMigration)
    : allFiles;
  if (throughMigration && !allFiles.some((file) => migrationId(file) === throughMigration)) {
    throw new Error(`Migration ${throughMigration} was not found.`);
  }

  if (dryRun) {
    console.log(`Found ${files.length} migration(s):`);
    for (const file of files) console.log(`- ${file}`);
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: databaseSslConfig()
  });

  await client.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await appliedMigrationIds(client);
    const pending = files.filter((file) => !applied.has(migrationId(file)));

    if (!pending.length) {
      console.log("Database is already up to date.");
      return;
    }

    for (const file of pending) {
      await runMigration(client, file);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
