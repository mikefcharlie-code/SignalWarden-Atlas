import { useMemo, useState } from "react";
import type { ProviderResult, WorldObservation } from "./worldview-core";
import type { AtlasSourceEvidence } from "./worldview-source-evidence";
import { sanitizeAtlasSourceError } from "./worldview-source-evidence";
import {
  buildIncidentGraph,
  DEFAULT_INCIDENT_GRAPH_DISTANCE_KM,
  DEFAULT_INCIDENT_GRAPH_TIME_HOURS,
  type IncidentGraph,
  type IncidentGraphEdge,
  type IncidentGraphNode,
} from "./worldview-event-graph";
import { WorldViewClosureDurationScenario } from "./WorldViewClosureDurationScenario";
import "./worldview-event-graph.css";

type Props = {
  observations: readonly WorldObservation[];
  focusRecord: WorldObservation | null;
  providerResults: readonly ProviderResult[];
  sourceSummaries: readonly AtlasSourceEvidence[];
  historical?: boolean;
  syntheticReplay?: boolean;
  onInspectRecord?: (record: WorldObservation) => void;
};

const formatTime = (value: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not reported";
  return new Date(value).toISOString().replace("T", " ").replace(".000Z", "Z");
};
const formatDistance = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)} km`;
const text = (value: string | null | undefined) => sanitizeAtlasSourceError(value) ?? "Unknown / not reported";
const formatValue = (value: string | number | boolean | null) => {
  if (typeof value === "string") return sanitizeAtlasSourceError(value) ?? "Not reported";
  return value === null ? "null" : String(value);
};

function nodeLabel(node: IncidentGraphNode): string {
  return text(node.record.title || node.record.label || node.record.id);
}
function roleLabel(node: IncidentGraphNode): string {
  switch (node.role) {
    case "road-closure": return "Reported road closure";
    case "camera-location": return "Public camera catalog location";
    case "weather-advisory": return "NOAA NHC/CPHC advisory position";
    case "sensor-report": return "Measured sensor report";
  }
}
function edgeLabel(edge: IncidentGraphEdge): string {
  switch (edge.kind) {
    case "exact-match": return "Exact data match";
    case "possible-conflict": return "Possible conflict · unresolved";
    case "spatial-temporal-association": return "Spatial-temporal association";
  }
}

function RecordInspection({ node, onInspect }: { node: IncidentGraphNode; onInspect?: (record: WorldObservation) => void }) {
  const properties = Object.entries(node.record.properties ?? {});
  return (
    <details className="wv-event-graph-inspection">
      <summary>Inspect underlying source record</summary>
      <dl>
        <div><dt>Source</dt><dd>{text(node.record.source)}</dd></div>
        <div><dt>Layer / record ID</dt><dd>{text(node.record.layer)} · {text(node.record.id)}</dd></div>
        <div><dt>Provider/source time</dt><dd>{formatTime(node.evidence.sourceTimestamp)} · basis: {node.evidence.sourceTimestampBasis}</dd></div>
        <div><dt>Record timestamp</dt><dd>{formatTime(node.evidence.observedAt)}</dd></div>
        <div><dt>Retrieved</dt><dd>{formatTime(node.evidence.retrievedAt)}</dd></div>
        <div><dt>Record freshness</dt><dd>{node.evidence.recordFreshness}</dd></div>
        <div><dt>Provider freshness</dt><dd>{node.evidence.providerFreshness}</dd></div>
        <div><dt>Data kind</dt><dd>{node.evidence.dataKind}</dd></div>
        <div><dt>Coverage</dt><dd>{text(node.evidence.coverage)}</dd></div>
        <div><dt>Confidence</dt><dd>{node.evidence.confidence === null ? "Not reported" : node.evidence.confidence}</dd></div>
        <div><dt>Point uncertainty</dt><dd>{node.evidence.uncertaintyM === null ? "Not reported" : `±${node.evidence.uncertaintyM} m`}</dd></div>
        {properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatValue(value)}</dd></div>)}
      </dl>
      {node.role === "camera-location" && (
        <p className="wv-event-graph-camera-note">This record describes a catalog location. It does not establish live frame availability or an outage.</p>
      )}
      {onInspect && <button type="button" onClick={() => onInspect(node.record)}>Select this record in Atlas</button>}
    </details>
  );
}

function NodeCard({ node, onInspect }: { node: IncidentGraphNode; onInspect?: (record: WorldObservation) => void }) {
  return (
    <article className="wv-event-graph-node">
      <div className="wv-event-graph-node-head">
        <span className="wv-event-graph-role">{roleLabel(node)}</span>
        <strong>{nodeLabel(node)}</strong>
      </div>
      <p className="wv-event-graph-provenance">{text(node.evidence.source)} · {text(node.evidence.layer)} · {text(node.evidence.id)}</p>
      <dl className="wv-event-graph-meta">
        <div><dt>Source time</dt><dd>{formatTime(node.evidence.sourceTimestamp)} · {node.evidence.sourceTimestampBasis}</dd></div>
        <div><dt>Record time</dt><dd>{formatTime(node.evidence.observedAt)}</dd></div>
        <div><dt>Retrieved</dt><dd>{formatTime(node.evidence.retrievedAt)}</dd></div>
        <div><dt>Freshness</dt><dd>record: {node.evidence.recordFreshness} · provider: {node.evidence.providerFreshness}</dd></div>
        <div><dt>Coverage</dt><dd>{text(node.evidence.coverage)}</dd></div>
        <div><dt>Confidence / uncertainty</dt><dd>{node.evidence.confidence === null ? "confidence not reported" : `confidence ${node.evidence.confidence}`} · {node.evidence.uncertaintyM === null ? "point uncertainty not reported" : `±${node.evidence.uncertaintyM} m`}</dd></div>
        <div><dt>Data kind</dt><dd>{node.evidence.dataKind}</dd></div>
      </dl>
      <RecordInspection node={node} onInspect={onInspect} />
    </article>
  );
}

function EdgeCard({ edge, nodes, onInspect }: { edge: IncidentGraphEdge; nodes: Map<string, IncidentGraphNode>; onInspect?: (record: WorldObservation) => void }) {
  const from = nodes.get(edge.fromNodeId);
  const to = nodes.get(edge.toNodeId);
  if (!from || !to) return null;
  return (
    <article className={`wv-event-graph-edge ${edge.kind === "possible-conflict" ? "is-conflict" : ""}`}>
      <strong>{edgeLabel(edge)}</strong>
      <p>{edge.rationale}</p>
      <p className="wv-event-graph-edge-metrics">Distance {formatDistance(edge.distanceKm)} · source-time delta {Math.round(edge.timeDeltaMs / 60_000)} min · confidence not assigned</p>
      <p className="wv-event-graph-edge-metrics">Freshness: {edge.freshness} · provider freshness: {edge.providerFreshness}</p>
      <p className="wv-event-graph-edge-metrics">Coverage: {text(edge.coverage)}</p>
      <p className="wv-event-graph-uncertainty">Uncertainty: {edge.uncertainty}</p>
      {edge.disagreementFields.length > 0 && <p className="wv-event-graph-conflict-fields">Disagreeing fields: {edge.disagreementFields.join(", ")} · no winner selected.</p>}
      <div className="wv-event-graph-edge-endpoints">
        {[from, to].map((node) => (
          <div key={node.nodeId}>
            <span>{text(node.evidence.source)} · {text(node.evidence.layer)} · {text(node.evidence.id)} · source time {formatTime(node.evidence.sourceTimestamp)}</span>
            {onInspect && <button type="button" onClick={() => onInspect(node.record)}>Inspect record</button>}
          </div>
        ))}
      </div>
    </article>
  );
}

export function WorldViewIncidentGraph({
  observations,
  focusRecord,
  providerResults,
  sourceSummaries,
  historical = false,
  syntheticReplay = false,
  onInspectRecord,
}: Props) {
  const [maxDistanceKm, setMaxDistanceKm] = useState(DEFAULT_INCIDENT_GRAPH_DISTANCE_KM);
  const [maxTimeDeltaHours, setMaxTimeDeltaHours] = useState(DEFAULT_INCIDENT_GRAPH_TIME_HOURS);
  const graph = useMemo<IncidentGraph>(() => buildIncidentGraph({
    observations,
    focusRecord,
    providerResults,
    sourceSummaries,
    maxDistanceKm,
    maxTimeDeltaHours,
  }), [observations, focusRecord, providerResults, sourceSummaries, maxDistanceKm, maxTimeDeltaHours]);
  const nodeMap = useMemo(() => new Map(graph.nodes.map((node) => [node.nodeId, node])), [graph.nodes]);
  const [showSyntheticScenarioExample, setShowSyntheticScenarioExample] = useState(false);
  const hasClosureFocus = graph.status === "ready" && graph.focusRole === "road-closure" && Boolean(focusRecord);

  return (
    <>
      <section className="wv-panel wv-event-graph" aria-label="Loaded evidence graph">
        <div className="panel-head">
          <span className="wv-label">CROSS-LAYER EVIDENCE GRAPH</span>
          <span className="mono">LOADED RECORDS ONLY</span>
        </div>
        <p className="wv-event-graph-disclosure">Associations around the selected record. This is an evidence view, not a confirmed incident. No causation, identity, provider agreement, or completeness is inferred.</p>
        {historical && <p className="wv-event-graph-mode" role="note">Historical captured records · not current</p>}
        {syntheticReplay && <p className="wv-event-graph-mode" role="note">Synthetic replay records · not provider evidence</p>}
        <div className="wv-event-graph-controls">
          <label>Association distance
            <select aria-label="Association distance window" value={String(maxDistanceKm)} onChange={(event) => setMaxDistanceKm(Number(event.target.value))}>
              <option value="5">5 km</option><option value="25">25 km</option><option value="100">100 km</option>
            </select>
          </label>
          <label>Source-time difference
            <select aria-label="Association time window" value={String(maxTimeDeltaHours)} onChange={(event) => setMaxTimeDeltaHours(Number(event.target.value))}>
              <option value="1">1 hour</option><option value="6">6 hours</option><option value="24">24 hours</option><option value="72">72 hours</option>
            </select>
          </label>
        </div>
        {graph.status !== "ready" ? (
          <p className="wv-event-graph-empty">{graph.coverageGaps[0]}</p>
        ) : (
          <>
            <div className="wv-event-graph-summary">
              <strong>Anchor: {focusRecord ? `${text(focusRecord.source)} · ${text(focusRecord.layer)} · ${text(focusRecord.id)}` : "Unknown"}</strong>
              <span>{graph.nodes.length} loaded record{graph.nodes.length === 1 ? "" : "s"} · {graph.edges.length} link{graph.edges.length === 1 ? "" : "s"}</span>
              <small>Heuristic window: ≤{graph.maxDistanceKm} km and ≤{graph.maxTimeDeltaHours} h from the anchor. Exact data matches and unresolved conflicts are separate link types.</small>
            </div>
            {graph.edges.length === 0 && <p className="wv-event-graph-empty">No exact match, possible conflict, or in-window spatial-temporal association was identified among these loaded records. This does not establish agreement or absence.</p>}
            {graph.edges.length > 0 && <div className="wv-event-graph-edge-list">{graph.edges.map((edge) => <EdgeCard key={edge.edgeId} edge={edge} nodes={nodeMap} onInspect={onInspectRecord} />)}</div>}
            <div className="wv-event-graph-node-list"><h3>Included source records</h3>{graph.nodes.map((node) => <NodeCard key={node.nodeId} node={node} onInspect={onInspectRecord} />)}</div>
            {graph.coverageGaps.length > 0 && <details className="wv-event-graph-gaps"><summary>Coverage and uncertainty notes ({graph.coverageGaps.length})</summary><ul>{graph.coverageGaps.map((gap, index) => <li key={`${index}-${gap}`}>{text(gap)}</li>)}</ul></details>}
          </>
        )}
        <p className="wv-event-graph-footer">No provider refresh, background request, consent change, or command generation is performed by this graph.</p>
        {!hasClosureFocus && !showSyntheticScenarioExample && <button type="button" className="wv-event-graph-synthetic-example" onClick={() => setShowSyntheticScenarioExample(true)}>Try a labeled synthetic closure-duration example</button>}
      </section>
      {(hasClosureFocus || showSyntheticScenarioExample) && (
        <WorldViewClosureDurationScenario
          observations={observations}
          focusRecord={focusRecord}
          incidentGraph={graph}
          providerResults={providerResults}
          sourceSummaries={sourceSummaries}
          historical={historical}
          syntheticReplay={syntheticReplay}
          initialSyntheticExample={!hasClosureFocus}
          onCloseSyntheticExample={() => setShowSyntheticScenarioExample(false)}
        />
      )}
    </>
  );
}
