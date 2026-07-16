import { getDatabasePool } from "../server/db.js";
import { hashPassword } from "../server/userRepository.js";

const pool = getDatabasePool();
if (!pool) throw new Error("DATABASE_URL is required.");

const adminPassword = process.env.E2E_ADMIN_PASSWORD || "Ziffer-E2E-Admin-2026";
const userPassword = process.env.E2E_USER_PASSWORD || "Ziffer-E2E-User-2026";
const adminHash = await hashPassword(adminPassword);
const userHash = await hashPassword(userPassword);

await pool.query("begin");
try {
  await pool.query(`delete from quote_previews where billing_client_id in (select id from billing_clients where teamwork_project_id = 'e2e-project')`);
  await pool.query(`delete from annual_invoice_usage where billing_client_id in (select id from billing_clients where teamwork_project_id = 'e2e-project')`);
  const admin = await pool.query(
    `insert into app_users (email, display_name, password_hash, status)
     values ('e2e-admin@ziffer.test', 'E2E Administrator', $1, 'active')
     on conflict (email) do update set password_hash = excluded.password_hash, status = 'active'
     returning id`,
    [adminHash]
  );
  const user = await pool.query(
    `insert into app_users (email, display_name, password_hash, status)
     values ('e2e-user@ziffer.test', 'E2E Billing User', $1, 'active')
     on conflict (email) do update set password_hash = excluded.password_hash, status = 'active'
     returning id`,
    [userHash]
  );
  await pool.query(
    `insert into app_user_roles (user_id, role_id)
     select $1, id from app_roles where name = 'admin'
     on conflict do nothing`,
    [admin.rows[0].id]
  );
  await pool.query(
    `insert into app_user_roles (user_id, role_id)
     select $1, id from app_roles where name = 'billing_user'
     on conflict do nothing`,
    [user.rows[0].id]
  );

  const sync = await pool.query(
    `insert into teamwork_sync_runs (status, partial, coverage_start, coverage_end, trigger, fetch_start, fetch_end, finished_at)
     values ('complete', false, '2026-01-01', '2026-01-31', 'import', '2026-01-01', '2026-01-31', now())
     returning id`
  );
  await pool.query(
    `insert into teamwork_users (id, sync_run_id, name, email, user_rate)
     values ('e2e-person', $1, 'E2E Person', 'person@ziffer.test', 300)
     on conflict (id) do update set sync_run_id = excluded.sync_run_id, user_rate = excluded.user_rate`,
    [sync.rows[0].id]
  );
  await pool.query(
    `insert into teamwork_projects (id, sync_run_id, name, company_name, status, is_billable)
     values ('e2e-project', $1, 'E2E VAT Client', 'E2E VAT Client', 'active', true)
     on conflict (id) do update set sync_run_id = excluded.sync_run_id, status = 'active'`,
    [sync.rows[0].id]
  );
  await pool.query(
    `insert into teamwork_time_entries (
       id, sync_run_id, logged_on, minutes, hours, is_billable, user_id, project_id, task_id, task_name, description
     ) values ('e2e-time-vat', $1, '2026-01-15', 15, 0.25, true, 'e2e-person', 'e2e-project', 'e2e-task-vat', 'VAT / Value added tax 2026', 'E2E VAT work')
     on conflict (id) do update set sync_run_id = excluded.sync_run_id, hours = 0.25, minutes = 15, is_billable = true`,
    [sync.rows[0].id]
  );
  await pool.query(
    `insert into teamwork_time_entries (
       id, sync_run_id, logged_on, minutes, hours, is_billable, user_id, project_id, task_id, task_name, description
     ) values
       ('e2e-time-unbillable-1', $1, '2026-01-16', 6, 0.10, false, 'e2e-person', 'e2e-project', 'e2e-task-unbillable', 'E2E Unbillable Task', 'First unbillable entry'),
       ('e2e-time-unbillable-2', $1, '2026-01-17', 9, 0.15, false, 'e2e-person', 'e2e-project', 'e2e-task-unbillable', 'E2E Unbillable Task', 'Second unbillable entry')
     on conflict (id) do update set sync_run_id = excluded.sync_run_id, hours = excluded.hours, minutes = excluded.minutes, is_billable = false`,
    [sync.rows[0].id]
  );
  const client = await pool.query(
    `insert into billing_clients (
       teamwork_project_id, display_name, xero_contact_id, xero_client_name, tax_rate_name, tax_type, account_code, abbreviation, currency, status
     ) values ('e2e-project', 'E2E VAT Client', 'e2e-xero-contact', 'E2E VAT Client', 'VAT 17%', 'OUTPUT2', '70330001', 'E2E', 'EUR', 'active')
     on conflict (teamwork_project_id) do update set display_name = excluded.display_name, status = 'active'
     returning id`
  );
  const service = await pool.query("select id from standard_services where service_key = 'value_added_tax'");
  await pool.query(
    `insert into annual_invoice_usage (
       billing_client_id, service_id, source_service_name, max_hours, used_hours, for_year, active
     ) values ($1, $2, 'VAT / Value added tax', 0.10, 0, 2026, true)`,
    [client.rows[0].id, service.rows[0].id]
  );
  await pool.query("commit");
  console.log("Seeded deterministic E2E users and VAT reconciliation fixture.");
} catch (error) {
  await pool.query("rollback");
  throw error;
} finally {
  await pool.end();
}
