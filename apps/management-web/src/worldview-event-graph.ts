import {
  haversineKm,
  normalizeObservation,
  validateObservation,
  type Freshness,
  type ProviderResult,
  type WorldObservation,
} from "./worldview-core";
import {
  buildAtlasSourceEvidence,
  type AtlasSourceDataKind,
  type AtlasSourceEvidence,
} from "./worldview-source-evidence";

export type IncidentGraphRole =
  | "road-closure"
  | "camera-location"
  | "weather-advisory"
  | "sensor-report";

export type IncidentGraphEdgeKind =
  | "exact-match"
  | "spatial-temporal-association"
  | "possible-conflict";

export interface IncidentGraphRecordEvidence {
  source: string;
  layer: string;
  id: string;
  observedAt: string;
  sourceTimestamp: string;
  sourceTimestampBasis: string;
  retrievedAt: string | null;
  recordFreshness: Freshness;
  providerFreshness: Freshness | "mixed";
  coverage: string | null;
  coverageStatus: AtlasSourceEvidence["coverageStatus"] | null;
  dataKind: AtlasSourceDataKind;
  confidence: number | null;
  uncertaintyM: number | null;
  sourceUrl: string | null;
  timeBasis: string | null;
}

export interface IncidentGraphNode {
  nodeId: string;
  role: IncidentGraphRole;
  record: WorldObservation;
  evidence: IncidentGraphRecordEvidence;
  sourceEvidence: AtlasSourceEvidence | null;
}

export interface IncidentGraphEdge {
  edgeId: string;
  kind: IncidentGraphEdgeKind;
  status: "associated" | "unresolved";
  fromNodeId: string;
  toNodeId: string;
  endpoints: [IncidentGraphRecordEvidence, IncidentGraphRecordEvidence];
  distanceKm: number;
  timeDeltaMs: number;
  exactFields: string[];
  disagreementFields: string[];
  rationale: string;
  freshness: Freshness | "mixed";
  providerFreshness: Freshness | "mixed";
  coverage: string;
  associationConfidence: null;
  uncertainty: string;
}

export interface IncidentGraph {
  status: "ready" | "no-focus" | "unsupported-focus";
  focusNodeId: string | null;
  focusRole: IncidentGraphRole | null;
  nodes: IncidentGraphNode[];
  edges: IncidentGraphEdge[];
  maxDistanceKm: number;
  maxTimeDeltaHours: number;
  omittedNodeCount: number;
  coverageGaps: string[];
  disclosure: string;
}

export interface BuildIncidentGraphInput {
  observations: readonly WorldObservation[];
  focusRecord?: WorldObservation | null;
  providerResults?: Readonly<Record<string, ProviderResult>> | readonly ProviderResult[] | null;
  sourceSummaries?: readonly AtlasSourceEvidence[] | null;
  maxDistanceKm?: number;
  maxTimeDeltaHours?: number;
}

export const DEFAULT_INCIDENT_GRAPH_DISTANCE_KM = 25;
export const DEFAULT_INCIDENT_GRAPH_TIME_HOURS = 24;
export const MAX_INCIDENT_GRAPH_NODES = 60;
export const MAX_INCIDENT_GRAPH_EDGES = 120;

