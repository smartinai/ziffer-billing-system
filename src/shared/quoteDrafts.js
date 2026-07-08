function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function compactText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function comparableText(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function serviceTerms(service) {
  const labelTerms = String(service.label || "")
    .split("/")
    .map((part) => comparableText(part));
  const aliasTerms = Array.isArray(service.aliases) ? service.aliases.map((alias) => comparableText(alias)) : [];
  const keyTerm = comparableText(String(service.serviceKey || "").replace(/_/g, " "));
  return unique([comparableText(service.label), ...labelTerms, ...aliasTerms, keyTerm]).sort((a, b) => b.length - a.length);
}

export function matchStandardService(taskName, services = []) {
  const task = comparableText(taskName);
  if (!task) return null;

  const orderedServices = [...services].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.label || "").localeCompare(String(b.label || ""))
  );

  for (const service of orderedServices) {
    const terms = serviceTerms(service);
    if (terms.some((term) => term && (task === term || task.includes(term)))) {
      return service;
    }
  }

  return null;
}

function serviceOverrideValue(override) {
  if (!Object.hasOwn(override || {}, "serviceId")) return undefined;
  const serviceId = compactText(override.serviceId);
  const annualYear = Number(override.annualYear);
  return {
    annualYear: Number.isInteger(annualYear) ? annualYear : null,
    serviceId: serviceId || null
  };
}

function serviceOverrideKeys(override) {
  const keys = [];
  const entryId = compactText(override?.entryId);
  const taskId = compactText(override?.taskId);
  const taskName = comparableText(override?.taskName);

  if (entryId) keys.push(`entry:${entryId}`);
  if (taskId) keys.push(`task-id:${taskId}`);
  if (taskName) keys.push(`task-name:${taskName}`);
  if (Array.isArray(override?.keys)) {
    for (const key of override.keys) {
      const normalizedKey = compactText(key);
      if (normalizedKey) keys.push(normalizedKey);
    }
  }

  return unique(keys);
}

function normalizeServiceOverrides(serviceOverrides = []) {
  const overridesByKey = new Map();

  for (const override of serviceOverrides) {
    const overrideValue = serviceOverrideValue(override);
    if (overrideValue === undefined) continue;

    for (const key of serviceOverrideKeys(override)) {
      overridesByKey.set(key, overrideValue);
    }
  }

  return overridesByKey;
}

function entryServiceOverrideKeys(entry) {
  const keys = [];
  const entryId = compactText(entry.id);
  const taskId = compactText(entry.taskId);
  const taskName = comparableText(entry.taskName);

  if (entryId) keys.push(`entry:${entryId}`);
  if (taskId) keys.push(`task-id:${taskId}`);
  if (taskName) keys.push(`task-name:${taskName}`);

  return keys;
}

function serviceForEntry(entry, services, servicesById, serviceOverridesByKey) {
  for (const key of entryServiceOverrideKeys(entry)) {
    if (!serviceOverridesByKey.has(key)) continue;

    const override = serviceOverridesByKey.get(key);
    const serviceId = override?.serviceId ?? override;
    return {
      annualYear: override?.annualYear || null,
      manual: true,
      service: serviceId ? servicesById.get(serviceId) || null : null
    };
  }

  return {
    manual: false,
    service: matchStandardService(entry.taskName, services)
  };
}

function warningDetails(type, count = 0) {
  const labels = {
    invoiced_in_teamwork: ["Already linked in Teamwork", `${count} source ${count === 1 ? "entry is" : "entries are"} already linked to a Teamwork invoice.`],
    missing_service: ["Missing service", `${count} source ${count === 1 ? "entry needs" : "entries need"} a standardized service.`],
    missing_tax_rate: ["Missing tax rate", "Set a tax rate on the billing client before pushing to Xero."],
    missing_xero_client: ["Missing Xero client", "Map this billing client to a Xero client before pushing to Xero."],
    no_time_entries: ["No source time", "No stored Teamwork time was found for this client and period."],
    unbillable_time: ["Unbillable time", `${count} source ${count === 1 ? "entry is" : "entries are"} marked unbillable.`],
    zero_rate: [
      "Missing person rate",
      `${count} billed time ${count === 1 ? "entry has" : "entries have"} no person rate. Add a rate to include ${count === 1 ? "it" : "them"} in the document amount.`
    ]
  };
  const [label, message] = labels[type] || [type, ""];
  return {
    count,
    label,
    message,
    severity: ["missing_xero_client", "missing_tax_rate", "zero_rate"].includes(type) ? "danger" : "warning",
    type
  };
}

