import { useMemo } from "react";
import type { ProviderResult, WorldObservation } from "./worldview-core";
import {
  buildAtlasSourceEvidence,
  type AtlasSourceEvidence,
} from "./worldview-source-evidence";
import "./worldview-source-status.css";

type Props = Readonly<{
  observations: readonly WorldObservation[];
  providerResults: readonly ProviderResult[];
  sourceSummaries: readonly AtlasSourceEvidence[];
  coreFeedOptIn: boolean;
  historical?: boolean;
  syntheticReplay?: boolean;
}>;

const timestamp = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not reported";
  return new Date(value).toISOString().replace(".000Z", "Z");
};

function SourceCard({ source }: { source: AtlasSourceEvidence }) {
  const records = source.observationCount;
  return (
    <details className="atlas-source-card">
      <summary>
        <strong>{source.providerName ?? source.providerId}</strong>
        <span className={`atlas-source-state ${source.freshness}`}>
          {source.freshness}
        </span>
        <span className="atlas-source-kind">{source.dataKind ?? "unknown"}</span>
        <small>{records} result record{records === 1 ? "" : "s"} · {source.loadedRecordCount ?? 0} on map</small>
      </summary>
      <dl>
        <div><dt>Source freshness</dt><dd>{source.freshness}</dd></div>
        <div><dt>Record freshness</dt><dd>{source.freshnessStates?.join(", ") || "unknown"}</dd></div>
        <div><dt>Data kind</dt><dd>{source.dataKind ?? "unknown"}</dd></div>
        <div><dt>Coverage</dt><dd>{source.coverageStatus ?? "unknown"}{source.coverage ? ` · ${source.coverage}` : " · Not reported"}</dd></div>
        <div><dt>Loaded map records</dt><dd>{source.loadedRecordCount ?? 0}</dd></div>
        <div><dt>Provider result records</dt><dd>{source.observationCount}</dd></div>
        <div><dt>Retrieved</dt><dd>{timestamp(source.retrievedAt)}</dd></div>
        <div><dt>Source time basis</dt><dd>{source.timeBasis ?? "Not reported"}</dd></div>
        <div><dt>Cache / truncation</dt><dd>{source.cached === null || source.cached === undefined ? "Cache state not reported" : source.cached ? "Cached" : "Not cached"}{source.truncated === null || source.truncated === undefined ? " · truncation not reported" : source.truncated ? " · truncated" : " · not reported truncated"}</dd></div>
        <div><dt>Error state</dt><dd>{source.errorState ?? (source.hasError ? "reported" : "unknown")}{source.error ? ` · ${source.error}` : ""}</dd></div>
        <div><dt>Attribution</dt><dd>{source.attribution ?? "Not reported"}</dd></div>
        <div><dt>License / terms</dt><dd>{source.license ?? source.termsText ?? "Not reported"}</dd></div>
        <div><dt>Known blind spots</dt><dd>{source.knownBlindSpots?.length ? source.knownBlindSpots.join(" · ") : "Not reported"}</dd></div>
        <div><dt>Absence meaning</dt><dd>{source.absenceMeaning ?? "Unknown; missing or empty results do not establish absence."}</dd></div>
        {source.sourceUrl && <div><dt>Source</dt><dd><a href={source.sourceUrl} target="_blank" rel="noreferrer">Open source</a></dd></div>}
        {source.termsUrl && <div><dt>Terms</dt><dd><a href={source.termsUrl} target="_blank" rel="noreferrer">Open terms</a></dd></div>}
      </dl>
    </details>
  );
}

export function WorldViewSourceStatus({
  observations,
  providerResults,
  sourceSummaries,
  coreFeedOptIn,
  historical = false,
  syntheticReplay = false,
}: Props) {
  const sources = useMemo(() => buildAtlasSourceEvidence({
    observations,
    providerResults,
    sourceSummaries,
  }), [observations, providerResults, sourceSummaries]);
  const visibleSources = sources.slice(0, 3);
  const additionalSources = sources.slice(3);

  return (
    <section className="atlas-source-status" aria-label="Loaded source status" id="atlas-sources">
      <div className="atlas-source-status-head">
        <div>
          <span className="atlas-status-kicker">SOURCE POSTURE · LOADED EVIDENCE ONLY</span>
          <strong>{sources.length} source{sources.length === 1 ? "" : "s"} · {observations.length} loaded map record{observations.length === 1 ? "" : "s"}</strong>
          <p>Provenance context, not a trust score or completeness claim. Empty or missing results remain unknown.</p>
        </div>
        <div className="atlas-source-mode">
          <span className={`atlas-core-feed-state ${coreFeedOptIn ? "enabled" : "off"}`}>
            Core manual-feed opt-in {coreFeedOptIn ? "on" : "off"}
          </span>
          <small>Other provider panels retain separate opt-ins and permissions.</small>
        </div>
      </div>
      {(historical || syntheticReplay) && (
        <p className="atlas-source-mode-note" role="note">
          {historical ? "Historical capture · not current" : "Synthetic replay · not provider evidence"}
        </p>
      )}
      {sources.length ? (
        <div className="atlas-source-cards">
          {visibleSources.map((source) => <SourceCard key={source.providerId} source={source} />)}
          {additionalSources.length > 0 && (
            <details className="atlas-source-more">
              <summary>More loaded sources ({additionalSources.length})</summary>
              {additionalSources.map((source) => <SourceCard key={source.providerId} source={source} />)}
            </details>
          )}
        </div>
      ) : (
        <p className="atlas-source-empty" role="status">
          No source records or provider results are loaded. Freshness, coverage, and current conditions are unknown.
        </p>
      )}
    </section>
  );
}
