/* global __APP_COMMIT_SHA__, __APP_VERSION__ */

export const appVersion = __APP_VERSION__;
export const appCommitSha = __APP_COMMIT_SHA__;

export function appVersionLabel(includeCommit = false) {
  if (!includeCommit || !appCommitSha || appCommitSha === "local" || appCommitSha === "unknown") {
    return `v${appVersion}`;
  }
  return `v${appVersion} (${appCommitSha.slice(0, 7)})`;
}
