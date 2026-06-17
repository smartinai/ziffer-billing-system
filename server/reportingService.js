import { buildReport } from "../src/shared/reportingMath.js";
import { config } from "./config.js";
import { normalizeProjects, normalizeTimeEntries, normalizeUsers } from "./normalizers.js";
import { fetchProjects, fetchTimeEntries, fetchUsers, getTeamworkStatus } from "./teamworkClient.js";
import { hasStoredReportingData, readTeamworkStore, writeTeamworkStore } from "./teamworkStore.js";

let sourceStatus = {
  coverageEnd: null,
  coverageStart: null,
  latestTimeEntryDate: null,
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

async function ensureStoredData() {
  const store = await readTeamworkStore();
  if (hasStoredReportingData(store)) {
    sourceStatus = summarizeStore(store);
    return store;
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

  const store = await writeTeamworkStore({
    api: mergeMetadata([usersResponse.metadata, projectsResponse.metadata, timeResponse.metadata]),
    coverageEnd,
    coverageStart,
    projects: normalizeProjects(projectsResponse.rows),
    syncedAt: new Date().toISOString(),
    timeEntries: normalizeTimeEntries(timeResponse.rows),
    users: normalizeUsers(usersResponse.rows)
  });

  sourceStatus = summarizeStore(store, "stored");
  return store;
}

function buildStoredReport(store, startDate, endDate) {
  const report = buildReport({
    currency: config.currency,
    endDate,
    projects: store.projects || [],
    startDate,
    timeEntries: store.timeEntries || [],
    users: store.users || []
  });

  const storageWarnings = coverageWarnings(store, startDate, endDate);
  report.metadata = {
    ...report.metadata,
    api: store.api || { pagesFetched: 0, partial: false, warnings: [] },
    fetchedAt: store.syncedAt,
    source: getTeamworkStatus(),
    storage: {
      coverageEnd: store.coverageEnd,
      coverageStart: store.coverageStart,
      mode: "stored",
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
  const store = await syncTeamworkStore();
  return buildStoredReport(store, startDate, endDate);
}

export function getSourceStatus() {
  return {
    ...sourceStatus,
    teamwork: getTeamworkStatus()
  };
}
