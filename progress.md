Original prompt: 可以，那你来优化一下动画模块吧

## 2026-07-16

- Goal: improve the existing top-down match animation without changing simulation results or player statistics.
- Scope: deterministic event-directed possession, distinct shot outcomes, and authoritative on-field player counts from matchday snapshots.
- Existing strengths: stable playback reducer, a single canvas, seeded pass sequences, tactical movement, particles, and regression tests for playback timing.
- Existing gaps: free-running possession can disagree with the event team; only goal/penalty/save influence ball targeting; all replays draw 11v11 after dismissals; `endsInShot` is unused.
- Verification TODO: unit tests, lint/type/test/build, game Playwright client, screenshot inspection, console review, mobile/desktop browser audit.
- Pure event scene layer added: goals/misses attribute attack to the event team; saves/blocks invert the event team; targets and sequence seeds are deterministic.
- Pass generation now consumes `endsInShot`, supports a forced attacking side, and appends a real shot phase. Canvas formation now matches the engine's authoritative 4-3-3 starter shape.
- Focused event-scene tests pass (4/4) and repository lint remains clean.
- Matchday snapshots now carry player names/numbers for visual consumers. Pitch roster projection preserves formation slots across substitutions and removes dismissed players from the exact event minute.
- Canvas integration complete: directed event sequences, real on-field markers, distinct save/block/miss impact cues, richer commentary/event log, and `window.render_game_to_text` state for browser inspection.
- Focused verification passes: lint, TypeScript, and 21 event/lineup/participation/playback tests.
- Required web-game Playwright client ran against the deterministic preview fixture. Text state confirmed correct attack sides, real shirt numbers, a 10-player dismissed side, and substitution number 19; no console error artifact was produced.
- Screenshot review found and fixed three visual timing issues: impacts now wait for the ball to reach the target, new chances clear stale cues, and supporting forwards occupy box lanes instead of stacking on the goal line.
- Goal camera shake now uses centered overscan, eliminating exposed black canvas edges during translation. Final synchronized goal screenshot was visually inspected.
- Final high-speed check: at 4x, the minute-40 goal reached the goal line and triggered impact by minute 41 with zero browser errors; unfinished buildup fast-forwards into the final shot from the live ball position.
- Full verification: ESLint and TypeScript clean; 46 test files / 426 tests passed; production/PWA build and bundle budgets passed; two-season production audit completed 100 advances with zero data issues or runtime errors across all audited routes.
- Final timing refinement: directed attacks now hold possession before the shot and release the final attempt only when the event is revealed, so goals and saves never arrive at the goal line early. The deterministic preview was rechecked in-browser with no console errors.

## Remaining Ideas

- Add a dedicated extra-time break and penalty-shootout choreography in a later animation phase.
- Consider optional crowd/audio feedback with a muted default and reduced-motion support; keep it separate from match result logic.

## 2026-07-16 Follow-up Optimization Pass

- Scope requested: complete the remaining data-trust, mobile-overlay, animation-timing, visual-fidelity, accessibility, and maintainability improvements, then verify the whole project.
- Confirmed production findings: pre-match prediction and betting odds use different models from the simulator; away-upset news prints a home/away score after a winner-first team name; mobile match detail/live overlays sit below Dashboard's sticky header; small star controls miss the 44px touch target.
- Animation goals: fixed 60Hz simulation independent of display refresh rate, DPR-aware canvas backing, real keeper/defender response, misses crossing the end line, stable event identity, extra-time/shootout choreography, reduced-motion support, and optional muted-by-default audio cues.
- Verification required before checklist completion: focused unit/component tests, full lint/type/test/build/bundle checks, deterministic animation client, screenshot inspection, and desktop/mobile production-style browser flows.

### Implementation status

- Shared deterministic strength/xG/Poisson forecast now drives simulation snapshots, every prediction surface, betting odds, and probability-based upset labels. Away-winner news scores are winner-relative.
- Match detail/live views now use body portals above sticky controls, lock body scroll, support Escape, and expose larger mobile targets. The optional floating advance control is a bounded semantic button and stays off the Dashboard route.
- Pitch playback now uses a fixed 60Hz accumulator, DPR-aware backing buffer, deterministic `window.advanceTime(ms)`, unique event ordinals, event-player labels, defensive save/block movement, end-line misses, penalty set pieces, reduced motion, and muted-by-default audio cues.
- Live playback now pauses at halftime, regulation-to-extra-time, and extra-time-to-shootout boundaries; shootout scores are tracked separately from the match score.
- Focused forecast, simulator, event-scene, post-match, and playback tests pass.

