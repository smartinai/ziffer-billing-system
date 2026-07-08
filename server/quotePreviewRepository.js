import { buildAggregatedQuotePreview, splitManualLineForAnnualCoverage } from "../src/shared/quoteDrafts.js";
import { getDatabasePool } from "./db.js";
import { fetchTask } from "./teamworkClient.js";
import { sendQuoteRequestToXero } from "./xeroClient.js";

const validDate = /^\d{4}-\d{2}-\d{2}$/;

function compactText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function xeroDocumentType(value) {
  return value === "draft_quote" ? "draft_quote" : "draft_invoice";
}

function xeroDocumentLabel(documentType) {
  return documentType === "draft_quote" ? "draft quote" : "draft invoice";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousMonthReference(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1, 1);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(date);
}

function assertDateRange(startDate, endDate) {
  if (!validDate.test(startDate || "") || !validDate.test(endDate || "") || startDate > endDate) {
    const error = new Error("Use a valid startDate and endDate in YYYY-MM-DD format.");
    error.statusCode = 400;
    throw error;
  }
}

function slug(value) {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
  return normalized || "CLIENT";
}

function yearsInRange(startDate, endDate) {
  const startYear = Number(String(startDate || "").slice(0, 4));
  const endYear = Number(String(endDate || "").slice(0, 4));
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) return [];

  const years = [];
  for (let year = startYear; year <= endYear; year += 1) years.push(year);
  return years;
}

function explicitTaskYear(value) {
  const match = compactText(value).match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function annualUsageYears(startDate, endDate, entries = []) {
  const years = new Set(yearsInRange(startDate, endDate));
  for (const entry of entries) {
    const year = explicitTaskYear(entry.taskName);
    if (year) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

function mapBillingClient(row) {
  return {
    abbreviation: row.abbreviation || "",
    accountCode: row.accountCode || "70330001",
    active: row.status === "active",
    currency: row.currency || "EUR",
    discount: Number(row.discount || 0),
    displayName: row.displayName || "",
    id: row.id,
    status: row.status || "active",
    taxRateName: row.taxRateName || "",
    taxType: row.taxType || "",
    teamworkCompanyName: row.teamworkCompanyName || "",
    teamworkProjectId: row.teamworkProjectId || "",
    teamworkProjectName: row.teamworkProjectName || "",
    xeroClientName: row.xeroClientName || "",
    xeroContactId: row.xeroContactId || ""
  };
}

function mapEntry(row) {
  return {
    date: row.loggedOn,
    description: row.description || "",
    hours: Number(row.hours || 0),
    id: row.id,
    isBillable: row.isBillable,
    minutes: Number(row.minutes || 0),
    projectId: row.projectId || "",
    syncRunId: row.syncRunId || null,
    taskId: row.taskId || "",
    taskName: row.taskName || "",
    teamworkInvoiceId: row.teamworkInvoiceId || "",
    userId: row.userId || "",
    userName: row.userName || "",
    userRate: Number(row.userRate || 0)
  };
}

function taskNameFromTask(task) {
  return compactText(task?.name || task?.title || task?.content || task?.todoItemName);
}

async function backfillMissingTaskNames(database, entries) {
  const missingTaskIds = [...new Set(entries
    .filter((entry) => entry.taskId && !compactText(entry.taskName))
    .map((entry) => String(entry.taskId)))];

  if (!missingTaskIds.length) return entries;

  const namesByTaskId = new Map();

  for (const taskId of missingTaskIds) {
    try {
      const task = await fetchTask(taskId);
      const taskName = taskNameFromTask(task);
      if (!taskName) continue;

      namesByTaskId.set(taskId, taskName);
      await database.query(
        `
          update teamwork_time_entries
          set task_name = $2, updated_at = now()
          where task_id = $1
            and coalesce(task_name, '') = ''
        `,
        [taskId, taskName]
      );
    } catch (error) {
      console.warn(`Could not fetch Teamwork task ${taskId}: ${error.message}`);
    }
  }

  if (!namesByTaskId.size) return entries;

  return entries.map((entry) => ({
    ...entry,
    taskName: compactText(entry.taskName) || namesByTaskId.get(String(entry.taskId)) || entry.taskName
  }));
}

function mapService(row) {
  return {
    aliases: row.aliases || [],
    annualInvoiceEligible: row.annualInvoiceEligible,
    id: row.id,
    label: row.label,
    serviceKey: row.serviceKey,
    sortOrder: Number(row.sortOrder || 0)
  };
}

function sourceTimeEntryIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entryId) => compactText(entryId)).filter(Boolean);
}

async function loadQuoteServiceOverrides(database, previewId) {
  const result = await database.query(
    `
      select metadata
      from quote_events
      where quote_preview_id = $1
        and action = 'quote_line_service_override'
      order by created_at, id
    `,
    [previewId]
  );

  const serviceByEntryId = new Map();
  for (const event of result.rows) {
    const metadata = event.metadata || {};
    if (!Object.hasOwn(metadata, "serviceId")) continue;

    const serviceId = compactText(metadata.serviceId) || null;
    const annualYear = Number(metadata.annualYear);
    for (const entryId of sourceTimeEntryIds(metadata.sourceTimeEntryIds)) {
      serviceByEntryId.set(entryId, {
        annualYear: Number.isInteger(annualYear) ? annualYear : null,
        serviceId
      });
    }
  }

  return [...serviceByEntryId.entries()].map(([entryId, override]) => ({ entryId, ...override }));
}

async function loadQuoteBillableOverrides(database, previewId) {
  const result = await database.query(
    `
      select metadata
      from quote_events
      where quote_preview_id = $1
        and action = 'time_entry_billable_override'
      order by created_at, id
    `,
    [previewId]
  );

  const billableOverrides = new Map();
  for (const event of result.rows) {
    const sourceTimeEntryId = compactText(event.metadata?.sourceTimeEntryId);
    if (!sourceTimeEntryId || typeof event.metadata?.isBillable !== "boolean") continue;
    billableOverrides.set(sourceTimeEntryId, event.metadata.isBillable);
  }

  return billableOverrides;
}

async function loadPreviewSourceEntries(database, billingClient, periodStart, periodEnd) {
  const result = await database.query(
    `
      select
        entry.id,
        entry.logged_on::text as "loggedOn",
        entry.minutes,
        entry.hours::float8 as hours,
        entry.is_billable as "isBillable",
        entry.user_id as "userId",
        entry.project_id as "projectId",
        entry.task_id as "taskId",
        entry.task_name as "taskName",
        entry.description,
        entry.teamwork_invoice_id as "teamworkInvoiceId",
        entry.sync_run_id as "syncRunId",
        person.name as "userName",
        person.user_rate::float8 as "userRate"
      from teamwork_time_entries entry
      left join teamwork_users person on person.id = entry.user_id
      where entry.project_id = $1
        and entry.logged_on between $2 and $3
        and coalesce(nullif(trim(entry.teamwork_invoice_id), ''), '') = ''
      order by entry.logged_on, entry.task_name, entry.description, entry.id
    `,
    [billingClient.teamworkProjectId, periodStart, periodEnd]
  );

  return result.rows;
}

function assertQuoteMetadata({ expiryDate, quoteDate }) {
  if (!validDate.test(quoteDate || "") || !validDate.test(expiryDate || "")) {
    const error = new Error("Use valid document date and due/expiry date values in YYYY-MM-DD format.");
    error.statusCode = 400;
    throw error;
  }
}

function toDiscount(value) {
  const normalized = String(value ?? 0).replace("%", "").trim();
  const discount = Number(normalized);
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    const error = new Error("Use a discount between 0 and 100%.");
    error.statusCode = 400;
    throw error;
  }
  return discount;
}

