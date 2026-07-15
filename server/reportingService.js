import { buildReport } from "../src/shared/reportingMath.js";
import { config } from "./config.js";
import { listExcludedTeamworkProjectIds } from "./billingClientRepository.js";
import { normalizeProjects, normalizeTimeEntries, normalizeUsers } from "./normalizers.js";
import { listReportingDocumentAggregates } from "./reportingDocumentAggregateRepository.js";
import { fetchProjects, fetchTimeEntries, fetchUsers, getTeamworkStatus } from "./teamworkClient.js";
import { hasStoredReportingData, readTeamworkStore, writeTeamworkStore } from "./teamworkStore.js";
import { persistTeamworkStoreToDatabase, readTeamworkStoreFromDatabase } from "./teamworkRepository.js";

let sourceStatus = {
  coverageEnd: null,
  coverageStart: null,
  latestTimeEntryDate: null,
  database: null,
  projectCount: 0,
  status: "idle",
  syncedAt: null,
  timeEntryCount: 0,
  userCount: 0
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function mergeMetadata(parts) {
  return {
    pagesFetched: parts.reduce((sum, part) => sum + Number(part?.pagesFetched || 0), 0),
    partial: parts.some((part) => part?.partial),
    warnings: parts.map((part) => part?.warning).filter(Boolean)
  };
}

function summarizeStore(store, status = "stored") {
  return {
    coverageEnd: store?.coverageEnd || null,
    coverageStart: store?.coverageStart || null,
    latestTimeEntryDate: store?.timeEntries?.map((entry) => entry.date).sort().at(-1) || null,
    database: store?.database || null,
    projectCount: store?.projects?.length || 0,
    status,
    syncedAt: store?.syncedAt || null,
    timeEntryCount: store?.timeEntries?.length || 0,
    userCount: store?.users?.length || 0
  };
}

function coverageWarnings(store, startDate, endDate) {
  const warnings = [];
  if (!store?.coverageStart || !store?.coverageEnd) return warnings;
  if (startDate < store.coverageStart) {
    warnings.push(`Selected start date is before stored data coverage (${store.coverageStart}).`);
  }
  if (endDate > store.coverageEnd) {
    warnings.push(`Selected end date is after stored data coverage (${store.coverageEnd}). Sync to update storage.`);
  }
  return warnings;
}

function zeroMetric() {
  return { amount: 0, hours: 0 };
}

function zeroDocumentAggregate() {
  return {
    excludingPrepaid: zeroMetric(),
    paidInXero: zeroMetric(),
    sentToXero: zeroMetric()
  };
}

function metricFromTotals(totals = {}) {
  return {
    amount: Number(totals.money || 0),
    hours: Number(totals.billableHours || 0)
  };
}

function metricFromAggregate(aggregate = {}, key) {
  const metric = aggregate[key] || {};
  return {
    amount: Number(metric.amount || 0),
    hours: Number(metric.hours || 0)
  };
}

function reportingAggregate(totals, documentAggregate = {}) {
  return {
    teamworkEstimate: metricFromTotals(totals),
    excludingPrepaid: metricFromAggregate(documentAggregate, "excludingPrepaid"),
    paidInXero: metricFromAggregate(documentAggregate, "paidInXero"),
    sentToXero: metricFromAggregate(documentAggregate, "sentToXero")
  };
}

function attachDocumentAggregates(report, documentAggregates) {
  const aggregates = documentAggregates || zeroDocumentAggregate();

  const byUser = (report.byUser || []).map((person) => ({
    ...person,
    aggregate: reportingAggregate(person.totals, aggregates.byUser?.[String(person.id)]),
    projectBreakdown: (person.projectBreakdown || []).map((project) => ({
      ...project,
      aggregate: reportingAggregate(project.totals, aggregates.byUserProject?.[`${person.id}:${project.id}`])
    }))
  }));

  const byProject = (report.byProject || []).map((project) => ({
    ...project,
    aggregate: reportingAggregate(project.totals, aggregates.byProject?.[String(project.id)]),
    peopleBreakdown: (project.peopleBreakdown || []).map((person) => ({
      ...person,
      aggregate: reportingAggregate(person.totals, aggregates.byProjectUser?.[`${project.id}:${person.id}`])
    }))
  }));

  return {
    ...report,
    byClient: byProject,
    byProject,
    byUser
  };
}

async function ensureStoredData() {
  const store = await readTeamworkStore();
  if (hasStoredReportingData(store)) {
    sourceStatus = summarizeStore(store);
    return store;
  }

  try {
    const databaseStore = await readTeamworkStoreFromDatabase();
    if (hasStoredReportingData(databaseStore)) {
      let restoredStore = databaseStore;
      try {
        restoredStore = await writeTeamworkStore(databaseStore);
      } catch (error) {
        console.error(`Could not persist PostgreSQL reporting cache: ${error.message}`);
      }
      sourceStatus = summarizeStore(restoredStore, "stored");
      return restoredStore;
    }
  } catch (error) {
    console.error(`Could not restore reporting cache from PostgreSQL: ${error.message}`);
  }

  return syncTeamworkStore();
}

export async function syncTeamworkStore(options = {}) {
  const coverageStart = options.startDate || config.defaultStartDate;
  const coverageEnd = options.endDate || today();
  sourceStatus = { ...sourceStatus, coverageEnd, coverageStart, status: "syncing" };

  const [usersResponse, projectsResponse, timeResponse] = await Promise.all([
    fetchUsers(),
    fetchProjects(),
    fetchTimeEntries(coverageStart, coverageEnd)
  ]);

  const normalizedStore = {
    api: mergeMetadata([usersResponse.metadata, projectsResponse.metadata, timeResponse.metadata]),
    coverageEnd,
    coverageStart,
    projects: normalizeProjects(projectsResponse.rows),
    syncedAt: new Date().toISOString(),
    timeEntries: normalizeTimeEntries(timeResponse.rows),
    users: normalizeUsers(usersResponse.rows)
  };

  let database;
  try {
    database = await persistTeamworkStoreToDatabase(normalizedStore, {
      projects: projectsResponse.rows,
      timeEntries: timeResponse.rows,
      users: usersResponse.rows
    });
  } catch (error) {
    database = {
      configured: true,
      message: error.message,
      ok: false
    };
    console.error(`Teamwork database persistence failed: ${error.message}`);
  }

  const store = await writeTeamworkStore({
    ...normalizedStore,
    database
  });

  sourceStatus = summarizeStore(store, "stored");
  return store;
}

async function buildStoredReport(store, startDate, endDate) {
  let excludedProjectIds = [];
  try {
    excludedProjectIds = await listExcludedTeamworkProjectIds();
  } catch (error) {
    console.error(`Could not load excluded billing clients: ${error.message}`);
  }

  let report = buildReport({
    currency: config.currency,
    endDate,
    excludedProjectIds,
    projects: store.projects || [],
    startDate,
    timeEntries: store.timeEntries || [],
    users: store.users || []
  });

  let documentAggregateStatus = { available: false, warning: "" };
  try {
    const documentAggregates = await listReportingDocumentAggregates(startDate, endDate);
    report = attachDocumentAggregates(report, documentAggregates);
    documentAggregateStatus = { available: true, warning: "" };
  } catch (error) {
    report = attachDocumentAggregates(report, {});
    documentAggregateStatus = { available: false, warning: error.message || "Document aggregate data is unavailable." };
    console.error(`Could not load reporting document aggregates: ${error.message}`);
  }

  const storageWarnings = coverageWarnings(store, startDate, endDate);
  report.metadata = {
    ...report.metadata,
    api: store.api || { pagesFetched: 0, partial: false, warnings: [] },
    fetchedAt: store.syncedAt,
    source: getTeamworkStatus(),
    storage: {
      coverageEnd: store.coverageEnd,
      coverageStart: store.coverageStart,
      documentAggregates: documentAggregateStatus,
      mode: "stored",
      database: store.database || null,
      storeSyncedAt: store.syncedAt,
      warnings: storageWarnings
    }
  };

  return {
    ...report,
    fromCache: false,
    fromStorage: true
  };
}

export async function getReportingSummary(startDate, endDate) {
  const store = await ensureStoredData();
  return buildStoredReport(store, startDate, endDate);
}

export async function refreshStoredReportingSummary(startDate, endDate) {
  const yearStartDate = `${String(endDate || startDate).slice(0, 4)}-01-01`;
  const store = await syncTeamworkStore({ endDate, startDate: yearStartDate });
  return buildStoredReport(store, startDate, endDate);
}

export function getSourceStatus() {
  return {
    ...sourceStatus,
    teamwork: getTeamworkStatus()
  };
}
