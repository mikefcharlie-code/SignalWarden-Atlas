import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "worldview-offline-packs-"));
writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
symlinkSync(resolve(root, "node_modules"), join(out, "node_modules"), "dir");
const compile = spawnSync(
  process.execPath,
  [resolve(root, "node_modules/typescript/bin/tsc"), resolve(root, "src/worldview-offline-packs.ts"), "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--skipLibCheck", "--lib", "ES2022,DOM", "--outDir", out],
  { encoding: "utf8", cwd: out },
);
if (compile.status !== 0) throw new Error(`Unable to compile worldview-offline-packs.ts:\n${compile.stdout}\n${compile.stderr}`);
for (const module of ["worldview-core", "worldview-source-evidence", "worldview-time-machine"]) {
  symlinkSync(`${module}.js`, join(out, module));
}
const offline = await import(`${pathToFileURL(join(out, "worldview-offline-packs.js")).href}?${Date.now()}`);
test.after(() => rmSync(out, { recursive: true, force: true }));

const filters = { livecams: false, staticcams: true, planes: true, ais: false, "road-works": false, "road-incidents": false, "road-closures": false };
const view = { center: { lat: 30, lon: -80 }, zoom: 5, layers: { earthquakes: true, weather: true, aircraft: false }, signalFilters: filters };
const observation = (overrides = {}) => ({
  id: "event-1", layer: "earthquakes", point: { lat: 30.03, lon: -80.02 }, observedAt: "2026-01-02T03:04:05-05:00", source: "USGS", label: "Magnitude 2 event", freshness: "fresh",
  properties: { retrievedAt: "2026-01-02T03:05:00.000Z", providerTimestamp: "2026-01-02T03:04:05-05:00", attribution: "Data courtesy of the U.S. Geological Survey", coverage: "Recent global query" },
  ...overrides,
});
const usgsProvider = (records = [observation()]) => ({ providerId: "usgs", observations: records, retrievedAt: "2026-01-02T03:05:00.000Z", freshness: "fresh" });
const providerResults = (records = [observation()]) => ({ usgs: usgsProvider(records) });
const key = (record) => JSON.stringify([record.source, record.layer, record.id]);
const area = { shape: "circle", center: { lat: 30, lon: -80 }, radiusKm: 25 };
const makePack = (id, records = [observation()], selected = records, results = providerResults(records), extras = {}) => offline.createAtlasOfflineFieldPack({
  id,
  capturedAt: "2026-01-02T03:06:00.000Z",
  area,
  view,
  observations: records,
  selectedObservationKeys: selected.map(key),
  providerResults: results,
  ...extras,
});

test("pack contains only explicitly selected points inside a bounded circle and preserves provenance times", () => {
  const inside = observation();
  const outside = observation({ id: "far", point: { lat: 40, lon: -80 } });
  const records = [inside, outside];
  const pack = makePack("field-one", records, [inside], providerResults(records));
  assert.deepEqual(pack.observations.map((item) => item.id), ["event-1"]);
  assert.equal(pack.observations[0].source, "USGS");
  assert.equal(pack.observations[0].observedAt, "2026-01-02T03:04:05-05:00", "original source time string is not replaced by capture time");
  assert.equal(pack.observations[0].properties.retrievedAt, "2026-01-02T03:05:00.000Z");
  assert.equal(pack.capturedAt, "2026-01-02T03:06:00.000Z");
  const usgs = pack.providerSummaries.find((item) => item.providerId === "usgs");
  assert.equal(usgs.retrievedAt, "2026-01-02T03:05:00.000Z");
  assert.equal(usgs.attribution, "Data courtesy of the U.S. Geological Survey");
  assert.ok(pack.coverageGaps.some((gap) => gap.includes("not a provider query boundary")));
  assert.ok(pack.coverageGaps.some((gap) => gap.includes("imagery/raster")));
  assert.ok(pack.excludedSurfaces.includes("Basemap/map tiles"));
});

test("empty pack records unknown/absence semantics instead of a clear-area claim", () => {
  const pack = makePack("empty", [], [], {});
  assert.equal(pack.observations.length, 0);
  assert.ok(pack.coverageGaps.some((gap) => gap.includes("Missing or empty records do not establish")));
  assert.ok(!pack.coverageGaps.some((gap) => /^(?:the )?area is clear|^no events are present/i.test(gap)));
});

