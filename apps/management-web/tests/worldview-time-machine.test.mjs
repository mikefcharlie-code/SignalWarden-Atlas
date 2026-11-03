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
symlinkSync("worldview-source-evidence.js", join(out, "worldview-source-evidence"));
const machine = await import(`${pathToFileURL(join(out, "worldview-time-machine.js")).href}?${Date.now()}`);
test.after(() => rmSync(out, { recursive: true, force: true }));

const filters = { livecams: false, staticcams: true, planes: true, ais: false, "road-works": false, "road-incidents": false, "road-closures": false };
const view = { center: { lat: 30, lon: -80 }, zoom: 5, layers: { aircraft: true, weather: false }, signalFilters: filters };
const observation = (overrides = {}) => ({ id: "a-1", layer: "aircraft", point: { lat: 30, lon: -80 }, observedAt: "2026-01-01T00:00:00.000Z", source: "adsb", label: "Aircraft", freshness: "fresh", properties: { attribution: "example" }, ...overrides });
const provider = (observations = [observation()]) => ({ providerId: "adsb-lol", observations, retrievedAt: "2026-01-01T00:01:00.000Z", freshness: "fresh" });

test("capture preserves source timestamps, freshness, properties, and distinct source context", () => {
  const snapshot = machine.createAtlasTimeMachineSnapshot({ id: "s1", capturedAt: "2026-01-02T00:00:00Z", observations: [observation({ observedAt: "2026-01-01T00:00:00-05:00", freshness: "synthetic" })], view, providerResults: { "adsb-lol": provider() } });
  assert.equal(snapshot.capturedAt, "2026-01-02T00:00:00Z");
  assert.equal(snapshot.observations[0].observedAt, "2026-01-01T00:00:00-05:00");
  assert.equal(snapshot.observations[0].freshness, "synthetic");
  assert.deepEqual(snapshot.observations[0].properties, { attribution: "example" });
  const adsb = snapshot.providerSummaries.find((summary) => summary.providerId === "adsb-lol");
  assert.equal(adsb.retrievedAt, "2026-01-01T00:01:00.000Z");
  assert.equal(adsb.dataKind, "observation");
  assert.equal(adsb.freshness, "fresh");
  assert.equal(adsb.loadedRecordCount, 1);
  assert.equal(adsb.coverageStatus, "unknown");
  assert.match(adsb.attribution, /adsb\.lol/);
  assert.ok(adsb.knownBlindSpots.length > 0);
});

test("invalid and missing data remain explicit coverage gaps with safe errors", () => {
  const snapshot = machine.createAtlasTimeMachineSnapshot({ id: "s2", capturedAt: "2026-01-02T00:00:00Z", observations: [observation(), { bad: true }], view, providerResults: {
    empty: { providerId: "empty", observations: [], retrievedAt: "bad", freshness: "unknown", error: "not retained" },
    failed: { providerId: "failed", observations: [], retrievedAt: "bad", freshness: "failed" },
    successfulEmpty: { providerId: "successfulEmpty", observations: [], retrievedAt: "2026-01-02T00:00:00Z", freshness: "fresh" },
  } });
  assert.equal(snapshot.observations.length, 1);
  assert.ok(snapshot.coverageGaps.some((gap) => gap.startsWith("Invalid observation")));
  assert.ok(snapshot.coverageGaps.some((gap) => gap.startsWith("Point observations only")));
  assert.ok(snapshot.coverageGaps.some((gap) => gap.startsWith("Coverage not reported: adsb-lol")));
  assert.ok(snapshot.coverageGaps.includes("Provider error recorded: empty"));
  assert.ok(snapshot.coverageGaps.includes("Provider error recorded: failed"));
  assert.ok(snapshot.coverageGaps.includes("Empty source result: successfulEmpty"));
  assert.ok(!snapshot.coverageGaps.includes("Empty source result: empty"));
  assert.ok(!snapshot.coverageGaps.includes("Empty source result: failed"));
  const empty = snapshot.providerSummaries.find((summary) => summary.providerId === "empty");
  assert.equal(empty.retrievedAt, null);
  assert.equal(empty.hasError, true);
  assert.equal(empty.error, "not retained");
  assert.equal(snapshot.providerSummaries.find((summary) => summary.providerId === "adsb-lol").errorState, "unknown");
});