### Final verification

- Completed Node 24 TypeScript, ESLint, all `433` Vitest tests, production/PWA build, and bundle budget checks. Main entry remains `268,298` bytes and within budget.
- Production-preview current-schema audit passed one full season (`52` advances) with `0 errors / 0 warnings`; `18` mobile routes and `7` desktop routes passed overflow, clipping, target-size, runtime, persistence, history-navigation, deep-link, and offline checks.
- Added and passed `pnpm verify:match` at `1440x900@2` and `390x844@3`: pitch buffers reached full device pixel ratio, pixel probes were nonblank, deterministic stepping moved the ball, overlay z-index exceeded sticky controls, mobile buttons met 44px, Escape closed the dialog, and console/page errors were empty.
- Inspected `/tmp/football-match-live-desktop.png` and `/tmp/football-match-live-mobile.png`; pitch framing, player/ball visibility, scoreboard, progress, and controls were coherent with no overlap or cropping.
- No remaining items in the 2026-07-16 optimization checklist.

## 2026-07-16 Mobile Advance P0

- User requested the first P0 from Section 15: make mobile window advance responsive without changing simulation semantics or historical data structures.
- Measured baseline already recorded in the durable checklist: 4x CPU advance p95 about 99.7 ms, JSON serialization p95 about 49.9 ms, and delayed main-thread LZ compression caused a worst observed 2.47 s timer gap.
- Implementation plan: move JSON serialization plus LZ compression to a revisioned Worker, retain synchronous lifecycle fallback, yield one paint before simulation, reject duplicate advances, collapse transient persistence writes, and add a repeatable mobile performance harness.
- Verification required before checklist completion: focused persistence/action tests, full lint/type/test/build, browser reload/page-hide/rapid-input flows, normal and 4x CPU traces, required web-game client run, and screenshot inspection.
- Implemented a revisioned compression Worker that receives the persisted object and performs both JSON serialization and LZ compression off the main thread. Stale replies are ignored; Worker/postMessage failures, page hide, visibility hide, and unload synchronously commit the newest queued revision.
- The current-save PersistStorage now shallow-deduplicates equivalent persisted fields, so transient `isAdvancing` updates do not queue a full save. Import/export and current-schema validation remain on the existing readable JSON boundary.
- Single, batch, and target advances now reject concurrent calls and yield a full painted frame before synchronous engine work. Automatic storage trimming is folded into the final atomic world/result/news commit.
- Added focused stale-revision, Worker-failure, in-flight pagehide, and duplicate-advance tests. TypeScript, touched-file ESLint, and 18 focused persistence/advance tests pass under Node 22.
- Added `pnpm audit:advance-performance` for repeatable 390x844@3 normal/4x CPU timing, feedback, long-task, timer-gap, rapid-input, and reload-durability checks.
- Final production performance audit passed: normal p50/p95 18.1/27.4 ms, 4x CPU p50/p95 30.1/55.0 ms, max main-thread long task 60 ms, max timer gap 66.3 ms, and feedback visible on the first frame in every sample.
- Main-thread postMessage/structured-clone peaked at 20.9 ms; Worker serialization peaked at 5.4 ms and Worker compression at 233 ms. The former main-thread compression stall is no longer present.
- Twenty concurrent advance attempts executed exactly one window and the resulting index survived persistence plus reload. Pagehide, visibility hide, Worker failure, stale reply, and quota paths have focused coverage.
- Full verification: 49 files / 438 tests, repository lint, TypeScript, production/PWA build and bundle budget, two-season/100-advance current browser audit with 0 data issues and 0 runtime errors, match-presentation verification, required web-game client, and inspected 390x844 before/after screenshots with zero console messages.

## 2026-07-16 Long-Save P1

