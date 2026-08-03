import { getDatabasePool } from "./db.js";
import { parseMaintainCorporateRecordsPeriod } from "../src/shared/annualServicePeriods.js";

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
    defaultMaxHours: row.defaultMaxHours === null || row.defaultMaxHours === undefined ? null : Number(row.defaultMaxHours),
    id: row.id,
    label: row.label,
    periodBased: row.serviceKey === "maintain_corporate_records",
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
    clientName: row.sourceClientName || "",
    coverageEnd: row.coverageEnd || "",
    coverageStart: row.coverageStart || "",
    periodSource: row.periodSource || "",
    serviceId: row.serviceId,
    serviceName: row.sourceServiceName || "",
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

  const [yearsResult, clientsResult, servicesResult, usageResult, corporateTasksResult] = await Promise.all([
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
          and nullif(trim(xero_contact_id), '') is not null
        order by lower(display_name)
      `
    ),
    pool.query(
      `
        select
          service.id,
          service.service_key as "serviceKey",
          service.label,
          annual.default_max_hours::float8 as "defaultMaxHours"
        from standard_services service
        left join annual_invoice_services annual on annual.service_id = service.id and annual.active = true
        where service.active = true
          and service.annual_invoice_eligible = true
        order by service.sort_order, lower(service.label)
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
          for_year as "forYear",
          coverage_start::text as "coverageStart",
          coverage_end::text as "coverageEnd",
          period_source as "periodSource"
        from annual_invoice_usage
        where active = true
          and (
            (coverage_start is null and coverage_end is null and for_year = $1)
            or (
              coverage_start is not null
              and coverage_end is not null
              and coverage_start <= make_date($1, 12, 31)
              and coverage_end >= make_date($1, 1, 1)
            )
          )
      `,
      [selectedYear]
    ),
    pool.query(
      `
        select distinct
          client.id as "billingClientId",
          entry.task_name as "taskName"
        from billing_clients client
        join teamwork_time_entries entry on entry.project_id = client.teamwork_project_id
        where client.status = 'active'
          and nullif(trim(client.xero_contact_id), '') is not null
          and lower(entry.task_name) like '%corporate records%'
      `
    )
  ]);

  const years = [...new Set([...defaultYears, ...yearsResult.rows.map((row) => Number(row.year))])]
    .filter(Boolean)
    .sort((a, b) => a - b);

  const usage = usageResult.rows.map(mapUsage);
  const corporateService = servicesResult.rows.find((service) => service.serviceKey === "maintain_corporate_records");
  if (corporateService) {
    const existingPeriods = new Set(usage
      .filter((row) => row.coverageStart && row.coverageEnd)
      .map((row) => `${row.billingClientId}:${row.serviceId}:${row.coverageStart}:${row.coverageEnd}`));

    for (const task of corporateTasksResult.rows) {
      const coverage = parseMaintainCorporateRecordsPeriod(task.taskName);
      if (!coverage || coverage.startDate > `${selectedYear}-12-31` || coverage.endDate < `${selectedYear}-01-01`) continue;
      const key = `${task.billingClientId}:${corporateService.id}:${coverage.startDate}:${coverage.endDate}`;
      if (existingPeriods.has(key)) continue;
      existingPeriods.add(key);
      usage.push({
        annualHours: Number(corporateService.defaultMaxHours || 12),
        billingClientId: task.billingClientId,
        clientName: "",
        coverageEnd: coverage.endDate,
        coverageStart: coverage.startDate,
        periodSource: coverage.source,
        serviceId: corporateService.id,
        serviceName: corporateService.label,
        usageId: `detected:${key}`,
        usedHours: 0,
        year: Number(coverage.endDate.slice(0, 4))
      });
    }
  }

  return {
    clients: clientsResult.rows.map(mapClient),
    services: servicesResult.rows.map(mapService),
    usage,
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
  const coverageStart = String(input.coverageStart || "").trim();
  const coverageEnd = String(input.coverageEnd || "").trim();
  const periodSource = String(input.periodSource || "").trim();
  const hasCoveragePeriod = Boolean(coverageStart || coverageEnd);

  if (hasCoveragePeriod && (!/^\d{4}-\d{2}-\d{2}$/.test(coverageStart) || !/^\d{4}-\d{2}-\d{2}$/.test(coverageEnd) || coverageStart > coverageEnd)) {
    const error = new Error("Use a valid annual coverage period.");
    error.statusCode = 400;
    throw error;
  }

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
      hasCoveragePeriod
        ? `
        select id
        from annual_invoice_usage
        where billing_client_id = $1
          and service_id = $2
          and coverage_start = $3
          and coverage_end = $4
          and active = true
        order by updated_at desc, created_at desc
        limit 1
        for update
      `
        : `
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
      hasCoveragePeriod
        ? [billingClientId, serviceId, coverageStart, coverageEnd]
        : [billingClientId, serviceId, year]
    );

    const client = clientResult.rows[0];
    const service = serviceResult.rows[0];
    const params = [
      billingClientId,
      serviceId,
      client.display_name,
      service.label,
      annualHours,
      usedHours,
      year,
      hasCoveragePeriod ? coverageStart : null,
      hasCoveragePeriod ? coverageEnd : null,
      periodSource
    ];

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
              coverage_start = $6,
              coverage_end = $7,
              period_source = $8,
              updated_at = now()
            where id = $9
            returning
              id,
              billing_client_id as "billingClientId",
              service_id as "serviceId",
              source_client_name as "sourceClientName",
              source_service_name as "sourceServiceName",
              max_hours::float8 as "maxHours",
              used_hours::float8 as "usedHours",
              for_year as "forYear",
              coverage_start::text as "coverageStart",
              coverage_end::text as "coverageEnd",
              period_source as "periodSource"
          `,
          [
            client.display_name,
            service.label,
            annualHours,
            usedHours,
            year,
            hasCoveragePeriod ? coverageStart : null,
            hasCoveragePeriod ? coverageEnd : null,
            periodSource,
            existingResult.rows[0].id
          ]
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
              for_year,
              coverage_start,
              coverage_end,
              period_source
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            returning
              id,
              billing_client_id as "billingClientId",
              service_id as "serviceId",
              source_client_name as "sourceClientName",
              source_service_name as "sourceServiceName",
              max_hours::float8 as "maxHours",
              used_hours::float8 as "usedHours",
              for_year as "forYear",
              coverage_start::text as "coverageStart",
              coverage_end::text as "coverageEnd",
              period_source as "periodSource"
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
