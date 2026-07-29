import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { bumpVersion } from "../src/shared/semver.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseType = process.argv[2];
const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const changelogPath = path.join(root, "CHANGELOG.md");

const [packageText, lockText, changelog] = await Promise.all([
  readFile(packagePath, "utf8"),
  readFile(lockPath, "utf8"),
  readFile(changelogPath, "utf8")
]);
const packageJson = JSON.parse(packageText);
const packageLock = JSON.parse(lockText);
const nextVersion = bumpVersion(packageJson.version, releaseType);
const unreleasedMatch = changelog.match(/## \[Unreleased\]\r?\n([\s\S]*?)(?=\r?\n## \[|$)/);
const unreleased = unreleasedMatch?.[1]?.trim();

if (!unreleased) {
  throw new Error("Add at least one entry under [Unreleased] in CHANGELOG.md before preparing a release.");
}

packageJson.version = nextVersion;
packageLock.version = nextVersion;
if (packageLock.packages?.[""]) packageLock.packages[""].version = nextVersion;

const date = new Date().toISOString().slice(0, 10);
const releasedChangelog = changelog.replace(
  unreleasedMatch[0],
  `## [Unreleased]\n\n## [${nextVersion}] - ${date}\n\n${unreleased}\n`
);

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`),
  writeFile(changelogPath, releasedChangelog)
]);

console.log(`Prepared Ziffer v${nextVersion}. Review the changes, run npm run check, then commit and tag the release.`);
