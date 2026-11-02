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
import { buildAtlasSourceEvidence } from "./worldview-source-evidence";
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
const conflictValue = (value: unknown) => {
  try { return (JSON.stringify(value) ?? String(value)).slice(0, 180); }
  catch { return String(value).slice(0, 180); }
};
const conflictDetails = (conflict: { disagreements: Array<{ field: string; values: unknown[] }> }) =>
  conflict.disagreements.map((item) => `${item.field}: ${item.values.map(conflictValue).join(" vs ")}`).join("; ");
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
  const loadedSources = useMemo(
    () => buildAtlasSourceEvidence({ observations, providerResults, sourceSummaries }),
    [observations, providerResults, sourceSummaries],
  );
  const loadedConflicts = useMemo(() => findAtlasTimeMachineConflicts(observations), [observations]);

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

      <div className="wv-time-machine-live-evidence" aria-label="Loaded source evidence">
        <strong>{replayedSnapshotId ? "Captured source evidence · historical" : "Loaded source evidence"}</strong>
        <p className="wv-time-machine-gap-note">Only already-loaded point records, provider results, and source summaries appear here. Request success is not a trust or completeness test; unknown coverage and missing records are not evidence of clear conditions. Raster, imagery, animated overlays, and camera bytes remain in their provider panels and are not captured.</p>
        {loadedSources.length === 0 ? (
          <p className="wv-time-machine-empty">No source status is available to this view. Source state is unknown; no records does not mean no events.</p>
        ) : (
          <ul>
            {loadedSources.map((source) => (
              <li key={source.providerId}>
                <b>{source.providerName ?? source.providerId}</b>
                <span>{source.providerId} · freshness {source.freshness} · data kind {source.dataKind ?? "unknown"} · {source.loadedRecordCount ?? 0} loaded map record(s), {source.observationCount} provider record(s) · retrieved {timeLabel(source.retrievedAt)}</span>
                <span>Record freshness states: {source.freshnessStates?.join(", ") || "unknown"}</span>
                <span>Coverage status: {source.coverageStatus ?? "unknown"} · {source.coverage ?? "Unknown / not reported"}</span>
                <span>Time basis: {source.timeBasis ?? "Not reported"}</span>
                <span>Attribution: {source.attribution ?? "Not reported"} · license: {source.license ?? "Not reported"}</span>
                <span>Terms summary: {source.termsText ?? "Not reported"}</span>
                {source.termsUrl && <span>Terms URL: <a href={source.termsUrl} target="_blank" rel="noreferrer">{source.termsUrl}</a></span>}
                {source.sourceUrl && <span>Source: <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceUrl}</a></span>}
                {source.errorState === "unknown" ? <span>Error state: not reported to this capture.</span> : source.hasError ? <span>Provider error: {source.error ?? "reported; safe details unavailable"}</span> : <span>No provider error was reported; that does not establish data accuracy or completeness.</span>}
                <span>Known blind spots: {source.knownBlindSpots?.length ? source.knownBlindSpots.join(" · ") : "Not documented in the Atlas source register."}</span>
                <span>{source.absenceMeaning ?? "Missing records do not establish absence."}</span>
                {(source.truncated || source.cached) && <span>{source.truncated ? "Result truncated" : ""}{source.cached ? `${source.truncated ? " · " : ""}served from cache` : ""}</span>}
              </li>
            ))}
          </ul>
        )}
        {loadedConflicts.length > 0 ? (
          <div className="wv-time-machine-conflicts" role="note">
            <strong>Potential data conflicts · same layer/ID only · unresolved</strong>
            <ul>{loadedConflicts.map((conflict, index) => <li key={`${conflict.layer}:${conflict.id}:${index}`}>{conflict.layer} · {conflict.id} · {conflict.sources.join(" vs ")} — {conflict.reason} · values: {conflictDetails(conflict)}</li>)}</ul>
          </div>
        ) : (
          <p className="wv-time-machine-gap-note">No cross-source data conflict was identified among loaded point records. This is not evidence of provider agreement, accuracy, or coverage.</p>
        )}
      </div>

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
                  <strong>Source evidence at capture</strong>
                  <ul>
                    {inspected.providerSummaries.map((source) => (
                      <li key={source.providerId}>
                        <b>{source.providerName ?? source.providerId}</b>
                        <span>{source.providerId} · freshness {source.freshness} · data kind {source.dataKind ?? "unknown"} · {source.loadedRecordCount ?? 0} loaded record(s), {source.observationCount} provider record(s) · retrieved {timeLabel(source.retrievedAt)}</span>
                        <span>Record freshness states: {source.freshnessStates?.join(", ") || "unknown"}</span>
                        <span>Coverage status: {source.coverageStatus ?? "unknown"} · {source.coverage ?? "Unknown / not reported"}{source.truncated ? ` · truncated (${source.observationCount} shown${source.totalInArea === null || source.totalInArea === undefined || source.totalInArea <= 0 ? "" : ` of ${source.totalInArea}`} in area)` : ""}{source.cached ? " · relay cache" : ""}</span>
                        <span>Time basis: {source.timeBasis ?? "Not reported"}</span>
                        <span>Attribution: {source.attribution ?? "Not reported"} · license: {source.license ?? "Not reported"}</span>
                        <span>Terms summary: {source.termsText ?? "Not reported"}</span>
                        {source.termsUrl && <span>Terms URL: {source.termsUrl}</span>}
                        {source.sourceUrl && <span>Source URL: {source.sourceUrl}</span>}
                        {source.errorState === "unknown" ? <span>Error state: not reported to this capture.</span> : source.hasError ? <span>Provider error: {source.error ?? "reported; safe details unavailable"}</span> : <span>No provider error was reported; this is not a trust or completeness assessment.</span>}
                        <span>Known blind spots: {source.knownBlindSpots?.length ? source.knownBlindSpots.join(" · ") : "Not documented in the Atlas source register."}</span>
                        <span>{source.absenceMeaning ?? "Missing records do not establish absence."}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {conflicts.length > 0 && (
                <div className="wv-time-machine-conflicts" role="note">
                  <strong>Potential source conflicts · same layer/ID only · unresolved</strong>
                  <ul>{conflicts.map((conflict, index) => <li key={`${conflict.layer}:${conflict.id}:${index}`}>{conflict.layer} · {conflict.id} · {conflict.sources.join(" vs ")} — {conflict.reason} · values: {conflictDetails(conflict)}</li>)}</ul>
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
                  <p className="wv-time-machine-diff-counts">Source context: added {comparison.sourceCounts.added} · removed {comparison.sourceCounts.removed} · changed {comparison.sourceCounts.changed} · unchanged {comparison.sourceCounts.unchanged}</p>
                  <p className="wv-time-machine-gap-note">Source-context differences describe changes in captured metadata, not provider trustworthiness or event causality. An unreported source is not proof of no change.</p>
                  <ul className="wv-time-machine-diffs" aria-label="Source context changes">
                    {comparison.sourceChanges.filter((change) => change.status !== "unchanged").slice(0, 50).map((change, index) => (
                      <li key={`${change.identity}:${change.status}:${index}`}>
                        <b>{change.status.toUpperCase()}</b> · {change.identity}{change.changedFields.length ? ` · fields: ${change.changedFields.join(", ")}` : ""}
                      </li>
                    ))}
                    {comparison.sourceChanges.every((change) => change.status === "unchanged") && <li>No source-summary differences found; some sources may not report summaries.</li>}
                  </ul>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