function addWarningCount(map, type) {
  map.set(type, (map.get(type) || 0) + 1);
}

function lineDescription(taskName) {
  return compactText(taskName) || "No task";
}

function billableComment(isBillable) {
  return isBillable ? "" : "Marked unbillable";
}

function hoursLabel(value) {
  const rounded = round(value, 2);
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.?0+$/, "");
  return `${text || "0"}h`;
}

function entryYear(entry, fallbackDate) {
  const taskYear = compactText(entry.taskName).match(/\b(20\d{2})\b/);
  if (taskYear) return Number(taskYear[1]);

  const match = compactText(entry.date || entry.loggedOn || fallbackDate).match(/^(\d{4})-/);
  return match ? Number(match[1]) : null;
}

function annualUsageKey(serviceId, year) {
  return `${serviceId || ""}:${year || ""}`;
}

function annualCoverageComment(coverage) {
  if (!coverage) return "";

  const base = `Covered by annual invoice (${coverage.year})`;
  if (coverage.annualHours === null) return `${base}: ${hoursLabel(coverage.coveredHours)} in this doc.`;

  return `${base}: ${hoursLabel(coverage.usedHoursBefore)} used before, ${hoursLabel(coverage.coveredHours)} in this doc, ${hoursLabel(coverage.remainingAfter)} remaining.`;
}

function normalizeAnnualUsage(annualUsage = []) {
  const map = new Map();
  for (const usage of annualUsage) {
    const serviceId = compactText(usage.serviceId);
    const year = Number(usage.year || usage.forYear);
    if (!serviceId || !Number.isInteger(year)) continue;

    const annualHours = usage.annualHours ?? usage.maxHours;
    const usedHours = usage.usedHours ?? 0;
    map.set(annualUsageKey(serviceId, year), {
      annualHours: annualHours === "" || annualHours === null || annualHours === undefined ? null : Number(annualHours),
      previewHours: 0,
      serviceId,
      usageId: compactText(usage.usageId || usage.id),
      usedHours: Number(usedHours || 0),
      year
    });
  }
  return map;
}

function annualCoverageTaskMatch(taskName, service) {
  const task = comparableText(taskName);
  if (!task) return false;

  if (service.serviceKey === "financial_statements") {
    return task.includes("financial statement") || task.includes("financial statements") || task.includes("annual accounts") || /\bfs\s+20\d{2}\b/.test(task);
  }

  if (service.serviceKey === "corporate_income_tax") {
    return task.includes("corporate income tax") || /\bcit\s+20\d{2}\b/.test(task);
  }

  if (service.serviceKey === "value_added_tax") {
    return task.includes("value added tax") || /\bvat\s+20\d{2}\b/.test(task);
  }

  return true;
}

function annualCoverageForEntry({ annualUsageByKey, annualYear = null, entry, forceService = false, hours, periodEnd, service }) {
  if (!service?.id || service.annualInvoiceEligible === false) return null;
  if (!forceService && !annualCoverageTaskMatch(entry.taskName, service)) return null;

  const overrideYear = Number(annualYear || entry.annualYear);
  const hasExplicitAnnualYear = Number.isInteger(overrideYear);
  const requestedYear = hasExplicitAnnualYear ? overrideYear : entryYear(entry, periodEnd);
  let usage = annualUsageByKey.get(annualUsageKey(service.id, requestedYear));
  if (forceService && !hasExplicitAnnualYear && (!usage || !Number.isFinite(usage.annualHours) || usage.annualHours <= 0)) {
    const serviceUsages = [...annualUsageByKey.values()]
      .filter((candidate) => candidate.serviceId === service.id)
      .filter((candidate) => Number.isFinite(candidate.annualHours) && candidate.annualHours > 0)
      .sort((a, b) => Math.abs(Number(a.year) - Number(requestedYear)) - Math.abs(Number(b.year) - Number(requestedYear)) || Number(b.year) - Number(a.year));
    usage = serviceUsages[0] || usage;
  }
  if (!usage) return null;
  const year = Number(usage.year || requestedYear);

  const annualHours = Number.isFinite(usage.annualHours) && usage.annualHours > 0 ? usage.annualHours : null;
  if (annualHours === null) return null;
  const usedHoursBefore = usage.usedHours + usage.previewHours;
  const remainingBefore = Math.max(annualHours - usedHoursBefore, 0);
  const coveredHours = Math.min(hours, remainingBefore);

  usage.previewHours += coveredHours;
  const usedHoursAfter = usage.usedHours + usage.previewHours;
  const remainingAfter = Math.max(annualHours - usedHoursAfter, 0);

  return {
    annualHours,
    coveredHours,
    key: annualUsageKey(service.id, year),
    remainingAfter,
    remainingBefore,
    serviceId: service.id,
    usageId: usage.usageId,
    usedHoursAfter,
    usedHoursBefore,
    year
  };
}

