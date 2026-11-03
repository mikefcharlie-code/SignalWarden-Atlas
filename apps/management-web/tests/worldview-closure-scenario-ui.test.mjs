import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "worldview-closure-scenario-ui-"));
writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
symlinkSync(resolve(root, "node_modules"), join(out, "node_modules"), "dir");
const compile = spawnSync(process.execPath, [
  resolve(root, "node_modules/typescript/bin/tsc"),
  resolve(root, "src/WorldViewClosureDurationScenario.tsx"),
  "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler",
  "--skipLibCheck", "--lib", "ES2022,DOM", "--jsx", "react-jsx", "--outDir", out,
], { encoding: "utf8", cwd: out });
if (compile.status !== 0) throw new Error(`Unable to compile WorldViewClosureDurationScenario.tsx:\n${compile.stdout}\n${compile.stderr}`);
for (const file of readdirSync(out).filter((name) => name.endsWith(".js"))) {
  const path = join(out, file);
  const source = await readFile(path, "utf8");
  const rewritten = source.replace(/(from\s+["'])\.\/([^"']+)(["'])/g, (_m, before, specifier, after) => `${before}./${specifier.endsWith(".js") ? specifier : `${specifier}.js`}${after}`);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, rewritten));
}
const { WorldViewClosureDurationScenario } = await import(`${pathToFileURL(join(out, "WorldViewClosureDurationScenario.js")).href}?${Date.now()}`);
const { buildIncidentGraph } = await import(`${pathToFileURL(join(out, "worldview-event-graph.js")).href}?${Date.now()}`);
test.after(() => rmSync(out, { recursive: true, force: true }));

const closure = (overrides = {}) => ({
  id: "ga511-closures-rte-17", layer: "traffic", point: { lat: 33.75, lon: -84.39 },
  observedAt: "2026-11-02T10:00:00Z", source: "Georgia 511 / GDOT", label: "Reported road closure · I-75",
  freshness: "fresh", properties: {
    eventType: "closures", eventId: "rte-17", startAt: "2026-11-02T12:00:00Z", plannedEndAt: "2026-11-02T19:00:00Z",
    reportedAt: "2026-11-02T09:45:00Z", lastUpdatedAt: "2026-11-02T10:00:00Z", retrievedAt: "2026-11-02T10:02:00Z",
  }, ...overrides,
});
const camera = (id, timestamp) => ({
  id, layer: "cameras", point: { lat: 33.755, lon: -84.39 }, observedAt: "2026-11-02T12:15:00Z",
  source: "Public traffic camera catalog", label: `Camera catalog location ${id}`, freshness: "fresh",
  properties: { providerTimestamp: timestamp, retrievedAt: "2026-11-02T12:20:00Z", dataKind: "observation" },
});
function render(focus, observations, options = {}) {
  const incidentGraph = buildIncidentGraph({ observations, focusRecord: focus, maxDistanceKm: 25, maxTimeDeltaHours: 24 });
  return renderToStaticMarkup(createElement(WorldViewClosureDurationScenario, {
    observations, focusRecord: focus, incidentGraph, providerResults: [], sourceSummaries: [], ...options,
  }));
}

test("scenario panel is structurally distinct and exposes explicit assumptions and every comparison source time", () => {
  const focus = closure();
  const inWindow = camera("inside", "2026-11-02T18:00:00Z");
  const afterWindow = camera("after", "2026-11-02T18:00:01Z");
  const markup = render(focus, [focus, inWindow, afterWindow]);
  assert.match(markup, /CLOSURE-DURATION SCENARIO LAB/);
  assert.match(markup, /SCENARIO ONLY/);
  assert.match(markup, /data-view-kind="scenario-only"/);
  assert.match(markup, /Assumed closure duration in hours/);
  assert.match(markup, /min="1" max="72" step="1"/);
  assert.match(markup, /startAt/);
  assert.match(markup, /Planned end · source-reported only/);
  assert.match(markup, /Baseline anchor source time/);
  assert.match(markup, /Retrieved/);
  assert.match(markup, /Point used for distance/);
  assert.match(markup, /Other source time fields/);
  assert.match(markup, /Georgia 511 \/ GDOT/);
  assert.match(markup, /Public traffic camera catalog/);
  assert.match(markup, /providerTimestamp/);
  assert.match(markup, /Baseline-only associations/);
  assert.match(markup, /Scenario-only associations/);
  assert.match(markup, /not a live prediction or operational instruction/);
  assert.match(markup, /does not predict or establish actual road status/);
  assert.match(markup, /No closure state, causal relationship, route, mission, command, forecast, provider refresh, or external fetch/);
  assert.match(markup, /Planned end · source-reported only<\/dt><dd>2026-11-02 19:00:00Z/);
  assert.match(markup, /Scenario end · assumed<\/dt><dd>2026-11-02 18:00:00Z/);
  assert.match(markup, /2026-11-02 18:00:00Z/);
  assert.match(markup, /2026-11-02 18:00:01Z/); // Baseline-only; the record is outside the hypothetical interval.
});