test("empty state and truncated source results remain visible as gaps", () => {
  const empty = machine.createAtlasTimeMachineSnapshot({ id: "empty", capturedAt: "2026-01-02T00:00:00Z", observations: [], view });
  assert.ok(empty.coverageGaps.some((gap) => gap.startsWith("No point records were loaded")));
  const truncated = machine.createAtlasTimeMachineSnapshot({ id: "truncated", capturedAt: "2026-01-02T00:00:00Z", observations: [observation({ properties: { coverage: "Georgia interstates", truncated: true } })], view });
  assert.ok(truncated.coverageGaps.some((gap) => gap.startsWith("Source result reported truncation: adsb")));
});

test("source summaries retain provider claims, retrieval, cache, truncation, and failures", () => {
  const ga511 = {
    providerId: "ga511", providerName: "Georgia 511 road events", retrievedAt: "2026-01-02T00:01:00Z",
    freshness: "fresh", observationCount: 0, hasError: false, coverage: "Georgia interstates and state routes",
    truncated: true, totalInArea: 7, cached: true, sourceUrl: "https://511ga.org/api/events",
    attribution: "511GA / GDOT", license: "API terms apply", termsUrl: "https://511ga.org/developers/doc",
  };
  const snapshot = machine.createAtlasTimeMachineSnapshot({ id: "ga511", capturedAt: "2026-01-02T00:02:00Z", observations: [], view, sourceSummaries: [ga511] });
  const summary = snapshot.providerSummaries.find((item) => item.providerId === "ga511");
  assert.equal(summary.providerName, ga511.providerName);
  assert.equal(summary.retrievedAt, ga511.retrievedAt);
  assert.equal(summary.freshness, "fresh");
  assert.equal(summary.coverage, ga511.coverage);
  assert.equal(summary.sourceUrl, ga511.sourceUrl);
  assert.equal(summary.attribution, ga511.attribution);
  assert.equal(summary.license, ga511.license);
  assert.equal(summary.termsUrl, ga511.termsUrl);
  assert.match(summary.termsText, /developer API terms/);
  assert.equal(summary.dataKind, "reported-event");
  assert.equal(summary.coverageStatus, "partial");
  assert.ok(summary.knownBlindSpots.some((item) => item.includes("Local-road completeness")));
  assert.ok(snapshot.coverageGaps.includes("Partial source coverage: ga511"));
  assert.ok(snapshot.coverageGaps.includes("Empty source result: ga511"));
  assert.ok(snapshot.coverageGaps.some((gap) => gap.includes("Source result reported truncation: ga511 (0 shown of 7 in area)")));
  const unknownTotal = machine.createAtlasTimeMachineSnapshot({ id: "ga511-unknown-total", capturedAt: "2026-01-02T00:02:00Z", observations: [], view, sourceSummaries: [{ ...ga511, totalInArea: 0 }] });
  assert.ok(unknownTotal.coverageGaps.includes("Source result reported truncation: ga511"));
  const outOfCoverage = machine.createAtlasTimeMachineSnapshot({ id: "ga511-outside", capturedAt: "2026-01-02T00:02:30Z", observations: [], view, sourceSummaries: [{ ...ga511, coverageStatus: "out_of_coverage", observationCount: 0 }] });
  assert.ok(outOfCoverage.coverageGaps.includes("Source reports out of coverage: ga511"));
  assert.ok(!outOfCoverage.coverageGaps.includes("Empty source result: ga511"));
  const failure = machine.createAtlasTimeMachineSnapshot({ id: "ga511-failed", capturedAt: "2026-01-02T00:03:00Z", observations: [], view, sourceSummaries: [{ ...ga511, retrievedAt: null, freshness: "failed", hasError: true, error: "Failed https://511ga.org/road?key=private-token Authorization: Bearer bearer-secret", coverage: null, truncated: null, totalInArea: null, cached: null, sourceUrl: null, attribution: null, license: null, termsUrl: null }] });
  const failedSummary = failure.providerSummaries.find((item) => item.providerId === "ga511");
  assert.ok(failure.coverageGaps.includes("Provider error recorded: ga511"));
  assert.equal(failedSummary.hasError, true);
  assert.ok(failedSummary.error.includes("https://511ga.org/road"));
  assert.ok(!failedSummary.error.includes("private-token"));
  assert.ok(!failedSummary.error.includes("bearer-secret"));
});

