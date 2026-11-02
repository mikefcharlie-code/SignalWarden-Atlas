import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "worldview-atlas-"));
writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
symlinkSync(resolve(root, "node_modules"), join(out, "node_modules"), "dir");
const compile = spawnSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), resolve(root, "src/worldview-atlas.ts"), "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--skipLibCheck", "--lib", "ES2022,DOM", "--outDir", out], { encoding: "utf8", cwd: out });
if (compile.status !== 0) throw new Error(`Unable to compile worldview-atlas.ts:\n${compile.stdout}\n${compile.stderr}`);
const atlas = await import(`${pathToFileURL(join(out, "worldview-atlas.js")).href}?${Date.now()}`);
test.after(() => rmSync(out, { recursive: true, force: true }));

const supplied = "?lat=30.83857&lon=-83.26409&z=5.03&layers=livecams%2Cstaticcams%2Cplanes&base=satellite&sig=ais%2Croad-works%2Croad-incidents%2Croad-closures";

test("reference view initializes at the supplied coordinates and map zoom", () => {
  const view = atlas.resolveAtlasInitialView(supplied);
  assert.deepEqual(view.center, { lat: 30.83857, lon: -83.26409 });
  assert.equal(view.mapZoom, 5.03);
  assert.equal(view.basemap, "satellite");
  assert.ok(view.globeScale > 2.5 && view.globeScale <= atlas.GLOBE_SCALE_MAX);
  assert.ok(Math.abs(atlas.globeScaleToMapZoom(view.globeScale) - 5.03) < 0.02);
});

test("URL layer hints select display filters without enabling unsupported sources", () => {
  const view = atlas.resolveAtlasInitialView(supplied);
  assert.equal(view.signalFilters.livecams, true);
  assert.equal(view.signalFilters.staticcams, true);
  assert.equal(view.signalFilters.planes, true);
  assert.equal(view.signalFilters.ais, true);
  assert.equal(view.signalFilters["road-incidents"], true);
  assert.equal(view.signalFilters["road-works"], true);
  assert.equal(view.signalFilters["road-closures"], true);
});

test("invalid coordinates fall back safely and unsupported basemap values do not become URLs", () => {
  const view = atlas.resolveAtlasInitialView("?lat=999&lon=NaN&z=bad&base=https%3A%2F%2Fevil.test");
  assert.deepEqual(view.center, atlas.ATLAS_REFERENCE_CENTER);
  assert.equal(view.mapZoom, atlas.ATLAS_REFERENCE_MAP_ZOOM);
  assert.equal(view.basemap, "satellite");
});

test("omitted layer hints keep external filters off and offline demo filters available", () => {
  const view = atlas.resolveAtlasInitialView("");
  assert.equal(view.center.lat, 30.83857);
  assert.equal(view.center.lon, -83.26409);
  assert.equal(view.signalFilters.livecams, false);
  assert.equal(view.signalFilters.ais, false);
  assert.equal(view.signalFilters["road-incidents"], false);
  assert.equal(view.signalFilters.staticcams, true);
  assert.equal(view.signalFilters.planes, true);
});

test("signal controls filter only matching observations and leave unrelated layers alone", () => {
  const filters = atlas.resolveAtlasInitialView("").signalFilters;
  assert.equal(atlas.isAtlasSignalVisible("aircraft", "plane-1", filters), true);
  assert.equal(atlas.isAtlasSignalVisible("cameras", "demo-cam-1", filters), true);
  assert.equal(atlas.isAtlasSignalVisible("cameras", "pubcam-provider-1", filters), false);
  assert.equal(atlas.isAtlasSignalVisible("vessels", "ais-provider-1", filters), false);
  assert.equal(atlas.isAtlasSignalVisible("traffic", "tomtom-incident-1", filters), false);
  const roadFilters = atlas.resolveAtlasInitialView(supplied).signalFilters;
  assert.equal(atlas.isAtlasSignalVisible("traffic", "ga511-roadwork-12", roadFilters), true);
  assert.equal(atlas.isAtlasSignalVisible("traffic", "ga511-closures-13", roadFilters), true);
  assert.equal(atlas.isAtlasSignalVisible("traffic", "ga511-roadwork-12", filters), false);
  assert.equal(atlas.isAtlasSignalVisible("traffic", "ga511-closures-13", filters), false);
  const workOnly = { ...filters, "road-incidents": false, "road-works": true };
  assert.equal(atlas.trafficLayerVisible(workOnly), true, "road-work remains independent of TomTom incidents");
  assert.equal(atlas.isAtlasSignalVisible("traffic", "ga511-roadwork-12", workOnly), true);
  const closuresOnly = { ...filters, "road-incidents": false, "road-closures": true };
  assert.equal(atlas.trafficLayerVisible(closuresOnly), true, "closures remain independent of TomTom incidents");
  assert.equal(atlas.isAtlasSignalVisible("traffic", "ga511-closures-13", closuresOnly), true);
  assert.equal(atlas.trafficLayerVisible(filters), false);
  assert.equal(atlas.isAtlasSignalVisible("weather", "weather-1", filters), true);
});