- User requested the next remaining block from Section 15: control save work and size through measured S1/S50/S100/S150 budgets, safe duplicate removal, explicit cleanup, warning UX, and long-save round trips.
- Important review finding: the existing private `trimStorage` path silently truncated completed match events, which could undermine event-derived validation if it ever triggered. P1 will separate automatic metadata bounds from an explicit user-confirmed detail archive.
- Forecast snapshots are small and are frozen pre-match evidence used by odds/upset/history views, not reconstructible display caches; they should remain canonical unless measurement proves otherwise.
- Completed deterministic S1/S50/S100/S150 raw/compressed reporting and a browser-backed long-save audit. Strictly bounding display news to the latest 200 entries reduced S150 from the earlier 3.88 MB diagnostic to 1.69 MB without touching canonical results or aggregates.
- Removed duplicated persisted `lastResults`/`lastNews`; hydration reconstructs them from the latest completed calendar window and the bounded news log. Explicit cleanup now archives only completed-result events/replay and matchday snapshots after confirmation, while scorelines, technical stats, player/club totals, finances, transfers, awards, trophies, predictions, and season records remain intact.
- S150 cleanup evidence: 446 results, 8,072 events, and 892 matchday snapshots archived; raw size 14,958,987 -> 11,397,801 bytes and compressed size 1,685,654 -> 1,314,650 bytes. Automated comparison proves all non-replay world fields and the next seeded window remain identical.
- Added a 4 MiB non-blocking capacity warning and Settings size/cleanup UX. Mobile browser checks confirmed the warning, dismiss/link behavior, cleanup confirmation/result, no overflow, and no console errors.
- The first long audit exposed false cross-season availability warnings: validation treated prior-season ordinary injuries and suspensions as active even though offseason reset clears them. Validation now scopes ordinary injuries/suspensions to their originating season while allowing long-term injuries to carry; focused S50 and final S150 checks are 0 errors / 0 warnings.
- Final long audit: 7,870 advances through 150 completed seasons, every rollover at 0/0, all history caps respected, and S1/S50/S100/S150 actual browser writes, reload digests, and next-window digests matched exactly. Actual compressed writes were 580,466 / 1,467,284 / 1,575,014 / 1,685,654 bytes.
- Final regression evidence: 50 files / 444 tests, full ESLint, TypeScript, production/PWA build, bundle budgets, 10-season current browser audit, required web-game client screenshot/text inspection, and mobile performance audit all pass. Normal/4x CPU advance p95 measured 26.6/57.0 ms with a 66 ms maximum long task and 86 ms maximum timer gap.

## 2026-07-16 Animation Rendering Guardrails

- Started the next Section 15 block; historical representation P2 remains intentionally deferred because the measured S150 save is only 1.69 MB.
- Initial audit: PitchCanvas already used a fixed 60Hz simulation and a long-lived prop ref, but mobile DPR reached 3, particle capacity was always 350, and rAF kept drawing while playback was paused, at a break, completed, hidden, or scrolled out of view.
- Added a pure render-budget policy: constrained/mobile devices cap at DPR 2 and 180 particles; reduced motion uses DPR 1.5, 60 particles, and 4fps; four sustained slow frames or measured rolling pressure degrades normal rendering to DPR 1.5, 100 particles, and 30fps.
- Pitch playback now stops its render scheduler when hidden, outside the canvas viewport, manually paused, at a match break, or completed; one static frame preserves the visible paused/break/final state. The match clock also pauses while the document is hidden.
- Focused render-budget, playback visibility, event-scene, physics, and result-control tests pass (21 tests). Match detail and live replay are now separate semantic controls, eliminating the prior nested replay-label ambiguity.
- `pnpm audit:animation-performance` passes at 390x844@3 under normal and 4x CPU profiles. Average Canvas draw time measured 0.19/0.81 ms, maximum consecutive slow frames was 1 in both profiles, particle count stayed within budget, and hidden/covered/closed/rapid-reopen/consecutive-batch/final-score checks all passed with no runtime errors.
- `pnpm verify:match` passes desktop, mobile, and mobile reduced-motion profiles. Effective DPR is capped at 2/2/1.5, particle caps are 350/180/60, deterministic ball movement remains intact, and paused/completed playback adds zero Canvas frames. All three screenshots were inspected and are coherent without overlap or clipping.
- The required deterministic game client completed two iterations. Text state and inspected screenshots covered a miss, goal, halftime pause, player positions, ball movement, and pressure-triggered degraded rendering without losing essential cues.
- Final regression: 51 files / 449 tests, full ESLint, TypeScript, production/PWA build, bundle budgets (269,427-byte main entry; 668,292-byte initial graph), and the 10-season/520-advance current browser audit pass. Every season is 0 errors / 0 warnings; all 18 mobile and 7 desktop routes pass layout, target-size, persistence, navigation, offline, and runtime checks.
- Section 15 animation guardrails are complete. Historical representation P2 remains intentionally inactive because the measured S150 browser write is 1.69 MB and lifecycle durability/responsiveness budgets pass.

