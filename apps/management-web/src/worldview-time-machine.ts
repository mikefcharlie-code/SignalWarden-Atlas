import {
  validateObservation,
  type ProviderResult,
  type WorldObservation,
} from "./worldview-core";
import type { AtlasSignalFilters } from "./worldview-atlas";
import { buildAtlasSourceEvidence, type AtlasSourceEvidence } from "./worldview-source-evidence";

export const MAX_ATLAS_TIME_MACHINE_SNAPSHOTS = 10;
export const MAX_ATLAS_TIME_MACHINE_OBSERVATIONS = 5_000;
export const MAX_ATLAS_TIME_MACHINE_PAYLOAD_BYTES = 2_000_000;

export interface AtlasTimeMachineView {
  center: { lat: number; lon: number };
  zoom: number;
  layers: Record<string, boolean>;
  signalFilters: AtlasSignalFilters;
}

export type AtlasTimeMachineSourceSummary = AtlasSourceEvidence;
export type AtlasTimeMachineProviderSummary = AtlasTimeMachineSourceSummary;

export interface AtlasTimeMachineSnapshot {
  schemaVersion: 1;
  id: string;
  capturedAt: string;
  view: AtlasTimeMachineView;
  observations: WorldObservation[];
  providerSummaries: AtlasTimeMachineProviderSummary[];
  coverageGaps: string[];
}

export type AtlasTimeMachineComparisonStatus =
  | "added"
  | "removed"
  | "changed"
  | "unchanged";

export interface AtlasTimeMachineComparisonEntry {
  key: string;
  identity: string;
  status: AtlasTimeMachineComparisonStatus;
  before?: WorldObservation;
  after?: WorldObservation;
  changedFields: string[];
}

export interface AtlasTimeMachineSourceChange {
  key: string;
  identity: string;
  status: AtlasTimeMachineComparisonStatus;
  before?: AtlasTimeMachineProviderSummary;
  after?: AtlasTimeMachineProviderSummary;
  changedFields: string[];
}

export interface AtlasTimeMachineComparison {
  entries: AtlasTimeMachineComparisonEntry[];
  changes: AtlasTimeMachineComparisonEntry[];
  counts: Record<AtlasTimeMachineComparisonStatus, number>;
  sourceChanges: AtlasTimeMachineSourceChange[];
  sourceCounts: Record<AtlasTimeMachineComparisonStatus, number>;
}
export type AtlasTimeMachineChange = AtlasTimeMachineComparisonEntry;

export interface AtlasTimeMachineConflict {
  key: string;
  layer: string;
  id: string;
  sources: string[];
  reason: string;
  disagreements: Array<{ field: string; values: unknown[] }>;
}

const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

function isFiniteCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function assertTimestamp(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error(`Invalid ${name}`);
}

function cloneObservation(value: WorldObservation): WorldObservation {
  return {
    ...value,
    point: { ...value.point },
    ...(value.properties === undefined ? {} : { properties: { ...value.properties } }),
  };
}

function cloneView(view: AtlasTimeMachineView): AtlasTimeMachineView {
  if (
    !view ||
    !view.center ||
    !isFiniteCoordinate(view.center.lat, -90, 90) ||
    !isFiniteCoordinate(view.center.lon, -180, 180) ||
    typeof view.zoom !== "number" ||
    !Number.isFinite(view.zoom) ||
    !view.layers ||
    !view.signalFilters
  )
    throw new Error("Invalid Atlas time-machine view");
  const layers = Object.fromEntries(
    Object.entries(view.layers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, enabled]) => {
        if (typeof key !== "string" || typeof enabled !== "boolean")
          throw new Error("Invalid Atlas time-machine layer state");
        return [key, enabled];
      }),
  );
  const signalFilters = { ...view.signalFilters } as AtlasSignalFilters;
  if (Object.values(signalFilters).some((enabled) => typeof enabled !== "boolean"))
    throw new Error("Invalid Atlas signal filters");
  return {
    center: { lat: view.center.lat, lon: view.center.lon },
    zoom: view.zoom,
    layers,
    signalFilters,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function observationKey(value: Pick<WorldObservation, "source" | "layer" | "id">): string {
  return JSON.stringify([value.source, value.layer, value.id]);
}

function changedFields(before: WorldObservation, after: WorldObservation): string[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...fields]
    .filter((field) => stableJson((before as unknown as Record<string, unknown>)[field]) !== stableJson((after as unknown as Record<string, unknown>)[field]))
    .sort();
}

