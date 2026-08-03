import { buildAggregatedQuotePreview } from "./quoteDrafts.js";
import { effectiveRateForEntry } from "./mariaRoleRates.js";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function emptyMetric() {
  return { amount: 0, hours: 0 };
}

function emptyClassification() {
  return {
    totalTeamwork: emptyMetric(),
    totalBillable: emptyMetric(),
    prepaid: emptyMetric(),
    estimatedPrepaid: emptyMetric(),
    confirmedPrepaid: emptyMetric(),
    confirmedXero: emptyMetric(),
    estimatedBillable: emptyMetric(),
    effectiveBillable: emptyMetric(),
    fixedFees: emptyMetric(),
    netBillable: emptyMetric(),
    writeOffs: emptyMetric(),
    nonBillable: emptyMetric(),
    internalNonBillable: emptyMetric()
  };
}

function ensure(map, key) {
  if (!key) return null;
  if (!map.has(key)) map.set(key, emptyClassification());
  return map.get(key);
}

function add(metric, hours, amount) {
  metric.hours += number(hours);
  metric.amount += number(amount);
}

function addAtAllGrains(maps, userId, projectId, metricName, hours, amount) {
  if (!userId || !projectId) return;
  add(ensure(maps.byUser, userId)[metricName], hours, amount);
  add(ensure(maps.byProject, projectId)[metricName], hours, amount);
  add(ensure(maps.byUserProject, `${userId}:${projectId}`)[metricName], hours, amount);
  add(ensure(maps.byProjectUser, `${projectId}:${userId}`)[metricName], hours, amount);
}

function finalizeMetric(metric) {
  return { amount: round(metric.amount), hours: round(metric.hours, 4) };
}

function finalizeClassification(value) {
  const classification = Object.fromEntries(
    Object.entries(value).map(([key, metric]) => [key, finalizeMetric(metric)])
  );
  classification.netBillable = {
    amount: round(Math.max(classification.totalBillable.amount - classification.prepaid.amount - classification.fixedFees.amount, 0)),
    hours: round(Math.max(classification.totalBillable.hours - classification.prepaid.hours - classification.fixedFees.hours, 0), 4)
  };
  classification.estimatedBillable = {
    amount: round(Math.max(classification.estimatedBillable.amount - classification.estimatedPrepaid.amount - classification.fixedFees.amount, 0)),
    hours: round(Math.max(classification.estimatedBillable.hours - classification.estimatedPrepaid.hours - classification.fixedFees.hours, 0), 4)
  };
  classification.writeOffs.amount = round(Math.min(classification.writeOffs.amount, classification.netBillable.amount));
  classification.writeOffs.hours = round(Math.min(classification.writeOffs.hours, classification.netBillable.hours), 4);
  classification.effectiveBillable = {
    amount: round(classification.confirmedXero.amount + classification.writeOffs.amount + classification.estimatedBillable.amount),
    hours: round(classification.confirmedXero.hours + classification.writeOffs.hours + classification.estimatedBillable.hours, 4)
  };
  classification.internalNonBillable.amount = round(
    Math.min(classification.internalNonBillable.amount, classification.nonBillable.amount)
  );
  classification.internalNonBillable.hours = round(
    Math.min(classification.internalNonBillable.hours, classification.nonBillable.hours),
    4
  );
  return classification;
}

function finalizedMaps(maps) {
  return Object.fromEntries(
    Object.entries(maps).map(([name, map]) => [
      name,
      Object.fromEntries([...map.entries()].map(([key, value]) => [key, finalizeClassification(value)]))
    ])
  );
}

function entryDate(entry) {
  return String(entry.date || entry.loggedOn || "");
}