## 2026-07-16 Playability And Team-Name Readability

- User asked for the next playability opportunities and reported that ellipsized team names are less useful than explicit abbreviations.
- Added a compact `TeamName` mode and applied the same rule across dense matchday, result, calendar, league, cup, comparison, transfer, season-review, chronicle, settings, and legends surfaces: show the complete `shortName`, retain the full name in the title/accessibility text, and reserve full names for wider/detail contexts.
- Added focused component coverage for compact versus full labels. TypeScript, touched-file ESLint, and 13 focused TeamName/playback tests pass.
- Inspected 390x844 Dashboard and expanded Calendar screens in the local browser. Sampled labels including 山东泰山/直隶胜利/岛津众城 rendered as 泰山/直隶/岛津 with no overflow or clipping; no production `team.name`/`getTeamName` truncation combination remains.
- Required deterministic game client completed two iterations after the UI change; text state and inspected screenshots retained normal player, ball, possession, and goal behavior with no error artifact.
- Suggested next playability priorities: a favorite-team season objective layer with explicit progress/rewards, richer pre-advance decision tradeoffs around the existing God Hand/transfer/betting systems, and a compact post-window consequence summary that connects each decision to standings, finance, morale, and player development.
- Final verification: 52 files / 451 tests, full ESLint, TypeScript production/PWA build, and bundle budgets pass. The 10-season/520-advance browser audit remains 0 errors / 0 warnings; all 18 mobile and 7 desktop routes report no horizontal overflow, clipped labels, undersized primary targets, or runtime errors.

## 2026-07-16 Contextual Transfer AI Phase 1

- User requirement: preserve mobile performance and all UUID-based history while making transfers contextual and believable. Randomness remains seeded, but only operates after hard plausibility constraints and multi-factor scoring.
- [x] Added a shared pure transfer-decision layer for positional shortage/quality, upgrade value, age/potential, current-season performance, coach-style fit, club reputation reach, seller leverage, market value, financial urgency, and reserved budget.
- [x] Automatic elite buyers now require a real same-position upgrade and sufficient transfer budget, then use weighted seeded selection rather than a uniform random club. Favorite teams never auto-buy behind the player's back.
- [x] Automatic sellers now evaluate market-value-anchored offers with a continuous acceptance curve. Implausible bids below half the asking value have zero chance; loyal/ambitious tags, seller finances, player importance, and buyer need remain meaningful.
- [x] Favorite-team target lists now reflect each club's own squad needs, tactics, affordability, and buyer valuation. Multi-favorite cards show the correct destination club and budget; free agents can be assigned to a selected favorite team.
- [x] Player bids and counters use contextual continuous probabilities instead of fixed 40%/60% rolls. Staged offers that become unaffordable are withdrawn instead of overdrawing the buyer.
- [x] Free-agent signing premiums now scale with market value and age instead of a universal EUR5M, closing the obvious high-rating free-agent exploit.
- [x] Transfer-window UI exposes age, market value, interest reason, club budget, suggested value, and live acceptance probability without changing canonical transfer-history records.
- Historical compatibility: player UUIDs, stat ownership, transfer records, finance records, and save schema remain intact. New in-progress window context fields are optional for older current-schema saves.
- Performance architecture: squad/coach/finance profiles are computed once at season-end; player bid probabilities run only on interaction. No new work was added to match simulation or ordinary advance hot paths.
- Validation found and fixed a one-decimal finance-audit false positive (`77.6` versus `77.60000000000001`) after dynamic fees; the ledger itself was correct.
- Final verification: 53 files / 462 tests, full ESLint, TypeScript, production/PWA build, and bundle budgets pass. Main entry is 269,612 bytes; initial graph is 675,253 bytes.
- Ten-season production-browser audit completed 520 advances with 0 errors / 0 warnings, no runtime or route failures, and successful persistence, deep-link, back-navigation, and offline checks.
- Twenty-season engine sample completed in about 2.6 seconds: 25 ordinary paid market transfers (median EUR10.8M, max EUR82.4M) plus 2 pre-existing 200%-premium fire sales; no data-validation issues occurred.
- Mobile transfer-window inspection at 390x844 confirmed per-team budgets, dynamic fees, 0% probability for a EUR1M absurd bid, no horizontal overflow, and no console errors. Required deterministic game client completed two iterations and its latest screenshot/state were inspected.
- Mobile advance audit remains healthy: normal p50/p95 18.8/22.4ms, 4x CPU p50/p95 30.3/44.6ms, max long task 52ms, max timer gap 67.6ms, and 20 concurrent attempts still execute/persist exactly one advance.

