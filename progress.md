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