test("forecast, delayed, synthetic, stale, and unknown remain separate dimensions", () => {
  const snapshot = machine.createAtlasTimeMachineSnapshot({
    id: "kinds", capturedAt: "2026-01-02T00:00:00Z", view,
    observations: [
      observation({ id: "forecast", layer: "weather", source: "NOAA/NWS weather.gov", freshness: "fresh", label: "Tonight forecast" }),
      observation({ id: "synthetic", source: "SignalWarden synthetic replay", freshness: "synthetic" }),
      observation({ id: "unknown", source: "unmapped source", freshness: "unknown" }),
    ],
    sourceSummaries: [{ providerId: "gpsjam-daily", providerName: "GPSJAM", retrievedAt: null, freshness: "stale", observationCount: 0, hasError: false, dataKind: "delayed", coverageStatus: "unknown" }],
  });
  const byId = Object.fromEntries(snapshot.providerSummaries.map((summary) => [summary.providerId, summary]));
  assert.equal(byId["noaa-weather"].dataKind, "forecast");
  assert.equal(byId["noaa-weather"].freshness, "fresh");
  assert.equal(byId["signalwarden-demo"].dataKind, "synthetic");
  assert.equal(byId["signalwarden-demo"].freshness, "synthetic");
  assert.equal(byId["gpsjam-daily"].dataKind, "delayed");
  assert.equal(byId["gpsjam-daily"].freshness, "stale");
  assert.equal(byId["unmapped source"].dataKind, "unknown");
  assert.equal(byId["unmapped source"].freshness, "unknown");
});

test("comparison is stable by source, layer, id and separately reports source-context changes", () => {
  const before = machine.createAtlasTimeMachineSnapshot({ id: "b", capturedAt: "2026-01-01T00:00:00Z", observations: [observation()], view, sourceSummaries: [{ providerId: "adsb-lol", providerName: "adsb.lol", retrievedAt: "2026-01-01T00:01:00Z", freshness: "fresh", observationCount: 1, hasError: false, dataKind: "observation", coverage: "100 nm max; geometry unknown" }] });
  const after = machine.createAtlasTimeMachineSnapshot({ id: "a", capturedAt: "2026-01-02T00:00:00Z", observations: [observation({ observedAt: "2026-01-02T00:00:00Z", freshness: "stale" }), observation({ id: "new" })], view, sourceSummaries: [{ providerId: "adsb-lol", providerName: "adsb.lol", retrievedAt: "2026-01-02T00:01:00Z", freshness: "stale", observationCount: 2, hasError: false, dataKind: "observation", coverage: "100 nm max; geometry unknown" }] });
  const result = machine.compareAtlasTimeMachineSnapshots(before, after);
  assert.deepEqual(result.counts, { added: 1, removed: 0, changed: 1, unchanged: 0 });
  assert.deepEqual(result.entries.map((entry) => entry.status), ["changed", "added"]);
  assert.deepEqual(result.entries[0].changedFields, ["freshness", "observedAt"]);
  assert.deepEqual(result.sourceCounts, { added: 0, removed: 0, changed: 1, unchanged: 0 });
  assert.equal(result.sourceChanges[0].status, "changed");
  assert.ok(result.sourceChanges[0].changedFields.includes("freshness"));
  assert.ok(result.sourceChanges[0].changedFields.includes("retrievedAt"));
});

