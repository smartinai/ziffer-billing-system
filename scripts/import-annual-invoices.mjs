import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readSheet } from "read-excel-file/node";
import pg from "pg";

const { Client } = pg;

const annualSheetName = "Annual invoices";
const priceListSheetName = "Price List";
const matrixInvoicedSheetName = "Invoiced";
const matrixUsedSheetName = "Used";
const importYears = new Set([2025, 2026]);

const serviceCodeMap = new Map([
  ["2-301", "filing_correspondence"],
  ["2-302", "agm_publication"],
  ["2-303", "annual_compliance"],
  ["2-401", "financial_statements"],
  ["2-402", "financial_statements"],
  ["2-501", "corporate_income_tax"],
  ["2-503", "value_added_tax"]
]);

function parseArgs(argv) {
  const args = { dryRun: false, format: "auto", workbookPath: "" };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--matrix") {
      args.format = "matrix";
    } else if (arg === "--row-export") {
      args.format = "row-export";
    } else if (arg.startsWith("--format=")) {
      args.format = arg.slice("--format=".length);
    } else if (!args.workbookPath) {
      args.workbookPath = arg;
    }
  }

  args.workbookPath = args.workbookPath || process.env.ANNUAL_INVOICE_WORKBOOK || "";
  return args;
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s)[.\s]*(a)[.]?\b/g, "sa")
    .replace(/\b(s)[.\s]*(a)[.\s]*(r)[.\s]*(l)\b/g, "sarl")
    .replace(/\b(s)[.\s]*(c)[.\s]*(s)\b/g, "scs")
    .replace(/\b(b)\s*[\d .\-/]+\b/g, " ")
    .replace(/0/g, "na")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(sarl|sa|spf|scs|ltd|limited|numero|rcs)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function headerIndex(headers) {
  return Object.fromEntries(headers.map((header, index) => [String(header || "").trim(), index]));
}

function hasCellValue(cell) {
  return cell !== "" && cell !== null && cell !== undefined;
}

function normalizeMatrixLabel(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/0/g, "na")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function serviceKeyForMatrixLabel(value) {
  const label = normalizeMatrixLabel(value);
  if (!label) return null;
  if (label.includes("filing") || label.includes("correspondence")) return "filing_correspondence";
  if (label.includes("agm") || label.includes("publication")) return "agm_publication";
  if (label.includes("annual compliance")) return "annual_compliance";
  if (label.includes("financial statement") || label.includes("annual accounts") || label.includes("fs ")) return "financial_statements";
  if (label.includes("corporate income tax") || label.includes("cit")) return "corporate_income_tax";
  if (label.includes("value added tax") || label.includes("vat")) return "value_added_tax";
  return null;
}

async function readRows(workbookPath, sheetName) {
  const rows = await readSheet(workbookPath, sheetName);
  if (!rows.length) throw new Error(`Workbook sheet "${sheetName}" is empty.`);
  return { headers: rows[0], rows: rows.slice(1).filter((row) => row.some(hasCellValue)) };
}

async function readPriceList(workbookPath) {
  const { headers, rows } = await readRows(workbookPath, priceListSheetName);
  const index = headerIndex(headers);
  const codeColumn = index["Code\nInventoryItemCode (Xero)"];
  const maxColumn = index["Maximum time limit for Basic rate"];
  const defaults = new Map();

  for (const row of rows) {
    const code = String(row[codeColumn] || "").trim();
    const maxHours = toOptionalNumber(row[maxColumn]);
    if (code && maxHours !== null) defaults.set(code, maxHours);
  }

  return defaults;
}

function clientKeys(row) {
  return [row.displayName, row.xeroClientName].map(normalizeName).filter(Boolean);
}

