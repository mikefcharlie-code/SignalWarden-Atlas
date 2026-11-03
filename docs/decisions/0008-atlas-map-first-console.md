# Architecture Decision Record: Atlas map-first operations console

- **Status:** Proposed; implemented on the feature branch, pending maintainer review
- **Date:** 2026-11-03
- **Decision owner:** Repository owner / Atlas maintainers
- **Scope:** Presentation and interaction hierarchy of the existing Atlas `/worldview` frontend; no provider, API, storage, map-engine, or aircraft boundary change.
- **Decision question:** How should Atlas surface its map, source posture, evidence graph, scenario lab, history, and offline packs without obscuring existing opt-ins or provenance?
- **Confidence:** High

## Context and baseline

The current app is React 19/Vite, with Atlas lazy-loaded from `apps/management-web/src/main.tsx`. `WorldView.tsx` owns map state, selection, layers, provider panels, record details, history, and the graph; `WorldGlobe.tsx` is the existing renderer. The UI currently places the signal ribbon, a large time-machine section, and a command bar before the three-column map workspace. In Chromium at 1440×1000 the map began around y=1,595 px, so it was absent from the initial viewport. The default render made no external requests and had no page errors.

The documentation and existing source model describe Atlas as a read-only, offline-first public-context workspace. Layer switches filter display only; network reads remain separately opt-in and manually requested, except existing provider-specific explicit permissions. `buildAtlasSourceEvidence()` in `apps/management-web/src/worldview-source-evidence.ts` derives descriptive source metadata from already-loaded records/results/summaries and preserves unknown, stale, failed, mixed, attribution, terms, and coverage caveats. Existing map, graph, scenario, time-machine, field-pack, and provider tests are the compatibility boundary.

## Constraints and acceptance criteria

- **Hard constraints:** Keep the existing globe/map renderer, state and callbacks, API/provider adapter boundaries, provider-specific opt-ins/keys/attribution, offline retention rules, provenance and unknown/stale semantics. Do not add provider polling, new sources, control/weapon/effector paths, or a deployment/merge.
- **Acceptance criteria:** Map appears as the primary first-viewport surface; desktop/mobile layouts remain accessible without horizontal overflow; source/freshness/trust context is visible and derived from canonical loaded evidence; existing World View layers, evidence graph, closure-duration scenario, time machine, and offline packs remain reachable; frontend tests/typecheck/build and Chromium visual QA pass.
- **Exclusions:** Provider integration changes, API contract changes, map engine replacement, persistence changes, new navigation/control semantics, production-readiness claims.

## Options considered

| Option | Fit to criteria | Main benefits | Main costs/risks | Reversibility | Evidence/assumptions |
|---|---|---|---|---|---|
| **A. Reorder and restyle the existing Atlas shell; add a compact loaded-source status surface; keep established feature components and adapters.** | High | Puts the map first; reuses verified gates and evidence logic; smallest behavior surface; no migration. | Stateful JSX is large; layout moves can break callback/accessibility wiring; source summary must avoid implying completeness. | Easy; revert frontend/docs commit. | Observed shell and helper in `WorldView.tsx`, `worldview-source-evidence.ts`; baseline browser inspection. |
| **B. Build a parallel new Atlas application/shell and migrate feature-by-feature.** | Medium | Cleaner component boundary could follow later. | Duplicates map state and risks divergent gates, stale/history behavior, provider options, and user paths; larger acceptance surface. | Partial; requires rollback/migration across duplicate components. | Estimate; no evidence a second state boundary is needed. |
| **C. Keep the current layout and apply only a color/type refresh.** | Low | Lowest implementation risk. | Does not fix the verified map-below-fold problem or panel hierarchy; fails map-first acceptance. | Easy. | Baseline screenshot and measured map position. |

## Decision

