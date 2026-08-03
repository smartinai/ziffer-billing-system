import assert from "node:assert/strict";
import test from "node:test";
import {
  formatReportingMetricPercentage,
  reportingMetricBasis,
  reportingMetricPercentage
} from "./reportingPresentation.js";

test("reporting percentages use total Teamwork hours as the denominator", () => {
  assert.equal(reportingMetricPercentage(15, 60), 25);
  assert.equal(formatReportingMetricPercentage(15, 60), "25%");
  assert.equal(formatReportingMetricPercentage(1, 3), "33.3%");
});

test("reporting basis distinguishes estimates, confirmed values, and mixed values", () => {
  assert.equal(reportingMetricBasis({}, "totalTeamwork"), "");
  assert.equal(reportingMetricBasis({ estimatedPrepaid: { hours: 1 } }, "prepaid"), "");
  assert.equal(reportingMetricBasis({ confirmedPrepaid: { hours: 1 } }, "prepaid"), "Confirmed");
  assert.equal(reportingMetricBasis({
    confirmedXero: { hours: 2 },
    estimatedBillable: { hours: 3 },
    writeOffs: { hours: 0 }
  }, "effectiveBillable"), "Partly confirmed");
});

test("reporting percentages handle empty and invalid totals safely", () => {
  assert.equal(reportingMetricPercentage(4, 0), 0);
  assert.equal(reportingMetricPercentage(4, undefined), 0);
  assert.equal(formatReportingMetricPercentage(4, 0), "0%");
});

test("reporting percentages retain visibility for very small allocations", () => {
  assert.equal(formatReportingMetricPercentage(0.01, 100), "0.01%");
});