function assertPayload(snapshot: AtlasTimeMachineSnapshot): void {
  if (snapshot.observations.length > MAX_ATLAS_TIME_MACHINE_OBSERVATIONS)
    throw new Error(`Atlas time-machine observation cap exceeded: ${MAX_ATLAS_TIME_MACHINE_OBSERVATIONS}`);
  const bytes = new TextEncoder().encode(stableJson(snapshot)).byteLength;
  if (bytes > MAX_ATLAS_TIME_MACHINE_PAYLOAD_BYTES)
    throw new Error(`Atlas time-machine payload cap exceeded: ${MAX_ATLAS_TIME_MACHINE_PAYLOAD_BYTES} bytes`);
}

export function createAtlasTimeMachineSnapshot(input: {
  id: string;
  capturedAt: string;
  observations?: readonly WorldObservation[] | null;
  view: AtlasTimeMachineView;
  providerResults?: Readonly<Record<string, ProviderResult>> | readonly ProviderResult[] | null;
  sourceSummaries?: readonly AtlasTimeMachineSourceSummary[] | null;
}): AtlasTimeMachineSnapshot {
  if (!input || typeof input.id !== "string" || input.id.length === 0) throw new Error("Invalid Atlas snapshot id");
  assertTimestamp(input.capturedAt, "capture timestamp");
  const observations: WorldObservation[] = [];
  const coverageGaps: string[] = [
    "Point observations only: imagery, raster and animated overlays, camera image bytes, and provider-only states outside the shared marker list are excluded",
  ];
  if (input.observations == null) {
    coverageGaps.push("Missing observations: no observation collection was supplied");
  } else {
    if (!Array.isArray(input.observations)) throw new Error("Invalid observations collection");
    for (const observation of input.observations) {
      if (validateObservation(observation)) {
        observations.push(cloneObservation(observation));
        if (observation.properties?.truncated === true)
          coverageGaps.push(`Source result reported truncation: ${observation.source}`);
      }
      else coverageGaps.push("Invalid observation omitted from capture");
    }
  }
  if (observations.length === 0)
    coverageGaps.push("No point records were loaded; absence is not evidence that a source returned no events or that an area is clear");
  if (observations.length > MAX_ATLAS_TIME_MACHINE_OBSERVATIONS)
    throw new Error(`Atlas time-machine observation cap exceeded: ${MAX_ATLAS_TIME_MACHINE_OBSERVATIONS}`);

  const providerSummaries = buildAtlasSourceEvidence({
    observations,
    providerResults: input.providerResults,
    sourceSummaries: input.sourceSummaries,
  });
  for (const summary of providerSummaries) {
    const coverageStatus = summary.coverageStatus ?? (summary.coverage ? "reported" : "unknown");
    if (summary.hasError) coverageGaps.push(`Provider error recorded: ${summary.providerId}`);
    if (!summary.hasError && coverageStatus !== "out_of_coverage" && summary.observationCount === 0 && summary.loadedRecordCount === 0)
      coverageGaps.push(`Empty source result: ${summary.providerId}`);
    if (coverageStatus === "unknown")
      coverageGaps.push(`Coverage not reported: ${summary.providerId}`);
    else if (coverageStatus === "partial")
      coverageGaps.push(`Partial source coverage: ${summary.providerId}`);
    else if (coverageStatus === "out_of_coverage")
      coverageGaps.push(`Source reports out of coverage: ${summary.providerId}`);
    if (summary.truncated)
      coverageGaps.push(`Source result reported truncation: ${summary.providerId}${summary.totalInArea === null || summary.totalInArea === undefined || summary.totalInArea <= 0 ? "" : ` (${summary.observationCount} shown of ${summary.totalInArea} in area)`}`);
  }
  const snapshot: AtlasTimeMachineSnapshot = {
    schemaVersion: 1,
    id: input.id,
    capturedAt: input.capturedAt,
    view: cloneView(input.view),
    observations,
    providerSummaries,
    coverageGaps: [...new Set(coverageGaps)],
  };
  assertPayload(snapshot);
  return snapshot;
}

export function retainAtlasTimeMachineSnapshots(
  existing: readonly AtlasTimeMachineSnapshot[],
  next: AtlasTimeMachineSnapshot,
): AtlasTimeMachineSnapshot[] {
  assertPayload(next);
  if (!Array.isArray(existing)) throw new Error("Invalid Atlas snapshot history");
  const all = [...existing, next];
  if (all.some((snapshot) => !snapshot || snapshot.schemaVersion !== 1)) throw new Error("Invalid Atlas snapshot history");
  return all.slice(-MAX_ATLAS_TIME_MACHINE_SNAPSHOTS);
}

