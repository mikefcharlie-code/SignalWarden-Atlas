import { useMemo, useState } from "react";
import type { ProviderResult, WorldObservation } from "./worldview-core";
import type { AtlasSourceEvidence } from "./worldview-source-evidence";
import { sanitizeAtlasSourceError } from "./worldview-source-evidence";
import { buildIncidentGraph, type IncidentGraph } from "./worldview-event-graph";
import {
  buildClosureDurationScenario,
  DEFAULT_CLOSURE_SCENARIO_DURATION_HOURS,
  MAX_CLOSURE_SCENARIO_DURATION_HOURS,
  type ClosureScenarioAssociation,
} from "./worldview-closure-scenario";

type Props = {
  observations: readonly WorldObservation[];
  focusRecord: WorldObservation | null;
  incidentGraph: IncidentGraph;
  providerResults: readonly ProviderResult[];
  sourceSummaries: readonly AtlasSourceEvidence[];
  historical?: boolean;
  syntheticReplay?: boolean;
  initialSyntheticExample?: boolean;
  onCloseSyntheticExample?: () => void;
};

const SYNTHETIC_EXAMPLE_SOURCE = "SignalWarden synthetic scenario fixture";
const SYNTHETIC_EXAMPLE_FOCUS: WorldObservation = {
  id: "synthetic-closure-duration-example",
  layer: "traffic",
  point: { lat: 0, lon: 0 },
  observedAt: "2026-01-01T00:00:00Z",
  source: SYNTHETIC_EXAMPLE_SOURCE,
  label: "Synthetic closure fixture · no real road",
  freshness: "synthetic",
  properties: {
    eventType: "closures",
    dataKind: "synthetic",
    startAt: "2026-01-02T00:00:00Z",
    retrievedAt: "2026-01-01T00:05:00Z",
    fixture: "closure-duration-scenario-lab",
  },
};
const SYNTHETIC_EXAMPLE_CAMERAS: readonly WorldObservation[] = [
  ["synthetic-camera-before", "2026-01-01T20:00:00Z", "Synthetic camera point · before interval"],
  ["synthetic-camera-during", "2026-01-02T02:00:00Z", "Synthetic camera point · inside six-hour interval"],
  ["synthetic-camera-after", "2026-01-02T08:00:00Z", "Synthetic camera point · after interval"],
].map(([id, timestamp, label]) => ({
  id,
  layer: "cameras",
  point: { lat: 0.005, lon: 0.005 },
  observedAt: timestamp,
  source: SYNTHETIC_EXAMPLE_SOURCE,
  label,
  freshness: "synthetic",
  properties: {
    providerTimestamp: timestamp,
    retrievedAt: new Date(Date.parse(timestamp) + 60_000).toISOString(),
    dataKind: "synthetic",
    fixture: "closure-duration-scenario-lab",
  },
}));
const SYNTHETIC_EXAMPLE_OBSERVATIONS: readonly WorldObservation[] = [SYNTHETIC_EXAMPLE_FOCUS, ...SYNTHETIC_EXAMPLE_CAMERAS];

const safeText = (value: string | null | undefined, fallback = "Not reported") => sanitizeAtlasSourceError(value) ?? fallback;
const EMPTY_PROVIDER_RESULTS: readonly ProviderResult[] = [];
const EMPTY_SOURCE_SUMMARIES: readonly AtlasSourceEvidence[] = [];
const formatTime = (value: unknown) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "Not reported";
  return new Date(value).toISOString().replace("T", " ").replace(".000Z", "Z");
};
const formatRawTime = (value: unknown) =>
  typeof value === "string" && value.trim()
    ? formatTime(value) === "Not reported" ? `${safeText(value, "Invalid time")}` : formatTime(value)
    : "Not reported";
