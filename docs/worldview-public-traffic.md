# WorldView public traffic cameras, traffic and road events

An opt-in relay and panel for public road-authority camera catalogs, TomTom traffic incidents/flow, and Georgia 511 road-work/closure events. The relay is disabled by default; camera sources also require a per-provider allowlist, and keyed data providers have separate feature gates. A provider's appearance in the catalogue is not legal approval for a deployment.

## Providers

| Provider | Region | Key | Status (2026-10-30) |
|---|---|---|---|
| Caltrans CCTV | California | None | Verified live |
| TfL JamCams | London | None | Verified live |
| City of Austin | Austin, TX | None | Verified live |
| TxDOT ITS | Texas (districts in `UCAS_TXDOT_DISTRICTS`) | None | Verified live |
| Fintraffic weathercams | Finland | None | Verified live |
| Live Traffic NSW | New South Wales | None | Verified live |
| WSDOT | Washington | `UCAS_WSDOT_ACCESS_CODE` | Built, needs key |
| Ontario 511 | Ontario | `UCAS_ONTARIO511_API_KEY` | Built, needs key |
| FL511 | Florida | `UCAS_FL511_API_KEY` | Built, needs key; personal use only without FDOT consent |
| 511NY | New York | `UCAS_511NY_API_KEY` | Built, needs key; upstream looked broken |
| TomTom Traffic | Global | `UCAS_TOMTOM_API_KEY` | Endpoints reachable, untested with a key |
| [Georgia 511 Events API](https://511ga.org/developers/doc) | Georgia interstates and state routes as stated by the service; local-road completeness is undocumented | `UCAS_511GA_API_KEY` | Adapter follows official docs; no live keyed request was made |

`UCAS_PUBLIC_CAMERA_PROVIDERS` must explicitly list camera providers approved for the specific deployment after reviewing current terms, attribution, quotas, retention and permitted use. An unset or empty variable disables every camera provider. This is separate from the user-facing World View opt-in.

## How it works

- Enable with `UCAS_PUBLIC_TRAFFIC_ENABLED=1`. Requests need `X-SignalWarden-Traffic: enabled` and must not be cross-site.
- Only explicitly allowlisted camera providers can be queried. TomTom additionally requires `UCAS_TOMTOM_TRAFFIC_ENABLED=1` and `UCAS_TOMTOM_API_KEY`; both are off by default and require deployment-specific terms/credential review.
- Georgia 511 road events additionally require `UCAS_511GA_ROAD_EVENTS_ENABLED=1` and server-side `UCAS_511GA_API_KEY`; both are off by default. To obtain a key, register for a 511GA account and request a developer API key from the [official API documentation](https://511ga.org/developers/doc). The documentation states a limit of ten API calls per 60 seconds. Review current provider terms before enabling; the API reference does not establish a separate open-data license.
- Catalogs are cached in memory for 10 minutes (refetched at most once a minute). A viewport returns at most 300 cameras within ±3° of center.
- A snapshot is fetched only for one selected camera, only from the host that provider's catalog names, at most every 10 s, and is never cached or mirrored. The client never supplies a URL.
- TomTom reads are limited to 10,000 km² and 200 incidents, at most every 30 s.
- The Georgia 511 Events endpoint returns a statewide array, not a viewport-filtered response. The relay requests it only after the shared network permission and explicit manual refresh, filters coordinates to a validated bounding box, and caps response bytes/events. It exposes the documented `roadwork` and `closures` types separately, preserves provider update/start/expected-end times, and throttles more conservatively than the published limit. An empty result is not proof that all roads are clear.
- Keys stay in server environment variables and are stripped from every returned source URL, error and log.

## Safety boundary

No plate reading, face recognition, image analysis or cross-camera vehicle tracking. Snapshots are relayed bytes for display only, and camera poses are as the authority publishes them. Each camera shows its authority's attribution and terms. “Verified” in the catalogue describes adapter/source-shape checks only; it is not a determination of redistribution, commercial-use or privacy rights.
