import { getDatabasePool, isDatabaseConfigured } from "./db.js";

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