function findClient(sourceClientName, activeClients) {
  const sourceKey = normalizeName(sourceClientName);
  if (!sourceKey) return null;

  const exact = activeClients.find((client) => client.keys.includes(sourceKey));
  if (exact) return exact;

  const candidates = activeClients.filter((client) =>
    client.keys.some((key) => key && (key.includes(sourceKey) || sourceKey.includes(key)))
  );

  return candidates.length === 1 ? candidates[0] : null;
}

function uniqueJoined(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].join(", ");
}

function cellKey(clientId, serviceId, year) {
  return `${clientId}:${serviceId}:${year}`;
}

function rowDedupeKey(row) {
  return [
    normalizeName(row.sourceClientName),
    row.sourceServiceCode,
    row.forYear,
    row.invoicedOn || "",
    row.reference || "",
    row.quantity,
    row.unitPrice
  ].join("|");
}

async function buildImportCells({ activeClients, priceDefaults, services, workbookPath }) {
  const { headers, rows } = await readRows(workbookPath, annualSheetName);
  const index = headerIndex(headers);
  const requiredHeaders = [
    "Client",
    "Service Code",
    "Service",
    "Quantity",
    "Unit Price",
    "Invoiced on",
    "Max. hours",
    "Used hours",
    "For Year",
    "Invoice Number",
    "Reference"
  ];

  for (const header of requiredHeaders) {
    if (!(header in index)) throw new Error(`Missing "${header}" column in ${annualSheetName}.`);
  }

  const cells = new Map();
  const dedupeKeys = new Set();
  const skipped = {
    duplicateRows: 0,
    unsupportedServiceRows: 0,
    unsupportedYearRows: 0,
    unmatchedRows: 0
  };
  const unmatchedClients = new Map();

  for (const sourceRow of rows) {
    const forYear = Number(sourceRow[index["For Year"]]);
    if (!importYears.has(forYear)) {
      skipped.unsupportedYearRows += 1;
      continue;
    }

    const sourceServiceCode = String(sourceRow[index["Service Code"]] || "").trim();
    const serviceKey = serviceCodeMap.get(sourceServiceCode);
    if (!serviceKey) {
      skipped.unsupportedServiceRows += 1;
      continue;
    }

    const sourceClientName = String(sourceRow[index.Client] || "").trim();
    const client = findClient(sourceClientName, activeClients);
    if (!client) {
      skipped.unmatchedRows += 1;
      unmatchedClients.set(sourceClientName, (unmatchedClients.get(sourceClientName) || 0) + 1);
      continue;
    }

    const service = services.get(serviceKey);
    if (!service) {
      skipped.unsupportedServiceRows += 1;
      continue;
    }

    const sourceMaxHours = toOptionalNumber(sourceRow[index["Max. hours"]]);
    const defaultMaxHours = priceDefaults.get(sourceServiceCode) ?? null;
    const row = {
      billingClientId: client.id,
      forYear,
      invoiceNumber: String(sourceRow[index["Invoice Number"]] || "").trim(),
      invoicedOn: toDate(sourceRow[index["Invoiced on"]]),
      maxHours: sourceMaxHours ?? defaultMaxHours,
      quantity: toNumber(sourceRow[index.Quantity]),
      reference: String(sourceRow[index.Reference] || "").trim(),
      serviceId: service.id,
      sourceClientName,
      sourceServiceCode,
      sourceServiceName: String(sourceRow[index.Service] || "").trim(),
      unitPrice: toNumber(sourceRow[index["Unit Price"]]),
      usedHours: toNumber(sourceRow[index["Used hours"]])
    };

    const dedupeKey = rowDedupeKey(row);
    if (dedupeKeys.has(dedupeKey)) {
      skipped.duplicateRows += 1;
      continue;
    }
    dedupeKeys.add(dedupeKey);

    const key = cellKey(row.billingClientId, row.serviceId, row.forYear);
    const current = cells.get(key) || {
      billingClientId: row.billingClientId,
      forYear: row.forYear,
      invoiceNumbers: [],
      invoicedOn: row.invoicedOn,
      maxHours: null,
      quantity: 0,
      references: [],
      serviceId: row.serviceId,
      sourceClientName: client.displayName,
      sourceServiceCodes: [],
      sourceServiceNames: [],
      unitPrice: 0,
      usedHours: 0
    };

    current.invoiceNumbers.push(row.invoiceNumber);
    current.invoicedOn = [current.invoicedOn, row.invoicedOn].filter(Boolean).sort()[0] || null;
    current.maxHours = row.maxHours === null ? current.maxHours : Math.max(current.maxHours ?? 0, row.maxHours);
    current.quantity += row.quantity;
    current.references.push(row.reference);
    current.sourceServiceCodes.push(row.sourceServiceCode);
    current.sourceServiceNames.push(row.sourceServiceName);
    current.unitPrice += row.unitPrice;
    current.usedHours += row.usedHours;

    cells.set(key, current);
  }

  return {
    cells: [...cells.values()].map((cell) => ({
      ...cell,
      invoiceNumber: uniqueJoined(cell.invoiceNumbers),
      reference: uniqueJoined(cell.references),
      sourceServiceCode: uniqueJoined(cell.sourceServiceCodes),
      sourceServiceName: uniqueJoined(cell.sourceServiceNames),
      maxHours: cell.maxHours === null ? null : Math.round((cell.maxHours + Number.EPSILON) * 100) / 100,
      quantity: Math.round((cell.quantity + Number.EPSILON) * 100) / 100,
      unitPrice: Math.round((cell.unitPrice + Number.EPSILON) * 100) / 100,
      usedHours: Math.round((cell.usedHours + Number.EPSILON) * 100) / 100
    })),
    skipped,
    unmatchedClients: [...unmatchedClients.entries()].sort((a, b) => b[1] - a[1])
  };
}

