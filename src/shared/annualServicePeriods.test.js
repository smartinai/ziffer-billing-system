import assert from "node:assert/strict";
import test from "node:test";
import {
  dateIsWithinPeriod,
  isMaintainCorporateRecordsTask,
  parseMaintainCorporateRecordsPeriod
} from "./annualServicePeriods.js";

test("recognizes maintain corporate records task wording", () => {
  assert.equal(isMaintainCorporateRecordsTask("Maintain corporate records 2026"), true);
  assert.equal(isMaintainCorporateRecordsTask("Maintaining corporate records and shareholders register July 2026 - June 2027"), true);
  assert.equal(isMaintainCorporateRecordsTask("Prepare annual accounts 2026"), false);
});

test("parses exact corporate-record periods inclusively", () => {
  assert.deepEqual(
    parseMaintainCorporateRecordsPeriod("Maintaining corporate records and shareholders register 09.06.2026 - 08.06.2027"),
    {
      endDate: "2027-06-08",
      key: "2026-06-09:2027-06-08",
      source: "exact_dates",
      startDate: "2026-06-09"
    }
  );
  assert.deepEqual(
    parseMaintainCorporateRecordsPeriod("Maintaining corporate records 29.01.2026–28.01.2027"),
    {
      endDate: "2027-01-28",
      key: "2026-01-29:2027-01-28",
      source: "exact_dates",
      startDate: "2026-01-29"
    }
  );
});

test("parses month, year, and rolling-until corporate-record periods", () => {
  assert.deepEqual(
    parseMaintainCorporateRecordsPeriod("Maintaining corporate records and shareholders register July 2026 - June 2027"),
    {
      endDate: "2027-06-30",
      key: "2026-07-01:2027-06-30",
      source: "month_range",
      startDate: "2026-07-01"
    }
  );
  assert.equal(parseMaintainCorporateRecordsPeriod("Maintain corporate records 2026").key, "2026-01-01:2026-12-31");
  assert.deepEqual(
    parseMaintainCorporateRecordsPeriod("Maintaining corporate records until Oct 2027"),
    {
      endDate: "2027-10-31",
      key: "2026-11-01:2027-10-31",
      source: "rolling_until_month",
      startDate: "2026-11-01"
    }
  );
});

test("rejects invalid or missing periods and compares inclusive boundaries", () => {
  assert.equal(parseMaintainCorporateRecordsPeriod("Maintain corporate records"), null);
  assert.equal(parseMaintainCorporateRecordsPeriod("Maintain corporate records 31.02.2026 - 01.03.2027"), null);
  const coverage = { startDate: "2026-07-01", endDate: "2027-06-30" };
  assert.equal(dateIsWithinPeriod("2026-07-01", coverage), true);
  assert.equal(dateIsWithinPeriod("2027-06-30", coverage), true);
  assert.equal(dateIsWithinPeriod("2026-06-30", coverage), false);
});
