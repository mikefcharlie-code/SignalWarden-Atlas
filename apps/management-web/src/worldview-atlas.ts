export const GLOBE_SCALE_MIN = 0.65;
export const GLOBE_SCALE_MAX = 2.8;
export const ATLAS_REFERENCE_CENTER = Object.freeze({ lat: 30.83857, lon: -83.26409 });
export const ATLAS_REFERENCE_MAP_ZOOM = 5.03;
export const ATLAS_BASEMAP_CHOICES = ["satellite", "streets", "schematic"] as const;
export type AtlasBasemapChoice = (typeof ATLAS_BASEMAP_CHOICES)[number];

export const ATLAS_SIGNAL_KEYS = [
  "livecams",
  "staticcams",
  "planes",
  "ais",
  "road-works",
  "road-incidents",
  "road-closures",
] as const;
export type AtlasSignalKey = (typeof ATLAS_SIGNAL_KEYS)[number];
export type AtlasSignalFilters = Readonly<Record<AtlasSignalKey, boolean>>;

export const ATLAS_SIGNAL_CONTROLS: ReadonlyArray<Readonly<{
  id: AtlasSignalKey;
  label: string;
  detail: string;
  state: "demo" | "opt-in" | "unavailable";
  status: string;
}>> = Object.freeze([
  { id: "livecams", label: "Live cameras", detail: "Public catalogs · manual snapshot only", state: "opt-in", status: "OPT-IN" },
  { id: "staticcams", label: "Camera locations", detail: "Synthetic / imported points", state: "demo", status: "DEMO / IMPORT" },
  { id: "planes", label: "Aircraft / planes", detail: "Synthetic + manual ADS-B refresh", state: "demo", status: "DEMO / OPT-IN" },
  { id: "ais", label: "AIS vessels", detail: "Receive-only · self-reported", state: "opt-in", status: "OPT-IN" },
  { id: "road-works", label: "Road works", detail: "No dedicated provider adapter", state: "unavailable", status: "UNAVAILABLE" },
  { id: "road-incidents", label: "Road incidents", detail: "TomTom relay · server key required", state: "opt-in", status: "OPT-IN" },
  { id: "road-closures", label: "Road closures", detail: "No dedicated closure layer", state: "unavailable", status: "UNAVAILABLE" },
]);

const FOV_HALF_RAD = (38 / 2) * Math.PI / 180;
const CAMERA_RADIUS_NUMERATOR = 3.4;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Convert a conventional Web Mercator zoom level to the existing perspective
 * globe's camera scale. This is an approximate equatorial viewport mapping,
 * not a claim that the globe is a slippy-map renderer.
 */
export function mapZoomToGlobeScale(mapZoom: number): number {
  if (!Number.isFinite(mapZoom)) return mapZoomToGlobeScale(ATLAS_REFERENCE_MAP_ZOOM);
  const z = clamp(mapZoom, 0, 22);
  const halfSpan = (360 / 2 ** z) * Math.PI / 360;
  const safeHalfSpan = Math.min(Math.PI / 2 - 1e-9, halfSpan);
  const distance = 1 + Math.tan(safeHalfSpan) / Math.tan(FOV_HALF_RAD);
  return clamp(CAMERA_RADIUS_NUMERATOR / distance, GLOBE_SCALE_MIN, GLOBE_SCALE_MAX);
}

/** Approximate inverse used to label the globe scale in familiar map-zoom units. */
export function globeScaleToMapZoom(globeScale: number): number {
  if (!Number.isFinite(globeScale)) return ATLAS_REFERENCE_MAP_ZOOM;
  const scale = clamp(globeScale, GLOBE_SCALE_MIN, GLOBE_SCALE_MAX);
  const cameraDistance = CAMERA_RADIUS_NUMERATOR / scale;
  const halfSpan = Math.atan(Math.tan(FOV_HALF_RAD) * Math.max(0, cameraDistance - 1));
  const fullSpanDegrees = Math.max(1e-9, 2 * halfSpan * 180 / Math.PI);
  return clamp(Math.log2(360 / fullSpanDegrees), 0, 22);
}

export const ATLAS_MAP_ZOOM_MIN = globeScaleToMapZoom(GLOBE_SCALE_MIN);
export const ATLAS_MAP_ZOOM_MAX = globeScaleToMapZoom(GLOBE_SCALE_MAX);

export type AtlasInitialView = Readonly<{
  center: Readonly<{ lat: number; lon: number }>;
  mapZoom: number;
  globeScale: number;
  basemap: AtlasBasemapChoice;
  signalFilters: AtlasSignalFilters;
}>;

const tokens = (value: string | null) => new Set((value ?? "").split(",").map((part) => part.trim().toLowerCase()).filter((part) => part.length > 0 && part.length <= 40).slice(0, 32));
const parseCoordinate = (value: string | null, fallback: number, min: number, max: number) => {
  if (value === null || value.trim().length > 32) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

/** Read only small, validated view hints from the page URL; never grants network permission. */
export function resolveAtlasInitialView(search = ""): AtlasInitialView {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const center = {
    lat: parseCoordinate(params.get("lat"), ATLAS_REFERENCE_CENTER.lat, -90, 90),
    lon: parseCoordinate(params.get("lon"), ATLAS_REFERENCE_CENTER.lon, -180, 180),
  };
  const rawZoom = params.get("z");
  const parsedZoom = rawZoom !== null && rawZoom.trim().length <= 16 ? Number(rawZoom) : ATLAS_REFERENCE_MAP_ZOOM;
  const mapZoom = Number.isFinite(parsedZoom) ? clamp(parsedZoom, 0, 22) : ATLAS_REFERENCE_MAP_ZOOM;
  const layerSet = tokens(params.get("layers"));
  const signalSet = tokens(params.get("sig"));
  const hasLayers = params.has("layers");
  const hasSignals = params.has("sig");
  const base = (params.get("base") ?? "satellite").toLowerCase();
  const basemap: AtlasBasemapChoice = base === "streets" || base === "osm" ? "streets" : base === "schematic" ? "schematic" : "satellite";
  const signalFilters: AtlasSignalFilters = Object.freeze({
    livecams: hasLayers ? layerSet.has("livecams") : false,
    staticcams: hasLayers ? layerSet.has("staticcams") : true,
    planes: hasLayers ? layerSet.has("planes") : true,
    ais: hasSignals ? signalSet.has("ais") : false,
    // These have no dedicated adapter in this build. URL hints cannot enable a missing source.
    "road-works": false,
    "road-incidents": hasSignals ? signalSet.has("road-incidents") : false,
    "road-closures": false,
  });
  return Object.freeze({ center: Object.freeze(center), mapZoom, globeScale: mapZoomToGlobeScale(mapZoom), basemap, signalFilters });
}

/** Display filtering only: these switches never request or authorize provider data. */
export function isAtlasSignalVisible(layer: string, id: string, filters: AtlasSignalFilters): boolean {
  if (layer === "aircraft") return filters.planes;
  if (layer === "cameras") return id.startsWith("pubcam-") ? filters.livecams : filters.staticcams;
  if (layer === "vessels") return filters.ais;
  if (layer === "traffic") return filters["road-incidents"];
  return true;
}