function matrixColumns(rows) {
  const yearRow = rows[0] || [];
  const serviceRow = rows[2] || [];
  const columns = [];
  let currentYear = null;

  for (let columnIndex = 1; columnIndex < Math.max(yearRow.length, serviceRow.length); columnIndex += 1) {
    const year = Number(yearRow[columnIndex]);
    if (importYears.has(year)) currentYear = year;
    if (!importYears.has(currentYear)) continue;

    const sourceServiceName = String(serviceRow[columnIndex] || "").trim();
    const serviceKey = serviceKeyForMatrixLabel(sourceServiceName);
    if (!serviceKey) continue;

    columns.push({
      columnIndex,
      forYear: currentYear,
      serviceKey,
      sourceServiceName
    });
  }

  return columns;
}

function emptyMatrixCell({ client, service, column }) {
  return {
    billingClientId: client.id,
    forYear: column.forYear,
    invoiceNumbers: [],
    invoicedOn: null,
    maxHours: null,
    quantity: 0,
    references: [],
    serviceId: service.id,
    sourceClientName: client.displayName,
    sourceServiceCodes: ["matrix"],
    sourceServiceNames: [column.sourceServiceName || service.label],
    unitPrice: 0,
    usedHours: 0
  };
}

function applyMatrixRows({ cells, rows, services, activeClients, valueField }) {
  const columns = matrixColumns(rows);
  const skipped = {
    unsupportedServiceRows: 0,
    unmatchedRows: 0
  };
  const unmatchedClients = new Map();

  for (const sourceRow of rows.slice(3).filter((row) => row.some(hasCellValue))) {
    const sourceClientName = String(sourceRow[0] || "").trim();
    if (!sourceClientName) continue;

    const client = findClient(sourceClientName, activeClients);
    if (!client) {
      skipped.unmatchedRows += 1;
      unmatchedClients.set(sourceClientName, (unmatchedClients.get(sourceClientName) || 0) + 1);
      continue;
    }

    for (const column of columns) {
      const service = services.get(column.serviceKey);
      if (!service) {
        skipped.unsupportedServiceRows += 1;
        continue;
      }

      const key = cellKey(client.id, service.id, column.forYear);
      const cell = cells.get(key) || emptyMatrixCell({ client, service, column });
      const value = toNumber(sourceRow[column.columnIndex], 0);

      if (valueField === "maxHours") {
        cell.maxHours = value > 0 ? value : null;
      } else {
        cell.usedHours = value > 0 ? value : 0;
      }

      if (column.sourceServiceName) cell.sourceServiceNames.push(column.sourceServiceName);
      cells.set(key, cell);
    }
  }

  return { skipped, unmatchedClients };
}

