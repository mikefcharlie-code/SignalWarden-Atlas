import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "worldview-closure-scenario-"));
writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
symlinkSync(resolve(root, "node_modules"), join(out, "node_modules"), "dir");
const compile = spawnSync(process.execPath, [
  resolve(root, "node_modules/typescript/bin/tsc"),
  resolve(root, "src/worldview-closure-scenario.ts"),
  "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler",
  "--skipLibCheck", "--lib", "ES2022,DOM", "--outDir", out,
], { encoding: "utf8", cwd: out });
if (compile.status !== 0) throw new Error(`Unable to compile closure scenario model:\n${compile.stdout}\n${compile.stderr}`);
for (const file of readdirSync(out).filter((name) => name.endsWith(".js"))) {
  const path = join(out, file);
  const source = await (await import("node:fs/promises")).readFile(path, "utf8");
  const rewritten = source.replace(/(from\s+["'])\.\/([^"']+)(["'])/g, (_m, before, specifier, after) => `${before}./${specifier.endsWith(".js") ? specifier : `${specifier}.js`}${after}`);
  await (await import("node:fs/promises")).writeFile(path, rewritten);
}
const graph = await import(`${pathToFileURL(join(out, "worldview-event-graph.js")).href}?${Date.now()}`);
const scenario = await import(`${pathToFileURL(join(out, "worldview-closure-scenario.js")).href}?${Date.now()}`);
test.after(() => rmSync(out, { recursive: true, force: true }));

const closure = (overrides = {}) => ({
  id: "ga511-closures-rte-17", layer: "traffic", point: { lat: 33.75, lon: -84.39 },
  observedAt: "2026-11-02T10:00:00Z", source: "Georgia 511 / GDOT", label: "Road closure · I-75",
  freshness: "fresh", properties: { eventType: "closures", eventId: "rte-17", roadway: "I-75", startAt: "2026-11-02T12:00:00Z", retrievedAt: "2026-11-02T10:02:00Z", dataKind: "reported-event" }, ...overrides,
});
const camera = (id, overrides = {}) => ({
  id: id ?? "cam-1", layer: "cameras", point: { lat: 33.755, lon: -84.39 }, observedAt: "2026-11-02T12:30:00Z", source: "Caltrans CCTV", label: "Public traffic camera",
  freshness: "fresh", properties: { providerTimestamp: "2026-11-02T12:00:00Z", retrievedAt: "2026-11-02T12:35:00Z", ...overrides },
});
function build(focus, records, options = {}) {
  const incidentGraph = graph.buildIncidentGraph({ observations: records, focusRecord: focus, maxDistanceKm: 25, maxTimeDeltaHours: 24, providerResults: options.providerResults, sourceSummaries: options.sourceSummaries });
  return scenario.buildClosureDurationScenario({ observations: records, focusRecord: focus, incidentGraph, ...options });
}

 test("six-hour hypothetical end and directed inclusive interval use explicit startAt", () => {
  const focus = closure();
  const atStart = camera("at-start", { providerTimestamp: "2026-11-02T12:00:00Z" });
  const atEnd = camera("at-end", { providerTimestamp: "2026-11-02T18:00:00Z" });
  const after = camera("after", { providerTimestamp: "2026-11-02T18:00:01Z" });
  const result = build(focus, [focus, atStart, atEnd, after]);
  assert.equal(result.status, "ready");
  assert.equal(result.hypotheticalEndAt, "2026-11-02T18:00:00.000Z");
  assert.deepEqual(result.scenarioAssociations.map((x) => x.record.id), ["at-start", "at-end"]);
  assert.equal(result.scenarioAssociations[1].timeFromStartMs, 6 * 60 * 60 * 1000);
});

test("baseline is preserved from spatial-temporal edges only and comparison sets are distinct", () => {
  const focus = closure();
  const nearby = camera("nearby", { providerTimestamp: "2026-11-02T12:30:00Z" });
  const sameId = closure({ source: "Second road feed", properties: { ...focus.properties, retrievedAt: "2026-11-02T13:00:00Z" } });
  const records = [focus, nearby, sameId];
  const incidentGraph = graph.buildIncidentGraph({ observations: records, focusRecord: focus });
  const result = scenario.buildClosureDurationScenario({ observations: records, focusRecord: focus, incidentGraph });
  assert.equal(result.baselineAssociations.length, 1);
  assert.equal(result.baselineAssociations[0].record.id, "nearby");
  assert.equal(result.comparison.shared.length, 1);
  assert.equal(result.comparison.baselineOnly.length, 0);
  assert.equal(result.comparison.scenarioOnly.length, 0);
  assert.ok(result.baselineAssociations[0].basis.includes("IncidentGraph"));
});