const formatDistance = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)} km`;
const propertyTime = (record: WorldObservation, key: string) => record.properties?.[key] ?? null;

function AssociationCard({ item, membership }: { item: ClosureScenarioAssociation; membership: string }) {
  const record = item.record;
  const otherTimes = ["providerTimestamp", "reportedAt", "lastUpdatedAt", "startAt", "plannedEndAt"]
    .map((key) => [key, record.properties?.[key]] as const)
    .filter(([, value]) => typeof value === "string" && value.trim());
  return (
    <article className="wv-closure-scenario-record" data-record-kind={item.evidence.dataKind === "synthetic" ? "synthetic-scenario-data" : "loaded-evidence-in-scenario-comparison"}>
      <div className="wv-closure-scenario-record-head">
        <span>{membership}</span>
        <strong>{safeText(record.title || record.label || record.id)}</strong>
      </div>
      <p className="wv-closure-scenario-provenance">{safeText(record.source)} · {safeText(record.layer)} / {safeText(record.id)}</p>
      <dl>
        <div><dt>Role</dt><dd>{item.role}</dd></div>
        <div><dt>Source time</dt><dd>{formatTime(item.sourceTimestamp)} · {item.sourceTimestampBasis}</dd></div>
        <div><dt>Record time</dt><dd>{formatTime(item.evidence.observedAt)}</dd></div>
        <div><dt>Retrieved</dt><dd>{formatTime(item.evidence.retrievedAt)}</dd></div>
        <div><dt>Point used for distance</dt><dd>{record.point.lat.toFixed(5)}, {record.point.lon.toFixed(5)}</dd></div>
        <div><dt>Distance from closure point</dt><dd>{formatDistance(item.distanceKm)}</dd></div>
        <div><dt>Record freshness</dt><dd>{item.evidence.recordFreshness}</dd></div>
        <div><dt>Data kind</dt><dd>{item.evidence.dataKind}</dd></div>
        <div><dt>Other source time fields</dt><dd>{otherTimes.length ? otherTimes.map(([key, value]) => `${key}: ${formatRawTime(value)}`).join(" · ") : "None reported"}</dd></div>
        {item.timeFromStartMs !== null && <div><dt>From assumed start</dt><dd>{(item.timeFromStartMs / 3_600_000).toFixed(2)} h</dd></div>}
      </dl>
    </article>
  );
}

function AssociationGroup({ title, items, membership }: { title: string; items: ClosureScenarioAssociation[]; membership: string }) {
  return (
    <details className="wv-closure-scenario-group">
      <summary>{title} ({items.length})</summary>
      {items.length ? (
        <div className="wv-closure-scenario-record-list">
          {items.map((item) => <AssociationCard key={item.associationId} item={item} membership={membership} />)}
        </div>
      ) : <p className="wv-closure-scenario-empty">None identified among these records; this is not evidence of absence.</p>}
    </details>
  );
}

export function WorldViewClosureDurationScenario({
  observations,
  focusRecord,
  incidentGraph,
  providerResults,
  sourceSummaries,
  historical = false,
  syntheticReplay = false,
  initialSyntheticExample = false,
  onCloseSyntheticExample,
}: Props) {
  const [durationHours, setDurationHours] = useState(DEFAULT_CLOSURE_SCENARIO_DURATION_HOURS);
  const [syntheticExample, setSyntheticExample] = useState(initialSyntheticExample);
  const hasLoadedClosure = incidentGraph.status === "ready" && incidentGraph.focusRole === "road-closure" && Boolean(focusRecord);
  const scenarioObservations = syntheticExample ? SYNTHETIC_EXAMPLE_OBSERVATIONS : observations;
  const scenarioFocus = syntheticExample ? SYNTHETIC_EXAMPLE_FOCUS : focusRecord;
  const scenarioGraph = useMemo(() => syntheticExample ? buildIncidentGraph({
    observations: SYNTHETIC_EXAMPLE_OBSERVATIONS,
    focusRecord: SYNTHETIC_EXAMPLE_FOCUS,
    maxDistanceKm: incidentGraph.maxDistanceKm,
    maxTimeDeltaHours: incidentGraph.maxTimeDeltaHours,
  }) : incidentGraph, [syntheticExample, incidentGraph]);
  const scenarioProviderResults = syntheticExample ? EMPTY_PROVIDER_RESULTS : providerResults;
  const scenarioSourceSummaries = syntheticExample ? EMPTY_SOURCE_SUMMARIES : sourceSummaries;
  const result = useMemo(() => buildClosureDurationScenario({
    observations: scenarioObservations,
    focusRecord: scenarioFocus,
    incidentGraph: scenarioGraph,
    providerResults: scenarioProviderResults,
    sourceSummaries: scenarioSourceSummaries,
    durationHours,
  }), [scenarioObservations, scenarioFocus, scenarioGraph, scenarioProviderResults, scenarioSourceSummaries, durationHours]);
  const properties = scenarioFocus?.properties ?? {};
  const syntheticInput = syntheticExample || Boolean(scenarioFocus && (scenarioFocus.freshness === "synthetic" || properties.dataKind === "synthetic" || /synthetic/i.test(scenarioFocus.source))) || result.focusSourceEvidence?.freshness === "synthetic" || result.focusSourceEvidence?.dataKind === "synthetic";
  const baselineProviderTime = properties.providerTimestamp;
  const baselineSourceTime = typeof baselineProviderTime === "string" && Number.isFinite(Date.parse(baselineProviderTime))
    ? formatTime(baselineProviderTime)
    : formatTime(scenarioFocus?.observedAt);
  const baselineSourceBasis = typeof baselineProviderTime === "string" && Number.isFinite(Date.parse(baselineProviderTime))
    ? "providerTimestamp"
    : "WorldObservation.observedAt; provider-specific time is not separately reported";
  const recordRetrievedAt = scenarioFocus ? propertyTime(scenarioFocus, "retrievedAt") : null;
  const focusRetrievedAt = typeof recordRetrievedAt === "string" && recordRetrievedAt.trim()
    ? recordRetrievedAt
    : result.focusSourceEvidence?.retrievedAt ?? null;

  return (
    <section className="wv-panel wv-closure-scenario" aria-label="Closure duration scenario lab" data-view-kind="scenario-only" data-example-kind={syntheticExample ? "synthetic" : "loaded-records"}>
      <div className="panel-head">
        <span className="wv-label">CLOSURE-DURATION SCENARIO LAB</span>
        <span className="wv-closure-scenario-badge">{syntheticExample ? "SYNTHETIC EXAMPLE · SCENARIO ONLY" : "SCENARIO ONLY"}</span>
      </div>
      <p className="wv-closure-scenario-disclosure">What if this {syntheticExample ? "synthetic closure fixture" : "reported closure"} lasted for the selected duration? This is an explicit hypothetical comparison, not a live prediction or operational instruction.</p>
      <p className="wv-closure-scenario-disclosure">{result.disclosure}</p>
      {!syntheticExample && historical && <p className="wv-closure-scenario-mode" role="note">Historical captured records · not current</p>}
      {!syntheticExample && (syntheticReplay || syntheticInput) && <p className="wv-closure-scenario-mode is-synthetic" role="note">Synthetic input · scenario/test data, not provider evidence</p>}
      {syntheticExample && <p className="wv-closure-scenario-mode is-synthetic" role="note">Built-in synthetic example · fixed test times and invented coordinates; no real road, event, camera feed, or provider data. Its baseline graph is built only from these synthetic records; current Atlas observations are not mixed in.</p>}
      <div className="wv-closure-scenario-dataset-controls">
        {syntheticExample ? (
          <>
            {hasLoadedClosure && <button type="button" onClick={() => setSyntheticExample(false)}>Use selected loaded closure</button>}
            {!hasLoadedClosure && onCloseSyntheticExample && <button type="button" onClick={onCloseSyntheticExample}>Close synthetic example</button>}
          </>
        ) : <button type="button" onClick={() => setSyntheticExample(true)}>Try synthetic example</button>}
      </div>
      <div className="wv-closure-scenario-controls">
        <label htmlFor="wv-closure-scenario-duration">Assumed closure duration (hours)</label>
        <input
          id="wv-closure-scenario-duration"
          aria-label="Assumed closure duration in hours"
          type="number"
          min={1}
          max={MAX_CLOSURE_SCENARIO_DURATION_HOURS}
          step={1}
          value={durationHours}
          onChange={(event) => setDurationHours(Number(event.target.value))}
        />
      </div>
      <p className="wv-closure-scenario-disclosure">{syntheticExample ? "The example uses only its fixed synthetic fixture and a separately built synthetic baseline graph; no loaded Atlas observations are included." : "Only records already loaded in Atlas are compared. The scenario interval uses the closure record’s explicit startAt through the assumed end time, inclusive; it does not modify or join the baseline graph."}</p>

      <details className="wv-closure-scenario-inputs" open>
        <summary>Inputs, source and timestamps</summary>
        <dl>
          <div><dt>Dataset</dt><dd>{syntheticExample ? "Built-in synthetic example (isolated)" : historical ? "Historical loaded records" : "Currently loaded Atlas records"}</dd></div>
          <div><dt>Closure source / ID</dt><dd>{scenarioFocus ? `${safeText(scenarioFocus.source)} · ${safeText(scenarioFocus.layer)} / ${safeText(scenarioFocus.id)}` : "No selected closure record"}</dd></div>
          <div><dt>Assumed duration</dt><dd>{Number.isInteger(durationHours) && durationHours >= 1 && durationHours <= MAX_CLOSURE_SCENARIO_DURATION_HOURS ? `${durationHours} hours` : "Invalid; use 1–72 whole hours"}</dd></div>
          <div><dt>Scenario start · explicit startAt</dt><dd>{scenarioFocus ? formatRawTime(propertyTime(scenarioFocus, "startAt")) : "Not reported"}</dd></div>
          <div><dt>Scenario end · assumed</dt><dd>{formatTime(result.hypotheticalEndAt)}</dd></div>
          <div><dt>Baseline anchor source time</dt><dd>{baselineSourceTime} · {baselineSourceBasis}</dd></div>
          <div><dt>Planned end · source-reported only</dt><dd>{scenarioFocus ? formatRawTime(propertyTime(scenarioFocus, "plannedEndAt")) : "Not reported"} · not an observed closure end</dd></div>
          <div><dt>Provider/source timestamp</dt><dd>{scenarioFocus ? formatRawTime(propertyTime(scenarioFocus, "providerTimestamp")) : "Not reported"}</dd></div>
          <div><dt>Reported time</dt><dd>{scenarioFocus ? formatRawTime(propertyTime(scenarioFocus, "reportedAt")) : "Not reported"}</dd></div>
          <div><dt>Last updated</dt><dd>{scenarioFocus ? formatRawTime(propertyTime(scenarioFocus, "lastUpdatedAt")) : "Not reported"}</dd></div>
          <div><dt>Record time · observedAt</dt><dd>{formatTime(scenarioFocus?.observedAt)}</dd></div>
          <div><dt>Retrieved</dt><dd>{formatRawTime(focusRetrievedAt)}</dd></div>
          <div><dt>Point used for distance</dt><dd>{scenarioFocus ? `${scenarioFocus.point.lat.toFixed(5)}, ${scenarioFocus.point.lon.toFixed(5)}` : "Not reported"}</dd></div>
          <div><dt>Baseline graph window</dt><dd>≤{scenarioGraph.maxDistanceKm} km and ±{scenarioGraph.maxTimeDeltaHours} h around its selected-record source time</dd></div>
        </dl>
        <ul>
          {result.timestampAssumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          <li>Scenario candidates use the same spatial distance bound as the baseline graph; the comparison is limited to supported loaded graph record types.</li>
        </ul>
      </details>

      {result.status !== "ready" ? (
        <div role="status">{result.coverageGaps.map((gap, index) => <p className="wv-closure-scenario-empty" key={`${index}-${gap}`}>{gap}</p>)}</div>
      ) : (
        <>
          <div className="wv-closure-scenario-summary">
            <strong>Assumed interval: {formatTime(result.explicitStartAt)} → {formatTime(result.hypotheticalEndAt)}</strong>
            <span>Baseline {result.baselineAssociations.length} · Scenario {result.scenarioAssociations.length} · Shared {result.comparison.shared.length}</span>
            <small>Baseline-only {result.comparison.baselineOnly.length} · Scenario-only {result.comparison.scenarioOnly.length}</small>
          </div>
          <AssociationGroup title="Shared associations" items={result.comparison.shared} membership="IN BOTH" />
          <AssociationGroup title="Scenario-only associations" items={result.comparison.scenarioOnly} membership="SCENARIO ONLY" />
          <AssociationGroup title="Baseline-only associations" items={result.comparison.baselineOnly} membership="BASELINE ONLY" />
          {result.coverageGaps.map((gap) => <p className="wv-closure-scenario-empty" key={gap}>{gap}</p>)}
        </>
      )}
      <p className="wv-closure-scenario-footer">Scenario associations are a separate comparison layer, not observed records. No closure state, causal relationship, route, mission, command, forecast, provider refresh, or external fetch is produced.</p>
    </section>
  );
}
