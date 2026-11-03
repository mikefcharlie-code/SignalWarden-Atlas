import { useMemo, useRef, useState } from "react";
import type { ProviderResult, WorldObservation } from "./worldview-core";
import { haversineKm, validateObservation } from "./worldview-core";
import type { AtlasSourceEvidence } from "./worldview-source-evidence";
import type { AtlasTimeMachineView } from "./worldview-time-machine";
import {
  MAX_ATLAS_OFFLINE_PACK_BYTES,
  MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS,
  MAX_ATLAS_OFFLINE_PACKS_IN_SESSION,
  MAX_ATLAS_OFFLINE_RADIUS_KM,
  atlasOfflineObservationPolicy,
  compareAtlasOfflineFieldPacks,
  createAtlasOfflineFieldPack,
  importAtlasOfflineFieldPack,
  retainAtlasOfflineFieldPacks,
  serializeAtlasOfflineFieldPack,
  type AtlasOfflineFieldPack,
} from "./worldview-offline-packs";
import "./worldview-offline-packs.css";

type Props = Readonly<{
  observations: readonly WorldObservation[];
  providerResults: readonly ProviderResult[];
  sourceSummaries: readonly AtlasSourceEvidence[];
  view: AtlasTimeMachineView;
  disabled?: boolean;
}>;

const identity = (record: WorldObservation) => JSON.stringify([record.source, record.layer, record.id]);
const timeLabel = (value: string | null | undefined) => {
  if (!value) return "Not reported";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "Unknown timestamp";
};
const recordTime = (record: WorldObservation, key: string) => {
  const value = record.properties?.[key];
  return typeof value === "string" ? value : null;
};
const renderConflict = (conflict: AtlasOfflineFieldPack["conflictLog"][number] | ReturnType<typeof compareAtlasOfflineFieldPacks>["conflicts"][number]) =>
  `${conflict.layer} · ${conflict.id} · ${conflict.sources.join(" vs ")} — ${conflict.disagreements.map((item) => `${item.field}: ${item.values.map((value) => JSON.stringify(value)).join(" vs ")}`).join("; ")}`;

