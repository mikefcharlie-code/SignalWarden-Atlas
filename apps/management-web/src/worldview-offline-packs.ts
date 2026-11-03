import {
  haversineKm,
  validatePoint,
  validateObservation,
  type ProviderResult,
  type WorldObservation,
} from "./worldview-core";
import {
  buildAtlasSourceEvidence,
  type AtlasSourceEvidence,
} from "./worldview-source-evidence";
import {
  compareAtlasTimeMachineSnapshots,
  createAtlasTimeMachineSnapshot,
  findAtlasTimeMachineConflicts,
  type AtlasTimeMachineSnapshot,
  type AtlasTimeMachineView,
} from "./worldview-time-machine";

export const MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS = 500;
export const MAX_ATLAS_OFFLINE_PACK_BYTES = 1_000_000;
export const MAX_ATLAS_OFFLINE_PACKS_IN_SESSION = 5;
export const MAX_ATLAS_OFFLINE_SESSION_BYTES = 5_000_000;
export const MAX_ATLAS_OFFLINE_RADIUS_KM = 100;
export const MAX_ATLAS_OFFLINE_SOURCE_SUMMARIES = 100;

const PACK_SCHEMA = "signalwarden.atlas-offline-field-pack" as const;
const MAX_TEXT = 500;
const FRESHNESS = new Set(["fresh", "stale", "fallback", "failed", "synthetic", "unknown"]);
const DATA_KINDS = new Set(["observation", "reported-event", "forecast", "modelled", "delayed", "synthetic", "geometric-estimate", "imagery", "unknown"]);
const SOURCE_FRESHNESS = new Set([...FRESHNESS, "mixed"]);
const SOURCE_ERROR_STATES = new Set(["reported", "clear", "unknown"]);
const COVERAGE_STATUSES = new Set(["reported", "partial", "out_of_coverage", "unknown"]);
const EXCLUDED_SURFACES = [
  "External imagery and raster bytes",
  "Animated overlays",
  "Basemap/map tiles",
  "Camera image bytes",
  "Provider-only states outside the shared point-observation and source-summary surfaces",
] as const;
const MEDIA_GAP = "Not included (no offline media bytes): external imagery/raster, animated overlays, basemap tiles, camera images, and provider-only display states. Existing Atlas adapters and source terms do not establish permission to retain these bytes offline.";
const AREA_GAP = "The selected circle bounds which loaded point records may be selected; it is not a provider query boundary or proof of provider coverage.";
const EMPTY_GAP = "No point records were selected for this area. Missing or empty records do not establish that events are absent or conditions are clear.";
const ABSENCE_GAP = "Missing, empty, unknown, failed, or omitted observations and summaries do not establish that events are absent or conditions are clear.";
const IMPORT_GAP = "Imported pack content and source labels are user-supplied; schema validation does not authenticate provenance, licensing, freshness, completeness, or retention rights.";
const RECOMPUTED_CONFLICT_GAP = "The imported conflict log did not match the packed observations and was recomputed locally; imported conflict claims are not authenticated.";

/**
 * Only these source classes have a clear offline-copy basis in the current Atlas
 * source register. Other provider records remain visible in Atlas but are not
 * copied into this portable artifact by default.
 */
const RETENTION_RULES: Readonly<Record<string, string>> = {
  usgs: "USGS data is documented as U.S. public-domain data; courtesy attribution is preserved.",
  "noaa-weather": "NWS public-data terms are documented; NOAA/NWS attribution and no-endorsement context are preserved.",
  "signalwarden-demo": "Locally generated synthetic sample; not provider evidence.",
};

export interface AtlasOfflineFieldPack {
  schema: typeof PACK_SCHEMA;
  schemaVersion: 1;
  id: string;
  capturedAt: string;
  area: {
    shape: "circle";
    center: { lat: number; lon: number };
    radiusKm: number;
  };
  view: AtlasTimeMachineView;
  observations: WorldObservation[];
  providerSummaries: AtlasSourceEvidence[];
  conflictLog: Array<{ layer: string; id: string; sources: string[]; disagreements: Array<{ field: string; values: unknown[] }> }>;
  coverageGaps: string[];
  excludedSources: string[];
  excludedSurfaces: string[];
}

