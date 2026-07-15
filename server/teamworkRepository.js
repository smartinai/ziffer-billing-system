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

export async function persistTeamworkStoreToDatabase(store, raw = {}) {
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
    rowCounts: {
      projects: projects.length,
      timeEntries: timeEntries.length,
      users: users.length
    }
  };

  try {
    await client.query("begin");
    const run = await client.query(
      `
        insert into teamwork_sync_runs (
          coverage_start, coverage_end, status, pages_fetched, partial, warnings, source
        )
        values ($1, $2, 'running', $3, $4, $5, $6)
        returning id
      `,
      [
        store.coverageStart || null,
        store.coverageEnd || null,
        Number(api.pagesFetched || 0),
        Boolean(api.partial),
        jsonb(api.warnings || []),
        jsonb(source)
      ]
    );
    const syncRunId = run.rows[0].id;

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
        set finished_at = now(), status = 'complete'
        where id = $1
      `,
      [syncRunId]
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
      select id, coverage_start, coverage_end, pages_fetched, partial, warnings, source, finished_at, created_at
      from teamwork_sync_runs
      where status = 'complete'
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
        id, logged_on, minutes, hours, is_billable, user_id, project_id,
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
  buildTeamworkStoreFromDatabaseRows
};
