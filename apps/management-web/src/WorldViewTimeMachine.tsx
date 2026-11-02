import { useMemo, useRef, useState } from "react";
import type { ProviderResult, WorldObservation } from "./worldview-core";
import type {
  AtlasTimeMachineSnapshot,
  AtlasTimeMachineSourceSummary,
  AtlasTimeMachineView,
  AtlasTimeMachineChange,
} from "./worldview-time-machine";
import {
  MAX_ATLAS_TIME_MACHINE_SNAPSHOTS,
  compareAtlasTimeMachineSnapshots,
  createAtlasTimeMachineSnapshot,
  findAtlasTimeMachineConflicts,
  retainAtlasTimeMachineSnapshots,
} from "./worldview-time-machine";
import "./worldview-time-machine.css";

type Props = Readonly<{
  observations: readonly WorldObservation[];
  providerResults: readonly ProviderResult[];
  sourceSummaries: readonly AtlasTimeMachineSourceSummary[];
  view: AtlasTimeMachineView;
  replayedSnapshotId: string | null;
  onReplay: (snapshot: AtlasTimeMachineSnapshot | null) => void;
  captureDisabled?: boolean;
}>;

const timeLabel = (value: string | null | undefined) => {
  if (!value) return "Not reported";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "Unknown timestamp";
};
const propertyValue = (record: WorldObservation, name: string): string | null => {
  const value = record.properties?.[name];
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" ? value : String(value);
};
const propertyLabel = (record: WorldObservation, name: string) => propertyValue(record, name) ?? "Not reported";
const sourceTimeBasis = (record: WorldObservation) =>
  propertyValue(record, "sourceTimeBasis") ??
  propertyValue(record, "freshnessBasis") ??
  "source timestamp basis not reported";
const additionalSourceTimes = (record: WorldObservation) => {
  const provider = propertyValue(record, "providerTimestamp");
  const reported = propertyValue(record, "reportedAt");
  return [
    provider ? `provider update ${timeLabel(provider)}` : null,
    reported ? `reported ${timeLabel(reported)}` : null,
  ].filter((item): item is string => item !== null).join(" · ");
};
const statusFor = (record: WorldObservation) => record.freshness ?? "unknown";
const descriptionForChange = (change: AtlasTimeMachineChange) => {
  const before = change.before;
  const after = change.after;
  const sample = after ?? before;
  if (!sample) return "Unknown record";
  return `${sample.source} · ${sample.layer} · ${sample.id}`;
};

