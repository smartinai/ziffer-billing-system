import { CheckCircle2, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatSyncElapsed } from "./teamworkSyncPresentation.js";

export default function TeamworkSyncModal({ error = "", onClose, onRetry, phase = "running" }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (phase !== "running") return undefined;
    setElapsedSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const running = phase === "running";
  const succeeded = phase === "success";

  return (
    <div className="modal-backdrop teamwork-sync-backdrop" role="presentation">
      <section
        aria-describedby="teamwork-sync-description"
        aria-labelledby="teamwork-sync-title"
        aria-live="polite"
        aria-modal="true"
        className="teamwork-sync-modal"
        role="dialog"
      >
        <header className="teamwork-sync-modal-header">
          <div className={`teamwork-sync-modal-icon ${succeeded ? "success" : phase === "error" ? "error" : ""}`}>
            {running ? <Loader2 className="spin" size={24} /> : succeeded ? <CheckCircle2 size={24} /> : <TriangleAlert size={24} />}
          </div>
          <div>
            <span className="eyebrow">Teamwork data</span>
            <h2 id="teamwork-sync-title">{running ? "Sync in progress" : succeeded ? "Sync complete" : "Sync failed"}</h2>
          </div>
          {!running ? (
            <button aria-label="Close Teamwork sync status" className="icon-button" onClick={onClose} type="button">
              <X size={20} />
            </button>
          ) : null}
        </header>

        <div className="teamwork-sync-modal-body">
          {running ? (
            <>
              <p id="teamwork-sync-description">Fetching users, projects, tasks and current-year time entries, then rebuilding reporting.</p>
              <div aria-hidden="true" className="teamwork-sync-progress"><span /></div>
              <div className="teamwork-sync-details">
                <span>Keep this window open</span>
                <span>{formatSyncElapsed(elapsedSeconds)}</span>
              </div>
              <p className="teamwork-sync-note">This can take several minutes. The existing reporting data stays available until the new sync finishes.</p>
            </>
          ) : succeeded ? (
            <p id="teamwork-sync-description">The latest Teamwork data is stored and the reporting views have been refreshed.</p>
          ) : (
            <p className="form-error" id="teamwork-sync-description">{error || "Teamwork could not be synchronized."}</p>
          )}
        </div>

        {!running ? (
          <footer className="teamwork-sync-modal-actions">
            {phase === "error" ? (
              <button className="secondary-button" onClick={onRetry} type="button">
                <RefreshCw size={17} /> Retry
              </button>
            ) : null}
            <button className="primary-action-button" onClick={onClose} type="button">Done</button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