const MAX_DISTANCE_KM = 500;
const MAX_TIME_DELTA_HOURS = 168;
const NON_DATA_PROPERTY_KEYS = new Set([
  "source", "provider", "freshness", "stale", "dataKind", "error", "errorState",
  "attribution", "license", "terms", "termsUrl", "sourceUrl", "retrievedAt", "providerTimestamp",
  "freshnessBasis", "sourceTimeBasis", "coverage", "coverageStatus", "truncated", "cached",
  "verification", "disclosure", "knownBlindSpots", "absenceMeaning",
]);
const SUPPORTED_DATA_KINDS: readonly AtlasSourceDataKind[] = [
  "observation", "reported-event", "forecast", "modelled", "delayed", "synthetic",
  "geometric-estimate", "imagery", "unknown",
];

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function classifyIncidentGraphRole(record: WorldObservation): IncidentGraphRole | null {
  const props = record.properties ?? {};
  if (
    record.layer === "traffic" &&
    (props.eventType === "closures" || record.id.startsWith("ga511-closures-") || /\broad closure\b/i.test(record.label))
  ) return "road-closure";

  if (record.layer === "cameras") return "camera-location";

  const disclosure = typeof props.disclosure === "string" ? props.disclosure : "";
  if (
    record.layer === "weather" &&
    /NOAA NHC\/CPHC/i.test(record.source) &&
    /official advisory position/i.test(disclosure) &&
    !/forecast/i.test(record.label)
  ) return "weather-advisory";

  if (
    record.layer === "weather" &&
    (props.dataKind === "measured" || props.measured === true || /openaq/i.test(`${record.source} ${String(props.provider ?? "")}`))
  ) return "sensor-report";

  return null;
}

function recordKey(record: WorldObservation): string {
  return JSON.stringify([record.source, record.layer, record.id, record.observedAt]);
}

function sourceIdentityKey(record: WorldObservation): string {
  return JSON.stringify([record.layer, record.id]);
}

function findSourceEvidence(
  record: WorldObservation,
  evidence: readonly AtlasSourceEvidence[],
): AtlasSourceEvidence | null {
  const candidates = [record.source, record.properties?.provider]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(normalizeKey);
  const exact = evidence.find((item) =>
    candidates.includes(normalizeKey(item.providerId)) ||
    candidates.includes(normalizeKey(item.providerName ?? "")),
  );
  if (exact) return exact;
  return evidence.find((item) => candidates.some((candidate) =>
    candidate.length >= 6 &&
    (normalizeKey(item.providerId).includes(candidate) || normalizeKey(item.providerName ?? "").includes(candidate)),
  )) ?? null;
}

function dataKindFor(record: WorldObservation, role: IncidentGraphRole, summary: AtlasSourceEvidence | null): AtlasSourceDataKind {
  const declared = record.properties?.dataKind;
  if (typeof declared === "string") {
    if (declared === "measured") return "observation";
    if (declared === "model forecast (not an observation)") return "forecast";
    if (declared === "modelled") return "modelled";
    if (SUPPORTED_DATA_KINDS.includes(declared as AtlasSourceDataKind)) return declared as AtlasSourceDataKind;
  }
  if (summary?.dataKind && summary.dataKind !== "unknown") return summary.dataKind;
  if (role === "road-closure" || role === "weather-advisory") return "reported-event";
  return "observation";
}

function isSyntheticRecord(record: WorldObservation, summary: AtlasSourceEvidence | null): boolean {
  return record.freshness === "synthetic" ||
    record.properties?.dataKind === "synthetic" ||
    summary?.freshness === "synthetic" ||
    summary?.dataKind === "synthetic" ||
    /synthetic/i.test(record.source);
}

function sourceTimestampFor(record: WorldObservation): { timestamp: string; basis: string } {
  const providerTimestamp = record.properties?.providerTimestamp;
  if (isValidTimestamp(providerTimestamp)) {
    return { timestamp: new Date(providerTimestamp).toISOString(), basis: "providerTimestamp" };
  }
  return { timestamp: record.observedAt, basis: "WorldObservation.observedAt; provider-specific time is not separately reported" };
}