export function WorldViewTimeMachine({
  observations,
  providerResults,
  sourceSummaries,
  view,
  replayedSnapshotId,
  onReplay,
  captureDisabled = false,
}: Props) {
  const [snapshots, setSnapshots] = useState<AtlasTimeMachineSnapshot[]>([]);
  const [snapshotToInspect, setSnapshotToInspect] = useState("");
  const [snapshotToReplay, setSnapshotToReplay] = useState("");
  const [comparisonBefore, setComparisonBefore] = useState("");
  const [comparisonAfter, setComparisonAfter] = useState("");
  const [message, setMessage] = useState("");
  const sequence = useRef(0);

  const inspected = snapshots.find((snapshot) => snapshot.id === snapshotToInspect) ?? snapshots.at(-1) ?? null;
  const before = snapshots.find((snapshot) => snapshot.id === comparisonBefore) ?? null;
  const after = snapshots.find((snapshot) => snapshot.id === comparisonAfter) ?? null;
  const comparison = useMemo(
    () => before && after ? compareAtlasTimeMachineSnapshots(before, after) : null,
    [before, after],
  );
  const conflicts = inspected ? findAtlasTimeMachineConflicts(inspected.observations) : [];

  const capture = () => {
    const capturedAt = new Date().toISOString();
    const id = `atlas-capture-${Date.now()}-${++sequence.current}`;
    try {
      const snapshot = createAtlasTimeMachineSnapshot({
        id,
        capturedAt,
        observations,
        view,
        providerResults,
        sourceSummaries,
      });
      const reachedLimit = snapshots.length >= MAX_ATLAS_TIME_MACHINE_SNAPSHOTS;
      setSnapshots((existing) => retainAtlasTimeMachineSnapshots(existing, snapshot));
      setSnapshotToInspect(snapshot.id);
      setSnapshotToReplay(snapshot.id);
      if (snapshots.length > 0) {
        setComparisonBefore(snapshots.at(-1)!.id);
        setComparisonAfter(snapshot.id);
      } else {
        setComparisonBefore(snapshot.id);
        setComparisonAfter(snapshot.id);
      }
      setMessage(
        `Captured ${snapshot.observations.length} point record${snapshot.observations.length === 1 ? "" : "s"} at ${timeLabel(snapshot.capturedAt)}${reachedLimit ? "; the oldest capture was evicted" : ""}. No provider was refreshed.`,
      );
    } catch (error) {
      setMessage(`Capture not saved: ${error instanceof Error ? error.message : "invalid capture"}`);
    }
  };

  const replaySelected = () => {
    const snapshot = snapshots.find((item) => item.id === snapshotToReplay) ?? null;
    onReplay(snapshot);
    setMessage(snapshot
      ? `Historical capture selected from ${timeLabel(snapshot.capturedAt)}. It is not current provider state.`
      : "Returned to the currently loaded map state.");
  };

  const clearCaptures = () => {
    setSnapshots([]);
    setSnapshotToInspect("");
    setSnapshotToReplay("");
    setComparisonBefore("");
    setComparisonAfter("");
    onReplay(null);
    setMessage("Captured history cleared from this page session.");
  };

  return (
    <section className="wv-time-machine" aria-labelledby="wv-time-machine-title">
      <div className="wv-time-machine-head">
        <div>
          <span className="wv-time-machine-kicker">ATLAS / EXPLICIT LOCAL CAPTURE</span>
          <h2 id="wv-time-machine-title">World-state time machine</h2>
        </div>
        <button type="button" className="wv-time-machine-capture" onClick={capture} disabled={captureDisabled}>
          Capture loaded map state
        </button>
      </div>
      <p className="wv-time-machine-disclosure">
        Captures only the point records already loaded in Atlas. No refresh, polling, upload, or network permission is added. Up to {MAX_ATLAS_TIME_MACHINE_SNAPSHOTS} captures stay in this page’s memory and clear on reload. Review provider terms before retaining any source data.
      </p>
      <div className="wv-time-machine-controls">
        <label>
          <span>Replay exact capture</span>
          <select aria-label="Choose captured map state to replay" value={snapshotToReplay} onChange={(event) => setSnapshotToReplay(event.target.value)}>
            <option value="">Current loaded state</option>
            {snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{timeLabel(snapshot.capturedAt)} · {snapshot.observations.length} records</option>)}
          </select>
        </label>
        <button type="button" onClick={replaySelected} disabled={snapshotToReplay === (replayedSnapshotId ?? "")}>
          {snapshotToReplay ? "Replay capture" : "Return to current"}
        </button>
        <button type="button" className="wv-time-machine-clear" onClick={clearCaptures} disabled={snapshots.length === 0}>
          Clear captures
        </button>
      </div>
      {message && <p className="wv-time-machine-status" role="status">{message}</p>}

      {snapshots.length === 0 ? (
        <p className="wv-time-machine-empty">No captures yet. Capture records already present in the map; empty coverage is never filled with generated history.</p>
      ) : (
        <>
          <div className="wv-time-machine-capture-list" aria-label="Captured map states">
            {snapshots.map((snapshot, index) => (
              <button
                type="button"
                className={`wv-time-machine-capture-item ${snapshot.id === inspected?.id ? "selected" : ""}`}
                key={snapshot.id}
                onClick={() => setSnapshotToInspect(snapshot.id)}
                aria-pressed={snapshot.id === inspected?.id}
              >
                <span>CAPTURE {String(index + 1).padStart(2, "0")}</span>
                <strong>{timeLabel(snapshot.capturedAt)}</strong>
                <small>{snapshot.observations.length} point records · {snapshot.providerSummaries.length} provider summaries</small>
              </button>
            ))}
          </div>

          {inspected && (
            <div className="wv-time-machine-detail">
              <div className="wv-time-machine-detail-head">
                <div>
                  <span className="wv-time-machine-kicker">CAPTURED STATE · NOT LIVE</span>
                  <h3>{timeLabel(inspected.capturedAt)}</h3>
                </div>
                <span>{inspected.observations.length} records · {conflicts.length} potential conflict{conflicts.length === 1 ? "" : "s"}</span>
              </div>
              <p className="wv-time-machine-gap-note">{inspected.coverageGaps.join(" ")}</p>
              {inspected.providerSummaries.length > 0 && (
                <div className="wv-time-machine-sources">
                  <strong>Provider results available at capture</strong>
                  <ul>
                    {inspected.providerSummaries.map((source) => (
                      <li key={source.providerId}>
                        <b>{source.providerName ?? source.providerId}</b>
                        <span>{source.providerId} · {source.freshness} · {source.observationCount} record{source.observationCount === 1 ? "" : "s"} · retrieved {timeLabel(source.retrievedAt)}{source.hasError ? " · provider error recorded" : ""}</span>
                        <span>Coverage: {source.coverage ?? "Not reported"}{source.truncated ? ` · truncated (${source.observationCount} shown${source.totalInArea === null || source.totalInArea === undefined || source.totalInArea <= 0 ? "" : ` of ${source.totalInArea}`} in area)` : ""}{source.cached ? " · relay cache" : ""}</span>
                        {source.attribution && <span>Attribution: {source.attribution}</span>}
                        {source.license && <span>License: {source.license}</span>}
                        {source.termsUrl && <span>Terms: {source.termsUrl}</span>}
                        {source.sourceUrl && <span>Source URL: {source.sourceUrl}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {conflicts.length > 0 && (
                <div className="wv-time-machine-conflicts" role="note">
                  <strong>Potential source conflicts · unresolved</strong>
                  <ul>{conflicts.map((conflict, index) => <li key={`${conflict.layer}:${conflict.id}:${index}`}>{conflict.layer} · {conflict.id} · {conflict.sources.join(" vs ")} — {conflict.reason}</li>)}</ul>
                </div>
              )}
              <div className="wv-time-machine-records">
                <strong>Record provenance</strong>
                {inspected.observations.length === 0 ? <p>No point records were loaded. This does not establish that a source returned no events or that the area is clear.</p> : (
                  <ul>
                    {inspected.observations.slice(0, 100).map((record, index) => (
                      <li key={`${record.layer}:${record.source}:${record.id}:${index}`}>
                        <strong>{record.label || record.id}</strong>
                        <span>{record.source} · {record.layer} · {record.id}</span>
                        <span>Source record time (basis: {sourceTimeBasis(record)}): {timeLabel(record.observedAt)} · captured: {timeLabel(inspected.capturedAt)}</span>
                        {additionalSourceTimes(record) && <span>Additional source times: {additionalSourceTimes(record)}</span>}
                        <span>Retrieved: {timeLabel(propertyValue(record, "retrievedAt"))} · freshness: {statusFor(record)}</span>
                        <span>Coverage: {propertyLabel(record, "coverage")} · attribution: {propertyLabel(record, "attribution")}</span>
                        {propertyLabel(record, "truncated") === "true" && <span>Coverage gap: source reported a truncated result.</span>}
                        {record.freshness === "synthetic" && <span className="wv-time-machine-synthetic">SYNTHETIC · not provider evidence</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {inspected.observations.length > 100 && <p>Showing first 100 records; the capture contains {inspected.observations.length}.</p>}
              </div>
            </div>
          )}

          {snapshots.length >= 2 && (
            <div className="wv-time-machine-compare">
              <strong>Compare two captures</strong>
              <div className="wv-time-machine-controls">
                <label>
                  <span>Earlier / baseline</span>
                  <select aria-label="Earlier snapshot for comparison" value={comparisonBefore} onChange={(event) => setComparisonBefore(event.target.value)}>
                    {snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{timeLabel(snapshot.capturedAt)}</option>)}
                  </select>
                </label>
                <label>
                  <span>Later / comparison</span>
                  <select aria-label="Later snapshot for comparison" value={comparisonAfter} onChange={(event) => setComparisonAfter(event.target.value)}>
                    {snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{timeLabel(snapshot.capturedAt)}</option>)}
                  </select>
                </label>
              </div>
              {comparison && (
                <>
                  <p className="wv-time-machine-diff-counts">Added {comparison.counts.added} · removed {comparison.counts.removed} · changed {comparison.counts.changed} · unchanged {comparison.counts.unchanged}</p>
                  <p className="wv-time-machine-gap-note">A difference is only a change between two captured datasets. Source coverage, freshness, time windows, and gaps may differ.</p>
                  <ul className="wv-time-machine-diffs">
                    {comparison.changes.filter((change) => change.status !== "unchanged").slice(0, 50).map((change, index) => (
                      <li key={`${change.identity}:${change.status}:${index}`}>
                        <b>{change.status.toUpperCase()}</b> · {descriptionForChange(change)}{change.changedFields.length ? ` · fields: ${change.changedFields.join(", ")}` : ""}
                      </li>
                    ))}
                    {comparison.changes.every((change) => change.status === "unchanged") && <li>No record differences in the selected captures.</li>}
                  </ul>
                  {comparison.changes.filter((change) => change.status !== "unchanged").length > 50 && <p>Showing first 50 differences.</p>}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
