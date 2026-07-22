import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  Clock3,
  EllipsisVertical,
  Euro,
  FileText,
  Loader2,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  X,
  UserRound,
  UsersRound
} from "lucide-react";
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  acquireQuoteDraft,
  archiveQuoteDraft,
  createQuotePreview,
  demoMode,
  getArchivedQuoteDraft,
  getAuditEvents,
  getBillingQuoteDetail,
  getAnnualInvoices,
  getBillingQuotes,
  getSession,
  getSummary,
  getReportingSourceStatus,
  getQuoteDrafts,
  getXeroStatus,
  login,
  logout,
  refreshSummary,
  reconcileQuoteXeroSend,
  renewQuoteDraft,
  restoreQuoteDraft,
  sendQuoteToXero,
  syncBillingQuotesXeroStatus,
  syncBillingQuoteXeroStatus,
  updateAnnualInvoiceUsage,
  updateAccount,
  updateQuotePreview,
  updateQuoteTimeEntriesBillable,
  updateQuoteTimeEntryBillable
} from "./api.js";
import { getBillingClients, getXeroReference, updateBillingClient } from "./api.js";

const OperationsView = lazy(() => import("./OperationsView.jsx"));

const reportingTabs = [
  { id: "reporting-overview", label: "Overview", icon: BarChart3 },
  { id: "reporting-people", label: "People", icon: UsersRound },
  { id: "reporting-projects", label: "Projects", icon: BriefcaseBusiness }
];

const reportingDataModes = [
  { value: "teamwork", label: "Teamwork data" },
  { value: "aggregate", label: "Aggregate data" }
];

const reportingSortOptions = {
  teamwork: [
    { value: "billableAmount", label: "Billable amount" },
    { value: "billableHours", label: "Billable hours" },
    { value: "totalAmount", label: "Total amount" },
    { value: "totalHours", label: "Total hours" },
    { value: "unbillableAmount", label: "Unbillable amount" },
    { value: "billablePercent", label: "Billable %" },
    { value: "name", label: "Name A-Z" }
  ],
  aggregate: [
    { value: "teamworkEstimateAmount", label: "Teamwork estimate" },
    { value: "excludingPrepaidAmount", label: "Excluding pre-paid" },
    { value: "sentToXeroAmount", label: "Sent to Xero" },
    { value: "paidInXeroAmount", label: "Paid in Xero" },
    { value: "name", label: "Name A-Z" }
  ]
};

const reportingDataModeValues = reportingDataModes.map((mode) => mode.value);
const reportingSortValues = {
  aggregate: reportingSortOptions.aggregate.map((option) => option.value),
  teamwork: reportingSortOptions.teamwork.map((option) => option.value)
};

const billingTabs = [
  { id: "billing-create-quote", label: "Create New", icon: FileText },
  { id: "billing-quotes", label: "Docs", icon: FileText },
  { id: "billing-annual-invoices", label: "Annual Invoices", icon: CalendarDays },
  { id: "billing-clients", label: "Clients", icon: BriefcaseBusiness },
  { id: "billing-audit-log", label: "Audit Log", icon: ShieldCheck },
  { id: "billing-operations", label: "Operations", icon: Activity, adminOnly: true }
];

const allTabs = [...reportingTabs, ...billingTabs];
const defaultActiveTab = "billing-quotes";
const activeTabIds = new Set(allTabs.map((tab) => tab.id));
const activeTabStorageKey = "ziffer.activeTab:v2";
const editorSessionStorageKey = "ziffer.editorSession:v1";

const disabledNavItems = [
  { id: "ecdf", label: "eCDF", icon: FileText },
  { id: "performance", label: "Performance", icon: Activity }
];

const currencyOptions = [
  { value: "EUR", label: "EUR - Euro" },
  { value: "USD", label: "USD - US dollar" },
  { value: "GBP", label: "GBP - British pound" },
  { value: "CHF", label: "CHF - Swiss franc" }
];

const clientStatusOptions = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "excluded", label: "Excluded" }
];

const xeroDocumentTypeOptions = [
  { value: "draft_invoice", label: "Draft invoice" },
  { value: "draft_quote", label: "Draft quote" }
];

function xeroDocumentTypeLabel(value) {
  return xeroDocumentTypeOptions.find((option) => option.value === value)?.label || "Draft invoice";
}

const currency = new Intl.NumberFormat("en-LU", {
  currency: "EUR",
  maximumFractionDigits: 0,
  style: "currency"
});

const compactCurrency = new Intl.NumberFormat("en-LU", {
  currency: "EUR",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency"
});

const decimal = new Intl.NumberFormat("en-LU", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0
});

const wholeNumber = new Intl.NumberFormat("en-LU", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0
});

function formatCurrencyAmount(value, currencyCode = "EUR") {
  return new Intl.NumberFormat("en-LU", {
    currency: currencyCode || "EUR",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value || 0);
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function BrandLogo({ className = "" }) {
  return <img className={`brand-logo ${className}`} src="/logo-ziffer-new.svg" alt="ZIFFER" />;
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function today() {
  return formatLocalDate(new Date());
}

function addDaysToDate(dateString, days) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function lastMonthRange() {
  const date = new Date();
  const first = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const last = new Date(date.getFullYear(), date.getMonth(), 0);
  return {
    endDate: formatLocalDate(last),
    startDate: formatLocalDate(first)
  };
}

function monthRange(period) {
  const [year, month] = period.split("-").map(Number);
  const endDate = `${period}-${padDatePart(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
  return { endDate, startDate: `${period}-01` };
}

function formatMonthOption(period) {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

function selectedMonthPeriod(range) {
  if (!range.startDate || !range.endDate || !range.startDate.endsWith("-01")) return "";
  const period = range.startDate.slice(0, 7);
  return monthRange(period).endDate === range.endDate ? period : "";
}

function dataMonthOptions(yearTrend = []) {
  return yearTrend
    .filter((row) => row.period && ((row.hours || 0) > 0 || (row.billableHours || 0) > 0 || (row.money || 0) > 0))
    .map((row) => ({ label: formatMonthOption(row.period), value: row.period }))
    .sort((a, b) => b.value.localeCompare(a.value));
}

function periodFromMonthLabel(label = "") {
  const match = String(label).trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return "";

  const monthIndex = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ].indexOf(match[1].toLowerCase());

  return monthIndex >= 0 ? `${match[2]}-${padDatePart(monthIndex + 1)}` : "";
}

function quoteDisplayPeriod(quote = {}) {
  return (
    periodFromMonthLabel(quote.reference) ||
    dateOnly(quote.quoteDate || quote.preparedAt).slice(0, 7) ||
    dateOnly(quote.periodStart).slice(0, 7)
  );
}

function quoteMonthOptions(quotes = []) {
  const periods = new Set();

  for (const quote of quotes) {
    const period = quoteDisplayPeriod(quote);
    if (/^\d{4}-\d{2}$/.test(period)) periods.add(period);
  }

  return [...periods]
    .map((period) => ({ label: formatMonthOption(period), value: period }))
    .sort((a, b) => b.value.localeCompare(a.value));
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function quoteMatchesRange(quote, range) {
  if (!range?.startDate || !range?.endDate) return true;

  const displayPeriod = periodFromMonthLabel(quote.reference);
  const displayRange = displayPeriod ? monthRange(displayPeriod) : null;
  const startDate = displayRange?.startDate || dateOnly(quote.periodStart || quote.quoteDate || quote.preparedAt);
  const endDate = displayRange?.endDate || dateOnly(quote.periodEnd || quote.quoteDate || quote.preparedAt || startDate);
  if (!startDate && !endDate) return true;

  return (startDate || endDate) <= range.endDate && (endDate || startDate) >= range.startDate;
}

function summarizeQuoteRows(quotes = []) {
  const paidQuotes = quotes.filter((quote) => Number(quote.amountPaidInXero || 0) > 0 && quote.paidWithinDays !== null);
  const avgPaidWithinDays = paidQuotes.length
    ? paidQuotes.reduce((sum, quote) => sum + Number(quote.paidWithinDays || 0), 0) / paidQuotes.length
    : null;

  return {
    avgPaidWithinDays: avgPaidWithinDays === null ? null : roundNumber(avgPaidWithinDays),
    outstandingAmount: roundNumber(quotes.reduce((sum, quote) => sum + Number(quote.outstandingAmount || 0), 0)),
    totalPaidAmount: roundNumber(quotes.reduce((sum, quote) => sum + Number(quote.amountPaidInXero || 0), 0)),
    totalQuotes: quotes.length,
    totalSentAmount: roundNumber(quotes.reduce((sum, quote) => sum + Number(quote.amountSentToXero || 0), 0)),
    totalTeamworkAfterAnnual: roundNumber(quotes.reduce((sum, quote) => sum + Number(quote.teamworkAfterAnnual || 0), 0)),
    totalTeamworkEstimate: roundNumber(quotes.reduce((sum, quote) => sum + Number(quote.initialTeamworkEstimate || 0), 0))
  };
}

function formatHours(value) {
  return `${decimal.format(value || 0)}h`;
}

function metricFromTotals(totals = {}, mode = "billable") {
  if (mode === "all") {
    return {
      amount: Number(totals.allMoney ?? totals.money ?? 0),
      hours: Number(totals.hours || 0)
    };
  }

  if (mode === "unbillable") {
    return {
      amount: Math.max(Number(totals.allMoney ?? totals.money ?? 0) - Number(totals.money || 0), 0),
      hours: Math.max(Number(totals.hours || 0) - Number(totals.billableHours || 0), 0)
    };
  }

  return {
    amount: Number(totals.money || 0),
    hours: Number(totals.billableHours || 0)
  };
}

function metricFromAggregate(row = {}, key) {
  const metric = row.aggregate?.[key] || {};
  return {
    amount: Number(metric.amount || 0),
    hours: Number(metric.hours || 0)
  };
}

function compareReportingNames(a = {}, b = {}) {
  return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
}

function reportingSortValue(row = {}, dataMode, sortKey) {
  if (sortKey === "name") return String(row.name || "").toLowerCase();

  if (dataMode === "aggregate") {
    if (sortKey === "teamworkEstimateAmount") return metricFromAggregate(row, "teamworkEstimate").amount;
    if (sortKey === "excludingPrepaidAmount") return metricFromAggregate(row, "excludingPrepaid").amount;
    if (sortKey === "sentToXeroAmount") return metricFromAggregate(row, "sentToXero").amount;
    if (sortKey === "paidInXeroAmount") return metricFromAggregate(row, "paidInXero").amount;
    return metricFromAggregate(row, "teamworkEstimate").amount;
  }

  if (sortKey === "billableHours") return metricFromTotals(row.totals).hours;
  if (sortKey === "totalAmount") return metricFromTotals(row.totals, "all").amount;
  if (sortKey === "totalHours") return metricFromTotals(row.totals, "all").hours;
  if (sortKey === "unbillableAmount") return metricFromTotals(row.totals, "unbillable").amount;
  if (sortKey === "billablePercent") return Number(row.totals?.billablePercent || 0);
  return metricFromTotals(row.totals).amount;
}

function sortReportingRows(rows = [], dataMode, sortKey) {
  return [...rows].sort((a, b) => {
    if (sortKey === "name") return compareReportingNames(a, b);

    const diff = reportingSortValue(b, dataMode, sortKey) - reportingSortValue(a, dataMode, sortKey);
    return diff || compareReportingNames(a, b);
  });
}

function MetricStack({ metric }) {
  return (
    <span className="metric-stack">
      <strong>{formatHours(metric?.hours || 0)}</strong>
      <span>{currency.format(metric?.amount || 0)}</span>
    </span>
  );
}

function ReportingDataModeToggle({ onChange, value }) {
  return (
    <div className="reporting-mode-toggle" aria-label="Reporting data mode">
      {reportingDataModes.map((mode) => (
        <button
          aria-pressed={value === mode.value}
          key={mode.value}
          onClick={() => onChange(mode.value)}
          type="button"
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function ReportingSortSelect({ dataMode, label, onChange, value }) {
  const options = reportingSortOptions[dataMode] || reportingSortOptions.teamwork;

  return (
    <select
      aria-label={label}
      className="reporting-sort-select"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          Sort: {option.label}
        </option>
      ))}
    </select>
  );
}

function storedStringPreference(storageKey, defaultValue, validValues = []) {
  if (typeof window === "undefined") return defaultValue;

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    return validValues.includes(storedValue) ? storedValue : defaultValue;
  } catch {
    return defaultValue;
  }
}

function useStoredStringPreference(storageKey, defaultValue, validValues = []) {
  const [value, setValue] = useState(() => storedStringPreference(storageKey, defaultValue, validValues));

  useEffect(() => {
    if (!validValues.includes(value)) {
      setValue(defaultValue);
      return;
    }

    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // Storage can be disabled; the current in-memory choice still works.
    }
  }, [defaultValue, storageKey, validValues, value]);

  return [value, setValue];
}

function useReportingPreferences(scope) {
  const [dataMode, setDataMode] = useStoredStringPreference(
    `ziffer.reporting.${scope}.dataMode`,
    "teamwork",
    reportingDataModeValues
  );
  const [teamworkSortKey, setTeamworkSortKey] = useStoredStringPreference(
    `ziffer.reporting.${scope}.teamworkSort`,
    "billableAmount",
    reportingSortValues.teamwork
  );
  const [aggregateSortKey, setAggregateSortKey] = useStoredStringPreference(
    `ziffer.reporting.${scope}.aggregateSort`,
    "teamworkEstimateAmount",
    reportingSortValues.aggregate
  );

  return {
    aggregateSortKey,
    dataMode,
    setAggregateSortKey,
    setDataMode,
    setTeamworkSortKey,
    teamworkSortKey
  };
}

function useEscapeToClose(onClose, active = true) {
  useEffect(() => {
    if (!active || typeof onClose !== "function") return undefined;

    function handleKeyDown(event) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);
}

function annualCoverageKey(coverage) {
  return [coverage.usageId, coverage.serviceId, coverage.year].filter(Boolean).join(":");
}

function annualCoverageItems(lines = []) {
  const groups = new Map();

  for (const line of lines) {
    for (const coverage of line.annualCoverage || []) {
      const key = annualCoverageKey(coverage) || `${line.id || line.taskName}:${coverage.year || ""}`;
      const current = groups.get(key) || {
        annualHours: Number(coverage.annualHours || 0),
        coveredHours: 0,
        remainingAfter: Number(coverage.remainingAfter || 0),
        serviceLabel: line.serviceLabel || "Annual service",
        taskNames: new Set(),
        usedHoursAfter: Number(coverage.usedHoursAfter || 0),
        usedHoursBefore: Number(coverage.usedHoursBefore || 0),
        year: coverage.year
      };

      current.annualHours = Math.max(current.annualHours, Number(coverage.annualHours || 0));
      current.coveredHours += Number(coverage.coveredHours || 0);
      current.remainingAfter = Math.min(current.remainingAfter, Number(coverage.remainingAfter || 0));
      current.usedHoursAfter = Math.max(current.usedHoursAfter, Number(coverage.usedHoursAfter || 0));
      current.usedHoursBefore = Math.min(current.usedHoursBefore, Number(coverage.usedHoursBefore || 0));
      if (line.taskName || line.description) current.taskNames.add(line.taskName || line.description);
      groups.set(key, current);
    }
  }

  return [...groups.values()]
    .map((item) => ({ ...item, taskNames: [...item.taskNames] }))
    .sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || a.serviceLabel.localeCompare(b.serviceLabel));
}

function annualInvoicedItems(lines = []) {
  const groups = new Map();

  for (const line of lines) {
    for (const billing of line.annualBilling || []) {
      const key = annualCoverageKey(billing) || `${line.id || line.taskName}:${billing.year || ""}`;
      const current = groups.get(key) || {
        amount: 0,
        annualHours: Number(billing.annualHours || 0),
        billedHours: 0,
        prepaidAppliedHours: 0,
        remainingAfter: Number(billing.remainingAfter || 0),
        serviceLabel: line.serviceLabel || "Annual service",
        taskNames: new Set(),
        usedHoursAfter: Number(billing.usedHoursAfter || 0),
        usedHoursBefore: Number(billing.usedHoursBefore || 0),
        year: billing.year
      };

      current.amount += Number(billing.amount || 0);
      current.annualHours = Math.max(current.annualHours, Number(billing.annualHours || 0));
      current.billedHours += Number(billing.billedHours || 0);
      current.prepaidAppliedHours += Number(billing.prepaidAppliedHours || 0);
      current.remainingAfter = Math.min(current.remainingAfter, Number(billing.remainingAfter || 0));
      current.usedHoursAfter = Math.max(current.usedHoursAfter, Number(billing.usedHoursAfter || 0));
      current.usedHoursBefore = Math.min(current.usedHoursBefore, Number(billing.usedHoursBefore || 0));
      if (line.taskName || line.description) current.taskNames.add(line.taskName || line.description);
      groups.set(key, current);
    }
  }

  return [...groups.values()]
    .map((item) => ({ ...item, taskNames: [...item.taskNames] }))
    .sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || a.serviceLabel.localeCompare(b.serviceLabel));
}

function AnnualServiceSummary({ currencyCode = "EUR", items, mode = "covered", totalHours }) {
  if (!items.length) return null;

  const isInvoiced = mode === "invoiced";
  const hoursKey = isInvoiced ? "billedHours" : "coveredHours";
  const hoursTotal = Number(totalHours || 0) || items.reduce((sum, item) => sum + Number(item[hoursKey] || 0), 0);

  return (
    <div
      className={`annual-coverage-summary${isInvoiced ? " annual-coverage-summary--invoiced" : ""}`}
      aria-label={isInvoiced ? "Annual services to invoice" : "Annual invoice coverage"}
    >
      <div className="annual-coverage-summary-main">
        <span>{isInvoiced ? "Annual overflow" : "Annual coverage"}</span>
        <strong>{formatHours(hoursTotal)}</strong>
        {isInvoiced ? (
          <small>
            <b>WILL</b> be invoiced
          </small>
        ) : (
          <small>
            will <b>NOT</b> be invoiced
          </small>
        )}
      </div>
      <div className="annual-coverage-summary-list">
        {items.map((item) => (
          <div className="annual-coverage-summary-item" key={`${item.serviceLabel}-${item.year}`}>
            <div className="annual-coverage-summary-service">
              <strong>{item.serviceLabel}</strong>
              <span>{item.year}</span>
            </div>
            <div className="annual-coverage-summary-metrics">
              <span className="annual-coverage-summary-metric">
                <small>{isInvoiced ? "Pre-paid limit" : "Used before"}</small>
                <strong>{isInvoiced ? formatHours(item.annualHours) : formatHours(item.usedHoursBefore)}</strong>
              </span>
              <span className="annual-coverage-summary-metric annual-coverage-summary-metric--current">
                <small>This doc</small>
                <strong>{formatHours(item[hoursKey])}</strong>
              </span>
              <span className="annual-coverage-summary-metric">
                <small>{isInvoiced ? "Amount" : "Remaining"}</small>
                <strong>{isInvoiced ? formatCurrencyAmount(item.amount, currencyCode) : formatHours(item.remainingAfter)}</strong>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuoteActionMenu({
  actions,
  actionDisabled = false,
  actionLabel = "Mark unbillable",
  busy = false,
  disabled = false,
  isOpen = false,
  menuLabel,
  onEdit,
  onMarkUnbillable,
  onToggle
}) {
  const menuActions = Array.isArray(actions)
    ? actions
    : [{ disabled: actionDisabled, label: actionLabel, onClick: onMarkUnbillable }];

  return (
    <div className="quote-action-menu">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={menuLabel}
        className="quote-action-menu-button"
        disabled={disabled}
        type="button"
        onClick={onToggle}
      >
        {busy ? <Loader2 className="spin" size={15} /> : <EllipsisVertical size={17} />}
      </button>
      {isOpen ? (
        <div className="quote-action-menu-popover" role="menu">
          {onEdit ? (
            <button disabled={disabled || busy} role="menuitem" type="button" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {menuActions.map((action) => (
            <button
              disabled={action.disabled || busy}
              key={action.label}
              role="menuitem"
              type="button"
              onClick={action.onClick}
            >
              {busy ? "Saving..." : action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuoteLineEditModal({ annualYears = [], currencyCode = "EUR", line, onClose, onSave, services = [], taxRates = [] }) {
  const [draft, setDraft] = useState(() => quoteLineEditDraft(line));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEscapeToClose(onClose, !saving);
  const taxRateOptions = useMemo(() => {
    const seen = new Set();
    const options = taxRates
      .map((taxRate) => ({
        label: taxRate.name || taxRate.taxType,
        value: taxRate.taxType || ""
      }))
      .filter((taxRate) => {
        if (!taxRate.value || seen.has(taxRate.value)) return false;
        seen.add(taxRate.value);
        return true;
      });

    if (draft.taxType && !seen.has(draft.taxType)) {
      options.unshift({ label: draft.taxType, value: draft.taxType });
    }

    return options;
  }, [draft.taxType, taxRates]);

  useEffect(() => {
    setDraft(quoteLineEditDraft(line));
    setError("");
  }, [line]);

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await onSave({
        ...draft,
        annualYear: draft.serviceId ? draft.annualYear : "",
        discount: normalizePercent(draft.discount),
        quantityHours: normalizeEditableNumber(draft.quantityHours, "Hours / Qty."),
        unitAmount: normalizeEditableNumber(draft.unitAmount, "Rate / Fee")
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="quote-line-edit-title" className="settings-modal quote-line-edit-modal">
        <div className="settings-modal-header">
          <div>
            <p>Document row</p>
            <h2 id="quote-line-edit-title">{line.id ? "Edit" : "Add manual row"}</h2>
            <span>{line.taskName || line.description || "No task"}</span>
          </div>
          <button aria-label="Close row editor" className="modal-close-button" disabled={saving} type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form className="settings-form quote-line-edit-form" onSubmit={handleSubmit}>
          <label className="settings-form-wide">
            Task name
            <input value={draft.taskName} onChange={(event) => updateDraft("taskName", event.target.value)} />
          </label>
          <label className="settings-form-wide">
            Description
            <textarea value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} />
          </label>
          <label className="settings-form-wide">
            Comment
            <textarea value={draft.comments} onChange={(event) => updateDraft("comments", event.target.value)} />
          </label>
          <label className="settings-form-wide">
            Standardized service
            <select value={draft.serviceId} onChange={(event) => updateDraft("serviceId", event.target.value)}>
              <option value="">No standardized service</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.label}
                </option>
              ))}
            </select>
          </label>
          {draft.serviceId ? (
            <label>
              Annual invoice year
              <select value={draft.annualYear} onChange={(event) => updateDraft("annualYear", event.target.value)}>
                {annualYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Hours / Qty.
            <input
              inputMode="decimal"
              value={draft.quantityHours}
              onChange={(event) => updateDraft("quantityHours", event.target.value)}
            />
          </label>
          <label>
            Rate / Fee ({currencyCode})
            <input inputMode="decimal" value={draft.unitAmount} onChange={(event) => updateDraft("unitAmount", event.target.value)} />
          </label>
          <label>
            Discount %
            <input inputMode="decimal" value={draft.discount} onChange={(event) => updateDraft("discount", event.target.value)} />
          </label>
          <label>
            Account code
            <input value={draft.accountCode} onChange={(event) => updateDraft("accountCode", event.target.value)} />
          </label>
          <label>
            Tax rate
            {taxRateOptions.length ? (
              <select value={draft.taxType} onChange={(event) => updateDraft("taxType", event.target.value)}>
                <option value="">Select tax rate</option>
                {taxRateOptions.map((taxRate) => (
                  <option key={taxRate.value} value={taxRate.value}>
                    {taxRate.label}
                  </option>
                ))}
              </select>
            ) : (
              <input value={draft.taxType} onChange={(event) => updateDraft("taxType", event.target.value)} />
            )}
          </label>

          {error ? <p className="form-error settings-form-wide">{error}</p> : null}

          <div className="settings-modal-actions">
            <button className="secondary-action-button" disabled={saving} type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-action-button" disabled={saving} type="submit">
              {saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
              Save
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function formatWholeHours(value) {
  return `${wholeNumber.format(value || 0)}h`;
}

function formatEntryCount(value) {
  const count = Number(value || 0);
  return `${count} time ${count === 1 ? "entry" : "entries"}`;
}

function formatQuoteCount(value) {
  const count = Number(value || 0);
  return `${wholeNumber.format(count)} ${count === 1 ? "doc" : "docs"}`;
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatPeriod(startDate, endDate) {
  if (!startDate || !endDate) return "No period";
  const start = String(startDate).slice(0, 10);
  const end = String(endDate).slice(0, 10);
  if (start.endsWith("-01") && monthRange(start.slice(0, 7)).endDate === end) {
    return formatMonthOption(start.slice(0, 7));
  }
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function formatDays(value) {
  if (value === null || value === undefined) return "-";
  const count = Number(value || 0);
  return `${wholeNumber.format(count)} ${count === 1 ? "day" : "days"}`;
}

function roundNumber(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function normalizePercent(value) {
  const normalized = String(value ?? 0).replace("%", "").trim();
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error("Use a discount between 0 and 100%.");
  }
  return number;
}

function normalizeEditableNumber(value, label) {
  const normalized = String(value ?? "").replace(",", ".").trim();
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be zero or more.`);
  }
  return number;
}

function editableNumberDraft(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? String(number) : "0";
}

function quoteLineEditDraft(line = {}) {
  return {
    accountCode: line.accountCode || "",
    annualYear: line.annualYear ? String(line.annualYear) : "",
    comments: line.comments || "",
    description: line.description || "",
    discount: editableNumberDraft(line.discount),
    quantityHours: editableNumberDraft(line.quantityHours),
    serviceId: line.serviceId || "",
    taskName: line.taskName || "",
    taxType: line.taxType || "",
    unitAmount: editableNumberDraft(line.unitAmount)
  };
}

function manualQuoteLineDraft(preview = {}) {
  const billingClient = preview.billingClient || {};
  const defaultAnnualYear = String(new Date().getFullYear() - 1);
  return {
    accountCode: billingClient.accountCode || "70330001",
    amount: 0,
    annualYear: /^\d{4}$/.test(defaultAnnualYear) ? defaultAnnualYear : "",
    comments: "",
    description: "",
    discount: 0,
    entries: [],
    includeInXero: true,
    isBillable: true,
    quantityHours: 1,
    serviceId: "",
    sourceType: "manual",
    taskName: "Manual row",
    taxType: billingClient.taxType || "",
    unitAmount: 0
  };
}

function quoteAnnualYearOptions(preview = {}, line = {}, availableYears = []) {
  const years = new Set(availableYears.map(Number).filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100));
  years.add(new Date().getFullYear() - 1);
  for (const value of [preview?.period?.startDate, preview?.period?.endDate, preview?.quoteDate, line?.annualYear]) {
    const year = Number(String(value || "").slice(0, 4));
    if (Number.isInteger(year) && year >= 2000 && year <= 2100) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

function formatPeopleCount(value) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? "person" : "people"}`;
}

function statusForClient(client) {
  return client.status || (client.active === false ? "inactive" : "active");
}

function statusLabel(value) {
  return clientStatusOptions.find((option) => option.value === value)?.label || "Active";
}

function titleForTab(tab) {
  const titles = {
    "billing-annual-invoices": "Annual Invoices",
    "billing-audit-log": "Audit Log",
    "billing-clients": "Clients",
    "billing-operations": "Operations",
    "billing-create-quote": "Create New",
    "billing-quotes": "Docs",
    "reporting-overview": "Overview",
    "reporting-people": "People",
    "reporting-projects": "Projects"
  };
  return titles[tab] || "Overview";
}

function routeFromHash(hash = "") {
  const [tab = "", draftId = ""] = hash.replace(/^#\/?/, "").split("/");
  return {
    draftId: tab === "billing-create-quote" ? draftId : "",
    tab: activeTabIds.has(tab) ? tab : ""
  };
}

function activeTabFromHash(hash = "") {
  return routeFromHash(hash).tab;
}

function editorSessionId() {
  if (typeof window === "undefined") return "";
  try {
    const current = window.sessionStorage.getItem(editorSessionStorageKey);
    if (current) return current;
    const next = window.crypto.randomUUID();
    window.sessionStorage.setItem(editorSessionStorageKey, next);
    return next;
  } catch {
    return window.crypto.randomUUID();
  }
}

function initialActiveTab() {
  if (typeof window === "undefined") return defaultActiveTab;

  const hashTab = activeTabFromHash(window.location.hash);
  if (hashTab) return hashTab;

  try {
    const storedTab = window.localStorage.getItem(activeTabStorageKey);
    if (activeTabIds.has(storedTab)) return storedTab;
  } catch {
    // Browser storage can be disabled; falling back keeps the app usable.
  }

  return defaultActiveTab;
}

function persistActiveTab(tab, draftId = "") {
  if (typeof window === "undefined" || !activeTabIds.has(tab)) return;

  try {
    window.localStorage.setItem(activeTabStorageKey, tab);
  } catch {
    // Ignore storage failures; the hash still preserves refresh behavior.
  }

  const nextHash = tab === "billing-create-quote" && draftId ? `#${tab}/${draftId}` : `#${tab}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  }
}