export interface AtlasOfflineSourcePolicy {
  providerId: string;
  includedByDefault: boolean;
  reason: string;
}

export interface AtlasOfflinePackComparison {
  records: ReturnType<typeof compareAtlasTimeMachineSnapshots>;
  conflicts: ReturnType<typeof findAtlasTimeMachineConflicts>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function identityOf(value: Pick<WorldObservation, "source" | "layer" | "id">): string {
  return JSON.stringify([value.source, value.layer, value.id]);
}

function sourceEvidenceFor(source: string): AtlasSourceEvidence | undefined {
  const rows = buildAtlasSourceEvidence({ observations: [{
    id: "offline-source-policy-probe",
    layer: "offline-policy",
    point: { lat: 0, lon: 0 },
    observedAt: "2000-01-01T00:00:00.000Z",
    source,
    label: "policy probe",
  }] });
  return rows[0];
}

export function atlasOfflineSourcePolicy(source: string): AtlasOfflineSourcePolicy {
  const evidence = sourceEvidenceFor(source);
  const providerId = evidence?.providerId ?? source;
  const reason = RETENTION_RULES[providerId];
  return {
    providerId,
    includedByDefault: reason !== undefined,
    reason: reason ?? "Current Atlas source notes do not establish permission for offline storage/export; this source is excluded by default.",
  };
}

function providerEntries(
  value: Readonly<Record<string, ProviderResult>> | readonly ProviderResult[] | null | undefined,
): Array<[string, ProviderResult]> {
  if (Array.isArray(value)) return value.map((result) => [result.providerId, result]);
  return Object.entries(value ?? {});
}

function providerBacksObservation(
  observation: WorldObservation,
  providerResults: Readonly<Record<string, ProviderResult>> | readonly ProviderResult[] | null | undefined,
): boolean {
  const targetPolicy = atlasOfflineSourcePolicy(observation.source);
  return providerEntries(providerResults).some(([providerId, result]) => {
    if (atlasOfflineSourcePolicy(providerId).providerId !== targetPolicy.providerId) return false;
    return result.observations.some((candidate) => {
      if (!validateObservation(candidate)) return false;
      if (identityOf(candidate) !== identityOf(observation) || candidate.observedAt !== observation.observedAt) return false;
      if (candidate.point.lat !== observation.point.lat || candidate.point.lon !== observation.point.lon) return false;
      const withoutVolatileFreshness = (record: WorldObservation) => {
        const { freshness: _freshness, stale: _stale, ...stable } = record;
        return stable;
      };
      return stableJson(withoutVolatileFreshness(candidate)) === stableJson(withoutVolatileFreshness(observation));
    });
  });
}

export function atlasOfflineObservationPolicy(
  observation: WorldObservation,
  providerResults?: Readonly<Record<string, ProviderResult>> | readonly ProviderResult[] | null,
): AtlasOfflineSourcePolicy {
  const sourcePolicy = atlasOfflineSourcePolicy(observation.source);
  if (sourcePolicy.providerId === "signalwarden-demo") {
    const synthetic = observation.freshness === "synthetic";
    return {
      ...sourcePolicy,
      includedByDefault: synthetic,
      reason: synthetic ? sourcePolicy.reason : "Synthetic source records must retain their synthetic freshness label.",
    };
  }
  if (!sourcePolicy.includedByDefault) return sourcePolicy;
  if (!providerBacksObservation(observation, providerResults)) {
    return {
      ...sourcePolicy,
      includedByDefault: false,
      reason: "This provider-labelled record does not exactly match an already-loaded provider result; imported or edited source labels are not proof of provenance.",
    };
  }
  return sourcePolicy;
}

function cloneObservation(value: WorldObservation): WorldObservation {
  if (!validateObservation(value) || !onlyKeys(value as unknown as Record<string, unknown>, [
    "id", "layer", "point", "observedAt", "source", "label", "title", "stale", "freshness", "confidence", "properties",
  ])) throw new Error("Invalid offline field-pack observation");
  return {
    ...value,
    point: { ...value.point },
    ...(value.properties === undefined ? {} : { properties: { ...value.properties } }),
  };
}

function cloneView(value: unknown): AtlasTimeMachineView {
  if (!isObject(value) || !onlyKeys(value, ["center", "zoom", "layers", "signalFilters"]))
    throw new Error("Invalid offline field-pack view");
  if (!isObject(value.center) || !onlyKeys(value.center, ["lat", "lon"]) ||
    typeof value.center.lat !== "number" || !Number.isFinite(value.center.lat) || value.center.lat < -90 || value.center.lat > 90 ||
    typeof value.center.lon !== "number" || !Number.isFinite(value.center.lon) || value.center.lon < -180 || value.center.lon > 180)
    throw new Error("Invalid offline field-pack map center");
  if (typeof value.zoom !== "number" || !Number.isFinite(value.zoom) || value.zoom < 0 || value.zoom > 30)
    throw new Error("Invalid offline field-pack zoom");
  const cloneBooleans = (input: unknown, name: string): Record<string, boolean> => {
    if (!isObject(input) || Object.keys(input).length > 100 || Object.entries(input).some(([key, enabled]) => !key || key.length > 100 || typeof enabled !== "boolean"))
      throw new Error(`Invalid offline field-pack ${name}`);
    return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, boolean]>);
  };
  return {
    center: { lat: value.center.lat, lon: value.center.lon },
    zoom: value.zoom,
    layers: cloneBooleans(value.layers, "layers"),
    signalFilters: cloneBooleans(value.signalFilters, "signal filters") as AtlasTimeMachineView["signalFilters"],
  };
}