export function WorldViewOfflinePacks({ observations, providerResults, sourceSummaries, view, disabled = false }: Props) {
  const [centerLatText, setCenterLatText] = useState(String(view.center.lat));
  const [centerLonText, setCenterLonText] = useState(String(view.center.lon));
  const [radiusKm, setRadiusKm] = useState(25);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [packs, setPacks] = useState<AtlasOfflineFieldPack[]>([]);
  const [inspectId, setInspectId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [incomingId, setIncomingId] = useState("");
  const [message, setMessage] = useState("");
  const packSequence = useRef(0);

  const centerLat = Number(centerLatText);
  const centerLon = Number(centerLonText);
  const areaValid = Number.isFinite(centerLat) && centerLat >= -90 && centerLat <= 90 && Number.isFinite(centerLon) && centerLon >= -180 && centerLon <= 180 && radiusKm > 0 && radiusKm <= MAX_ATLAS_OFFLINE_RADIUS_KM;
  const candidates = useMemo(() => {
    if (!areaValid) return [];
    const inArea = observations.filter((record) => validateObservation(record) && haversineKm({ lat: centerLat, lon: centerLon }, record.point) <= radiusKm);
    const counts = new Map<string, number>();
    for (const record of inArea) counts.set(identity(record), (counts.get(identity(record)) ?? 0) + 1);
    return inArea
      .slice()
      .sort((a, b) => identity(a).localeCompare(identity(b)))
      .map((record) => ({
        record,
        key: identity(record),
        policy: atlasOfflineObservationPolicy(record, providerResults),
        duplicate: (counts.get(identity(record)) ?? 0) > 1,
      }));
  }, [observations, providerResults, areaValid, centerLat, centerLon, radiusKm]);
  const allEligibleCount = candidates.filter((item) => item.policy.includedByDefault && !item.duplicate).length;
  const selectable = candidates.filter((item) => item.policy.includedByDefault && !item.duplicate).slice(0, MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS);
  const selectableKeys = useMemo(() => new Set(selectable.map((item) => item.key)), [selectable]);
  const selectedCount = [...selectedKeys].filter((key) => selectableKeys.has(key)).length;
  const inspectPack = packs.find((pack) => pack.id === inspectId) ?? packs.at(-1) ?? null;
  const baseline = packs.find((pack) => pack.id === baselineId) ?? null;
  const incoming = packs.find((pack) => pack.id === incomingId) ?? null;
  const comparison = baseline && incoming && baseline.id !== incoming.id
    ? compareAtlasOfflineFieldPacks(baseline, incoming)
    : null;
  const formatRecord = (record: WorldObservation) => `${record.source} · ${record.layer} · ${record.id}`;

  const useCurrentMapCenter = () => {
    setCenterLatText(String(view.center.lat));
    setCenterLonText(String(view.center.lon));
    setSelectedKeys(new Set());
  };
  const toggleAll = () => {
    setSelectedKeys(selectedCount === selectable.length ? new Set() : new Set(selectable.map((item) => item.key)));
  };
  const toggle = (key: string) => setSelectedKeys((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const saveAndDownload = () => {
    try {
      if (!areaValid) throw new Error("Enter a valid center and radius (maximum 100 km)");
      const capturedAt = new Date().toISOString();
      const pack = createAtlasOfflineFieldPack({
        id: `atlas-field-${Date.now()}-${++packSequence.current}`,
        capturedAt,
        area: { shape: "circle", center: { lat: centerLat, lon: centerLon }, radiusKm },
        view,
        observations,
        selectedObservationKeys: [...selectedKeys].filter((key) => selectableKeys.has(key)),
        providerResults,
        sourceSummaries,
      });
      const encoded = serializeAtlasOfflineFieldPack(pack);
      const retained = retainAtlasOfflineFieldPacks(packs, pack);
      const evicted = !packs.some((item) => item.id === pack.id) && packs.length + 1 > retained.length;
      const url = URL.createObjectURL(new Blob([encoded], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${pack.id}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setPacks(retained);
      setInspectId(pack.id);
      setIncomingId(pack.id);
      setBaselineId(packs.at(-1)?.id ?? "");
      setMessage(`Saved and downloaded ${pack.observations.length} selected point record(s) for this bounded area${evicted ? `; the oldest of the ${MAX_ATLAS_OFFLINE_PACKS_IN_SESSION} session packs was evicted` : ""}. No provider was refreshed.`);
    } catch (error) {
      setMessage(`Field pack not saved: ${error instanceof Error ? error.message : "invalid pack"}`);
    }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > MAX_ATLAS_OFFLINE_PACK_BYTES) throw new Error(`Field pack exceeds ${MAX_ATLAS_OFFLINE_PACK_BYTES.toLocaleString()} bytes`);
      const pack = importAtlasOfflineFieldPack(await file.text());
      const retained = retainAtlasOfflineFieldPacks(packs, pack);
      const evicted = !packs.some((item) => item.id === pack.id) && packs.length + 1 > retained.length;
      setPacks(retained);
      setInspectId(pack.id);
      setIncomingId(pack.id);
      setBaselineId(packs.at(-1)?.id ?? "");
      setMessage(`Imported ${pack.observations.length} point record(s) for local review. This is not a sync; imported source claims are not authenticated.${evicted ? ` The oldest of the ${MAX_ATLAS_OFFLINE_PACKS_IN_SESSION} session packs was evicted.` : ""}`);
    } catch (error) {
      setMessage(`Field pack rejected: ${error instanceof Error ? error.message : "invalid pack"}`);
    }
  };

  const sourceSummary = (source: AtlasSourceEvidence) => (
    <li key={source.providerId}>
      <b>{source.providerName ?? source.providerId}</b>
      <span>{source.providerId} · freshness {source.freshness} · data kind {source.dataKind ?? "unknown"} · retrieved {timeLabel(source.retrievedAt)}</span>
      <span>Coverage: {source.coverageStatus ?? "unknown"} · {source.coverage ?? "Unknown / not reported"}</span>
      <span>Attribution: {source.attribution ?? "Not reported"} · license: {source.license ?? "Not reported"}</span>
      <span>Terms: {source.termsText ?? "Not reported"}{source.termsUrl && <> · <a href={source.termsUrl} target="_blank" rel="noopener noreferrer">Open current source terms</a></>}</span>
      {source.truncated && <span>Provider reported a truncated result.</span>}
      {source.hasError && <span>Provider error reported; details are not evidence of a clear condition.</span>}
    </li>
  );

  return (
    <section className="wv-offline-packs" aria-labelledby="wv-offline-packs-title">
      <div className="wv-offline-packs-head">
        <div>
          <span className="wv-time-machine-kicker">ATLAS / USER-SELECTED FILE PACK</span>
          <h3 id="wv-offline-packs-title">Offline field packs</h3>
        </div>
        <button type="button" onClick={() => { setPacks([]); setInspectId(""); setBaselineId(""); setIncomingId(""); setMessage("Offline field packs cleared from this page session."); }} disabled={packs.length === 0}>Clear session packs</button>
      </div>
      <p className="wv-offline-packs-disclosure">Choose a circle around the map center and select only eligible points already loaded in Atlas. Creation downloads a validated JSON file; up to {MAX_ATLAS_OFFLINE_PACKS_IN_SESSION} packs / {MAX_ATLAS_OFFLINE_PACKS_IN_SESSION * MAX_ATLAS_OFFLINE_PACK_BYTES / 1_000_000} MB stay in this page session only and clear on reload. No refresh, polling, upload, or server sync is added.</p>
      <p className="wv-offline-packs-warning">Only synthetic samples and USGS/NWS records that match an already-loaded provider result are exportable under the current source register. Other sources are omitted because offline retention permission is not established. This source-name check is not a substitute for reviewing current terms. Imagery/raster, animated overlays, basemap tiles, camera image bytes, and provider-only layers are never included because the current adapters and terms do not establish permission to store those bytes offline.</p>

      <div className="wv-offline-packs-controls">
        <label>Center latitude <input aria-label="Field-pack center latitude" type="number" step="any" min={-90} max={90} value={centerLatText} onChange={(event) => setCenterLatText(event.target.value)} /></label>
        <label>Center longitude <input aria-label="Field-pack center longitude" type="number" step="any" min={-180} max={180} value={centerLonText} onChange={(event) => setCenterLonText(event.target.value)} /></label>
        <label>Radius <select aria-label="Field-pack radius" value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}>{[1, 5, 10, 25, 50, 100].map((value) => <option key={value} value={value}>{value} km</option>)}</select></label>
        <button type="button" onClick={useCurrentMapCenter}>Use current map center</button>
      </div>
      <p className="wv-offline-packs-gap">The circle is a local selection boundary only; it does not change provider query scope. Selected records retain their original source ID and observation/acquisition time; source retrieval time and Atlas capture time remain separate.</p>

      <div className="wv-offline-packs-selection">
        <div className="wv-offline-packs-selection-head">
          <strong>{candidates.length} loaded point record(s) in the selected circle · {allEligibleCount} eligible · {selectable.length} selectable (max {MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS}) · {selectedCount} selected</strong>
          <button type="button" onClick={toggleAll} disabled={disabled || selectable.length === 0}>{selectedCount === selectable.length && selectable.length > 0 ? "Clear eligible selection" : `Select eligible points (max ${MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS})`}</button>
        </div>
        {!areaValid ? <p role="alert">Enter a valid WGS84 center and choose a radius up to {MAX_ATLAS_OFFLINE_RADIUS_KM} km.</p> : candidates.length === 0 ? <p>No loaded point records fall inside this circle. That does not mean the area is clear.</p> : (
          <ul aria-label="Loaded observations in field-pack area">
            {candidates.map(({ record, key, policy, duplicate }, index) => {
              const canSelect = policy.includedByDefault && !duplicate && selectableKeys.has(key);
              const overCap = policy.includedByDefault && !duplicate && !selectableKeys.has(key);
              const reason = duplicate ? "Duplicate source/layer/ID is ambiguous and cannot be selected." : !policy.includedByDefault ? policy.reason : overCap ? `The ${MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS}-record pack cap is reached; this record is beyond the selectable limit.` : policy.reason;
              return <li key={`${key}:${record.observedAt}:${index}`}>
                <label>
                  <input type="checkbox" checked={selectedKeys.has(key) && canSelect} disabled={disabled || !canSelect} onChange={() => toggle(key)} />
                  <span><b>{record.label || record.id}</b> · {formatRecord(record)}</span>
                </label>
                <small>{canSelect ? `${record.freshness ?? "unknown"} · record ${timeLabel(record.observedAt)} · retrieved ${timeLabel(recordTime(record, "retrievedAt"))} · attribution ${recordTime(record, "attribution") ?? "not reported"}` : reason}</small>
              </li>;
            })}
          </ul>
        )}
        {candidates.filter((item) => !item.policy.includedByDefault).length > 0 && <p className="wv-offline-packs-gap">{[...new Set(candidates.filter((item) => !item.policy.includedByDefault).map((item) => item.policy.providerId))].sort().join(", ")} record(s) are not included; their current source notes do not establish offline retention permission.</p>}
        {candidates.filter((item) => item.duplicate).length > 0 && <p className="wv-offline-packs-gap">Duplicate source/layer/ID records are not selectable because reconciliation identity would be ambiguous.</p>}
        {allEligibleCount > MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS && <p className="wv-offline-packs-gap">The pack cap is {MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS} observations; the first {MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS} eligible records are selectable.</p>}
        <button type="button" className="wv-offline-packs-save" onClick={saveAndDownload} disabled={disabled || !areaValid || selectedCount > MAX_ATLAS_OFFLINE_PACK_OBSERVATIONS}>Save &amp; download selected field pack</button>
        {disabled && <p className="wv-offline-packs-gap">Field-pack creation is disabled while viewing a historical capture or synthetic replay.</p>}
      </div>

      <div className="wv-offline-packs-import">
        <label>Import field pack for local comparison <input type="file" accept=".json,application/json" aria-label="Import offline field pack" onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
        <p>Import checks schema, WGS84 area, timestamps, source-summary fields, observation identities, counts, and file size. It does not authenticate source claims or verify rights. Do not import data you are not permitted to retain.</p>
      </div>
      {message && <p className="wv-offline-packs-status" role="status">{message}</p>}

      {packs.length > 0 && <div className="wv-offline-packs-library">
        <strong>Page-session packs · {packs.length}/{MAX_ATLAS_OFFLINE_PACKS_IN_SESSION}</strong>
        <div className="wv-offline-packs-controls">
          <label>Inspect pack <select aria-label="Inspect local field pack" value={inspectPack?.id ?? ""} onChange={(event) => setInspectId(event.target.value)}>{packs.map((pack) => <option key={pack.id} value={pack.id}>{timeLabel(pack.capturedAt)} · {pack.observations.length} points · {pack.id}</option>)}</select></label>
        </div>
        {inspectPack && <div className="wv-offline-packs-detail">
          <b>Captured area · not a live map</b>
          <span>{inspectPack.area.center.lat.toFixed(5)}, {inspectPack.area.center.lon.toFixed(5)} · radius {inspectPack.area.radiusKm} km · captured {timeLabel(inspectPack.capturedAt)}</span>
          <span>Map view: zoom {inspectPack.view.zoom} · layers {Object.entries(inspectPack.view.layers).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none enabled"}</span>
          <span>Signal filters: {Object.entries(inspectPack.view.signalFilters).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none enabled"}</span>
          <span>Included records: {inspectPack.observations.length}. The record list is bounded to the first 100 shown below.</span>
          {inspectPack.providerSummaries.length > 0 ? <div className="wv-offline-packs-sources"><strong>Source evidence at capture</strong><ul>{inspectPack.providerSummaries.map(sourceSummary)}</ul></div> : <p>No provider summary was retained; source status is unknown, not clear.</p>}
          <div className="wv-offline-packs-conflicts"><strong>Potential conflicts · unresolved · no source winner selected</strong>
            {(() => {
              const conflicts = inspectPack.conflictLog;
              return conflicts.length ? <ul>{conflicts.map((conflict, index) => <li key={`${conflict.layer}:${conflict.id}:${index}`}>{renderConflict(conflict)}</li>)}</ul> : <p>No cross-source data conflict was identified among packed records. This is not evidence of agreement, accuracy, or coverage.</p>;
            })()}
          </div>
          {inspectPack.excludedSources.length > 0 && <p className="wv-offline-packs-gap">Sources omitted: {inspectPack.excludedSources.join(", ")}. Their observations and provider summaries are not present in this file.</p>}
          <p className="wv-offline-packs-gap">Not included: {inspectPack.excludedSurfaces.join("; ")}. These provider-only layers remain unavailable in this offline file.</p>
          <ul className="wv-offline-packs-gaps">{inspectPack.coverageGaps.map((gap, index) => <li key={`${index}:${gap}`}>{gap}</li>)}</ul>
          <ul className="wv-offline-packs-records">{inspectPack.observations.slice(0, 100).map((record, index) => <li key={`${identity(record)}:${index}`}><b>{record.label || record.id}</b><span>{formatRecord(record)}</span><span>Source record time: {timeLabel(record.observedAt)} · retrieved: {timeLabel(recordTime(record, "retrievedAt"))} · freshness: {record.freshness ?? "unknown"}</span><span>Attribution: {recordTime(record, "attribution") ?? "Not reported"} · coverage: {recordTime(record, "coverage") ?? "Not reported"}</span></li>)}</ul>
        </div>}
        {packs.length >= 2 && <div className="wv-offline-packs-comparison">
          <strong>Local import comparison · preview only, not sync</strong>
          <div className="wv-offline-packs-controls">
            <label>Baseline pack <select aria-label="Baseline offline field pack" value={baselineId} onChange={(event) => setBaselineId(event.target.value)}><option value="">Choose baseline</option>{packs.map((pack) => <option key={pack.id} value={pack.id}>{timeLabel(pack.capturedAt)} · {pack.id}</option>)}</select></label>
            <label>Imported / incoming pack <select aria-label="Incoming offline field pack" value={incomingId} onChange={(event) => setIncomingId(event.target.value)}><option value="">Choose incoming pack</option>{packs.map((pack) => <option key={pack.id} value={pack.id}>{timeLabel(pack.capturedAt)} · {pack.id}</option>)}</select></label>
          </div>
          {comparison ? <>
            <p>Record differences: added {comparison.records.counts.added} · removed {comparison.records.counts.removed} · changed {comparison.records.counts.changed} · unchanged {comparison.records.counts.unchanged}.</p>
            <p>Source-context differences: added {comparison.records.sourceCounts.added} · removed {comparison.records.sourceCounts.removed} · changed {comparison.records.sourceCounts.changed} · unchanged {comparison.records.sourceCounts.unchanged}. Metadata changes do not establish event causality or source trust.</p>
            <p>Differences reflect two selected/captured datasets and area selections; they are not proof an event began/ended, and no records are merged or synchronized.</p>
            <ul>{comparison.records.changes.filter((item) => item.status !== "unchanged").slice(0, 50).map((item, index) => <li key={`${item.identity}:${item.status}:${index}`}><b>{item.status.toUpperCase()}</b> · {item.after ? formatRecord(item.after) : item.before ? formatRecord(item.before) : "Unknown record"}{item.changedFields.length ? ` · fields: ${item.changedFields.join(", ")}` : ""}</li>)}</ul>
            <div className="wv-offline-packs-conflicts"><strong>Conflict log · unresolved; review source records, no automatic winner</strong>
              {comparison.conflicts.length ? <ul>{comparison.conflicts.map((conflict, index) => <li key={`${conflict.key}:${index}`}>{renderConflict(conflict)}</li>)}</ul> : <p>No cross-source data conflict was identified in the combined packs. This does not establish agreement, accuracy, completeness, or clear conditions.</p>}
            </div>
          </> : <p>Select two different packs to see a local comparison and unresolved conflict preview.</p>}
        </div>}
      </div>}
    </section>
  );
}