export function buildReportingClassifications({
  allowedProjectIds = [],
  annualUsage = [],
  billingClients = [],
  confirmedAllocations = [],
  endDate,
  excludedProjectIds = [],
  mariaRatePolicy = {},
  projects = [],
  services = [],
  startDate,
  timeEntries = [],
  users = [],
  writeOffs = []
}) {
  const excluded = new Set(excludedProjectIds.map(String));
  const allowedProjects = new Set(allowedProjectIds.map(String));
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const projectsById = new Map(projects.map((project) => [String(project.id), project]));
  const clientsByProject = new Map(billingClients.map((client) => [String(client.teamworkProjectId), client]));
  const reportEntries = timeEntries.filter((entry) => {
    const date = entryDate(entry);
    return date >= startDate && date <= endDate && !excluded.has(String(entry.projectId))
      && (!allowedProjects.size || allowedProjects.has(String(entry.projectId)))
      && usersById.has(String(entry.userId)) && projectsById.has(String(entry.projectId));
  });
  const rateForEntry = (entry) => effectiveRateForEntry({
    defaultRate: Number(usersById.get(String(entry.userId))?.userRate || 0),
    mariaRolesByProject: mariaRatePolicy.rolesByProject || {},
    mariaTeamworkUserId: mariaRatePolicy.userId || "",
    projectId: entry.projectId,
    userId: entry.userId
  });
  const maps = {
    byProject: new Map(),
    byProjectUser: new Map(),
    byUser: new Map(),
    byUserProject: new Map()
  };
  const confirmedEntryIds = new Set([
    ...confirmedAllocations.map((allocation) => String(allocation.entryId || "")),
    ...writeOffs.map((allocation) => String(allocation.entryId || ""))
  ].filter(Boolean));

  for (const entry of reportEntries) {
    const hours = number(entry.hours ?? number(entry.minutes) / 60);
    const rate = rateForEntry(entry);
    const amount = hours * rate;
    const userId = String(entry.userId);
    const projectId = String(entry.projectId);
    addAtAllGrains(maps, userId, projectId, "totalTeamwork", hours, amount);
    if (entry.isBillable) {
      addAtAllGrains(maps, userId, projectId, "totalBillable", hours, amount);
      if (!confirmedEntryIds.has(String(entry.id))) {
        addAtAllGrains(maps, userId, projectId, "estimatedBillable", hours, amount);
      }
    } else {
      addAtAllGrains(maps, userId, projectId, "nonBillable", hours, amount);
      if (!String(clientsByProject.get(projectId)?.xeroContactId || "").trim()) {
        addAtAllGrains(maps, userId, projectId, "internalNonBillable", hours, amount);
      }
    }
  }

  const allEntriesByProject = new Map();
  for (const entry of timeEntries) {
    const projectId = String(entry.projectId || "");
    if (!projectId || excluded.has(projectId) || (allowedProjects.size && !allowedProjects.has(projectId))
      || entryDate(entry) > endDate) continue;
    if (!allEntriesByProject.has(projectId)) allEntriesByProject.set(projectId, []);
    allEntriesByProject.get(projectId).push({
      ...entry,
      date: entryDate(entry),
      hours: number(entry.hours ?? number(entry.minutes) / 60),
      teamworkInvoiceId: "",
      userName: usersById.get(String(entry.userId))?.name || "",
      userRate: rateForEntry(entry)
    });
  }

  for (const [projectId, entries] of allEntriesByProject) {
    const client = clientsByProject.get(projectId);
    if (!client || client.status === "excluded") continue;
    const clientUsage = annualUsage.filter((usage) => String(usage.billingClientId) === String(client.id));
    if (!clientUsage.length) continue;
    const preview = buildAggregatedQuotePreview({
      annualUsage: clientUsage,
      billingClient: client,
      entries,
      periodEnd: endDate,
      periodStart: entries.map(entryDate).sort()[0] || startDate,
      services
    });
    const entriesById = new Map(entries.map((entry) => [String(entry.id), entry]));
    for (const line of preview.lines.filter((item) => item.annualCovered)) {
      for (const part of line.entries || []) {
        const entry = entriesById.get(String(part.id));
        const date = entryDate(entry || {});
        if (!entry || confirmedEntryIds.has(String(entry.id)) || date < startDate || date > endDate) continue;
        const hours = number(part.hours);
        const amount = hours * number(entry.userRate);
        addAtAllGrains(
          maps,
          String(entry.userId),
          projectId,
          "prepaid",
          hours,
          amount
        );
        addAtAllGrains(
          maps,
          String(entry.userId),
          projectId,
          "estimatedPrepaid",
          hours,
          amount
        );
      }
    }
  }

  for (const allocation of confirmedAllocations) {
    const metricName = allocation.type === "prepaid" ? "confirmedPrepaid" : "confirmedXero";
    addAtAllGrains(
      maps,
      String(allocation.userId || ""),
      String(allocation.projectId || ""),
      metricName,
      allocation.hours,
      allocation.amount
    );
    if (allocation.type === "prepaid") {
      addAtAllGrains(
        maps,
        String(allocation.userId || ""),
        String(allocation.projectId || ""),
        "prepaid",
        allocation.hours,
        allocation.amount
      );
    }
  }

  for (const allocation of writeOffs) {
    addAtAllGrains(
      maps,
      String(allocation.userId || ""),
      String(allocation.projectId || ""),
      "writeOffs",
      allocation.hours,
      allocation.amount
    );
  }

  return finalizedMaps(maps);
}

export function attachReportingClassifications(report, classifications) {
  const classificationFor = (map, key) => map?.[key] || finalizeClassification(emptyClassification());
  const byUser = (report.byUser || []).map((person) => ({
    ...person,
    hourClassification: classificationFor(classifications.byUser, String(person.id)),
    projectBreakdown: (person.projectBreakdown || []).map((project) => ({
      ...project,
      hourClassification: classificationFor(
        classifications.byUserProject,
        `${person.id}:${project.id}`
      )
    }))
  }));
  const byProject = (report.byProject || []).map((project) => ({
    ...project,
    hourClassification: classificationFor(classifications.byProject, String(project.id)),
    peopleBreakdown: (project.peopleBreakdown || []).map((person) => ({
      ...person,
      hourClassification: classificationFor(
        classifications.byProjectUser,
        `${project.id}:${person.id}`
      )
    }))
  }));
  return { ...report, byClient: byProject, byProject, byUser };
}

export const reportingClassificationTestHooks = {
  emptyClassification,
  finalizeClassification
};