function cloneSummary(value: unknown): AtlasSourceEvidence {
  const allowed = [
    "providerId", "providerName", "retrievedAt", "freshness", "freshnessStates", "dataKind", "observationCount", "loadedRecordCount", "hasError", "error", "errorState", "coverage", "coverageStatus", "truncated", "totalInArea", "cached", "sourceUrl", "attribution", "license", "termsUrl", "termsText", "knownBlindSpots", "timeBasis", "absenceMeaning",
  ] as const;
  if (!isObject(value) || !onlyKeys(value, allowed)) throw new Error("Invalid offline field-pack source summary");
  const textOrNull = (field: string, max = MAX_TEXT): string | null | undefined => {
    const item = value[field];
    if (item === undefined || item === null) return item as null | undefined;
    if (typeof item !== "string" || item.length > max) throw new Error(`Invalid source summary ${field}`);
    return item;
  };
  const timestampOrNull = (field: string): string | null => {
    const item = value[field];
    if (item === null) return null;
    if (!isTimestamp(item)) throw new Error(`Invalid source summary ${field}`);
    return item;
  };
  const safeUrl = (field: string): string | null | undefined => {
    const text = textOrNull(field, 1000);
    if (text === undefined || text === null) return text;
    try {
      const url = new URL(text);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe URL");
      url.search = "";
      url.hash = "";
      return url.toString().slice(0, 1000);
    } catch {
      throw new Error(`Invalid source summary ${field}`);
    }
  };
  if (typeof value.providerId !== "string" || !value.providerId.trim() || value.providerId.length > 120)
    throw new Error("Invalid offline field-pack source ID");
  if (!SOURCE_FRESHNESS.has(String(value.freshness))) throw new Error("Invalid source summary freshness");
  if (value.freshnessStates !== undefined && (!Array.isArray(value.freshnessStates) || value.freshnessStates.length > 6 || value.freshnessStates.some((item) => !FRESHNESS.has(String(item)))))
    throw new Error("Invalid source summary freshness states");
  if (value.dataKind !== undefined && !DATA_KINDS.has(String(value.dataKind))) throw new Error("Invalid source summary data kind");
  for (const field of ["observationCount", "loadedRecordCount"] as const) {
    const item = value[field];
    if (item !== undefined && (!Number.isInteger(item) || Number(item) < 0 || Number(item) > 100_000))
      throw new Error(`Invalid source summary ${field}`);
  }
  if (typeof value.observationCount !== "number" || typeof value.hasError !== "boolean")
    throw new Error("Invalid offline field-pack source summary counts");
  if (value.errorState !== undefined && !SOURCE_ERROR_STATES.has(String(value.errorState))) throw new Error("Invalid source summary error state");
  if (value.coverageStatus !== undefined && !COVERAGE_STATUSES.has(String(value.coverageStatus))) throw new Error("Invalid source summary coverage status");
  for (const field of ["truncated", "cached"] as const) {
    const item = value[field];
    if (item !== undefined && item !== null && typeof item !== "boolean") throw new Error(`Invalid source summary ${field}`);
  }
  if (value.totalInArea !== undefined && value.totalInArea !== null && (typeof value.totalInArea !== "number" || !Number.isFinite(value.totalInArea) || value.totalInArea < 0))
    throw new Error("Invalid source summary totalInArea");
  const knownBlindSpots = value.knownBlindSpots;
  if (knownBlindSpots !== undefined && (!Array.isArray(knownBlindSpots) || knownBlindSpots.length > 12 || knownBlindSpots.some((item) => typeof item !== "string" || item.length > MAX_TEXT)))
    throw new Error("Invalid source summary knownBlindSpots");
  const retrievedAt = timestampOrNull("retrievedAt");
  const cloned: AtlasSourceEvidence = {
    providerId: value.providerId,
    retrievedAt,
    freshness: value.freshness as AtlasSourceEvidence["freshness"],
    observationCount: value.observationCount as number,
    hasError: value.hasError,
  };
  const optionalTextFields = ["providerName", "error", "coverage", "attribution", "license", "termsText", "timeBasis", "absenceMeaning"] as const;
  for (const field of optionalTextFields) {
    const item = textOrNull(field, field === "error" ? 280 : MAX_TEXT);
    if (item !== undefined) (cloned as unknown as Record<string, unknown>)[field] = item;
  }
  const sourceUrl = safeUrl("sourceUrl"), termsUrl = safeUrl("termsUrl");
  if (sourceUrl !== undefined) cloned.sourceUrl = sourceUrl;
  if (termsUrl !== undefined) cloned.termsUrl = termsUrl;
  if (value.freshnessStates !== undefined) cloned.freshnessStates = [...value.freshnessStates as string[]] as AtlasSourceEvidence["freshnessStates"];
  if (value.dataKind !== undefined) cloned.dataKind = value.dataKind as AtlasSourceEvidence["dataKind"];
  if (value.loadedRecordCount !== undefined) cloned.loadedRecordCount = value.loadedRecordCount as number;
  if (value.errorState !== undefined) cloned.errorState = value.errorState as AtlasSourceEvidence["errorState"];
  if (value.coverageStatus !== undefined) cloned.coverageStatus = value.coverageStatus as AtlasSourceEvidence["coverageStatus"];
  if (value.truncated !== undefined) cloned.truncated = value.truncated as boolean | null;
  if (value.totalInArea !== undefined) cloned.totalInArea = value.totalInArea as number | null;
  if (value.cached !== undefined) cloned.cached = value.cached as boolean | null;
  if (knownBlindSpots !== undefined) cloned.knownBlindSpots = [...knownBlindSpots as string[]];
  return cloned;
}

