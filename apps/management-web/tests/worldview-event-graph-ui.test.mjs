import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "worldview-event-graph-ui-"));
writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
symlinkSync(resolve(root, "node_modules"), join(out, "node_modules"), "dir");
const compile = spawnSync(process.execPath, [
  resolve(root, "node_modules/typescript/bin/tsc"),
  resolve(root, "src/WorldViewIncidentGraph.tsx"),
  "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler",
  "--skipLibCheck", "--lib", "ES2022,DOM", "--jsx", "react-jsx", "--outDir", out,
], { encoding: "utf8", cwd: out });
if (compile.status !== 0) throw new Error(`Unable to compile WorldViewIncidentGraph.tsx:\n${compile.stdout}\n${compile.stderr}`);
for (const file of readdirSync(out).filter((name) => name.endsWith(".js"))) {
  const path = join(out, file);
  let source = await readFile(path, "utf8");
  source = source.replace(/^import ["']\.\/worldview-event-graph\.css["'];?\s*$/gm, "");
  source = source.replace(/(from\s+["'])\.\/([^"']+)(["'])/g, (_match, before, specifier, after) => `${before}./${specifier.endsWith(".js") ? specifier : `${specifier}.js`}${after}`);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, source));
}
const { WorldViewIncidentGraph } = await import(`${pathToFileURL(join(out, "WorldViewIncidentGraph.js")).href}?${Date.now()}`);
const { buildIncidentGraph } = await import(`${pathToFileURL(join(out, "worldview-event-graph.js")).href}?${Date.now()}`);
test.after(() => rmSync(out, { recursive: true, force: true }));

const closure = {
  id: "ga511-closures-rte-17", layer: "traffic", point: { lat: 33.75, lon: -84.39 },
  observedAt: "2026-11-02T10:00:00Z", source: "Georgia 511 / GDOT", label: "Road closure · I-75",
  freshness: "fresh", properties: { eventType: "closures", eventId: "rte-17", retrievedAt: "2026-11-02T10:02:00Z", coverage: "State routes; local-road coverage unknown", sourceUrl: "https://example.test/record?token=should-not-render" },
};
const camera = {
  id: "pubcam-cam-3", layer: "cameras", point: { lat: 33.755, lon: -84.39, uncertaintyM: 100 },
  observedAt: "2026-11-02T10:15:00Z", source: "Public traffic camera catalog", label: "Public traffic camera · CAM-3",
  freshness: "fresh", properties: { cameraId: "CAM-3", retrievedAt: "2026-11-02T10:15:00Z", coverage: "Catalog location only" },
};
const graph = buildIncidentGraph({ observations: [closure, camera], focusRecord: closure });
const markup = renderToStaticMarkup(createElement(WorldViewIncidentGraph, {
  observations: [closure, camera], focusRecord: closure, providerResults: [], sourceSummaries: [],
}));

test("graph UI exposes evidence metadata, underlying records, and edge rationale", () => {
  assert.match(markup, /CROSS-LAYER EVIDENCE GRAPH/);
  assert.match(markup, /Georgia 511 \/ GDOT/);
  assert.match(markup, /Public traffic camera catalog/);
  assert.match(markup, /Source time/);
  assert.match(markup, /Retrieved/);
  assert.match(markup, /record: fresh/);
  assert.match(markup, /Coverage/);
  assert.match(markup, /Confidence \/ uncertainty/);
  assert.match(markup, /Inspect underlying source record/);
  assert.match(markup, /Within the configured 25 km and 24 hour association window/);
  assert.match(markup, /confidence not assigned/);
  assert.match(markup, /No causation, identity, provider agreement, or completeness is inferred/);
  assert.match(markup, /does not establish live frame availability or an outage/);
  assert.match(markup, /https:\/\/example\.test\/record/);
  assert.doesNotMatch(markup, /should-not-render/);
  assert.ok(graph.edges[0].endpoints.every((endpoint) => endpoint.source && endpoint.observedAt));
});

test("graph UI exposes adjustable distance and time windows and performs no provider request", async () => {
  assert.match(markup, /Association distance window/);
  assert.match(markup, /Association time window/);
  assert.match(markup, /No provider refresh, background request, consent change, or command generation/);
  const panel = await readFile(resolve(root, "src/WorldViewIncidentGraph.tsx"), "utf8");
  assert.doesNotMatch(panel, /\bfetch\s*\(|XMLHttpRequest|WebSocket|setInterval/);
});
