import { closeDatabase } from "../server/db.js";
import { persistTeamworkStoreToDatabase } from "../server/teamworkRepository.js";
import { hasStoredReportingData, readTeamworkStore } from "../server/teamworkStore.js";

async function main() {
  const store = await readTeamworkStore();
  if (!hasStoredReportingData(store)) {
    throw new Error("No stored Teamwork data found. Run Sync Teamwork first.");
  }

  const result = await persistTeamworkStoreToDatabase(store);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