test("missing explicit start remains unknown and historical/synthetic modes are labeled", () => {
  const focus = closure({ freshness: "synthetic", source: "Synthetic scenario fixture", properties: { eventType: "closures", retrievedAt: "2026-11-02T10:02:00Z" } });
  const markup = render(focus, [focus], { historical: true, syntheticReplay: true });
  assert.match(markup, /Historical captured records · not current/);
  assert.match(markup, /Synthetic input · scenario\/test data, not provider evidence/);
  assert.match(markup, /must provide an explicit valid properties\.startAt/);
  assert.match(markup, /no other timestamp is used as a fallback/);
  assert.match(markup, /Not reported/);
  assert.doesNotMatch(markup, /Scenario end · assumed<\/dt><dd>2026-11-02/);
});

test("a valid synthetic scenario is visibly distinct from provider evidence", () => {
  const source = "SignalWarden synthetic scenario fixture";
  const focus = closure({ source, freshness: "synthetic", properties: { ...closure().properties, dataKind: "synthetic" } });
  const candidate = { ...camera("synthetic-camera", "2026-11-02T18:00:00Z"), source, freshness: "synthetic", properties: { providerTimestamp: "2026-11-02T18:00:00Z", retrievedAt: "2026-11-02T18:05:00Z", dataKind: "synthetic" } };
  const markup = render(focus, [focus, candidate], { syntheticReplay: true });
  assert.match(markup, /Synthetic input · scenario\/test data, not provider evidence/);
  assert.match(markup, /Data kind<\/dt><dd>synthetic/);
  assert.match(markup, /Scenario-only comparison layer, not observed records|separate comparison layer, not observed records/);
  assert.match(markup, /SignalWarden synthetic scenario fixture/);
});

test("built-in example uses isolated synthetic records and produces a deterministic baseline/scenario contrast", () => {
  const loadedClosure = closure();
  const markup = render(loadedClosure, [loadedClosure], { initialSyntheticExample: true });
  assert.match(markup, /data-example-kind="synthetic"/);
  assert.match(markup, /Built-in synthetic example · fixed test times and invented coordinates/);
  assert.match(markup, /current Atlas observations are not mixed in/);
  assert.match(markup, /Baseline 1 · Scenario 1 · Shared 0/);
  assert.match(markup, /Baseline-only associations \(1\)/);
  assert.match(markup, /Scenario-only associations \(1\)/);
  assert.match(markup, /data-record-kind="synthetic-scenario-data"/);
  assert.match(markup, /2026-01-01 20:00:00Z/);
  assert.match(markup, /2026-01-02 02:00:00Z/);
  assert.doesNotMatch(markup, /Georgia 511 \/ GDOT/);
});

test("focus retrieval time falls back only to the loaded source summary", () => {
  const focus = closure({ properties: { ...closure().properties, retrievedAt: undefined } });
  delete focus.properties.retrievedAt;
  const markup = render(focus, [focus], {
    sourceSummaries: [{ providerId: "Georgia 511 / GDOT", providerName: "Georgia 511 / GDOT", retrievedAt: "2026-11-02T10:03:00Z", freshness: "fresh", observationCount: 1, hasError: false }],
  });
  assert.match(markup, /Retrieved<\/dt><dd>2026-11-02 10:03:00Z/);
});

test("scenario UI performs no fetch, polling, websocket, or operational action", async () => {
  const panel = await readFile(resolve(root, "src/WorldViewClosureDurationScenario.tsx"), "utf8");
  assert.doesNotMatch(panel, /\bfetch\s*\(|XMLHttpRequest|WebSocket|setInterval|recommend(?:ed)? route|mission upload|dispatch/i);
});
