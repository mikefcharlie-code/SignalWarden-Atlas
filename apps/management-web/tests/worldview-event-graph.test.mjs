import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "worldview-event-graph-"));
writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
symlinkSync(resolve(root, "node_modules"), join(out, "node_modules"), "dir");
const compile = spawnSync(process.execPath, [
  resolve(root, "node_modules/typescript/bin/tsc"),
  resolve(root, "src/worldview-event-graph.ts"),
  "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler",
  "--skipLibCheck", "--lib", "ES2022,DOM", "--outDir", out,
], { encoding: "utf8", cwd: out });
if (compile.status !== 0) throw new Error(`Unable to compile worldview-event-graph.ts:\n${compile.stdout}\n${compile.stderr}`);
for (const file of readdirSync(out).filter((name) => name.endsWith(".js"))) {
  const path = join(out, file);
  const source = await (await import("node:fs/promises")).readFile(path, "utf8");
  const rewritten = source.replace(/(from\s+["'])\.\/([^"']+)(["'])/g, (_match, before, specifier, after) => `${before}./${specifier.endsWith(".js") ? specifier : `${specifier}.js`}${after}`);
  await (await import("node:fs/promises")).writeFile(path, rewritten);
}
const graphModule = await import(`${pathToFileURL(join(out, "worldview-event-graph.js")).href}?${Date.now()}`);
test.after(() => rmSync(out, { recursive: true, force: true }));

const closure = (overrides = {}) => ({
  id: "ga511-closures-rte-17", layer: "traffic", point: { lat: 33.75, lon: -84.39 },
  observedAt: "2026-11-02T10:00:00Z", source: "Georgia 511 / GDOT", label: "Road closure · I-75",
  freshness: "fresh", properties: {
    eventType: "closures", eventId: "rte-17", roadway: "I-75", retrievedAt: "2026-11-02T10:02:00Z",
    coverage: "Georgia interstates and state routes; local-road completeness not documented",
    sourceUrl: "https://511ga.org/developers/doc", disclosure: "Reported road event; missing events do not prove roads are clear.",
  },
  ...overrides,
});
const camera = (overrides = {}) => ({
  id: "pubcam-caltrans-cam-3", layer: "cameras", point: { lat: 33.755, lon: -84.39, uncertaintyM: 100 },
  observedAt: "2026-11-02T10:15:00Z", source: "Caltrans CCTV", label: "Public traffic camera · CAM-3",
  freshness: "fresh", properties: {
    cameraId: "CAM-3", providerTimestamp: "2026-11-02T10:12:00Z", retrievedAt: "2026-11-02T10:15:00Z", coverage: "Catalog location only",
    disclosure: "Live public catalog entry; snapshots display only, no recognition or tracking.",
  },
  ...overrides,
});
const advisory = (overrides = {}) => ({
  id: "nhc-al012026", layer: "weather", point: { lat: 33.76, lon: -84.40 },
  observedAt: "2026-11-02T10:20:00Z", source: "NOAA NHC/CPHC", label: "Cyclone advisory position",
  freshness: "fresh", properties: {
    provider: "NOAA NHC", stormId: "al012026", retrievedAt: "2026-11-02T10:23:00Z",
    disclosure: "Official advisory position; forecast cone is the probable track of the centre, not the hazard extent",
  },
  ...overrides,
});
const sensor = (overrides = {}) => ({
  id: "openaq-9021", layer: "weather", point: { lat: 33.752, lon: -84.386 },
  observedAt: "2026-11-02T10:30:00Z", source: "OpenAQ (measured station)", label: "Measured sensor report · PM2.5",
  freshness: "fresh", properties: {
    provider: "OpenAQ", dataKind: "measured", stationType: "reference monitor",
    retrievedAt: "2026-11-02T10:35:00Z", coverage: "Single station measurement; neighborhood coverage unknown",
  },
  ...overrides,
});

function graphFor(focus, records, options = {}) {
  return graphModule.buildIncidentGraph({ observations: records, focusRecord: focus, ...options });
}

