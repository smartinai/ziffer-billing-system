import "dotenv/config";
import process from "node:process";
import { closeDatabase } from "../server/db.js";
import { syncTeamworkStore } from "../server/reportingService.js";

function parse(argv) {
  const values = Object.fromEntries(argv.map((arg) => arg.split("=", 2)).filter(([key]) => key.startsWith("--")));
  return { startDate: values["--start"], endDate: values["--end"] };
}

const { startDate, endDate } = parse(process.argv.slice(2));
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || "") || startDate > endDate) {
  throw new Error("Use --start=YYYY-MM-DD and --end=YYYY-MM-DD.");
}

try {
  const store = await syncTeamworkStore({ mode: "reconcile", startDate, endDate, trigger: "import" });
  console.log(JSON.stringify({
    coverageEnd: store.coverageEnd,
    coverageStart: store.coverageStart,
    projects: store.projects?.length || 0,
    timeEntries: store.timeEntries?.length || 0,
    users: store.users?.length || 0
  }));
} finally {
  await closeDatabase();
}