### Deferred Transfer Realism

- [x] Interactive transfers now release the buyer's displaced fringe player to the free market; the seller keeps the fee and must solve its own replacement need.
- [ ] Replace the mandatory exchange player in fire sales with independent buyer release and seller replacement decisions.
- [ ] Add optional contracts, wages, squad role, playing-time satisfaction, transfer requests, loans, and Bosman/free-transfer lifecycle in a separate schema phase.
- [x] Add lightweight stable recruitment identities (youth, star, value, balanced) derived from club identity without adding save-schema or hot-path cost.

## 2026-07-16 Transfer Playability Follow-up

- Added stable club recruitment profiles as a secondary transfer-fit signal. Positional need, upgrade quality, affordability, reputation reach, and seller intent remain the primary realism constraints; seeded randomness still prevents identical decisions.
- Interactive transfers no longer force the buyer's weakest same-position player onto the seller. The displaced player becomes a free agent, the buyer keeps its squad size, and the seller receives only the negotiated fee and carries the resulting squad vacancy.
- Protected ordinary sellers at the 18-player playable floor and exposed the post-transfer squad count plus likely buyer release directly in the market UI before a bid.
- Free-market releases now have explicit transfer history/news semantics. Current-season stats for released free agents remain valid, and finance-history validation normalizes floating-point values before comparison.
- Browser transaction verification confirmed an accepted EUR15.4M move, buyer squad delta 0, seller squad delta -1, free-agent-pool delta +1, exact buyer/seller cash deltas, and 0 validation issues after serialization.
- Final verification: 53 files / 465 tests, full ESLint, TypeScript production/PWA build, and bundle budgets pass (269,612-byte main entry; 676,093-byte initial graph).
- Ten-season production audit completed 520 advances with 0 errors / 0 warnings; all audited mobile/desktop routes passed overflow, clipping, touch-target, persistence, navigation, offline, and runtime checks.
- The required deterministic game client completed two iterations; state and the final screenshot were inspected with coherent player/ball/save rendering and no error artifact.
- Fire-sale exchange removal and contracts/wages/loans remain intentionally deferred; this pass adds playability without a save-schema expansion.

## 2026-07-17 Lightweight Team Stories

- User requested more personality and fun in club histories without adding a complex narrative system.
- Added a pure, display-only team-story selector. It derives each club's current chapter from real standings, form, consecutive titles, promotion/relegation, finances, expectations, and recent OVR movement; no random claims or persisted story state were introduced.
- Team detail now combines up to four recent turning points from trophies, league transitions, memorable matches, coach changes, and transfers. Entries link back to the existing chronicle, match, coach, or player history surface.
- Added a recent focus-opponent summary computed from actual archived and current matches. Frequency, close scores, finals, memorable matches, and competitive balance determine the opponent; W/D/L, aggregate score, and latest result are team-relative.
- Performance remains isolated to opening one team-detail page. Season simulation, advance work, save schema, and storage growth are unchanged.
- Focused tests cover dynasty, champion-in-financial-danger, varied timeline composition, and rivalry scoring/team-relative records.
- Final verification: 54 files / 469 tests, full ESLint, TypeScript production/PWA build, and bundle budgets pass. Main entry remains 269,615 bytes; initial graph is 676,096 bytes.
- A real browser advanced 60 windows into S2 and inspected Guangzhou Hengda at 390x844@3 and 1440x900. The panel derived current form/finance, two real memorable losses, and a seven-match Beijing rivalry; both layouts had zero body/panel overflow and zero runtime errors.
- The required deterministic game client completed two iterations; state and final screenshot were inspected with coherent player, ball, and save rendering and no error artifact.

## 2026-07-17 UI Polish Phase 1

