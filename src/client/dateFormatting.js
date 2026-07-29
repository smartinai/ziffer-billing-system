function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    timeZone
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatAppDate(value, { fallback = "Not set", timeZone = "UTC" } = {}) {
  if (!value) return fallback;
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}/.test(raw)
    ? new Date(`${raw.slice(0, 10)}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const parts = dateParts(date, timeZone);
  return `${parts.day} ${parts.month} '${parts.year}`;
}

export function formatAppDateTime(value, { fallback = "Not set", timeZone = "Europe/Amsterdam" } = {}) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const parts = dateParts(date, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone
  }).format(date);
  return `${parts.day} ${parts.month} '${parts.year}, ${time}`;
}