Prefer **Option A**. Keep the current `WorldView` state owner, renderer, provider adapters, and feature components. Recompose the interface so Atlas’s map is the dominant first-view workspace, with compact display controls beside it, a visible loaded-source posture derived from `buildAtlasSourceEvidence()`, and clear links to the evidence graph/scenario and history/offline-pack workspaces. Put secondary settings and long-form detail behind accessible disclosure controls while preserving their existing components, callbacks, gates, and labels. Use responsive CSS around the same DOM and interactions rather than creating a duplicate map or data path. At widths <=350px, a style scoped to the Atlas route wraps existing topbar status/account controls instead of clipping them; it changes no navigation or account behavior.

## Consequences

### Positive

- The map becomes visible and primary immediately without a map-engine or data-contract migration.
- Source state can remain explicit and descriptive while reusing the canonical provenance helper.
- Existing provider consent and historical/offline feature implementations remain the source of behavior.
- The choice is confined to a branch and is easy to revert before merge.

### Negative and residual risk

- `WorldView.tsx` is a large stateful integration surface; composition changes still require regression tests and browser checks.
- Stacked map stages retain a 480px viewport to match `WorldGlobe`’s existing minimum host size; this is scrollable on phones and was verified without canvas clipping.
- Provider configuration and actual source coverage remain deployment-dependent and are not established by this UI change.

### Assumptions and unknowns

- **Assumption:** The redesign leaves global navigation and account semantics unchanged; the only narrow-shell exception is an Atlas-route-only topbar wrap at <=350px so existing status/account controls remain visible rather than clipped.
- **Unknown:** No production deployment, provider keys, or live source availability were verified or requested.

## Migration and rollback

- **Prerequisites/seams:** Feature branch from verified `origin/main`; use existing Atlas components/helpers. No schema, database, API, or migration prerequisite.
- **Migration steps:** Implement composition/styles and narrow regression tests; run frontend tests/typecheck/build; verify desktop/mobile in Chromium; independent review; push feature branch and open a review PR.
- **Success signals:** The map starts in the initial desktop viewport; mobile has no horizontal page overflow; key Atlas features remain discoverable and usable; default rendering remains offline/no external requests; source status states remain distinct and source-derived.
- **Rollback trigger:** Any unresolved provider-gate, provenance, historical replay, offline-pack, accessibility, or map-selection regression; failure of required checks; or map remains below the fold.
- **Rollback method:** Revert the presentation commit(s) or close the PR. There are no data or server changes.

## Validation and evidence

- **Performed:** Baseline suite passed 452 tests and typecheck; final `pnpm typecheck`, `pnpm test` (456/456), and `pnpm build` passed. Chromium at 1440×1000, 390×844, and 320×800 put the map at y≈485/577/627 px, matched document width to viewport width, showed a 480px canvas/slot on stacked layouts, and recorded no page errors or external requests. Key disclosures and the provider dock opened; two independent reviewers found no actionable findings.
- **Published:** [PR #8](https://github.com/mikefcharlie-code/SignalWarden-Atlas/pull/8) is open against `main` from `feat/atlas-map-first-redesign`; implementation commit `ddd5cff9e529184e954530afa5ff2eb47de6d46a` is included. It is not merged or deployed. Production provider configuration and live provider responses remain unverified.
- **Evidence index:** `docs/atlas-ui-redesign-contract.md`; `docs/worldview-atlas.md`; `docs/worldview-workspace.md`; `docs/worldview-data-sources.md`; `apps/management-web/src/WorldView.tsx`; `apps/management-web/src/worldview-source-evidence.ts`; existing `apps/management-web/tests/worldview-*.test.mjs`.

## Reconsideration triggers

Revisit if Atlas gains a new map renderer, global shell/navigation ownership moves into the Atlas package, evidence-source semantics change, or accessibility/browser validation shows the disclosure-based hierarchy is not discoverable. **Owner:** repository owner / Atlas maintainers. **Review by:** before merge or when any trigger occurs.