- User requested the first implementation phase from `docs/ui-polish-checklist.md`, followed by direct commit and push.
- Scope: mobile navigation overlay behavior, mobile cup-bracket readability, mobile league-column semantics, History header wrapping, and lazy-route loading presentation.
- Added a focused mobile drawer component with modal semantics, background scroll lock, Escape close, focus containment, and focus return. The overlay now sits above every sticky header/action.
- Mobile cup brackets now show one selected round at a time and render that round as a full-width one/two-column list with explicit team abbreviations. Desktop brackets remain unchanged.
- Mobile League standings now show `赛/胜/平/负/净/分`, hide the unmatched form header and goals-against column, and suppress zero-match attacking superlatives.
- History tabs stack below the title on narrow screens with 44px targets. Lazy routes now use a layout-shaped, reduced-motion-aware skeleton instead of a `50vh` black loading panel.
- Browser inspection passed at `320x568`, `390x844`, `430x932`, and `1440x900`: the drawer covered sticky controls and restored focus, cup matchups used 167px two-column cards without label overflow, League mobile headers/cells matched 8-to-8, History tabs measured 44px, and the loading skeleton was visibly rendered. Browser console errors/warnings were empty.
- Final verification passed: 57 files / 474 tests, full ESLint, TypeScript, production/PWA build, and bundle budgets (271,545-byte main entry; 678,026-byte initial graph). Match presentation passed desktop, mobile, and reduced-motion rendering checks, and the required game client produced no error artifact.
- `audit:current` was attempted with ten and two seasons but stalled in its browser-wait phase without producing a report; it was not counted as passed. The phase-specific browser matrix and stable match harness completed successfully.

## 2026-07-18 UI Polish Phase 2

- Established the night-broadcast visual foundation with explicit page, panel, raised, and floating surfaces; primary/secondary/muted text; grass action, status, trophy-gold, and team-identity tokens. Existing CSS variables remain as compatibility aliases while pages migrate.
- Added lightweight shared `PageShell`, `PageHeader`, `SectionHeader`, `Panel`, `SegmentedControl`, `StatusBadge`, `EmptyState`, and `LoadingSkeleton` primitives. Mobile segmented controls have a stable 44px interaction height; desktop controls compact to 36px.
- Migrated League, Teams, Players, History, and Transfers to the common page hierarchy and green action selection. League and Player tables use the shared 8px panel treatment; transfer empty/season states and lazy-route skeletons now use the common primitives.
- Added `verify:ui-foundation`, which creates a deterministic local game and verifies all five migrated routes at 320x568, 390x844, and 1440x900. All 15 route/viewport combinations had zero page overflow, valid title sizing, working selected-tab state, expected mobile target size, and no runtime console errors.
- A separate 125% root-text check kept Chinese team names and controls readable with zero page overflow. Representative screenshots for compact mobile, regular mobile, large text, and desktop were inspected.
- Final verification passed: 58 files / 477 tests, full ESLint, TypeScript and production/PWA build, bundle budgets (270,994-byte main entry; 680,682-byte initial graph), and desktop/mobile/reduced-motion match-presentation checks.
- Remaining checklist work is intentionally still visible: global 8-10px label cleanup, remaining numeric typography, old large-radius cards, horizontal-tab edge affordances, and the next page-specific hierarchy phases.

## 2026-07-18 Floating Advance Hotfix

- Reproduced the optional floating advance control at 390x844 and 1440x900. The old 56px circle overloaded one surface with both drag and advance, used a 10px/8px stacked label, defaulted near the bottom with no visible movement affordance, ignored visual-viewport offsets and safe areas, and could be dragged over important text without edge snapping.
- Replaced it with a compact 8px-radius two-part control: a dedicated 44x48 move handle and an 85x48 one-click advance action. The action uses the shared grass token and play icon; the small current-window dot remains a secondary stage cue.
- Default placement now respects right/bottom safe-area insets. Pointer movement clamps against `visualViewport`, survives viewport/browser-chrome changes, and snaps to the nearest horizontal edge. Arrow keys move the control in 12px steps and Home returns it to the safe default dock.
- Focused tests cover viewport clamping, visual-viewport offsets, separated move/action behavior, keyboard movement, and reset. Real mobile/desktop browser checks confirmed 8px radius, valid touch sizes, 12px/16px default margins, left-edge snapping, zero drag-triggered advances, exactly one window advance per action click, and zero console errors.
- Final verification passed: 60 files / 481 tests, full ESLint, TypeScript and production/PWA build, and bundle budgets (273,073-byte main entry; 682,761-byte initial graph). Default and dragged mobile screenshots plus the desktop screenshot were inspected; the required game client completed two iterations without an error artifact.

