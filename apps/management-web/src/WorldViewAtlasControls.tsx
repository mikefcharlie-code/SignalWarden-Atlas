import type { AtlasSignalFilters, AtlasSignalKey } from "./worldview-atlas";
import { ATLAS_SIGNAL_CONTROLS } from "./worldview-atlas";
import "./worldview-atlas-controls.css";

type Props = Readonly<{
  center: Readonly<{ lat: number; lon: number }>;
  mapZoom: number;
  filters: AtlasSignalFilters;
  onToggle: (layer: AtlasSignalKey, enabled: boolean) => void;
  onOpenSatellite: () => void;
}>;

const coordinate = (value: number) => value.toFixed(5);

export function WorldViewAtlasControls({ center, mapZoom, filters, onToggle, onOpenSatellite }: Props) {
  return <section className="wv-atlas-ribbon" aria-label="Atlas map and signal controls">
    <div className="wv-atlas-ribbon-head">
      <div>
        <span className="wv-atlas-eyebrow">ATLAS / INITIAL VIEW</span>
        <h2>Signal layers <span>· display filters</span></h2>
      </div>
      <div className="wv-atlas-view-meta" aria-label="Initial map view">
        <span>CENTER <b>{coordinate(center.lat)}, {coordinate(center.lon)}</b></span>
        <span>MAP Z <b>{mapZoom.toFixed(2)}</b></span>
        <button type="button" onClick={onOpenSatellite}>Satellite source</button>
      </div>
    </div>
    <div className="wv-atlas-layer-grid">
      {ATLAS_SIGNAL_CONTROLS.map((control) => {
        const unavailable = control.state === "unavailable";
        return <label className={`wv-atlas-layer ${filters[control.id] ? "is-on" : ""} ${unavailable ? "is-unavailable" : ""}`} key={control.id}>
          <input
            type="checkbox"
            checked={filters[control.id]}
            disabled={unavailable}
            aria-label={`${control.label} layer`}
            onChange={(event) => onToggle(control.id as AtlasSignalKey, event.target.checked)}
          />
          <span className="wv-atlas-check" aria-hidden="true" />
          <span className="wv-atlas-layer-copy"><strong>{control.label}</strong><small>{control.detail}</small></span>
          <span className={`wv-atlas-state ${control.state}`}>{control.status}</span>
        </label>;
      })}
    </div>
    <p className="wv-atlas-disclosure">Layer switches only filter displayed observations. External reads stay off until separately opted in and manually requested; missing providers never become synthetic live data. Context only — not navigation, flight control, targeting, or command.</p>
  </section>;
}
