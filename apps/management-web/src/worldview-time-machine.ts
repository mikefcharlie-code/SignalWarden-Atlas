import {
  validateObservation,
  type Freshness,
  type ProviderResult,
  type WorldObservation,
} from "./worldview-core";
import type { AtlasSignalFilters } from "./worldview-atlas";

export const MAX_ATLAS_TIME_MACHINE_SNAPSHOTS = 10;
export const MAX_ATLAS_TIME_MACHINE_OBSERVATIONS = 5_000;
export const MAX_ATLAS_TIME_MACHINE_PAYLOAD_BYTES = 2_000_000;

export interface AtlasTimeMachineView {
  center: { lat: number; lon: number };
  zoom: number;
  layers: Record<string, boolean>;
  signalFilters: AtlasSignalFilters;
}

export interface AtlasTimeMachineSourceSummary {
  providerId: string;
  providerName?: string;
  retrievedAt: string | null;
  freshness: Freshness | "unknown";
  observationCount: number;
  hasError: boolean;
  coverage?: string | null;
  truncated?: boolean | null;
  totalInArea?: number | null;
  cached?: boolean | null;
  sourceUrl?: string | null;
  attribution?: string | null;
  license?: string | null;
  termsUrl?: string | null;
}
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

export interface AtlasTimeMachineComparison {
  entries: AtlasTimeMachineComparisonEntry[];
  changes: AtlasTimeMachineComparisonEntry[];
  counts: Record<AtlasTimeMachineComparisonStatus, number>;
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
        if (typeof observation.properties?.coverage !== "string")
          coverageGaps.push(`Coverage not reported: ${observation.source}`);
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

  const providerSummaries = new Map<string, AtlasTimeMachineProviderSummary>();
  const providerEntries = Array.isArray(input.providerResults)
    ? input.providerResults.map((result) => [result.providerId, result] as const)
    : Object.entries(input.providerResults ?? {});
  for (const [providerId, result] of providerEntries.sort(([a], [b]) => a.localeCompare(b))) {
    const retrievedAt = typeof result?.retrievedAt === "string" && Number.isFinite(Date.parse(result.retrievedAt)) ? result.retrievedAt : null;
    const freshness: Freshness | "unknown" = result?.freshness ?? "unknown";
    const hasError = freshness === "failed" || (typeof result?.error === "string" && result.error.length > 0);
    const summary = {
      providerId,
      retrievedAt,
      freshness,
      observationCount: Array.isArray(result?.observations) ? result.observations.length : 0,
      hasError,
    } satisfies AtlasTimeMachineProviderSummary;
    providerSummaries.set(providerId, summary);
    if (hasError) coverageGaps.push(`Provider error recorded: ${providerId}`);
    if (!hasError && !result?.observations?.length) coverageGaps.push(`Empty source result: ${providerId}`);
    coverageGaps.push(`Coverage not reported: ${providerId}`);
  }
  for (const summary of input.sourceSummaries ?? []) {
    if (!summary || typeof summary.providerId !== "string" || !summary.providerId) continue;
    const hasError = summary.hasError || summary.freshness === "failed";
    providerSummaries.set(summary.providerId, { ...summary, hasError });
    if (hasError) coverageGaps.push(`Provider error recorded: ${summary.providerId}`);
    if (summary.observationCount === 0 && !hasError) coverageGaps.push(`Empty source result: ${summary.providerId}`);
    if (!summary.coverage) coverageGaps.push(`Coverage not reported: ${summary.providerId}`);
    if (summary.truncated) coverageGaps.push(`Source result reported truncation: ${summary.providerId}${summary.totalInArea === null || summary.totalInArea === undefined || summary.totalInArea <= 0 ? "" : ` (${summary.observationCount} shown of ${summary.totalInArea} in area)`}`);
  }
  const snapshot: AtlasTimeMachineSnapshot = {
    schemaVersion: 1,
    id: input.id,
    capturedAt: input.capturedAt,
    view: cloneView(input.view),
    observations,
    providerSummaries: [...providerSummaries.values()].sort((a, b) => a.providerId.localeCompare(b.providerId)),
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
  return { entries, changes: entries, counts };
}

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
    const fields = [...new Set(group.flatMap((item) => Object.keys(item)))].filter((field) => field !== "source").sort();
    const disagreements = fields
      .map((field) => {
        const values = bySource.map((item) => {
          const present = own(item, field);
          return present
            ? { present: true, value: (item as unknown as Record<string, unknown>)[field] }
            : { present: false };
        });
        const unique = [...new Map(values.map((value) => [stableJson(value), value])).values()];
        return { field, values: unique };
      })
      .filter((item) => item.values.length > 1);
    if (disagreements.length)
      conflicts.push({ key, layer: first.layer, id: first.id, sources: bySource.map((item) => item.source), reason: `Sources disagree on ${disagreements.map((item) => item.field).join(", ")}; no winner selected`, disagreements });
  }
  return conflicts;
}
