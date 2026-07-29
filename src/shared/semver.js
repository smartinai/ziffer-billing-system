const semanticVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const releaseTypes = new Set(["major", "minor", "patch"]);

export function bumpVersion(version, releaseType) {
  const match = semanticVersionPattern.exec(String(version || ""));
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  if (!releaseTypes.has(releaseType)) throw new Error(`Invalid release type: ${releaseType}`);

  let [, major, minor, patch] = match.map(Number);
  if (releaseType === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (releaseType === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}
