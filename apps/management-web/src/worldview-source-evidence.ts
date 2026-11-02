import {
  PROVIDER_MATRIX,
  type Freshness,
  type ProviderResult,
  type WorldObservation,
} from "./worldview-core";

export type AtlasSourceDataKind =
  | "observation"
  | "reported-event"
  | "forecast"
  | "modelled"
  | "delayed"
  | "synthetic"
  | "geometric-estimate"
  | "imagery"
  | "unknown";
export type AtlasSourceFreshness = Freshness | "mixed";
export type AtlasSourceErrorState = "reported" | "clear" | "unknown";

export interface AtlasSourceEvidence {
  providerId: string;
  providerName?: string;
  retrievedAt: string | null;
  freshness: AtlasSourceFreshness;
  freshnessStates?: Freshness[];
  dataKind?: AtlasSourceDataKind;
  observationCount: number;
  loadedRecordCount?: number;
  hasError: boolean;
  error?: string | null;
  errorState?: AtlasSourceErrorState;
  coverage?: string | null;
  coverageStatus?: "reported" | "partial" | "out_of_coverage" | "unknown";
  truncated?: boolean | null;
  totalInArea?: number | null;
  cached?: boolean | null;
  sourceUrl?: string | null;
  attribution?: string | null;
  license?: string | null;
  termsUrl?: string | null;
  termsText?: string | null;
  knownBlindSpots?: string[];
  timeBasis?: string | null;
  absenceMeaning?: string;
}

type SourceDefinition = Readonly<{
  providerId: string;
  aliases: readonly string[];
  providerName: string;
  dataKind: AtlasSourceDataKind;
  coverage?: string;
  coverageStatus?: "reported" | "partial" | "out_of_coverage" | "unknown";
  sourceUrl?: string;
  attribution?: string;
  license?: string;
  termsUrl?: string;
  termsText?: string;
  knownBlindSpots: readonly string[];
  timeBasis?: string;
  absenceMeaning?: string;
}>;

