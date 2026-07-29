export const inlineQuoteLineFields = ["taskName", "quantityHours", "unitAmount", "discount"];

export function inlineQuoteLineDraftValue(line = {}, field) {
  if (field === "taskName") return line.taskName || line.description || "";
  const value = Number(line[field] || 0);
  return Number.isFinite(value) ? String(value) : "0";
}

export function normalizeInlineQuoteLineValue(field, value) {
  if (field === "taskName") {
    const taskName = String(value || "").trim().replace(/\s+/g, " ");
    if (!taskName) throw new Error("Task name is required.");
    return taskName;
  }
  if (field === "discount") {
    const normalized = String(value ?? 0).replace("%", "").replace(",", ".").trim();
    const discount = Number(normalized);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      throw new Error("Use a discount between 0 and 100%.");
    }
    return discount;
  }
  const label = field === "quantityHours" ? "Hours" : "Rate";
  const normalized = String(value ?? "").replace(",", ".").trim();
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or more.`);
  return number;
}

export function sourceHoursForQuoteLine(line = {}) {
  return Math.round((line.entries || []).reduce((sum, entry) => sum + Number(entry.hours || 0), 0) * 10000) / 10000;
}

export function hasQuoteLineHoursOverride(line = {}) {
  if (!(line.entries || []).length || line.annualCovered || (line.annualCoverage || []).length || (line.annualBilling || []).length) return false;
  return Math.abs(sourceHoursForQuoteLine(line) - Number(line.quantityHours || 0)) > 0.00005;
}
