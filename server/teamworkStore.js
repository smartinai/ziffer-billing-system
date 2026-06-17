import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.resolve(__dirname, "../data/teamwork-store.json");
let memoryStore = null;

export function getStorePath() {
  return storePath;
}

export async function readTeamworkStore() {
  if (memoryStore) return memoryStore;

  try {
    const raw = await fs.readFile(storePath, "utf8");
    memoryStore = JSON.parse(raw);
    return memoryStore;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeTeamworkStore(store) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const nextStore = {
    ...store,
    version: 1,
    writtenAt: new Date().toISOString()
  };
  const tmpPath = `${storePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(nextStore, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, storePath);
  memoryStore = nextStore;
  return nextStore;
}

export function clearTeamworkStoreMemory() {
  memoryStore = null;
}

export function hasStoredReportingData(store) {
  return Boolean(
    store &&
      Array.isArray(store.users) &&
      Array.isArray(store.projects) &&
      Array.isArray(store.timeEntries) &&
      store.users.length &&
      store.projects.length
  );
}