function cloneArea(value: unknown): AtlasOfflineFieldPack["area"] {
  if (!isObject(value) || !onlyKeys(value, ["shape", "center", "radiusKm"]) || value.shape !== "circle" ||
    !isObject(value.center) || !onlyKeys(value.center, ["lat", "lon"]) ||
    typeof value.center.lat !== "number" || !Number.isFinite(value.center.lat) || value.center.lat < -90 || value.center.lat > 90 ||
    typeof value.center.lon !== "number" || !Number.isFinite(value.center.lon) || value.center.lon < -180 || value.center.lon > 180 ||
    typeof value.radiusKm !== "number" || !Number.isFinite(value.radiusKm) || value.radiusKm <= 0 || value.radiusKm > MAX_ATLAS_OFFLINE_RADIUS_KM)
    throw new Error("Invalid offline field-pack area");
  return { shape: "circle", center: { lat: value.center.lat, lon: value.center.lon }, radiusKm: value.radiusKm };
}

function packByteLength(pack: AtlasOfflineFieldPack): number {
  return new TextEncoder().encode(JSON.stringify(pack)).byteLength;
}

function buildConflictLog(observations: readonly WorldObservation[]): AtlasOfflineFieldPack["conflictLog"] {
  return findAtlasTimeMachineConflicts(observations).map(({ layer, id, sources, disagreements }) => ({
    layer,
    id,
    sources: [...sources],
    disagreements: disagreements.map(({ field, values }) => ({ field, values: [...values] })),
  }));
}