async function buildMatrixImportCells({ activeClients, services, workbookPath }) {
  const [invoicedRows, usedRows] = await Promise.all([
    readSheet(workbookPath, matrixInvoicedSheetName),
    readSheet(workbookPath, matrixUsedSheetName)
  ]);

  if (!invoicedRows.length) throw new Error(`Workbook sheet "${matrixInvoicedSheetName}" is empty.`);
  if (!usedRows.length) throw new Error(`Workbook sheet "${matrixUsedSheetName}" is empty.`);

  const cells = new Map();
  const invoicedReport = applyMatrixRows({ cells, rows: invoicedRows, services, activeClients, valueField: "maxHours" });
  const usedReport = applyMatrixRows({ cells, rows: usedRows, services, activeClients, valueField: "usedHours" });
  const unmatchedClients = new Map();

  for (const [clientName, count] of [...invoicedReport.unmatchedClients, ...usedReport.unmatchedClients]) {
    unmatchedClients.set(clientName, (unmatchedClients.get(clientName) || 0) + count);
  }

  return {
    cells: [...cells.values()].map((cell) => ({
      ...cell,
      invoiceNumber: uniqueJoined(cell.invoiceNumbers),
      reference: uniqueJoined(cell.references),
      sourceServiceCode: uniqueJoined(cell.sourceServiceCodes),
      sourceServiceName: uniqueJoined(cell.sourceServiceNames),
      maxHours: cell.maxHours === null ? null : Math.round((cell.maxHours + Number.EPSILON) * 100) / 100,
      quantity: Math.round((cell.quantity + Number.EPSILON) * 100) / 100,
      unitPrice: Math.round((cell.unitPrice + Number.EPSILON) * 100) / 100,
      usedHours: Math.round((cell.usedHours + Number.EPSILON) * 100) / 100
    })),
    skipped: {
      duplicateRows: 0,
      unsupportedServiceRows: invoicedReport.skipped.unsupportedServiceRows + usedReport.skipped.unsupportedServiceRows,
      unsupportedYearRows: 0,
      unmatchedRows: invoicedReport.skipped.unmatchedRows + usedReport.skipped.unmatchedRows
    },
    unmatchedClients: [...unmatchedClients.entries()].sort((a, b) => b[1] - a[1])
  };
}

async function buildImportData({ context, format, workbookPath }) {
  if (format === "matrix") {
    return { format: "matrix", importData: await buildMatrixImportCells({ ...context, workbookPath }) };
  }

  if (format === "row-export") {
    const priceDefaults = await readPriceList(workbookPath);
    return { format: "row-export", importData: await buildImportCells({ ...context, priceDefaults, workbookPath }) };
  }

  try {
    const priceDefaults = await readPriceList(workbookPath);
    return { format: "row-export", importData: await buildImportCells({ ...context, priceDefaults, workbookPath }) };
  } catch (rowExportError) {
    try {
      return { format: "matrix", importData: await buildMatrixImportCells({ ...context, workbookPath }) };
    } catch (matrixError) {
      throw new Error(
        `Could not import workbook as row export (${rowExportError.message}) or matrix workbook (${matrixError.message}).`
      );
    }
  }
}