function makeNode(record: WorldObservation, role: IncidentGraphRole, summary: AtlasSourceEvidence | null): IncidentGraphNode {
  const sourceTime = sourceTimestampFor(record);
  const retrievedAt = isValidTimestamp(record.properties?.retrievedAt)
    ? new Date(record.properties!.retrievedAt as string).toISOString()
    : summary?.retrievedAt ?? null;
  const coverage = typeof record.properties?.coverage === "string" && record.properties.coverage.trim()
    ? record.properties.coverage.trim()
    : summary?.coverage ?? null;
  const evidence: IncidentGraphRecordEvidence = {
    source: record.source,
    layer: record.layer,
    id: record.id,
    observedAt: record.observedAt,
    sourceTimestamp: sourceTime.timestamp,
    sourceTimestampBasis: sourceTime.basis,
    retrievedAt,
    recordFreshness: record.freshness ?? "unknown",
    providerFreshness: summary?.freshness ?? "unknown",
    coverage,
    coverageStatus: summary?.coverageStatus ?? null,
    dataKind: dataKindFor(record, role, summary),
    confidence: typeof record.confidence === "number" ? record.confidence : null,
    uncertaintyM: typeof record.point.uncertaintyM === "number" ? record.point.uncertaintyM : null,
    sourceUrl: summary?.sourceUrl ?? null,
    timeBasis: summary?.timeBasis ?? (typeof record.properties?.freshnessBasis === "string" ? record.properties.freshnessBasis : null),
  };
  return {
    nodeId: recordKey(record),
    role,
    record,
    evidence,
    sourceEvidence: summary,
  };
}

function combineFreshness(a: Freshness | "mixed", b: Freshness | "mixed"): Freshness | "mixed" {
  return a === b ? a : "mixed";
}

function evidenceCoverage(a: IncidentGraphRecordEvidence, b: IncidentGraphRecordEvidence): string {
  return [
    `${a.source}: ${a.coverage ?? "Unknown / not reported"}`,
    `${b.source}: ${b.coverage ?? "Unknown / not reported"}`,
  ].join("; ");
}

function compareDataFields(a: WorldObservation, b: WorldObservation): { equal: string[]; different: string[] } {
  const equal: string[] = [];
  const different: string[] = [];
  const compare = (field: string, left: unknown, right: unknown) => {
    if (stableJson(left) === stableJson(right)) equal.push(field);
    else different.push(field);
  };
  compare("point", a.point, b.point);
  if (a.confidence !== undefined && b.confidence !== undefined) compare("confidence", a.confidence, b.confidence);
  const keys = [...new Set([...Object.keys(a.properties ?? {}), ...Object.keys(b.properties ?? {})])]
    .filter((key) => !NON_DATA_PROPERTY_KEYS.has(key)).sort();
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(a.properties ?? {}, key) && Object.prototype.hasOwnProperty.call(b.properties ?? {}, key)) {
      compare(`properties.${key}`, a.properties?.[key], b.properties?.[key]);
    }
  }
  return { equal, different };
}

function makeEdge(
  kind: IncidentGraphEdgeKind,
  a: IncidentGraphNode,
  b: IncidentGraphNode,
  distanceKm: number,
  timeDeltaMs: number,
  rationale: string,
  exactFields: string[] = [],
  disagreementFields: string[] = [],
): IncidentGraphEdge {
  const endpoints: [IncidentGraphRecordEvidence, IncidentGraphRecordEvidence] = [a.evidence, b.evidence];
  const id = JSON.stringify([kind, a.nodeId, b.nodeId]);
  return {
    edgeId: id,
    kind,
    status: kind === "possible-conflict" ? "unresolved" : "associated",
    fromNodeId: a.nodeId,
    toNodeId: b.nodeId,
    endpoints,
    distanceKm,
    timeDeltaMs,
    exactFields,
    disagreementFields,
    rationale,
    freshness: combineFreshness(a.evidence.recordFreshness, b.evidence.recordFreshness),
    providerFreshness: combineFreshness(a.evidence.providerFreshness, b.evidence.providerFreshness),
    coverage: evidenceCoverage(a.evidence, b.evidence),
    associationConfidence: null,
    uncertainty: "No link confidence is assigned. Coordinates may be approximate; point proximity and timestamp proximity do not establish causation, identity, or completeness.",
  };
}

function missingRoleDisclosure(role: IncidentGraphRole): string {
  switch (role) {
    case "road-closure": return "No loaded road-closure record fell inside this graph window; this does not mean roads are clear.";
    case "camera-location": return "No loaded camera catalog location fell inside this graph window; this does not establish camera presence, absence, availability, or outage.";
    case "weather-advisory": return "No loaded NOAA NHC/CPHC advisory-position record fell inside this graph window; this does not establish that no weather alert exists.";
    case "sensor-report": return "No loaded measured OpenAQ sensor record fell inside this graph window; this does not establish that no sensor reading exists.";
  }
}

