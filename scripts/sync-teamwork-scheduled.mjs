import { closeDatabase } from "../server/db.js";
import { runScheduledTeamworkSync } from "../server/scheduledTeamworkSync.js";

runScheduledTeamworkSync()
  .then(({ attempt, store }) => {
    console.log(JSON.stringify({
      attempt,
      coverageEnd: store.coverageEnd,
      coverageStart: store.coverageStart,
      projects: store.projects?.length || 0,
      status: "complete",
      timeEntries: store.timeEntries?.length || 0,
      users: store.users?.length || 0
    }));
  })
  .catch((error) => {
    console.error(error.message || "Scheduled Teamwork sync failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