function toEditableNumber(value, label) {
  const normalized = String(value ?? "").replace(",", ".").trim();
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${label} must be zero or more.`);
    error.statusCode = 400;
    throw error;
  }
  return number;
}

function toAnnualYear(value) {
  if (value === "" || value === null || value === undefined) return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    const error = new Error("Choose a valid annual invoice year.");
    error.statusCode = 400;
    throw error;
  }
  return year;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function roundXeroUnitAmount(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
}

function roundHours(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
}

function truncateText(value, maxLength) {
  const text = compactText(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function editedLineAmount(line) {
  if (line.annualCovered || line.isBillable === false) return 0;
  if (Number(line.quantityHours || 0) <= 0 || Number(line.unitAmount || 0) <= 0) return 0;
  return roundMoney(Number(line.quantityHours || 0) * Number(line.unitAmount || 0) * (1 - Number(line.discount || 0) / 100));
}

function lineEntryGrossAmount(line) {
  if (line.includeInXero === false || line.annualCovered) return 0;

  return (line.entries || []).reduce((sum, entry) => {
    if (!entry.isBillable || entry.annualCovered || Number(entry.userRate || 0) <= 0) return sum;
    return sum + Number(entry.hours || 0) * Number(entry.userRate || 0);
  }, 0);
}

function quoteLineSettingsKey(line) {
  return `${compactText(line.taskName || line.description).toLowerCase()}::${line.isBillable ? "billable" : "unbillable"}::${line.annualCovered ? "annual" : "standard"}`;
}

function applyExistingLineSettings(preview, existingLines = [], services = []) {
  const servicesById = new Map(services.map((service) => [service.id, service]));
  const settingsByKey = new Map(
    existingLines.map((line) => [
      quoteLineSettingsKey(line),
      {
        comments: line.comments || "",
        discount: Number(line.discount || 0),
        serviceId: line.serviceId || null
      }
    ])
  );

  const lines = preview.lines.map((line) => {
    const saved = settingsByKey.get(quoteLineSettingsKey(line));
    if (!saved) return line;

    const amount = roundMoney(lineEntryGrossAmount(line) * (1 - saved.discount / 100));
    const shouldUseSavedComment = saved.comments && !line.annualCovered && line.isBillable;
    const service = saved.serviceId ? servicesById.get(saved.serviceId) : null;
    return {
      ...line,
      amount,
      comments: shouldUseSavedComment ? saved.comments : line.comments,
      discount: saved.discount,
      serviceId: saved.serviceId,
      serviceKey: service?.serviceKey || "",
      serviceLabel: service?.label || "Unmapped service"
    };
  });

  return {
    ...preview,
    lines,
    totals: {
      ...preview.totals,
      amount: roundMoney(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)),
      lineCount: lines.length
    }
  };
}

async function insertQuoteLines(database, previewId, lines) {
  const savedLines = [];

  for (const line of lines) {
    const lineResult = await database.query(
      `
        insert into quote_lines (
          quote_preview_id,
          line_order,
          service_id,
          source_type,
          source_time_entry_ids,
          annual_year,
          task_name,
          description,
          quantity_hours,
          unit_amount,
          amount,
          is_billable,
          account_code,
          tax_type,
          discount,
          annual_covered,
          include_in_xero,
          comments,
          warnings
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        returning id
      `,
      [
        previewId,
        line.lineOrder,
        line.serviceId,
        line.sourceType,
        line.sourceTimeEntryIds,
        line.annualYear || null,
        line.taskName,
        line.description,
        line.quantityHours,
        line.unitAmount,
        line.amount,
        line.isBillable,
        line.accountCode,
        line.taxType,
        line.discount,
        line.annualCovered,
        line.includeInXero,
        line.comments,
        JSON.stringify(line.warnings)
      ]
    );
    savedLines.push({ ...line, id: lineResult.rows[0].id });
  }

  return savedLines;
}

async function loadAnnualUsage(database, billingClientId, startDate, endDate, entries = [], extraYears = []) {
  const years = annualUsageYears(startDate, endDate, entries);
  for (const year of extraYears) {
    const number = Number(year);
    if (Number.isInteger(number) && !years.includes(number)) years.push(number);
  }
  if (!billingClientId || !years.length) return [];

  const result = await database.query(
    `
      select
        id as "usageId",
        billing_client_id as "billingClientId",
        service_id as "serviceId",
        max_hours::float8 as "annualHours",
        used_hours::float8 as "usedHours",
        for_year as year
      from annual_invoice_usage
      where billing_client_id = $1
        and active = true
        and for_year = any($2::int[])
    `,
    [billingClientId, years]
  );

  return result.rows.map((row) => ({
    annualHours: row.annualHours === null || row.annualHours === undefined ? null : Number(row.annualHours),
    billingClientId: row.billingClientId,
    serviceId: row.serviceId,
    usageId: row.usageId,
    usedHours: Number(row.usedHours || 0),
    year: Number(row.year)
  }));
}

async function loadAnnualUsageForService(database, billingClientId, serviceId) {
  if (!billingClientId || !serviceId) return [];

  const result = await database.query(
    `
      select
        id as "usageId",
        billing_client_id as "billingClientId",
        service_id as "serviceId",
        max_hours::float8 as "annualHours",
        used_hours::float8 as "usedHours",
        for_year as year
      from annual_invoice_usage
      where billing_client_id = $1
        and service_id = $2
        and active = true
      order by for_year
    `,
    [billingClientId, serviceId]
  );

  return result.rows.map((row) => ({
    annualHours: row.annualHours === null || row.annualHours === undefined ? null : Number(row.annualHours),
    billingClientId: row.billingClientId,
    serviceId: row.serviceId,
    usageId: row.usageId,
    usedHours: Number(row.usedHours || 0),
    year: Number(row.year)
  }));
}

function previewResponse({ billingClient, insertRow, lines, preview, quoteDate, quoteNumber, reference, expiryDate, services = [] }) {
  return {
    preview: {
      billingClient,
      createdAt: insertRow.created_at,
      currency: preview.currency,
      expiryDate,
      id: insertRow.id,
      lines,
      period: preview.period,
      quoteDate,
      quoteNumber,
      reference,
      services,
      status: "preview",
      totals: preview.totals,
      warnings: preview.warnings
    }
  };
}

function xeroDescription(line) {
  return [compactText(line.description || line.taskName), compactText(line.comments)].filter(Boolean).join("\n");
}

function xeroUnitAmount({ discountRate, line, lineAmount, quantity }) {
  if (!quantity) return 0;

  const discountFactor = 1 - Number(discountRate || 0) / 100;
  if (discountFactor > 0) {
    return roundXeroUnitAmount(Number(lineAmount || 0) / quantity / discountFactor);
  }

  return roundXeroUnitAmount(line.unitAmount);
}

function buildXeroLineItem({ billingClient, line }) {
  const accountCode = compactText(line.accountCode || billingClient.accountCode || "70330001");
  const taxType = compactText(line.taxType || billingClient.taxType);
  const annualCovered = Boolean(line.annualCovered);
  const discountRate = annualCovered ? 0 : Number(line.discount || 0);
  const lineAmount = annualCovered ? 0 : roundMoney(line.amount);
  const description = truncateText(xeroDescription(line) || "Teamwork time", 4000);
  const quantity = roundHours(line.quantityHours);
  const unitAmount = annualCovered ? 0 : xeroUnitAmount({ discountRate, line, lineAmount, quantity });

  return {
    AccountCode: accountCode,
    Description: description,
    DiscountRate: roundMoney(discountRate),
    LineAmount: roundMoney(lineAmount),
    Quantity: quantity,
    TaxType: taxType,
    UnitAmount: unitAmount
  };
}

function includeLineInXero(line) {
  return Boolean(line.isBillable) && line.includeInXero !== false && !line.annualCovered;
}

function buildXeroSourceMetadata({ billingClient, documentType, lineItems, lines, previewRow }) {
  const sourceLineMetadata = lines
    .filter((line) => line.isBillable)
    .map((line) => {
      const lineItem = buildXeroLineItem({ billingClient, line });
      const includeInXero = includeLineInXero(line);
      return {
        annualCovered: Boolean(line.annualCovered),
        includeInXero,
        lineAmount: lineItem.LineAmount,
        quoteLineId: line.id,
        sourceTimeEntryIds: line.sourceTimeEntryIds || [],
        taskName: line.taskName || ""
      };
    });

  return {
    billingClientId: billingClient.id,
    documentType,
    lineCount: lineItems.length,
    quotePreviewId: previewRow.id,
    sourceLines: sourceLineMetadata
  };
}

export function buildXeroDocumentPayload({ billingClient, documentType = "draft_invoice", lines, previewRow }) {
  const type = xeroDocumentType(documentType);
  const lineItems = lines.filter(includeLineInXero).map((line) => buildXeroLineItem({ billingClient, line }));

  if (type === "draft_quote") {
    const quote = {
      Contact: {
        ContactID: billingClient.xeroContactId,
        Name: billingClient.xeroClientName
      },
      CurrencyCode: billingClient.currency || "EUR",
      Date: previewRow.quoteDate,
      ExpiryDate: previewRow.expiryDate,
      LineAmountTypes: "Exclusive",
      LineItems: lineItems,
      QuoteNumber: truncateText(previewRow.quoteNumber, 255),
      Reference: truncateText(previewRow.reference, 4000),
      Status: "DRAFT"
    };

    return {
      body: { Quotes: [quote] },
      document: quote,
      documentType: type,
      endpoint: "/Quotes",
      method: "PUT",
      quote,
      source: buildXeroSourceMetadata({ billingClient, documentType: type, lineItems, lines, previewRow })
    };
  }

  const invoice = {
    Contact: {
      ContactID: billingClient.xeroContactId,
      Name: billingClient.xeroClientName
    },
    CurrencyCode: billingClient.currency || "EUR",
    Date: previewRow.quoteDate,
    DueDate: previewRow.expiryDate,
    InvoiceNumber: truncateText(previewRow.quoteNumber, 255),
    LineAmountTypes: "Exclusive",
    LineItems: lineItems,
    Reference: truncateText(previewRow.reference, 4000),
    Status: "DRAFT",
    Type: "ACCREC"
  };

  return {
    body: { Invoices: [invoice] },
    document: invoice,
    documentType: type,
    endpoint: "/Invoices",
    invoice,
    method: "PUT",
    source: buildXeroSourceMetadata({ billingClient, documentType: type, lineItems, lines, previewRow })
  };
}

export function buildXeroQuotePayload({ billingClient, lines, previewRow }) {
  return buildXeroDocumentPayload({
    billingClient,
    documentType: "draft_quote",
    lines,
    previewRow
  });
}

function xeroPayloadLineItems(payload) {
  return payload.document?.LineItems || [];
}

function xeroDocumentIdentifier(transport) {
  return transport.documentId || transport.invoiceId || transport.quoteId || "";
}

function xeroPreparedResponse(documentLabel) {
  return {
    mode: "prepared",
    note: `Live Xero API connection is not configured yet. Payload is stored for the ${documentLabel} transport step.`
  };
}

function xeroLogMessage(documentLabel, sendMode) {
  if (sendMode === "live") return `Annual invoice usage was approved and the ${documentLabel} was created in Xero.`;
  return `Annual invoice usage was approved and the Xero ${documentLabel} payload was prepared. Live Xero transport is not connected yet.`;
}

function xeroUserMessage(documentLabel, sendMode) {
  if (sendMode === "live") return `Annual hours approved and ${documentLabel} created in Xero.`;
  return `Annual hours approved. Xero payload prepared; connect Xero to send live ${documentLabel}s.`;
}

function xeroIdempotencyKey(id, documentType) {
  return `quote-preview:${id}:xero:${documentType}:v1`;
}

function xeroPayloadHeaders(idempotencyKey) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    "Xero-Tenant-Id": "<selected-tenant-id>"
  };
}

function xeroAction(documentType) {
  return documentType === "draft_quote" ? "quote_push" : "invoice_push";
}

function xeroStatus(sendMode, transport) {
  if (sendMode === "live") return compactText(transport?.xeroStatus || transport?.status || "DRAFT");
  return "prepared";
}

function xeroPreviewStatus(sendMode) {
  return sendMode === "live" ? "sent_to_xero" : "approved_for_xero";
}

function assertXeroDocumentNumber(previewRow, documentType) {
  if (compactText(previewRow.quoteNumber)) return;
  const label = documentType === "draft_quote" ? "Quote number" : "Invoice number";
  const error = new Error(`${label} is required before sending.`);
  error.statusCode = 400;
  throw error;
}
async function quoteFinancialMetrics(database, lines) {
  let teamworkEstimateAmount = 0;
  let teamworkChargeableAmount = 0;
  let annualCoveredAmount = 0;

  for (const line of lines) {
    if (!line.isBillable) continue;

    const discountFactor = 1 - Number(line.discount || 0) / 100;
    const lineTeamworkAmount = Number(line.quantityHours || 0) * Number(line.unitAmount || 0) * discountFactor;

    if (line.annualCovered) annualCoveredAmount += lineTeamworkAmount;
    else teamworkChargeableAmount += Number(line.amount || 0);
  }
  teamworkEstimateAmount = teamworkChargeableAmount + annualCoveredAmount;

  return {
    annualCoveredAmount: roundMoney(annualCoveredAmount),
    teamworkChargeableAmount: roundMoney(teamworkChargeableAmount),
    teamworkEstimateAmount: roundMoney(teamworkEstimateAmount)
  };
}

async function annualUsageDeltasForPreview(database, previewId) {
  const result = await database.query(
    `
      with annual_lines as (
        select
          line.id::text as "lineId",
          line.service_id as "serviceId",
          coalesce(
            line.annual_year,
            (regexp_match(line.task_name, '(^|[^0-9])(20[0-9]{2})([^0-9]|$)'))[2]::int,
            extract(year from min(entry.logged_on))::int
          ) as year,
          line.quantity_hours::float8 as hours,
          array_remove(array_agg(source.entry_id order by entry.logged_on, source.entry_id), null) as "sourceTimeEntryIds"
        from quote_lines line
        left join lateral unnest(line.source_time_entry_ids) as source(entry_id) on true
        left join teamwork_time_entries entry on entry.id::text = source.entry_id
        where line.quote_preview_id = $1
          and line.annual_covered = true
          and line.is_billable = true
          and line.service_id is not null
        group by line.id, line.service_id, line.annual_year, line.task_name, line.quantity_hours
      ),
      annual_grouped as (
        select
          "serviceId",
          year,
          coalesce(sum(hours), 0)::float8 as hours,
          array_agg("lineId" order by "lineId") as "lineIds"
        from annual_lines
        group by "serviceId", year
      ),
      annual_sources as (
        select
          "serviceId",
          year,
          array_agg(distinct source_time_entry_id) filter (where source_time_entry_id is not null) as "sourceTimeEntryIds"
        from annual_lines
        left join lateral unnest("sourceTimeEntryIds") as source(source_time_entry_id) on true
        group by "serviceId", year
      )
      select
        grouped."serviceId",
        grouped.year,
        grouped.hours,
        grouped."lineIds",
        coalesce(sources."sourceTimeEntryIds", '{}') as "sourceTimeEntryIds"
      from annual_grouped grouped
      left join annual_sources sources on sources."serviceId" = grouped."serviceId" and sources.year = grouped.year
      order by grouped.year, grouped."serviceId"
    `,
    [previewId]
  );

  return result.rows.map((row) => ({
    hours: roundHours(row.hours),
    lineIds: row.lineIds || [],
    serviceId: row.serviceId,
    sourceTimeEntryIds: row.sourceTimeEntryIds || [],
    year: Number(row.year)
  }));
}

async function applyAnnualUsageDeltas(database, { billingClientId, deltas, previewId, quoteNumber }) {
  const applied = [];

  for (const delta of deltas) {
    const usageResult = await database.query(
      `
        select
          id,
          max_hours::float8 as "annualHours",
          used_hours::float8 as "usedHours"
        from annual_invoice_usage
        where billing_client_id = $1
          and service_id = $2
          and for_year = $3
          and active = true
        order by updated_at desc, created_at desc
        limit 1
        for update
      `,
      [billingClientId, delta.serviceId, delta.year]
    );

    if (!usageResult.rowCount) {
      const error = new Error("Annual invoice usage row was not found. Regenerate the document before sending.");
      error.statusCode = 400;
      throw error;
    }

    const usage = usageResult.rows[0];
    const previousUsedHours = Number(usage.usedHours || 0);
    const nextUsedHours = roundHours(previousUsedHours + delta.hours);
    const annualHours = usage.annualHours === null || usage.annualHours === undefined ? null : Number(usage.annualHours);

    if (annualHours !== null && nextUsedHours > annualHours + 0.0001) {
      const error = new Error("Annual invoice hours changed since this preview was generated. Regenerate the document before sending.");
      error.statusCode = 409;
      throw error;
    }

    await database.query(
      `
        update annual_invoice_usage
        set used_hours = $2, updated_at = now()
        where id = $1
      `,
      [usage.id, nextUsedHours]
    );

    await database.query(
      `
        insert into annual_invoice_usage_events (
          annual_invoice_usage_id,
          action,
          previous_used_hours,
          next_used_hours,
          metadata
        )
        values ($1, 'quote_send_to_xero', $2, $3, $4)
      `,
      [
        usage.id,
        previousUsedHours,
        nextUsedHours,
        JSON.stringify({
          hours: delta.hours,
          lineIds: delta.lineIds,
          quoteNumber,
          quotePreviewId: previewId,
          sourceTimeEntryIds: delta.sourceTimeEntryIds
        })
      ]
    );

    applied.push({
      annualUsageId: usage.id,
      hours: delta.hours,
      nextUsedHours,
      previousUsedHours,
      serviceId: delta.serviceId,
      year: delta.year
    });
  }

  return applied;
}

export async function createQuotePreview({ billingClientId, endDate, startDate }) {
  assertDateRange(startDate, endDate);
  if (!billingClientId) {
    const error = new Error("Billing client is required.");
    error.statusCode = 400;
    throw error;
  }

  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const database = await pool.connect();

  try {
    await database.query("begin");

    const clientResult = await database.query(
      `
        select
          client.id,
          client.abbreviation,
          client.account_code as "accountCode",
          client.currency,
          client.discount::float8 as discount,
          client.display_name as "displayName",
          client.status,
          client.tax_rate_name as "taxRateName",
          client.tax_type as "taxType",
          client.teamwork_project_id as "teamworkProjectId",
          client.xero_client_name as "xeroClientName",
          client.xero_contact_id as "xeroContactId",
          project.name as "teamworkProjectName",
          project.company_name as "teamworkCompanyName"
        from billing_clients client
        left join teamwork_projects project on project.id = client.teamwork_project_id
        where client.id = $1
      `,
      [billingClientId]
    );

    if (!clientResult.rowCount) {
      const error = new Error("Billing client not found.");
      error.statusCode = 404;
      throw error;
    }

    const billingClient = mapBillingClient(clientResult.rows[0]);
    if (billingClient.status !== "active") {
      const error = new Error("Choose an active billing client before creating a document preview.");
      error.statusCode = 400;
      throw error;
    }
    if (!billingClient.teamworkProjectId) {
      const error = new Error("Billing client is not linked to a Teamwork project.");
      error.statusCode = 400;
      throw error;
    }

    const servicesResult = await database.query(
      `
        select
          id,
          service_key as "serviceKey",
          label,
          aliases,
          annual_invoice_eligible as "annualInvoiceEligible",
          sort_order as "sortOrder"
        from standard_services
        where active = true
        order by sort_order, lower(label)
      `
    );
    const entriesResult = await database.query(
      `
        select
          entry.id,
          entry.logged_on::text as "loggedOn",
          entry.minutes,
          entry.hours::float8 as hours,
          entry.is_billable as "isBillable",
          entry.user_id as "userId",
          entry.project_id as "projectId",
          entry.task_id as "taskId",
          entry.task_name as "taskName",
          entry.description,
          entry.teamwork_invoice_id as "teamworkInvoiceId",
          entry.sync_run_id as "syncRunId",
          person.name as "userName",
          person.user_rate::float8 as "userRate"
        from teamwork_time_entries entry
        left join teamwork_users person on person.id = entry.user_id
        where entry.project_id = $1
          and entry.logged_on between $2 and $3
          and coalesce(nullif(trim(entry.teamwork_invoice_id), ''), '') = ''
        order by entry.logged_on, entry.task_name, entry.description, entry.id
      `,
      [billingClient.teamworkProjectId, startDate, endDate]
    );
    const clientPreviewCountResult = await database.query(
      `
        select count(*)::int as count
        from quote_previews
        where billing_client_id = $1
      `,
      [billingClient.id]
    );

    const entries = await backfillMissingTaskNames(database, entriesResult.rows.map(mapEntry));
    const services = servicesResult.rows.map(mapService);
    const annualUsage = await loadAnnualUsage(database, billingClient.id, startDate, endDate, entries);
    const preview = buildAggregatedQuotePreview({
      annualUsage,
      billingClient,
      entries,
      periodEnd: endDate,
      periodStart: startDate,
      services
    });
    const quoteDate = today();
    const expiryDate = addDays(quoteDate, 14);
    const reference = previousMonthReference(quoteDate);
    const quoteNumber = `DRAFT-${startDate.slice(0, 7).replace("-", "")}-${slug(billingClient.abbreviation || billingClient.displayName)}-${String(Number(clientPreviewCountResult.rows[0]?.count || 0) + 1).padStart(3, "0")}`;
    const syncRunId = entries.find((entry) => entry.syncRunId)?.syncRunId || null;

    const insertResult = await database.query(
      `
        insert into quote_previews (
          billing_client_id,
          teamwork_project_id,
          sync_run_id,
          period_start,
          period_end,
          reference,
          quote_number,
          quote_date,
          expiry_date,
          status,
          warnings,
          totals
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'preview', $10, $11)
        returning id, created_at
      `,
      [
        billingClient.id,
        billingClient.teamworkProjectId,
        syncRunId,
        startDate,
        endDate,
        reference,
        quoteNumber,
        quoteDate,
        expiryDate,
        JSON.stringify(preview.warnings),
        JSON.stringify(preview.totals)
      ]
    );
    const previewId = insertResult.rows[0].id;
    const savedLines = await insertQuoteLines(database, previewId, preview.lines);

    await database.query("commit");

    return previewResponse({
      billingClient,
      expiryDate,
      insertRow: insertResult.rows[0],
      lines: savedLines,
      preview,
      quoteDate,
      quoteNumber,
      reference,
      services
    });
  } catch (error) {
    await database.query("rollback");
    throw error;
  } finally {
    database.release();
  }
}

export async function updateQuotePreviewMetadata(id, input = {}) {
  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const database = await pool.connect();

  try {
    await database.query("begin");

    const currentResult = await database.query(
      `
        select
          preview.id,
          preview.created_at,
          preview.period_start::text as "periodStart",
          preview.period_end::text as "periodEnd",
          preview.reference,
          preview.quote_number,
          preview.quote_date::text as quote_date,
          preview.expiry_date::text as expiry_date,
          preview.status,
          preview.totals,
          client.id as "billingClientId",
          client.abbreviation,
          client.account_code as "accountCode",
          client.currency,
          client.discount::float8 as discount,
          client.display_name as "displayName",
          client.status as "clientStatus",
          client.tax_rate_name as "taxRateName",
          client.tax_type as "taxType",
          client.teamwork_project_id as "teamworkProjectId",
          client.xero_client_name as "xeroClientName",
          client.xero_contact_id as "xeroContactId",
          project.name as "teamworkProjectName",
          project.company_name as "teamworkCompanyName"
        from quote_previews preview
        join billing_clients client on client.id = preview.billing_client_id
        left join teamwork_projects project on project.id = client.teamwork_project_id
        where preview.id = $1
        for update of preview
      `,
      [id]
    );

    if (!currentResult.rowCount) {
      const error = new Error("Document preview not found.");
      error.statusCode = 404;
      throw error;
    }

    const currentPreview = currentResult.rows[0];
    if (currentPreview.status !== "preview") {
      const error = new Error("This document has already been sent and cannot be edited.");
      error.statusCode = 409;
      throw error;
    }

    const nextReference = Object.hasOwn(input, "reference") ? String(input.reference || "").trim() : currentPreview.reference;
    const nextQuoteDate = Object.hasOwn(input, "quoteDate") ? input.quoteDate : currentPreview.quote_date;
    const nextExpiryDate = Object.hasOwn(input, "expiryDate") ? input.expiryDate : currentPreview.expiry_date;
    const nextQuoteNumber = Object.hasOwn(input, "quoteNumber")
      ? compactText(input.quoteNumber)
      : currentPreview.quote_number;

    assertQuoteMetadata({ expiryDate: nextExpiryDate, quoteDate: nextQuoteDate });
    if (!nextQuoteNumber) {
      const error = new Error("Document number is required.");
      error.statusCode = 400;
      throw error;
    }

    const servicesResult = await database.query(
      `
        select
          id,
          service_key as "serviceKey",
          label,
          aliases,
          annual_invoice_eligible as "annualInvoiceEligible",
          sort_order as "sortOrder"
        from standard_services
        where active = true
        order by sort_order, lower(label)
      `
    );
    const services = servicesResult.rows.map(mapService);
    const servicesById = new Map(services.map((service) => [service.id, service]));

    const lineUpdates = Array.isArray(input.lines) ? input.lines : [];
    const serviceOverrideEvents = [];
    const insertedManualLinesForResponse = [];
    for (const line of lineUpdates) {
      if (!line) continue;

      if (!line.id) {
        const discount = Object.hasOwn(line, "discount") ? toDiscount(line.discount) : Number(currentPreview.discount || 0);
        const serviceId = Object.hasOwn(line, "serviceId") ? compactText(line.serviceId) || null : null;
        if (serviceId && !servicesById.has(serviceId)) {
          const error = new Error("Choose a valid standardized service.");
          error.statusCode = 400;
          throw error;
        }

        const quantityHours = roundHours(toEditableNumber(line.quantityHours ?? 1, "Hours / Qty."));
        const unitAmount = roundMoney(toEditableNumber(line.unitAmount ?? 0, "Rate / Fee"));
        const annualYear = serviceId ? toAnnualYear(line.annualYear) : null;
        const service = serviceId ? servicesById.get(serviceId) : null;
        const taskName = String(line.taskName || line.description || "Manual row").trim();
        const description = String(line.description || "").trim();
        const comments = String(line.comments || "").trim();
        const baseManualLine = {
          accountCode: compactText(line.accountCode) || currentPreview.accountCode || "70330001",
          annualCovered: false,
          annualYear,
          comments,
          description,
          discount,
          includeInXero: quantityHours > 0 && unitAmount > 0,
          isBillable: true,
          lineOrder: 0,
          quantityHours,
          serviceId,
          sourceTimeEntryIds: [],
          sourceType: "manual",
          taskName,
          taxType: compactText(line.taxType) || currentPreview.taxType,
          unitAmount,
          warnings: []
        };

        const orderResult = await database.query(
          `
            select coalesce(max(line_order), 0)::int + 1 as "lineOrder"
            from quote_lines
            where quote_preview_id = $1
          `,
          [id]
        );
        const firstLineOrder = Number(orderResult.rows[0]?.lineOrder || 1);

        const billingClient = mapBillingClient({
          ...currentPreview,
          id: currentPreview.billingClientId,
          status: currentPreview.clientStatus
        });
        const manualEntry = {
          date: currentPreview.periodEnd,
          description,
          annualYear,
          hours: quantityHours,
          id: `manual:${Date.now()}`,
          isBillable: true,
          taskName,
          userName: "Manual row",
          userRate: unitAmount
        };
        const annualUsage = service ? await loadAnnualUsageForService(database, billingClient.id, service.id) : [];
        const parts = service
          ? splitManualLineForAnnualCoverage({
            annualUsage,
            annualYear,
            entry: manualEntry,
            hours: quantityHours,
            periodEnd: currentPreview.periodEnd,
            service
          })
          : [{ annualCoverage: null, annualOverflow: null, hours: quantityHours, prepaidAppliedHours: 0 }];
        const manualLines = parts.map((part, index) => {
          const partHours = roundHours(part.hours || 0);
          const annualCovered = Boolean(part.annualCoverage);
          const manualLine = {
            ...baseManualLine,
            annualBilling: part.annualOverflow
              ? [{
                amount: editedLineAmount({ ...baseManualLine, quantityHours: partHours }),
                annualHours: part.annualOverflow.annualHours,
                billedHours: partHours,
                prepaidAppliedHours: Number(part.prepaidAppliedHours || 0),
                remainingAfter: part.annualOverflow.remainingAfter,
                serviceId: part.annualOverflow.serviceId,
                usageId: part.annualOverflow.usageId,
                usedHoursAfter: part.annualOverflow.usedHoursAfter,
                usedHoursBefore: part.annualOverflow.usedHoursBefore,
                year: part.annualOverflow.year
              }]
              : [],
            annualCoverage: part.annualCoverage
              ? [{
                annualHours: part.annualCoverage.annualHours,
                coveredHours: partHours,
                remainingAfter: part.annualCoverage.remainingAfter,
                remainingBefore: part.annualCoverage.remainingBefore,
                serviceId: part.annualCoverage.serviceId,
                usageId: part.annualCoverage.usageId,
                usedHoursAfter: part.annualCoverage.usedHoursAfter,
                usedHoursBefore: part.annualCoverage.usedHoursBefore,
                year: part.annualCoverage.year
              }]
              : [],
            annualCovered,
            annualYear: part.annualCoverage?.year || part.annualOverflow?.year || annualYear,
            comments: annualCovered ? "Covered by annual invoice" : (part.prepaidAppliedHours > 0 ? `${roundHours(part.prepaidAppliedHours)}h booked to the pre-paid part` : comments),
            includeInXero: !annualCovered && partHours > 0 && unitAmount > 0,
            lineOrder: firstLineOrder + index,
            quantityHours: partHours
          };
          manualLine.amount = editedLineAmount(manualLine);
          return manualLine;
        });

        const savedManualLines = await insertQuoteLines(database, id, manualLines);
        insertedManualLinesForResponse.push(...savedManualLines);
        continue;
      }

      const lineResult = await database.query(
        `
          select
            id,
            service_id as "serviceId",
            source_time_entry_ids as "sourceTimeEntryIds",
            annual_year as "annualYear",
            task_name as "taskName",
            description,
            quantity_hours::float8 as "quantityHours",
            unit_amount::float8 as "unitAmount",
            amount::float8 as amount,
            account_code as "accountCode",
            tax_type as "taxType",
            discount::float8 as discount,
            include_in_xero as "includeInXero",
            is_billable as "isBillable",
            annual_covered as "annualCovered",
            comments
          from quote_lines
          where id = $1
            and quote_preview_id = $2
          for update
        `,
        [line.id, id]
      );

      if (!lineResult.rowCount) {
        const error = new Error("Document line not found.");
        error.statusCode = 404;
        throw error;
      }

      const currentLine = lineResult.rows[0];
      const discount = Object.hasOwn(line, "discount") ? toDiscount(line.discount) : Number(currentLine.discount || 0);
      const serviceId = Object.hasOwn(line, "serviceId") ? compactText(line.serviceId) || null : currentLine.serviceId;
      const annualYear = serviceId && Object.hasOwn(line, "annualYear") ? toAnnualYear(line.annualYear) : serviceId ? currentLine.annualYear : null;
      if (serviceId && !servicesById.has(serviceId)) {
        const error = new Error("Choose a valid standardized service.");
        error.statusCode = 400;
        throw error;
      }
      const serviceWasSubmitted = Object.hasOwn(line, "serviceId");
      if (serviceWasSubmitted) {
        const entryIds = sourceTimeEntryIds(currentLine.sourceTimeEntryIds);
        if (entryIds.length) {
          serviceOverrideEvents.push({
            annualYear,
            lineId: line.id,
            serviceId,
            sourceTimeEntryIds: entryIds
          });
        }
      }
      const nextLine = {
        ...currentLine,
        accountCode: Object.hasOwn(line, "accountCode") ? compactText(line.accountCode) || currentLine.accountCode : currentLine.accountCode,
        annualYear,
        comments: Object.hasOwn(line, "comments") ? String(line.comments || "").trim() : currentLine.comments,
        description: Object.hasOwn(line, "description") ? String(line.description || "").trim() : currentLine.description,
        discount,
        quantityHours: Object.hasOwn(line, "quantityHours")
          ? roundHours(toEditableNumber(line.quantityHours, "Hours"))
          : Number(currentLine.quantityHours || 0),
        serviceId,
        taskName: Object.hasOwn(line, "taskName") ? String(line.taskName || "").trim() : currentLine.taskName,
        taxType: Object.hasOwn(line, "taxType") ? compactText(line.taxType) : currentLine.taxType,
        unitAmount: Object.hasOwn(line, "unitAmount")
          ? roundMoney(toEditableNumber(line.unitAmount, "Rate"))
          : Number(currentLine.unitAmount || 0)
      };
      const amount = editedLineAmount(nextLine);
      const includeInXero =
        Boolean(nextLine.isBillable) &&
        !nextLine.annualCovered &&
        Number(nextLine.quantityHours || 0) > 0 &&
        Number(nextLine.unitAmount || 0) > 0;

      await database.query(
        `
          update quote_lines
          set
            task_name = $3,
            description = $4,
            quantity_hours = $5,
            unit_amount = $6,
            discount = $7,
            amount = $8,
            account_code = $9,
            tax_type = $10,
            comments = $11,
            include_in_xero = $12,
            service_id = $13,
            annual_year = $14,
            updated_at = now()
          where id = $1
            and quote_preview_id = $2
        `,
        [
          line.id,
          id,
          nextLine.taskName,
          nextLine.description,
          nextLine.quantityHours,
          nextLine.unitAmount,
          discount,
          amount,
          nextLine.accountCode,
          nextLine.taxType,
          nextLine.comments,
          includeInXero,
          nextLine.serviceId,
          nextLine.annualYear
        ]
      );
    }

    for (const serviceOverride of serviceOverrideEvents) {
      await database.query(
        `
          insert into quote_events (quote_preview_id, action, metadata)
          values ($1, 'quote_line_service_override', $2)
        `,
        [
          id,
          JSON.stringify({
            annualYear: serviceOverride.annualYear,
            lineId: serviceOverride.lineId,
            serviceId: serviceOverride.serviceId,
            sourceTimeEntryIds: serviceOverride.sourceTimeEntryIds
          })
        ]
      );
    }

    if (serviceOverrideEvents.length) {
      const billingClient = mapBillingClient({
        ...currentPreview,
        id: currentPreview.billingClientId,
        status: currentPreview.clientStatus
      });

      const existingLinesResult = await database.query(
        `
          select
            line_order as "lineOrder",
            source_type as "sourceType",
            source_time_entry_ids as "sourceTimeEntryIds",
            annual_year as "annualYear",
            task_name as "taskName",
            description,
            service_id as "serviceId",
            account_code as "accountCode",
            tax_type as "taxType",
            quantity_hours::float8 as "quantityHours",
            unit_amount::float8 as "unitAmount",
            amount::float8 as amount,
            annual_covered as "annualCovered",
            include_in_xero as "includeInXero",
            is_billable as "isBillable",
            discount::float8 as discount,
            warnings,
            comments
          from quote_lines
          where quote_preview_id = $1
          order by line_order, id
        `,
        [id]
      );

      const entriesResult = await loadPreviewSourceEntries(database, billingClient, currentPreview.periodStart, currentPreview.periodEnd);
      const billableOverrides = await loadQuoteBillableOverrides(database, id);
      let entries = entriesResult.map(mapEntry).map((entry) =>
        billableOverrides.has(String(entry.id))
          ? { ...entry, isBillable: billableOverrides.get(String(entry.id)) }
          : entry
      );
      entries = await backfillMissingTaskNames(database, entries);

      const serviceOverrides = await loadQuoteServiceOverrides(database, id);
      const annualUsage = await loadAnnualUsage(
        database,
        billingClient.id,
        currentPreview.periodStart,
        currentPreview.periodEnd,
        entries,
        serviceOverrides.map((override) => override.annualYear).filter(Boolean)
      );
      const preview = applyExistingLineSettings(
        buildAggregatedQuotePreview({
          annualUsage,
          billingClient,
          entries,
          periodEnd: currentPreview.periodEnd,
          periodStart: currentPreview.periodStart,
          serviceOverrides,
          services
        }),
        existingLinesResult.rows,
        services
      );
      const manualLines = existingLinesResult.rows
        .filter((line) => line.sourceType === "manual")
        .map((line, index) => ({
          accountCode: line.accountCode || billingClient.accountCode || "70330001",
          amount: Number(line.amount || 0),
          annualCovered: false,
          annualYear: line.annualYear || null,
          comments: line.comments || "",
          description: line.description || "",
          discount: Number(line.discount || 0),
          includeInXero: line.includeInXero !== false,
          isBillable: line.isBillable !== false,
          lineOrder: preview.lines.length + index + 1,
          quantityHours: Number(line.quantityHours || 0),
          serviceId: line.serviceId || null,
          sourceTimeEntryIds: sourceTimeEntryIds(line.sourceTimeEntryIds),
          sourceType: "manual",
          taskName: line.taskName || line.description || "Manual row",
          taxType: line.taxType || billingClient.taxType,
          unitAmount: Number(line.unitAmount || 0),
          warnings: line.warnings || []
        }));
      if (manualLines.length) {
        preview.lines = [...preview.lines, ...manualLines];
        preview.totals = {
          ...preview.totals,
          amount: roundMoney(preview.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)),
          lineCount: preview.lines.length,
          totalHours: roundHours(preview.lines.reduce((sum, line) => sum + Number(line.quantityHours || 0), 0)),
          billedHours: roundHours(preview.lines.reduce((sum, line) => sum + (line.isBillable ? Number(line.quantityHours || 0) : 0), 0))
        };
      }

      await database.query("delete from quote_lines where quote_preview_id = $1", [id]);
      const savedLines = await insertQuoteLines(database, id, preview.lines);

      await database.query(
        `
          update quote_previews
          set
            reference = $2,
            quote_number = $3,
            quote_date = $4,
            expiry_date = $5,
            warnings = $6,
            totals = $7,
            updated_at = now()
          where id = $1
        `,
        [id, nextReference, nextQuoteNumber, nextQuoteDate, nextExpiryDate, JSON.stringify(preview.warnings), JSON.stringify(preview.totals)]
      );

      await database.query("commit");

      const response = previewResponse({
        billingClient,
        expiryDate: nextExpiryDate,
        insertRow: {
          created_at: currentPreview.created_at,
          id
        },
        lines: savedLines,
        preview,
        quoteDate: nextQuoteDate,
        quoteNumber: nextQuoteNumber,
        reference: nextReference,
        services
      });
      response.preview.replaceLines = true;
      return response;
    }

    const lineTotalsResult = await database.query(
      `
        select
          coalesce(sum(amount), 0)::float8 as amount,
          coalesce(sum(quantity_hours), 0)::float8 as "totalHours",
          coalesce(sum(case when is_billable then quantity_hours else 0 end), 0)::float8 as "billedHours",
          coalesce(sum(case when annual_covered then quantity_hours else 0 end), 0)::float8 as "annualCoveredHours",
          count(*)::int as "lineCount"
        from quote_lines
        where quote_preview_id = $1
      `,
      [id]
    );
    const currentTotals = currentPreview.totals || {};
    const nextTotals = {
      ...currentTotals,
      amount: roundMoney(lineTotalsResult.rows[0]?.amount || 0),
      annualCoveredHours: roundHours(lineTotalsResult.rows[0]?.annualCoveredHours || 0),
      billedHours: roundHours(lineTotalsResult.rows[0]?.billedHours || 0),
      totalHours: roundHours(lineTotalsResult.rows[0]?.totalHours || 0),
      lineCount: Number(lineTotalsResult.rows[0]?.lineCount || 0)
    };

    const previewResult = await database.query(
      `
        update quote_previews
        set
          reference = $2,
          quote_number = $3,
          quote_date = $4,
          expiry_date = $5,
          totals = $6,
          updated_at = now()
        where id = $1
        returning
          id,
          reference,
          quote_number as "quoteNumber",
          quote_date::text as "quoteDate",
          expiry_date::text as "expiryDate",
          totals,
          updated_at as "updatedAt"
      `,
      [id, nextReference, nextQuoteNumber, nextQuoteDate, nextExpiryDate, JSON.stringify(nextTotals)]
    );

    const linesResult = await database.query(
      `
        select
          line.id,
          line.service_id as "serviceId",
          service.service_key as "serviceKey",
          service.label as "serviceLabel",
          line.source_type as "sourceType",
          line.source_time_entry_ids as "sourceTimeEntryIds",
          line.annual_year as "annualYear",
          line.task_name as "taskName",
          line.description,
          line.quantity_hours::float8 as "quantityHours",
          line.unit_amount::float8 as "unitAmount",
          line.discount::float8 as discount,
          line.amount::float8 as amount,
          line.account_code as "accountCode",
          line.tax_type as "taxType",
          line.is_billable as "isBillable",
          line.annual_covered as "annualCovered",
          line.include_in_xero as "includeInXero",
          line.comments
        from quote_lines line
        left join standard_services service on service.id = line.service_id
        where line.quote_preview_id = $1
        order by line.line_order, line.id
      `,
      [id]
    );
    const insertedManualLineDetails = new Map(insertedManualLinesForResponse.map((line) => [line.id, line]));
    const responseLines = linesResult.rows.map((line) => {
      const details = insertedManualLineDetails.get(line.id);
      return details ? { ...line, ...details } : line;
    });

    await database.query("commit");

    return {
      preview: {
        ...previewResult.rows[0],
        lines: responseLines,
        services
      }
    };
  } catch (error) {
    await database.query("rollback");
    throw error;
  } finally {
    database.release();
  }
}

export async function updateQuotePreviewTimeEntryBillable(id, input = {}) {
  const entryId = compactText(input.entryId);
  if (!entryId || typeof input.isBillable !== "boolean") {
    const error = new Error("Choose a source time entry and billable state.");
    error.statusCode = 400;
    throw error;
  }

  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const database = await pool.connect();

  try {
    await database.query("begin");

    const previewResult = await database.query(
      `
        select
          preview.id,
          preview.created_at,
          preview.period_start::text as "periodStart",
          preview.period_end::text as "periodEnd",
          preview.reference,
          preview.quote_number as "quoteNumber",
          preview.quote_date::text as "quoteDate",
          preview.expiry_date::text as "expiryDate",
          preview.status as "previewStatus",
          client.id as "billingClientId",
          client.abbreviation,
          client.account_code as "accountCode",
          client.currency,
          client.discount::float8 as discount,
          client.display_name as "displayName",
          client.status as "clientStatus",
          client.tax_rate_name as "taxRateName",
          client.tax_type as "taxType",
          client.teamwork_project_id as "teamworkProjectId",
          client.xero_client_name as "xeroClientName",
          client.xero_contact_id as "xeroContactId",
          project.name as "teamworkProjectName",
          project.company_name as "teamworkCompanyName"
        from quote_previews preview
        join billing_clients client on client.id = preview.billing_client_id
        left join teamwork_projects project on project.id = client.teamwork_project_id
        where preview.id = $1
        for update of preview
      `,
      [id]
    );

    if (!previewResult.rowCount) {
      const error = new Error("Document preview not found.");
      error.statusCode = 404;
      throw error;
    }

    const previewRow = previewResult.rows[0];
    if (previewRow.previewStatus !== "preview") {
      const error = new Error("This document has already been sent and cannot be edited.");
      error.statusCode = 409;
      throw error;
    }

    const billingClient = mapBillingClient({
      ...previewRow,
      id: previewRow.billingClientId,
      status: previewRow.clientStatus
    });

    const existingLinesResult = await database.query(
      `
        select
          task_name as "taskName",
          description,
          service_id as "serviceId",
          annual_covered as "annualCovered",
          is_billable as "isBillable",
          discount::float8 as discount,
          comments
        from quote_lines
        where quote_preview_id = $1
      `,
      [id]
    );

    const servicesResult = await database.query(
      `
        select
          id,
          service_key as "serviceKey",
          label,
          aliases,
          annual_invoice_eligible as "annualInvoiceEligible",
          sort_order as "sortOrder"
        from standard_services
        where active = true
        order by sort_order, lower(label)
      `
    );

    const entriesResult = await database.query(
      `
        select
          entry.id,
          entry.logged_on::text as "loggedOn",
          entry.minutes,
          entry.hours::float8 as hours,
          entry.is_billable as "isBillable",
          entry.user_id as "userId",
          entry.project_id as "projectId",
          entry.task_id as "taskId",
          entry.task_name as "taskName",
          entry.description,
          entry.teamwork_invoice_id as "teamworkInvoiceId",
          entry.sync_run_id as "syncRunId",
          person.name as "userName",
          person.user_rate::float8 as "userRate"
        from teamwork_time_entries entry
        left join teamwork_users person on person.id = entry.user_id
        where entry.project_id = $1
          and entry.logged_on between $2 and $3
          and coalesce(nullif(trim(entry.teamwork_invoice_id), ''), '') = ''
        order by entry.logged_on, entry.task_name, entry.description, entry.id
      `,
      [billingClient.teamworkProjectId, previewRow.periodStart, previewRow.periodEnd]
    );

    if (!entriesResult.rows.some((row) => String(row.id) === entryId)) {
      const error = new Error("Source time entry is not part of this document preview.");
      error.statusCode = 404;
      throw error;
    }

    const overrideEventsResult = await database.query(
      `
        select metadata
        from quote_events
        where quote_preview_id = $1
          and action = 'time_entry_billable_override'
        order by created_at, id
      `,
      [id]
    );
    const billableOverrides = new Map();
    for (const event of overrideEventsResult.rows) {
      const sourceTimeEntryId = compactText(event.metadata?.sourceTimeEntryId);
      if (!sourceTimeEntryId || typeof event.metadata?.isBillable !== "boolean") continue;
      billableOverrides.set(sourceTimeEntryId, event.metadata.isBillable);
    }
    billableOverrides.set(entryId, input.isBillable);

    let entries = entriesResult.rows.map(mapEntry).map((entry) =>
      billableOverrides.has(String(entry.id))
        ? { ...entry, isBillable: billableOverrides.get(String(entry.id)) }
        : entry
    );
    entries = await backfillMissingTaskNames(database, entries);

    const services = servicesResult.rows.map(mapService);
    const serviceOverrides = await loadQuoteServiceOverrides(database, id);
    const annualUsage = await loadAnnualUsage(
      database,
      billingClient.id,
      previewRow.periodStart,
      previewRow.periodEnd,
      entries,
      serviceOverrides.map((override) => override.annualYear).filter(Boolean)
    );
    const preview = applyExistingLineSettings(
      buildAggregatedQuotePreview({
        annualUsage,
        billingClient,
        entries,
        periodEnd: previewRow.periodEnd,
        periodStart: previewRow.periodStart,
        serviceOverrides,
        services
      }),
      existingLinesResult.rows,
      services
    );

    await database.query("delete from quote_lines where quote_preview_id = $1", [id]);
    const savedLines = await insertQuoteLines(database, id, preview.lines);

    await database.query(
      `
        insert into quote_events (quote_preview_id, action, metadata)
        values ($1, 'time_entry_billable_override', $2)
      `,
      [
        id,
        JSON.stringify({
          isBillable: input.isBillable,
          sourceTimeEntryId: entryId
        })
      ]
    );

    await database.query(
      `
        update quote_previews
        set
          warnings = $2,
          totals = $3,
          updated_at = now()
        where id = $1
      `,
      [id, JSON.stringify(preview.warnings), JSON.stringify(preview.totals)]
    );

    await database.query("commit");

    return previewResponse({
      billingClient,
      expiryDate: previewRow.expiryDate,
      insertRow: {
        created_at: previewRow.created_at,
        id
      },
      lines: savedLines,
      preview,
      quoteDate: previewRow.quoteDate,
      quoteNumber: previewRow.quoteNumber,
      reference: previewRow.reference,
      services
    });
  } catch (error) {
    await database.query("rollback");
    throw error;
  } finally {
    database.release();
  }
}

export async function sendQuotePreviewToXero(id, input = {}) {
  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const documentType = xeroDocumentType(input.documentType || input.xeroDocumentType);
  const documentLabel = xeroDocumentLabel(documentType);
  const database = await pool.connect();

  try {
    await database.query("begin");

    const previewResult = await database.query(
      `
        select
          preview.id,
          preview.period_start::text as "periodStart",
          preview.period_end::text as "periodEnd",
          preview.reference,
          preview.quote_number as "quoteNumber",
          preview.quote_date::text as "quoteDate",
          preview.expiry_date::text as "expiryDate",
          preview.status,
          preview.totals,
          client.id as "billingClientId",
          client.abbreviation,
          client.account_code as "accountCode",
          client.currency,
          client.discount::float8 as discount,
          client.display_name as "displayName",
          client.status as "clientStatus",
          client.tax_rate_name as "taxRateName",
          client.tax_type as "taxType",
          client.teamwork_project_id as "teamworkProjectId",
          client.xero_client_name as "xeroClientName",
          client.xero_contact_id as "xeroContactId"
        from quote_previews preview
        join billing_clients client on client.id = preview.billing_client_id
        where preview.id = $1
        for update of preview
      `,
      [id]
    );

    if (!previewResult.rowCount) {
      const error = new Error("Document preview not found.");
      error.statusCode = 404;
      throw error;
    }

    const previewRow = previewResult.rows[0];
    if (previewRow.status !== "preview") {
      const error = new Error("This document has already been sent or approved.");
      error.statusCode = 409;
      throw error;
    }

    const existingXeroResult = await database.query(
      `
        select id, status
        from xero_quotes
        where quote_preview_id = $1
        limit 1
      `,
      [id]
    );
    if (existingXeroResult.rowCount) {
      const error = new Error("This document already has a Xero send log.");
      error.statusCode = 409;
      throw error;
    }

    const billingClient = mapBillingClient({
      ...previewRow,
      id: previewRow.billingClientId,
      status: previewRow.clientStatus
    });

    if (!billingClient.xeroClientName || !billingClient.xeroContactId) {
      const error = new Error("Map this billing client to a Xero client before sending.");
      error.statusCode = 400;
      throw error;
    }
    if (!billingClient.taxType) {
      const error = new Error("Choose a Xero tax rate before sending.");
      error.statusCode = 400;
      throw error;
    }
    assertQuoteMetadata({ expiryDate: previewRow.expiryDate, quoteDate: previewRow.quoteDate });
    assertXeroDocumentNumber(previewRow, documentType);

    const linesResult = await database.query(
      `
        select
          id,
          line_order as "lineOrder",
          service_id as "serviceId",
          source_time_entry_ids as "sourceTimeEntryIds",
          task_name as "taskName",
          description,
          quantity_hours::float8 as "quantityHours",
          unit_amount::float8 as "unitAmount",
          amount::float8 as amount,
          is_billable as "isBillable",
          account_code as "accountCode",
          tax_type as "taxType",
          discount::float8 as discount,
          annual_covered as "annualCovered",
          include_in_xero as "includeInXero",
          comments,
          warnings
        from quote_lines
        where quote_preview_id = $1
        order by line_order, id
        for update
      `,
      [id]
    );
    const lines = linesResult.rows;
    const financialMetrics = await quoteFinancialMetrics(database, lines);

    const xeroPayload = buildXeroDocumentPayload({ billingClient, documentType, lines, previewRow });
    const xeroLineItems = xeroPayloadLineItems(xeroPayload);
    if (!xeroLineItems.length) {
      const error = new Error("There are no invoiceable lines to send to Xero after excluding unbillable and pre-paid time.");
      error.statusCode = 400;
      throw error;
    }

    const amount = roundMoney(xeroLineItems.reduce((sum, line) => sum + Number(line.LineAmount || 0), 0));
    const idempotencyKey = xeroIdempotencyKey(id, documentType);
    const xeroPreparedRequest = {
      ...xeroPayload,
      headers: xeroPayloadHeaders(idempotencyKey)
    };
    const xeroTransport = await sendQuoteRequestToXero(xeroPreparedRequest);

    const annualDeltas = await annualUsageDeltasForPreview(database, id);
    const annualUsageApplied = await applyAnnualUsageDeltas(database, {
      billingClientId: billingClient.id,
      deltas: annualDeltas,
      previewId: id,
      quoteNumber: previewRow.quoteNumber
    });
    const sendMode = xeroTransport.mode === "live" ? "live" : "prepared";
    const quoteStatus = xeroStatus(sendMode, xeroTransport);
    const previewStatus = xeroPreviewStatus(sendMode);
    const xeroDocumentId = sendMode === "live" ? xeroDocumentIdentifier(xeroTransport) : "";
    const xeroQuoteId = sendMode === "live" ? xeroTransport.quoteId || "" : "";
    const xeroResponse = sendMode === "live" ? xeroTransport.payload : xeroPreparedResponse(documentLabel);

    const xeroQuoteResult = await database.query(
      `
        insert into xero_quotes (
          quote_preview_id,
          document_type,
          xero_quote_id,
          quote_number,
          status,
          line_count,
          amount,
          teamwork_estimate_amount,
          teamwork_chargeable_amount,
          xero_sent_amount,
          idempotency_key,
          xero_status_message,
          xero_status_synced_at,
          response
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, case when $13 then now() else null end, $14)
        returning id, pushed_at as "pushedAt"
      `,
      [
        id,
        documentType,
        xeroDocumentId,
        previewRow.quoteNumber,
        quoteStatus,
        xeroLineItems.length,
        amount,
        financialMetrics.teamworkEstimateAmount,
        financialMetrics.teamworkChargeableAmount,
        amount,
        idempotencyKey,
        sendMode === "live" ? `Xero returned status ${quoteStatus}.` : "Prepared locally; not sent to Xero.",
        sendMode === "live",
        JSON.stringify(xeroResponse)
      ]
    );
    const xeroQuoteRow = xeroQuoteResult.rows[0];

    await database.query(
      `
        insert into xero_sync_logs (
          xero_quote_id,
          direction,
          action,
          status,
          payload,
          response,
          message
        )
        values ($1, 'outbound', $2, $3, $4, $5, $6)
      `,
      [
        xeroQuoteRow.id,
        xeroAction(documentType),
        quoteStatus,
        JSON.stringify(xeroPreparedRequest),
        JSON.stringify(xeroResponse),
        xeroLogMessage(documentLabel, sendMode)
      ]
    );

    await database.query(
      `
        insert into quote_events (quote_preview_id, action, metadata)
        values ($1, 'send_to_xero', $2)
      `,
      [
        id,
        JSON.stringify({
          annualUsageApplied,
          documentType,
          idempotencyKey,
          mode: sendMode,
          xeroDocumentId,
          xeroLineCount: xeroLineItems.length,
          xeroQuoteId,
          xeroQuoteLogId: xeroQuoteRow.id
        })
      ]
    );

    await database.query(
      `
        update quote_previews
        set status = $2, updated_at = now()
        where id = $1
      `,
      [id, previewStatus]
    );

    await database.query("commit");

    return {
      preview: {
        id,
        status: previewStatus
      },
      xero: {
        amount,
        annualUsageApplied,
        annualCoveredAmount: financialMetrics.annualCoveredAmount,
        documentLabel,
        documentType,
        lineCount: xeroLineItems.length,
        message: xeroUserMessage(documentLabel, sendMode),
        mode: sendMode,
        quoteNumber: previewRow.quoteNumber,
        status: quoteStatus,
        tenantName: xeroTransport.tenantName || "",
        teamworkChargeableAmount: financialMetrics.teamworkChargeableAmount,
        teamworkEstimateAmount: financialMetrics.teamworkEstimateAmount,
        xeroDocumentId,
        xeroQuoteId,
        xeroQuoteLogId: xeroQuoteRow.id
      }
    };
  } catch (error) {
    await database.query("rollback");
    throw error;
  } finally {
    database.release();
  }
}
