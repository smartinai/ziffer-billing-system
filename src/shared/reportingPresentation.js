export function reportingMetricPercentage(metricHours, totalTeamworkHours) {
  const hours = Number(metricHours);
  const totalHours = Number(totalTeamworkHours);

  if (!Number.isFinite(hours) || !Number.isFinite(totalHours) || totalHours <= 0) return 0;
  return Math.max(0, (hours / totalHours) * 100);
}

export function formatReportingMetricPercentage(metricHours, totalTeamworkHours) {
  const percentage = reportingMetricPercentage(metricHours, totalTeamworkHours);
  const maximumFractionDigits = percentage > 0 && percentage < 0.1 ? 2 : 1;

  return `${percentage.toLocaleString("en-LU", { maximumFractionDigits })}%`;
}

export function reportingMetricBasis(classification = {}, metricName) {
  const hasConfirmedBillable = Number(classification.confirmedXero?.hours || 0) > 0
    || Number(classification.writeOffs?.hours || 0) > 0;
  const hasEstimate = metricName === "prepaid"
    ? Number(classification.estimatedPrepaid?.hours || 0) > 0
    : metricName === "effectiveBillable"
      ? Number(classification.estimatedBillable?.hours || 0) > 0
      : false;

  if (metricName === "writeOffs") return Number(classification.writeOffs?.hours || 0) > 0 ? "Confirmed" : "";
  if (metricName === "prepaid") {
    const prepaidConfirmed = Number(classification.confirmedPrepaid?.hours || 0) > 0;
    if (prepaidConfirmed && hasEstimate) return "Partly confirmed";
    if (prepaidConfirmed) return "Confirmed";
    return "";
  }
  if (metricName === "effectiveBillable") {
    if (hasConfirmedBillable && hasEstimate) return "Partly confirmed";
    if (hasConfirmedBillable) return "Confirmed";
    return "";
  }
  return "";
}