export function buildIncidentGraph(input: BuildIncidentGraphInput): IncidentGraph {
  const maxDistanceKm = Number.isFinite(input.maxDistanceKm)
    ? Math.max(0, Math.min(MAX_DISTANCE_KM, input.maxDistanceKm!))
    : DEFAULT_INCIDENT_GRAPH_DISTANCE_KM;
  const maxTimeDeltaHours = Number.isFinite(input.maxTimeDeltaHours)
    ? Math.max(0, Math.min(MAX_TIME_DELTA_HOURS, input.maxTimeDeltaHours!))
    : DEFAULT_INCIDENT_GRAPH_TIME_HOURS;
  const base: Omit<IncidentGraph, "status" | "focusNodeId" | "focusRole" | "nodes" | "edges" | "omittedNodeCount" | "coverageGaps"> = {
    maxDistanceKm,
    maxTimeDeltaHours,
    disclosure: "This view links only evidence already loaded in Atlas. Exact matches refer to comparable source-record fields; spatial-temporal links are heuristic associations only. No edge establishes causation, real-world identity, provider agreement, or completeness.",
  };

  const normalized = new Map<string, WorldObservation>();
  for (const value of input.observations) {
    if (!validateObservation(value)) continue;
    const record = normalizeObservation(value);
    normalized.set(recordKey(record), record);
  }
  const records = [...normalized.values()].sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
  const focusInput = input.focusRecord && validateObservation(input.focusRecord)
    ? normalizeObservation(input.focusRecord)
    : null;
  const focus = focusInput ? records.find((record) => recordKey(record) === recordKey(focusInput)) ?? null : null;
  const summaries = buildAtlasSourceEvidence({
    observations: records,
    providerResults: input.providerResults,
    sourceSummaries: input.sourceSummaries,
  });

  if (!focus) {
    return {
      ...base,
      status: "no-focus",
      focusNodeId: null,
      focusRole: null,
      nodes: [],
      edges: [],
      omittedNodeCount: 0,
      coverageGaps: ["Select an already-loaded record to anchor this view. No provider request is made."],
    };
  }
  const focusRole = classifyIncidentGraphRole(focus);
  if (!focusRole) {
    return {
      ...base,
      status: "unsupported-focus",
      focusNodeId: null,
      focusRole: null,
      nodes: [],
      edges: [],
      omittedNodeCount: 0,
      coverageGaps: ["The selected record is not a supported closure, camera location, NOAA NHC/CPHC advisory position, or measured sensor report. Select a supported loaded record to explore associations."],
    };
  }

  const focusSummary = findSourceEvidence(focus, summaries);
  const focusNode = makeNode(focus, focusRole, focusSummary);
  const maxTimeDeltaMs = maxTimeDeltaHours * 60 * 60 * 1000;
  const syntheticFocus = isSyntheticRecord(focus, focusSummary);
  const candidates = records.flatMap((record) => {
    if (recordKey(record) === recordKey(focus)) return [];
    const role = classifyIncidentGraphRole(record);
    if (!role) return [];
    const sourceSummary = findSourceEvidence(record, summaries);
    const isSynthetic = isSyntheticRecord(record, sourceSummary);
    if (syntheticFocus !== isSynthetic) return [];
    const distanceKm = haversineKm(focus.point, record.point);
    const timeDeltaMs = Math.abs(Date.parse(sourceTimestampFor(focus).timestamp) - Date.parse(sourceTimestampFor(record).timestamp));
    const sameLayerAndId = sourceIdentityKey(record) === sourceIdentityKey(focus);
    if (!sameLayerAndId && (distanceKm > maxDistanceKm || timeDeltaMs > maxTimeDeltaMs)) return [];
    return [{
      node: makeNode(record, role, sourceSummary),
      distanceKm,
      timeDeltaMs,
      sameLayerAndId,
    }];
  }).sort((a, b) =>
    Number(b.sameLayerAndId) - Number(a.sameLayerAndId) ||
    a.distanceKm - b.distanceKm ||
    a.timeDeltaMs - b.timeDeltaMs ||
    a.node.record.source.localeCompare(b.node.record.source) ||
    a.node.record.id.localeCompare(b.node.record.id),
  );
  const nodeLimit = Math.max(1, Math.min(MAX_INCIDENT_GRAPH_NODES, 1 + candidates.length));
  const selectedCandidates = candidates.slice(0, nodeLimit - 1);
  const nodes = [focusNode, ...selectedCandidates.map((candidate) => candidate.node)];
  const edges: IncidentGraphEdge[] = [];

  for (const candidate of selectedCandidates) {
    const node = candidate.node;
    const sameLayerAndId = sourceIdentityKey(node.record) === sourceIdentityKey(focusNode.record);
    if (sameLayerAndId && node.record.source !== focusNode.record.source) {
      const comparison = compareDataFields(focusNode.record, node.record);
      if (comparison.different.length) {
        edges.push(makeEdge(
          "possible-conflict", focusNode, node, candidate.distanceKm, candidate.timeDeltaMs,
          `Records share layer and ID, but comparable data fields disagree: ${comparison.different.join(", ")}. This remains an unresolved comparison; no source is selected as correct.`,
          comparison.equal, comparison.different,
        ));
      } else if (comparison.equal.length) {
        edges.push(makeEdge(
          "exact-match", focusNode, node, candidate.distanceKm, candidate.timeDeltaMs,
          `Records share layer and ID, and these comparable data fields match exactly: ${comparison.equal.join(", ")}. This is a data match only; it does not establish real-world identity, causation, or source correctness.`,
          comparison.equal,
        ));
      }
      if (comparison.different.length || comparison.equal.length) continue;
    }
    if (candidate.distanceKm <= maxDistanceKm && candidate.timeDeltaMs <= maxTimeDeltaMs) {
      edges.push(makeEdge(
        "spatial-temporal-association", focusNode, node, candidate.distanceKm, candidate.timeDeltaMs,
        `Within the configured ${maxDistanceKm} km and ${maxTimeDeltaHours} hour association window from the selected record. This is a proximity link only; it does not mean the records describe the same event or entity.`,
      ));
    }
  }

  // Defensively cap links even if the same source data contains many duplicate identities.
  const boundedEdges = edges.slice(0, MAX_INCIDENT_GRAPH_EDGES);
  const includedRoles = new Set(nodes.map((node) => node.role));
  const coverageGaps = ( ["road-closure", "camera-location", "weather-advisory", "sensor-report"] as IncidentGraphRole[])
    .filter((role) => !includedRoles.has(role))
    .map(missingRoleDisclosure);
  if (includedRoles.has("camera-location")) {
    coverageGaps.push("Camera catalog records describe locations, not live frame availability. Outage status remains unknown unless an already-loaded source record explicitly reports it; missing snapshots or markers are not treated as outages.");
  }
  const reportedErrors = summaries.filter((summary) => summary.hasError);
  for (const summary of reportedErrors.slice(0, 5)) {
    coverageGaps.push(`${summary.providerName ?? summary.providerId} reports a provider error; any retained records remain separately labeled with their own freshness.`);
  }
  const omittedNodeCount = Math.max(0, candidates.length - selectedCandidates.length);
  if (omittedNodeCount > 0) {
    coverageGaps.push(`${omittedNodeCount} additional eligible loaded record${omittedNodeCount === 1 ? " was" : "s were"} outside this bounded graph view; the graph is not complete.`);
  }
  if (edges.length > boundedEdges.length) coverageGaps.push("The edge list reached its display cap; additional links are not shown.");

  return {
    ...base,
    status: "ready",
    focusNodeId: focusNode.nodeId,
    focusRole,
    nodes,
    edges: boundedEdges,
    omittedNodeCount,
    coverageGaps,
  };
}
