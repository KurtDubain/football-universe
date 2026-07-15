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
