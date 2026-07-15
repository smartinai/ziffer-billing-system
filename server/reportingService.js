import { buildReport } from "../src/shared/reportingMath.js";
import { config } from "./config.js";
import { listExcludedTeamworkProjectIds } from "./billingClientRepository.js";
import { normalizeProjects, normalizeTimeEntries, normalizeUsers } from "./normalizers.js";
import { listReportingDocumentAggregates } from "./reportingDocumentAggregateRepository.js";
import { fetchProjects, fetchTimeEntries, fetchUsers, getTeamworkStatus } from "./teamworkClient.js";
import { hasStoredReportingData, readTeamworkStore, writeTeamworkStore } from "./teamworkStore.js";
import {
  acquireTeamworkSyncLock,
  createTeamworkSyncRun,
  failTeamworkSyncRun,
  getLatestSuccessfulTeamworkSyncRun,
  getTeamworkSyncStatus,
  persistTeamworkStoreToDatabase,
  readTeamworkStoreFromDatabase
} from "./teamworkRepository.js";

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

function dateInTimezone(value = new Date(), timeZone = config.timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function today() {
  return dateInTimezone();
}

function syncRange({ checkpoint, endDate, mode, startDate }) {
  if (mode !== "incremental") {
    const fetchStart = startDate || config.defaultStartDate;
    return { coverageStart: fetchStart, fetchEnd: endDate, fetchStart };
  }

  return {
    coverageStart: checkpoint?.coverageStart || config.defaultStartDate,
    fetchEnd: endDate,
    fetchStart: checkpoint?.coverageEnd || config.defaultStartDate
  };
}

function mergeRowsById(existing = [], incoming = []) {
  const rows = new Map(existing.map((row) => [String(row.id), row]));
  for (const row of incoming) rows.set(String(row.id), row);
  return [...rows.values()];
}

function mergeIncrementalStore(existing, delta) {
  return {
    ...existing,
    ...delta,
    projects: mergeRowsById(existing?.projects, delta.projects),
    timeEntries: mergeRowsById(existing?.timeEntries, delta.timeEntries),
    users: mergeRowsById(existing?.users, delta.users)
  };
}

function publicSyncError(error) {
  if (error?.code === "TEAMWORK_SYNC_IN_PROGRESS") return error.message;
  if (error?.code === "TEAMWORK_SYNC_PARTIAL") return "Teamwork returned incomplete data; the previous reporting data remains active.";
  return "Teamwork synchronization failed; the previous reporting data remains active.";
}

function syncLockedError() {
  const error = new Error("Another Teamwork sync is already running.");
  error.code = "TEAMWORK_SYNC_IN_PROGRESS";
  error.statusCode = 409;
  return error;
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
  const mode = options.mode === "incremental" ? "incremental" : "full";
  const trigger = options.trigger || "manual";
  const attempt = Math.max(1, Number(options.attempt || 1));
  const coverageEnd = options.endDate || today();
  const lock = await acquireTeamworkSyncLock();
  if (!lock.acquired) {
    const error = syncLockedError();
    try {
      const checkpoint = mode === "incremental" ? await getLatestSuccessfulTeamworkSyncRun() : null;
      const range = syncRange({ checkpoint, endDate: coverageEnd, mode, startDate: options.startDate });
      const blockedRunId = await createTeamworkSyncRun({
        attempt,
        coverageEnd,
        coverageStart: range.coverageStart,
        fetchEnd: range.fetchEnd,
        fetchStart: range.fetchStart,
        source: { mode },
        trigger
      });
      await failTeamworkSyncRun(blockedRunId, { errorMessage: publicSyncError(error) });
    } catch (recordError) {
      console.error(`Could not record blocked Teamwork sync: ${recordError.message}`);
    }
    sourceStatus = { ...sourceStatus, status: "failed" };
    throw error;
  }

  let syncRunId = null;
  try {
    const checkpoint = mode === "incremental" ? await getLatestSuccessfulTeamworkSyncRun() : null;
    const range = syncRange({
      checkpoint,
      endDate: coverageEnd,
      mode,
      startDate: options.startDate
    });
    sourceStatus = {
      ...sourceStatus,
      coverageEnd,
      coverageStart: range.coverageStart,
      status: "syncing"
    };

    syncRunId = await createTeamworkSyncRun({
      attempt,
      coverageEnd,
      coverageStart: range.coverageStart,
      fetchEnd: range.fetchEnd,
      fetchStart: range.fetchStart,
      source: { mode },
      trigger
    });

    const responses = await Promise.allSettled([
      fetchUsers(),
      fetchProjects(),
      fetchTimeEntries(range.fetchStart, range.fetchEnd)
    ]);
    const failedResponse = responses.find((response) => response.status === "rejected");
    if (failedResponse) throw failedResponse.reason;
    const [usersResponse, projectsResponse, timeResponse] = responses.map((response) => response.value);
    const api = mergeMetadata([usersResponse.metadata, projectsResponse.metadata, timeResponse.metadata]);
    if (api.partial) {
      const error = new Error("Teamwork returned a partial response.");
      error.code = "TEAMWORK_SYNC_PARTIAL";
      error.partial = true;
      error.warnings = api.warnings;
      throw error;
    }

    const normalizedStore = {
      api,
      coverageEnd,
      coverageStart: range.coverageStart,
      projects: normalizeProjects(projectsResponse.rows),
      syncedAt: new Date().toISOString(),
      timeEntries: normalizeTimeEntries(timeResponse.rows),
      users: normalizeUsers(usersResponse.rows)
    };

    const database = await persistTeamworkStoreToDatabase(
      normalizedStore,
      {
        projects: projectsResponse.rows,
        timeEntries: timeResponse.rows,
        users: usersResponse.rows
      },
      {
        attempt,
        fetchEnd: range.fetchEnd,
        fetchStart: range.fetchStart,
        syncRunId,
        trigger
      }
    );

    let completeStore = await readTeamworkStoreFromDatabase();
    if (!completeStore) {
      const existingStore = mode === "incremental" ? await readTeamworkStore() : null;
      completeStore = mode === "incremental"
        ? mergeIncrementalStore(existingStore || {}, normalizedStore)
        : normalizedStore;
      completeStore.database = database;
    }

    const store = await writeTeamworkStore(completeStore);
    sourceStatus = summarizeStore(store, "stored");
    return store;
  } catch (error) {
    const message = publicSyncError(error);
    await failTeamworkSyncRun(syncRunId, {
      errorMessage: message,
      partial: Boolean(error.partial),
      warnings: error.warnings || []
    }).catch((runError) => {
      console.error(`Could not record failed Teamwork sync: ${runError.message}`);
    });
    sourceStatus = { ...sourceStatus, status: "failed" };
    console.error(`Teamwork synchronization failed: ${error.message}`);
    throw error;
  } finally {
    await lock.release();
  }
}

export async function runIncrementalTeamworkSync(options = {}) {
  return syncTeamworkStore({ ...options, mode: "incremental", trigger: options.trigger || "scheduled" });
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
  const store = await syncTeamworkStore({ endDate, mode: "full", startDate: yearStartDate, trigger: "manual" });
  return buildStoredReport(store, startDate, endDate);
}

export async function getSourceStatus() {
  let persisted = { lastAttempt: null, lastScheduledAttempt: null, lastSuccess: null };
  try {
    persisted = await getTeamworkSyncStatus();
  } catch (error) {
    console.error(`Could not load Teamwork sync status: ${error.message}`);
  }
  return {
    ...sourceStatus,
    ...persisted,
    schedule: {
      attempts: config.teamworkScheduledSyncAttempts,
      retryMinutes: config.teamworkScheduledSyncRetryMs / 60000,
      time: "00:00",
      timezone: config.timezone
    },
    teamwork: getTeamworkStatus()
  };
}

export const reportingServiceTestHooks = {
  dateInTimezone,
  mergeIncrementalStore,
  publicSyncError,
  syncRange
};
