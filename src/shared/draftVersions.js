export function draftResponseIsCurrent(currentVersion, responseVersion) {
  const current = Number(currentVersion || 0);
  const response = Number(responseVersion || 0);
  if (!Number.isFinite(response) || response < 1) return true;
  if (!Number.isFinite(current) || current < 1) return true;
  return response >= current;
}
