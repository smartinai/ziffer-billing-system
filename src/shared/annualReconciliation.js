import { dateIsWithinPeriod, parseMaintainCorporateRecordsPeriod } from "./annualServicePeriods.js";
import { matchStandardService } from "./quoteDrafts.js";

const supportedYears = new Set([2025, 2026]);

function roundHours(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function normalizeAnnualClientName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s)[.\s]*(a)[.]?\b/g, "sa")
    .replace(/\b(s)[.\s]*(a)[.\s]*(r)[.\s]*(l)\b/g, "sarl")
    .replace(/\b(s)[.\s]*(c)[.\s]*(s)\b/g, "scs")
    .replace(/\b(b)\s*[\d .\-/]+\b/g, " ")
    .replace(/0/g, "na")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(sarl|sa|spf|scs|ltd|limited|numero|rcs)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matrixServiceKey(value) {
  const label = normalizeAnnualClientName(value);
  if (label.includes("filing") || label.includes("correspondence")) return "filing_correspondence";
  if (label.includes("agm") || label.includes("publication")) return "agm_publication";
  if (label.includes("annual compliance")) return "annual_compliance";
  if (label.includes("financial statement") || label.includes("annual accounts") || label.startsWith("fs ")) return "financial_statements";
  if (label.includes("corporate income tax") || label.includes("cit")) return "corporate_income_tax";
  if (label.includes("value added tax") || label.includes("vat")) return "value_added_tax";
  return "";
}

function annualYear(entry) {
  const titleYear = String(entry.taskName || "").match(/\b(20\d{2})\b/);
  if (titleYear) return Number(titleYear[1]);
  const dateYear = String(entry.date || entry.loggedOn || "").match(/^(20\d{2})-/);
  return dateYear ? Number(dateYear[1]) : null;
}

function clientKeys(client) {
  return [client.displayName, client.xeroClientName, client.teamworkProjectName]
    .map(normalizeAnnualClientName)
    .filter(Boolean);
}

function findClient(name, clients) {
  const sourceKey = normalizeAnnualClientName(name);
  if (!sourceKey) return { client: null, reason: "blank" };
  const displayExact = clients.filter((client) => normalizeAnnualClientName(client.displayName) === sourceKey);
  if (displayExact.length === 1) return { client: displayExact[0], reason: "display-exact" };
  if (displayExact.length > 1) return { client: null, reason: "ambiguous" };
  const exact = clients.filter((client) => client.keys.includes(sourceKey));
  if (exact.length === 1) return { client: exact[0], reason: "exact" };
  if (exact.length > 1) return { client: null, reason: "ambiguous" };
  const partial = clients.filter((client) => client.keys.some((key) => key.includes(sourceKey) || sourceKey.includes(key)));
  return partial.length === 1
    ? { client: partial[0], reason: "partial" }
    : { client: null, reason: partial.length ? "ambiguous" : "unmatched" };
}

function calendarKey(clientId, serviceId, year) {
  return `${clientId}:${serviceId}:year:${year}`;
}

function periodKey(clientId, serviceId, start, end) {
  return `${clientId}:${serviceId}:period:${start}:${end}`;
}

function sourceDateIncluded(entry) {
  const date = String(entry.date || entry.loggedOn || "").slice(0, 10);
  return (date >= "2025-01-01" && date <= "2025-12-31")
    || (date >= "2026-01-01" && date <= "2026-06-30");
}