test("comparison identity keeps repeated source records with different timestamps distinct", () => {
  const focus = closure();
  const first = closure({ id: "ga511-closures-second", observedAt: "2026-11-02T12:30:00Z", properties: { ...closure().properties, eventId: "second", startAt: "2026-11-02T12:00:00Z", providerTimestamp: "2026-11-02T12:30:00Z" } });
  const second = { ...first, observedAt: "2026-11-02T13:30:00Z", properties: { ...first.properties, providerTimestamp: "2026-11-02T13:30:00Z" } };
  const records = [focus, first, second];
  const result = build(focus, records);
  assert.equal(result.baselineAssociations.length, 2);
  assert.equal(result.scenarioAssociations.length, 2);
  assert.equal(result.comparison.shared.length, 2);
  assert.equal(new Set(result.comparison.shared.map((item) => item.associationId)).size, 2);
});

test("baseline retains existing same-ID temporal edges while scenario associations stay separate", () => {
  const focus = closure();
  const later = closure({ observedAt: "2026-11-02T12:30:00Z", properties: { ...focus.properties, providerTimestamp: "2026-11-02T12:30:00Z" } });
  const result = build(focus, [focus, later]);
  assert.equal(result.baselineAssociations.length, 1);
  assert.equal(result.baselineAssociations[0].record.observedAt, new Date(later.observedAt).toISOString());
  assert.equal(result.scenarioAssociations.length, 0);
  assert.equal(result.comparison.baselineOnly.length, 1);
});

test("rejects a baseline graph for another focus and an unrepresentable assumed end", () => {
  const focus = closure();
  const other = closure({ id: "ga511-closures-other", observedAt: "2026-11-02T10:00:00Z" });
  const otherGraph = graph.buildIncidentGraph({ observations: [focus, other], focusRecord: other });
  const mismatch = scenario.buildClosureDurationScenario({ observations: [focus, other], focusRecord: focus, incidentGraph: otherGraph });
  assert.equal(mismatch.status, "baseline-mismatch");
  assert.match(mismatch.coverageGaps[0], /not ready for this exact selected record/);

  const overflowFocus = closure({ properties: { ...closure().properties, startAt: new Date(8.64e15).toISOString() } });
  const overflow = build(overflowFocus, [overflowFocus]);
  assert.equal(overflow.status, "invalid-start");
  assert.match(overflow.coverageGaps[0], /cannot be represented/);
});

test("source timestamp basis and provenance are exposed", () => {
  const focus = closure();
  const providerTime = camera("provider-time", { providerTimestamp: "2026-11-02T13:00:00Z" });
  const observedTime = camera("observed-time", { providerTimestamp: "not-a-time", retrievedAt: "2026-11-02T12:30:00Z" });
  observedTime.observedAt = "2026-11-02T14:00:00Z";
  const result = build(focus, [focus, providerTime, observedTime], { sourceSummaries: [{ providerId: "Caltrans CCTV", freshness: "fresh", dataKind: "observation", retrievedAt: "2026-11-02T12:35:00Z", observationCount: 2, hasError: false }] });
  assert.equal(result.scenarioAssociations.find((x) => x.record.id === "provider-time").sourceTimestampBasis, "providerTimestamp");
  assert.match(result.scenarioAssociations.find((x) => x.record.id === "observed-time").sourceTimestampBasis, /observedAt/);
  assert.ok(result.scenarioAssociations[0].evidence.source);
  assert.ok(result.sourceEvidence.length > 0);
});

test("explicit start is required and never falls back", () => {
  for (const properties of [{}, { observedAt: "2026-11-02T12:00:00Z", providerTimestamp: "2026-11-02T12:00:00Z", reportedAt: "2026-11-02T12:00:00Z", retrievedAt: "2026-11-02T12:00:00Z", plannedEndAt: "2026-11-02T18:00:00Z" }, { startAt: "bad" }]) {
    const focus = closure({ properties: { eventType: "closures", ...properties } });
    const result = build(focus, [focus]);
    assert.equal(result.status, properties.startAt ? "invalid-start" : "missing-start");
  }
});

