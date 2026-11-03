import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('time-machine capture is explicit and does not add storage, polling, or network access', () => {
  const panel = source('WorldViewTimeMachine.tsx');
  assert.match(panel, /Capture loaded map state/);
  assert.match(panel, /No refresh, polling, upload, or network permission is added/);
  assert.match(panel, /this page’s memory and clear on reload/);
  assert.match(panel, /Clear captures/);
  assert.doesNotMatch(panel, /\bfetch\s*\(|setInterval\s*\(|localStorage|sessionStorage|WebSocket/);
});

test('historical replay replaces point records and hides unsnapshotted current overlays', () => {
  const view = source('WorldView.tsx');
  assert.match(view, /timeMachineSnapshot\s*\?\s*timeMachineSnapshot\.observations/);
  assert.match(view, /HISTORICAL CAPTURE · NOT CURRENT/);
  assert.match(view, /HISTORICAL MAP · LIVE PANELS BELOW/);
  for (const prop of ['imageryLayers', 'basemap', 'oceanOverlay', 'windAirLayer', 'liveOverlay', 'gpsJam']) {
    assert.match(view, new RegExp(`${prop}=\\{timeMachineSnapshot \\? (?:\\[\\]|null)`), prop);
  }
  assert.match(view, /setTimeMachineSnapshot\(null\)/);
  assert.match(view, /providerResults=\{timeMachineSnapshot \|\| replaying \? \[\]/);
  assert.match(view, /sourceSummaries=\{timeMachineSnapshot\?\.providerSummaries/);
});

test('Georgia 511 summaries reuse the existing manual result path and clear with provider state', () => {
  const traffic = source('WorldViewPublicTraffic.tsx');
  assert.match(traffic, /fetchGa511RoadEvents\(box, fetch, c\.signal\)/);
  assert.match(traffic, /emitSourceSummary\.current\?\.\(ga511TimeMachineSummary\(result\)\)/);
  assert.match(traffic, /emitSourceSummary\.current\?\.\(ga511TimeMachineSummary\(roadEvents, true, e instanceof Error/);
  assert.match(traffic, /emitSourceSummary\.current\?\.\(null\)/);
  const panel = source('WorldViewTimeMachine.tsx');
  assert.match(panel, /sourceSummaries/);
  assert.match(panel, /truncated/);
  assert.match(panel, /Loaded source evidence/);
  assert.match(panel, /coverageStatus/);
  assert.match(panel, /knownBlindSpots/);
  assert.match(panel, /freshnessStates/);
  assert.match(panel, /dataKind/);
  assert.match(panel, /termsText/);
  assert.match(panel, /errorState/);
  assert.match(panel, /absenceMeaning/);
  assert.match(panel, /same layer\/ID only/);
  assert.match(panel, /sourceChanges/);
});
