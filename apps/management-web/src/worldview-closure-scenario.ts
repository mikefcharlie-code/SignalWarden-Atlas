import {
  haversineKm,
  normalizeObservation,
  validateObservation,
  type ProviderResult,
  type WorldObservation,
} from "./worldview-core";
import {
  buildAtlasSourceEvidence,
  type AtlasSourceDataKind,
  type AtlasSourceEvidence,
} from "./worldview-source-evidence";
import {
  classifyIncidentGraphRole,
  type IncidentGraph,
  type IncidentGraphRecordEvidence,
  type IncidentGraphRole,
} from "./worldview-event-graph";

export const DEFAULT_CLOSURE_SCENARIO_DURATION_HOURS = 6;
export const MAX_CLOSURE_SCENARIO_DURATION_HOURS = 72;
export const MAX_CLOSURE_SCENARIO_ASSOCIATIONS = 120;
export const MAX_CLOSURE_SCENARIO_INPUT_RECORDS = 5000;

export type ClosureScenarioStatus =
  | "ready"
  | "no-focus"
  | "unsupported-focus"
  | "baseline-mismatch"
  | "missing-start"
  | "invalid-start"
  | "invalid-duration";

export interface ClosureScenarioAssociation {
  associationId: string;
  record: WorldObservation;
  role: IncidentGraphRole;
  evidence: IncidentGraphRecordEvidence;
  sourceEvidence: AtlasSourceEvidence | null;
  distanceKm: number;
  sourceTimestamp: string;
  sourceTimestampBasis: string;
  timeFromStartMs: number | null;
  basis: string;
}

export interface ClosureScenarioComparison {
  baseline: ClosureScenarioAssociation[];
  scenario: ClosureScenarioAssociation[];
  shared: ClosureScenarioAssociation[];
  baselineOnly: ClosureScenarioAssociation[];
  scenarioOnly: ClosureScenarioAssociation[];
}

export interface BuildClosureDurationScenarioInput {
  observations: readonly WorldObservation[];
  focusRecord?: WorldObservation | null;
  incidentGraph: IncidentGraph;
  providerResults?: Readonly<Record<string, ProviderResult>> | readonly ProviderResult[] | null;
  sourceSummaries?: readonly AtlasSourceEvidence[] | null;
  durationHours?: number;
  maxAssociations?: number;
}

export interface ClosureScenarioResult {
  status: ClosureScenarioStatus;
  focusRecord: WorldObservation | null;
  focusRole: IncidentGraphRole | null;
  durationHours: number | null;
  explicitStartAt: string | null;
  hypotheticalEndAt: string | null;
  timestampAssumptions: string[];
  disclosure: string;
  baselineAssociations: ClosureScenarioAssociation[];
  scenarioAssociations: ClosureScenarioAssociation[];
  comparison: ClosureScenarioComparison;
  sourceEvidence: AtlasSourceEvidence[];
  focusSourceEvidence: AtlasSourceEvidence | null;
  omittedInputRecordCount: number;
  omittedScenarioCount: number;
  coverageGaps: string[];
}