const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  {
    providerId: "usgs",
    aliases: ["USGS"],
    providerName: "USGS Earthquake Hazards Program",
    dataKind: "observation",
    coverageStatus: "partial",
    coverage: "Recent global earthquake query (last 24 hours, up to 100 records); query scope is known, but spatial completeness is not established.",
    sourceUrl: "https://earthquake.usgs.gov/fdsnws/event/1/query",
    attribution: "Data courtesy of the U.S. Geological Survey",
    license: "US public-domain data",
    termsText: "Courtesy attribution requested",
    knownBlindSpots: [
      "This bounded recent-event feed is not an early-warning service; missing records do not establish that no earthquake occurred in an area.",
    ],
    timeBasis: "Provider event time; feed retrieval is listed separately.",
  },
  {
    providerId: "noaa-weather",
    aliases: ["NOAA/NWS weather.gov"],
    providerName: "NOAA/NWS weather.gov",
    dataKind: "forecast",
    coverageStatus: "partial",
    coverage: "Forecast for the requested point only; not area-wide weather coverage.",
    sourceUrl: "https://api.weather.gov/points/",
    attribution: "NOAA/National Weather Service",
    termsText: "NWS public-data terms; no endorsement",
    termsUrl: "https://www.weather.gov/disclaimer",
    knownBlindSpots: [
      "This is a forecast, not an observation of current conditions; a point forecast does not describe the whole map area.",
    ],
    timeBasis: "Forecast issuance/update time; validity window is in the record properties; retrieval is separate.",
  },
  {
    providerId: "adsb-lol",
    aliases: ["adsb.lol", "adsb"],
    providerName: "adsb.lol",
    dataKind: "observation",
    coverageStatus: "unknown",
    coverage: "Manual point query is bounded to at most 100 nautical miles; exact query geometry is not retained in the observation summary.",
    sourceUrl: "https://api.adsb.lol/v2/lat/",
    attribution: "Aircraft data © adsb.lol contributors, ODbL 1.0",
    license: "Open Database License (ODbL) 1.0",
    termsText: "Provider terms also apply",
    termsUrl: "https://www.adsb.lol/docs/privacy-license",
    knownBlindSpots: [
      "Crowdsourced receiver coverage is uneven; aircraft without a received/transmitted report may be absent. Identity fields are removed by the relay.",
    ],
    absenceMeaning: "No aircraft markers do not establish that the airspace is clear.",
  },
  {
    providerId: "ga511",
    aliases: ["Georgia 511 / GDOT", "Georgia 511 road events"],
    providerName: "Georgia 511 road events",
    dataKind: "reported-event",
    coverageStatus: "partial",
    coverage: "Georgia interstates and state routes are stated service coverage; local-road completeness is not documented.",
    sourceUrl: "https://511ga.org/developers/doc",
    attribution: "511GA / Georgia Department of Transportation (GDOT)",
    termsText: "511GA developer API terms apply; no open-data license asserted.",
    termsUrl: "https://511ga.org/developers/doc",
    knownBlindSpots: [
      "Local-road completeness is not documented. The statewide event feed is filtered to the requested view; truncation and cache state matter.",
    ],
    absenceMeaning: "No matching road-work or closure markers do not prove roads are clear.",
    timeBasis: "Provider event update/report time; feed retrieval is separate.",
  },
  {
    providerId: "tomtom",
    aliases: ["TomTom Traffic"],
    providerName: "TomTom Traffic",
    dataKind: "reported-event",
    attribution: "Traffic data © TomTom",
    knownBlindSpots: [
      "Traffic results are aggregate incident/flow context, not individual vehicle data; provider coverage and query scope apply.",
      "A flow segment without a provider timestamp is only time-bounded by retrieval.",
    ],
    absenceMeaning: "No returned incident marker is not proof that a road is clear.",
    timeBasis: "Incident report/start time when available; flow segment time may be retrieval-only.",
  },
  {
    providerId: "public-cameras",
    aliases: ["Public traffic cameras", "Traffic camera catalog"],
    providerName: "Public traffic camera catalog",
    dataKind: "observation",
    knownBlindSpots: [
      "Catalog coverage, position precision, update intervals, and snapshot availability vary by authority; a camera marker is not an onboard aircraft stream.",
      "Camera snapshots are display-only; no recognition or tracking is performed.",
    ],
    timeBasis: "Catalog retrieval/provider-update time; frame time is separate when supplied.",
  },
  {
    providerId: "ais",
    aliases: ["AISStream", "Kystverket", "BarentsWatch"],
    providerName: "AIS vessel feed",
    dataKind: "observation",
    knownBlindSpots: [
      "AIS is self-reported and incomplete; reception and provider coverage vary. No markers do not establish that no vessel is present.",
    ],
    absenceMeaning: "No AIS markers do not establish that no vessel is present.",
    timeBasis: "Provider message time when available; relay retrieval is separate.",
  },
  {
    providerId: "nasa-eonet",
    aliases: ["NASA EONET", "EONET"],
    providerName: "NASA EONET",
    dataKind: "reported-event",
    sourceUrl: "https://eonet.gsfc.nasa.gov/api/v3/events",
    attribution: "NASA EONET v3",
    knownBlindSpots: [
      "Curated event extents and times may be approximate; EONET metadata is not an official warning boundary and linked imagery is not included.",
    ],
    absenceMeaning: "No event metadata returned does not establish that an event is absent.",
  },
  {
    providerId: "nasa-firms",
    aliases: ["NASA FIRMS", "FIRMS"],
    providerName: "NASA FIRMS",
    dataKind: "observation",
    attribution: "NASA FIRMS",
    knownBlindSpots: [
      "FIRMS points are thermal anomalies, not confirmed fires; detection and coverage vary by product and acquisition time.",
    ],
    timeBasis: "Satellite acquisition time; retrieval is separate.",
  },
  {
    providerId: "signalwarden-demo",
    aliases: ["SignalWarden synthetic demo", "SignalWarden synthetic replay"],
    providerName: "SignalWarden synthetic demo",
    dataKind: "synthetic",
    attribution: "SignalWarden; clearly synthetic",
    knownBlindSpots: ["Synthetic records are local demonstrations, not provider evidence or real-world observations."],
    absenceMeaning: "Synthetic sample contents do not describe real-world presence or absence.",
  },
  {
    providerId: "user-tle",
    aliases: ["User TLE · SGP4 estimate", "User TLE · local SGP4 estimate"],
    providerName: "User-supplied TLE · local SGP4 estimate",
    dataKind: "geometric-estimate",
    knownBlindSpots: ["Geometric propagation is not a live sighting or a visibility forecast; TLE age and accuracy are not independently verified."],
    timeBasis: "Local calculation time; orbit source epoch is not independently verified.",
  },
];

