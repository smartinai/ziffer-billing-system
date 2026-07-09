import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import dotenv from "dotenv";

dotenv.config();

const composeFile = process.env.COMPOSE_FILE || "docker-compose.production.yml";
const backupDir = process.env.BACKUP_DIR || "backups";
const dbName = process.env.POSTGRES_DB || "ziffer_billing";
const dbUser = process.env.POSTGRES_USER || "ziffer";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.resolve(backupDir, `ziffer-${dbName}-${timestamp}.dump`);

await fsp.mkdir(path.dirname(backupPath), { recursive: true });

const args = [
  "compose",
  "-f",
  composeFile,
  "exec",
  "-T",
  "postgres",
  "pg_dump",
  "-U",
  dbUser,
  "-d",
  dbName,
  "--format=custom",
  "--no-owner",
  "--no-acl"
];

const child = spawn("docker", args, { stdio: ["ignore", "pipe", "inherit"] });
const output = fs.createWriteStream(backupPath, { flags: "wx" });

const exitPromise = new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});

let exitCode;
try {
  await pipeline(child.stdout, output);
  exitCode = await exitPromise;
} catch (error) {
  await fsp.rm(backupPath, { force: true });
  throw error;
}

if (exitCode !== 0) {
  await fsp.rm(backupPath, { force: true });
  throw new Error(`Database backup failed with exit code ${exitCode}.`);
}

const stats = await fsp.stat(backupPath);
console.log(`Backup created: ${backupPath}`);
console.log(`Size: ${Math.round(stats.size / 1024)} KB`);
