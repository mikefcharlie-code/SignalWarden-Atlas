# SignalWarden Atlas map

Atlas opens the existing Mark 2 World View at **30.83857, -83.26409**, with a reference map zoom of **5.03**. The original perspective globe uses its own camera scale, so the app converts the conventional map zoom approximately and labels both values; this is not a Web Mercator map renderer. The initial location, zoom, basemap choice, and supported layer hints can be read from `lat`, `lon`, `z`, `base`, `layers`, and `sig` URL parameters. Values are range-checked. URL layer hints select display filters only and never grant permission to contact a provider.

## Satellite source and network gate

NASA GIBS VIIRS SNPP corrected-reflectance true color is preselected as the satellite option. The schematic globe remains visible offline; **no tile requests occur until the user opens the satellite source panel and checks “Allow tile requests.”** Tile loading stays limited to the visible globe viewport, rate-limited and bounded in count and size. Attribution, selected imagery date, retrieval/provider time, and freshness remain visible with the source details. The GIBS date defaults to yesterday because the current day's composite may still be filling in; clouds, swath gaps, and image age are normal. This is satellite context, not a high-resolution local survey or a live sensor view.

NASA asks clients to acknowledge the use of imagery from NASA's Global Imagery Browse Services, part of NASA's Earth Science Data and Information System. See [NASA GIBS API guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) and [NASA data-use and citation guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance). No NASA imagery is bundled into the repository.

The existing optional Esri World Imagery and Google 2D satellite relay controls remain available only where the server relay is enabled and configured. Esri's [World Imagery item](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) describes lower-resolution global coverage and higher-resolution imagery typically within 3–5 years of currency for most areas; actual source dates and coverage vary by location. These keyed services are not selected by default and were not verified with real production keys in this task.

## Signal controls

- **Aircraft / planes:** filters the existing aircraft display. Offline examples are synthetic; the optional adsb.lol read is a bounded, manual, receive-only context feed.
- **Camera locations:** filters synthetic or explicitly imported camera points.
- **Live cameras:** filters public traffic-camera catalog results. A catalog entry or snapshot is not an onboard aircraft stream; there is no recognition, plate reading, or cross-camera tracking. Fetching requires the existing traffic relay, provider allowlist/configuration, and a separate manual request.
- **AIS vessels:** filters vessel observations. AIS remains receive-only and self-reported/incomplete; the display checkbox is not the AIS session opt-in. The relay has its own explicit opt-in and manual refresh.
- **Road incidents:** filters TomTom aggregate incident results. A deployment must enable the public-traffic and TomTom relay flags and configure a server-side key; the map switch itself does not fetch.
- **Road works** and **road closures:** separate display filters for Georgia 511 / GDOT Events API records. The layer filters do not fetch; loading the feed requires the existing World View network opt-in, the public-traffic relay, server configuration (`UCAS_511GA_ROAD_EVENTS_ENABLED=1` plus `UCAS_511GA_API_KEY`), and a manual refresh in the public traffic panel. 511GA states support for Georgia interstates and state routes; local-road completeness is not documented. Source attribution, retrieval time, event update time, stale status, and provider errors remain visible. Empty or missing results do not prove roads are clear.

Provider data remain subject to coverage, freshness, source attribution, terms, and deployment configuration. No provider data is bundled. The [Georgia 511 API documentation](https://511ga.org/developers/doc) requires a registered account and developer key and documents a ten-call-per-60-second limit; the relay adds stricter request bounds, caching and throttling. The provider panels preserve the existing bounded-read and source-status behavior.

## Operating boundary

Atlas is a read-only public-context display and a simulation-first reference, **not flight-ready and not a navigation display**. It has no weapon/effector controls, targeting, arming, or AI-to-command path. Aircraft telemetry remains receive-only; other Mark 2 features and their existing safeguards are preserved. This map change adds no deployment and no new license.

Implementation and regression coverage: `apps/management-web/src/worldview-atlas.ts`, `WorldViewAtlasControls.tsx`, `worldview-basemap.ts`, `WorldGlobe.tsx`, and `apps/management-web/tests/worldview-atlas.test.mjs`.