export function compareAtlasTimeMachineSnapshots(
  before: AtlasTimeMachineSnapshot,
  after: AtlasTimeMachineSnapshot,
): AtlasTimeMachineComparison {
  const left = new Map(before.observations.map((item) => [observationKey(item), item]));
  const right = new Map(after.observations.map((item) => [observationKey(item), item]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const entries = keys.map((key): AtlasTimeMachineComparisonEntry => {
    const a = left.get(key), b = right.get(key);
    if (!a) return { key, identity: key, status: "added", after: cloneObservation(b!), changedFields: [] };
    if (!b) return { key, identity: key, status: "removed", before: cloneObservation(a), changedFields: [] };
    const fields = changedFields(a, b);
    return { key, identity: key, status: fields.length ? "changed" : "unchanged", before: cloneObservation(a), after: cloneObservation(b), changedFields: fields };
  });
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const entry of entries) counts[entry.status]++;

  const leftSources = new Map(before.providerSummaries.map((summary) => [summary.providerId, summary]));
  const rightSources = new Map(after.providerSummaries.map((summary) => [summary.providerId, summary]));
  const sourceKeys = [...new Set([...leftSources.keys(), ...rightSources.keys()])].sort();
  const sourceChanges = sourceKeys.map((key): AtlasTimeMachineSourceChange => {
    const a = leftSources.get(key), b = rightSources.get(key);
    if (!a) return { key, identity: key, status: "added", after: b, changedFields: [] };
    if (!b) return { key, identity: key, status: "removed", before: a, changedFields: [] };
    const fields = new Set([...Object.keys(a), ...Object.keys(b)]);
    const changed = [...fields]
      .filter((field) => stableJson((a as unknown as Record<string, unknown>)[field]) !== stableJson((b as unknown as Record<string, unknown>)[field]))
      .sort();
    return { key, identity: key, status: changed.length ? "changed" : "unchanged", before: a, after: b, changedFields: changed };
  });
  const sourceCounts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const change of sourceChanges) sourceCounts[change.status]++;
  return { entries, changes: entries, counts, sourceChanges, sourceCounts };
}

const NON_EVIDENCE_PROPERTY_KEYS = new Set([
  "source", "provider", "freshness", "stale", "dataKind", "error", "errorState", "attribution", "license", "terms", "termsUrl", "sourceUrl", "retrievedAt", "providerTimestamp",
  "freshnessBasis", "sourceTimeBasis", "coverage", "coverageStatus", "truncated", "cached", "verification", "disclosure", "knownBlindSpots", "absenceMeaning",
]);

export function findAtlasTimeMachineConflicts(
  observations: readonly WorldObservation[],
): AtlasTimeMachineConflict[] {
  const groups = new Map<string, WorldObservation[]>();
  for (const observation of observations) {
    if (!validateObservation(observation)) continue;
    const key = JSON.stringify([observation.layer, observation.id]);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }
  const conflicts: AtlasTimeMachineConflict[] = [];
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bySource = [...new Map(group.map((item) => [item.source, item])).values()].sort((a, b) => a.source.localeCompare(b.source));
    if (bySource.length < 2) continue;
    const [first] = bySource;
    const candidateFields = new Set([
      "point",
      ...(bySource.some((item) => item.confidence !== undefined) ? ["confidence"] : []),
      ...bySource.flatMap((item) => Object.keys(item.properties ?? {})
        .filter((field) => !NON_EVIDENCE_PROPERTY_KEYS.has(field))
        .map((field) => `properties.${field}`)),
    ]);
    const disagreements = [...candidateFields].sort().flatMap((field) => {
      const values = bySource.flatMap((item) => {
        if (field.startsWith("properties.")) {
          const property = field.slice("properties.".length);
          return own(item.properties ?? {}, property)
            ? [{ source: item.source, value: item.properties?.[property] }]
            : [];
        }
        return own(item, field) ? [{ source: item.source, value: (item as unknown as Record<string, unknown>)[field] }] : [];
      });
      if (new Set(values.map((item) => item.source)).size < 2) return [];
      const unique = [...new Map(values.map((item) => [stableJson(item.value), item.value])).values()];
      return unique.length > 1 ? [{ field, values: unique }] : [];
    });
    if (disagreements.length)
      conflicts.push({ key, layer: first.layer, id: first.id, sources: bySource.map((item) => item.source), reason: `Sources disagree on data-bearing fields ${disagreements.map((item) => item.field).join(", ")}; freshness and provenance metadata are not treated as conflicts, and no winner is selected`, disagreements });
  }
  return conflicts;
}
