function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function dateInRange(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function normalizeComparableName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function makeTotals() {
  return {
    allMoney: 0,
    billableHours: 0,
    billablePercent: 0,
    hours: 0,
    money: 0
  };
}

function finalizeTotals(totals) {
  return {
    ...totals,
    allMoney: round(totals.allMoney),
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
  target.allMoney += hours * userRate;
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

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function makeYearTrend(year) {
  return monthLabels.map((label, index) => ({
    billableHours: 0,
    hours: 0,
    label,
    money: 0,
    month: index + 1,
    period: `${year}-${String(index + 1).padStart(2, "0")}`,
    year
  }));
}

export function buildReport({
  users = [],
  projects = [],
  timeEntries = [],
  startDate,
  endDate,
  currency = "EUR",
  excludedProjectIds = []
}) {
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const projectsById = new Map(projects.map((project) => [String(project.id), project]));
  const excludedProjectIdSet = new Set(excludedProjectIds.map((id) => String(id)));
  const userNames = new Set(users.map((user) => normalizeComparableName(user.name)).filter(Boolean));
  const filteredPersonProjects = projects.filter((project) => userNames.has(normalizeComparableName(project.name)));
  const filteredPersonProjectIds = new Set(filteredPersonProjects.map((project) => String(project.id)));
  const excludedProjects = projects.filter((project) => excludedProjectIdSet.has(String(project.id)));
  const byUser = new Map();
  const byProject = new Map();
  const year = String(endDate || startDate).slice(0, 4);
  const trend = new Map();
  const yearTrendRows = makeYearTrend(year);
  const yearTrend = new Map(yearTrendRows.map((row) => [row.period, row]));
  const totals = makeTotals();
  const missingRateIds = new Set();
  const unknownUsers = new Set();
  const unknownProjects = new Set();
  const includedEntries = [];

  for (const entry of timeEntries) {
    const user = usersById.get(String(entry.userId));
    const project = projectsById.get(String(entry.projectId));

    if (excludedProjectIdSet.has(String(entry.projectId))) continue;
    if (project && filteredPersonProjectIds.has(String(project.id))) continue;

    if (entry.date?.startsWith(`${year}-`) && user && project) {
      addTotals(yearTrend.get(entry.date.slice(0, 7)), entry, Number(user.userRate || 0));
    }

    if (!dateInRange(entry.date, startDate, endDate)) continue;

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
    if (!userRow.projects.has(project.id)) {
      userRow.projects.set(project.id, {
        companyName: project.companyName,
        entryCount: 0,
        id: project.id,
        name: project.name,
        totals: makeTotals()
      });
    }
    const userProjectRow = userRow.projects.get(project.id);
    addTotals(userProjectRow.totals, entry, userRate);
    userProjectRow.entryCount += 1;
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
    if (!projectRow.users.has(user.id)) {
      projectRow.users.set(user.id, {
        avatarUrl: user.avatarUrl || "",
        email: user.email,
        entryCount: 0,
        id: user.id,
        name: user.name,
        totals: makeTotals()
      });
    }
    const projectPersonRow = projectRow.users.get(user.id);
    addTotals(projectPersonRow.totals, entry, userRate);
    projectPersonRow.entryCount += 1;
    projectRow.recentEntries.push({ ...entry, userName: user.name });

    const bucket = weekKey(entry.date);
    if (!trend.has(bucket)) trend.set(bucket, { billableHours: 0, hours: 0, money: 0, period: bucket });
    addTotals(trend.get(bucket), entry, userRate);
  }

  const byUserRows = sortedRows(byUser).map((row) => {
    const projectBreakdown = sortedRows(row.projects);
    return {
      ...row,
      entryCount: row.recentEntries.length,
      projectBreakdown,
      projectCount: projectBreakdown.length,
      projects: projectBreakdown.map((project) => project.name),
      recentEntries: row.recentEntries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
    };
  });

  const byProjectRows = sortedRows(byProject).map((row) => {
    const peopleBreakdown = sortedRows(row.users);
    return {
      ...row,
      entryCount: row.recentEntries.length,
      peopleBreakdown,
      recentEntries: row.recentEntries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
      userCount: peopleBreakdown.length,
      users: peopleBreakdown.map((person) => person.name)
    };
  });

  return {
    byClient: byProjectRows,
    byProject: byProjectRows,
    byUser: byUserRows,
    currency,
    metadata: {
      entryCount: includedEntries.length,
      excludedProjects: excludedProjects.map((project) => ({ id: project.id, name: project.name })),
      filteredPersonProjects: filteredPersonProjects.map((project) => ({ id: project.id, name: project.name })),
      missingRates: [...missingRateIds].map((id) => usersById.get(id)).filter(Boolean),
      unknownProjects: [...unknownProjects],
      unknownUsers: [...unknownUsers]
    },
    period: { endDate, startDate },
    totals: finalizeTotals(totals),
    trend: [...trend.values()]
      .map((row) => ({ ...row, ...finalizeTotals(row) }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    yearTrend: yearTrendRows.map((row) => ({ ...row, ...finalizeTotals(row) }))
  };
}
