import "dotenv/config";
import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { reconcileAnnualUsage } from "../src/shared/annualReconciliation.js";

const { Client } = pg;

function argsFrom(argv) {
  const args = { apply: false, source: "" };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--source=")) args.source = arg.slice("--source=".length);
  }
  return args;
}

async function loadContext(database) {
  const clients = await database.query(`
      select client.id, client.display_name as "displayName", client.teamwork_project_id as "teamworkProjectId",
             project.name as "teamworkProjectName", client.xero_client_name as "xeroClientName",
             (nullif(trim(client.xero_contact_id), '') is not null) as "xeroLinked"
      from billing_clients client
      left join teamwork_projects project on project.id = client.teamwork_project_id
      where client.status = 'active'
    `);
  const services = await database.query(`
      select id, service_key as "serviceKey", label, aliases,
             annual_invoice_eligible as "annualInvoiceEligible", sort_order as "sortOrder"
      from standard_services where active = true and annual_invoice_eligible = true
    `);
  const entries = await database.query(`
      select id, project_id as "projectId", task_name as "taskName", logged_on::text as date,
             hours::float8 as hours, minutes, is_billable as "isBillable"
      from teamwork_time_entries
      where logged_on between date '2025-01-01' and date '2026-06-30'
      order by logged_on, id
    `);
  return { clients: clients.rows, entries: entries.rows, services: services.rows };
}

async function existingByKey(database) {
  const result = await database.query(`
    select id, billing_client_id as "billingClientId", service_id as "serviceId", for_year as "forYear",
           coverage_start::text as "coverageStart", coverage_end::text as "coverageEnd",
           max_hours::float8 as "maxHours", used_hours::float8 as "usedHours"
    from annual_invoice_usage where active = true
  `);
  return new Map(result.rows.map((row) => [
    row.coverageStart && row.coverageEnd
      ? `${row.billingClientId}:${row.serviceId}:period:${row.coverageStart}:${row.coverageEnd}`
      : `${row.billingClientId}:${row.serviceId}:year:${row.forYear}`,
    row
  ]));
}

function cellKey(cell) {
  return cell.coverageStart && cell.coverageEnd
    ? `${cell.billingClientId}:${cell.serviceId}:period:${cell.coverageStart}:${cell.coverageEnd}`
    : `${cell.billingClientId}:${cell.serviceId}:year:${cell.forYear}`;
}

async function applyCells(database, cells) {
  await database.query("begin");
  try {
    for (const cell of cells) {
      const params = [
        cell.billingClientId, cell.serviceId, cell.clientName, cell.serviceName,
        cell.maxHours, cell.usedHours, cell.forYear,
        cell.coverageStart || null, cell.coverageEnd || null, cell.periodSource || ""
      ];
      if (cell.coverageStart && cell.coverageEnd) {
        await database.query(`
          insert into annual_invoice_usage (
            billing_client_id, service_id, source_client_name, source_service_code, source_service_name,
            max_hours, used_hours, for_year, coverage_start, coverage_end, period_source, reference
          ) values ($1, $2, $3, 'teamwork-reconciliation', $4, $5, $6, $7, $8, $9, $10, 'Teamwork baseline through 30 Jun 2026')
          on conflict (billing_client_id, service_id, coverage_start, coverage_end)
            where coverage_start is not null and coverage_end is not null and active = true
          do update set source_client_name = excluded.source_client_name, source_service_code = excluded.source_service_code,
            source_service_name = excluded.source_service_name, max_hours = excluded.max_hours,
            used_hours = excluded.used_hours, for_year = excluded.for_year, period_source = excluded.period_source,
            reference = excluded.reference, imported_at = now(), updated_at = now()
        `, params);
      } else {
        const existing = await database.query(`
          select id from annual_invoice_usage
          where billing_client_id = $1 and service_id = $2 and for_year = $3
            and coverage_start is null and coverage_end is null and active = true
          order by updated_at desc for update
        `, [cell.billingClientId, cell.serviceId, cell.forYear]);
        if (existing.rowCount) {
          await database.query(`
            update annual_invoice_usage set source_client_name = $2, source_service_code = 'teamwork-reconciliation',
              source_service_name = $3, max_hours = $4, used_hours = $5, reference = 'Teamwork baseline through 30 Jun 2026',
              imported_at = now(), updated_at = now()
            where id = $1
          `, [existing.rows[0].id, cell.clientName, cell.serviceName, cell.maxHours, cell.usedHours]);
          const duplicates = existing.rows.slice(1).map((row) => row.id);
          if (duplicates.length) await database.query(`update annual_invoice_usage set active = false, updated_at = now() where id = any($1::uuid[])`, [duplicates]);
        } else {
          await database.query(`
            insert into annual_invoice_usage (
              billing_client_id, service_id, source_client_name, source_service_code, source_service_name,
              max_hours, used_hours, for_year, reference
            ) values ($1, $2, $3, 'teamwork-reconciliation', $4, $5, $6, $7, 'Teamwork baseline through 30 Jun 2026')
          `, params.slice(0, 7));
        }
      }
    }
    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  if (!args.source) throw new Error("Use --source=<prepaid-matrix.json>.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const source = JSON.parse(await fs.readFile(args.source, "utf8"));
  const database = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  await database.connect();
  try {
    const context = await loadContext(database);
    const result = reconcileAnnualUsage({ ...context, matrixRows: source.values || source });
    const existing = await existingByKey(database);
    const changes = result.cells.map((cell) => {
      const previous = existing.get(cellKey(cell));
      return {
        ...cell,
        previousMaxHours: previous?.maxHours ?? null,
        previousUsedHours: previous?.usedHours ?? null
      };
    }).filter((cell) => Number(cell.maxHours) !== Number(cell.previousMaxHours) || Number(cell.usedHours) !== Number(cell.previousUsedHours));
    const report = {
      apply: args.apply,
      cells: result.cells.length,
      changes: changes.length,
      linkedClients: context.clients.filter((client) => client.xeroLinked).length,
      sourceEntries: context.entries.length,
      totals: result.cells.reduce((sum, cell) => ({ maxHours: sum.maxHours + Number(cell.maxHours || 0), usedHours: sum.usedHours + Number(cell.usedHours || 0) }), { maxHours: 0, usedHours: 0 }),
      unmatchedClients: result.unmatchedClients,
      skippedUnlinkedClients: result.skippedUnlinkedClients,
      unmatchedTasks: result.unmatchedTasks.slice(0, 30),
      sampleChanges: changes.slice(0, 30)
    };
    if (args.apply && result.unmatchedClients.length) throw new Error(`Refusing to apply with ${result.unmatchedClients.length} unmatched prepaid clients.`);
    if (args.apply) await applyCells(database, result.cells);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await database.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
