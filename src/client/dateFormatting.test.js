import assert from "node:assert/strict";
import test from "node:test";
import { formatAppDate, formatAppDateTime } from "./dateFormatting.js";

test("formats app dates with an abbreviated month and two-digit year", () => {
  assert.equal(formatAppDate("2026-06-21"), "21 Jun '26");
});

test("formats app timestamps in the requested timezone", () => {
  assert.equal(
    formatAppDateTime("2026-06-21T12:05:00Z", { timeZone: "Europe/Amsterdam" }),
    "21 Jun '26, 14:05"
  );
});

test("uses caller-provided fallbacks for missing or invalid dates", () => {
  assert.equal(formatAppDate("", { fallback: "—" }), "—");
  assert.equal(formatAppDateTime("invalid", { fallback: "Never" }), "Never");
});