const DEFAULT_ABSENCE_MEANING = "Missing or empty results do not establish that an event, aircraft, vessel, or hazard is absent.";
const MAX_TEXT = 500;
const MAX_LIST_ITEMS = 12;
const normalizeLabel = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
const definitionFor = (providerId: string, providerName?: string): SourceDefinition | undefined => {
  const candidates = [providerId, providerName].filter((value): value is string => !!value);
  return SOURCE_DEFINITIONS.find((definition) =>
    candidates.some((candidate) =>
      normalizeLabel(candidate) === normalizeLabel(definition.providerId) ||
      definition.aliases.some((alias) => normalizeLabel(candidate) === normalizeLabel(alias)),
    ),
  );
};
const providerInfoFor = (providerId: string) => PROVIDER_MATRIX.find((provider) => provider.id === providerId);
const clipped = (value: unknown, max = MAX_TEXT): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : null;
const uniqueStrings = (values: Array<string | null | undefined>, maxItems = 4): string[] =>
  [...new Set(values.map((value) => clipped(value)).filter((value): value is string => value !== null))].slice(0, maxItems);
const safeUrl = (value: unknown): string | null => {
  const text = clipped(value, 1000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 1000);
  } catch {
    return null;
  }
};
export function sanitizeAtlasSourceError(value: unknown): string | null {
  const text = clipped(value, 1200);
  if (!text) return null;
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => safeUrl(raw) ?? "[source URL redacted]")
    .replace(/\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[redacted]")
    .replace(/\b((?:api[-_ ]?key|key|token|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .slice(0, 280);
}
function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}
function propertyText(observation: WorldObservation, name: string): string | null {
  const value = observation.properties?.[name];
  return typeof value === "string" ? clipped(value) : null;
}
function freshnessOfRecords(records: readonly WorldObservation[]): { freshness: AtlasSourceFreshness; states: Freshness[] } {
  const states = [...new Set(records.map((record) => record.freshness ?? "unknown" as const))].sort();
  return { freshness: states.length === 1 ? states[0] : states.length > 1 ? "mixed" : "unknown", states };
}
function definitionMetadata(providerId: string, providerName?: string) {
  const definition = definitionFor(providerId, providerName);
  const provider = providerInfoFor(providerId);
  return {
    definition,
    providerName: definition?.providerName ?? provider?.name ?? providerName,
    dataKind: definition?.dataKind ?? "unknown" as const,
    coverage: definition?.coverage ?? null,
    coverageStatus: definition?.coverageStatus ?? (definition?.coverage ? "reported" as const : "unknown" as const),
    sourceUrl: safeUrl(definition?.sourceUrl ?? provider?.endpoint),
    attribution: clipped(definition?.attribution ?? provider?.attribution),
    license: clipped(definition?.license),
    termsUrl: safeUrl(definition?.termsUrl),
    termsText: clipped(definition?.termsText ?? provider?.terms),
    knownBlindSpots: [...(definition?.knownBlindSpots ?? (provider ? [provider.limits] : []))],
    timeBasis: definition?.timeBasis ?? null,
    absenceMeaning: definition?.absenceMeaning ?? DEFAULT_ABSENCE_MEANING,
  };
}

function canonicalProviderId(providerId: string, providerName?: string): string {
  return definitionFor(providerId, providerName)?.providerId ?? providerId;
}

export function buildAtlasSourceEvidence(input: {
  observations?: readonly WorldObservation[] | null;
  providerResults?: Readonly<Record<string, ProviderResult>> | readonly ProviderResult[] | null;
  sourceSummaries?: readonly AtlasSourceEvidence[] | null;
}): AtlasSourceEvidence[] {
  const evidence = new Map<string, AtlasSourceEvidence>();
  const resultEntries = Array.isArray(input.providerResults)
    ? input.providerResults.map((result) => [result.providerId, result] as const)
    : Object.entries(input.providerResults ?? {});

  for (const [providerId, result] of resultEntries.sort(([a], [b]) => a.localeCompare(b))) {
    const metadata = definitionMetadata(providerId);
    const resultFreshness = result?.freshness ?? "unknown";
    const error = sanitizeAtlasSourceError(result?.error);
    const hasError = resultFreshness === "failed" || error !== null;
    evidence.set(metadata.definition?.providerId ?? providerId, {
      providerId: metadata.definition?.providerId ?? providerId,
      providerName: metadata.providerName,
      retrievedAt: validTimestamp(result?.retrievedAt),
      freshness: resultFreshness,
      freshnessStates: [resultFreshness],
      dataKind: metadata.dataKind,
      observationCount: Array.isArray(result?.observations) ? result.observations.length : 0,
      loadedRecordCount: 0,
      hasError,
      error,
      errorState: hasError ? "reported" : "clear",
      coverage: metadata.coverage,
      coverageStatus: metadata.coverageStatus,
      truncated: null,
      totalInArea: null,
      cached: null,
      sourceUrl: metadata.sourceUrl,
      attribution: metadata.attribution,
      license: metadata.license,
      termsUrl: metadata.termsUrl,
      termsText: metadata.termsText,
      knownBlindSpots: metadata.knownBlindSpots,
      timeBasis: metadata.timeBasis,
      absenceMeaning: metadata.absenceMeaning,
    });
  }

  for (const summary of input.sourceSummaries ?? []) {
    if (!summary || typeof summary.providerId !== "string" || !summary.providerId.trim()) continue;
    const providerId = canonicalProviderId(summary.providerId, summary.providerName);
    const metadata = definitionMetadata(providerId, summary.providerName);
    const previous = evidence.get(providerId);
    const error = sanitizeAtlasSourceError(summary.error) ?? (summary.hasError ? "Provider reported an error; no safe message was supplied." : null);
    const hasError = summary.hasError || summary.freshness === "failed" || previous?.hasError === true;
    const sourceUrl = safeUrl(summary.sourceUrl) ?? previous?.sourceUrl ?? metadata.sourceUrl;
    const coverage = clipped(summary.coverage) ?? previous?.coverage ?? metadata.coverage;
    const coverageStatus = summary.coverageStatus ??
      (previous?.coverageStatus && previous.coverageStatus !== "unknown" ? previous.coverageStatus :
        metadata.coverageStatus !== "unknown" ? metadata.coverageStatus :
          clipped(summary.coverage) ? "reported" : previous?.coverageStatus ?? metadata.coverageStatus);
    evidence.set(providerId, {
      ...previous,
      ...summary,
      providerId,
      providerName: clipped(summary.providerName) ?? previous?.providerName ?? metadata.providerName,
      retrievedAt: validTimestamp(summary.retrievedAt) ?? previous?.retrievedAt ?? null,
      freshness: summary.freshness ?? previous?.freshness ?? "unknown",
      freshnessStates: summary.freshnessStates ?? previous?.freshnessStates ?? [summary.freshness === "mixed" ? "unknown" : summary.freshness ?? "unknown"],
      dataKind: summary.dataKind ?? previous?.dataKind ?? metadata.dataKind,
      observationCount: Number.isFinite(summary.observationCount) ? Math.max(0, Math.floor(summary.observationCount)) : previous?.observationCount ?? 0,
      loadedRecordCount: summary.loadedRecordCount ?? previous?.loadedRecordCount ?? 0,
      hasError,
      error,
      errorState: hasError ? "reported" : "clear",
      coverage,
      coverageStatus,
      truncated: summary.truncated ?? previous?.truncated ?? null,
      totalInArea: summary.totalInArea ?? previous?.totalInArea ?? null,
      cached: summary.cached ?? previous?.cached ?? null,
      sourceUrl,
      attribution: clipped(summary.attribution) ?? previous?.attribution ?? metadata.attribution,
      license: clipped(summary.license) ?? previous?.license ?? metadata.license,
      termsUrl: safeUrl(summary.termsUrl) ?? previous?.termsUrl ?? metadata.termsUrl,
      termsText: clipped(summary.termsText) ?? previous?.termsText ?? metadata.termsText,
      knownBlindSpots: uniqueStrings([...(metadata.knownBlindSpots), ...(summary.knownBlindSpots ?? []), ...(previous?.knownBlindSpots ?? [])], MAX_LIST_ITEMS),
      timeBasis: clipped(summary.timeBasis) ?? previous?.timeBasis ?? metadata.timeBasis,
      absenceMeaning: clipped(summary.absenceMeaning) ?? previous?.absenceMeaning ?? metadata.absenceMeaning,
    });
  }

  const groups = new Map<string, WorldObservation[]>();
  for (const observation of input.observations ?? []) {
    if (!observation || typeof observation.source !== "string") continue;
    const providerId = canonicalProviderId(observation.source, observation.source);
    const group = groups.get(providerId) ?? [];
    group.push(observation);
    groups.set(providerId, group);
  }
  for (const [providerId, records] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const metadata = definitionMetadata(providerId, records[0]?.source);
    const previous = evidence.get(providerId);
    const recordFreshness = freshnessOfRecords(records);
    const propertyValues = (name: string) => uniqueStrings(records.map((record) => propertyText(record, name)), 4);
    const coverages = propertyValues("coverage");
    const attributions = propertyValues("attribution");
    const licenses = propertyValues("license");
    const terms = propertyValues("termsUrl");
    const termsText = propertyValues("terms");
    const sourceUrls = records.map((record) => safeUrl(propertyText(record, "sourceUrl"))).filter((value): value is string => value !== null);
    const retrievedTimes = [...new Set(records.map((record) => validTimestamp(propertyText(record, "retrievedAt"))).filter((value): value is string => value !== null))];
    const timeBases = uniqueStrings(records.flatMap((record) => [propertyText(record, "sourceTimeBasis"), propertyText(record, "freshnessBasis")]), 4);
    const disclosures = uniqueStrings(records.map((record) => propertyText(record, "disclosure")), 4);
    const coverage = coverages.length ? coverages.join(" · ").slice(0, MAX_TEXT) : previous?.coverage ?? metadata.coverage;
    const dataKinds = records.map((record) => propertyText(record, "dataKind")).filter(isAtlasSourceDataKind);
    const dataKind = previous?.dataKind ?? (dataKinds.length && new Set(dataKinds).size === 1 ? dataKinds[0] : metadata.dataKind);
    const freshness = previous ? previous.freshness : recordFreshness.freshness;
    const coverageStatus = previous?.coverageStatus && previous.coverageStatus !== "unknown"
      ? previous.coverageStatus
      : coverages.length ? "reported" : metadata.coverageStatus;
    evidence.set(providerId, {
      ...previous,
      providerId,
      providerName: previous?.providerName ?? metadata.providerName ?? clipped(records[0]?.source) ?? providerId,
      retrievedAt: previous?.retrievedAt ?? (retrievedTimes.length === 1 ? retrievedTimes[0] : null),
      freshness,
      freshnessStates: uniqueFreshness([...(previous?.freshnessStates ?? []), ...recordFreshness.states]),
      dataKind,
      observationCount: previous?.observationCount ?? records.length,
      loadedRecordCount: records.length,
      hasError: previous?.hasError ?? false,
      error: previous?.error ?? null,
      errorState: previous?.errorState ?? "unknown",
      coverage,
      coverageStatus,
      truncated: previous?.truncated ?? records.some((record) => record.properties?.truncated === true),
      totalInArea: previous?.totalInArea ?? null,
      cached: previous?.cached ?? records.some((record) => record.properties?.cached === true),
      sourceUrl: previous?.sourceUrl ?? sourceUrls[0] ?? metadata.sourceUrl,
      attribution: previous?.attribution ?? attributions[0] ?? metadata.attribution,
      license: previous?.license ?? licenses[0] ?? metadata.license,
      termsUrl: previous?.termsUrl ?? safeUrl(terms[0]) ?? metadata.termsUrl,
      termsText: previous?.termsText ?? termsText[0] ?? metadata.termsText,
      knownBlindSpots: uniqueStrings([...(metadata.knownBlindSpots), ...(previous?.knownBlindSpots ?? []), ...disclosures], MAX_LIST_ITEMS),
      timeBasis: previous?.timeBasis ?? timeBases[0] ?? metadata.timeBasis,
      absenceMeaning: previous?.absenceMeaning ?? metadata.absenceMeaning,
    });
  }

  return [...evidence.values()].sort((a, b) => a.providerId.localeCompare(b.providerId));
}

function uniqueFreshness(values: Freshness[]): Freshness[] {
  return [...new Set(values)].sort();
}

const ATLAS_SOURCE_DATA_KINDS: readonly AtlasSourceDataKind[] = [
  "observation", "reported-event", "forecast", "modelled", "delayed", "synthetic", "geometric-estimate", "imagery", "unknown",
];
function isAtlasSourceDataKind(value: string | null): value is AtlasSourceDataKind {
  return value !== null && ATLAS_SOURCE_DATA_KINDS.includes(value as AtlasSourceDataKind);
}