function splitEntryForAnnualCoverage(entry, hours, annualCoverage) {
  if (!annualCoverage) return [{ annualCoverage: null, annualOverflow: null, entry, prepaidAppliedHours: 0, hours }];

  const coveredHours = round(annualCoverage.coveredHours, 4);
  const overflowHours = round(hours - coveredHours, 4);
  const parts = [];

  if (coveredHours > 0) {
    parts.push({
      annualCoverage,
      annualOverflow: null,
      entry: {
        ...entry,
        hours: coveredHours
      },
      prepaidAppliedHours: 0,
      hours: coveredHours
    });
  }

  if (overflowHours > 0) {
    parts.push({
      annualCoverage: null,
      annualOverflow: {
        annualHours: annualCoverage.annualHours,
        key: annualCoverage.key,
        remainingAfter: annualCoverage.remainingAfter,
        serviceId: annualCoverage.serviceId,
        usageId: annualCoverage.usageId,
        usedHoursAfter: annualCoverage.usedHoursAfter,
        usedHoursBefore: annualCoverage.usedHoursAfter,
        year: annualCoverage.year
      },
      entry: {
        ...entry,
        hours: overflowHours
      },
      prepaidAppliedHours: coveredHours,
      hours: overflowHours
    });
  }

  return parts;
}

export function splitManualLineForAnnualCoverage({ annualUsage = [], annualYear = null, entry, forceService = true, hours, periodEnd, service }) {
  const annualUsageByKey = normalizeAnnualUsage(annualUsage);
  const annualCoverage = annualCoverageForEntry({ annualUsageByKey, annualYear, entry, forceService, hours, periodEnd, service });
  return splitEntryForAnnualCoverage(entry, hours, annualCoverage);
}

function taskLineKey(entry, annualCoverage) {
  const taskId = compactText(entry.taskId);
  const billableState = Boolean(entry.isBillable) ? "billable" : "unbillable";
  const annualState = annualCoverage ? `annual:${annualCoverage.key}` : "standard";
  if (taskId) return `task-id:${taskId}:${billableState}:${annualState}`;

  const taskName = comparableText(entry.taskName);
  return taskName ? `task-name:${taskName}:${billableState}:${annualState}` : `task:none:${billableState}:${annualState}`;
}

