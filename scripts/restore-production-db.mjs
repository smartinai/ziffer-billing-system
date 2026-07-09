import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import dotenv from "dotenv";

dotenv.config();

const backupArg = process.argv[2];
const confirmed = process.argv.includes("--yes");

if (!backupArg) {
  console.error("Usage: npm run db:production:restore -- <backup-file.dump> --yes");
  process.exit(1);
}

if (!confirmed) {
  console.error("Restore is destructive. Re-run with --yes when you are sure.");
  process.exit(1);
}

const backupPath = path.resolve(backupArg);
await fsp.access(backupPath, fs.constants.R_OK);

const composeFile = process.env.COMPOSE_FILE || "docker-compose.production.yml";
const dbName = process.env.POSTGRES_DB || "ziffer_billing";
const dbUser = process.env.POSTGRES_USER || "ziffer";

const args = [
  "compose",
  "-f",
  composeFile,
  "exec",
  "-T",
  "postgres",
  "pg_restore",
  "-U",
  dbUser,
  "-d",
  dbName,
  "--clean",
  "--if-exists",
  "--no-owner",
  "--no-acl"
];

const child = spawn("docker", args, { stdio: ["pipe", "inherit", "inherit"] });

const exitPromise = new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});

const [exitCode] = await Promise.all([
  exitPromise,
  pipeline(fs.createReadStream(backupPath), child.stdin)
]);

if (exitCode !== 0) {
  throw new Error(`Database restore failed with exit code ${exitCode}.`);
}

console.log(`Restored database ${dbName} from ${backupPath}`);