test("external source labels need an exact already-loaded provider-result match", () => {
  const record = observation();
  assert.equal(offline.atlasOfflineObservationPolicy(record, {}).includedByDefault, false);
  assert.match(offline.atlasOfflineObservationPolicy(record, {}).reason, /does not exactly match/);
  assert.throws(() => makePack("unmatched", [record], [record], {}), /cannot be included/);
  const restricted = observation({ source: "TomTom Traffic", layer: "traffic" });
  const restrictedResult = { tomtom: { providerId: "tomtom", observations: [restricted], retrievedAt: "2026-01-02T03:05:00Z", freshness: "fresh" } };
  assert.equal(offline.atlasOfflineObservationPolicy(restricted, restrictedResult).includedByDefault, false);
  assert.throws(() => makePack("restricted", [restricted], [restricted], restrictedResult), /cannot be included/);
});

test("only records from the synthetic demo retain their synthetic label as eligible", () => {
  const synthetic = observation({ id: "demo-1", source: "SignalWarden synthetic replay", freshness: "synthetic" });
  assert.equal(offline.atlasOfflineObservationPolicy(synthetic).includedByDefault, true);
  const mislabeled = { ...synthetic, freshness: "fresh" };
  assert.equal(offline.atlasOfflineObservationPolicy(mislabeled).includedByDefault, false);
  const pack = makePack("synthetic", [synthetic], [synthetic], {});
  assert.equal(pack.observations[0].freshness, "synthetic");
});

test("round-trip is bounded and retains source IDs, view, provider evidence, and capture gaps", () => {
  const packed = makePack("round-trip");
  const encoded = offline.serializeAtlasOfflineFieldPack(packed);
  assert.ok(new TextEncoder().encode(encoded).byteLength <= offline.MAX_ATLAS_OFFLINE_PACK_BYTES);
  assert.doesNotMatch(encoded, /Imported pack content/);
  const imported = offline.importAtlasOfflineFieldPack(encoded);
  assert.equal(imported.id, packed.id);
  assert.equal(imported.observations[0].id, "event-1");
  assert.equal(imported.observations[0].source, "USGS");
  assert.equal(imported.observations[0].properties.attribution, packed.observations[0].properties.attribution);
  assert.equal(imported.providerSummaries[0].providerId, "usgs");
  assert.deepEqual(imported.conflictLog, packed.conflictLog);
  assert.ok(imported.coverageGaps.some((gap) => gap.includes("Imported pack content")));
  assert.equal(imported.view.center.lat, 30);
});

test("conflict log travels with a pack and an altered imported log is recomputed", () => {
  const usgs = observation({ id: "shared", layer: "earthquakes", point: { lat: 30.01, lon: -80 } });
  const noaa = observation({ id: "shared", layer: "earthquakes", source: "NOAA/NWS weather.gov", point: { lat: 30.2, lon: -80 } });
  const records = [usgs, noaa];
  const results = {
    usgs: usgsProvider([usgs]),
    "noaa-weather": { providerId: "noaa-weather", observations: [noaa], retrievedAt: "2026-01-02T03:05:00Z", freshness: "fresh" },
  };
  const pack = makePack("conflict-log", records, records, results);
  assert.equal(pack.conflictLog.length, 1);
  assert.equal(pack.conflictLog[0].layer, "earthquakes");
  const encoded = offline.serializeAtlasOfflineFieldPack(pack);
  const imported = offline.importAtlasOfflineFieldPack(encoded);
  assert.deepEqual(imported.conflictLog, pack.conflictLog);
  const changed = JSON.parse(encoded);
  changed.conflictLog[0].disagreements[0].values[0] = 99;
  const recomputed = offline.importAtlasOfflineFieldPack(JSON.stringify(changed));
  assert.deepEqual(recomputed.conflictLog, pack.conflictLog);
  assert.ok(recomputed.coverageGaps.some((gap) => gap.includes("conflict log did not match")));
});

