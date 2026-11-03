import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('Atlas has an accessible map-first console with compact, reversible action access', () => {
  const view = source('WorldView.tsx');
  const css = source('worldview-console.css');

  assert.match(view, /className=\{`worldview atlas-console/);
  assert.match(view, /className="atlas-skip-link" href="#atlas-map"/);
  assert.match(view, /<h1>SignalWarden Atlas<\/h1>/);
  assert.match(view, /aria-label="Atlas workspace sections"/);
  for (const id of ['atlas-map', 'atlas-evidence', 'atlas-history', 'atlas-commands']) {
    assert.match(view, new RegExp(`href="#${id}"`), id);
    assert.match(view, new RegExp(`id="${id}"`), id);
  }
  assert.match(view, /<details className="atlas-header-menu">/);
  for (const action of ['Global context', 'Share view', 'Export scene', 'Export pack', 'Import scene', 'Import pack']) {
    assert.ok(view.includes(action), `missing header action: ${action}`);
  }
  assert.match(css, /grid-template-columns:\s*minmax\(190px, 220px\) minmax\(0, 1fr\) minmax\(245px, 285px\)/);
  assert.match(css, /\.atlas-evidence-disclosure\s*\{\s*order:\s*-1/);
});

test('narrow layouts put the map first, then source posture, and prevent 320px page overflow', () => {
  const css = source('worldview-console.css');

  assert.match(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.worldview\.atlas-console\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;/);
  assert.match(css, /\.worldview\.atlas-console #atlas-map\s*\{\s*order:\s*1/);
  assert.match(css, /\.worldview\.atlas-console \.atlas-source-status\s*\{\s*order:\s*2/);
  assert.match(css, /\.worldview\.atlas-console \.wv-left\s*\{\s*order:\s*3/);
  assert.match(css, /\.worldview\.atlas-console \.wv-right\s*\{\s*order:\s*4/);
  assert.match(css, /@media \(max-width: 350px\)[\s\S]*?\.topbar \.top-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /\.topbar \.secure-status\s*\{\s*flex:\s*1 0 100%/);
  assert.match(css, /@container \(min-width: 900px\)[\s\S]*?grid-template-columns:\s*minmax\(190px, 220px\) minmax\(0, 1fr\) minmax\(245px, 285px\)/);
  assert.match(css, /@container \(max-width: 899px\)[\s\S]*?\.wv-stage \.globe-slot\s*\{\s*height:\s*480px/);
});

test('evidence, scenario, history, offline packs, and local commands remain in accessible disclosures', () => {
  const view = source('WorldView.tsx');
  const timeMachine = source('WorldViewTimeMachine.tsx');
  const offlinePacks = source('WorldViewOfflinePacks.tsx');

  assert.match(view, /className="[^"]*atlas-evidence-disclosure/);
  assert.match(view, /Evidence graph \+ scenario lab/);
  assert.match(view, /className="[^"]*atlas-history-disclosure/);
  assert.match(view, /History, source register \+ offline field packs/);
  assert.match(timeMachine, /WorldViewOfflinePacks/);
  assert.match(offlinePacks, /<h3 id="wv-offline-packs-title">Offline field packs<\/h3>/);
  assert.match(view, /className="[^"]*atlas-command-disclosure/);
  assert.match(view, /Local commands \+ optional voice/);
  assert.match(view, /className="atlas-analyst-workspace"/);
});

test('source posture remains evidence-derived and preserves unknown, provenance, and opt-in language', () => {
  const view = source('WorldView.tsx');
  const status = source('WorldViewSourceStatus.tsx');

  assert.match(view, /observations=\{incidentGraphObservations\}/);
  assert.match(view, /providerResults=\{incidentGraphProviderResults\}/);
  assert.match(view, /sourceSummaries=\{incidentGraphSourceSummaries\}/);
  assert.match(status, /buildAtlasSourceEvidence\(/);
  assert.match(status, /Empty or missing results remain unknown/);
  assert.match(status, /not a trust score or completeness claim/);
  assert.match(status, /Core manual-feed opt-in/);
  assert.match(status, /Other provider panels retain separate opt-ins and permissions/);
  assert.match(status, /Provider result records/);
  assert.match(status, /Loaded map records/);
  assert.match(status, /Attribution/);
  assert.match(status, /License \/ terms/);
  assert.match(status, /Absence meaning/);
  assert.doesNotMatch(status, /\bfetch\s*\(|setInterval\s*\(|WebSocket/);
});
