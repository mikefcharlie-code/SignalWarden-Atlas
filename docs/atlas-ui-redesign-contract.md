# Atlas map-first UI redesign — task contract

## Outcome
Deliver a cohesive, polished map-first operations-console layout for the Atlas page (`/worldview`) on a feature branch based on verified live `origin/main`. Keep the existing Atlas capabilities and behavior; do not merge or deploy. Audience: Atlas users reviewing public-context and already-loaded evidence.

## Acceptance checks
| ID | Required condition | How to verify | Status |
|---|---|---|---|
| A1 | The map is the primary workspace and appears in the initial desktop viewport; secondary controls no longer push it far below the fold. | Chromium at 1440×1000; inspect bounding boxes and screenshot. | Pass — map begins at y≈485 px (baseline y≈1,595 px). |
| A2 | Desktop and narrow/mobile layouts remain usable, keyboard-accessible, and free of horizontal page overflow. | Chromium at 1440×1000, 390×844, and 320×800; inspect screenshots, focus, overflow, and key controls. | Pass — document widths match all three viewports; at 320 px the topbar wraps without clipping and the persona selector remains visible; skip-to-map focus works. |
| A3 | Visible source status is derived from the existing Atlas source-evidence builder; freshness, data kind, coverage, retrieval/source times, errors, and attribution remain distinct, and unknown/stale semantics are not upgraded. | Inspect component and source-evidence tests; exercise default and error/unknown states where practical. | Pass — source panel uses `buildAtlasSourceEvidence()` and preserves unknown, freshness, attribution, coverage, terms, and absence language; new and existing tests pass. |
| A4 | Existing World View layers, local search/display controls, selected-record detail, evidence graph, closure-duration scenario, time machine, offline field packs, provider panels, and map interactions remain reachable and wired to their existing behavior. | Regression tests, DOM checks, and browser interactions. | Pass — actions menu, graph, history/offline packs, commands, source details, and provider dock were opened/mounted in Chromium; full suite passes. |
| A5 | Provider opt-ins, keys, attribution, manual refresh boundaries, existing explicit exceptions, and default no-network behavior are unchanged; no new polling/fetch path is added. | Existing offline/provider tests, source diff review, Chromium request log with default view. | Pass — zero external requests at all three viewports, including after opening the provider dock; no polling/fetch path added. |
| A6 | Atlas remains read-only public context: no control, weapon/effector, targeting, arming, or AI-to-command paths are introduced. | Static diff/test review and existing safety checks. | Pass — two independent read-only reviews found no actionable safety or behavior defect. |
| A7 | Frontend tests, typecheck, and production build pass; a non-author implementation review finds no concrete regression left unresolved. | `pnpm test`, `pnpm typecheck`, `pnpm build`, independent code/design review. | Pass — typecheck passed; 456/456 tests passed; production build succeeded; two independent reviews found no actionable findings. Vite emitted a non-fatal >500 kB chunk warning. |
| A8 | Work is pushed on a feature branch from live `origin/main`, and a review PR is opened without merge/deploy. | Verify GitHub branch/PR URL and target/base; report exact result. | Pass — [PR #8](https://github.com/mikefcharlie-code/SignalWarden-Atlas/pull/8) is open against `main` from `feat/atlas-map-first-redesign`; implementation commit `ddd5cff` is included; not merged or deployed. |

## Scope and assumptions
- **In scope:** Atlas presentation hierarchy, responsive layout, accessibility of controls, source/freshness/trust-state visibility, focused frontend tests, concise contract/ADR/ledger, browser visual QA, feature branch, and review PR.
- **Out of scope:** API/provider/model changes, new sources, polling, persistence/retention changes, map-engine replacement, backend/aircraft changes, deployment, and merge.
- **Assumption:** The current `origin/main` at `e1e34c72846bddbb2b0dde3538404c0880b1789a` is the requested live baseline; the tree was clean before branching. Brand navigation and topbar behavior are unchanged except for an Atlas-route-only <=350px wrap that prevents account controls from being clipped. Revisit if the remote changes materially before the branch is pushed.

## Evidence rules
- Use repository guidance, current code/tests/docs at the fetched baseline, direct Chromium rendering, and actual executed checks. Do not treat historical documentation test counts as current results.
- Provider/source claims must come from loaded Atlas evidence and its canonical helper; absent values remain unknown/not reported. No search-result or invented provider-state claims.
- Baseline observed: `origin/main` = `e1e34c7`; frontend `pnpm test` passed 452 tests and `pnpm typecheck` exited successfully before edits. Chromium at 1440×1000 showed the map beginning around y=1,595 px, no page errors, no external requests on the default view, and page width equal to viewport width.

## Permission boundary
- **Authorized:** Read the public `mikefcharlie-code/SignalWarden-Atlas` repository; create a feature branch from live `origin/main`; edit presentation, tests, and required docs; run local checks; push the branch and open the requested review PR.
- **Prohibited:** Merge, deploy, change provider/API/safety behavior, add provider polling, expose or move keys, add control/weapon/effector paths, or rewrite unrelated work.
- **Approval required before:** Any action outside this scope, including a changed base branch, merge, deployment, or materially expanded external publication.

## Risks and stop conditions
| Risk or blocker | Likelihood | Impact / reversibility | Mitigation or stop rule |
|---|---|---|---|
| Moving JSX in the stateful WorldView shell breaks callback wiring or history/provider behavior. | Medium | Major UI regression; reversible by reverting branch. | Keep state/adapters untouched; add structural regression tests and browser checks. |
| A compact source summary hides provenance or overstates completeness/freshness. | Medium | Misleading evidence; reversible. | Derive from `buildAtlasSourceEvidence`; display unknown/not-reported and separate data kind/freshness; keep detailed metadata accessible. |
| Provider controls mount or fetch earlier after layout changes. | Low–medium | Unwanted external requests/consent bypass. | Preserve lazy mounting/activity props and verify zero external requests on default view. |
| GitHub auth or changed remote baseline prevents safe PR creation. | Unknown | External write cannot be completed safely. | Verify live branch and auth before pushing; stop and report blocker if unavailable. |

## Workcells and checkpoints
| ID / owner | Outcome and inputs | Output / acceptance check | Dependency | Checkpoint |
|---|---|---|---|---|
| WC-1 / integrator | Baseline, task contract, ADR, implementation and integration. | Cohesive working redesign and end-to-end verification. | None | Baseline captured at `e1e34c7`. |
| WC-2 / read-only audit | Inventory current UI structure and safest presentation seams. | Component/file map and retention risks. | Baseline | Completed; see `docs/atlas-ui-redesign-ledger.md`. |
| WC-3 / read-only audit | Verify source, trust, provider-gate, offline, and safety semantics. | Preservation checklist and negative cases. | Baseline | Completed; summarized in ledger. |
| WC-4 / independent reviewer | Inspect final diff against the contract for visual/composition gaps and concrete regressions. | Findings and fix/reject checkpoint. | Implementation complete | Complete — two read-only reviews found no actionable findings; final rendered QA performed separately by integrator. |

## Evidence and verification log
| Claim / requirement | Evidence or check (source, URL/ID, date/version) | Result | Limitation |
|---|---|---|---|
| Live baseline and clean branch point | `origin/main` fetched 2026-11-03; commit `e1e34c72846bddbb2b0dde3538404c0880b1789a`; `git status` clean before branch | Verified | Remote can advance after fetch. |
| Existing capabilities/contracts | `docs/worldview-atlas.md`, `docs/worldview-workspace.md`, `docs/worldview-data-sources.md`; `src/WorldView.tsx` and existing Atlas tests | Verified from repository | Production provider configuration is not verified and is out of scope. |
| Pre-change frontend baseline | `apps/management-web`: `pnpm test` (452 pass, 0 fail), `pnpm typecheck` (exit 0) | Passed | Baseline only; final post-change results are recorded below. |
| Pre-change rendered layout | Chromium 1440×1000 via Playwright, default `/worldview`; map begins around y=1,595 px; 0 page errors, 0 external requests | Verified | Baseline render only. |
| Post-change responsive layout | Chromium/Playwright `/worldview` at 1440×1000, 390×844, and 320×800; map y≈485/577/627 px; document width exactly matched each viewport; globe slot and canvas matched at 480 px on stacked views | Verified | Local synthetic/offline view; screenshots are in `/workspace/atlas-redesign-final-desktop.png`, `/workspace/atlas-redesign-final-mobile.png`, and `/workspace/atlas-redesign-final-narrow.png`. |
| Post-change interactions and network boundary | Skip link focused; action menu, evidence graph, history/offline packs, commands, source details, and provider dock opened; request log empty at all three default viewports | Verified | No provider opt-in was activated and no production provider configuration was inspected. |
| Post-change frontend checks | `pnpm typecheck && pnpm test && pnpm build` in `apps/management-web`; 456/456 tests passed; build completed | Passed | Vite warns that the existing globe chunk exceeds 500 kB; warning is non-fatal. |
| Independent implementation review | Two read-only reviewers inspected the feature diff and the final mobile adjustments | No actionable findings | Reviewers lacked a browser; rendered Chromium QA and dimensions were performed by the integrator. |
| Publication checkpoint | PR #8 against `main`; head `feat/atlas-map-first-redesign` at `ddd5cff9e529184e954530afa5ff2eb47de6d46a` | Open; verified via GitHub connector | Review only; no merge or deployment. |

## Current state
- **Completed:** Live baseline fetched; feature branch `feat/atlas-map-first-redesign` created directly from `origin/main`; map-first UI and canonical source-status panel implemented; tests, typecheck, production build, desktop/mobile Chromium QA, two independent reviews, commit, push, and PR creation completed.
- **Open blockers / unknowns:** None. PR #8 is open for review; merge and deployment remain unauthorized.
- **Next action:** Await maintainer review; do not merge or deploy.
