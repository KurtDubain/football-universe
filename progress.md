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