test("import rejects malformed schema, out-of-area points, duplicate identities, bad summaries, and oversized files", () => {
  const packed = makePack("invalids");
  const encoded = (value) => JSON.stringify(value);
  assert.throws(() => offline.importAtlasOfflineFieldPack("{"), /Invalid offline field-pack JSON/);
  assert.throws(() => offline.importAtlasOfflineFieldPack(encoded({ ...packed, schemaVersion: 9 })), /schema/);
  assert.throws(() => offline.importAtlasOfflineFieldPack(encoded({ ...packed, unexpected: true })), /schema/);
  assert.throws(() => offline.importAtlasOfflineFieldPack(encoded({ ...packed, observations: [{ ...packed.observations[0], point: { lat: 50, lon: 0 } }] })), /outside/);
  assert.throws(() => offline.importAtlasOfflineFieldPack(encoded({ ...packed, observations: [...packed.observations, packed.observations[0]] })), /identities must be unique/);
  assert.throws(() => offline.importAtlasOfflineFieldPack(encoded({ ...packed, providerSummaries: [{ ...packed.providerSummaries[0], retrievedAt: "yesterday" }] })), /retrievedAt/);
  assert.throws(() => offline.importAtlasOfflineFieldPack(" ".repeat(offline.MAX_ATLAS_OFFLINE_PACK_BYTES + 1)), /exceeds/);
});

test("creation rejects invalid bounds, view values, oversized selection, and ambiguous identities", () => {
  const record = observation();
  assert.throws(() => offline.createAtlasOfflineFieldPack({ id: "bad", capturedAt: "2026-01-02T03:06:00Z", area: { ...area, radiusKm: 101 }, view, observations: [record], selectedObservationKeys: [key(record)], providerResults: providerResults([record]) }), /area/);
  assert.throws(() => offline.createAtlasOfflineFieldPack({ id: "bad", capturedAt: "2026-01-02T03:06:00Z", area, view: { ...view, center: { lat: 500, lon: 0 } }, observations: [record], selectedObservationKeys: [key(record)], providerResults: providerResults([record]) }), /center/);
  const duplicate = { ...record, label: "same identity" };
  assert.throws(() => makePack("ambiguous", [record, duplicate], [record], providerResults([record, duplicate])), /duplicated/);
  const many = Array.from({ length: offline.MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS + 1 }, (_, index) => ({ ...record, id: `demo-${index}`, source: "SignalWarden synthetic replay", freshness: "synthetic" }));
  assert.throws(() => makePack("too-many", many, many, {}), /observation cap/);
});

test("local comparison reports record/source differences and unresolved cross-source conflicts without merging", () => {
  const beforeRecord = observation({ source: "USGS", id: "shared", layer: "earthquakes" });
  const afterRecord = observation({ source: "NOAA/NWS weather.gov", id: "shared", layer: "earthquakes", point: { lat: 30.2, lon: -80 }, observedAt: "2026-01-03T00:00:00Z", freshness: "stale" });
  const beforeResults = { usgs: usgsProvider([beforeRecord]) };
  const afterResults = { "noaa-weather": { providerId: "noaa-weather", observations: [afterRecord], retrievedAt: "2026-01-03T00:01:00Z", freshness: "stale" } };
  const before = makePack("before", [beforeRecord], [beforeRecord], beforeResults);
  const after = makePack("after", [afterRecord], [afterRecord], afterResults);
  const preview = offline.compareAtlasOfflineFieldPacks(before, after);
  assert.deepEqual(preview.records.counts, { added: 1, removed: 1, changed: 0, unchanged: 0 });
  assert.equal(preview.records.sourceCounts.added, 1);
  assert.equal(preview.conflicts.length, 1);
  assert.deepEqual(preview.conflicts[0].sources, ["NOAA/NWS weather.gov", "USGS"]);
  assert.deepEqual(before.observations.map((item) => item.source), ["USGS"], "preview leaves the baseline pack unchanged");
  assert.deepEqual(after.observations.map((item) => item.source), ["NOAA/NWS weather.gov"], "preview leaves the incoming pack unchanged");
});

test("page-session retention evicts oldest packs and stays within five-pack/byte caps", () => {
  let retained = [];
  for (let index = 0; index < offline.MAX_ATLAS_OFFLINE_PACKS_IN_SESSION + 1; index++) {
    const record = observation({ id: `event-${index}` });
    const records = [record];
    retained = offline.retainAtlasOfflineFieldPacks(retained, makePack(`pack-${index}`, records, records, providerResults(records)));
  }
  assert.equal(retained.length, offline.MAX_ATLAS_OFFLINE_PACKS_IN_SESSION);
  assert.equal(retained[0].id, "pack-1");
  assert.ok(retained.reduce((bytes, pack) => bytes + new TextEncoder().encode(JSON.stringify(pack)).byteLength, 0) <= offline.MAX_ATLAS_OFFLINE_SESSION_BYTES);
});
