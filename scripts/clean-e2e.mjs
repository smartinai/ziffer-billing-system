import { getDatabasePool } from "../server/db.js";

const pool = getDatabasePool();
if (!pool) throw new Error("DATABASE_URL is required.");

await pool.query("begin");
try {
  const syncRuns = await pool.query(
    `select distinct sync_run_id as id from teamwork_time_entries where id like 'e2e-%'
     union select sync_run_id from teamwork_projects where id = 'e2e-project'
     union select sync_run_id from teamwork_users where id = 'e2e-person'`
  );
  const syncRunIds = syncRuns.rows.map((row) => row.id).filter(Boolean);

  await pool.query(`delete from audit_events where metadata->>'actor' in ('E2E Administrator', 'E2E Billing User', 'e2e-admin@ziffer.test', 'e2e-user@ziffer.test')`);
  await pool.query(`delete from quote_previews where billing_client_id in (select id from billing_clients where teamwork_project_id = 'e2e-project')`);
  await pool.query(`delete from annual_invoice_usage where billing_client_id in (select id from billing_clients where teamwork_project_id = 'e2e-project')`);
  await pool.query(`delete from billing_clients where teamwork_project_id = 'e2e-project'`);
  await pool.query(`delete from teamwork_time_entries where id like 'e2e-%'`);
  await pool.query(`delete from teamwork_projects where id = 'e2e-project'`);
  await pool.query(`delete from teamwork_users where id = 'e2e-person'`);
  if (syncRunIds.length) await pool.query(`delete from teamwork_sync_runs where id = any($1::uuid[])`, [syncRunIds]);
  await pool.query(`delete from app_users where email in ('e2e-admin@ziffer.test', 'e2e-user@ziffer.test')`);

  await pool.query("commit");
  console.log("Removed deterministic E2E fixtures.");
} catch (error) {
  await pool.query("rollback");
  throw error;
} finally {
  await pool.end();
}
