export const mariaRoleRates = Object.freeze({
  director: 300,
  standard: 750
});

export const mariaRoleOptions = Object.freeze([
  { label: "Director (€300/hour)", value: "director" },
  { label: "Standard (€750/hour)", value: "standard" }
]);

export function normalizeMariaRole(value, fallback = "standard") {
  const role = String(value || fallback).trim().toLowerCase();
  return Object.hasOwn(mariaRoleRates, role) ? role : fallback;
}

export function mariaRateForEntry({
  defaultRate = 0,
  mariaRole = "standard",
  mariaTeamworkUserId = "",
  userId = ""
} = {}) {
  if (!mariaTeamworkUserId || String(userId) !== String(mariaTeamworkUserId)) {
    return Number(defaultRate || 0);
  }
  return mariaRoleRates[normalizeMariaRole(mariaRole)];
}

export function effectiveRateForEntry({
  defaultRate = 0,
  mariaRolesByProject = {},
  mariaTeamworkUserId = "",
  projectId = "",
  userId = ""
} = {}) {
  const role = mariaRolesByProject instanceof Map
    ? mariaRolesByProject.get(String(projectId))
    : mariaRolesByProject?.[String(projectId)];
  return mariaRateForEntry({
    defaultRate,
    mariaRole: role || "standard",
    mariaTeamworkUserId,
    userId
  });
}
