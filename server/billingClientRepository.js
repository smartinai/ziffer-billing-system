import { config } from "./config.js";
import { isDatabaseConfigured, query } from "./db.js";

const clientStatuses = new Set(["active", "inactive", "excluded"]);

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const normalized = typeof value === "string" ? value.trim().replace("%", "").replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStatus(value, fallback = "active") {
  const status = String(value || fallback).trim().toLowerCase();
  return clientStatuses.has(status) ? status : fallback;
}

function clientRow(row) {
  const status = normalizeStatus(row.status, row.active ? "active" : "inactive");
  return {
    abbreviation: row.abbreviation || "",
    accountCode: row.account_code || "70330001",
    active: status === "active",
    createdAt: row.created_at,
    currency: row.currency || config.currency,
    discount: Number(row.discount || 0),
    displayName: row.display_name || "",
    id: row.id,
    settings: row.settings || {},
    taxRateName: row.tax_rate_name || "",
    taxType: row.tax_type || "",
    teamworkCompanyName: row.teamwork_company_name || "",
    teamworkProjectId: row.teamwork_project_id || "",
    teamworkProjectName: row.teamwork_project_name || "",
    quoteCount: Number(row.quote_count || 0),
    status,
    timeEntryCount: Number(row.time_entry_count || 0),
    updatedAt: row.updated_at,
    xeroClientName: row.xero_client_name || "",
    xeroContactId: row.xero_contact_id || ""
  };
}

export async function seedBillingClientsFromTeamworkProjects() {
  await query(
    `
      insert into billing_clients (
        teamwork_project_id, display_name, account_code, currency, active, status, created_at, updated_at
      )
      select
        project.id,
        project.name,
        '70330001',
        $1,
        true,
        'active',
        now(),
        now()
      from teamwork_projects project
      where not exists (
        select 1
        from billing_clients client
        where client.teamwork_project_id = project.id
      )
    `,
    [config.currency]
  );
}

export async function listBillingClients() {
  await seedBillingClientsFromTeamworkProjects();

  const result = await query(`
    select
      client.*,
      project.name as teamwork_project_name,
      project.company_name as teamwork_company_name,
      (
        select count(*)::int
        from quote_previews preview
        where preview.billing_client_id = client.id
      ) as quote_count,
      count(entry.id)::int as time_entry_count
    from billing_clients client
    left join teamwork_projects project on project.id = client.teamwork_project_id
    left join teamwork_time_entries entry on entry.project_id = project.id
    group by client.id, project.name, project.company_name
    order by lower(client.display_name), client.created_at
  `);

  return result.rows.map(clientRow);
}

async function getBillingClientById(id) {
  const result = await query(
    `
      select
        client.*,
        project.name as teamwork_project_name,
        project.company_name as teamwork_company_name,
        (
          select count(*)::int
          from quote_previews preview
          where preview.billing_client_id = client.id
        ) as quote_count,
        count(entry.id)::int as time_entry_count
      from billing_clients client
      left join teamwork_projects project on project.id = client.teamwork_project_id
      left join teamwork_time_entries entry on entry.project_id = project.id
      where client.id = $1
      group by client.id, project.name, project.company_name
    `,
    [id]
  );

  if (!result.rowCount) {
    const error = new Error("Billing client not found.");
    error.statusCode = 404;
    throw error;
  }

  return clientRow(result.rows[0]);
}

export async function updateBillingClient(id, input = {}) {
  const fields = {
    abbreviation: String(input.abbreviation || "").trim(),
    account_code: String(input.accountCode || "70330001").trim() || "70330001",
    currency: String(input.currency || config.currency).trim() || config.currency,
    discount: toNumber(input.discount),
    display_name: String(input.displayName || "").trim(),
    status: normalizeStatus(input.status, input.active === false ? "inactive" : "active"),
    tax_rate_name: String(input.taxRateName || "").trim(),
    tax_type: String(input.taxType || "").trim(),
    xero_client_name: String(input.xeroClientName || "").trim(),
    xero_contact_id: String(input.xeroContactId || "").trim()
  };
  fields.active = fields.status === "active";

  if (!fields.display_name) {
    throw new Error("Display name is required.");
  }

  const result = await query(
    `
      update billing_clients
      set
        abbreviation = $2,
        account_code = $3,
        active = $4,
        currency = $5,
        discount = $6,
        display_name = $7,
        tax_rate_name = $8,
        tax_type = $9,
        xero_client_name = $10,
        xero_contact_id = $11,
        status = $12,
        updated_at = now()
      where id = $1
    `,
    [
      id,
      fields.abbreviation,
      fields.account_code,
      fields.active,
      fields.currency,
      fields.discount,
      fields.display_name,
      fields.tax_rate_name,
      fields.tax_type,
      fields.xero_client_name,
      fields.xero_contact_id,
      fields.status
    ]
  );

  if (!result.rowCount) {
    const error = new Error("Billing client not found.");
    error.statusCode = 404;
    throw error;
  }

  return getBillingClientById(id);
}

export async function listExcludedTeamworkProjectIds() {
  if (!isDatabaseConfigured()) return [];

  const result = await query(`
    select teamwork_project_id
    from billing_clients
    where status = 'excluded'
      and teamwork_project_id is not null
      and teamwork_project_id <> ''
  `);

  return result.rows.map((row) => String(row.teamwork_project_id));
}
