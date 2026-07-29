import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const commit = String(process.env.APP_COMMIT_SHA || "local").trim();

export const appVersion = Object.freeze({
  commit,
  name: packageJson.name,
  version: packageJson.version
});