## 2026-07-18 UI Polish Phase 3

- Removed the Dashboard-local current-window badge and advance button. The global header is now the sole authoritative advance action and uses the clearer `开始模拟` label on the Dashboard route.
- Kept favorite-team summaries at the top, moved storyline/transfer-rumor panels into `总览`, and placed the tab row directly before matchday focus content. At 390x844, three favorites, the global advance action, tabs, and both focus matches all remain in the first viewport.
- Focus fixtures are excluded from secondary matchup notices. Remaining notices are ranked, deduplicated per fixture, and capped at two, so `争冠焦点`/`强强对话` messages no longer repeat the same featured match.
- Favorite-team results render immediately in a dedicated `我的球队本轮赛果` section above the general sequence. Ordinary results reveal in bounded batches: 6, 12, and 48-result tests complete their reveal in 960ms, 960ms, and 1000ms; derbies, upsets, finals, extra time, and other important results retain 400-600ms sequential pauses.
- The skip-animation control now has a 44px mobile target. A new `verify:dashboard` production-browser workflow checks one primary action, first-viewport hierarchy, notice cap, pinned favorite results, skip behavior, complete result counts, and console errors at 390x844 and 1440x900.
- Final verification passed: 61 files / 487 tests, full ESLint, TypeScript and production/PWA build, and bundle budgets (273,050-byte main entry; 682,738-byte initial graph). Desktop/mobile/reduced-motion match presentation and mobile animation performance passed.
- Production mobile advance performance remains healthy: normal p50/p95 18/20.7ms, 4x CPU p50/p95 29/44.5ms, max long task 52ms, max timer gap 67.1ms, and 20 rapid attempts still execute/persist exactly one advance. A development-server run was correctly rejected as non-production noise and was not counted.
- The required game client completed two iterations without an error artifact; its latest ambient-canvas screenshot was inspected. No simulation, persistence, or historical-data semantics changed in this phase.

## 2026-07-19 UI Polish Phase 4

- Reworked Player Detail around the player position: forwards, midfielders, defenders, and goalkeepers now receive four relevant headline metrics. The position-performance interpretation precedes the compact efficiency strip, while rankings remain hidden until three appearances provide a meaningful sample.
- Replaced the season-start zero-metric wall with one compact empty state. Player Center rows now expose the whole row as a keyboard/touch navigation target, while team links remain independently usable.
- Shared scrollable segmented controls now use scroll snap, directional edge fades, resize-aware overflow state, and automatic active-tab reveal. Player Center's eight tabs remain discoverable at 320px and 390px.
- Team Center now renders compact grouped directories instead of one framed card per club. Full team names wrap naturally, and league, tier, OVR, coach, form, and trophy count remain available.
- Team Detail now separates `概览 / 阵容 / 历史`. Overview merges ability and live state into one club data surface; Squad brings injuries, lineup boosts, and the roster forward; History owns trophies, coach changes, season records, and trend data. Empty story/rivalry content collapses to one quiet line.
- Squad rows are complete player links with flexible names and a second mobile stat line. Browser measurements were 58.5px on mobile and 56px on desktop; Team Center rows measured 65.5-85.5px.
- Added focused metric and segmented-control interaction tests plus `verify:player-team`. Production-browser verification passed at 320x568, 390x844, and 1440x900 with active tabs visible, one season-start empty state, four live headline metrics after one advance, complete names, zero page overflow, and zero runtime errors.
- Final verification passed 63 files / 493 tests, ESLint, TypeScript and production/PWA build, bundle budgets (273,051-byte main entry; 683,405-byte initial graph), shared UI and match-presentation matrices. Production mobile advance remained healthy at 18/20.7ms p50/p95 normally and 28.5/39.6ms under 4x CPU, with no long tasks and exactly one accepted/persisted rapid advance.
- The standard game client completed two iterations; the Welcome screen and ambient canvas screenshots were inspected without an error artifact. Simulation, persistence, historical-data, and save-schema behavior were not changed.

## 2026-07-20 Club Identity And Long-Term Competitions