test("selected closure connects nearby loaded camera, advisory, and measured sensor records with source evidence", () => {
  const records = [closure(), camera(), advisory(), sensor()];
  const graph = graphFor(records[0], records);
  assert.equal(graph.status, "ready");
  assert.equal(graph.nodes.length, 4);
  assert.deepEqual(new Set(graph.nodes.map((node) => node.role)), new Set(["road-closure", "camera-location", "weather-advisory", "sensor-report"]));
  assert.equal(graph.edges.length, 3);
  assert.ok(graph.edges.every((edge) => edge.kind === "spatial-temporal-association"));
  assert.ok(graph.edges.every((edge) => edge.associationConfidence === null));
  for (const node of graph.nodes) {
    assert.ok(node.evidence.source);
    assert.ok(node.evidence.observedAt);
    assert.ok(node.evidence.recordFreshness);
    assert.ok(Object.hasOwn(node.evidence, "coverage"));
    assert.ok(Object.hasOwn(node.evidence, "confidence"));
    assert.ok(Object.hasOwn(node.evidence, "uncertaintyM"));
    assert.ok(node.record.properties);
  }
  const cameraNode = graph.nodes.find((node) => node.role === "camera-location");
  assert.equal(cameraNode.evidence.sourceTimestamp, "2026-11-02T10:12:00.000Z");
  assert.equal(cameraNode.evidence.observedAt, "2026-11-02T10:15:00.000Z");
  assert.equal(cameraNode.evidence.retrievedAt, "2026-11-02T10:15:00.000Z");
  assert.equal(cameraNode.evidence.sourceTimestampBasis, "providerTimestamp");
  for (const edge of graph.edges) {
    assert.equal(edge.endpoints.length, 2);
    assert.ok(edge.endpoints.every((endpoint) => endpoint.source && endpoint.observedAt && endpoint.recordFreshness && Object.hasOwn(endpoint, "coverage") && Object.hasOwn(endpoint, "confidence") && Object.hasOwn(endpoint, "uncertaintyM")));
    assert.match(edge.rationale, /proximity link only/);
    assert.match(edge.uncertainty, /do not establish causation, identity, or completeness/);
  }
  assert.ok(graph.coverageGaps.some((gap) => /Camera catalog records describe locations/.test(gap)));
});

test("exact data matches are distinct from same-ID unresolved conflicts and provenance changes are not conflicts", () => {
  const base = closure();
  const matching = closure({
    source: "Second road feed", properties: { ...base.properties, retrievedAt: "2026-11-02T10:22:00Z", sourceUrl: "https://example.test/roads" },
  });
  const exact = graphFor(base, [base, matching]);
  assert.equal(exact.edges.length, 1);
  assert.equal(exact.edges[0].kind, "exact-match");
  assert.match(exact.edges[0].rationale, /data match only/);
  assert.ok(exact.edges[0].exactFields.includes("properties.eventId"));

  const conflicting = closure({
    source: "Second road feed", point: { lat: 33.8, lon: -84.39 },
    properties: { ...base.properties, severity: "major", retrievedAt: "2026-11-02T10:22:00Z" },
  });
  const conflict = graphFor(base, [base, conflicting]);
  assert.equal(conflict.edges.length, 1);
  assert.equal(conflict.edges[0].kind, "possible-conflict");
  assert.equal(conflict.edges[0].status, "unresolved");
  assert.ok(conflict.edges[0].disagreementFields.includes("point"));
  assert.match(conflict.edges[0].rationale, /no source is selected as correct/);
});

test("distance and time windows exclude out-of-window candidates and are exposed in the result", () => {
  const focus = closure();
  const tooFar = camera({ point: { lat: 34.5, lon: -84.39 } });
  const tooOld = sensor({ observedAt: "2026-11-01T00:00:00Z" });
  const graph = graphFor(focus, [focus, tooFar, tooOld], { maxDistanceKm: 5, maxTimeDeltaHours: 6 });
  assert.equal(graph.maxDistanceKm, 5);
  assert.equal(graph.maxTimeDeltaHours, 6);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.edges.length, 0);
  assert.ok(graph.coverageGaps.some((gap) => /No loaded camera catalog location/.test(gap)));
  assert.ok(graph.coverageGaps.some((gap) => /No loaded measured OpenAQ sensor/.test(gap)));
});

test("camera catalog presence is not upgraded into an outage and absent camera evidence stays unknown", () => {
  const focus = closure();
  const withoutCamera = graphFor(focus, [focus, advisory(), sensor()]);
  assert.ok(withoutCamera.coverageGaps.some((gap) => /does not establish camera presence, absence, availability, or outage/.test(gap)));
  const withCamera = graphFor(focus, [focus, camera()]);
  const cameraNode = withCamera.nodes.find((node) => node.role === "camera-location");
  assert.ok(cameraNode);
  assert.doesNotMatch(cameraNode.record.label, /outage/i);
  assert.ok(withCamera.coverageGaps.some((gap) => /Outage status remains unknown/.test(gap)));
});

test("synthetic demo records are not associated with live provider records", () => {
  const focus = closure();
  const syntheticCamera = camera({ freshness: "synthetic", source: "SignalWarden synthetic demo" });
  const graph = graphFor(focus, [focus, syntheticCamera]);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.edges.length, 0);
  const syntheticByKind = camera({ source: "Provider camera catalog", properties: { dataKind: "synthetic" } });
  const separatedByKind = graphFor(focus, [focus, syntheticByKind]);
  assert.equal(separatedByKind.nodes.length, 1);
  assert.equal(separatedByKind.edges.length, 0);
});

test("invalid observations are ignored, unsupported focus is explicit, and no network operation is present", () => {
  const focus = closure();
  const graph = graphFor(focus, [focus, { ...camera(), point: { lat: 99, lon: 0 } }]);
  assert.equal(graph.nodes.length, 1);
  const unsupported = graphFor({ ...focus, layer: "aircraft", properties: {} }, [{ ...focus, layer: "aircraft", properties: {} }]);
  assert.equal(unsupported.status, "unsupported-focus");
  assert.match(unsupported.coverageGaps[0], /not a supported closure/);
  const source = readFileSync(resolve(root, "src/worldview-event-graph.ts"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|setInterval/);
});
