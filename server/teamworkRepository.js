import { getDatabasePool, isDatabaseConfigured } from "./db.js";

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function timestamp(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildTeamworkStoreFromDatabaseRows({ projects = [], run = null, timeEntries = [], users = [] } = {}) {
  if (!run || !users.length || !projects.length) return null;

  const source = run.source && typeof run.source === "object" ? run.source : {};
  const api = source.api && typeof source.api === "object"
    ? source.api
    : {
        pagesFetched: numberValue(run.pages_fetched),
        partial: Boolean(run.partial),
        warnings: Array.isArray(run.warnings) ? run.warnings : []
      };

  return {
    api,
    coverageEnd: dateOnly(run.coverage_end),
    coverageStart: dateOnly(run.coverage_start),
    database: {
      configured: true,
      ok: true,
      restoredFromDatabase: true,
      syncRunId: run.id
    },
    projects: projects.map((row) => ({
      companyId: row.company_id || "",
      companyName: row.company_name || "",
      id: String(row.id),
      isBillable: row.is_billable !== false,
      name: row.name || `Project ${row.id}`,
      status: row.status || "active"
    })),
    syncedAt: timestamp(run.finished_at || run.created_at),
    timeEntries: timeEntries.map((row) => ({
      date: dateOnly(row.logged_on),
      description: row.description || "",
      hours: numberValue(row.hours),
      id: String(row.id),
      isBillable: Boolean(row.is_billable),
      minutes: numberValue(row.minutes),
      projectId: row.project_id ? String(row.project_id) : "",
      sourceCreatedAt: timestamp(row.created_at_source),
      sourceUpdatedAt: timestamp(row.updated_at_source),
      tags: Array.isArray(row.tags) ? row.tags : [],
      taskId: row.task_id || "",
      taskName: row.task_name || "",
      teamworkInvoiceId: row.teamwork_invoice_id || "",
      userId: row.user_id ? String(row.user_id) : ""
    })),
    users: users.map((row) => ({
      avatarUrl: row.avatar_url || "",
      companyId: row.company_id || "",
      email: row.email || "",
      id: String(row.id),
      name: row.name || row.email || `User ${row.id}`,
      userCost: numberValue(row.user_cost),
      userRate: numberValue(row.user_rate)
    }))
  };
}

function rawRowsById(rows = []) {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function nullIfEmpty(value) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

function rawFor(rawById, id) {
  return rawById.get(String(id)) || {};
}

function jsonb(value) {
  return JSON.stringify(value ?? {});
}

function syncRunSummary(row) {
  if (!row) return null;
  return {
    attempt: Number(row.attempt || 1),
    coverageEnd: dateOnly(row.coverage_end),
    coverageStart: dateOnly(row.coverage_start),
    errorMessage: row.error_message || "",
    fetchEnd: dateOnly(row.fetch_end),
    fetchStart: dateOnly(row.fetch_start),
    finishedAt: timestamp(row.finished_at),
    id: row.id,
    partial: Boolean(row.partial),
    startedAt: timestamp(row.started_at),
    status: row.status || "",
    trigger: row.trigger || "manual"
  };
}

export async function acquireTeamworkSyncLock() {
  if (!isDatabaseConfigured()) {
    return { acquired: true, release: async () => {} };
  }

  const client = await getDatabasePool().connect();
  let released = false;
  try {
    const result = await client.query(
      "select pg_try_advisory_lock(hashtext($1)) as acquired",
      ["ziffer:teamwork-sync"]
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return { acquired: false, release: async () => {} };
    }

    return {
      acquired: true,
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query("select pg_advisory_unlock(hashtext($1))", ["ziffer:teamwork-sync"]);
        } finally {
          client.release();
        }
      }
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

export async function createTeamworkSyncRun({
  attempt = 1,
  coverageEnd,
  coverageStart,
  fetchEnd,
  fetchStart,
  source = {},
  trigger = "manual"
}) {
  if (!isDatabaseConfigured()) return null;
  const result = await getDatabasePool().query(
    `
      insert into teamwork_sync_runs (
        started_at, coverage_start, coverage_end, status, partial, source,
        trigger, fetch_start, fetch_end, attempt, error_message
      )
      values (clock_timestamp(), $1, $2, 'running', false, $3, $4, $5, $6, $7, '')
      returning id
    `,
    [
      coverageStart || null,
      coverageEnd || null,
      jsonb(source),
      trigger,
      fetchStart || null,
      fetchEnd || null,
      Math.max(1, Number(attempt || 1))
    ]
  );
  return result.rows[0]?.id || null;
}

export async function failTeamworkSyncRun(syncRunId, { errorMessage = "", partial = false, warnings = [] } = {}) {
  if (!syncRunId || !isDatabaseConfigured()) return;
  await getDatabasePool().query(
    `
      update teamwork_sync_runs
      set
        finished_at = clock_timestamp(),
        status = 'failed',
        partial = $2,
        warnings = $3,
        error_message = $4
      where id = $1
    `,
    [syncRunId, Boolean(partial), jsonb(warnings), String(errorMessage || "").slice(0, 500)]
  );
}

export async function getLatestSuccessfulTeamworkSyncRun() {
  if (!isDatabaseConfigured()) return null;
  const result = await getDatabasePool().query(`
    select
      id, started_at, finished_at, coverage_start::text as coverage_start,
      coverage_end::text as coverage_end, status, partial, trigger,
      fetch_start::text as fetch_start, fetch_end::text as fetch_end, attempt, error_message
    from teamwork_sync_runs
    where status = 'complete' and partial = false
    order by finished_at desc nulls last, started_at desc
    limit 1
  `);
  return syncRunSummary(result.rows[0]);
}

export async function getTeamworkSyncStatus() {
  if (!isDatabaseConfigured()) return { lastAttempt: null, lastScheduledAttempt: null, lastSuccess: null };
  const pool = getDatabasePool();
  const [attemptResult, scheduledResult, successResult] = await Promise.all([
    pool.query(`
      select
        id, started_at, finished_at, coverage_start::text as coverage_start,
        coverage_end::text as coverage_end, status, partial, trigger,
        fetch_start::text as fetch_start, fetch_end::text as fetch_end, attempt, error_message
      from teamwork_sync_runs
      order by started_at desc
      limit 1
    `),
    pool.query(`
      select
        id, started_at, finished_at, coverage_start::text as coverage_start,
        coverage_end::text as coverage_end, status, partial, trigger,
        fetch_start::text as fetch_start, fetch_end::text as fetch_end, attempt, error_message
      from teamwork_sync_runs
      where trigger = 'scheduled'
      order by started_at desc
      limit 1
    `),
    pool.query(`
      select
        id, started_at, finished_at, coverage_start::text as coverage_start,
        coverage_end::text as coverage_end, status, partial, trigger,
        fetch_start::text as fetch_start, fetch_end::text as fetch_end, attempt, error_message
      from teamwork_sync_runs
      where status = 'complete' and partial = false
      order by finished_at desc nulls last, started_at desc
      limit 1
    `)
  ]);
  return {
    lastAttempt: syncRunSummary(attemptResult.rows[0]),
    lastScheduledAttempt: syncRunSummary(scheduledResult.rows[0]),
    lastSuccess: syncRunSummary(successResult.rows[0])
  };
}

async function upsertUsers(client, users, rawUsersById, syncRunId) {
  for (const user of users) {
    await client.query(
      `
        insert into teamwork_users (
          id, sync_run_id, name, email, avatar_url, company_id, user_rate, user_cost, raw, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        on conflict (id) do update
        set
          sync_run_id = excluded.sync_run_id,
          name = excluded.name,
          email = excluded.email,
          avatar_url = excluded.avatar_url,
          company_id = excluded.company_id,
          user_rate = excluded.user_rate,
          user_cost = excluded.user_cost,
          raw = excluded.raw,
          updated_at = now()
      `,
      [
        user.id,
        syncRunId,
        user.name,
        user.email || "",
        user.avatarUrl || "",
        user.companyId || "",
        Number(user.userRate || 0),
        Number(user.userCost || 0),
        jsonb(rawFor(rawUsersById, user.id))
      ]
    );
  }
}

async function upsertProjects(client, projects, rawProjectsById, syncRunId) {
  for (const project of projects) {
    await client.query(
      `
        insert into teamwork_projects (
          id, sync_run_id, name, company_id, company_name, status, is_billable, raw, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, now())
        on conflict (id) do update
        set
          sync_run_id = excluded.sync_run_id,
          name = excluded.name,
          company_id = excluded.company_id,
          company_name = excluded.company_name,
          status = excluded.status,
          is_billable = excluded.is_billable,
          raw = excluded.raw,
          updated_at = now()
      `,
      [
        project.id,
        syncRunId,
        project.name,
        project.companyId || "",
        project.companyName || "",
        project.status || "active",
        project.isBillable !== false,
        jsonb(rawFor(rawProjectsById, project.id))
      ]
    );
  }
}

async function upsertTimeEntries(client, timeEntries, rawTimeEntriesById, syncRunId, knownUserIds, knownProjectIds) {
  for (const entry of timeEntries) {
    const userId = knownUserIds.has(String(entry.userId)) ? String(entry.userId) : null;
    const projectId = knownProjectIds.has(String(entry.projectId)) ? String(entry.projectId) : null;

    await client.query(
      `
        insert into teamwork_time_entries (
          id, sync_run_id, logged_on, minutes, hours, is_billable, user_id, project_id,
          task_id, task_name, description, tags, teamwork_invoice_id, created_at_source,
          updated_at_source, raw, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
        on conflict (id) do update
        set
          sync_run_id = excluded.sync_run_id,
          logged_on = excluded.logged_on,
          minutes = excluded.minutes,
          hours = excluded.hours,
          is_billable = excluded.is_billable,
          user_id = excluded.user_id,
          project_id = excluded.project_id,
          task_id = excluded.task_id,
          task_name = coalesce(nullif(excluded.task_name, ''), teamwork_time_entries.task_name),
          description = excluded.description,
          tags = excluded.tags,
          teamwork_invoice_id = excluded.teamwork_invoice_id,
          created_at_source = excluded.created_at_source,
          updated_at_source = excluded.updated_at_source,
          raw = excluded.raw,
          updated_at = now()
      `,
      [
        entry.id,
        syncRunId,
        entry.date,
        Number(entry.minutes || 0),
        Number(entry.hours ?? Number(entry.minutes || 0) / 60),
        Boolean(entry.isBillable),
        userId,
        projectId,
        entry.taskId || "",
        entry.taskName || "",
        entry.description || "",
        jsonb(entry.tags || []),
        entry.teamworkInvoiceId || "",
        nullIfEmpty(entry.sourceCreatedAt),
        nullIfEmpty(entry.sourceUpdatedAt),
        jsonb(rawFor(rawTimeEntriesById, entry.id))
      ]
    );
  }
}

export async function persistTeamworkStoreToDatabase(store, raw = {}, options = {}) {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      ok: true,
      status: "skipped"
    };
  }

  const pool = getDatabasePool();
  const client = await pool.connect();
  const users = store.users || [];
  const projects = store.projects || [];
  const timeEntries = store.timeEntries || [];
  const api = store.api || {};
  const source = {
    api,
    fetchWindow: {
      end: options.fetchEnd || store.coverageEnd || null,
      start: options.fetchStart || store.coverageStart || null
    },
    rowCounts: {
      projects: projects.length,
      timeEntries: timeEntries.length,
      users: users.length
    },
    trigger: options.trigger || "manual"
  };

  try {
    await client.query("begin");
    let syncRunId = options.syncRunId || null;
    if (!syncRunId) {
      const run = await client.query(
        `
          insert into teamwork_sync_runs (
            started_at, coverage_start, coverage_end, status, pages_fetched, partial, warnings, source,
            trigger, fetch_start, fetch_end, attempt, error_message
          )
          values (clock_timestamp(), $1, $2, 'running', $3, $4, $5, $6, $7, $8, $9, $10, '')
          returning id
        `,
        [
          store.coverageStart || null,
          store.coverageEnd || null,
          Number(api.pagesFetched || 0),
          Boolean(api.partial),
          jsonb(api.warnings || []),
          jsonb(source),
          options.trigger || "import",
          options.fetchStart || store.coverageStart || null,
          options.fetchEnd || store.coverageEnd || null,
          Math.max(1, Number(options.attempt || 1))
        ]
      );
      syncRunId = run.rows[0].id;
    }

    await upsertUsers(client, users, rawRowsById(raw.users), syncRunId);
    await upsertProjects(client, projects, rawRowsById(raw.projects), syncRunId);
    await upsertTimeEntries(
      client,
      timeEntries,
      rawRowsById(raw.timeEntries),
      syncRunId,
      new Set(users.map((user) => String(user.id))),
      new Set(projects.map((project) => String(project.id)))
    );

    await client.query(
      `
        update teamwork_sync_runs
        set
          finished_at = clock_timestamp(),
          status = 'complete',
          pages_fetched = $2,
          partial = $3,
          warnings = $4,
          source = $5,
          error_message = ''
        where id = $1
      `,
      [
        syncRunId,
        Number(api.pagesFetched || 0),
        Boolean(api.partial),
        jsonb(api.warnings || []),
        jsonb(source)
      ]
    );
    await client.query("commit");

    return {
      configured: true,
      ok: true,
      projects: projects.length,
      syncRunId,
      timeEntries: timeEntries.length,
      users: users.length
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function readTeamworkStoreFromDatabase() {
  if (!isDatabaseConfigured()) return null;

  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query("begin transaction isolation level repeatable read read only");
    const runResult = await client.query(`
      select
        id, coverage_start::text as coverage_start, coverage_end::text as coverage_end,
        pages_fetched, partial, warnings, source, finished_at, created_at
      from teamwork_sync_runs
      where status = 'complete'
        and partial = false
        and coverage_start is not null
        and coverage_end is not null
      order by finished_at desc nulls last, created_at desc
      limit 1
    `);
    const run = runResult.rows[0] || null;
    if (!run) {
      await client.query("commit");
      return null;
    }

    const usersResult = await client.query(`
      select id, name, email, avatar_url, company_id, user_rate, user_cost
      from teamwork_users
      order by id
    `);
    const projectsResult = await client.query(`
      select id, name, company_id, company_name, status, is_billable
      from teamwork_projects
      order by id
    `);
    const timeEntriesResult = await client.query(`
      select
        id, logged_on::text as logged_on, minutes, hours, is_billable, user_id, project_id,
        task_id, task_name, description, tags, teamwork_invoice_id,
        created_at_source, updated_at_source
      from teamwork_time_entries
      where logged_on between $1 and $2
      order by logged_on, id
    `, [run.coverage_start, run.coverage_end]);
    await client.query("commit");

    return buildTeamworkStoreFromDatabaseRows({
      projects: projectsResult.rows,
      run,
      timeEntries: timeEntriesResult.rows,
      users: usersResult.rows
    });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const teamworkRepositoryTestHooks = {
  buildTeamworkStoreFromDatabaseRows,
  syncRunSummary
};