- Replaced the saturated squad-boost sum with weighted 4-3-3 unit quality, one-decimal output, and a visible full-strength versus injury/suspension loss report. Prediction and simulation share the same availability-adjusted result.
- Added a derived five-season club coefficient with recency weights and a complete History leaderboard. Reputation/overall only break ties before enough results exist.
- Continental cups now run in S2/S6/S10..., use regional coefficient qualification, field 8 Mainland and 4 Southern/Eastern clubs, and complete in three calendar windows. Draw news reports qualification context instead of every fixture.
- Added shared news curation for priority, deduplication, favorite-team relevance, and headline/notable/brief presentation without changing the persisted news schema.
- Added typed in-game release notes, bumped to v4.8.0, and added changelog/package/app-version consistency verification.
- A ten-season audit exposed a real season-end bug: youth replacements and returning free agents could enter a World Cup tail without player stat rows. The canonical stat sync now creates missing zero rows and club segments before those matches.
- Final evidence: 65 files / 504 tests, ESLint, TypeScript, production/PWA build, bundle/changelog checks, 509-advance S10 audit at 0 errors/warnings, and mobile/desktop browser workflow verification all pass. Required game client screenshots were inspected with no error artifact.

## 2026-07-20 v4.8.1 Independent Follow-up Audit

- Removed the low-priority Chronicle/Legends responsibility rewrite, transfer-page wording pass, and Welcome first-run redesign from the UI roadmap without removing or dropping regression coverage for the existing routes.
- Four independent read-only audits reviewed squad boosts/history, continental cups/coefficient, news/changelog, and desktop/mobile UX. Legacy pre-v4.8 cup migration was explicitly excluded per product direction.
- Fixed the current-version findings: balanced matchday selection, available-first emergency lineups, non-beneficial vacancy strength, pre-aging player-history snapshots, custom-region empty cup windows, continental multi-crown counts, season-end news return/priority, favorite short-name relevance, mobile History tabs, ticker keyboard access, and metadata contrast/wording.
- Released the fixes as v4.8.1 and added the changelog consistency command to CI.
- Verification passed 66 files / 514 tests, ESLint, TypeScript, production/PWA build, changelog consistency, and bundle budgets (274,691-byte main entry; 687,732-byte initial graph). A fresh fixed-seed engine audit completed 509 advances through S10 with S2/S6/S10 continental windows and 0 errors / 0 warnings. A focused World Cup-season test confirms tournament stats and champion news refresh without overwriting pre-aging identity. Browser workflow verification passed at 320x568, 390x844, and 1440x900 with no overflow or runtime errors; representative screenshots were inspected.

### Remaining Ideas

- The optional custom visual asset system remains open in `docs/ui-polish-checklist.md`; the low-priority Chronicle/Legends responsibility rewrite, transfer-page wording pass, and Welcome first-run redesign were removed from the roadmap on 2026-07-20.
- Fire-sale exchange independence and contracts/wages/loans remain intentionally deferred; neither is required for the current data-consistent gameplay loop.

## 2026-07-22 Contest UI Polish

- Established a contest-facing night-broadcast thesis without changing simulation, persistence, or historical data semantics.
- Replaced the single-template club shield with deterministic club-ID visuals: six frames, four field patterns, and twelve center symbols. Abbreviations remain visible and every crest has an accessible full-name label.
- Added custom competition marks for all three leagues and six cup identities, seven mapped trophy forms, champion/promotion/relegation marks, and seven match-story stamps for derbies, finals, penalties, upsets, comebacks, late winners, and high-scoring games.
- Applied the identity system to Dashboard focus fixtures, ordinary fixture/result cards, League standings, Cup brackets, and the Team Detail club banner/trophy cabinet.
- Replaced the desktop cup tree's season-start blank space with a responsive round explorer. Mobile keeps readable abbreviations; desktop uses full club names and four-column match grids.
- Removed remaining 8-10px HTML labels from the five core surfaces, added keyboard activation to clickable fixture cards, and added a global reduced-motion fallback.
- Final verification passed 68 files / 519 tests, ESLint, TypeScript and production/PWA build, changelog consistency, and bundle budgets (274,592-byte main entry; 698,303-byte initial graph). Shared UI, Dashboard, player/team, and match workflows passed at 320x568, 390x844, and 1440x900 with zero overflow/runtime errors; representative screenshots were inspected and the desktop Cup layout was corrected from that evidence.
- Mobile advance remained responsive at 12.3/20.9ms normal p50/p95 and 30.9/39.1ms under 4x CPU, with one accepted/persisted action from 20 rapid attempts. Match rendering passed normal/4x profiles, hidden and covered views paused, reduced motion downgraded correctly, and the standard game client completed two iterations without an error artifact.
