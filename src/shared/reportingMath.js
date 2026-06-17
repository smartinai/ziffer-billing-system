function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function dateInRange(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function makeTotals() {
  return {
    billableHours: 0,
    billablePercent: 0,
    hours: 0,
    money: 0
  };
}

function finalizeTotals(totals) {
  return {
    ...totals,
    billableHours: round(totals.billableHours),
    billablePercent: totals.hours > 0 ? round((totals.billableHours / totals.hours) * 100, 1) : 0,
    hours: round(totals.hours),
    money: round(totals.money)
  };
}

function addTotals(target, entry, userRate) {
  const hours = entry.minutes / 60;
  const billableHours = entry.isBillable ? hours : 0;
  target.hours += hours;
  target.billableHours += billableHours;
  target.money += billableHours * userRate;
}

function sortedRows(map) {
  return [...map.values()]
    .map((row) => ({
      ...row,
      totals: finalizeTotals(row.totals)
    }))
    .sort((a, b) => b.totals.money - a.totals.money || b.totals.billableHours - a.totals.billableHours);
}

function weekKey(date) {
  const day = new Date(`${date}T12:00:00Z`);
  const offset = day.getUTCDay() === 0 ? -6 : 1 - day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

export function buildReport({ users = [], projects = [], timeEntries = [], startDate, endDate, currency = "EUR" }) {
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const projectsById = new Map(projects.map((project) => [String(project.id), project]));
  const byUser = new Map();
  const byProject = new Map();
  const trend = new Map();
  const totals = makeTotals();
  const missingRateIds = new Set();
  const unknownUsers = new Set();
  const unknownProjects = new Set();
  const includedEntries = [];

  for (const entry of timeEntries) {
    if (!dateInRange(entry.date, startDate, endDate)) continue;

    const user = usersById.get(String(entry.userId));
    const project = projectsById.get(String(entry.projectId));
    if (!user) unknownUsers.add(entry.userId || "unknown");
    if (!project) unknownProjects.add(entry.projectId || "unknown");
    if (!user || !project) continue;

    const userRate = Number(user.userRate || 0);
    if (entry.isBillable && userRate <= 0) missingRateIds.add(user.id);

    addTotals(totals, entry, userRate);
    includedEntries.push({ ...entry, money: entry.isBillable ? (entry.minutes / 60) * userRate : 0 });

    if (!byUser.has(user.id)) {
      byUser.set(user.id, {
        avatarUrl: user.avatarUrl || "",
        email: user.email,
        id: user.id,
        name: user.name,
        projectCount: 0,
        projects: new Map(),
        rate: userRate,
        recentEntries: [],
        totals: makeTotals()
      });
    }
    const userRow = byUser.get(user.id);
    addTotals(userRow.totals, entry, userRate);
    userRow.projects.set(project.id, project.name);
    userRow.projectCount = userRow.projects.size;
    userRow.recentEntries.push({ ...entry, projectName: project.name });

    if (!byProject.has(project.id)) {
      byProject.set(project.id, {
        companyName: project.companyName,
        id: project.id,
        name: project.name,
        recentEntries: [],
        totals: makeTotals(),
        users: new Map()
      });
    }
    const projectRow = byProject.get(project.id);
    addTotals(projectRow.totals, entry, userRate);
    projectRow.users.set(user.id, user.name);
    projectRow.recentEntries.push({ ...entry, userName: user.name });

    const bucket = weekKey(entry.date);
    if (!trend.has(bucket)) trend.set(bucket, { billableHours: 0, hours: 0, money: 0, period: bucket });
    addTotals(trend.get(bucket), entry, userRate);
  }

  const byUserRows = sortedRows(byUser).map((row) => ({
    ...row,
    projects: [...row.projects.values()],
    recentEntries: row.recentEntries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
  }));

  const byProjectRows = sortedRows(byProject).map((row) => ({
    ...row,
    recentEntries: row.recentEntries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
    userCount: row.users.size,
    users: [...row.users.values()]
  }));

  return {
    byClient: byProjectRows,
    byProject: byProjectRows,
    byUser: byUserRows,
    currency,
    metadata: {
      entryCount: includedEntries.length,
      missingRates: [...missingRateIds].map((id) => usersById.get(id)).filter(Boolean),
      unknownProjects: [...unknownProjects],
      unknownUsers: [...unknownUsers]
    },
    period: { endDate, startDate },
    totals: finalizeTotals(totals),
    trend: [...trend.values()]
      .map((row) => ({ ...row, ...finalizeTotals(row) }))
      .sort((a, b) => a.period.localeCompare(b.period))
  };
}
