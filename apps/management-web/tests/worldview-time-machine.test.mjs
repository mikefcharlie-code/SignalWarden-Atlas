import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "worldview-time-machine-"));
writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
symlinkSync(resolve(root, "node_modules"), join(out, "node_modules"), "dir");
const compile = spawnSync(
  process.execPath,
  [resolve(root, "node_modules/typescript/bin/tsc"), resolve(root, "src/worldview-time-machine.ts"), "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--skipLibCheck", "--lib", "ES2022,DOM", "--outDir", out],
  { encoding: "utf8", cwd: out },
);
if (compile.status !== 0) throw new Error(`Unable to compile worldview-time-machine.ts:\n${compile.stdout}\n${compile.stderr}`);
symlinkSync("worldview-core.js", join(out, "worldview-core"));
const machine = await import(`${pathToFileURL(join(out, "worldview-time-machine.js")).href}?${Date.now()}`);
test.after(() => rmSync(out, { recursive: true, force: true }));

const filters = { livecams: false, staticcams: true, planes: true, ais: false, "road-works": false, "road-incidents": false, "road-closures": false };
const view = { center: { lat: 30, lon: -80 }, zoom: 5, layers: { aircraft: true, weather: false }, signalFilters: filters };
const observation = (overrides = {}) => ({ id: "a-1", layer: "aircraft", point: { lat: 30, lon: -80 }, observedAt: "2026-01-01T00:00:00.000Z", source: "adsb", label: "Aircraft", freshness: "fresh", properties: { attribution: "example" }, ...overrides });
const provider = (observations = [observation()]) => ({ providerId: "adsb", observations, retrievedAt: "2026-01-01T00:01:00.000Z", freshness: "fresh" });

 test("capture preserves source timestamps, freshness, properties, and separates capture time", () => {
  const snapshot = machine.createAtlasTimeMachineSnapshot({ id: "s1", capturedAt: "2026-01-02T00:00:00Z", observations: [observation({ observedAt: "2026-01-01T00:00:00-05:00", freshness: "synthetic" })], view, providerResults: { adsb: provider() } });
  assert.equal(snapshot.capturedAt, "2026-01-02T00:00:00Z");
  assert.equal(snapshot.observations[0].observedAt, "2026-01-01T00:00:00-05:00");
  assert.equal(snapshot.observations[0].freshness, "synthetic");
  assert.deepEqual(snapshot.observations[0].properties, { attribution: "example" });
  assert.equal(snapshot.providerSummaries[0].retrievedAt, "2026-01-01T00:01:00.000Z");
});

test("invalid and missing data remain explicit coverage gaps", () => {
  const snapshot = machine.createAtlasTimeMachineSnapshot({ id: "s2", capturedAt: "2026-01-02T00:00:00Z", observations: [observation(), { bad: true }], view, providerResults: {
    empty: { providerId: "empty", observations: [], retrievedAt: "bad", freshness: "unknown", error: "not retained" },
    failed: { providerId: "failed", observations: [], retrievedAt: "bad", freshness: "failed" },
    successfulEmpty: { providerId: "successfulEmpty", observations: [], retrievedAt: "2026-01-02T00:00:00Z", freshness: "fresh" },
  } });
  assert.equal(snapshot.observations.length, 1);
  assert.ok(snapshot.coverageGaps.some((gap) => gap.startsWith("Invalid observation")));
  assert.ok(snapshot.coverageGaps.some((gap) => gap.startsWith("Point observations only")));
  assert.ok(snapshot.coverageGaps.some((gap) => gap.startsWith("Coverage not reported: adsb")));
  assert.ok(snapshot.coverageGaps.includes("Provider error recorded: empty"));
  assert.ok(snapshot.coverageGaps.includes("Provider error recorded: failed"));
  assert.ok(snapshot.coverageGaps.includes("Empty source result: successfulEmpty"));
  assert.ok(!snapshot.coverageGaps.includes("Empty source result: empty"));
  assert.ok(!snapshot.coverageGaps.includes("Empty source result: failed"));
  assert.equal(snapshot.providerSummaries[0].retrievedAt, null);
  assert.equal(snapshot.providerSummaries[0].hasError, true);
});

test("empty state and truncated source results remain visible as gaps", () => {
  const empty = machine.createAtlasTimeMachineSnapshot({ id: "empty", capturedAt: "2026-01-02T00:00:00Z", observations: [], view });
  assert.ok(empty.coverageGaps.some((gap) => gap.startsWith("No point records were loaded")));
  const truncated = machine.createAtlasTimeMachineSnapshot({ id: "truncated", capturedAt: "2026-01-02T00:00:00Z", observations: [observation({ properties: { coverage: "Georgia interstates", truncated: true } })], view });
  assert.ok(truncated.coverageGaps.some((gap) => gap.startsWith("Source result reported truncation: adsb")));
});