test("comparison identities cannot collide when imported source/layer strings contain delimiters", () => {
  const before = machine.createAtlasTimeMachineSnapshot({ id: "before", capturedAt: "2026-01-01T00:00:00Z", observations: [observation({ source: "a\u0000b", layer: "c" })], view });
  const after = machine.createAtlasTimeMachineSnapshot({ id: "after", capturedAt: "2026-01-02T00:00:00Z", observations: [observation({ source: "a", layer: "b\u0000c" })], view });
  assert.deepEqual(machine.compareAtlasTimeMachineSnapshots(before, after).counts, { added: 1, removed: 1, changed: 0, unchanged: 0 });
});

test("conflicts compare shared data fields, not freshness or provenance metadata", () => {
  const conflicts = machine.findAtlasTimeMachineConflicts([observation(), observation({ source: "manual", point: { lat: 31, lon: -80 }, freshness: "stale" }), observation({ id: "solo", source: "adsb" })]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].sources, ["adsb", "manual"]);
  assert.deepEqual(conflicts[0].disagreements.map((item) => item.field), ["point"]);

  const metadataOnly = machine.findAtlasTimeMachineConflicts([
    observation({ source: "feed-one", freshness: "fresh", observedAt: "2026-01-01T00:00:00Z", properties: { value: 7, retrievedAt: "2026-01-01T00:01:00Z", attribution: "A", freshness: "fresh", dataKind: "observation", source: "one", error: "none" } }),
    observation({ source: "feed-two", freshness: "stale", observedAt: "2026-01-02T00:00:00Z", properties: { value: 7, retrievedAt: "2026-01-02T00:01:00Z", attribution: "B", freshness: "stale", dataKind: "delayed", source: "two", error: "failed" } }),
  ]);
  assert.deepEqual(metadataOnly, [], "freshness, timestamps, and attribution do not form a conflict");

  const withoutOptionalFields = observation({ source: "feed-one", properties: undefined });
  const missingOptional = machine.findAtlasTimeMachineConflicts([withoutOptionalFields, observation({ source: "feed-two", properties: { attribution: "B" } })]);
  assert.deepEqual(missingOptional, [], "missing optional data fields are not treated as disagreement");
  const dataConflict = machine.findAtlasTimeMachineConflicts([
    observation({ source: "feed-one", properties: { magnitude: 2.1 } }),
    observation({ source: "feed-two", properties: { magnitude: 3.4 } }),
  ]);
  assert.deepEqual(dataConflict[0].disagreements.map((item) => item.field), ["properties.magnitude"]);
});

test("retention keeps only newest ten snapshots and rejects invalid views and record caps", () => {
  const snapshots = Array.from({ length: 11 }, (_, i) => machine.createAtlasTimeMachineSnapshot({ id: String(i), capturedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, observations: [], view }));
  const retained = machine.retainAtlasTimeMachineSnapshots(snapshots.slice(0, 10), snapshots[10]);
  assert.equal(retained.length, machine.MAX_ATLAS_TIME_MACHINE_SNAPSHOTS);
  assert.equal(retained[0].id, "1");
  assert.throws(() => machine.createAtlasTimeMachineSnapshot({ id: "bad", capturedAt: "2026-01-01T00:00:00Z", observations: [], view: { ...view, center: { lat: 999, lon: 0 } } }), /Invalid Atlas time-machine view/);
  const tooMany = Array.from({ length: machine.MAX_ATLAS_TIME_MACHINE_OBSERVATIONS + 1 }, (_, i) => observation({ id: `record-${i}` }));
  assert.throws(() => machine.createAtlasTimeMachineSnapshot({ id: "too-many", capturedAt: "2026-01-01T00:00:00Z", observations: tooMany, view }), /observation cap exceeded/);
});