test("invalid durations and invalid observations are explicit/bounded", () => {
  const focus = closure();
  const records = [focus, camera("valid"), { ...camera("bad"), point: { lat: 99, lon: 0 } }];
  const incidentGraph = graph.buildIncidentGraph({ observations: records, focusRecord: focus });
  for (const duration of [0, 73, 1.5, NaN, Infinity]) {
    const result = scenario.buildClosureDurationScenario({ observations: records, focusRecord: focus, incidentGraph, durationHours: duration });
    assert.equal(result.status, "invalid-duration");
  }
  assert.equal(build(focus, records, { durationHours: 1 }).status, "ready");
  assert.equal(build(focus, records, { durationHours: 72 }).status, "ready");
  assert.equal(build(focus, records).scenarioAssociations.length, 1);
});

test("synthetic and non-synthetic records remain separated, including source evidence", () => {
  const focus = closure();
  const synthetic = camera("synthetic", { dataKind: "synthetic" });
  const live = { ...camera("live"), source: "Independent live catalog" };
  const result = build(focus, [focus, synthetic, live], { sourceSummaries: [{ providerId: "Caltrans CCTV", freshness: "synthetic", dataKind: "synthetic", observationCount: 1, hasError: false }] });
  assert.deepEqual(result.scenarioAssociations.map((x) => x.record.id), ["live"]);
  assert.deepEqual(result.baselineAssociations.map((x) => x.record.id), ["live"]);
  assert.ok(result.sourceEvidence.some((x) => x.freshness === "synthetic"));
});

test("clearly synthetic closure and candidate records remain synthetic in a valid scenario", () => {
  const source = "SignalWarden synthetic scenario fixture";
  const focus = closure({ source, freshness: "synthetic", properties: { ...closure().properties, dataKind: "synthetic" } });
  const sample = { ...camera("synthetic-sample", { providerTimestamp: "2026-11-02T18:00:00Z", dataKind: "synthetic" }), source, freshness: "synthetic" };
  const before = structuredClone([focus, sample]);
  const result = build(focus, [focus, sample]);
  assert.equal(result.status, "ready");
  assert.equal(result.scenarioAssociations.length, 1);
  assert.equal(result.scenarioAssociations[0].record.freshness, "synthetic");
  assert.equal(result.scenarioAssociations[0].evidence.dataKind, "synthetic");
  assert.deepEqual([focus, sample], before);
});

test("stable repeatability, cap omissions, immutability, unsupported focus, and no network APIs", () => {
  const focus = closure();
  const records = [focus, ...Array.from({ length: 4 }, (_, i) => camera(`cam-${i}`, { providerTimestamp: `2026-11-02T12:0${i}:00Z` }))];
  const before = structuredClone(records);
  const first = build(focus, records, { maxAssociations: 2 });
  const second = build(focus, records, { maxAssociations: 2 });
  assert.deepEqual(first, second);
  assert.equal(first.scenarioAssociations.length, 2);
  assert.equal(first.omittedScenarioCount, 2);
  assert.deepEqual(records, before);
  const unsupported = build({ ...focus, layer: "aircraft", properties: {} }, [{ ...focus, layer: "aircraft", properties: {} }]);
  assert.equal(unsupported.status, "unsupported-focus");
  const source = readFileSync(resolve(root, "src/worldview-closure-scenario.ts"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|setInterval/);
});

test("scenario input scanning is capped and reports records beyond the cap", () => {
  const focus = closure();
  const firstFiveThousand = Array.from({ length: scenario.MAX_CLOSURE_SCENARIO_INPUT_RECORDS }, (_, index) => camera(`before-cap-${index}`));
  const input = [...firstFiveThousand, focus];
  const result = scenario.buildClosureDurationScenario({
    observations: input,
    focusRecord: focus,
    incidentGraph: graph.buildIncidentGraph({ observations: [focus], focusRecord: focus }),
  });
  assert.equal(result.status, "no-focus");
  assert.equal(result.omittedInputRecordCount, 1);
  assert.match(result.coverageGaps.join(" "), /beyond the 5000-record scenario input cap/);
});