async function loadImportContext(database) {
  const [clientsResult, servicesResult] = await Promise.all([
    database.query(
      `
        select
          id,
          display_name as "displayName",
          xero_client_name as "xeroClientName"
        from billing_clients
        where status = 'active'
        order by lower(display_name)
      `
    ),
    database.query(
      `
        select
          id,
          service_key as "serviceKey",
          label
        from standard_services
        where active = true
          and annual_invoice_eligible = true
      `
    )
  ]);

  return {
    activeClients: clientsResult.rows.map((client) => ({ ...client, keys: clientKeys(client) })),
    services: new Map(servicesResult.rows.map((service) => [service.serviceKey, service]))
  };
}

async function upsertCells(database, cells) {
  const report = { deactivatedDuplicates: 0, inserted: 0, updated: 0 };

  await database.query("begin");
  try {
    for (const cell of cells) {
      const existingResult = await database.query(
        `
          select id
          from annual_invoice_usage
          where billing_client_id = $1
            and service_id = $2
            and for_year = $3
            and active = true
          order by updated_at desc, created_at desc
          for update
        `,
        [cell.billingClientId, cell.serviceId, cell.forYear]
      );

      const duplicateIds = existingResult.rows.slice(1).map((row) => row.id);
      if (duplicateIds.length) {
        await database.query("update annual_invoice_usage set active = false, updated_at = now() where id = any($1::uuid[])", [
          duplicateIds
        ]);
        report.deactivatedDuplicates += duplicateIds.length;
      }

      const params = [
        cell.billingClientId,
        cell.serviceId,
        cell.sourceClientName,
        cell.sourceServiceCode,
        cell.sourceServiceName,
        cell.quantity,
        cell.unitPrice,
        cell.invoicedOn,
        cell.maxHours,
        cell.usedHours,
        cell.forYear,
        cell.invoiceNumber,
        cell.reference
      ];

      if (existingResult.rowCount) {
        await database.query(
          `
            update annual_invoice_usage
            set
              billing_client_id = $1,
              service_id = $2,
              source_client_name = $3,
              source_service_code = $4,
              source_service_name = $5,
              quantity = $6,
              unit_price = $7,
              invoiced_on = $8,
              max_hours = $9,
              used_hours = $10,
              for_year = $11,
              invoice_number = $12,
              reference = $13,
              imported_at = now(),
              updated_at = now()
            where id = $14
          `,
          [...params, existingResult.rows[0].id]
        );
        report.updated += 1;
      } else {
        await database.query(
          `
            insert into annual_invoice_usage (
              billing_client_id,
              service_id,
              source_client_name,
              source_service_code,
              source_service_name,
              quantity,
              unit_price,
              invoiced_on,
              max_hours,
              used_hours,
              for_year,
              invoice_number,
              reference
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          params
        );
        report.inserted += 1;
      }
    }

    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workbookPath = required(args.workbookPath, "Workbook path");
  if (!fs.existsSync(workbookPath)) throw new Error(`Workbook was not found: ${workbookPath}`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  const resolvedWorkbookPath = path.resolve(workbookPath);
  const database = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
  });

  await database.connect();
  try {
    const context = await loadImportContext(database);
    const { format, importData } = await buildImportData({
      context,
      format: args.format,
      workbookPath: resolvedWorkbookPath
    });

    const writeReport = args.dryRun ? { deactivatedDuplicates: 0, inserted: 0, updated: 0 } : await upsertCells(database, importData.cells);
    const years = importData.cells.reduce((acc, cell) => {
      acc[cell.forYear] = (acc[cell.forYear] || 0) + 1;
      return acc;
    }, {});

    console.log(
      JSON.stringify(
        {
          dryRun: args.dryRun,
          format,
          importedCells: importData.cells.length,
          skipped: importData.skipped,
          unmatchedClients: importData.unmatchedClients,
          workbook: resolvedWorkbookPath,
          writeReport,
          years
        },
        null,
        2
      )
    );
  } finally {
    await database.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