function detailCardId(row, scope = "project") {
  return `${scope}-detail-${String(row.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function UserIdentity({ user, meta }) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = user.avatarUrl && !user.avatarUrl.includes("noPhoto") ? user.avatarUrl : "";
  const showImage = avatarUrl && !imageFailed;

  return (
    <div className="user-identity">
      <span className="avatar-circle" aria-hidden="true">
        {showImage ? <img src={avatarUrl} alt="" onError={() => setImageFailed(true)} /> : initials(user.name)}
      </span>
      <span className="identity-copy">
        <strong>{user.name}</strong>
        <span>{meta}</span>
      </span>
    </div>
  );
}

function LoginScreen({ onAuthenticated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      persistActiveTab("billing-quotes");
      onAuthenticated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <BrandLogo className="brand-logo-login" />
        <h1>Reporting for precise client work.</h1>
        <p>
          Time, billed hours, and project value from Teamwork in one focused local dashboard.
        </p>
      </section>

      <form className="login-panel" onSubmit={handleSubmit}>
        <LockKeyhole size={22} />
        <div>
          <h2>Sign in</h2>
          <p>Use your ZIFFER account to manage reporting and billing.</p>
        </div>
        <label>
          Email
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" type="email" />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" disabled={loading} type="submit">
          {loading ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
          Sign in
        </button>
      </form>
    </main>
  );
}

function AccountSettingsModal({ onClose, onSaved, user }) {
  const [displayName, setDisplayName] = useState(user?.displayName || user?.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEscapeToClose(onClose, !saving);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (newPassword && newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const payload = await updateAccount({
        currentPassword,
        displayName,
        newPassword
      });
      onSaved(payload.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="account-settings-title" className="settings-modal account-settings-modal" role="dialog" aria-modal="true">
        <header className="settings-modal-header">
          <div>
            <p>Account</p>
            <h2 id="account-settings-title">Account settings</h2>
            <span>{user?.email || ""}</span>
          </div>
          <button aria-label="Close account settings" className="modal-close-button" disabled={saving} onClick={onClose} type="button">
            <X size={20} />
          </button>
        </header>

        <form className="settings-form" onSubmit={handleSubmit}>
          <label className="settings-form-wide">
            Name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
          </label>
          <label>
            Current password
            <input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="Required to change password"
            />
          </label>
          <label>
            New password
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="form-error settings-form-wide">{error}</p> : null}
          <footer className="settings-modal-actions settings-form-wide">
            <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="primary-action-button" disabled={saving} type="submit">
              {saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
              Save
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PeriodSelector({
  demo,
  monthOptions,
  range,
  refreshLabel,
  refreshTitle,
  refreshing,
  setRange,
  syncStatus,
  onRefresh
}) {
  const selectedMonth = selectedMonthPeriod(range);
  const buttonLabel = refreshLabel || (demo ? "Demo data" : "Sync Teamwork");
  const updateStartDate = (event) => setRange((current) => ({ ...current, startDate: event.target.value }));
  const updateEndDate = (event) => setRange((current) => ({ ...current, endDate: event.target.value }));

  return (
    <div className="period-toolbar">
      <div className="preset-group" aria-label="Period presets">
        <button onClick={() => setRange(lastMonthRange())} type="button">Last month</button>
      </div>
      <label className="month-field">
        <span className="sr-only">Select data month</span>
        <select
          aria-label="Select data month"
          disabled={!monthOptions.length}
          onChange={(event) => {
            if (event.target.value) setRange(monthRange(event.target.value));
          }}
          value={monthOptions.some((option) => option.value === selectedMonth) ? selectedMonth : ""}
        >
          <option disabled={monthOptions.length > 0} hidden={monthOptions.length > 0} value="">
            {monthOptions.length ? "Select month" : "No data months"}
          </option>
          {monthOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="date-field">
        <CalendarDays size={16} />
        <input
          value={range.startDate}
          onChange={updateStartDate}
          onInput={updateStartDate}
          type="date"
        />
      </label>
      <label className="date-field">
        <input
          value={range.endDate}
          onChange={updateEndDate}
          onInput={updateEndDate}
          type="date"
        />
      </label>
      <div className="reporting-sync-control">
        <button
          className="refresh-button"
          disabled={refreshing || demo}
          onClick={onRefresh}
          title={refreshTitle || (demo ? "Demo data is bundled into this Netlify build" : "Sync Teamwork")}
          type="button"
        >
          <RefreshCw className={refreshing ? "spin" : ""} size={17} />
          {buttonLabel}
        </button>
        {syncStatus ? <ReportingSyncStatus status={syncStatus} /> : null}
      </div>
    </div>
  );
}

function syncTimestamp(value, timezone) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: timezone || "Europe/Amsterdam"
  }).format(parsed);
}

function ReportingSyncStatus({ status }) {
  const timezone = status.schedule?.timezone || "Europe/Amsterdam";
  const lastSuccess = status.lastSuccess;
  const lastAttempt = status.lastScheduledAttempt;
  const failedAfterSuccess = lastAttempt?.status === "failed"
    && (!lastSuccess?.finishedAt || new Date(lastAttempt.startedAt) > new Date(lastSuccess.finishedAt));

  if (failedAfterSuccess) {
    return (
      <span className="reporting-sync-status reporting-sync-status-error" role="status">
        Nightly sync failed {syncTimestamp(lastAttempt.finishedAt || lastAttempt.startedAt, timezone)}.
        {lastSuccess?.finishedAt ? ` Last success ${syncTimestamp(lastSuccess.finishedAt, timezone)}.` : ""}
      </span>
    );
  }

  if (lastSuccess?.finishedAt) {
    return (
      <span className="reporting-sync-status" role="status">
        Last synced {syncTimestamp(lastSuccess.finishedAt, timezone)} - daily at {status.schedule?.time || "00:00"}
      </span>
    );
  }

  return (
    <span className="reporting-sync-status" role="status">
      Scheduled daily at {status.schedule?.time || "00:00"}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, detail }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function Overview({ report }) {
  const totals = report?.totals || {};
  const byProject = report?.byProject || [];
  const byUser = report?.byUser || [];
  const yearTrend = report?.yearTrend || [];
  const chartYear = yearTrend[0]?.year || report?.period?.endDate?.slice(0, 4) || "";

  return (
    <>
      <section className="metric-grid">
        <MetricCard icon={Clock3} label="Total hours" value={formatWholeHours(totals.hours)} detail="All internal time" />
        <MetricCard
          icon={Clock3}
          label="Billable hours"
          value={formatWholeHours(totals.billableHours)}
          detail={`${totals.billablePercent || 0}% billable`}
        />
        <MetricCard
          icon={BarChart3}
          label="Billable share"
          value={`${totals.billablePercent || 0}%`}
          detail="Billable over total"
        />
        <MetricCard icon={Euro} label="Amounts" value={currency.format(totals.money || 0)} detail="Person-rate amount" />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p>Year overview</p>
              <h2>Billable by month</h2>
            </div>
            <span>{chartYear}</span>
          </div>
          <ResponsiveContainer height={280} width="100%">
            <BarChart data={yearTrend} margin={{ bottom: 0, left: 0, right: 18, top: 14 }}>
              <CartesianGrid stroke="#e6e1da" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#606060", fontSize: 12 }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#606060", fontSize: 12 }}
                tickFormatter={(value) => compactCurrency.format(value)}
              />
              <Tooltip
                contentStyle={{ border: "1px solid #dfd8c8", borderRadius: 8 }}
                formatter={(value) => [currency.format(value), "Billable"]}
                labelFormatter={(label) => `${label} ${chartYear}`}
              />
              <Bar
                dataKey="money"
                fill="#4f959e"
                isAnimationActive={false}
                name="Billable"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </section>

      <section className="two-column">
        <DataTable title="Top projects" rows={byProject.slice(0, 7)} mode="projects" />
        <DataTable title="Top people" rows={byUser.slice(0, 7)} mode="users" />
      </section>
    </>
  );
}

function DataTable({ mode, rows, title }) {
  const isUsers = mode === "users";
  const [expandedRowId, setExpandedRowId] = useState("");

  useEffect(() => {
    if (expandedRowId && !rows.some((row) => row.id === expandedRowId)) {
      setExpandedRowId("");
    }
  }, [expandedRowId, rows]);

  return (
    <article className="panel table-panel">
      <div className="panel-heading">
        <div>
          <p>{isUsers ? "People" : "Projects"}</p>
          <h2>{title}</h2>
        </div>
        <span>{rows.length} shown</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{mode === "users" ? "Person" : "Project"}</th>
              <th>Total</th>
              <th>Unbillable</th>
              <th>Billable</th>
              <th>Billable %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const detailScope = isUsers ? "person" : "project";
              const expanded = expandedRowId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className={`drilldown-table-row ${expanded ? "expanded" : ""}`}>
                    <td>
                      <button
                        aria-controls={detailCardId(row, detailScope)}
                        aria-expanded={expanded}
                        className="project-row-button"
                        onClick={() => setExpandedRowId(expanded ? "" : row.id)}
                        type="button"
                      >
                        {isUsers ? (
                          <UserIdentity user={row} meta={`${row.projectCount || 0} projects`} />
                        ) : (
                          <>
                            <strong>{row.name}</strong>
                            <span>{`${formatPeopleCount(row.userCount)} | ${formatEntryCount(row.entryCount)}`}</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td><MetricStack metric={metricFromTotals(row.totals, "all")} /></td>
                    <td><MetricStack metric={metricFromTotals(row.totals, "unbillable")} /></td>
                    <td><MetricStack metric={metricFromTotals(row.totals)} /></td>
                    <td>{row.totals.billablePercent}%</td>
                  </tr>
                  {expanded ? (
                    <tr className="project-detail-row overview-detail-row">
                      <td colSpan="5">
                        {isUsers ? <PersonProjectsCard person={row} /> : <ProjectPeopleCard project={row} />}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan="5" className="empty-cell">No rows for this period.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ReportingAmountChart({ entityLabel, rows }) {
  const chartRows = useMemo(
    () =>
      rows
        .filter((row) => row.totals.money > 0)
        .slice(0, 12)
        .map((row) => ({
          amount: row.totals.money,
          id: row.id,
          name: row.name
        })),
    [rows]
  );
  const chartHeight = Math.max(250, Math.min(460, chartRows.length * 38 + 54));
  const pluralLabel = entityLabel === "person" ? "people" : "projects";

  return (
    <div className="reporting-amount-chart">
      <div className="reporting-chart-heading">
        <div>
          <p>{`Amounts by ${entityLabel}`}</p>
          <h3>Top billable amounts</h3>
        </div>
        <span>{chartRows.length ? `${chartRows.length} ${pluralLabel} shown` : "No amounts"}</span>
      </div>
      {chartRows.length ? (
        <ResponsiveContainer height={chartHeight} width="100%">
          <BarChart data={chartRows} layout="vertical" margin={{ bottom: 8, left: 8, right: 28, top: 8 }}>
            <CartesianGrid horizontal={false} stroke="#e6e1da" />
            <XAxis
              axisLine={false}
              tick={{ fill: "#606060", fontSize: 12 }}
              tickFormatter={(value) => compactCurrency.format(value)}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="name"
              tick={{ fill: "#292620", fontSize: 12 }}
              tickLine={false}
              type="category"
              width={150}
            />
            <Tooltip
              contentStyle={{ border: "1px solid #dfd8c8", borderRadius: 8 }}
              formatter={(value) => [currency.format(value), "Amount"]}
            />
            <Bar dataKey="amount" fill="#4f959e" isAnimationActive={false} name="Amount" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty-chart">No billable amounts for this period.</div>
      )}
    </div>
  );
}

function PeopleView({ rows }) {
  const [query, setQuery] = useState("");
  const { aggregateSortKey, dataMode, setAggregateSortKey, setDataMode, setTeamworkSortKey, teamworkSortKey } =
    useReportingPreferences("people");
  const sortKey = dataMode === "aggregate" ? aggregateSortKey : teamworkSortKey;
  const setSortKey = dataMode === "aggregate" ? setAggregateSortKey : setTeamworkSortKey;
  const visibleRows = useMemo(
    () =>
      sortReportingRows(
        rows.filter((row) => String(row.name || "").toLowerCase().includes(query.trim().toLowerCase())),
        dataMode,
        sortKey
      ),
    [dataMode, query, rows, sortKey]
  );

  return (
    <>
      <section className="panel full-panel">
        <div className="table-toolbar reporting-table-toolbar">
          <div className="toolbar-actions">
            <ReportingDataModeToggle value={dataMode} onChange={setDataMode} />
            <ReportingSortSelect dataMode={dataMode} label="Sort people" onChange={setSortKey} value={sortKey} />
            <label className="search-field">
              <Search size={16} />
              <input placeholder="Search people" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>
        </div>
        <DetailTable rows={visibleRows} type="users" dataMode={dataMode} />
      </section>
      <article className="panel reporting-chart-panel">
        <ReportingAmountChart rows={rows} entityLabel="person" />
      </article>
    </>
  );
}

function ProjectsView({ rows }) {
  const [query, setQuery] = useState("");
  const { aggregateSortKey, dataMode, setAggregateSortKey, setDataMode, setTeamworkSortKey, teamworkSortKey } =
    useReportingPreferences("projects");
  const sortKey = dataMode === "aggregate" ? aggregateSortKey : teamworkSortKey;
  const setSortKey = dataMode === "aggregate" ? setAggregateSortKey : setTeamworkSortKey;
  const visibleRows = useMemo(
    () =>
      sortReportingRows(
        rows.filter((row) => String(row.name || "").toLowerCase().includes(query.trim().toLowerCase())),
        dataMode,
        sortKey
      ),
    [dataMode, query, rows, sortKey]
  );

  return (
    <>
      <section className="panel full-panel">
        <div className="table-toolbar reporting-table-toolbar">
          <div className="toolbar-actions">
            <ReportingDataModeToggle value={dataMode} onChange={setDataMode} />
            <ReportingSortSelect dataMode={dataMode} label="Sort projects" onChange={setSortKey} value={sortKey} />
            <label className="search-field">
              <Search size={16} />
              <input placeholder="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>
        </div>
        <DetailTable rows={visibleRows} type="clients" dataMode={dataMode} />
      </section>
      <article className="panel reporting-chart-panel">
        <ReportingAmountChart rows={rows} entityLabel="project" />
      </article>
    </>
  );
}

function ProjectPeopleCard({ dataMode = "teamwork", project }) {
  const people = project.peopleBreakdown || [];
  const isAggregate = dataMode === "aggregate";

  return (
    <article className="project-people-card" id={detailCardId(project)}>
      <div className="project-people-card-heading">
        <div>
          <p>People involved</p>
          <h3>{project.name}</h3>
        </div>
        <span>{`${people.length} ${people.length === 1 ? "person" : "people"}`}</span>
      </div>
      {people.length ? (
        <div className="project-people-table-wrap">
          <table className={`project-people-table ${isAggregate ? "project-people-table--aggregate" : ""}`}>
            <thead>
              <tr>
                <th>Person</th>
                {isAggregate ? (
                  <>
                    <th>Teamwork estimate</th>
                    <th>Excluding pre-paid</th>
                    <th>Sent to Xero</th>
                    <th>Paid in Xero</th>
                  </>
                ) : (
                  <>
                    <th>Total</th>
                    <th>Unbillable</th>
                    <th>Billable</th>
                    <th>Billable %</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>
                    <UserIdentity user={person} meta={formatEntryCount(person.entryCount)} />
                  </td>
                  {isAggregate ? (
                    <>
                      <td><MetricStack metric={metricFromAggregate(person, "teamworkEstimate")} /></td>
                      <td><MetricStack metric={metricFromAggregate(person, "excludingPrepaid")} /></td>
                      <td><MetricStack metric={metricFromAggregate(person, "sentToXero")} /></td>
                      <td><MetricStack metric={metricFromAggregate(person, "paidInXero")} /></td>
                    </>
                  ) : (
                    <>
                      <td><MetricStack metric={metricFromTotals(person.totals, "all")} /></td>
                      <td><MetricStack metric={metricFromTotals(person.totals, "unbillable")} /></td>
                      <td><MetricStack metric={metricFromTotals(person.totals)} /></td>
                      <td>{person.totals.billablePercent}%</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-chart">No people for this period.</div>
      )}
    </article>
  );
}

function PersonProjectsCard({ dataMode = "teamwork", person }) {
  const projects = person.projectBreakdown || [];
  const isAggregate = dataMode === "aggregate";

  return (
    <article className="project-people-card" id={detailCardId(person, "person")}>
      <div className="project-people-card-heading">
        <div>
          <p>Projects worked on</p>
          <h3>{person.name}</h3>
        </div>
        <span>{`${projects.length} ${projects.length === 1 ? "project" : "projects"}`}</span>
      </div>
      {projects.length ? (
        <div className="project-people-table-wrap">
          <table className={`project-people-table ${isAggregate ? "project-people-table--aggregate" : ""}`}>
            <thead>
              <tr>
                <th>Project</th>
                {isAggregate ? (
                  <>
                    <th>Teamwork estimate</th>
                    <th>Excluding pre-paid</th>
                    <th>Sent to Xero</th>
                    <th>Paid in Xero</th>
                  </>
                ) : (
                  <>
                    <th>Total</th>
                    <th>Unbillable</th>
                    <th>Billable</th>
                    <th>Billable %</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <div className="project-breakdown-name">
                      <strong>{project.name}</strong>
                      <span>{formatEntryCount(project.entryCount)}</span>
                    </div>
                  </td>
                  {isAggregate ? (
                    <>
                      <td><MetricStack metric={metricFromAggregate(project, "teamworkEstimate")} /></td>
                      <td><MetricStack metric={metricFromAggregate(project, "excludingPrepaid")} /></td>
                      <td><MetricStack metric={metricFromAggregate(project, "sentToXero")} /></td>
                      <td><MetricStack metric={metricFromAggregate(project, "paidInXero")} /></td>
                    </>
                  ) : (
                    <>
                      <td><MetricStack metric={metricFromTotals(project.totals, "all")} /></td>
                      <td><MetricStack metric={metricFromTotals(project.totals, "unbillable")} /></td>
                      <td><MetricStack metric={metricFromTotals(project.totals)} /></td>
                      <td>{project.totals.billablePercent}%</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-chart">No projects for this period.</div>
      )}
    </article>
  );
}

function DetailTable({ dataMode = "teamwork", rows, type }) {
  const isUsers = type === "users";
  const isAggregate = dataMode === "aggregate";
  const colSpan = 6;
  const [expandedRowId, setExpandedRowId] = useState("");

  useEffect(() => {
    if (expandedRowId && !rows.some((row) => row.id === expandedRowId)) {
      setExpandedRowId("");
    }
  }, [expandedRowId, rows]);

  return (
    <div className="table-wrap">
      <table className={`detail-table ${isAggregate ? "detail-table--aggregate" : ""}`}>
        <thead>
          <tr>
            <th>{isUsers ? "Person" : "Project"}</th>
            <th>{isUsers ? "Projects" : "People"}</th>
            {isAggregate ? (
              <>
                <th>Teamwork estimate</th>
                <th>Excluding pre-paid</th>
                <th>Sent to Xero</th>
                <th>Paid in Xero</th>
              </>
            ) : (
              <>
                <th>Total</th>
                <th>Unbillable</th>
                <th>Billable</th>
                <th>Billable %</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedRowId === row.id;
            const detailScope = isUsers ? "person" : "project";
            return (
              <Fragment key={row.id}>
                <tr className={`drilldown-table-row ${expanded ? "expanded" : ""}`}>
                  <td>
                    {isUsers ? (
                      <button
                        aria-controls={detailCardId(row, detailScope)}
                        aria-expanded={expanded}
                        className="project-row-button"
                        onClick={() => setExpandedRowId(expanded ? "" : row.id)}
                        type="button"
                      >
                        <UserIdentity user={row} meta={row.email} />
                      </button>
                    ) : (
                      <button
                        aria-controls={detailCardId(row, detailScope)}
                        aria-expanded={expanded}
                        className="project-row-button"
                        onClick={() => setExpandedRowId(expanded ? "" : row.id)}
                        type="button"
                      >
                        <strong>{row.name}</strong>
                        <span>{formatEntryCount(row.entryCount)}</span>
                      </button>
                    )}
                  </td>
                  <td>{isUsers ? row.projectCount || 0 : row.userCount || 0}</td>
                  {isAggregate ? (
                    <>
                      <td><MetricStack metric={metricFromAggregate(row, "teamworkEstimate")} /></td>
                      <td><MetricStack metric={metricFromAggregate(row, "excludingPrepaid")} /></td>
                      <td><MetricStack metric={metricFromAggregate(row, "sentToXero")} /></td>
                      <td><MetricStack metric={metricFromAggregate(row, "paidInXero")} /></td>
                    </>
                  ) : (
                    <>
                      <td><MetricStack metric={metricFromTotals(row.totals, "all")} /></td>
                      <td><MetricStack metric={metricFromTotals(row.totals, "unbillable")} /></td>
                      <td><MetricStack metric={metricFromTotals(row.totals)} /></td>
                      <td>{row.totals.billablePercent}%</td>
                    </>
                  )}
                </tr>
                {expanded ? (
                  <tr className="project-detail-row">
                    <td colSpan={colSpan}>
                      {isUsers ? (
                        <PersonProjectsCard person={row} dataMode={dataMode} />
                      ) : (
                        <ProjectPeopleCard project={row} dataMode={dataMode} />
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={colSpan} className="empty-cell">No rows for this period.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function quoteStatusClass(status) {
  if (status === "mock_paid") return "paid";
  if (status === "mock_open") return "open";
  return String(status || "prepared").toLowerCase();
}

function quoteClientFilterValue(quote) {
  return quote.billingClientId || quote.clientName || "unknown-client";
}

function quoteStatusFilterValue(quote) {
  return quote.status || "unknown-status";
}

function formatJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function formattedDateTime(value) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function documentEntryComment(entry, line) {
  if (entry.annualCovered || line.annualCovered) return "pre-paid";
  if (entry.isBillable === false) return "Marked unbillable";
  return entry.comment || entry.comments || "";
}

function documentLineComment(line) {
  if (line.annualCovered) return <span className="annual-coverage-badge">pre-paid</span>;
  if (Array.isArray(line.annualBilling) && line.annualBilling.length > 0) {
    return <span className="annual-coverage-badge annual-coverage-badge--overflow">overflow</span>;
  }
  return line.comments || "";
}

function DocumentSentLinesTable({ currencyCode = "EUR", lines = [] }) {
  const [openLineKeys, setOpenLineKeys] = useState(() => new Set());

  useEffect(() => {
    setOpenLineKeys(new Set(lines.map((line) => quoteLineKey(line))));
  }, [lines]);

  function toggleLine(line) {
    const key = quoteLineKey(line);
    setOpenLineKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="document-lines-section" aria-label="Rows sent to Xero">
      <div className="document-section-heading">
        <h3>Rows sent to Xero</h3>
        <span>{formatEntryCount(lines.reduce((sum, line) => sum + (line.entries || []).length, 0))}</span>
      </div>
      <div className="table-wrap quote-table-wrap document-lines-wrap">
        <table className="quote-lines-table">
          <thead>
            <tr>
              <th>Comment</th>
              <th>Task name</th>
              <th>Hours</th>
              <th>Rate</th>
              <th>Discount</th>
              <th>Amount</th>
              <th className="quote-action-header" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const key = quoteLineKey(line);
              const entries = line.entries || [];
              const isOpen = openLineKeys.has(key);
              return (
                <Fragment key={key}>
                  <tr className="quote-task-row">
                    <td className="quote-comment-cell">{documentLineComment(line)}</td>
                    <td className="quote-task-cell">
                      <button
                        aria-expanded={isOpen}
                        className="quote-task-toggle"
                        onClick={() => toggleLine(line)}
                        type="button"
                      >
                        <ChevronDown className="nav-chevron" size={16} />
                        <span>
                          <strong>{line.taskName || line.description || "No task"}</strong>
                          <small>{formatEntryCount(entries.length || line.sourceTimeEntryIds?.length || 0)}</small>
                        </span>
                      </button>
                    </td>
                    <td>{formatHours(line.quantityHours)}</td>
                    <td>{formatCurrencyAmount(line.unitAmount, currencyCode)}</td>
                    <td>{decimal.format(line.discount || 0)}</td>
                    <td>{formatCurrencyAmount(line.amount, currencyCode)}</td>
                    <td aria-hidden="true" />
                  </tr>
                  {isOpen ? (
                    <>
                      <tr className="quote-entry-header-row">
                        <td className="quote-entry-comment-header">Comment</td>
                        <td>
                          <div className="quote-entry-labels">
                            <span>Person</span>
                            <span>Description</span>
                          </div>
                        </td>
                        <td>Time</td>
                        <td>Rate</td>
                        <td aria-hidden="true" />
                        <td aria-hidden="true" />
                        <td className="quote-action-header" aria-hidden="true" />
                      </tr>
                      {entries.map((entry) => (
                        <tr className="quote-entry-row" key={`${key}:${entry.id}`}>
                          <td className="quote-entry-comment-cell">{documentEntryComment(entry, line)}</td>
                          <td>
                            <div className="quote-entry-fields">
                              <strong>{entry.userName || "Unknown person"}</strong>
                              <span>{entry.description || <span className="muted-text">No description</span>}</span>
                            </div>
                          </td>
                          <td>{formatHours(entry.hours)}</td>
                          <td>{formatCurrencyAmount(entry.userRate, currencyCode)}</td>
                          <td aria-hidden="true" />
                          <td aria-hidden="true" />
                          <td aria-hidden="true" />
                        </tr>
                      ))}
                      {!entries.length ? (
                        <tr className="quote-entry-row quote-entry-row--empty">
                          <td className="quote-entry-comment-cell" />
                          <td className="empty-cell" colSpan="6">No source time entries.</td>
                        </tr>
                      ) : null}
                    </>
                  ) : null}
                </Fragment>
              );
            })}
            {!lines.length ? (
              <tr>
                <td className="empty-cell" colSpan="7">No rows were sent to Xero for this document.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BillingDocumentDetailModal({ detail, error, loading, onClose, onRefreshStatus, refreshingStatus }) {
  const quote = detail?.quote || null;
  const lines = detail?.lines || [];
  const payload = detail?.payload || {};
  const latestResponse = detail?.latestResponse || {};
  const logs = detail?.logs || [];
  useEscapeToClose(onClose);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal document-detail-modal" aria-modal="true" role="dialog">
        <header className="settings-modal-header">
          <div>
            <p>Document detail</p>
            <h2>{quote?.quoteNumber || "Document"}</h2>
            {quote ? (
              <span>
                {quote.documentLabel} | {quote.clientName} | {quote.statusLabel}
              </span>
            ) : null}
          </div>
          <button aria-label="Close document detail" className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        {loading ? (
          <div className="loading-state inline-loading">
            <Loader2 className="spin" size={20} />
            <span>Loading document detail</span>
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        {quote && !loading ? (
          <Fragment>
            <div className="document-detail-summary">
              <ClientStatsCard label="Xero Status" value={quote.statusLabel} detail={quote.xeroStatusMessage || ""} />
              <ClientStatsCard label="Sent to Xero" value={formatCurrencyAmount(quote.amountSentToXero)} />
              <ClientStatsCard label="Paid in Xero" value={formatCurrencyAmount(quote.amountPaidInXero)} />
              <ClientStatsCard label="Last status sync" value={formattedDateTime(quote.xeroStatusSyncedAt)} />
            </div>

            <div className="document-detail-actions">
              <button className="secondary-button" disabled={refreshingStatus} onClick={onRefreshStatus} type="button">
                {refreshingStatus ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
                Refresh Xero status
              </button>
            </div>

            <DocumentSentLinesTable lines={lines} />

            <details className="document-technical-details">
              <summary>Technical Xero data</summary>
              <div className="document-payload-grid">
                <section>
                  <h3>Payload sent to Xero</h3>
                  <pre>{formatJson(payload)}</pre>
                </section>
                <section>
                  <h3>Latest Xero response</h3>
                  <pre>{formatJson(latestResponse)}</pre>
                </section>
              </div>
            </details>

            <section className="document-log-list" aria-label="Xero sync logs">
              <h3>Xero sync logs</h3>
              {logs.map((log) => (
                <article key={log.id}>
                  <strong>{log.action}</strong>
                  <span>{log.status} | {formattedDateTime(log.createdAt)}</span>
                  {log.message ? <p>{log.message}</p> : null}
                </article>
              ))}
              {!logs.length ? <p>No Xero sync logs yet.</p> : null}
            </section>
          </Fragment>
        ) : null}
      </section>
    </div>
  );
}

function DraftLedgerPanel({ archived = false, onOpen, onRestore, rows = [] }) {
  return (
    <section className="panel full-panel quotes-panel draft-ledger-panel">
      <div className="table-toolbar">
        <div className="table-toolbar-heading">
          <p>Billing</p>
          <h2>{archived ? "Archived" : "Drafts"}</h2>
        </div>
        <span className="draft-count">{wholeNumber.format(rows.length)} {rows.length === 1 ? "draft" : "drafts"}</span>
      </div>
      <div className="table-wrap">
        <table className="quotes-table draft-ledger-table">
          <thead>
            <tr>
              <th>Document</th><th>Client</th><th>Period</th><th>Amount</th>
              <th>{archived ? "Archived" : "Last editor"}</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((draft) => (
              <tr key={draft.id}>
                <td>
                  <button className="quote-document-link" onClick={() => onOpen?.(draft)} type="button">{draft.quoteNumber || "Untitled draft"}</button>
                  <span className="draft-document-type">{xeroDocumentTypeLabel(draft.documentType)}</span>
                </td>
                <td>{draft.clientName}</td>
                <td>{formatPeriod(draft.period?.startDate, draft.period?.endDate)}</td>
                <td>{formatCurrencyAmount(draft.totals?.amount || 0)}</td>
                <td>{archived ? formattedDateTime(draft.archivedAt) : draft.lastEditedBy}</td>
                <td>
                  {archived ? (
                    <button className="secondary-button compact-button" onClick={() => onRestore?.(draft)} type="button">Restore</button>
                  ) : draft.lock?.ownedBySession ? (
                    <span className="status-pill active">You are editing</span>
                  ) : draft.lock ? (
                    <span className="status-pill draft-lock-pill"><LockKeyhole size={13} /> {draft.lock.editorName}</span>
                  ) : (
                    <span className="status-pill active">Available</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? <tr><td className="empty-cell" colSpan="6">{archived ? "No archived drafts." : "No active drafts."}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ArchivedDraftModal({ error, loading, onClose, preview }) {
  useEscapeToClose(onClose);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal document-detail-modal" aria-modal="true" role="dialog">
        <header className="settings-modal-header">
          <div>
            <p>Archived draft</p>
            <h2>{preview?.quoteNumber || "Draft"}</h2>
            {preview ? <span>{preview.billingClient?.displayName} | {formatPeriod(preview.period?.startDate, preview.period?.endDate)}</span> : null}
          </div>
          <button aria-label="Close archived draft" className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        {loading ? <div className="loading-state inline-loading"><Loader2 className="spin" size={20} /><span>Loading archived draft</span></div> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {preview && !loading ? (
          <Fragment>
            <div className="document-detail-summary">
              <ClientStatsCard label="Amount" value={formatCurrencyAmount(preview.totals?.amount || 0, preview.currency)} />
              <ClientStatsCard label="Hours" value={formatHours(preview.totals?.totalHours || 0)} />
              <ClientStatsCard label="Lines" value={wholeNumber.format(preview.lines?.length || 0)} />
              <ClientStatsCard label="Last saved" value={formattedDateTime(preview.updatedAt)} />
            </div>
            <DocumentSentLinesTable currencyCode={preview.currency} lines={preview.lines || []} />
          </Fragment>
        ) : null}
      </section>
    </div>
  );
}

function BillingQuotesView({ archivedDrafts = [], drafts = [], loading, onOpenDraft, onRefresh, onRestoreDraft, quotes }) {
  const rows = quotes || [];
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [archivedPreview, setArchivedPreview] = useState(null);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const clientOptions = useMemo(() => {
    const options = new Map();

    for (const quote of rows) {
      const value = quoteClientFilterValue(quote);
      if (!options.has(value)) options.set(value, quote.clientName || "Unknown client");
    }

    return [...options.entries()]
      .map(([value, label]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);
  const statusOptions = useMemo(() => {
    const options = new Map();

    for (const quote of rows) {
      const value = quoteStatusFilterValue(quote);
      if (!options.has(value)) options.set(value, quote.statusLabel || value);
    }

    return [...options.entries()]
      .map(([value, label]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  useEffect(() => {
    if (clientFilter !== "all" && !clientOptions.some((option) => option.value === clientFilter)) {
      setClientFilter("all");
    }
  }, [clientFilter, clientOptions]);

  useEffect(() => {
    if (statusFilter !== "all" && !statusOptions.some((option) => option.value === statusFilter)) {
      setStatusFilter("all");
    }
  }, [statusFilter, statusOptions]);

  const filteredRows = useMemo(
    () =>
      rows.filter((quote) => {
        const matchesClient = clientFilter === "all" || quoteClientFilterValue(quote) === clientFilter;
        const matchesStatus = statusFilter === "all" || quoteStatusFilterValue(quote) === statusFilter;
        return matchesClient && matchesStatus;
      }),
    [clientFilter, rows, statusFilter]
  );
  const totals = useMemo(() => summarizeQuoteRows(filteredRows), [filteredRows]);

  async function openDocumentDetail(quote) {
    setSelectedQuoteId(quote.id);
    setSelectedDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      setSelectedDetail(await getBillingQuoteDetail(quote.id));
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshSelectedStatus() {
    if (!selectedQuoteId) return;
    setRefreshingStatus(true);
    setDetailError("");
    try {
      await syncBillingQuoteXeroStatus(selectedQuoteId);
      setSelectedDetail(await getBillingQuoteDetail(selectedQuoteId));
      await onRefresh?.();
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setRefreshingStatus(false);
    }
  }

  async function openDraft(draft) {
    setDraftMessage("");
    if (draft.lock && !draft.lock.ownedBySession) {
      setDraftMessage(`This draft is currently being edited by ${draft.lock.editorName}. It can be opened after ${formattedDateTime(draft.lock.expiresAt)}.`);
      return;
    }
    try {
      await onOpenDraft?.(draft);
    } catch (error) {
      setDraftMessage(error.message);
    }
  }

  async function openArchivedDraft(draft) {
    setArchivedPreview(null);
    setArchivedError("");
    setArchivedLoading(true);
    try {
      const payload = await getArchivedQuoteDraft(draft.id);
      setArchivedPreview(payload.preview || null);
    } catch (error) {
      setArchivedError(error.message);
    } finally {
      setArchivedLoading(false);
    }
  }

  return (
    <Fragment>
      <div className="client-stat-grid docs-stat-grid" aria-label="Document ledger summary">
        <ClientStatsCard label="Sent docs" value={wholeNumber.format(totals.totalQuotes || 0)} />
        <ClientStatsCard
          label="Average paid within"
          value={formatDays(totals.avgPaidWithinDays)}
        />
        <ClientStatsCard label="Sent to Xero" value={formatCurrencyAmount(totals.totalSentAmount || 0)} />
        <ClientStatsCard
          detail={`${formatCurrencyAmount(totals.outstandingAmount || 0)} outstanding`}
          label="Paid in Xero"
          value={formatCurrencyAmount(totals.totalPaidAmount || 0)}
        />
        <ClientStatsCard label="Teamwork estimate" value={formatCurrencyAmount(totals.totalTeamworkEstimate || 0)} />
      </div>

      {draftMessage ? <div className="error-banner">{draftMessage}</div> : null}

      <section className="panel full-panel quotes-panel">
        <div className="table-toolbar">
          <div className="table-toolbar-heading">
            <p>Billing</p>
            <h2>Docs</h2>
          </div>
          <div className="docs-filter-group" aria-label="Document filters">
            <label>
              <span>Client</span>
              <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
                <option value="all">All clients</option>
                {clientOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Xero Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="table-wrap">
          <table className="quotes-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Client</th>
                <th>Teamwork estimate</th>
                <th>Excluding pre-paid</th>
                <th>Sent to Xero</th>
                <th>Paid in Xero</th>
                <th>Paid within</th>
                <th>Xero Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((quote) => (
                <tr key={quote.id}>
                  <td>
                    <div className="quote-ledger-primary">
                      <button className="quote-document-link" onClick={() => openDocumentDetail(quote)} type="button">
                        {quote.quoteNumber}
                      </button>
                      <span>
                        {quote.documentLabel || "Draft quote"} | {quote.reference || formatPeriod(quote.periodStart, quote.periodEnd)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="quote-ledger-primary">
                      <strong>{quote.clientName}</strong>
                      <span>{quote.xeroStatusSyncedAt ? `Checked ${formattedDateTime(quote.xeroStatusSyncedAt)}` : "Not checked yet"}</span>
                    </div>
                  </td>
                  <td>{formatCurrencyAmount(quote.initialTeamworkEstimate)}</td>
                  <td>{formatCurrencyAmount(quote.teamworkAfterAnnual)}</td>
                  <td>{formatCurrencyAmount(quote.amountSentToXero)}</td>
                  <td>{formatCurrencyAmount(quote.amountPaidInXero)}</td>
                  <td>{formatDays(quote.paidWithinDays)}</td>
                  <td>
                    <span className={`status-pill quote-status-pill ${quoteStatusClass(quote.status)}`}>
                      {quote.statusLabel}
                    </span>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr>
                  <td className="empty-cell" colSpan="8">
                    {loading ? "Loading docs." : "No docs match these filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <DraftLedgerPanel onOpen={openDraft} rows={drafts} />
      <DraftLedgerPanel archived onOpen={openArchivedDraft} onRestore={onRestoreDraft} rows={archivedDrafts} />

      {selectedQuoteId ? (
        <BillingDocumentDetailModal
          detail={selectedDetail}
          error={detailError}
          loading={detailLoading}
          refreshingStatus={refreshingStatus}
          onClose={() => {
            setSelectedQuoteId("");
            setSelectedDetail(null);
            setDetailError("");
          }}
          onRefreshStatus={refreshSelectedStatus}
        />
      ) : null}
      {archivedPreview || archivedLoading || archivedError ? (
        <ArchivedDraftModal
          error={archivedError}
          loading={archivedLoading}
          onClose={() => {
            setArchivedPreview(null);
            setArchivedError("");
            setArchivedLoading(false);
          }}
          preview={archivedPreview}
        />
      ) : null}
    </Fragment>
  );
}

function BillingPlaceholder() {
  return (
    <section className="panel full-panel billing-placeholder">
      <div className="panel-heading">
        <div>
          <p>Billing</p>
          <h2>Docs</h2>
        </div>
      </div>
      <div className="empty-chart">No docs yet.</div>
    </section>
  );
}

function warningTone(warning) {
  return warning.severity === "danger" ? "danger" : "warning";
}

function quoteLineKey(line) {
  return line.id || `${line.lineOrder}-${line.description}`;
}

function clientOptionKey(client) {
  return `${client.displayName || ""} ${client.xeroClientName || ""}`.toLowerCase();
}

function BillingCreateQuoteView({
  annualYears = [],
  clients,
  editorSession,
  loading,
  onArchive,
  onSaveControllerChange,
  onPreviewChange,
  onPreviewCreated,
  preview,
  xeroTaxRates = []
}) {
  const defaultRange = useMemo(() => lastMonthRange(), []);
  const activeClients = useMemo(
    () => clients.filter((client) => statusForClient(client) === "active"),
    [clients]
  );
  const [billingClientId, setBillingClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const selectedClient = useMemo(
    () => activeClients.find((client) => client.id === billingClientId) || null,
    [activeClients, billingClientId]
  );
  const filteredClients = useMemo(() => {
    const query = clientQuery.trim().toLowerCase();
    const matches = query
      ? activeClients.filter((client) => clientOptionKey(client).includes(query))
      : activeClients;
    return matches.slice(0, 12);
  }, [activeClients, clientQuery]);
  const clientQueryMatchesSelection = Boolean(selectedClient && clientQuery === selectedClient.displayName);

  useEffect(() => {
    if (!activeClients.length) {
      setBillingClientId("");
      setClientQuery("");
      return;
    }

    const currentClient = activeClients.find((client) => client.id === billingClientId);
    const nextClient = currentClient || activeClients[0];
    if (!currentClient) {
      setBillingClientId(nextClient.id);
    }
    if (!clientPickerOpen) {
      setClientQuery(nextClient.displayName);
    }
  }, [activeClients, billingClientId, clientPickerOpen]);

  function selectClient(client) {
    setBillingClientId(client.id);
    setClientQuery(client.displayName);
    setClientPickerOpen(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!billingClientId || !clientQueryMatchesSelection) return;
    setGenerating(true);
    setError("");
    try {
      const payload = await createQuotePreview({
        billingClientId,
        documentType: "draft_invoice",
        editorSessionId: editorSession,
        endDate,
        startDate
      });
      onPreviewChange?.(payload.preview);
      onPreviewCreated?.(payload.preview);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Fragment>
      <section className="panel full-panel quote-builder-panel">
        <form className="quote-controls" onSubmit={handleSubmit}>
          <div className="quote-client-field">
            <span className="field-label">Client</span>
            <div
              className="client-picker"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setClientPickerOpen(false);
                  if (selectedClient) setClientQuery(selectedClient.displayName);
                }
              }}
            >
              <Search aria-hidden="true" size={16} />
              <input
                aria-autocomplete="list"
                aria-controls="quote-client-options"
                aria-expanded={clientPickerOpen}
                aria-label="Search clients"
                autoComplete="off"
                disabled={loading || generating}
                placeholder={loading ? "Loading clients" : "Search clients"}
                role="combobox"
                type="text"
                value={clientQuery}
                onChange={(event) => {
                  setClientQuery(event.target.value);
                  setClientPickerOpen(true);
                }}
                onFocus={() => setClientPickerOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setClientPickerOpen(false);
                    if (selectedClient) setClientQuery(selectedClient.displayName);
                  }
                  if (event.key === "Enter" && clientPickerOpen && filteredClients.length) {
                    event.preventDefault();
                    selectClient(filteredClients[0]);
                  }
                }}
              />
              {clientPickerOpen && !loading ? (
                <div className="client-picker-menu" id="quote-client-options" role="listbox">
                  {filteredClients.map((client) => (
                    <button
                      aria-selected={client.id === billingClientId && clientQueryMatchesSelection}
                      key={client.id}
                      role="option"
                      type="button"
                      onClick={() => selectClient(client)}
                    >
                      <strong>{client.displayName}</strong>
                      {client.xeroClientName ? <span>{client.xeroClientName}</span> : null}
                    </button>
                  ))}
                  {!filteredClients.length ? <p>No clients found.</p> : null}
                </div>
              ) : null}
            </div>
          </div>
          <label>
            Start date
            <input
              disabled={generating}
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            End date
            <input disabled={generating} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <button className="primary-action-button" disabled={!billingClientId || !clientQueryMatchesSelection || generating || loading} type="submit">
            {generating ? <Loader2 className="spin" size={17} /> : <FileText size={17} />}
            Generate Document
          </button>
        </form>

        {error ? <p className="form-error">{error}</p> : null}
      </section>

      {preview ? (
        <QuotePreview
          annualYears={annualYears}
          editorSession={editorSession}
          onArchive={onArchive}
          onSaveControllerChange={onSaveControllerChange}
          onPreviewChange={onPreviewChange}
          preview={preview}
          xeroTaxRates={xeroTaxRates}
        />
      ) : null}
    </Fragment>
  );
}

function QuotePreview({ annualYears = [], editorSession, onArchive, onPreviewChange, onSaveControllerChange, preview, xeroTaxRates = [] }) {
  const initialTotals = preview.totals || {};
  const initialWarnings = preview.warnings || [];
  const lines = preview.lines || [];
  const serviceOptions = preview.services || [];
  const currencyCode = preview.currency || preview.billingClient?.currency || "EUR";
  const [openLineKeys, setOpenLineKeys] = useState(() => new Set());
  const [quoteLines, setQuoteLines] = useState(lines);
  const [quoteTotalsBase, setQuoteTotalsBase] = useState(initialTotals);
  const [quoteWarnings, setQuoteWarnings] = useState(initialWarnings);
  const [lineDiscountDrafts, setLineDiscountDrafts] = useState(() =>
    Object.fromEntries(lines.map((line) => [line.id, decimal.format(line.discount || 0)]))
  );
  const [lineError, setLineError] = useState("");
  const [savingLineIds, setSavingLineIds] = useState(() => new Set());
  const [savingEntryIds, setSavingEntryIds] = useState(() => new Set());
  const [openActionMenuKey, setOpenActionMenuKey] = useState("");
  const [editingLine, setEditingLine] = useState(null);
  const [addingManualLine, setAddingManualLine] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState(preview.status || "preview");
  const [xeroSendState, setXeroSendState] = useState(preview.xeroSendState || "idle");
  const [sendError, setSendError] = useState("");
  const [sendResult, setSendResult] = useState(null);
  const [sendingToXero, setSendingToXero] = useState(false);
  const [xeroDocumentType, setXeroDocumentType] = useState(preview.documentType || "draft_invoice");
  const [xeroStatus, setXeroStatus] = useState(null);
  const [metadata, setMetadata] = useState(() => ({
    expiryDate: preview.expiryDate || "",
    quoteNumber: preview.quoteNumber || "",
    quoteDate: preview.quoteDate || today(),
    reference: preview.reference || ""
  }));
  const quoteTotals = useMemo(
    () => ({
      ...quoteTotalsBase,
      amount: roundNumber(quoteLines.reduce((sum, line) => sum + Number(line.amount || 0), 0)),
      lineCount: quoteLines.length
    }),
    [quoteLines, quoteTotalsBase]
  );
  const annualItems = useMemo(() => annualCoverageItems(quoteLines), [quoteLines]);
  const annualInvoiced = useMemo(() => annualInvoicedItems(quoteLines), [quoteLines]);
  const visibleWarnings = quoteWarnings.filter((warning) => warning.type !== "missing_service");
  const [metadataError, setMetadataError] = useState("");
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [saveState, setSaveState] = useState("saved");
  const versionRef = useRef(Number(preview.version || 1));
  const saveQueueRef = useRef(Promise.resolve());
  const metadataTimerRef = useRef(null);
  const metadataRef = useRef(metadata);
  const lastFailedOperationRef = useRef(null);
  const lastSaveErrorRef = useRef(null);
  const pendingSaveCountRef = useRef(0);
  const lastLockRenewalRef = useRef(0);
  const quoteIsLocked = quoteStatus !== "preview" || ["sending", "unknown"].includes(xeroSendState);
  const selectedXeroDocumentLabel = xeroDocumentTypeLabel(xeroDocumentType);
  const isDraftQuote = xeroDocumentType === "draft_quote";
  const documentNumberLabel = isDraftQuote ? "Quote number" : "Invoice number";
  const documentDateLabel = isDraftQuote ? "Quote date" : "Invoice date";
  const documentExpiryLabel = isDraftQuote ? "Expiry date" : "Due date";

  metadataRef.current = metadata;

  useEffect(() => {
    setOpenLineKeys(new Set());
    saveQueueRef.current = Promise.resolve();
    lastFailedOperationRef.current = null;
    lastSaveErrorRef.current = null;
    pendingSaveCountRef.current = 0;
  }, [preview.id]);

  useEffect(() => {
    setQuoteLines(lines);
    setQuoteTotalsBase(preview.totals || {});
    setQuoteWarnings(preview.warnings || []);
    setLineDiscountDrafts(Object.fromEntries(lines.map((line) => [line.id, decimal.format(line.discount || 0)])));
    setLineError("");
    setSavingLineIds(new Set());
    setSavingEntryIds(new Set());
    setOpenActionMenuKey("");
    setAddingManualLine(false);
    setEditingLine(null);
    setQuoteStatus(preview.status || "preview");
    setXeroSendState(preview.xeroSendState || "idle");
    setSendError("");
    setSendResult(null);
    setSendingToXero(false);
    setXeroDocumentType(preview.documentType || "draft_invoice");
    versionRef.current = Number(preview.version || 1);
    if (lastSaveErrorRef.current) setSaveState("error");
    else setSaveState(pendingSaveCountRef.current ? "saving" : "saved");
  }, [lines, preview.id, preview.totals, preview.warnings, preview.xeroSendState]);

  useEffect(() => {
    versionRef.current = Number(preview.version || versionRef.current || 1);
  }, [preview.version]);

  useEffect(() => {
    setMetadata({
      expiryDate: preview.expiryDate || "",
      quoteNumber: preview.quoteNumber || "",
      quoteDate: preview.quoteDate || today(),
      reference: preview.reference || ""
    });
    setMetadataError("");
  }, [preview.expiryDate, preview.id, preview.quoteDate, preview.quoteNumber, preview.reference]);

  useEffect(() => {
    let cancelled = false;

    getXeroStatus()
      .then((status) => {
        if (!cancelled) setXeroStatus(status);
      })
      .catch(() => {
        if (!cancelled) setXeroStatus({ configured: false, connected: false, status: "unknown" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function warnForUnsavedChanges(event) {
      if (saveState === "saved" && !metadataTimerRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnForUnsavedChanges);
    return () => window.removeEventListener("beforeunload", warnForUnsavedChanges);
  }, [saveState]);

  useEffect(() => {
    onSaveControllerChange?.({ flush: flushPendingChanges });
    return () => onSaveControllerChange?.(null);
  }, [onSaveControllerChange, preview.id]);

  function lifecycleInput(input = {}) {
    return {
      ...input,
      editorSessionId: editorSession,
      version: versionRef.current
    };
  }

  function mergePreviewForParent(nextPreview = {}) {
    if (nextPreview.version) versionRef.current = Number(nextPreview.version);
    onPreviewChange?.(nextPreview);
  }

  function runDraftMutation(operation) {
    pendingSaveCountRef.current += 1;
    setSaveState("saving");
    const pending = saveQueueRef.current
      .catch(() => undefined)
      .then(() => operation(lifecycleInput()))
      .then((payload) => {
        if (payload?.preview) mergePreviewForParent(payload.preview);
        if (lastFailedOperationRef.current === operation) {
          lastFailedOperationRef.current = null;
          lastSaveErrorRef.current = null;
        }
        return payload;
      })
      .catch((error) => {
        lastFailedOperationRef.current = operation;
        lastSaveErrorRef.current = error;
        throw error;
      })
      .finally(() => {
        pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
        if (lastSaveErrorRef.current) setSaveState("error");
        else setSaveState(pendingSaveCountRef.current ? "saving" : "saved");
      });
    saveQueueRef.current = pending;
    return pending;
  }

  function renewEditorLock() {
    const now = Date.now();
    if (!preview.id || now - lastLockRenewalRef.current < 60_000) return;
    lastLockRenewalRef.current = now;
    renewQuoteDraft(preview.id, editorSession).catch((error) => {
      if (error.code === "DRAFT_LOCKED") {
        setMetadataError(error.message);
        setSaveState("error");
      }
    });
  }

  function toggleLine(line) {
    const key = quoteLineKey(line);
    setOpenLineKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleActionMenu(key) {
    setOpenActionMenuKey((current) => (current === key ? "" : key));
  }

  function applyPreviewUpdate(nextPreview = {}) {
    const nextLines = nextPreview.lines || [];
    setQuoteLines(nextLines);
    setQuoteTotalsBase(nextPreview.totals || {});
    setQuoteWarnings(nextPreview.warnings || []);
    setLineDiscountDrafts(Object.fromEntries(nextLines.map((line) => [line.id, decimal.format(line.discount || 0)])));
    setOpenLineKeys((current) => {
      const validKeys = new Set(nextLines.map(quoteLineKey));
      return new Set([...current].filter((key) => validKeys.has(key)));
    });
    setOpenActionMenuKey("");
  }

  function mergeLinePreviewUpdate(nextPreview = {}) {
    if (nextPreview.replaceLines) {
      applyPreviewUpdate(nextPreview);
      return;
    }

    const savedLines = new Map((nextPreview.lines || []).map((savedLine) => [savedLine.id, savedLine]));
    if (!savedLines.size) return;

    setQuoteLines((current) => {
      const seen = new Set();
      const merged = current.map((currentLine) => {
        seen.add(currentLine.id);
        return savedLines.has(currentLine.id) ? { ...currentLine, ...savedLines.get(currentLine.id) } : currentLine;
      });
      for (const savedLine of nextPreview.lines || []) {
        if (!seen.has(savedLine.id)) merged.push(savedLine);
      }
      return merged;
    });
    setLineDiscountDrafts((current) => ({
      ...current,
      ...Object.fromEntries((nextPreview.lines || []).map((line) => [line.id, decimal.format(line.discount || 0)]))
    }));
    if (nextPreview.totals) setQuoteTotalsBase(nextPreview.totals);
    if (Array.isArray(nextPreview.warnings)) setQuoteWarnings(nextPreview.warnings);
    setOpenActionMenuKey("");
  }

  async function saveMetadata(nextMetadata) {
    if (!preview.id || quoteIsLocked) return;
    setMetadataSaving(true);
    setMetadataError("");
    try {
      const payload = await runDraftMutation((lifecycle) => updateQuotePreview(preview.id, { ...nextMetadata, ...lifecycle }));
      const { lines: _lines, totals: _totals, ...savedMetadata } = payload.preview || {};
      setMetadata((current) => ({ ...current, ...savedMetadata }));
      return payload;
    } catch (err) {
      setMetadataError(err.message);
      throw err;
    } finally {
      setMetadataSaving(false);
    }
  }

  function scheduleMetadataSave(nextMetadata) {
    if (metadataTimerRef.current) window.clearTimeout(metadataTimerRef.current);
    setSaveState("saving");
    metadataTimerRef.current = window.setTimeout(() => {
      metadataTimerRef.current = null;
      saveMetadata(nextMetadata).catch(() => undefined);
    }, 600);
  }

  function flushMetadata(nextMetadata = metadata) {
    if (metadataTimerRef.current) {
      window.clearTimeout(metadataTimerRef.current);
      metadataTimerRef.current = null;
    }
    return saveMetadata(nextMetadata);
  }

  async function flushPendingChanges() {
    if (metadataTimerRef.current) {
      await flushMetadata(metadataRef.current);
    }
    await saveQueueRef.current;
    if (lastSaveErrorRef.current) throw lastSaveErrorRef.current;
  }

  async function retryLastSave() {
    const operation = lastFailedOperationRef.current;
    if (!operation) return;
    setMetadataError("");
    setLineError("");
    try {
      await runDraftMutation(operation);
    } catch (error) {
      setMetadataError(error.message);
    }
  }

  function updateMetadata(field, value) {
    const next = { ...metadata, [field]: value };
    setMetadata(next);
    scheduleMetadataSave(next);
    setMetadataError("");
  }

  function updateQuoteDate(value) {
    const next = {
      ...metadata,
      expiryDate: addDaysToDate(value, 14),
      quoteDate: value
    };
    setMetadata(next);
    scheduleMetadataSave(next);
    setMetadataError("");
  }

  function updateLineDiscountDraft(lineId, value) {
    setLineDiscountDrafts((current) => ({ ...current, [lineId]: value }));
    setLineError("");
  }

  async function saveLineDiscount(line) {
    if (!preview.id || !line?.id || quoteIsLocked) return;

    let discount;
    try {
      discount = normalizePercent(lineDiscountDrafts[line.id]);
    } catch (err) {
      setLineError(err.message);
      setLineDiscountDrafts((current) => ({ ...current, [line.id]: decimal.format(line.discount || 0) }));
      return;
    }

    setSavingLineIds((current) => new Set(current).add(line.id));
    setLineError("");

    try {
      const payload = await runDraftMutation((lifecycle) => updateQuotePreview(preview.id, {
        ...lifecycle,
        lines: [{ discount, id: line.id }]
      }));
      mergeLinePreviewUpdate(payload.preview || {});
      setLineDiscountDrafts((current) => ({ ...current, [line.id]: decimal.format(discount) }));
    } catch (err) {
      setLineError(err.message);
      setLineDiscountDrafts((current) => ({ ...current, [line.id]: decimal.format(line.discount || 0) }));
    } finally {
      setSavingLineIds((current) => {
        const next = new Set(current);
        next.delete(line.id);
        return next;
      });
    }
  }

  async function saveLineEdit(line, draft) {
    if (!preview.id || !line?.id || quoteIsLocked) return;

    setSavingLineIds((current) => new Set(current).add(line.id));
    setLineError("");

    try {
      const payload = await runDraftMutation((lifecycle) => updateQuotePreview(preview.id, {
        ...lifecycle,
        lines: [
          {
            ...draft,
            id: line.id
          }
        ]
      }));
      mergeLinePreviewUpdate(payload.preview || {});
    } catch (err) {
      setLineError(err.message);
      throw err;
    } finally {
      setSavingLineIds((current) => {
        const next = new Set(current);
        next.delete(line.id);
        return next;
      });
    }
  }

  async function saveManualLine(draft) {
    if (!preview.id || quoteIsLocked) return;

    setLineError("");

    try {
      const payload = await runDraftMutation((lifecycle) => updateQuotePreview(preview.id, {
        ...lifecycle,
        lines: [
          {
            ...draft,
            sourceType: "manual"
          }
        ]
      }));
      mergeLinePreviewUpdate(payload.preview || {});
    } catch (err) {
      setLineError(err.message);
      throw err;
    }
  }

  async function setEntryBillable(entry, nextIsBillable) {
    if (!preview.id || !entry?.id || entry.isBillable === nextIsBillable || quoteIsLocked) return;

    setSavingEntryIds((current) => new Set(current).add(entry.id));
    setLineError("");
    setOpenActionMenuKey("");

    try {
      const payload = await runDraftMutation((lifecycle) =>
        updateQuoteTimeEntryBillable(preview.id, entry.id, nextIsBillable, lifecycle)
      );
      applyPreviewUpdate(payload.preview || {});
    } catch (err) {
      setLineError(err.message);
    } finally {
      setSavingEntryIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  async function setLineBillable(line, nextIsBillable) {
    const entriesToUpdate = (line.entries || []).filter((entry) => entry.isBillable !== nextIsBillable);
    if (!preview.id || !line?.id || !entriesToUpdate.length || quoteIsLocked) return;

    setSavingLineIds((current) => new Set(current).add(line.id));
    setSavingEntryIds((current) => {
      const next = new Set(current);
      for (const entry of entriesToUpdate) next.add(entry.id);
      return next;
    });
    setLineError("");
    setOpenActionMenuKey("");

    try {
      const payload = await runDraftMutation((lifecycle) =>
        updateQuoteTimeEntriesBillable(
          preview.id,
          entriesToUpdate.map((entry) => entry.id),
          nextIsBillable,
          lifecycle
        )
      );
      applyPreviewUpdate(payload.preview || {});
    } catch (err) {
      setLineError(err.message);
    } finally {
      setSavingLineIds((current) => {
        const next = new Set(current);
        next.delete(line.id);
        return next;
      });
      setSavingEntryIds((current) => {
        const next = new Set(current);
        for (const entry of entriesToUpdate) next.delete(entry.id);
        return next;
      });
    }
  }

  async function handleSendToXero() {
    if (!preview.id || quoteStatus !== "preview") return;

    setSendingToXero(true);
    setSendError("");
    setSendResult(null);

    try {
      await flushMetadata(metadata);
      const payload = await runDraftMutation((lifecycle) => sendQuoteToXero(preview.id, {
        ...lifecycle,
        documentType: xeroDocumentType
      }));
      setQuoteStatus(payload.preview?.status || "approved_for_xero");
      setXeroSendState(payload.preview?.xeroSendState || (payload.reused ? payload.xero?.state : "succeeded"));
      setSendResult(payload.xero || null);
    } catch (err) {
      setSendError(err.message);
      if (err.details?.sendState) setXeroSendState(err.details.sendState);
    } finally {
      setSendingToXero(false);
    }
  }

  async function handleReconcileXeroSend() {
    if (!preview.id || xeroSendState !== "unknown") return;
    setSendingToXero(true);
    setSendError("");
    setSendResult(null);
    try {
      const payload = await runDraftMutation((lifecycle) => reconcileQuoteXeroSend(preview.id, lifecycle));
      setQuoteStatus(payload.preview?.status || "preview");
      setXeroSendState(payload.preview?.xeroSendState || payload.xero?.state || "failed");
      setSendResult(payload.xero || null);
    } catch (error) {
      setSendError(error.message);
    } finally {
      setSendingToXero(false);
    }
  }

  async function handleDocumentTypeChange(value) {
    setXeroDocumentType(value);
    setMetadataError("");
    try {
      await runDraftMutation((lifecycle) => updateQuotePreview(preview.id, {
        ...lifecycle,
        documentType: value
      }));
    } catch (error) {
      setMetadataError(error.message);
    }
  }

  async function handleArchiveDraft() {
    if (!preview.id || quoteIsLocked) return;
    setMetadataError("");
    try {
      await flushMetadata(metadata);
      await runDraftMutation((lifecycle) => archiveQuoteDraft(preview.id, lifecycle));
      onArchive?.(preview.id);
    } catch (error) {
      setMetadataError(error.message);
    }
  }

  return (
    <Fragment>
      <div className="client-stat-grid quote-stat-grid" aria-label="Document preview summary">
        <ClientStatsCard label="Document amount" value={formatCurrencyAmount(quoteTotals.amount, currencyCode)} />
        <ClientStatsCard label="Total hours" value={formatHours(quoteTotals.totalHours)} />
        <ClientStatsCard label="Billable hours" value={formatHours(quoteTotals.billedHours)} />
        <ClientStatsCard label="Lines" value={wholeNumber.format(quoteTotals.lineCount || 0)} />
      </div>

      <section
        className="panel full-panel quote-preview-panel"
        onKeyDown={renewEditorLock}
        onPointerDown={renewEditorLock}
      >
        <div className="panel-heading">
          <div>
            <p>{selectedXeroDocumentLabel}</p>
            <h2>{preview.billingClient?.displayName || "Document preview"}</h2>
          </div>
          <div className="quote-heading-actions">
            {xeroStatus ? (
              <span className={`xero-connection-chip ${xeroStatus.connected ? "connected" : ""}`}>
                {xeroStatus.connected
                  ? `Xero connected${xeroStatus.tenantName ? `: ${xeroStatus.tenantName}` : ""}`
                  : xeroStatus.configured
                    ? "Xero prepared mode"
                    : "Xero OAuth not configured"}
              </span>
            ) : null}
            {xeroStatus?.configured && !xeroStatus.connected ? (
              <a className="secondary-action-button xero-connect-link" href="/api/xero/connect">
                Connect Xero
              </a>
            ) : null}
            <label className="xero-document-type-field">
              <select
                aria-label="Xero document type"
                disabled={sendingToXero || quoteIsLocked}
                value={xeroDocumentType}
                onChange={(event) => handleDocumentTypeChange(event.target.value)}
              >
                {xeroDocumentTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <span className={`draft-save-state draft-save-state--${saveState}`} role="status">
              {saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn’t save" : "Saved"}
            </span>
            {saveState === "error" && lastFailedOperationRef.current ? (
              <button className="secondary-button compact-button" onClick={retryLastSave} type="button">Retry</button>
            ) : null}
            <button className="secondary-button" disabled={metadataSaving || quoteIsLocked} onClick={handleArchiveDraft} type="button">
              Archive
            </button>
            {xeroSendState === "unknown" ? (
              <button className="primary-action-button" disabled={sendingToXero} type="button" onClick={handleReconcileXeroSend}>
                {sendingToXero ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
                Reconcile Xero
              </button>
            ) : (
              <button
                className="primary-action-button"
                disabled={sendingToXero || metadataSaving || quoteIsLocked}
                type="button"
                onClick={handleSendToXero}
              >
                {sendingToXero ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
                {quoteStatus === "preview" ? "Send to Xero" : "Sent to Xero"}
              </button>
            )}
          </div>
        </div>

        <dl className="quote-meta-grid">
          <div>
            <dt>Xero client</dt>
            <dd>{preview.billingClient?.xeroClientName || "Not mapped"}</dd>
          </div>
          <div>
            <dt>{documentNumberLabel}</dt>
            <dd>
              <input
                aria-label={documentNumberLabel}
                disabled={metadataSaving || quoteIsLocked}
                value={metadata.quoteNumber}
                onBlur={(event) => flushMetadata({ ...metadata, quoteNumber: event.target.value }).catch(() => undefined)}
                onChange={(event) => updateMetadata("quoteNumber", event.target.value)}
              />
            </dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>
              <input
                aria-label="Document reference"
                disabled={metadataSaving || quoteIsLocked}
                value={metadata.reference}
                onBlur={(event) => flushMetadata({ ...metadata, reference: event.target.value }).catch(() => undefined)}
                onChange={(event) => updateMetadata("reference", event.target.value)}
              />
            </dd>
          </div>
          <div>
            <dt>{documentDateLabel}</dt>
            <dd>
              <input
                aria-label={documentDateLabel}
                disabled={metadataSaving || quoteIsLocked}
                type="date"
                value={metadata.quoteDate}
                onBlur={(event) =>
                  flushMetadata({
                    ...metadata,
                    expiryDate: addDaysToDate(event.target.value, 14),
                    quoteDate: event.target.value
                  }).catch(() => undefined)
                }
                onChange={(event) => updateQuoteDate(event.target.value)}
                onInput={(event) => updateQuoteDate(event.currentTarget.value)}
              />
            </dd>
          </div>
          <div>
            <dt>{documentExpiryLabel}</dt>
            <dd>
              <input
                aria-label={documentExpiryLabel}
                disabled={metadataSaving || quoteIsLocked}
                type="date"
                value={metadata.expiryDate}
                onBlur={(event) => flushMetadata({ ...metadata, expiryDate: event.target.value }).catch(() => undefined)}
                onChange={(event) => updateMetadata("expiryDate", event.target.value)}
              />
            </dd>
          </div>
        </dl>

        {metadataError ? <p className="form-error">{metadataError}</p> : null}
        {lineError ? <p className="form-error">{lineError}</p> : null}
        {sendError ? <p className="form-error">{sendError}</p> : null}
        {xeroSendState === "unknown" ? <div className="warning-banner">Xero may have received this document. Editing is paused until reconciliation confirms whether the remote document exists.</div> : null}
        {sendResult ? (
          <div className="quote-send-result" role="status">
            <strong>
              {sendResult.mode === "live"
                ? `Document sent to Xero as ${sendResult.documentLabel || selectedXeroDocumentLabel} for ${preview.billingClient?.displayName || "this client"} and total amount ${formatCurrencyAmount(sendResult.amount || 0, currencyCode)}.`
                : sendResult.message || "Document prepared for Xero."}
            </strong>
            <span>
              {wholeNumber.format(sendResult.lineCount || 0)} Xero lines, {formatHours((sendResult.annualUsageApplied || []).reduce((sum, row) => sum + Number(row.hours || 0), 0))} booked to annual invoices.
            </span>
          </div>
        ) : null}

        {annualItems.length || annualInvoiced.length ? (
          <div className="annual-summary-stack">
            <AnnualServiceSummary items={annualItems} totalHours={quoteTotals.annualCoveredHours || 0} />
            <AnnualServiceSummary currencyCode={currencyCode} items={annualInvoiced} mode="invoiced" />
          </div>
        ) : null}

        {visibleWarnings.length ? (
          <div className="quote-warning-list" aria-label="Document warnings">
            {visibleWarnings.map((warning) => (
              <div className={`quote-warning quote-warning--${warningTone(warning)}`} key={warning.type}>
                <strong>{warning.label}</strong>
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="quote-line-toolbar">
          <button
            className="secondary-action-button"
            disabled={quoteIsLocked}
            type="button"
            onClick={() => setAddingManualLine(true)}
          >
            <Plus size={17} />
            Add manual row
          </button>
        </div>

        <div className="table-wrap quote-table-wrap">
          <table className="quote-lines-table">
            <thead>
              <tr>
                <th>Comment</th>
                <th>Task name</th>
                <th>Hours</th>
                <th>Rate</th>
                <th>Discount</th>
                <th>Amount</th>
                <th className="quote-action-header" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {quoteLines.map((line) => {
                const key = quoteLineKey(line);
                const entries = line.entries || [];
                const isOpen = openLineKeys.has(key);
                const lineActionKey = `line:${key}`;
                const canMarkLineBillable = entries.some((entry) => !entry.isBillable);
                const canMarkLineUnbillable = entries.some((entry) => entry.isBillable);
                return (
                  <Fragment key={key}>
                    <tr className={`quote-task-row${line.annualCovered ? " quote-task-row--annual-covered" : ""}`}>
                      <td className="quote-comment-cell">
                        <div className="quote-entry-comment-action">
                          {canMarkLineBillable ? (
                            <button
                              aria-label={`Mark task as billable: ${line.taskName || line.description || "document line"}`}
                              className="icon-only-button quote-entry-billable-button"
                              disabled={savingLineIds.has(line.id) || quoteIsLocked}
                              title="Mark task as billable"
                              type="button"
                              onClick={() => setLineBillable(line, true)}
                            >
                              {savingLineIds.has(line.id) ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                            </button>
                          ) : null}
                          <span>{documentLineComment(line)}</span>
                        </div>
                      </td>
                      <td className="quote-task-cell">
                        <button
                          aria-expanded={isOpen}
                          className="quote-task-toggle"
                          onClick={() => toggleLine(line)}
                          type="button"
                        >
                          <ChevronDown className="nav-chevron" size={16} />
                          <span>
                            <strong>{line.taskName || line.description || "No task"}</strong>
                            <small>{formatEntryCount(entries.length || line.sourceTimeEntryIds?.length || 0)}</small>
                          </span>
                        </button>
                      </td>
                      <td>{formatHours(line.quantityHours)}</td>
                      <td>{formatCurrencyAmount(line.unitAmount, currencyCode)}</td>
                      <td>
                        <input
                          aria-label={`Discount for ${line.taskName || line.description || "document line"}`}
                          className="quote-discount-input"
                          disabled={savingLineIds.has(line.id) || quoteIsLocked}
                          inputMode="decimal"
                          value={lineDiscountDrafts[line.id] ?? decimal.format(line.discount || 0)}
                          onBlur={() => saveLineDiscount(line)}
                          onChange={(event) => updateLineDiscountDraft(line.id, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") {
                              updateLineDiscountDraft(line.id, decimal.format(line.discount || 0));
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </td>
                      <td>{formatCurrencyAmount(line.amount, currencyCode)}</td>
                      <td className="quote-action-cell">
                        <QuoteActionMenu
                          actions={[
                            ...(canMarkLineUnbillable ? [{
                              label: "Mark task unbillable",
                              onClick: () => setLineBillable(line, false)
                            }] : [])
                          ]}
                          busy={savingLineIds.has(line.id)}
                          disabled={quoteIsLocked || savingLineIds.has(line.id)}
                          isOpen={openActionMenuKey === lineActionKey}
                          menuLabel={`Actions for ${line.taskName || line.description || "document line"}`}
                          onEdit={() => {
                            setEditingLine(line);
                            setOpenActionMenuKey("");
                          }}
                          onToggle={() => toggleActionMenu(lineActionKey)}
                        />
                      </td>
                    </tr>
                    {isOpen ? (
                      <>
                        <tr className="quote-entry-header-row">
                          <td className="quote-entry-comment-header">Comment</td>
                          <td>
                            <div className="quote-entry-labels">
                              <span>Person</span>
                              <span>Description</span>
                            </div>
                          </td>
                          <td>Time</td>
                          <td>Rate</td>
                          <td aria-hidden="true" />
                          <td aria-hidden="true" />
                          <td className="quote-action-header" aria-hidden="true" />
                        </tr>
                        {entries.map((entry) => {
                          const entryActionKey = `entry:${entry.id}`;
                          return (
                            <tr className="quote-entry-row" key={entry.renderId || entry.id}>
                              <td className="quote-entry-comment-cell">
                                <div className="quote-entry-comment-action">
                                  {!entry.isBillable ? (
                                    <button
                                      aria-label="Mark time entry as billable"
                                      className="icon-only-button quote-entry-billable-button"
                                      disabled={savingEntryIds.has(entry.id) || quoteIsLocked}
                                      title="Mark as billable"
                                      type="button"
                                      onClick={() => setEntryBillable(entry, true)}
                                    >
                                      {savingEntryIds.has(entry.id) ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                                    </button>
                                  ) : null}
                                  <span>{entry.annualCovered ? "pre-paid" : entry.comment || entry.comments || ""}</span>
                                </div>
                              </td>
                              <td>
                                <div className="quote-entry-fields">
                                  <strong>{entry.userName}</strong>
                                  <span>{entry.description || <span className="muted-text">No description</span>}</span>
                                </div>
                              </td>
                              <td>{formatHours(entry.hours)}</td>
                              <td>{formatCurrencyAmount(entry.userRate, currencyCode)}</td>
                              <td aria-hidden="true" />
                              <td aria-hidden="true" />
                              <td className="quote-action-cell quote-entry-action-cell">
                                <QuoteActionMenu
                                  actionDisabled={!entry.isBillable || quoteIsLocked || savingEntryIds.has(entry.id)}
                                  actionLabel={entry.isBillable ? "Mark unbillable" : "Already unbillable"}
                                  busy={savingEntryIds.has(entry.id)}
                                  disabled={quoteIsLocked || savingEntryIds.has(entry.id)}
                                  isOpen={openActionMenuKey === entryActionKey}
                                  menuLabel={`Actions for ${entry.userName || "time entry"}`}
                                  onMarkUnbillable={() => setEntryBillable(entry, false)}
                                  onToggle={() => toggleActionMenu(entryActionKey)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                        {!entries.length ? (
                          <tr className="quote-entry-row quote-entry-row--empty">
                            <td className="quote-entry-comment-cell" />
                            <td className="empty-cell" colSpan="6">No source time entries.</td>
                          </tr>
                        ) : null}
                      </>
                    ) : null}
                  </Fragment>
                );
              })}
              {!quoteLines.length ? (
                <tr>
                  <td className="empty-cell" colSpan="7">No source lines for this period.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {editingLine ? (
        <QuoteLineEditModal
          annualYears={quoteAnnualYearOptions(preview, editingLine, annualYears)}
          currencyCode={currencyCode}
          line={editingLine}
          services={serviceOptions}
          taxRates={xeroTaxRates}
          onClose={() => setEditingLine(null)}
          onSave={(draft) => saveLineEdit(editingLine, draft)}
        />
      ) : null}
      {addingManualLine ? (
        <QuoteLineEditModal
          annualYears={quoteAnnualYearOptions(preview, {}, annualYears)}
          currencyCode={currencyCode}
          line={manualQuoteLineDraft(preview)}
          services={serviceOptions}
          taxRates={xeroTaxRates}
          onClose={() => setAddingManualLine(false)}
          onSave={(draft) => saveManualLine(draft)}
        />
      ) : null}
    </Fragment>
  );
}

function clientDraft(client) {
  return {
    abbreviation: client.abbreviation || "",
    accountCode: client.accountCode || "70330001",
    active: client.active !== false,
    currency: client.currency || "EUR",
    discount: client.discount || 0,
    displayName: client.displayName || "",
    id: client.id,
    status: statusForClient(client),
    taxRateName: client.taxRateName || "",
    taxType: client.taxType || "",
    xeroClientName: client.xeroClientName || "",
    xeroContactId: client.xeroContactId || ""
  };
}

function BillingClientModal({ client, onClose, onSave, xeroAccounts = [], xeroContacts = [], xeroTaxRates = [] }) {
  const [draft, setDraft] = useState(() => clientDraft(client));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEscapeToClose(onClose, !saving);
  const selectedContact = useMemo(
    () => xeroContacts.find((contact) => contact.name === draft.xeroClientName) || null,
    [draft.xeroClientName, xeroContacts]
  );
  const selectedTaxRate = useMemo(
    () => xeroTaxRates.find((taxRate) => taxRate.name === draft.taxRateName) || null,
    [draft.taxRateName, xeroTaxRates]
  );
  const selectedAccount = useMemo(
    () => xeroAccounts.find((account) => account.code === draft.accountCode) || null,
    [draft.accountCode, xeroAccounts]
  );

  useEffect(() => {
    setDraft(clientDraft(client));
    setError("");
  }, [client]);

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateXeroClient(name) {
    const contact = xeroContacts.find((item) => item.name === name);
    setDraft((current) => ({
      ...current,
      discount: contact && Number(contact.discount) > 0 && Number(current.discount || 0) === 0 ? contact.discount : current.discount,
      xeroClientName: name,
      xeroContactId: contact?.xeroContactId || ""
    }));
  }

  function updateTaxRate(name) {
    const taxRate = xeroTaxRates.find((item) => item.name === name);
    setDraft((current) => ({
      ...current,
      taxRateName: name,
      taxType: taxRate?.taxType || ""
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" aria-labelledby="billing-client-modal-title" role="dialog" aria-modal="true">
        <header className="settings-modal-header">
          <div>
            <p>Billing client</p>
            <h2 id="billing-client-modal-title">{client.displayName}</h2>
            <span>{client.teamworkProjectName || "Teamwork project"}</span>
          </div>
          <button aria-label="Close client settings" className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <form className="settings-form" onSubmit={handleSubmit}>
          <label>
            Teamwork Project
            <input value={draft.displayName} onChange={(event) => updateField("displayName", event.target.value)} />
          </label>
          <label>
            Xero client
            <select value={draft.xeroClientName} onChange={(event) => updateXeroClient(event.target.value)}>
              <option value="">Select Xero client</option>
              {draft.xeroClientName && !selectedContact ? <option value={draft.xeroClientName}>{draft.xeroClientName}</option> : null}
              {xeroContacts.map((contact) => (
                <option key={contact.id} value={contact.name}>
                  {contact.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Xero contact ID
            <input readOnly value={draft.xeroContactId} />
          </label>
          <label>
            Tax rate
            <select value={draft.taxRateName} onChange={(event) => updateTaxRate(event.target.value)}>
              <option value="">Select tax rate</option>
              {draft.taxRateName && !selectedTaxRate ? <option value={draft.taxRateName}>{draft.taxRateName}</option> : null}
              {xeroTaxRates.map((taxRate) => (
                <option key={taxRate.taxType} value={taxRate.name}>
                  {taxRate.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tax type
            <input readOnly value={draft.taxType} />
          </label>
          <label>
            Standard discount %
            <input
              value={draft.discount}
              onChange={(event) => updateField("discount", event.target.value)}
            />
          </label>
          <label>
            Account code
            <select value={draft.accountCode} onChange={(event) => updateField("accountCode", event.target.value)}>
              <option value="">Select account</option>
              {draft.accountCode && !selectedAccount ? <option value={draft.accountCode}>{draft.accountCode}</option> : null}
              {xeroAccounts.map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Abbreviation
            <input value={draft.abbreviation} onChange={(event) => updateField("abbreviation", event.target.value)} />
          </label>
          <label>
            Currency
            <select value={draft.currency} onChange={(event) => updateField("currency", event.target.value)}>
              {draft.currency && !currencyOptions.some((option) => option.value === draft.currency) ? (
                <option value={draft.currency}>{draft.currency}</option>
              ) : null}
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={draft.status} onChange={(event) => updateField("status", event.target.value)}>
              {clientStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <footer className="settings-modal-actions">
            <button className="secondary-button" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="primary-action-button" disabled={saving} type="submit">
              {saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
              Save
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function BillingClientsTable({ clients, emptyMessage, loading, onSelect }) {
  return (
    <div className="table-wrap">
      <table className="billing-clients-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Xero client</th>
            <th>Tax rate</th>
            <th>Standard discount %</th>
            <th>Account</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => {
            const status = statusForClient(client);
            return (
              <tr
                aria-label={`Open ${client.displayName}, ${formatQuoteCount(client.quoteCount)}, ${statusLabel(status)}`}
                className={`clickable-row billing-client-row billing-client-row--${status}`}
                key={client.id}
                onClick={() => onSelect(client)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(client);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <td>
                  <div className="project-row-button">
                    <strong>{client.displayName}</strong>
                    <span>{formatQuoteCount(client.quoteCount)}</span>
                  </div>
                </td>
                <td>{client.xeroClientName || "Not mapped"}</td>
                <td>{client.taxRateName || client.taxType || "Not set"}</td>
                <td>{decimal.format(client.discount || 0)}%</td>
                <td>{client.accountCode}</td>
                <td>
                  <span className={`status-pill ${status}`}>
                    {statusLabel(status)}
                  </span>
                </td>
              </tr>
            );
          })}
          {!clients.length ? (
            <tr>
              <td className="empty-cell" colSpan="6">
                {loading ? "Loading clients." : emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ClientStatsCard({ label, tone = "", value, detail }) {
  return (
    <article className={`client-stat-card ${tone ? `client-stat-card--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

const auditActionLabels = {
  account_update: "Account updated",
  annual_invoice_update: "Annual invoice updated",
  billing_client_update: "Billing client updated",
  document_metadata_update: "Document metadata updated",
  document_preview_create: "Document preview created",
  document_rows_update: "Document rows updated",
  login: "Login",
  login_failed: "Failed login",
  logout: "Logout",
  send_to_xero: "Sent to Xero",
  teamwork_sync_refresh: "Teamwork refreshed",
  teamwork_sync_scheduled_failure: "Scheduled Teamwork sync failed",
  teamwork_sync_scheduled_success: "Scheduled Teamwork sync completed",
  time_entry_billable_update: "Billable state changed",
  xero_connect: "Xero connected",
  xero_disconnect: "Xero disconnected",
  xero_status_refresh: "Xero status refreshed"
};

const auditEntityLabels = {
  app_user: "User",
  annual_invoice_usage: "Annual invoice",
  auth: "Auth",
  billing_client: "Billing client",
  quote_preview: "Document preview",
  teamwork_report: "Teamwork report",
  teamwork_sync: "Teamwork sync",
  teamwork_time_entry: "Time entry",
  xero: "Xero",
  xero_document: "Xero document"
};

const auditCategoryOptions = [
  { value: "all", label: "All" },
  { value: "documents", label: "Documents" },
  { value: "xero", label: "Xero" },
  { value: "clients", label: "Clients" },
  { value: "annual", label: "Annual invoices" },
  { value: "auth", label: "Auth" },
  { value: "errors", label: "Errors only" }
];

function actionLabel(value) {
  if (auditActionLabels[value]) return auditActionLabels[value];
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function entityLabel(value) {
  if (auditEntityLabels[value]) return auditEntityLabels[value];
  return actionLabel(value);
}

function auditCategory(event) {
  if (event.entityType === "auth") return "auth";
  if (event.entityType === "billing_client") return "clients";
  if (event.entityType === "annual_invoice_usage") return "annual";
  if (String(event.action || "").startsWith("xero_") || event.action === "send_to_xero" || event.entityType === "xero_document" || event.entityType === "xero") return "xero";
  if (["quote_preview", "teamwork_time_entry"].includes(event.entityType)) return "documents";
  return "all";
}

function auditIsError(event) {
  const metadata = event.metadata || {};
  return event.action === "login_failed" || metadata.failed > 0 || String(metadata.status || "").toLowerCase() === "error";
}

function auditTone(event) {
  if (auditIsError(event)) return "danger";
  if (["send_to_xero", "xero_connect", "xero_status_refresh"].includes(event.action) && !auditIsError(event)) return "success";
  return "neutral";
}

function auditStatusLabel(event) {
  if (auditIsError(event)) return "Needs review";
  if (event.action === "send_to_xero") return "Sent";
  if (event.action === "xero_status_refresh") return "Synced";
  if (event.action === "xero_connect") return "Connected";
  return "Logged";
}

function canOpenAuditDocument(event) {
  return event.entityType === "xero_document" && Boolean(event.entityId);
}

function AuditLogView() {
  const [actionFilter, setActionFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState("all");
  const [auditData, setAuditData] = useState({ actions: [], actors: [], entityTypes: [], events: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedDocumentDetail, setSelectedDocumentDetail] = useState(null);
  const [selectedDocumentError, setSelectedDocumentError] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedDocumentLoading, setSelectedDocumentLoading] = useState(false);
  const [selectedDocumentRefreshing, setSelectedDocumentRefreshing] = useState(false);

  async function loadAuditEvents() {
    setLoading(true);
    setError("");
    try {
      setAuditData(await getAuditEvents({
        action: actionFilter,
        actor: actorFilter,
        entityType: entityTypeFilter
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAuditEvents();
  }, [actionFilter, actorFilter, entityTypeFilter]);

  const events = useMemo(
    () =>
      (auditData.events || []).filter((event) => {
        if (categoryFilter === "errors") return auditIsError(event);
        if (categoryFilter === "all") return true;
        return auditCategory(event) === categoryFilter;
      }),
    [auditData.events, categoryFilter]
  );

  async function openAuditDocument(documentId) {
    if (!documentId) return;
    setSelectedDocumentId(documentId);
    setSelectedDocumentDetail(null);
    setSelectedDocumentError("");
    setSelectedDocumentLoading(true);
    try {
      setSelectedDocumentDetail(await getBillingQuoteDetail(documentId));
    } catch (err) {
      setSelectedDocumentError(err.message);
    } finally {
      setSelectedDocumentLoading(false);
    }
  }

  async function refreshAuditDocumentStatus() {
    if (!selectedDocumentId) return;
    setSelectedDocumentRefreshing(true);
    setSelectedDocumentError("");
    try {
      await syncBillingQuoteXeroStatus(selectedDocumentId);
      setSelectedDocumentDetail(await getBillingQuoteDetail(selectedDocumentId));
      await loadAuditEvents();
    } catch (err) {
      setSelectedDocumentError(err.message);
    } finally {
      setSelectedDocumentRefreshing(false);
    }
  }

  useEscapeToClose(() => setSelectedEvent(null), Boolean(selectedEvent) && !selectedDocumentId);

  return (
    <Fragment>
      <section className="panel full-panel audit-log-panel">
        <div className="table-toolbar">
          <div className="table-toolbar-heading">
            <p>Admin</p>
            <h2>Audit Log</h2>
          </div>
          <div className="docs-filter-group" aria-label="Audit filters">
            <label>
              <span>Category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                {auditCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Action</span>
              <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
                <option value="all">All actions</option>
                {(auditData.actions || []).map((action) => (
                  <option key={action} value={action}>{actionLabel(action)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Entity</span>
              <select value={entityTypeFilter} onChange={(event) => setEntityTypeFilter(event.target.value)}>
                <option value="all">All entities</option>
                {(auditData.entityTypes || []).map((entityType) => (
                  <option key={entityType} value={entityType}>{actionLabel(entityType)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>User</span>
              <select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
                <option value="all">All users</option>
                {(auditData.actors || []).map((actor) => (
                  <option key={actor} value={actor}>{actor}</option>
                ))}
              </select>
            </label>
            <button className="secondary-button" disabled={loading} onClick={loadAuditEvents} type="button">
              {loading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              Refresh
            </button>
          </div>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="table-wrap">
          <table className="quotes-table audit-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Status</th>
                <th>Entity</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const tone = auditTone(event);
                return (
                  <tr className={`clickable-row audit-row audit-row--${tone}`} key={event.id} onClick={() => setSelectedEvent(event)}>
                    <td>{formattedDateTime(event.createdAt)}</td>
                    <td>{event.actor}</td>
                    <td>{actionLabel(event.action)}</td>
                    <td>
                      <span className={`audit-status-pill audit-status-pill--${tone}`}>{auditStatusLabel(event)}</span>
                    </td>
                    <td>
                      <div className="audit-entity-cell">
                        <span>{entityLabel(event.entityType)}{event.entityId ? ` / ${event.entityId.slice(0, 8)}` : ""}</span>
                        {canOpenAuditDocument(event) ? (
                          <button
                            className="inline-link-button"
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation();
                              openAuditDocument(event.entityId);
                            }}
                            type="button"
                          >
                            Open document
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td>{event.summary || ""}</td>
                  </tr>
                );
              })}
              {!events.length ? (
                <tr>
                  <td className="empty-cell" colSpan="6">
                    {loading ? "Loading audit events." : "No audit events match these filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedEvent ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="audit-event-title" className="settings-modal audit-event-modal">
            <div className="settings-modal-header">
              <div>
                <p>Audit Event</p>
                <h2 id="audit-event-title">{actionLabel(selectedEvent.action)}</h2>
                <span>{formattedDateTime(selectedEvent.createdAt)} by {selectedEvent.actor}</span>
              </div>
              <button aria-label="Close audit event" className="modal-close-button" onClick={() => setSelectedEvent(null)} type="button">
                <X size={21} />
              </button>
            </div>
            <dl className="document-meta-grid audit-event-meta">
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`audit-status-pill audit-status-pill--${auditTone(selectedEvent)}`}>{auditStatusLabel(selectedEvent)}</span>
                </dd>
              </div>
              <div>
                <dt>Entity</dt>
                <dd>{entityLabel(selectedEvent.entityType) || "Not set"}</dd>
              </div>
              <div>
                <dt>Entity ID</dt>
                <dd>{selectedEvent.entityId || "Not set"}</dd>
              </div>
              <div>
                <dt>Summary</dt>
                <dd>{selectedEvent.summary || "No summary"}</dd>
              </div>
            </dl>
            {canOpenAuditDocument(selectedEvent) ? (
              <button className="secondary-button audit-open-document-button" onClick={() => openAuditDocument(selectedEvent.entityId)} type="button">
                <FileText size={17} />
                Open document
              </button>
            ) : null}
            <h3 className="json-preview-title">Technical details</h3>
            <pre className="json-preview">{JSON.stringify(selectedEvent.metadata || {}, null, 2)}</pre>
          </section>
        </div>
      ) : null}

      {selectedDocumentId ? (
        <BillingDocumentDetailModal
          detail={selectedDocumentDetail}
          error={selectedDocumentError}
          loading={selectedDocumentLoading}
          refreshingStatus={selectedDocumentRefreshing}
          onClose={() => {
            setSelectedDocumentId("");
            setSelectedDocumentDetail(null);
            setSelectedDocumentError("");
          }}
          onRefreshStatus={refreshAuditDocumentStatus}
        />
      ) : null}
    </Fragment>
  );
}

function BillingClientsView({ clients, loading, onRefresh, onSave, xeroAccounts, xeroContacts, xeroTaxRates }) {
  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const filtered = useMemo(() => {
    const normalized = query.toLowerCase();
    return clients.filter((client) =>
      [client.displayName, client.teamworkProjectName, client.xeroClientName, client.taxRateName, statusLabel(statusForClient(client))]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [clients, query]);
  const allActiveClients = clients.filter((client) => statusForClient(client) === "active");
  const allInactiveClients = clients.filter((client) => statusForClient(client) === "inactive");
  const allExcludedClients = clients.filter((client) => statusForClient(client) === "excluded");
  const activeClients = filtered.filter((client) => statusForClient(client) === "active");
  const inactiveClients = filtered.filter((client) => statusForClient(client) === "inactive");
  const excludedClients = filtered.filter((client) => statusForClient(client) === "excluded");
  const unmappedClients = allActiveClients.filter((client) => !client.xeroClientName);
  const unmappedPercent = allActiveClients.length ? Math.round((unmappedClients.length / allActiveClients.length) * 100) : 0;

  return (
    <Fragment>
      <div className="client-stat-grid" aria-label="Client status summary">
        <ClientStatsCard label="Active clients" value={wholeNumber.format(allActiveClients.length)} />
        <ClientStatsCard
          detail={`${wholeNumber.format(unmappedClients.length)} unmapped`}
          label="Unmapped clients"
          tone={unmappedClients.length > 0 ? "danger" : ""}
          value={`${wholeNumber.format(unmappedPercent)}%`}
        />
        <ClientStatsCard label="Inactive clients" value={wholeNumber.format(allInactiveClients.length)} />
        <ClientStatsCard label="Excluded clients" value={wholeNumber.format(allExcludedClients.length)} />
      </div>

      <section className="panel full-panel">
        <div className="panel-heading">
          <div>
            <p>Billing</p>
            <h2>Clients</h2>
          </div>
          <div className="toolbar-actions">
            <label className="search-field">
              <Search size={16} />
              <input placeholder="Search clients" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">
              {loading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              Refresh
            </button>
          </div>
        </div>

        <BillingClientsTable
          clients={activeClients}
          emptyMessage={query ? "No active clients match this search." : "No active clients found."}
          loading={loading}
          onSelect={setSelectedClient}
        />
      </section>

      {inactiveClients.length ? (
        <section className={`panel full-panel muted-panel collapsible-panel ${inactiveOpen ? "is-open" : ""}`}>
          <button
            aria-expanded={inactiveOpen}
            className="collapsible-panel-heading"
            onClick={() => setInactiveOpen((current) => !current)}
            type="button"
          >
            <span>
              <h2>Inactive clients</h2>
            </span>
            <span className="collapsible-panel-count">
              <ChevronDown className="nav-chevron" size={18} />
              <strong>{inactiveClients.length} inactive</strong>
            </span>
          </button>
          {inactiveOpen ? (
            <BillingClientsTable
              clients={inactiveClients}
              emptyMessage="No inactive clients found."
              loading={false}
              onSelect={setSelectedClient}
            />
          ) : null}
        </section>
      ) : null}

      {excludedClients.length ? (
        <section className={`panel full-panel excluded-panel collapsible-panel ${excludedOpen ? "is-open" : ""}`}>
          <button
            aria-expanded={excludedOpen}
            className="collapsible-panel-heading"
            onClick={() => setExcludedOpen((current) => !current)}
            type="button"
          >
            <span>
              <h2>Excluded Clients / Projects</h2>
            </span>
            <span className="collapsible-panel-count">
              <ChevronDown className="nav-chevron" size={18} />
              <strong>{excludedClients.length} excluded</strong>
            </span>
          </button>
          {excludedOpen ? (
            <BillingClientsTable
              clients={excludedClients}
              emptyMessage="No excluded clients or projects found."
              loading={false}
              onSelect={setSelectedClient}
            />
          ) : null}
        </section>
      ) : null}

      {selectedClient ? (
        <BillingClientModal
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onSave={async (draft) => {
            const saved = await onSave(draft);
            setSelectedClient((current) => (current ? { ...current, ...saved } : current));
          }}
          xeroAccounts={xeroAccounts}
          xeroContacts={xeroContacts}
          xeroTaxRates={xeroTaxRates}
        />
      ) : null}
    </Fragment>
  );
}

function annualUsageKey(clientId, serviceId) {
  return `${clientId}:${serviceId}`;
}

function annualDraftFromUsage(usage) {
  return {
    annualHours: usage?.annualHours ?? "",
    usedHours: usage?.usedHours ?? 0
  };
}

function AnnualInvoicesView() {
  const [year, setYear] = useState(2026);
  const [years, setYears] = useState([2025, 2026]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [usageByCell, setUsageByCell] = useState({});
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState({ tone: "saved", text: "Saved" });
  const [error, setError] = useState("");
  const autosaveTimers = useRef({});
  const autosaveVersions = useRef({});
  const draftsRef = useRef({});
  const usageByCellRef = useRef({});
  const yearRef = useRef(year);

  function setDraftsState(nextDrafts) {
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
  }

  function setUsageByCellState(nextUsageByCell) {
    usageByCellRef.current = nextUsageByCell;
    setUsageByCell(nextUsageByCell);
  }

  async function loadAnnualInvoices(nextYear = year) {
    setLoading(true);
    setError("");
    try {
      const payload = await getAnnualInvoices(nextYear);
      const nextUsageByCell = Object.fromEntries(
        (payload.usage || []).map((usage) => [annualUsageKey(usage.billingClientId, usage.serviceId), usage])
      );
      const nextDrafts = {};

      for (const client of payload.clients || []) {
        for (const service of payload.services || []) {
          const key = annualUsageKey(client.id, service.id);
          nextDrafts[key] = annualDraftFromUsage(nextUsageByCell[key]);
        }
      }

      setClients(payload.clients || []);
      setServices(payload.services || []);
      setUsageByCellState(nextUsageByCell);
      setDraftsState(nextDrafts);
      setYears(payload.years || [2025, 2026]);
      setYear(Number(payload.year || nextYear));
      setAutosaveStatus({ tone: "saved", text: "Saved" });
    } catch (err) {
      setError(err.message);
      setAutosaveStatus({ tone: "error", text: "Not saved" });
    } finally {
      setLoading(false);
    }
  }

  async function saveCell(clientId, serviceId, draftOverride, version, targetYear = year) {
    const key = annualUsageKey(clientId, serviceId);
    const draft = annualDraftFromUsage(draftOverride || draftsRef.current[key]);
    const current = annualDraftFromUsage(usageByCellRef.current[key]);

    if (
      String(draft.annualHours ?? "") === String(current.annualHours ?? "") &&
      String(draft.usedHours ?? 0) === String(current.usedHours ?? 0)
    ) {
      setAutosaveStatus({ tone: "saved", text: "Saved" });
      return;
    }

    setAutosaveStatus({ tone: "saving", text: "Saving..." });
    setError("");
    try {
      const payload = await updateAnnualInvoiceUsage({
        annualHours: draft.annualHours,
        billingClientId: clientId,
        serviceId,
        usedHours: draft.usedHours,
        year: targetYear
      });
      const usage = payload.usage;
      if (Number(yearRef.current) === Number(targetYear)) {
        const nextUsageByCell = { ...usageByCellRef.current, [key]: usage };
        setUsageByCellState(nextUsageByCell);
        if (autosaveVersions.current[key] === version) {
          const nextDrafts = { ...draftsRef.current, [key]: annualDraftFromUsage(usage) };
          setDraftsState(nextDrafts);
        }
      }
      setAutosaveStatus({ tone: "saved", text: "Saved" });
    } catch (err) {
      setError(err.message);
      setAutosaveStatus({ tone: "error", text: "Not saved" });
    }
  }

  function scheduleAutosave(clientId, serviceId, nextDraft) {
    const key = annualUsageKey(clientId, serviceId);
    const version = (autosaveVersions.current[key] || 0) + 1;
    autosaveVersions.current[key] = version;
    if (autosaveTimers.current[key]) clearTimeout(autosaveTimers.current[key]);
    setAutosaveStatus({ tone: "saving", text: "Saving..." });
    autosaveTimers.current[key] = setTimeout(() => {
      delete autosaveTimers.current[key];
      saveCell(clientId, serviceId, nextDraft, version, year);
    }, 700);
  }

  function flushAutosave(clientId, serviceId) {
    const key = annualUsageKey(clientId, serviceId);
    const version = autosaveVersions.current[key] || 0;
    if (autosaveTimers.current[key]) {
      clearTimeout(autosaveTimers.current[key]);
      delete autosaveTimers.current[key];
    }
    saveCell(clientId, serviceId, draftsRef.current[key], version, year);
  }

  function updateDraft(clientId, serviceId, field, value) {
    const key = annualUsageKey(clientId, serviceId);
    const nextDraft = {
      ...annualDraftFromUsage(draftsRef.current[key]),
      [field]: value
    };
    const nextDrafts = { ...draftsRef.current, [key]: nextDraft };
    setDraftsState(nextDrafts);
    scheduleAutosave(clientId, serviceId, nextDraft);
  }

  useEffect(() => {
    yearRef.current = year;
    loadAnnualInvoices(year);
  }, [year]);

  useEffect(
    () => () => {
      Object.values(autosaveTimers.current).forEach((timer) => clearTimeout(timer));
    },
    []
  );

  const filledCells = Object.values(usageByCell).filter(
    (usage) => usage.annualHours !== "" || Number(usage.usedHours || 0) > 0
  ).length;

  return (
    <Fragment>
      <div className="client-stat-grid" aria-label="Annual invoice summary">
        <ClientStatsCard label="Clients" value={wholeNumber.format(clients.length)} />
        <ClientStatsCard label="Services" value={wholeNumber.format(services.length)} />
        <ClientStatsCard label="Filled cells" value={wholeNumber.format(filledCells)} />
        <ClientStatsCard label="Year" value={year} />
      </div>

      <section className="panel full-panel annual-invoices-panel">
        <div className="panel-heading">
          <div>
            <p>Billing</p>
            <h2>Annual Invoices</h2>
          </div>
          <div className="annual-toolbar">
            <div className="year-tabs" aria-label="Annual invoice years">
              {years.map((yearOption) => (
                <button
                  aria-pressed={Number(yearOption) === Number(year)}
                  key={yearOption}
                  type="button"
                  onClick={() => setYear(Number(yearOption))}
                >
                  {yearOption}
                </button>
              ))}
            </div>
            <span className={`autosave-notice ${autosaveStatus.tone}`} aria-live="polite">
              {autosaveStatus.text}
            </span>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="table-wrap annual-invoices-wrap">
          <table className="annual-invoices-table">
            <thead>
              <tr>
                <th>Client</th>
                {services.map((service) => (
                  <th key={service.id}>
                    <span>{service.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.displayName}</strong>
                  </td>
                  {services.map((service) => {
                    const key = annualUsageKey(client.id, service.id);
                    const draft = annualDraftFromUsage(drafts[key]);

                    return (
                      <td key={service.id}>
                        <div className="annual-hours-cell">
                          <label>
                            <span>Pre-paid</span>
                            <input
                              aria-label={`${client.displayName} ${service.label} pre-paid hours`}
                              disabled={loading}
                              min="0"
                              step="0.25"
                              type="number"
                              value={draft.annualHours}
                              onChange={(event) => updateDraft(client.id, service.id, "annualHours", event.target.value)}
                              onBlur={() => flushAutosave(client.id, service.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") flushAutosave(client.id, service.id);
                              }}
                            />
                          </label>
                          <label>
                            <span>Used</span>
                            <input
                              aria-label={`${client.displayName} ${service.label} used hours`}
                              disabled={loading}
                              min="0"
                              step="0.25"
                              type="number"
                              value={draft.usedHours}
                              onChange={(event) => updateDraft(client.id, service.id, "usedHours", event.target.value)}
                              onBlur={() => flushAutosave(client.id, service.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") flushAutosave(client.id, service.id);
                              }}
                            />
                          </label>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!clients.length ? (
                <tr>
                  <td className="empty-cell" colSpan={services.length + 1}>
                    {loading ? "Loading annual invoices." : "No active clients found."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </Fragment>
  );
}

function Shell({ onLogout, onUserUpdated, user }) {
  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const [currentDraftId, setCurrentDraftId] = useState(() => typeof window === "undefined" ? "" : routeFromHash(window.location.hash).draftId);
  const [currentDraft, setCurrentDraft] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [archivedDrafts, setArchivedDrafts] = useState([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [editorSession] = useState(editorSessionId);
  const draftSaveControllerRef = useRef(null);
  const activeTabRef = useRef(activeTab);
  const currentDraftIdRef = useRef(currentDraftId);
  const hashNavigationVersionRef = useRef(0);
  const [range, setRange] = useState({ endDate: today(), startDate: "2026-01-01" });
  const [report, setReport] = useState(null);
  const [reportingSourceStatus, setReportingSourceStatus] = useState(null);
  const [billingClients, setBillingClients] = useState([]);
  const [billingClientsLoading, setBillingClientsLoading] = useState(false);
  const [billingQuotes, setBillingQuotes] = useState([]);
  const [billingQuotesLoading, setBillingQuotesLoading] = useState(false);
  const [annualInvoiceYears, setAnnualInvoiceYears] = useState([new Date().getFullYear() - 1]);
  const [xeroAccounts, setXeroAccounts] = useState([]);
  const [xeroContacts, setXeroContacts] = useState([]);
  const [xeroTaxRates, setXeroTaxRates] = useState([]);
  const [navGroupsOpen, setNavGroupsOpen] = useState({ billing: true, reporting: true });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const monthOptions = useMemo(() => dataMonthOptions(report?.yearTrend), [report?.yearTrend]);
  const isReportingTab = activeTab.startsWith("reporting-");
  const isDocsTab = activeTab === "billing-quotes";
  const isAdmin = Array.isArray(user?.roles) && user.roles.includes("admin");
  const visibleBillingTabs = useMemo(() => billingTabs.filter((tab) => !tab.adminOnly || isAdmin), [isAdmin]);
  const docsMonthOptions = useMemo(() => quoteMonthOptions(billingQuotes), [billingQuotes]);
  const filteredBillingQuotes = useMemo(
    () => billingQuotes.filter((quote) => quoteMatchesRange(quote, range)),
    [billingQuotes, range.endDate, range.startDate]
  );

  activeTabRef.current = activeTab;
  currentDraftIdRef.current = currentDraftId;

  useEffect(() => {
    if (activeTab === "billing-operations" && !isAdmin) {
      setActiveTab("billing-quotes");
      persistActiveTab("billing-quotes");
    }
  }, [activeTab, isAdmin]);

  async function loadSummary(nextRange = range) {
    setLoading(true);
    setError("");
    try {
      const [nextReport, nextSourceStatus] = await Promise.all([
        getSummary(nextRange),
        getReportingSourceStatus().catch(() => null)
      ]);
      setReport(nextReport);
      if (nextSourceStatus) setReportingSourceStatus(nextSourceStatus);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadBillingClients(options = {}) {
    setBillingClientsLoading(true);
    setError("");
    try {
      const [clientsPayload, xeroPayload] = await Promise.all([
        getBillingClients(),
        getXeroReference({ force: options.forceXero === true })
      ]);
      setBillingClients(clientsPayload.clients || []);
      setXeroAccounts(xeroPayload.accounts || []);
      setXeroContacts(xeroPayload.contacts || []);
      setXeroTaxRates(xeroPayload.taxRates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBillingClientsLoading(false);
    }
  }

  async function loadBillingQuotes() {
    setBillingQuotesLoading(true);
    setError("");
    try {
      const payload = await getBillingQuotes();
      setBillingQuotes(payload.quotes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBillingQuotesLoading(false);
    }
  }

  async function loadQuoteDraftLists() {
    try {
      const payload = await getQuoteDrafts(editorSession);
      setDrafts(payload.drafts || []);
      setArchivedDrafts(payload.archived || []);
    } catch (err) {
      setError(err.message);
    }
  }

  function mergeCurrentDraft(nextPreview) {
    if (!nextPreview) return;
    if (nextPreview.status && nextPreview.status !== "preview") {
      setCurrentDraft(null);
      setCurrentDraftId("");
      setActiveTab("billing-quotes");
      loadBillingQuotes();
      loadQuoteDraftLists();
      return;
    }
    setCurrentDraft((current) => {
      if (!current || current.id !== nextPreview.id) return nextPreview;
      return {
        ...current,
        ...nextPreview,
        billingClient: nextPreview.billingClient || current.billingClient,
        lines: nextPreview.lines || current.lines,
        period: nextPreview.period || current.period,
        services: nextPreview.services || current.services,
        totals: nextPreview.totals || current.totals,
        warnings: nextPreview.warnings || current.warnings
      };
    });
    if (nextPreview.id) setCurrentDraftId(nextPreview.id);
  }

  async function openDraft(draft) {
    setDraftLoading(true);
    setError("");
    try {
      const payload = await acquireQuoteDraft(draft.id, editorSession);
      setCurrentDraft(payload.preview);
      setCurrentDraftId(draft.id);
      setActiveTab("billing-create-quote");
      persistActiveTab("billing-create-quote", draft.id);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setDraftLoading(false);
    }
  }

  async function restoreDraft(draft) {
    setDraftLoading(true);
    setError("");
    try {
      const payload = await restoreQuoteDraft(draft.id, {
        editorSessionId: editorSession,
        version: draft.version
      });
      setCurrentDraft(payload.preview);
      setCurrentDraftId(draft.id);
      setActiveTab("billing-create-quote");
      persistActiveTab("billing-create-quote", draft.id);
      await loadQuoteDraftLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setDraftLoading(false);
    }
  }

  function handleDraftArchived() {
    setCurrentDraft(null);
    setCurrentDraftId("");
    setActiveTab("billing-quotes");
    loadQuoteDraftLists();
  }

  async function refreshBillingQuotesFromXero() {
    setBillingQuotesLoading(true);
    setError("");
    try {
      await syncBillingQuotesXeroStatus();
      const payload = await getBillingQuotes();
      setBillingQuotes(payload.quotes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBillingQuotesLoading(false);
    }
  }

  async function loadAnnualInvoiceYears() {
    try {
      const payload = await getAnnualInvoices();
      setAnnualInvoiceYears(payload.years || [new Date().getFullYear() - 1]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveBillingClient(client) {
    const payload = await updateBillingClient(client.id, client);
    const saved = payload.client || client;
    setBillingClients((current) =>
      current.map((item) => (item.id === client.id ? { ...item, ...saved } : item))
    );
    return saved;
  }

  function handlePreviewCreated(preview) {
    mergeCurrentDraft(preview);
    if (preview?.id) persistActiveTab("billing-create-quote", preview.id);
    const clientId = preview?.billingClient?.id;
    if (!clientId) return;
    setBillingClients((current) =>
      current.map((client) =>
        client.id === clientId ? { ...client, quoteCount: Number(client.quoteCount || 0) + 1 } : client
      )
    );
  }

  async function handleRefresh() {
    if (demoMode) return;
    setRefreshing(true);
    setError("");
    try {
      setReport(await refreshSummary(range));
      setReportingSourceStatus(await getReportingSourceStatus());
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  function toggleNavGroup(group) {
    setNavGroupsOpen((current) => ({ ...current, [group]: !current[group] }));
  }

  const registerDraftSaveController = useCallback((controller) => {
    draftSaveControllerRef.current = controller;
  }, []);

  async function flushDraftBeforeLeaving() {
    if (activeTab !== "billing-create-quote" || !draftSaveControllerRef.current) return true;
    try {
      await draftSaveControllerRef.current.flush();
      return true;
    } catch (saveError) {
      setError(`Couldn’t leave this draft because its latest changes were not saved. ${saveError.message}`);
      return false;
    }
  }

  async function navigateToTab(nextTab) {
    if (nextTab === activeTab) return;
    if (!(await flushDraftBeforeLeaving())) return;
    setError("");
    setActiveTab(nextTab);
  }

  async function handleLogoutRequest() {
    if (!(await flushDraftBeforeLeaving())) return;
    await onLogout(editorSession);
  }

  useEffect(() => {
    persistActiveTab(activeTab, activeTab === "billing-create-quote" ? currentDraftId : "");
  }, [activeTab, currentDraftId]);

  useEffect(() => {
    function handleHashChange() {
      const navigationVersion = hashNavigationVersionRef.current + 1;
      hashNavigationVersionRef.current = navigationVersion;
      const route = routeFromHash(window.location.hash);
      if (!route.tab) return;

      const previousTab = activeTabRef.current;
      const previousDraftId = currentDraftIdRef.current;
      const leavingCurrentDraft = previousTab === "billing-create-quote" && (
        route.tab !== "billing-create-quote" || (route.draftId && route.draftId !== previousDraftId)
      );

      Promise.resolve()
        .then(async () => {
          if (leavingCurrentDraft && draftSaveControllerRef.current) {
            await draftSaveControllerRef.current.flush();
          }
          if (hashNavigationVersionRef.current !== navigationVersion) return;
          setError("");
          setActiveTab(route.tab);
          if (route.draftId) setCurrentDraftId(route.draftId);
        })
        .catch((saveError) => {
          if (hashNavigationVersionRef.current !== navigationVersion) return;
          const previousHash = previousTab === "billing-create-quote" && previousDraftId
            ? `#billing-create-quote/${previousDraftId}`
            : `#${previousTab}`;
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${previousHash}`);
          setError(`Couldn't leave this draft because its latest changes were not saved. ${saveError.message}`);
        });
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (activeTab !== "billing-create-quote" || !currentDraftId || currentDraft?.id === currentDraftId) return;
    let cancelled = false;
    setDraftLoading(true);
    setError("");
    acquireQuoteDraft(currentDraftId, editorSession)
      .then((payload) => {
        if (!cancelled) setCurrentDraft(payload.preview || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, currentDraft?.id, currentDraftId, editorSession]);

  useEffect(() => {
    if (isReportingTab) loadSummary(range);
  }, [range.startDate, range.endDate, isReportingTab]);

  useEffect(() => {
    if (activeTab === "billing-clients" || activeTab === "billing-create-quote") loadBillingClients();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "billing-create-quote" || activeTab === "billing-annual-invoices") loadAnnualInvoiceYears();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "billing-quotes") {
      loadBillingQuotes();
      loadQuoteDraftLists();
    }
  }, [activeTab]);

  return (
    <main className="app-shell">
      <aside className="side-rail">
        <div>
          <div className="brand-block">
            <BrandLogo className="brand-logo-rail" />
          </div>
          <nav aria-label="Main navigation">
            <div className="nav-section grouped-nav-section">
              <button
                aria-controls="reporting-nav"
                aria-expanded={navGroupsOpen.reporting}
                className="nav-parent"
                onClick={() => toggleNavGroup("reporting")}
                title="Reporting"
                type="button"
              >
                <BarChart3 size={18} />
                <span className="nav-label">Reporting</span>
                <ChevronDown className="nav-chevron" size={16} />
              </button>
              <div className="nav-submenu" aria-label="Reporting" hidden={!navGroupsOpen.reporting} id="reporting-nav">
                {reportingTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      className={`nav-subitem ${activeTab === tab.id ? "active" : ""}`}
                      key={tab.id}
                      onClick={() => navigateToTab(tab.id)}
                      title={tab.label}
                      type="button"
                    >
                      <Icon size={17} />
                      <span className="nav-label">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="nav-section grouped-nav-section">
              <button
                aria-controls="billing-nav"
                aria-expanded={navGroupsOpen.billing}
                className="nav-parent"
                onClick={() => toggleNavGroup("billing")}
                title="Billing"
                type="button"
              >
                <Euro size={18} />
                <span className="nav-label">Billing</span>
                <ChevronDown className="nav-chevron" size={16} />
              </button>
              <div className="nav-submenu" aria-label="Billing" hidden={!navGroupsOpen.billing} id="billing-nav">
                {visibleBillingTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      className={`nav-subitem ${activeTab === tab.id ? "active" : ""}`}
                      key={tab.id}
                      onClick={() => navigateToTab(tab.id)}
                      title={tab.label}
                      type="button"
                    >
                      <Icon size={17} />
                      <span className="nav-label">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="nav-section nav-disabled-section" aria-label="Unavailable sections">
              {disabledNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button className="nav-disabled" disabled key={item.id} title={`${item.label} unavailable`} type="button">
                    <Icon size={17} />
                    <span className="nav-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
        <div className="rail-footer">
          <button aria-label="Account settings" className="rail-account-button" onClick={() => setAccountModalOpen(true)} type="button">
            <UserRound size={18} />
            <span className="rail-user-name">{user?.name || user?.email || "Account"}</span>
          </button>
          {demoMode ? null : (
            <button aria-label="Sign out" onClick={handleLogoutRequest} type="button">
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>

      <section className="main-surface">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{titleForTab(activeTab)}</h1>
          </div>
          {isReportingTab || isDocsTab ? (
            <PeriodSelector
              demo={demoMode}
              monthOptions={isDocsTab ? docsMonthOptions : monthOptions}
              range={range}
              refreshLabel={isDocsTab ? "Refresh docs" : undefined}
              refreshTitle={isDocsTab ? "Refresh Docs" : undefined}
              refreshing={isDocsTab ? billingQuotesLoading : refreshing}
              setRange={setRange}
              syncStatus={isDocsTab ? null : reportingSourceStatus}
              onRefresh={isDocsTab ? refreshBillingQuotesFromXero : handleRefresh}
            />
          ) : null}
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {activeTab === "billing-create-quote" ? (
          <div className="content-stack" data-testid="billing-create-draft-workspace">
            {draftLoading ? <div className="loading-state inline-loading"><Loader2 className="spin" size={20} /><span>Opening draft</span></div> : null}
            <BillingCreateQuoteView
              annualYears={annualInvoiceYears}
              clients={billingClients}
              editorSession={editorSession}
              loading={billingClientsLoading || draftLoading}
              onArchive={handleDraftArchived}
              onSaveControllerChange={registerDraftSaveController}
              onPreviewChange={mergeCurrentDraft}
              onPreviewCreated={handlePreviewCreated}
              preview={currentDraft}
              xeroTaxRates={xeroTaxRates}
            />
          </div>
        ) : isReportingTab && loading && !report ? (
          <div className="loading-state">
            <Loader2 className="spin" size={28} />
            <span>Loading stored Teamwork reporting data</span>
          </div>
        ) : (
          <div className="content-stack">
            {activeTab === "reporting-overview" ? <Overview report={report} /> : null}
            {activeTab === "reporting-people" ? <PeopleView rows={report?.byUser || []} /> : null}
            {activeTab === "reporting-projects" ? <ProjectsView rows={report?.byClient || []} /> : null}
            {activeTab === "billing-quotes" ? (
              <BillingQuotesView
                archivedDrafts={archivedDrafts}
                drafts={drafts}
                loading={billingQuotesLoading}
                onOpenDraft={openDraft}
                onRefresh={loadBillingQuotes}
                onRestoreDraft={restoreDraft}
                quotes={filteredBillingQuotes}
              />
            ) : null}
            {activeTab === "billing-annual-invoices" ? <AnnualInvoicesView /> : null}
            {activeTab === "billing-clients" ? (
              <BillingClientsView
                clients={billingClients}
                loading={billingClientsLoading}
                onRefresh={() => loadBillingClients({ forceXero: true })}
                onSave={saveBillingClient}
                xeroAccounts={xeroAccounts}
                xeroContacts={xeroContacts}
                xeroTaxRates={xeroTaxRates}
              />
            ) : null}
            {activeTab === "billing-audit-log" ? <AuditLogView /> : null}
            {activeTab === "billing-operations" && isAdmin ? (
              <Suspense fallback={<div className="loading-state inline-loading"><Loader2 className="spin" size={20} /><span>Loading operations</span></div>}>
                <OperationsView />
              </Suspense>
            ) : null}
          </div>
        )}
      </section>
      {accountModalOpen ? (
        <AccountSettingsModal
          user={user}
          onClose={() => setAccountModalOpen(false)}
          onSaved={onUserUpdated}
        />
      ) : null}
    </main>
  );
}

export function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  async function refreshSession() {
    const nextSession = await getSession();
    setSession(nextSession);
  }

  async function handleLogout(editorSession = "") {
    if (demoMode) return;
    await logout(editorSession);
    persistActiveTab("billing-quotes");
    setSession({ authenticated: false });
  }

  useEffect(() => {
    refreshSession().finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <main className="loading-state full-page">
        <Loader2 className="spin" size={28} />
        <span>Opening ZIFFER reporting</span>
      </main>
    );
  }

  if (!session?.authenticated) {
    return <LoginScreen onAuthenticated={refreshSession} />;
  }

  return (
    <Shell
      onLogout={handleLogout}
      onUserUpdated={(user) => setSession((current) => ({ ...(current || {}), authenticated: true, user }))}
      user={session.user}
    />
  );
}
