import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const localDir = path.join(projectRoot, ".local-postgres");
const dataDir = path.join(localDir, "data");
const logFile = path.join(localDir, "postgres.log");
const port = process.env.LOCAL_POSTGRES_PORT || "55432";
const databaseName = process.env.LOCAL_POSTGRES_DB || "ziffer_billing";
const appUser = process.env.LOCAL_POSTGRES_USER || "ziffer";
const appPassword = process.env.LOCAL_POSTGRES_PASSWORD || "ziffer_local_password";

function commandExists(command) {
  const result = spawnSync("where.exe", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/).filter(Boolean)[0] : "";
}

function programFilesPostgresBins() {
  const roots = [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "PostgreSQL") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "PostgreSQL") : ""
  ].filter(Boolean);

  const bins = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bin = path.join(root, entry.name, "bin");
      if (fs.existsSync(path.join(bin, "pg_ctl.exe"))) {
        bins.push({ bin, version: Number.parseInt(entry.name, 10) || 0 });
      }
    }
  }

  return bins.sort((a, b) => b.version - a.version).map((entry) => entry.bin);
}

function findPostgresBin() {
  if (process.env.PG_BIN && fs.existsSync(path.join(process.env.PG_BIN, "pg_ctl.exe"))) {
    return process.env.PG_BIN;
  }

  const fromPath = commandExists("pg_ctl.exe");
  if (fromPath) return path.dirname(fromPath);

  const [firstProgramFilesBin] = programFilesPostgresBins();
  if (firstProgramFilesBin) return firstProgramFilesBin;

  throw new Error("Could not find PostgreSQL binaries. Install PostgreSQL or set PG_BIN to its bin directory.");
}

const pgBin = findPostgresBin();
const bin = (name) => path.join(pgBin, process.platform === "win32" ? `${name}.exe` : name);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: options.password || "" },
    stdio: options.quiet ? "pipe" : "inherit"
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `${path.basename(command)} failed with exit code ${result.status}.`);
  }

  return result.stdout || "";
}

function ensureDirectories() {
  fs.mkdirSync(localDir, { recursive: true });
}

function hasDataDirectory() {
  return fs.existsSync(path.join(dataDir, "PG_VERSION"));
}

function initDataDirectory() {
  if (hasDataDirectory()) return;

  ensureDirectories();
  run(bin("initdb"), [
    "-D",
    dataDir,
    "-U",
    "postgres",
    "--auth=trust",
    "--encoding=UTF8"
  ]);
}

function isRunning() {
  const result = spawnSync(bin("pg_ctl"), ["-D", dataDir, "status"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe"
  });
  return result.status === 0;
}

function startServer() {
  initDataDirectory();

  if (isRunning()) {
    console.log(`Local PostgreSQL is already running on port ${port}.`);
    return;
  }

  run(bin("pg_ctl"), [
    "-D",
    dataDir,
    "-l",
    logFile,
    "-o",
    `-p ${port} -c listen_addresses=127.0.0.1`,
    "start",
    "-w"
  ]);
}

function stopServer() {
  if (!hasDataDirectory() || !isRunning()) {
    console.log("Local PostgreSQL is not running.");
    return;
  }

  run(bin("pg_ctl"), ["-D", dataDir, "stop", "-m", "fast", "-w"]);
}

function psql(args, options = {}) {
  return run(
    bin("psql"),
    ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...args],
    options
  );
}

function queryScalar(sql) {
  return psql(["-tAc", sql], { quiet: true }).trim();
}

function ensureAppDatabase() {
  const escapedPassword = appPassword.replace(/'/g, "''");
  psql([
    "-c",
    `do $$
begin
  if not exists (select 1 from pg_roles where rolname = '${appUser}') then
    create role ${appUser} login password '${escapedPassword}';
  else
    alter role ${appUser} with login password '${escapedPassword}';
  end if;
end
$$;`
  ]);

  const databaseExists = queryScalar(`select 1 from pg_database where datname = '${databaseName}'`);
  if (!databaseExists) {
    run(bin("createdb"), [
      "-h",
      "127.0.0.1",
      "-p",
      port,
      "-U",
      "postgres",
      "-O",
      appUser,
      databaseName
    ]);
  }

  psql(["-c", `grant all privileges on database ${databaseName} to ${appUser};`]);
}

function printStatus() {
  console.log(`PostgreSQL bin: ${pgBin}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Port: ${port}`);
  console.log(`Database URL: postgres://${appUser}:${appPassword}@127.0.0.1:${port}/${databaseName}`);
  console.log(`Status: ${hasDataDirectory() && isRunning() ? "running" : "stopped"}`);
}

function start() {
  startServer();
  ensureAppDatabase();
  printStatus();
}

const command = process.argv[2] || "status";

try {
  if (command === "start") start();
  else if (command === "stop") stopServer();
  else if (command === "status") printStatus();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