export function reconcileAnnualUsage({ clients = [], entries = [], matrixRows = [], services = [] }) {
  const preparedClients = clients.map((client) => ({ ...client, keys: clientKeys(client) }));
  const clientsByProject = new Map(preparedClients.filter((client) => client.xeroLinked !== false).map((client) => [String(client.teamworkProjectId || ""), client]));
  const servicesByKey = new Map(services.map((service) => [service.serviceKey, service]));
  const cells = new Map();
  const unmatchedClients = [];
  const skippedUnlinkedClients = [];

  const yearRow = matrixRows[0] || [];
  const serviceRow = matrixRows[2] || [];
  const columns = [];
  let year = null;
  for (let index = 1; index < Math.max(yearRow.length, serviceRow.length); index += 1) {
    if (supportedYears.has(Number(yearRow[index]))) year = Number(yearRow[index]);
    const serviceKey = matrixServiceKey(serviceRow[index]);
    if (supportedYears.has(year) && serviceKey && servicesByKey.has(serviceKey)) {
      columns.push({ index, service: servicesByKey.get(serviceKey), year });
    }
  }

  for (const row of matrixRows.slice(3)) {
    const sourceClientName = String(row[0] || "").trim();
    if (!sourceClientName) continue;
    const match = findClient(sourceClientName, preparedClients);
    const hasAnnualValue = columns.some(({ index }) => Number(row[index] || 0) !== 0);
    if (!match.client) {
      if (hasAnnualValue) unmatchedClients.push({ name: sourceClientName, reason: match.reason });
      continue;
    }
    if (match.client.xeroLinked === false) {
      if (hasAnnualValue) skippedUnlinkedClients.push(sourceClientName);
      continue;
    }
    for (const column of columns) {
      const key = calendarKey(match.client.id, column.service.id, column.year);
      cells.set(key, {
        billingClientId: match.client.id,
        clientName: match.client.displayName,
        coverageEnd: "",
        coverageStart: "",
        forYear: column.year,
        maxHours: roundHours(row[column.index] || 0),
        periodSource: "",
        serviceId: column.service.id,
        serviceKey: column.service.serviceKey,
        serviceName: column.service.label,
        usedHours: 0
      });
    }
  }

  const unmatchedTasks = new Map();
  for (const entry of entries) {
    if (!entry.isBillable || !sourceDateIncluded(entry)) continue;
    const client = clientsByProject.get(String(entry.projectId || ""));
    if (!client) continue;
    const hours = Number(entry.hours ?? Number(entry.minutes || 0) / 60);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const service = matchStandardService(entry.taskName, services);
    if (!service?.annualInvoiceEligible) {
      const task = String(entry.taskName || "No task").trim();
      unmatchedTasks.set(task, roundHours((unmatchedTasks.get(task) || 0) + hours));
      continue;
    }

    if (service.serviceKey === "maintain_corporate_records") {
      const coverage = parseMaintainCorporateRecordsPeriod(entry.taskName);
      if (!coverage || !dateIsWithinPeriod(entry.date || entry.loggedOn, coverage)) continue;
      const key = periodKey(client.id, service.id, coverage.startDate, coverage.endDate);
      const current = cells.get(key) || {
        billingClientId: client.id,
        clientName: client.displayName,
        coverageEnd: coverage.endDate,
        coverageStart: coverage.startDate,
        forYear: Number(coverage.endDate.slice(0, 4)),
        maxHours: 12,
        periodSource: coverage.source,
        serviceId: service.id,
        serviceKey: service.serviceKey,
        serviceName: service.label,
        usedHours: 0
      };
      current.usedHours = roundHours(current.usedHours + hours);
      cells.set(key, current);
      continue;
    }

    const yearForEntry = annualYear(entry);
    if (!supportedYears.has(yearForEntry)) continue;
    const key = calendarKey(client.id, service.id, yearForEntry);
    const current = cells.get(key) || {
      billingClientId: client.id,
      clientName: client.displayName,
      coverageEnd: "",
      coverageStart: "",
      forYear: yearForEntry,
      maxHours: 0,
      periodSource: "",
      serviceId: service.id,
      serviceKey: service.serviceKey,
      serviceName: service.label,
      usedHours: 0
    };
    current.usedHours = roundHours(current.usedHours + hours);
    cells.set(key, current);
  }

  return {
    cells: [...cells.values()].sort((a, b) => a.clientName.localeCompare(b.clientName) || a.serviceName.localeCompare(b.serviceName) || a.forYear - b.forYear),
    skippedUnlinkedClients,
    unmatchedClients,
    unmatchedTasks: [...unmatchedTasks.entries()].map(([taskName, hours]) => ({ hours, taskName })).sort((a, b) => b.hours - a.hours)
  };
}
