import { getDatabasePool } from "./db.js";

const defaultYears = [2025, 2026];

function toYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    const error = new Error("Use a valid annual invoice year.");
    error.statusCode = 400;
    throw error;
  }
  return year;
}

function toOptionalHours(value, label) {
  if (value === "" || value === null || value === undefined) return null;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) {
    const error = new Error(`${label} must be zero or more.`);
    error.statusCode = 400;
    throw error;
  }
  return Math.round((hours + Number.EPSILON) * 100) / 100;
}

function mapService(row) {
  return {
    id: row.id,
    label: row.label,
    serviceKey: row.serviceKey
  };
}

function mapClient(row) {
  return {
    displayName: row.displayName,
    id: row.id,
    teamworkProjectId: row.teamworkProjectId
  };
}

function mapUsage(row) {
  return {
    annualHours: row.maxHours === null || row.maxHours === undefined ? "" : Number(row.maxHours),
    billingClientId: row.billingClientId,
    serviceId: row.serviceId,
    usageId: row.id,
    usedHours: row.usedHours === null || row.usedHours === undefined ? 0 : Number(row.usedHours),
    year: Number(row.forYear)
  };
}

async function requirePool() {
  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }
  return pool;
}

export async function listAnnualInvoices(inputYear) {
  const pool = await requirePool();
  const selectedYear = inputYear ? toYear(inputYear) : defaultYears[defaultYears.length - 1];

  const [yearsResult, clientsResult, servicesResult, usageResult] = await Promise.all([
    pool.query(
      `
        select distinct for_year::int as year
        from annual_invoice_usage
        where for_year is not null
        order by year
      `
    ),
    pool.query(
      `
        select
          id,
          display_name as "displayName",
          teamwork_project_id as "teamworkProjectId"
        from billing_clients
        where status = 'active'
        order by lower(display_name)
      `
    ),
    pool.query(
      `
        select
          id,
          service_key as "serviceKey",
          label
        from standard_services
        where active = true
          and annual_invoice_eligible = true
        order by sort_order, lower(label)
      `
    ),
    pool.query(
      `
        select
          id,
          billing_client_id as "billingClientId",
          service_id as "serviceId",
          max_hours::float8 as "maxHours",
          used_hours::float8 as "usedHours",
          for_year as "forYear"
        from annual_invoice_usage
        where for_year = $1
          and active = true
      `,
      [selectedYear]
    )
  ]);

  const years = [...new Set([...defaultYears, ...yearsResult.rows.map((row) => Number(row.year))])]
    .filter(Boolean)
    .sort((a, b) => a - b);

  return {
    clients: clientsResult.rows.map(mapClient),
    services: servicesResult.rows.map(mapService),
    usage: usageResult.rows.map(mapUsage),
    year: selectedYear,
    years
  };
}

export async function updateAnnualInvoiceUsage(input = {}) {
  const billingClientId = String(input.billingClientId || "").trim();
  const serviceId = String(input.serviceId || "").trim();
  const year = toYear(input.year);
  const annualHours = toOptionalHours(input.annualHours, "Annual hours");
  const usedHours = toOptionalHours(input.usedHours, "Used hours") || 0;

  if (!billingClientId || !serviceId) {
    const error = new Error("Choose a client and annual invoice service.");
    error.statusCode = 400;
    throw error;
  }

  const pool = await requirePool();
  const database = await pool.connect();

  try {
    await database.query("begin");

    const clientResult = await database.query(
      `
        select id, display_name
        from billing_clients
        where id = $1
          and status = 'active'
        for update
      `,
      [billingClientId]
    );
    if (!clientResult.rowCount) {
      const error = new Error("Active billing client not found.");
      error.statusCode = 404;
      throw error;
    }

    const serviceResult = await database.query(
      `
        select id, label
        from standard_services
        where id = $1
          and active = true
          and annual_invoice_eligible = true
      `,
      [serviceId]
    );
    if (!serviceResult.rowCount) {
      const error = new Error("Annual invoice service not found.");
      error.statusCode = 404;
      throw error;
    }

    const existingResult = await database.query(
      `
        select id
        from annual_invoice_usage
        where billing_client_id = $1
          and service_id = $2
          and for_year = $3
          and active = true
        order by updated_at desc, created_at desc
        limit 1
        for update
      `,
      [billingClientId, serviceId, year]
    );

    const client = clientResult.rows[0];
    const service = serviceResult.rows[0];
    const params = [billingClientId, serviceId, client.display_name, service.label, annualHours, usedHours, year];

    const result = existingResult.rowCount
      ? await database.query(
          `
            update annual_invoice_usage
            set
              source_client_name = $1,
              source_service_name = $2,
              max_hours = $3,
              used_hours = $4,
              for_year = $5,
              updated_at = now()
            where id = $6
            returning
              id,
              billing_client_id as "billingClientId",
              service_id as "serviceId",
              max_hours::float8 as "maxHours",
              used_hours::float8 as "usedHours",
              for_year as "forYear"
          `,
          [client.display_name, service.label, annualHours, usedHours, year, existingResult.rows[0].id]
        )
      : await database.query(
          `
            insert into annual_invoice_usage (
              billing_client_id,
              service_id,
              source_client_name,
              source_service_name,
              max_hours,
              used_hours,
              for_year
            )
            values ($1, $2, $3, $4, $5, $6, $7)
            returning
              id,
              billing_client_id as "billingClientId",
              service_id as "serviceId",
              max_hours::float8 as "maxHours",
              used_hours::float8 as "usedHours",
              for_year as "forYear"
          `,
          params
        );

    await database.query("commit");

    return mapUsage(result.rows[0]);
  } catch (error) {
    await database.query("rollback");
    throw error;
  } finally {
    database.release();
  }
}