const DISCLOSURE = "This is a deterministic comparison of already-loaded records or explicitly labeled synthetic test records and a user-selected hypothetical interval. It does not predict or establish actual road status, infer causation, or recommend or command a route or mission. Empty or missing records do not mean roads are clear.";
const TIMESTAMP_ASSUMPTIONS = [
  "The scenario start is the selected closure properties.startAt only; observedAt, providerTimestamp, reportedAt, lastUpdatedAt, retrievedAt, and plannedEndAt are not fallback starts.",
  "Candidate source time is valid properties.providerTimestamp when present, otherwise WorldObservation.observedAt.",
  "The directed interval is inclusive: [explicit startAt, explicit startAt + selected duration]. It is an assumption, not an observed closure duration.",
];

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function key(record: WorldObservation): string {
  return JSON.stringify([record.source, record.layer, record.id, record.observedAt]);
}
function identity(record: WorldObservation): string {
  return JSON.stringify([record.layer, record.id]);
}
function sourceTime(record: WorldObservation): { timestamp: string; basis: string } {
  const providerTimestamp = record.properties?.providerTimestamp;
  if (validTimestamp(providerTimestamp)) return { timestamp: new Date(providerTimestamp).toISOString(), basis: "providerTimestamp" };
  return { timestamp: new Date(record.observedAt).toISOString(), basis: "WorldObservation.observedAt; provider-specific time is not separately reported" };
}
function synthetic(record: WorldObservation, summary: AtlasSourceEvidence | null): boolean {
  return record.freshness === "synthetic" || record.properties?.dataKind === "synthetic" || summary?.freshness === "synthetic" || summary?.dataKind === "synthetic" || /synthetic/i.test(record.source);
}
function findSummary(record: WorldObservation, summaries: readonly AtlasSourceEvidence[]): AtlasSourceEvidence | null {
  const candidates = [record.source, record.properties?.provider].filter((v): v is string => typeof v === "string" && v.length > 0).map((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return summaries.find((summary) => {
    const values = [summary.providerId, summary.providerName ?? ""].map((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, ""));
    return candidates.some((candidate) => values.some((value) => value === candidate || (candidate.length >= 6 && value.includes(candidate))));
  }) ?? null;
}
function evidence(record: WorldObservation, role: IncidentGraphRole, summary: AtlasSourceEvidence | null): IncidentGraphRecordEvidence {
  const time = sourceTime(record);
  const declared = record.properties?.dataKind;
  const knownKinds: readonly AtlasSourceDataKind[] = ["observation", "reported-event", "forecast", "modelled", "delayed", "synthetic", "geometric-estimate", "imagery", "unknown"];
  const declaredKind: AtlasSourceDataKind | null = declared === "measured" ? "observation" : declared === "model forecast (not an observation)" ? "forecast" : declared === "modelled" ? "modelled" : typeof declared === "string" && knownKinds.includes(declared as AtlasSourceDataKind) ? declared as AtlasSourceDataKind : null;
  const dataKind: AtlasSourceDataKind = synthetic(record, summary) ? "synthetic" : declaredKind ?? (summary?.dataKind && summary.dataKind !== "unknown" ? summary.dataKind : role === "road-closure" || role === "weather-advisory" ? "reported-event" : "observation");
  const retrievedAt = validTimestamp(record.properties?.retrievedAt) ? new Date(record.properties!.retrievedAt as string).toISOString() : summary?.retrievedAt ?? null;
  return {
    source: record.source, layer: record.layer, id: record.id, observedAt: record.observedAt,
    sourceTimestamp: time.timestamp, sourceTimestampBasis: time.basis, retrievedAt,
    recordFreshness: record.freshness ?? "unknown", providerFreshness: summary?.freshness ?? "unknown",
    coverage: typeof record.properties?.coverage === "string" ? record.properties.coverage : summary?.coverage ?? null,
    coverageStatus: summary?.coverageStatus ?? null, dataKind,
    confidence: typeof record.confidence === "number" ? record.confidence : null,
    uncertaintyM: typeof record.point.uncertaintyM === "number" ? record.point.uncertaintyM : null,
    sourceUrl: summary?.sourceUrl ?? null, timeBasis: summary?.timeBasis ?? null,
  };
}
function empty(status: ClosureScenarioStatus, sourceEvidence: AtlasSourceEvidence[], detail: string, omittedInputRecordCount = 0): ClosureScenarioResult {
  const coverageGaps = [detail];
  if (omittedInputRecordCount > 0) coverageGaps.push(`${omittedInputRecordCount} input record${omittedInputRecordCount === 1 ? " was" : "s were"} beyond the ${MAX_CLOSURE_SCENARIO_INPUT_RECORDS}-record scenario input cap was not considered.`);
  return { status, focusRecord: null, focusRole: null, durationHours: null, explicitStartAt: null, hypotheticalEndAt: null, timestampAssumptions: [...TIMESTAMP_ASSUMPTIONS], disclosure: DISCLOSURE, baselineAssociations: [], scenarioAssociations: [], comparison: { baseline: [], scenario: [], shared: [], baselineOnly: [], scenarioOnly: [] }, sourceEvidence, focusSourceEvidence: null, omittedInputRecordCount, omittedScenarioCount: 0, coverageGaps };
}

export function buildClosureDurationScenario(input: BuildClosureDurationScenarioInput): ClosureScenarioResult {
  const duration = input.durationHours ?? DEFAULT_CLOSURE_SCENARIO_DURATION_HOURS;
  const validDuration = Number.isInteger(duration) && duration >= 1 && duration <= MAX_CLOSURE_SCENARIO_DURATION_HOURS;
  const inputRecords = input.observations ?? [];
  const boundedInputRecords = inputRecords.slice(0, MAX_CLOSURE_SCENARIO_INPUT_RECORDS);
  const omittedInputRecordCount = Math.max(0, inputRecords.length - boundedInputRecords.length);
  const normalized = new Map<string, WorldObservation>();
  for (const value of boundedInputRecords) if (validateObservation(value)) { const record = normalizeObservation(value); normalized.set(key(record), record); }
  const records = [...normalized.values()].sort((a, b) => key(a).localeCompare(key(b)));
  const summaries = buildAtlasSourceEvidence({ observations: records, providerResults: input.providerResults, sourceSummaries: input.sourceSummaries });
  const focusInput = input.focusRecord && validateObservation(input.focusRecord) ? normalizeObservation(input.focusRecord) : null;
  const focus = focusInput ? records.find((record) => key(record) === key(focusInput)) ?? null : null;
  if (!focus) return empty("no-focus", summaries, "Select an already-loaded record to anchor this comparison. No provider request is made.", omittedInputRecordCount);
  const focusRole = classifyIncidentGraphRole(focus);
  const focusSummary = findSummary(focus, summaries);
  if (focusRole !== "road-closure") return { ...empty("unsupported-focus", summaries, "The selected record is not a supported road-closure record.", omittedInputRecordCount), focusRecord: focus, focusRole, focusSourceEvidence: focusSummary };
  if (input.incidentGraph.status !== "ready" || input.incidentGraph.focusNodeId !== key(focus)) return { ...empty("baseline-mismatch", summaries, "The supplied baseline graph is not ready for this exact selected record; no comparison was generated.", omittedInputRecordCount), focusRecord: focus, focusRole, focusSourceEvidence: focusSummary };
  if (!validDuration) return { ...empty("invalid-duration", summaries, `Duration must be an integer from 1 through ${MAX_CLOSURE_SCENARIO_DURATION_HOURS} hours; received ${String(duration)}.`, omittedInputRecordCount), focusRecord: focus, focusRole, focusSourceEvidence: focusSummary };
  const startValue = focus.properties?.startAt;
  if (startValue === undefined || startValue === null || (typeof startValue === "string" && !startValue.trim())) return { ...empty("missing-start", summaries, "The selected closure must provide an explicit valid properties.startAt; no other timestamp is used as a fallback.", omittedInputRecordCount), focusRecord: focus, focusRole, focusSourceEvidence: focusSummary };
  if (!validTimestamp(startValue)) return { ...empty("invalid-start", summaries, "The selected closure properties.startAt is present but invalid; no other timestamp is used as a fallback.", omittedInputRecordCount), focusRecord: focus, focusRole, focusSourceEvidence: focusSummary };
  const explicitStartAt = new Date(startValue).toISOString();
  const hypotheticalEndMs = Date.parse(explicitStartAt) + duration * 60 * 60 * 1000;
  if (!Number.isFinite(hypotheticalEndMs) || !Number.isFinite(new Date(hypotheticalEndMs).getTime())) return { ...empty("invalid-start", summaries, "The explicit startAt cannot be represented with the selected duration; no hypothetical end was generated.", omittedInputRecordCount), focusRecord: focus, focusRole, focusSourceEvidence: focusSummary };
  const hypotheticalEndAt = new Date(hypotheticalEndMs).toISOString();
  const graphNodeByKey = new Map(input.incidentGraph.nodes.map((node) => [key(node.record), node]));
  const baseline = input.incidentGraph.edges.filter((edge) => edge.kind === "spatial-temporal-association").flatMap((edge) => {
    const endpoint = edge.endpoints.find((item) => JSON.stringify([item.source, item.layer, item.id, item.observedAt]) !== key(focus));
    const node = endpoint ? graphNodeByKey.get(JSON.stringify([endpoint.source, endpoint.layer, endpoint.id, endpoint.observedAt])) : undefined;
    if (!node) return [];
    const record = node.record;
    return [{ associationId: key(record), record, role: node.role, evidence: endpoint!, sourceEvidence: node.sourceEvidence, distanceKm: edge.distanceKm, sourceTimestamp: endpoint!.sourceTimestamp, sourceTimestampBasis: endpoint!.sourceTimestampBasis, timeFromStartMs: null, basis: "Existing IncidentGraph spatial-temporal-association edge; exact matches and unresolved conflicts are excluded." }];
  });
  const capped = Math.max(1, Math.min(MAX_CLOSURE_SCENARIO_ASSOCIATIONS, input.maxAssociations ?? MAX_CLOSURE_SCENARIO_ASSOCIATIONS));
  const scenarioCandidates = records.flatMap((record) => {
    if (key(record) === key(focus) || identity(record) === identity(focus)) return [];
    const role = classifyIncidentGraphRole(record); if (!role) return [];
    const summary = findSummary(record, summaries); if (synthetic(record, summary) !== synthetic(focus, focusSummary)) return [];
    const time = sourceTime(record); const delta = Date.parse(time.timestamp) - Date.parse(explicitStartAt);
    if (delta < 0 || delta > duration * 60 * 60 * 1000) return [];
    const distanceKm = haversineKm(focus.point, record.point); if (distanceKm > input.incidentGraph.maxDistanceKm) return [];
    const node = graphNodeByKey.get(key(record));
    return [{ associationId: key(record), record, role, evidence: node?.evidence ?? evidence(record, role, summary), sourceEvidence: node?.sourceEvidence ?? summary, distanceKm, sourceTimestamp: time.timestamp, sourceTimestampBasis: time.basis, timeFromStartMs: delta, basis: `Hypothetical directed interval [${explicitStartAt}, ${hypotheticalEndAt}] inclusive; within ${input.incidentGraph.maxDistanceKm} km of the focus.` }];
  }).sort((a, b) => a.distanceKm - b.distanceKm || (a.timeFromStartMs ?? 0) - (b.timeFromStartMs ?? 0) || a.record.source.localeCompare(b.record.source) || a.record.layer.localeCompare(b.record.layer) || a.record.id.localeCompare(b.record.id) || key(a.record).localeCompare(key(b.record)));
  const scenario = scenarioCandidates.slice(0, capped);
  const baselineUnique = [...new Map(baseline.map((item) => [item.associationId, item])).values()];
  const scenarioUnique = [...new Map(scenario.map((item) => [item.associationId, item])).values()];
  const bKeys = new Set(baselineUnique.map((item) => item.associationId)); const sKeys = new Set(scenarioUnique.map((item) => item.associationId));
  const shared = scenarioUnique.filter((item) => bKeys.has(item.associationId));
  const omittedScenarioCount = Math.max(0, scenarioCandidates.length - scenario.length);
  const coverageGaps: string[] = [];
  if (omittedInputRecordCount > 0) coverageGaps.push(`${omittedInputRecordCount} input record${omittedInputRecordCount === 1 ? " was" : "s were"} beyond the ${MAX_CLOSURE_SCENARIO_INPUT_RECORDS}-record scenario input cap was not considered.`);
  for (const gap of input.incidentGraph.coverageGaps.filter((item) => /omitted|display cap/i.test(item))) coverageGaps.push(`Baseline graph: ${gap}`);
  if (omittedScenarioCount > 0) coverageGaps.push(`${omittedScenarioCount} eligible scenario record${omittedScenarioCount === 1 ? " was" : "s were"} omitted at the bounded scenario cap; the comparison is not complete.`);
  const result: ClosureScenarioResult = {
    status: "ready", focusRecord: focus, focusRole, durationHours: duration, explicitStartAt, hypotheticalEndAt,
    timestampAssumptions: [...TIMESTAMP_ASSUMPTIONS], disclosure: DISCLOSURE,
    baselineAssociations: baselineUnique, scenarioAssociations: scenarioUnique,
    comparison: { baseline: baselineUnique, scenario: scenarioUnique, shared, baselineOnly: baselineUnique.filter((item) => !sKeys.has(item.associationId)), scenarioOnly: scenarioUnique.filter((item) => !bKeys.has(item.associationId)) },
    sourceEvidence: summaries, focusSourceEvidence: focusSummary, omittedInputRecordCount, omittedScenarioCount, coverageGaps,
  };
  return result;
}
