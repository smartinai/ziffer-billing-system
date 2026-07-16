import { closeDatabase } from "../server/db.js";
import { recordOperationRun } from "../server/operationsRepository.js";
import { runScheduledTeamworkSync } from "../server/scheduledTeamworkSync.js";

const startedAt = new Date();
try {
  const { attempt, store } = await runScheduledTeamworkSync();
  await recordOperationRun({
    operationType: "teamwork_sync",
    trigger: "scheduled",
    status: "complete",
    startedAt,
    finishedAt: new Date(),
    metadata: { attempt, coverageEnd: store.coverageEnd, coverageStart: store.coverageStart }
  });
  console.log(JSON.stringify({
    attempt,
    coverageEnd: store.coverageEnd,
    coverageStart: store.coverageStart,
    projects: store.projects?.length || 0,
    status: "complete",
    timeEntries: store.timeEntries?.length || 0,
    users: store.users?.length || 0
  }));
} catch (error) {
  await recordOperationRun({
    operationType: "teamwork_sync",
    trigger: "scheduled",
    status: "failed",
    startedAt,
    finishedAt: new Date(),
    errorMessage: error.message
  }).catch(() => undefined);
  console.error(error.message || "Scheduled Teamwork sync failed.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