function validConflictValue(value: unknown): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= MAX_TEXT;
  if (typeof value === "number") return Number.isFinite(value);
  return isObject(value) && onlyKeys(value, ["lat", "lon", "altM", "uncertaintyM"]) && validatePoint(value);
}

function validateConflictLog(value: unknown): AtlasOfflineFieldPack["conflictLog"] {
  if (!Array.isArray(value) || value.length > MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS)
    throw new Error("Invalid offline field-pack conflict log");
  const entries = value.map((entry) => {
    if (!isObject(entry) || !onlyKeys(entry, ["layer", "id", "sources", "disagreements"]) ||
      typeof entry.layer !== "string" || !entry.layer || entry.layer.length > 80 ||
      typeof entry.id !== "string" || !entry.id || entry.id.length > 120 ||
      !Array.isArray(entry.sources) || entry.sources.length < 2 || entry.sources.length > 100 ||
      entry.sources.some((source) => typeof source !== "string" || !source || source.length > 240) ||
      new Set(entry.sources).size !== entry.sources.length ||
      !Array.isArray(entry.disagreements) || entry.disagreements.length < 1 || entry.disagreements.length > 34)
      throw new Error("Invalid offline field-pack conflict log entry");
    const disagreements = entry.disagreements.map((item) => {
      if (!isObject(item) || !onlyKeys(item, ["field", "values"]) || typeof item.field !== "string" || !item.field || item.field.length > 160 ||
        !Array.isArray(item.values) || item.values.length < 2 || item.values.length > 100 || !item.values.every(validConflictValue))
        throw new Error("Invalid offline field-pack conflict values");
      return { field: item.field, values: [...item.values] };
    });
    return { layer: entry.layer, id: entry.id, sources: [...entry.sources as string[]], disagreements };
  });
  if (new Set(entries.map((entry) => JSON.stringify([entry.layer, entry.id]))).size !== entries.length)
    throw new Error("Offline field-pack conflict identities must be unique");
  return entries;
}

function sourceListForGap(values: readonly string[]): string {
  const sorted = [...values].sort();
  return sorted.length <= 12 ? sorted.join(", ") : `${sorted.slice(0, 12).join(", ")} and ${sorted.length - 12} more`;
}

