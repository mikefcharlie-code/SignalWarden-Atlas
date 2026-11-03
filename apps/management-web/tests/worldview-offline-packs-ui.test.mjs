import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("offline field packs require explicit area/record selection and use only a bounded file workflow", () => {
  const panel = source("WorldViewOfflinePacks.tsx");
  const model = source("worldview-offline-packs.ts");
  const timeMachine = source("WorldViewTimeMachine.tsx");
  assert.match(panel, /Center latitude/);
  assert.match(panel, /Center longitude/);
  assert.match(panel, /Field-pack radius/);
  assert.match(panel, /Loaded observations in field-pack area/);
  assert.match(panel, /Save &amp; download selected field pack/);
  assert.match(panel, /Import field pack for local comparison/);
  assert.match(panel, /page session only and clear on reload/);
  assert.match(panel, /not a sync/);
  assert.match(panel, /Imagery\/raster, animated overlays, basemap tiles, camera image bytes/);
  assert.match(panel, /Open current source terms/);
  assert.match(panel, /Signal filters:/);
  assert.match(timeMachine, /disabled=\{captureDisabled\}/);
  assert.match(timeMachine, /<WorldViewOfflinePacks/);
  assert.match(model, /MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS = 500/);
  assert.match(model, /MAX_ATLAS_OFFLINE_PACK_BYTES = 1_000_000/);
  assert.match(model, /MAX_ATLAS_OFFLINE_PACKS_IN_SESSION = 5/);
  assert.match(model, /MAX_ATLAS_OFFLINE_RADIUS_KM = 100/);
});

test("field-pack code never polls, fetches, opens sockets, or uses durable browser storage", () => {
  const panel = source("WorldViewOfflinePacks.tsx");
  const model = source("worldview-offline-packs.ts");
  for (const text of [panel, model]) {
    assert.doesNotMatch(text, /\bfetch\s*\(|setInterval\s*\(|localStorage|sessionStorage|indexedDB|WebSocket/);
  }
  assert.match(panel, /file\.text\(\)/);
  assert.match(panel, /URL\.createObjectURL/);
  assert.match(model, /importAtlasOfflineFieldPack/);
  assert.match(model, /cloneImportedPack/);
});
