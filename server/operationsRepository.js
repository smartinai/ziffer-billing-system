import { checkDatabase, getDatabasePool } from "./db.js";

const safeOperationTypes = new Set([
  "app_health",
  "database_health",
  "backup",
  "restore_drill",
  "teamwork_sync",
  "xero_status",
  "deployment",
  "rollback",
  "disk"
]);

function sanitizeText(value, fallback = "") {
  return String(value || fallback)
    .replace(/(token|secret|password|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

function safeMetadata(metadata = {}) {
  const blocked = /token|secret|password|authorization|cookie|payload|response/i;
  return Object.fromEntries(
    Object.entries(metadata || {})
      .filter(([key]) => !blocked.test(key))
      .map(([key, value]) => [key, typeof value === "string" ? sanitizeText(value) : value])
  );
}

function mapOperation(row) {
  if (!row) return null;
  return {
    id: row.id,
    operationType: row.operation_type,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message || "",
    metadata: row.metadata || {}
  };
}

function mapIncident(row) {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    component: row.component,
    severity: row.severity,
    summary: row.summary,
    details: row.details || {},
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    occurrenceCount: Number(row.occurrence_count || 0),
    notificationSentAt: row.notification_sent_at,
    reminderSentAt: row.reminder_sent_at,
    resolvedAt: row.resolved_at
  };
}

export async function recordOperationRun(input = {}) {
  const pool = getDatabasePool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const operationType = String(input.operationType || "");
  if (!safeOperationTypes.has(operationType)) throw new Error("Invalid operation type.");
  const result = await pool.query(
    `
      insert into operation_runs (
        operation_type, trigger, status, started_at, finished_at, error_message, metadata, created_by
      ) values ($1, $2, $3, coalesce($4, clock_timestamp()), $5, $6, $7, $8)
      returning *
    `,
    [
      operationType,
      input.trigger || "scheduled",
      input.status || "running",
      input.startedAt || null,
      input.finishedAt || null,
      sanitizeText(input.errorMessage),
      JSON.stringify(safeMetadata(input.metadata)),
      input.createdBy || null
    ]
  );
  return mapOperation(result.rows[0]);
}

export async function finishOperationRun(id, input = {}) {
  const pool = getDatabasePool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const result = await pool.query(
    `
      update operation_runs
      set status = $2,
          finished_at = clock_timestamp(),
          error_message = $3,
          metadata = metadata || $4::jsonb
      where id = $1
      returning *
    `,
    [id, input.status || "complete", sanitizeText(input.errorMessage), JSON.stringify(safeMetadata(input.metadata))]
  );
  return mapOperation(result.rows[0]);
}

export async function openAlertIncident(input = {}) {
  const pool = getDatabasePool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const dedupeKey = sanitizeText(input.dedupeKey);
  if (!dedupeKey) throw new Error("Alert dedupe key is required.");
  const result = await pool.query(
    `
      insert into alert_incidents (dedupe_key, component, severity, summary, details)
      values ($1, $2, $3, $4, $5)
      on conflict (dedupe_key) where resolved_at is null
      do update set
        last_seen_at = clock_timestamp(),
        occurrence_count = alert_incidents.occurrence_count + 1,
        severity = excluded.severity,
        summary = excluded.summary,
        details = excluded.details
      returning *
    `,
    [dedupeKey, sanitizeText(input.component), input.severity === "critical" ? "critical" : "warning", sanitizeText(input.summary), JSON.stringify(safeMetadata(input.details))]
  );
  return mapIncident(result.rows[0]);
}

export async function resolveAlertIncident(dedupeKey) {
  const pool = getDatabasePool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const result = await pool.query(
    `
      update alert_incidents
      set resolved_at = clock_timestamp(), last_seen_at = clock_timestamp()
      where dedupe_key = $1 and resolved_at is null
      returning *
    `,
    [sanitizeText(dedupeKey)]
  );
  return result.rowCount ? mapIncident(result.rows[0]) : null;
}

export async function markIncidentNotification(id, { recovery = false, reminder = false } = {}) {
  const column = recovery ? "recovery_notification_sent_at" : reminder ? "reminder_sent_at" : "notification_sent_at";
  const pool = getDatabasePool();
  const result = await pool.query(`update alert_incidents set ${column} = clock_timestamp() where id = $1 returning *`, [id]);
  return result.rowCount ? mapIncident(result.rows[0]) : null;
}

export async function markIncidentNotificationByKey(dedupeKey, options = {}) {
  const pool = getDatabasePool();
  if (!pool) return null;
  const result = await pool.query(
    "select id from alert_incidents where dedupe_key = $1 and resolved_at is null order by last_seen_at desc limit 1",
    [sanitizeText(dedupeKey)]
  );
  return result.rowCount ? markIncidentNotification(result.rows[0].id, options) : null;
}

export async function listAdminEmails() {
  const pool = getDatabasePool();
  if (!pool) return [];
  const result = await pool.query(
    `
      select distinct lower(app_users.email) as email
      from app_users
      join app_user_roles on app_user_roles.user_id = app_users.id
      join app_roles on app_roles.id = app_user_roles.role_id
      where app_users.status = 'active'
        and app_roles.name = 'admin'
        and app_users.email is not null
        and app_users.email <> ''
      order by email
    `
  );
  return result.rows.map((row) => row.email);
}

export async function getOperationsOverview({ limit = 50 } = {}) {
  const pool = getDatabasePool();
  if (!pool) return { components: [], incidents: [], recentRuns: [] };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const [runs, latest, successes, failures, incidents, teamwork, xero, migrations, database] = await Promise.all([
    pool.query("select * from operation_runs order by started_at desc limit $1", [safeLimit]),
    pool.query(`select distinct on (operation_type) * from operation_runs order by operation_type, started_at desc`),
    pool.query(`select distinct on (operation_type) operation_type, finished_at from operation_runs where status = 'complete' order by operation_type, finished_at desc`),
    pool.query(`select distinct on (operation_type) operation_type, finished_at, error_message from operation_runs where status = 'failed' order by operation_type, finished_at desc`),
    pool.query("select * from alert_incidents where resolved_at is null order by severity desc, last_seen_at desc"),
    pool.query(`select status, partial, coverage_end, finished_at, error_message from teamwork_sync_runs order by started_at desc limit 1`),
    pool.query(`select max(xero_status_synced_at) as last_sync, count(*) filter (where xero_status_message ilike '%fail%')::int as failures from xero_quotes`),
    pool.query("select id, applied_at from schema_migrations order by applied_at desc limit 1"),
    checkDatabase()
  ]);

  const successByType = new Map(successes.rows.map((row) => [row.operation_type, row.finished_at]));
  const failureByType = new Map(failures.rows.map((row) => [row.operation_type, row]));
  const components = latest.rows.map((row) => ({
    component: row.operation_type,
    status: row.status,
    checkedAt: row.finished_at || row.started_at,
    latestSuccessAt: successByType.get(row.operation_type) || null,
    latestFailureAt: failureByType.get(row.operation_type)?.finished_at || null,
    latestFailureMessage: failureByType.get(row.operation_type)?.error_message || "",
    message: row.error_message || "",
    metadata: row.metadata || {}
  }));
  components.push({ component: "database", status: database.ok ? "complete" : "failed", checkedAt: database.checkedAt || new Date().toISOString(), message: database.message || "", metadata: { database: database.database || "" } });
  components.push({ component: "teamwork", status: teamwork.rows[0]?.status || "unknown", checkedAt: teamwork.rows[0]?.finished_at || null, message: teamwork.rows[0]?.error_message || "", metadata: { coverageEnd: teamwork.rows[0]?.coverage_end || null, partial: teamwork.rows[0]?.partial ?? null } });
  components.push({ component: "xero", status: Number(xero.rows[0]?.failures || 0) > 0 ? "warning" : "complete", checkedAt: xero.rows[0]?.last_sync || null, message: "", metadata: { failedDocuments: Number(xero.rows[0]?.failures || 0) } });

  return {
    checkedAt: new Date().toISOString(),
    components,
    incidents: incidents.rows.map(mapIncident),
    recentRuns: runs.rows.map(mapOperation),
    schema: { latestMigration: migrations.rows[0]?.id || "", appliedAt: migrations.rows[0]?.applied_at || null }
  };
}

export const operationsTestHooks = { safeMetadata, sanitizeText };
