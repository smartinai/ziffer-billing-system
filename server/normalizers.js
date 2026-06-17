function asNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") {
    return asNumber(value.value ?? value.amount ?? value.rate ?? value.total, fallback);
  }
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asHourlyRate(value) {
  const amount = asNumber(value);
  return amount > 1000 ? amount / 100 : amount;
}

function fullName(row) {
  return (
    row.name ||
    row.displayName ||
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
    row.email ||
    `User ${row.id}`
  );
}

function textValue(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value.name || value.title || fallback;
  return String(value);
}

function urlValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return textValue(
      value.url || value.avatarUrl || value.imageUrl || value.photoUrl || value.downloadUrl || value.src
    );
  }
  return textValue(value);
}

function statusValue(row) {
  return String(row.status || row.projectStatus || row.state || "").toLowerCase();
}

export function normalizeUsers(rows = []) {
  return rows
    .map((row) => ({
      avatarUrl: urlValue(row.avatarUrl || row.avatar || row.profileImage || row.profilePhoto || row.photoUrl || row.imageUrl),
      companyId: String(row.companyId ?? row.company?.id ?? ""),
      deleted: Boolean(row.deleted || row.isDeleted),
      email: row.email || "",
      id: String(row.id),
      isClientUser: Boolean(row.isClientUser || row.clientUser || row.type === "client"),
      isServiceAccount: Boolean(row.isServiceAccount || row.type === "serviceAccount"),
      name: fullName(row),
      userCost: asHourlyRate(row.userCost ?? row.cost),
      userRate: asHourlyRate(row.userRate ?? row.rate ?? row.billingRate)
    }))
    .filter((user) => user.id && !user.deleted && !user.isClientUser && !user.isServiceAccount);
}

export function normalizeProjects(rows = []) {
  return rows
    .map((row) => {
      const status = statusValue(row);
      const deleted = Boolean(row.deleted || row.isDeleted);
      const inactive = Boolean(row.archived || row.isArchived || row.completed || row.isCompleted || row.inactive);
      const statusExcluded = ["archived", "completed", "complete", "inactive", "closed", "deleted"].includes(status);
      return {
        companyId: String(row.companyId ?? row.company?.id ?? ""),
        companyName: textValue(row.companyName || row.company),
        deleted,
        excluded: deleted || inactive || statusExcluded,
        id: String(row.id),
        isBillable: row.isBillable !== false,
        name: textValue(row.name || row.projectName, `Project ${row.id}`),
        status: status || "active"
      };
    })
    .filter((project) => project.id && !project.excluded);
}

function readMinutes(row) {
  const direct = asNumber(row.minutes ?? row.durationMinutes ?? row.totalMinutes, NaN);
  if (Number.isFinite(direct)) return direct;

  const hours = asNumber(row.hours ?? row.durationHours, NaN);
  if (Number.isFinite(hours)) return hours * 60;

  return 0;
}

function readDate(row) {
  const value =
    row.date ||
    row.timeLogged ||
    row.loggedAt ||
    row.createdAt ||
    row.dateCreated ||
    row.updatedAt ||
    "";
  return String(value).slice(0, 10);
}

export function normalizeTimeEntries(rows = []) {
  return rows
    .map((row) => {
      const minutes = readMinutes(row);
      return {
        date: readDate(row),
        deleted: Boolean(row.deleted || row.isDeleted),
        description: row.description || row.taskName || row.task?.name || "",
        hours: minutes / 60,
        id: String(row.id),
        isBillable: Boolean(row.billable ?? row.isBillable ?? row.billableType === "billable"),
        minutes,
        projectId: String(row.projectId ?? row.project?.id ?? ""),
        userId: String(row.userId ?? row.user?.id ?? row.personId ?? "")
      };
    })
    .filter((entry) => entry.id && entry.date && !entry.deleted);
}
