import { Loader2, RefreshCw, Send } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { getOperations, sendOperationsTestAlert } from "./api.js";
import { formatAppDate, formatAppDateTime } from "./dateFormatting.js";

const operationLabels = {
  app_health: "Application",
  backup: "Database backup",
  database: "Database",
  database_health: "Database",
  deployment: "Deployment",
  disk: "Disk space",
  restore_drill: "Restore drill",
  rollback: "Rollback",
  teamwork: "Teamwork sync",
  teamwork_sync: "Teamwork sync",
  xero: "Xero",
  xero_status: "Xero status"
};

function operationTone(status) {
  if (["complete", "healthy", "ok"].includes(status)) return "success";
  if (["failed", "critical"].includes(status)) return "danger";
  return "neutral";
}

function formatDate(value) {
  return formatAppDate(value, { fallback: "—" });
}

function formattedDateTime(value) {
  return formatAppDateTime(value, { fallback: "—" });
}

export default function OperationsView() {
  const [payload, setPayload] = useState({ components: [], incidents: [], recentRuns: [] });
  const [loading, setLoading] = useState(true);
  const [sendingTest, setSendingTest] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPayload(await getOperations());
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sendTestAlert() {
    setSendingTest(true);
    setError("");
    setMessage("");
    try {
      const result = await sendOperationsTestAlert();
      setMessage(`Test alert sent to ${result.recipientCount} administrator${result.recipientCount === 1 ? "" : "s"}.`);
      await load();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <Fragment>
      <section className="panel operations-summary-panel">
        <div className="panel-heading operations-heading">
          <div>
            <p className="eyebrow">Production health</p>
            <h2>System health</h2>
            <p className="operations-intro">Current status of Ziffer’s data, integrations, and recovery services.</p>
          </div>
          <div className="operations-actions">
            <button className="secondary-button" disabled={loading} onClick={load} type="button">
              <RefreshCw className={loading ? "spin" : ""} size={16} /> Refresh
            </button>
            {payload.emailConfigured ? (
              <button className="primary-button" disabled={sendingTest} onClick={sendTestAlert} type="button">
                {sendingTest ? <Loader2 className="spin" size={16} /> : <Send size={16} />} Send test alert
              </button>
            ) : null}
          </div>
        </div>
        {!payload.emailConfigured ? <div className="warning-banner">Email alerts are not configured. Health checks are still being recorded.</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {message ? <div className="success-banner">{message}</div> : null}
        <div className="operations-card-grid">
          {(payload.components || []).map((component, index) => (
            <article className="operations-card" key={`${component.component}-${index}`}>
              <div className="operations-card-title">
                <span>{operationLabels[component.component] || component.component}</span>
                <span className={`audit-status-pill audit-status-pill--${operationTone(component.status)}`}>{component.status || "unknown"}</span>
              </div>
              <dl className="operations-card-details">
                <div><dt>Last checked</dt><dd>{formattedDateTime(component.checkedAt)}</dd></div>
                {component.latestSuccessAt ? <div><dt>Last success</dt><dd>{formattedDateTime(component.latestSuccessAt)}</dd></div> : null}
                {component.latestFailureAt ? <div><dt>Last failure</dt><dd>{formattedDateTime(component.latestFailureAt)}</dd></div> : null}
                {component.metadata?.coverageEnd ? <div><dt>Coverage</dt><dd>Through {formatDate(component.metadata.coverageEnd)}</dd></div> : null}
              </dl>
              {component.message ? <p className="operations-card-message">{component.message}</p> : null}
            </article>
          ))}
          {!loading && !(payload.components || []).length ? <p className="muted">No operational checks have been recorded yet.</p> : null}
        </div>
      </section>

      <section className="panel operations-incidents-panel">
        <div className="panel-heading"><div><p className="eyebrow">Needs attention</p><h2>Open incidents</h2></div></div>
        {!loading && !(payload.incidents || []).length ? (
          <div className="operations-empty-state">
            <strong>All clear</strong>
            <span>No open incidents require attention.</span>
          </div>
        ) : (
          <div className="table-scroll">
          <table className="quotes-table operations-table">
            <thead><tr><th>Component</th><th>Severity</th><th>Summary</th><th>First seen</th><th>Last seen</th><th>Occurrences</th></tr></thead>
            <tbody>
              {(payload.incidents || []).map((incident) => (
                <tr key={incident.id}>
                  <td>{operationLabels[incident.component] || incident.component}</td>
                  <td><span className={`audit-status-pill audit-status-pill--${operationTone(incident.severity)}`}>{incident.severity}</span></td>
                  <td>{incident.summary}</td>
                  <td>{formattedDateTime(incident.firstSeenAt)}</td>
                  <td>{formattedDateTime(incident.lastSeenAt)}</td>
                  <td>{incident.occurrenceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section className="panel operations-runs-panel">
        <div className="panel-heading"><div><p className="eyebrow">History</p><h2>Recent operational runs</h2></div></div>
        <div className="table-scroll">
          <table className="quotes-table operations-table operations-runs-table">
            <thead><tr><th>Operation</th><th>Trigger</th><th>Status</th><th>Started</th><th>Finished</th><th>Message</th></tr></thead>
            <tbody>
              {(payload.recentRuns || []).map((run) => (
                <tr key={run.id}>
                  <td>{operationLabels[run.operationType] || run.operationType}</td>
                  <td>{run.trigger}</td>
                  <td><span className={`audit-status-pill audit-status-pill--${operationTone(run.status)}`}>{run.status}</span></td>
                  <td>{formattedDateTime(run.startedAt)}</td>
                  <td>{formattedDateTime(run.finishedAt)}</td>
                  <td>{run.errorMessage || "—"}</td>
                </tr>
              ))}
              {!loading && !(payload.recentRuns || []).length ? <tr><td className="empty-cell" colSpan="6">No runs recorded yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </Fragment>
  );
}