function boundedGap(value: string): string {
  return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT - 16)} [truncated]`;
}

function assertPackBounds(pack: AtlasOfflineFieldPack): void {
  if (pack.observations.length > MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS)
    throw new Error(`Offline field-pack observation cap exceeded: ${MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS}`);
  if (pack.providerSummaries.length > MAX_ATLAS_OFFLINE_SOURCE_SUMMARIES)
    throw new Error(`Offline field-pack source-summary cap exceeded: ${MAX_ATLAS_OFFLINE_SOURCE_SUMMARIES}`);
  if (pack.coverageGaps.length > 100 || pack.excludedSources.length > 100)
    throw new Error("Offline field-pack evidence-list cap exceeded");
  if (packByteLength(pack) > MAX_ATLAS_OFFLINE_PACK_BYTES)
    throw new Error(`Offline field-pack payload cap exceeded: ${MAX_ATLAS_OFFLINE_PACK_BYTES} bytes`);
}

export function createAtlasOfflineFieldPack(input: {
  id: string;
  capturedAt: string;
  area: AtlasOfflineFieldPack["area"];
  view: AtlasTimeMachineView;
  observations: readonly WorldObservation[];
  selectedObservationKeys: readonly string[];
  providerResults?: Readonly<Record<string, ProviderResult>> | readonly ProviderResult[] | null;
  sourceSummaries?: readonly AtlasSourceEvidence[] | null;
}): AtlasOfflineFieldPack {
  if (!input || typeof input.id !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(input.id))
    throw new Error("Invalid offline field-pack ID");
  if (!isTimestamp(input.capturedAt) || Date.parse(input.capturedAt) > Date.now() + 60_000)
    throw new Error("Invalid offline field-pack capture timestamp");
  const area = cloneArea(input.area);
  const view = cloneView(input.view);
  if (!Array.isArray(input.observations) || !Array.isArray(input.selectedObservationKeys))
    throw new Error("Invalid offline field-pack selection");
  if (input.selectedObservationKeys.length > MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS)
    throw new Error(`Offline field-pack observation cap exceeded: ${MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS}`);
  const selected = new Set(input.selectedObservationKeys);
  if (selected.size !== input.selectedObservationKeys.length)
    throw new Error("Offline field-pack selection contains duplicate record identities");
  const byIdentity = new Map<string, WorldObservation[]>();
  let invalidLoadedCount = 0;
  for (const observation of input.observations) {
    if (!validateObservation(observation)) { invalidLoadedCount++; continue; }
    if (haversineKm(area.center, observation.point) > area.radiusKm) continue;
    const key = identityOf(observation);
    const group = byIdentity.get(key) ?? [];
    group.push(observation);
    byIdentity.set(key, group);
  }
  const selectedObservations: WorldObservation[] = [];
  const unsupported = new Set<string>();
  for (const key of selected) {
    const matches = byIdentity.get(key) ?? [];
    if (matches.length !== 1) throw new Error("Selected observation is missing, duplicated, invalid, or outside the bounded area");
    const observation = matches[0];
    const policy = atlasOfflineObservationPolicy(observation, input.providerResults);
    if (!policy.includedByDefault) throw new Error(`Source ${policy.providerId} cannot be included: ${policy.reason}`);
    selectedObservations.push(cloneObservation(observation));
  }
  for (const [key, matches] of byIdentity) {
    if (matches.length > 1) {
      for (const item of matches) if (selected.has(key)) throw new Error("Selected observation identity is duplicated and ambiguous");
      continue;
    }
    const policy = atlasOfflineObservationPolicy(matches[0], input.providerResults);
    if (!policy.includedByDefault) unsupported.add(policy.providerId);
  }
  if (selectedObservations.length > MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS)
    throw new Error(`Offline field-pack observation cap exceeded: ${MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS}`);
  selectedObservations.sort((a, b) => identityOf(a).localeCompare(identityOf(b)));

  const sourceEvidence = buildAtlasSourceEvidence({
    observations: selectedObservations,
    providerResults: input.providerResults,
    sourceSummaries: input.sourceSummaries,
  });
  const allowedSummaries = sourceEvidence.filter((item) => RETENTION_RULES[item.providerId] !== undefined);
  const excludedSourceSet = new Set([...unsupported, ...sourceEvidence.filter((item) => RETENTION_RULES[item.providerId] === undefined).map((item) => item.providerId)]);
  const filteredProviderResults = providerEntries(input.providerResults)
    .filter(([providerId]) => RETENTION_RULES[atlasOfflineSourcePolicy(providerId).providerId] !== undefined)
    .map(([, result]) => result);
  const filteredSummaries = (input.sourceSummaries ?? [])
    .filter((item) => RETENTION_RULES[atlasOfflineSourcePolicy(item.providerId).providerId] !== undefined);
  const snapshot = createAtlasTimeMachineSnapshot({
    id: input.id,
    capturedAt: input.capturedAt,
    observations: selectedObservations,
    view,
    providerResults: filteredProviderResults,
    sourceSummaries: filteredSummaries,
  });
  const coverageGaps = [...new Set([
    ...snapshot.coverageGaps,
    AREA_GAP,
    MEDIA_GAP,
    ABSENCE_GAP,
    "Source summaries describe loaded provider results and may not be spatially scoped to this selected circle; no provider was refreshed for this pack.",
    ...(selectedObservations.length === 0 ? [EMPTY_GAP] : []),
    ...(unsupported.size ? [`Not included because offline-retention permission is not established by Atlas source notes: ${sourceListForGap([...unsupported])}. Their observations and provider summaries are omitted.`] : []),
    ...(excludedSourceSet.size ? [`Other sources not included: ${sourceListForGap([...excludedSourceSet])}. Their records and provider summaries are omitted because offline-retention permission is not established.`] : []),
    ...(invalidLoadedCount ? [`${invalidLoadedCount} invalid loaded point record(s) were not eligible for this pack.`] : []),
    ...(selected.size < [...byIdentity.entries()].filter(([key, rows]) => rows.length === 1 && atlasOfflineObservationPolicy(rows[0], input.providerResults).includedByDefault).length
      ? [`${[...byIdentity.entries()].filter(([key, rows]) => rows.length === 1 && atlasOfflineObservationPolicy(rows[0], input.providerResults).includedByDefault).length - selected.size} eligible in-area record(s) were left unselected.`]
      : []),
  ])].slice(0, 100).map(boundedGap);
  const pack: AtlasOfflineFieldPack = {
    schema: PACK_SCHEMA,
    schemaVersion: 1,
    id: input.id,
    capturedAt: input.capturedAt,
    area,
    view,
    observations: selectedObservations,
    providerSummaries: allowedSummaries.map(cloneSummary),
    conflictLog: buildConflictLog(selectedObservations),
    coverageGaps,
    excludedSources: [...excludedSourceSet].sort().slice(0, 100),
    excludedSurfaces: [...EXCLUDED_SURFACES],
  };
  assertPackBounds(pack);
  return pack;
}

function cloneImportedPack(value: unknown, imported = true): AtlasOfflineFieldPack {
  const topLevel = ["schema", "schemaVersion", "id", "capturedAt", "area", "view", "observations", "providerSummaries", "conflictLog", "coverageGaps", "excludedSources", "excludedSurfaces"] as const;
  if (!isObject(value) || !onlyKeys(value, topLevel) || value.schema !== PACK_SCHEMA || value.schemaVersion !== 1)
    throw new Error("Invalid or unsupported offline field-pack schema");
  if (typeof value.id !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(value.id)) throw new Error("Invalid offline field-pack ID");
  if (!isTimestamp(value.capturedAt) || Date.parse(value.capturedAt) > Date.now() + 60_000)
    throw new Error("Invalid offline field-pack capture timestamp");
  const area = cloneArea(value.area);
  const view = cloneView(value.view);
  if (!Array.isArray(value.observations) || value.observations.length > MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS || !value.observations.every(validateObservation))
    throw new Error("Invalid offline field-pack observations");
  const observations = value.observations.map(cloneObservation);
  if (new Set(observations.map(identityOf)).size !== observations.length)
    throw new Error("Offline field-pack record identities must be unique");
  if (observations.some((observation) => haversineKm(area.center, observation.point) > area.radiusKm))
    throw new Error("Offline field-pack contains a point outside its declared bounded area");
  if (!Array.isArray(value.providerSummaries) || value.providerSummaries.length > MAX_ATLAS_OFFLINE_SOURCE_SUMMARIES)
    throw new Error("Invalid offline field-pack source summaries");
  const providerSummaries = value.providerSummaries.map(cloneSummary);
  if (new Set(providerSummaries.map((item) => item.providerId)).size !== providerSummaries.length)
    throw new Error("Offline field-pack source IDs must be unique");
  const suppliedConflictLog = validateConflictLog(value.conflictLog);
  const conflictLog = buildConflictLog(observations);
  const conflictsDiffer = stableJson(suppliedConflictLog) !== stableJson(conflictLog);
  if (!Array.isArray(value.coverageGaps) || value.coverageGaps.length > 100 || value.coverageGaps.some((item) => typeof item !== "string" || item.length > MAX_TEXT))
    throw new Error("Invalid offline field-pack coverage gaps");
  if (!Array.isArray(value.excludedSources) || value.excludedSources.length > 100 || value.excludedSources.some((item) => typeof item !== "string" || !item.trim() || item.length > 240))
    throw new Error("Invalid offline field-pack excluded-source list");
  if (!Array.isArray(value.excludedSurfaces) || value.excludedSurfaces.length !== EXCLUDED_SURFACES.length || value.excludedSurfaces.some((item, index) => item !== EXCLUDED_SURFACES[index]))
    throw new Error("Invalid offline field-pack excluded-surface declaration");
  return {
    schema: PACK_SCHEMA,
    schemaVersion: 1,
    id: value.id,
    capturedAt: value.capturedAt,
    area,
    view,
    observations,
    providerSummaries,
    conflictLog,
    coverageGaps: [...new Set([...(value.coverageGaps as string[]), AREA_GAP, MEDIA_GAP, ABSENCE_GAP, ...(observations.length === 0 ? [EMPTY_GAP] : []), ...(imported ? [IMPORT_GAP] : []), ...(conflictsDiffer ? [RECOMPUTED_CONFLICT_GAP] : [])])].slice(0, 100).map(boundedGap),
    excludedSources: [...new Set(value.excludedSources as string[])].sort(),
    excludedSurfaces: [...EXCLUDED_SURFACES],
  };
}

export function serializeAtlasOfflineFieldPack(pack: AtlasOfflineFieldPack): string {
  const validated = cloneImportedPack(pack, false);
  const encoded = JSON.stringify(validated, null, 2);
  if (new TextEncoder().encode(encoded).byteLength > MAX_ATLAS_OFFLINE_PACK_BYTES)
    throw new Error(`Offline field-pack payload cap exceeded: ${MAX_ATLAS_OFFLINE_PACK_BYTES} bytes`);
  return encoded;
}

export function importAtlasOfflineFieldPack(encoded: string): AtlasOfflineFieldPack {
  if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > MAX_ATLAS_OFFLINE_PACK_BYTES)
    throw new Error(`Offline field-pack file exceeds ${MAX_ATLAS_OFFLINE_PACK_BYTES} bytes`);
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); }
  catch { throw new Error("Invalid offline field-pack JSON"); }
  const pack = cloneImportedPack(parsed);
  assertPackBounds(pack);
  return pack;
}

function snapshotOf(pack: AtlasOfflineFieldPack): AtlasTimeMachineSnapshot {
  return {
    schemaVersion: 1,
    id: pack.id,
    capturedAt: pack.capturedAt,
    view: pack.view,
    observations: pack.observations,
    providerSummaries: pack.providerSummaries,
    coverageGaps: pack.coverageGaps,
  };
}

export function compareAtlasOfflineFieldPacks(
  baseline: AtlasOfflineFieldPack,
  incoming: AtlasOfflineFieldPack,
): AtlasOfflinePackComparison {
  const records = compareAtlasTimeMachineSnapshots(snapshotOf(baseline), snapshotOf(incoming));
  const conflicts = findAtlasTimeMachineConflicts([...baseline.observations, ...incoming.observations]);
  return { records, conflicts };
}

export function retainAtlasOfflineFieldPacks(
  existing: readonly AtlasOfflineFieldPack[],
  next: AtlasOfflineFieldPack,
): AtlasOfflineFieldPack[] {
  if (!Array.isArray(existing)) throw new Error("Invalid offline field-pack session history");
  assertPackBounds(next);
  const nextBytes = packByteLength(next);
  if (nextBytes > MAX_ATLAS_OFFLINE_SESSION_BYTES) throw new Error("Offline field-pack session byte cap exceeded");
  const duplicate = existing.find((item) => item.id === next.id);
  if (duplicate) {
    const withoutImportNotice = (pack: AtlasOfflineFieldPack) => ({ ...pack, coverageGaps: pack.coverageGaps.filter((gap) => gap !== IMPORT_GAP) });
    if (stableJson(withoutImportNotice(duplicate)) !== stableJson(withoutImportNotice(next)))
      throw new Error("A different offline field pack with this ID is already in the page session");
    return [...existing];
  }
  const retained = [...existing, next];
  while (retained.length > MAX_ATLAS_OFFLINE_PACKS_IN_SESSION || retained.reduce((sum, pack) => sum + packByteLength(pack), 0) > MAX_ATLAS_OFFLINE_SESSION_BYTES)
    retained.shift();
  return retained;
}

export const atlasOfflinePackExclusions = Object.freeze({
  mediaGap: MEDIA_GAP,
  areaGap: AREA_GAP,
  emptyGap: EMPTY_GAP,
  importGap: IMPORT_GAP,
  surfaces: EXCLUDED_SURFACES,
});