export function buildAggregatedQuotePreview({
  annualUsage = [],
  billingClient,
  entries = [],
  periodEnd,
  periodStart,
  serviceOverrides = [],
  services = []
}) {
  const client = billingClient || {};
  const accountCode = client.accountCode || "70330001";
  const currency = client.currency || "EUR";
  const discount = Number(client.discount || 0);
  const taxType = client.taxType || "";
  const warningCounts = new Map();
  const lines = new Map();
  const annualUsageByKey = normalizeAnnualUsage(annualUsage);
  const servicesById = new Map(services.map((service) => [compactText(service.id), service]));
  const serviceOverridesByKey = normalizeServiceOverrides(serviceOverrides);
  const excludedInvoicedEntries = entries.filter((entry) => compactText(entry.teamworkInvoiceId));
  const sourceEntries = entries.filter((entry) => !compactText(entry.teamworkInvoiceId));

  if (!client.xeroClientName || !client.xeroContactId) addWarningCount(warningCounts, "missing_xero_client");
  if (!client.taxRateName && !client.taxType) addWarningCount(warningCounts, "missing_tax_rate");
  if (excludedInvoicedEntries.length > 0) warningCounts.set("invoiced_in_teamwork", excludedInvoicedEntries.length);
  if (!sourceEntries.length) addWarningCount(warningCounts, "no_time_entries");

  const totals = {
    amount: 0,
    annualCoveredHours: 0,
    billedHours: 0,
    entryCount: sourceEntries.length,
    excludedTeamworkInvoiceEntryCount: excludedInvoicedEntries.length,
    includedHours: 0,
    lineCount: 0,
    notBilledHours: 0,
    totalHours: 0,
    warningCount: 0,
    zeroRateHours: 0
  };

  for (const entry of sourceEntries) {
    const hours = Number(entry.hours ?? Number(entry.minutes || 0) / 60);
    const isBillable = Boolean(entry.isBillable);
    const rate = Number(entry.userRate || 0);
    const serviceMatch = serviceForEntry(entry, services, servicesById, serviceOverridesByKey);
    const service = serviceMatch.service;
    const annualCoverage = isBillable
      ? annualCoverageForEntry({ annualUsageByKey, annualYear: serviceMatch.annualYear, entry, forceService: serviceMatch.manual, hours, periodEnd, service })
      : null;

    totals.totalHours += hours;
    if (isBillable) totals.billedHours += hours;
    else totals.notBilledHours += hours;

    const parts = splitEntryForAnnualCoverage(entry, hours, annualCoverage);

    for (const part of parts) {
      const partEntry = part.entry;
      const partHours = Number(part.hours || 0);
      const partAnnualCoverage = part.annualCoverage;
      const warnings = [];

      if (!service) {
        warnings.push("missing_service");
        addWarningCount(warningCounts, "missing_service");
      }
      if (!isBillable) {
        warnings.push("unbillable_time");
        addWarningCount(warningCounts, "unbillable_time");
      }
      if (isBillable && !partAnnualCoverage && rate <= 0) {
        warnings.push("zero_rate");
        addWarningCount(warningCounts, "zero_rate");
        totals.zeroRateHours += partHours;
      }

      const includeInXero = isBillable && !partAnnualCoverage && rate > 0;
      const unitAmount = includeInXero ? rate : 0;
      const amount = includeInXero ? partHours * rate * (1 - discount / 100) : 0;
      const rateAmount = rate > 0 ? partHours * rate : 0;
      if (includeInXero) totals.includedHours += partHours;
      if (partAnnualCoverage) totals.annualCoveredHours += partHours;

      const key = taskLineKey(partEntry, partAnnualCoverage);

      if (!lines.has(key)) {
        lines.set(key, {
          accountCode,
          amount: 0,
          amountBeforeDiscount: 0,
          annualBillingGroups: new Map(),
          annualCoverageGroups: new Map(),
          annualCovered: Boolean(partAnnualCoverage),
          annualYear: partAnnualCoverage?.year || part.annualOverflow?.year || serviceMatch.annualYear || null,
          comments: partAnnualCoverage ? "Covered by annual invoice" : billableComment(isBillable),
          description: lineDescription(partEntry.taskName),
          discount,
          entries: [],
          includeInXero: false,
          includedHoursForAmount: 0,
          isBillable,
          quantityHours: 0,
          rateAmount: 0,
          rateHours: 0,
          rates: new Set(),
          serviceId: service?.id || null,
          serviceKey: service?.serviceKey || "",
          serviceLabel: service?.label || "Unmapped service",
          sourceTimeEntryIds: [],
          sourceType: "teamwork",
          taskId: compactText(partEntry.taskId),
          taskName: compactText(partEntry.taskName),
          taxType,
          unitAmount,
          warnings
        });
      }

      const line = lines.get(key);
      line.amount += amount;
      line.amountBeforeDiscount += includeInXero ? partHours * rate : 0;
      line.includeInXero = line.includeInXero || includeInXero;
      line.includedHoursForAmount += includeInXero ? partHours : 0;
      line.isBillable = line.isBillable && isBillable;
      line.quantityHours += partHours;
      line.rateAmount += rateAmount;
      line.rateHours += rate > 0 ? partHours : 0;
      line.sourceTimeEntryIds.push(String(entry.id));
      if (includeInXero) line.rates.add(rate);
      line.warnings = unique([...line.warnings, ...warnings]);
      if (partAnnualCoverage) {
        const group = line.annualCoverageGroups.get(partAnnualCoverage.key) || {
          annualHours: partAnnualCoverage.annualHours,
          coveredHours: 0,
          remainingAfter: partAnnualCoverage.remainingAfter,
          remainingBefore: partAnnualCoverage.remainingBefore,
          serviceId: partAnnualCoverage.serviceId,
          usageId: partAnnualCoverage.usageId,
          usedHoursAfter: partAnnualCoverage.usedHoursAfter,
          usedHoursBefore: partAnnualCoverage.usedHoursBefore,
          year: partAnnualCoverage.year
        };
        group.coveredHours += partHours;
        group.remainingAfter = partAnnualCoverage.remainingAfter;
        group.usedHoursAfter = partAnnualCoverage.usedHoursAfter;
        line.annualCoverageGroups.set(partAnnualCoverage.key, group);
      }
      if (part.annualOverflow) {
        const group = line.annualBillingGroups.get(part.annualOverflow.key) || {
          amount: 0,
          annualHours: part.annualOverflow.annualHours,
          billedHours: 0,
          prepaidAppliedHours: 0,
          remainingAfter: part.annualOverflow.remainingAfter,
          serviceId: part.annualOverflow.serviceId,
          usageId: part.annualOverflow.usageId,
          usedHoursAfter: part.annualOverflow.usedHoursAfter,
          usedHoursBefore: part.annualOverflow.usedHoursBefore,
          year: part.annualOverflow.year
        };
        group.amount += amount;
        group.billedHours += partHours;
        group.prepaidAppliedHours += Number(part.prepaidAppliedHours || 0);
        group.remainingAfter = part.annualOverflow.remainingAfter;
        group.usedHoursAfter = part.annualOverflow.usedHoursAfter;
        line.annualBillingGroups.set(part.annualOverflow.key, group);
      }

      const splitComment = part.prepaidAppliedHours > 0
        ? `${hoursLabel(part.prepaidAppliedHours)} booked to the pre-paid part`
        : "";

      line.entries.push({
        amount: round(amount),
        annualCovered: Boolean(partAnnualCoverage),
        comment: partAnnualCoverage ? "Covered by annual invoice" : splitComment || billableComment(isBillable),
        date: entry.date || "",
        description: compactText(entry.description),
        hours: round(partHours, 4),
        id: String(entry.id),
        isBillable,
        renderId: `${entry.id}:${partAnnualCoverage ? "prepaid" : "standard"}:${line.entries.length}`,
        userName: compactText(entry.userName) || "Unknown person",
        userRate: round(rate),
        warnings
      });
    }
  }

  const quoteLines = [...lines.values()]
    .map((line, index) => {
      const annualCoverage = [...line.annualCoverageGroups.values()].map((coverage) => ({
        ...coverage,
        coveredHours: round(coverage.coveredHours, 4),
        remainingAfter: coverage.remainingAfter === null ? null : round(coverage.remainingAfter, 4),
        remainingBefore: coverage.remainingBefore === null ? null : round(coverage.remainingBefore, 4),
        usedHoursAfter: round(coverage.usedHoursAfter, 4),
        usedHoursBefore: round(coverage.usedHoursBefore, 4)
      }));
      const annualBilling = [...line.annualBillingGroups.values()].map((billing) => ({
        ...billing,
        amount: round(billing.amount),
        annualHours: round(billing.annualHours, 4),
        billedHours: round(billing.billedHours, 4),
        prepaidAppliedHours: round(billing.prepaidAppliedHours, 4),
        remainingAfter: billing.remainingAfter === null ? null : round(billing.remainingAfter, 4),
        usedHoursAfter: round(billing.usedHoursAfter, 4),
        usedHoursBefore: round(billing.usedHoursBefore, 4)
      }));

      return {
        ...line,
        amount: round(line.amount),
        amountBeforeDiscount: undefined,
        annualBilling,
        annualBillingGroups: undefined,
        annualCoverage,
        annualCoverageGroups: undefined,
        annualCovered: annualCoverage.length > 0,
        comments: annualCoverage.length ? annualCoverage.map(annualCoverageComment).join(" ") : line.comments,
        includedHoursForAmount: undefined,
        lineOrder: index + 1,
        quantityHours: round(line.quantityHours, 4),
        rateAmount: undefined,
        rateCount: line.rates.size,
        rateHours: undefined,
        rates: undefined,
        unitAmount: line.rateHours > 0 ? round(line.rateAmount / line.rateHours) : 0
      };
    })
    .sort(
      (a, b) =>
        a.description.localeCompare(b.description) ||
        Number(b.isBillable) - Number(a.isBillable) ||
        b.amount - a.amount ||
        a.serviceLabel.localeCompare(b.serviceLabel)
    )
    .map((line, index) => ({ ...line, lineOrder: index + 1 }));

  totals.amount = round(quoteLines.reduce((sum, line) => sum + line.amount, 0));
  totals.annualCoveredHours = round(totals.annualCoveredHours, 4);
  totals.billedHours = round(totals.billedHours, 4);
  totals.includedHours = round(totals.includedHours, 4);
  totals.lineCount = quoteLines.length;
  totals.notBilledHours = round(totals.notBilledHours, 4);
  totals.totalHours = round(totals.totalHours, 4);
  totals.warningCount = warningCounts.size;
  totals.zeroRateHours = round(totals.zeroRateHours, 4);

  return {
    billingClient: client,
    currency,
    lines: quoteLines,
    period: { endDate: periodEnd, startDate: periodStart },
    totals,
    warnings: [...warningCounts.entries()].map(([type, count]) => warningDetails(type, count))
  };
}
