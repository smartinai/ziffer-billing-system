const monthNumbers = new Map([
  ["jan", 1], ["january", 1],
  ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4],
  ["may", 5],
  ["jun", 6], ["june", 6],
  ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12]
]);

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${pad(month)}-${pad(day)}`;
}

function monthEnd(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonths(year, month, delta) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
}

function period(startDate, endDate, source) {
  if (!startDate || !endDate || startDate > endDate) return null;
  return {
    endDate,
    key: `${startDate}:${endDate}`,
    source,
    startDate
  };
}

export function isMaintainCorporateRecordsTask(taskName) {
  return /\bmaintain(?:ing)?\s+corporate\s+records\b/i.test(String(taskName || ""));
}

export function parseMaintainCorporateRecordsPeriod(taskName) {
  const title = String(taskName || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!isMaintainCorporateRecordsTask(title)) return null;

  const exactRange = title.match(
    /\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\s*-\s*(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/
  );
  if (exactRange) {
    return period(
      isoDate(Number(exactRange[3]), Number(exactRange[2]), Number(exactRange[1])),
      isoDate(Number(exactRange[6]), Number(exactRange[5]), Number(exactRange[4])),
      "exact_dates"
    );
  }

  const monthPattern = [...monthNumbers.keys()].sort((a, b) => b.length - a.length).join("|");
  const monthRange = title.match(new RegExp(`\\b(${monthPattern})\\s+(20\\d{2})\\s*-\\s*(${monthPattern})\\s+(20\\d{2})\\b`, "i"));
  if (monthRange) {
    const startMonth = monthNumbers.get(monthRange[1].toLowerCase());
    const endMonth = monthNumbers.get(monthRange[3].toLowerCase());
    const startYear = Number(monthRange[2]);
    const endYear = Number(monthRange[4]);
    return period(
      isoDate(startYear, startMonth, 1),
      isoDate(endYear, endMonth, monthEnd(endYear, endMonth)),
      "month_range"
    );
  }

  const untilMonth = title.match(new RegExp(`\\buntil\\s+(${monthPattern})\\s+(20\\d{2})\\b`, "i"));
  if (untilMonth) {
    const endMonth = monthNumbers.get(untilMonth[1].toLowerCase());
    const endYear = Number(untilMonth[2]);
    const start = shiftMonths(endYear, endMonth, -11);
    return period(
      isoDate(start.year, start.month, 1),
      isoDate(endYear, endMonth, monthEnd(endYear, endMonth)),
      "rolling_until_month"
    );
  }

  const yearOnly = title.match(/\b(20\d{2})\b/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return period(`${year}-01-01`, `${year}-12-31`, "calendar_year");
  }

  return null;
}

export function dateIsWithinPeriod(value, coverage) {
  const date = String(value || "").slice(0, 10);
  return Boolean(date && coverage?.startDate && coverage?.endDate && date >= coverage.startDate && date <= coverage.endDate);
}