test("source summaries preserve provider coverage, retrieval, cache, truncation, and failures", () => {
  const ga511 = {
    providerId: "ga511", providerName: "Georgia 511 road events", retrievedAt: "2026-01-02T00:01:00Z",
    freshness: "fresh", observationCount: 0, hasError: false, coverage: "Georgia interstates and state routes",
    truncated: true, totalInArea: 7, cached: true, sourceUrl: "https://511ga.org/api/events",
    attribution: "511GA / GDOT", license: "API terms apply", termsUrl: "https://511ga.org/developers/doc",
  };
  const snapshot = machine.createAtlasTimeMachineSnapshot({ id: "ga511", capturedAt: "2026-01-02T00:02:00Z", observations: [], view, sourceSummaries: [ga511] });
  assert.deepEqual(snapshot.providerSummaries[0], ga511);
  assert.ok(snapshot.coverageGaps.includes("Empty source result: ga511"));
  assert.ok(snapshot.coverageGaps.some((gap) => gap.includes("Source result reported truncation: ga511 (0 shown of 7 in area)")));
  const unknownTotal = machine.createAtlasTimeMachineSnapshot({ id: "ga511-unknown-total", capturedAt: "2026-01-02T00:02:00Z", observations: [], view, sourceSummaries: [{ ...ga511, totalInArea: 0 }] });
  assert.ok(unknownTotal.coverageGaps.includes("Source result reported truncation: ga511"));
  const failure = machine.createAtlasTimeMachineSnapshot({ id: "ga511-failed", capturedAt: "2026-01-02T00:03:00Z", observations: [], view, sourceSummaries: [{ ...ga511, retrievedAt: null, freshness: "failed", hasError: false, coverage: null, truncated: null, totalInArea: null, cached: null, sourceUrl: null, attribution: null, license: null, termsUrl: null }] });
  assert.ok(failure.coverageGaps.includes("Provider error recorded: ga511"));
  assert.equal(failure.providerSummaries[0].hasError, true);
});

test("comparison is stable by source, layer, id and reports timestamp/freshness changes", () => {
  const before = machine.createAtlasTimeMachineSnapshot({ id: "b", capturedAt: "2026-01-01T00:00:00Z", observations: [observation()], view });
  const after = machine.createAtlasTimeMachineSnapshot({ id: "a", capturedAt: "2026-01-02T00:00:00Z", observations: [observation({ observedAt: "2026-01-02T00:00:00Z", freshness: "stale" }), observation({ id: "new" })], view });
  const result = machine.compareAtlasTimeMachineSnapshots(before, after);
  assert.deepEqual(result.counts, { added: 1, removed: 0, changed: 1, unchanged: 0 });
  assert.deepEqual(result.entries.map((entry) => entry.status), ["changed", "added"]);
  assert.deepEqual(result.entries[0].changedFields, ["freshness", "observedAt"]);
});

test("comparison identities cannot collide when imported source/layer strings contain delimiters", () => {
  const before = machine.createAtlasTimeMachineSnapshot({ id: "before", capturedAt: "2026-01-01T00:00:00Z", observations: [observation({ source: "a\u0000b", layer: "c" })], view });
  const after = machine.createAtlasTimeMachineSnapshot({ id: "after", capturedAt: "2026-01-02T00:00:00Z", observations: [observation({ source: "a", layer: "b\u0000c" })], view });
  assert.deepEqual(machine.compareAtlasTimeMachineSnapshots(before, after).counts, { added: 1, removed: 1, changed: 0, unchanged: 0 });
});

test("conflicts only report cross-source disagreements without selecting a winner", () => {
  const conflicts = machine.findAtlasTimeMachineConflicts([observation(), observation({ source: "manual", point: { lat: 31, lon: -80 }, freshness: "stale" }), observation({ id: "solo", source: "adsb" })]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].sources, ["adsb", "manual"]);
  assert.deepEqual(conflicts[0].disagreements.map((item) => item.field), ["freshness", "point"]);
  const { freshness: _freshness, properties: _properties, ...withoutOptionalFields } = observation({ source: "feed-one" });
  const optionalFieldConflict = machine.findAtlasTimeMachineConflicts([withoutOptionalFields, observation({ source: "feed-two" })]);
  assert.equal(optionalFieldConflict.length, 1, "missing optional fields are reported without throwing");
});

test("retention keeps only the newest ten snapshots and rejects invalid views and record caps", () => {
  const snapshots = Array.from({ length: 11 }, (_, i) => machine.createAtlasTimeMachineSnapshot({ id: String(i), capturedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, observations: [], view }));
  const retained = machine.retainAtlasTimeMachineSnapshots(snapshots.slice(0, 10), snapshots[10]);
  assert.equal(retained.length, machine.MAX_ATLAS_TIME_MACHINE_SNAPSHOTS);
  assert.equal(retained[0].id, "1");
  assert.throws(() => machine.createAtlasTimeMachineSnapshot({ id: "bad", capturedAt: "2026-01-01T00:00:00Z", observations: [], view: { ...view, center: { lat: 999, lon: 0 } } }), /Invalid Atlas time-machine view/);
  const tooMany = Array.from({ length: machine.MAX_ATLAS_TIME_MACHINE_OBSERVATIONS + 1 }, (_, i) => observation({ id: `record-${i}` }));
  assert.throws(() => machine.createAtlasTimeMachineSnapshot({ id: "too-many", capturedAt: "2026-01-01T00:00:00Z", observations: tooMany, view }), /observation cap exceeded/);
});
