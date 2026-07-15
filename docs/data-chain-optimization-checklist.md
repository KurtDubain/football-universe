# Data Chain Optimization Checklist

Created: 2026-07-08

This document tracks the data-chain issues found during the initial project review. The goal is to keep a durable checklist for follow-up work, especially around player stats, team/player page consistency, season boundaries, transfers, and review pages.

## Progress Log

- 2026-07-09: Added `validateWorldData(world)` and validation tests for missing/orphan/mismatched player stats, scoreline/event mismatches, and impossible aggregate stats. Fixed fresh-world squad generation to use final/custom teams. Verified with full Vitest suite under Node 24 and TypeScript build.
- 2026-07-10: Added shared player-stat display selectors, switched Player Center, Team Detail roster, Advanced Search, Player Detail ranking, and Season Review to the shared read model. Season Review now reads frozen season-history rows instead of reset current stats. Season-end snapshots now store frozen player/team display identity. Verified with TypeScript, targeted tests, full Vitest suite, and production build under Node 24.
- 2026-07-10: Balanced manual transfer-window actions: accepted offers and outgoing bids now move the target player and send the buyer's weakest same-position player back as a replacement, preserving squad size/position shape. Manual transfer records and free-agent signings now use `transferWindow.season`; transfer action randomness and auto-window news ids are deterministic. Verified with transfer action tests, full Vitest suite, and production build under Node 24.
- 2026-07-10: Expanded Player Center with creator, defender, and goalkeeper rankings backed by shared selectors. Added Node `>=22` guard via `package.json` and `.nvmrc`, and updated README React/version roadmap drift. Verified with TypeScript, targeted tests, full Vitest suite, and production build under Node 24.
- 2026-07-10: Introduced current-season club-specific player stat segments keyed by `(playerId, teamId)`, with v23 save migration from legacy totals. `playerStats` remains the player-wide season total that follows the player after transfer; team pages, league top-scorer rows, dashboard fixture cards, and Player Detail contribution/split views now read club contribution where appropriate. Verified with TypeScript, targeted tests, full Vitest suite, and production build under Node 24.
- 2026-07-11: Unified stat semantics for `goal`, `assist`, `own_goal`, and shootout-only `penalty_goal`; MotM, player highlights, post-match stories, player stats, and validation now share the same rule. Added event semantic validation for non-fixture teams, shootout events inside match time, regular events after 120', and GK/DF position mismatches. Career totals for retired players now derive from finished-season history plus the current retiring season, and just-retired players are snapshotted into season history even after leaving squads. Added a multi-season validation smoke test. Verified with TypeScript, full Vitest suite, and production build under Node 24.
- 2026-07-11: Expanded frozen player-season history with league level, final rank, goals for/against, and points; Player Detail now displays that historical team context. Player Center now includes career scorer/assist tabs backed by shared selectors that resolve active, retired, and history-only identities. `validateWorldData` now warns on event-player team mismatches and injury-history unavailable players appearing in match events. Verified with TypeScript, targeted selector/validation/season tests, full Vitest suite, and production build under Node 24.
- 2026-07-11: Tightened match event generation so simulator calls use the filtered matchday squad for goals, assists, cards, misses, saves, shootouts, and deny-pipeline credits. `validateWorldData` now warns when active event players or denied attackers are not in the fixture matchday squad. Verified with TypeScript and targeted simulator/validation/deny-pipeline tests under Node 24.
- 2026-07-11: Added event-derived stat audits in `validateWorldData`: completed match events now explain `goals`, `assists`, `saves`, `keyBlocks`, `bigChances`, and `keyPasses` in both player-wide current-season totals and club-specific segments. Verified with TypeScript and targeted validation/stat/deny/simulator tests under Node 24.
- 2026-07-11: Fixed manual transfer-window finance attribution for already-archived transfer seasons: cash still moves immediately, but archived season `transferIncome` / `transferExpense` and `endCash` are updated instead of polluting the new season's running totals. Manual accepted offers, outgoing bids, replacement signings, and free-agent signings now emit deterministic transfer news. `validateWorldData` now audits latest transfer destination, free-agent/retired/active overlap, archived transfer finance coverage, and manual transfer-news links. Verified with TypeScript and targeted transfer/validation/finance tests under Node 24.
- 2026-07-11: Clarified user-facing stat scopes across Player Center, Player Detail, Team Detail, and Advanced Search. Player totals are labeled as current-season all-competition data, club contribution is labeled separately, and the defender score explicitly mixes individual all-competition stats with league-only team defensive context. Renamed deny-pipeline counters to `神扑`, `关键封堵`, and `威胁传球`, and added explanatory season-start empty states. Verified with TypeScript, 413 Vitest tests, production build, and desktop/mobile browser checks under Node 24.
- 2026-07-11: Added a shared pure transfer-application pipeline for automatic and manual windows. Automatic poaching, free-agent distribution, contract/wanderer releases, accepted/countered offers, outgoing bids, and manual free-agent signings now share roster mutation, shirt-number allocation, player/team identity updates, current-stat ownership sync, and transfer-record construction. Finance and news remain in their appropriate season-end or interactive orchestration layers. Verified with dedicated pipeline tests, TypeScript, 417 Vitest tests, and production build under Node 24.
- 2026-07-11: Added persisted suspension intervals and matchday-selection diagnostics. World validation now distinguishes invalid injured/suspended event players from explicit emergency-floor exceptions when fewer than 11 players are available, and validates transferred players against their team at the exact season window. Added a development-only data-health panel to Settings with error/warning counts and expandable issue details. Verified with TypeScript, 421 Vitest tests, production build, and desktop/mobile browser checks under Node 24.
- 2026-07-11: Persisted exact home/away matchday snapshots on every new match result, including player positions, emergency-floor status, and available-player counts. Appearance, clean-sheet, club-segment, and post-match injury processing now consume the persisted snapshot instead of recomputing from a potentially changed live squad. `validateWorldData` performs strict appearance/clean-sheet audits only when the current season has complete snapshot coverage, preserving compatibility with legacy saves. Verified with TypeScript, 423 Vitest tests including the multi-season smoke test, and production build under Node 24.
- 2026-07-11: Hardened persisted matchday snapshots with audits for oversized squads, duplicate/unknown players, position drift, emergency-count contradictions, and transfer-window team mismatches. Moved the development data-health panel behind a development-only dynamic import so production neither executes nor bundles the validation UI; verified by inspecting production assets. Verified with TypeScript, 424 Vitest tests, multi-season smoke coverage, production build, and a development lazy-load browser check under Node 24.
- 2026-07-12: Completed a four-agent second-pass audit across match simulation, season/transfer/finance/persistence, cross-page semantics, and the deployed desktop/mobile experience. Fixed injury/suspension window anchoring, discipline segment updates, balanced matchday goalkeeper selection, single-pass roster selection, bid/fire-sale ownership, prediction and season-review history, long-save bounds, reverse stat audits, late-drama wording, reset confirmation, and mobile touch/roster layout. Verified with TypeScript, 428 Vitest tests, production build, a clean development health panel after live play, and a deterministic 35-season/1,832-window stress run with zero validation errors or warnings.
- 2026-07-13: Completed P0 real participation semantics. Every simulated match now persists 11 starters, an explicit bench, deterministic legal substitutions, actual entry/exit minutes, red-card exits, and regulation/extra-time duration. Events, aggregate stats, club segments, injury exposure, season history, career totals, and UI consumers share that snapshot. Only actual participants receive appearances or team clean sheets; starts, substitute appearances, and minutes are audited against both match snapshots and club-segment sums. Verified with 442 full-suite tests, dedicated no-sub/three-sub/red-card/extra-time/unused-bench/no-goalkeeper/transfer tests, production build, and a 10-season/520-window current-schema browser audit at 0 errors / 0 warnings across 18 routes.
- 2026-07-15: Completed P1 live-match and animation timing hardening. `MatchLive` now uses one explicit reducer-driven playback state, `ResultAnimation` owns an idempotent completion lifecycle, and `NewsTicker` tracks stable news identities across replacement and shrink operations. Every playback, halftime, flash, completion, and scroll timer is cleaned up or version-guarded. Verified with 8 fake-timer interaction tests, 450 full-suite tests, TypeScript, targeted lint, production build, and real-browser rapid advance/live replay/pause/skip/switch checks at 0 console errors / 0 warnings.
- 2026-07-15: Completed P1 current-schema-only persistence. Removed the v1-v24 migration chain and its migration-only tests, centralized schema/storage constants, and added strict pre-hydration validation plus malformed/incompatible-save quarantine and a one-time recovery notice. Current saves are covered through real `GameWorld` hydration, debounced/page-hide writes, pending-write replacement, quota failure, standard JSON export/import, and reload round-trip tests. Verified with 416 full-suite tests, TypeScript, targeted lint, production build, and a browser malformed-save recovery check at 0 console errors / 0 warnings. Production persistence source fell by 35,874 bytes, migration-only tests by 23,778 bytes, main JS by 6,168 bytes (928,466 -> 922,298), gzip by about 1.46 KB, and PWA precache by about 5.82 KiB.
- 2026-07-15: Completed Phase 6 static quality cleanup. Removed five obsolete one-off audit/diagnostic scripts superseded by current tests and `audit:current`, deleted dead imports and calculations, replaced empty catches with intentional fallbacks, narrowed the remaining production `any`, preserved seeded cup APIs without unused-parameter findings, and cleared all hook lint findings. Full repository lint fell from 135 errors to zero and is now blocking in CI. Verified with lint, TypeScript, 416 full-suite tests, and production build under Node 24.

## Current Main Concerns

- [x] Player goals, assists, defensive events, and goalkeeper stats may not have one clear source of truth across pages.
- [x] Player Center, Team Detail, Advanced Search, and Season Review may read similar data with different assumptions.
- [x] Transferred players can make current-season stats look like they all belong to the current team.
- [x] Season Review may read `world.playerStats` after new-season reset instead of a frozen previous-season snapshot.
- [x] Defensive players and goalkeepers are underrepresented in UI metrics compared with attackers.
- [x] Custom/sandbox team initialization may still generate squads from default teams in some paths.
- [x] Manual transfer flow does not fully match the automatic transfer pipeline.
- [x] Some random paths use wall-clock time, which weakens reproducibility.

## 1. Source Of Truth And Data Semantics

- [x] Define the canonical meaning of `world.playerStats`: current season live totals only.
- [x] Define the canonical meaning of `world.playerStatsHistory`: immutable historical season snapshots.
- [x] Define whether a player's current-season total follows the player after a transfer.
- [x] Define whether team pages show "player season total" or "contribution for this team".
- [x] Add explicit current-season stat segmentation by season scope + `playerId + teamId` if team-specific contribution is required.
- [x] Separate current-season stats and historical-season stats.
- [x] Separate club-specific stats from player-wide current-season totals.
- [x] Separate career totals from current-season and club-specific stats.
- [x] Define whether league, cup, super cup, extra time, and penalty shootouts count into each stat view.
- [x] Define how own goals are represented: team goal, own-goal stat, or excluded from player scorer tables.
- [x] Document all stat semantics close to the stat update engine.

## 2. Player Stat Accuracy

- [x] Audit event-derived generation of `goals`, `assists`, `saves`, `keyBlocks`, `bigChances`, and `keyPasses`.
- [x] Audit `appearances` and `cleanSheets` against persisted matchday/team context once lineups are stored historically.
- [x] Verify every completed match can explain its scoreline through match events plus explicit own-goal/penalty semantics.
- [x] Verify generated goals and assists are assigned only to players in the fixture matchday squad.
- [x] Verify event players resolve to known players and a plausible fixture-side team association.
- [x] Verify event players are valid active players at the exact match window after mid-season transfers.
- [x] Verify injured players with active injury history are not silently accepted into match events.
- [x] Use matchday-filtered squads for generated events so injured/suspended players are not selected when enough players are available.
- [x] Define and audit emergency-floor exceptions where unavailable players are used because fewer than 11 players are available.
- [x] Verify goalkeeper and defender clean sheets never exceed appearances.
- [x] Verify defensive and goalkeeper events are only assigned to plausible positions unless deliberately allowed.
- [x] Verify `penalty_goal`, regular `goal`, extra-time goal, and shootout penalty handling is consistent.
- [x] Verify own goals do not inflate normal top-scorer tables unless a deliberate rule says so.
- [x] Add audit warnings for invalid stat events instead of silently dropping or misattributing them.

## 3. Cross-Page Consistency

- [x] Centralize stat display selectors for Player Center, Team Detail, Player Detail, Advanced Search, and Season Review.
- [x] Make Player Center resolve players from active squads, retired history, and frozen historical snapshots.
- [x] Avoid rendering `-` for historical or transferred players when a frozen player name is available.
- [x] Ensure Team Detail does not accidentally attribute all transferred-player season totals to the current club.
- [x] Ensure Advanced Search uses the same player-stat selector as Player Center.
- [x] Ensure Player Detail ranking uses the same stat semantics as Player Center.
- [x] Ensure Season Review uses the finished season's frozen data, not the newly reset current-season stats.
- [x] Add page labels such as "season total", "for current club", and "career total" where needed for changed views.
- [x] Add selector tests to prove the same player has the same displayed totals across relevant pages.

## 4. Season Boundary And History

- [x] Freeze player stats before `initializeNewSeason` resets current-season stats.
- [x] Store enough frozen player identity data: name, age, position, rating, teamId, teamName, and season.
- [x] Store enough team context data for historical display: team name, league, final rank, goals for/against.
- [x] Store enough basic team context data for historical display: team name and goals conceded/matches.
- [x] Store full historical team context data: league, final rank, goals for/against.
- [x] Make Season Review read the frozen just-finished-season snapshot.
- [x] Make retired-player career totals read from `playerStatsHistory + current season`, not only current season.
- [x] Ensure transfer-window records use the season of the window, not accidentally the newly initialized season.
- [x] Ensure finance records related to a transfer window are attributed to the intended season.
- [x] Ensure news timeline entries use the same season/window identity as transfer history.
- [x] Add tests covering season rollover, stat snapshotting, reset, and selector-based review data.

## 5. Transfers And Stat Ownership

- [x] Make automatic and manual transfer flows call one shared transfer-application pipeline.
- [x] In manual offer acceptance, match automatic behavior for squad balance, weak-player release, and replacements.
- [x] After manual transfer-window actions, synchronize squad membership, player stat team references, transfer history, and finance.
- [x] Add manual transfer-window news entries or a deliberate no-news policy.
- [x] Do not rewrite old team contribution into the new team if segmented stats are introduced.
- [x] Track transferred-player contribution by club for the same season.
- [x] Keep a clear state for free agents, released players, and retired players.
- [x] Validate squad size after every manual transfer-window action.
- [x] Validate positional balance after every manual transfer-window action.
- [x] Ensure transfer history season equals `transferWindow.season`.
- [x] Remove `Date.now()` from transfer/random news paths to preserve deterministic seed replay.

## 6. Custom Teams And Initialization

- [x] Ensure game-world initialization generates squads from the final team list, not hardcoded default teams.
- [x] Verify `teamBases`, `teamStates`, `squads`, `standings`, and fixtures share the same team ids.
- [x] Add tests for sandbox/custom-team mode initialization.
- [x] Validate that every `playerStats[uuid].teamId` resolves to an existing team.
- [x] Validate that every active squad player has a matching `playerStats` entry.
- [x] Validate that no generated squad exists for a team outside the current world.

## 7. Defensive And Goalkeeper Metrics

- [x] Add Player Center tabs or rankings for defenders and goalkeepers.
- [x] Surface clean sheets, saves, key blocks, and possibly goals prevented for defensive players.
- [x] Surface key passes, big chances, and chance creation for midfielders.
- [x] Make Team Detail roster chips position-aware instead of only goals/assists.
- [x] Make Player Detail position ranking score use position-appropriate metrics.
- [x] Decide whether team defensive context should include only league matches or all competitions.
- [x] Make labels explicit when a defensive score mixes player stats with team standings data.

## 8. UI Labeling And User Trust

- [x] Label all stat blocks clearly: "Current season", "For this club", "Career", or "Last season".
- [x] Show transferred-player split stats where helpful, for example "Team A: 8 goals, Team B: 3 goals".
- [x] For historical rows, display frozen team/player names even when the live object no longer exists.
- [x] Avoid showing zeroed current-season stats inside previous-season review components.
- [x] Add empty/error states that explain when data is unavailable because the season just started.
- [x] Add a lightweight data-health panel for development builds if useful.

## 9. Audit Tools And Tests

- [x] Add `validateWorldData(world)` for local development and test usage.
- [x] Audit orphan player stats: stat exists but player cannot be resolved.
- [x] Audit missing player stats: active player has no stat record.
- [x] Audit team mismatch: active squad team and stat team disagree.
- [x] Audit invalid match events: unknown player and unknown team.
- [x] Audit invalid match events: impossible position.
- [x] Audit invalid match events: implausible player/team association.
- [x] Audit invalid match events: injured player unavailable at match time.
- [x] Audit invalid match events: active event player not in fixture matchday squad.
- [x] Audit invalid match events: suspended/non-injury unavailable player at match time.
- [x] Audit event-derived player stats against completed match events.
- [x] Audit event-derived club stat segments against completed match events.
- [x] Audit score mismatch: match result does not match countable goal events plus explicit exceptions.
- [x] Audit transfer mismatch: transfer history, squad movement, and finance/news do not agree.
- [x] Add tests for regular goal, assist, own goal, penalty goal, shootout penalty, and extra-time goal.
- [x] Add tests for player transfer after season-end transfer window.
- [x] Add tests for player transfer during a season.
- [x] Add tests for retired-player historical display and career totals.
- [x] Add one long-season simulation smoke test that runs multiple seasons and validates invariants.

## 10. Engineering Hygiene

- [x] Add a Node version guard in `package.json` or `.nvmrc`; the README says Node 22+.
- [x] Update README roadmap so implemented transfer/growth/retirement features are not still marked as TODO.
- [x] Keep `pnpm exec tsc -b` passing after each data-chain change.
- [x] Re-run the full test suite after fixing the local Node runtime issue.
- [x] Keep changes small and reviewable: selectors first, data model next, UI labels last.

## 11. Second-Pass Audit (2026-07-12)

### Match And Player Data

- [x] Anchor injury and suspension intervals to the just-played pre-increment global window so a 1-match absence lasts exactly one following match window.
- [x] Add consecutive-window tests proving suspended players are excluded exactly for the declared interval and return on the boundary.
- [x] Synchronize yellow/red discipline counters into current-club stat segments, including suspension-driven resets.
- [x] Ensure one authoritative matchday selection receives the full squad and persists the true `availableCount`.
- [x] Guarantee every non-empty matchday selection contains a goalkeeper when one is available.
- [x] Audit event-derived stats in both directions, including counters that exist without any explaining event.
- [x] Validate normal matchday snapshot size, player ownership without transfer evidence, and partial legacy snapshot coverage.
- [x] Correct validation's result-to-global-window mapping so post-match injuries do not invalidate the match in which they occurred.

### Transfers, Seasons, And Persistence

- [x] Freeze finished-season player identity against the club with the largest actual contribution segment, not an offseason destination.
- [x] Route fiscal fire sales through roster-balancing semantics, synchronize player-stat ownership, and persist the balancing exchange.
- [x] Prevent multiple favorite teams from receiving duplicate targets for the same player and never display a failed second move as accepted.
- [x] Age, rerate, and revalue persistent free agents each offseason; use full career totals when they retire.
- [x] Add v24 migration to repair stale `playerStats.teamId` ownership and initialize durable prediction history.
- [x] Persist season predictions with separate champion/relegation correctness and show them in Dashboard and Season Review after rollover.
- [x] Bound player history globally to 25 completed seasons and remove empty retired-player keys; retain 25 rows per player to cover a plausible full career.
- [x] Apply storage limits to batch/fast-forward paths and retain pending writes after quota failure.
- [x] Surface save-write failures visibly in the UI instead of only logging and silently dropping the queued state.
- [x] Make season-based storage caps retain the latest distinct completed seasons without rollover off-by-one behavior.

### Review Pages And Experience

- [x] Make Season Review read archived season buffs, predictions, and continental results instead of live next-season state.
- [x] Remove the duplicate inferred MVP/newcomer ceremony so official archived player awards remain authoritative.
- [x] Clarify the League scorer column as all-competition club scoring rather than league-only scoring.
- [x] Restrict "绝杀" to a late goal by the final winning side in a one-goal match; label late draw goals "绝平" and do not call 85-90' stoppage time.
- [x] Include continental finals in Player Detail final-goal counts and align its late-winner metric with the same semantics.
- [x] Do not render dead detail links for history-only/stat-only player identities.
- [x] Label position ranking as current-season position performance rather than raw ability.
- [x] Add reset confirmation to the sidebar path as well as Settings.
- [x] Raise mobile navigation/advance/menu controls to 44px touch targets and add accessible names.
- [x] Prevent dense Team Detail stat rows from collapsing or overlapping at 390px and reserve content space when the floating advance button is enabled.
- [x] Use unique development health-panel keys so repeated issue types never generate React reconciliation errors.

### Final Verification

- [x] Full test suite: 38 files, 428 tests passed under Node 24.
- [x] TypeScript project build passed.
- [x] Vite production/PWA build passed.
- [x] Local live play: three windows, development data health `0 errors / 0 warnings`, no console warnings/errors.
- [x] Mobile `390x844`: no page overflow, no roster-row overlap, all header actions at least 44px.
- [x] Deterministic stress run: 35 seasons, 1,832 match-bearing windows, every season and final world at `0 errors / 0 warnings`.

## 12. Current-Schema Reliability Pass (2026-07-13)

Scope: only saves created by the current schema are supported and audited; historical save migration is not part of this acceptance boundary.

- [x] Remove every conditional React Hook call from current routes and controlled match-detail UI.
- [x] Make swipe handlers update outside render and keep celebration particles stable across rerenders.
- [x] Export the current compressed runtime save as readable standard JSON.
- [x] Import only a structurally valid current-schema JSON save and synchronously replace any pending persisted write.
- [x] Replace old-save browser audits with a fixed-seed, current-schema audit using the live store and `validateWorldData`.
- [x] Smoke-test 18 current routes after a long simulation and fail on browser console or page errors.
- [x] Make season-buff news IDs unique by season, team, and buff type.
- [x] Targeted ESLint for all touched runtime and audit files passed.
- [x] Full test suite: 39 files, 431 tests passed under Node 24.
- [x] TypeScript project build and Vite production/PWA build passed.
- [x] Current-schema browser audit: 10 seasons, 520 advances, every rollover at `0 errors / 0 warnings`.
- [x] Route audit: 18/18 routes passed with `0` runtime errors.

## 13. Current-Version Follow-Up Backlog (2026-07-13)

Scope: improve only the current game model and current save schema. Do not preserve or migrate historical save formats. Every checkbox remains open until its implementation and listed acceptance checks have both passed.

### P0: Real Lineups, Substitutions, And Appearance Semantics

Contract: normal matches use 11 starters and up to three deterministic substitutions. Injuries remain post-match exposure outcomes rather than timestamped in-match events, so they do not invent forced substitutions; only actual participants enter the injury roll. A dismissal ends the player's minutes immediately and never permits a replacement. A clean sheet belongs to every GK/DF who actually appeared when the team conceded zero across regulation plus extra time, including a substituted defender; unused bench players receive nothing.

- [x] Define one authoritative match participation model shared by simulation, events, player stats, club segments, validation, and UI.
- [x] Split the current 14-player matchday selection into exactly 11 starters plus an explicit bench when enough players are available.
- [x] Preserve emergency behavior for short squads while guaranteeing a starting goalkeeper whenever an eligible goalkeeper exists.
- [x] Add deterministic substitution decisions, including substitute-in player, substitute-out player, and minute.
- [x] Limit normal substitutions to the configured competition allowance and prevent the same player from entering or leaving twice.
- [x] Define injury/red-card behavior: injuries are post-match outcomes for actual participants; dismissals end minutes immediately, allow no replacement, and reduce the on-field count.
- [x] Ensure goals, assists, saves, blocks, chances, passes, cards, and post-match injury exposure can only be assigned to an actual on-field participant.
- [x] Count an appearance only for starters and substitutes who actually enter the match; unused bench players must remain unchanged.
- [x] Add separate current-season counters for starts, substitute appearances, and minutes played.
- [x] Update club-specific stat segments with the same starts/substitute/minutes counters as the aggregate player row.
- [x] Define clean-sheet credit explicitly and apply it consistently to goalkeepers and defenders who actually appeared; unused substitutes never receive one.
- [x] Give every appearing GK/DF the team clean sheet, including substituted defenders, and surface the regulation-plus-extra-time definition in UI tooltips.
- [x] Ensure transferred players retain correct per-club starts, substitute appearances, minutes, and clean sheets.
- [x] Snapshot the new participation counters into season history, awards inputs, career totals, retired-player records, and Season Review.
- [x] Update every Player Center, Player Detail, Team Detail, leaderboard, and Season Review consumer that displays participation to use the authoritative selectors.
- [x] Add match-detail substitution events with clear in/out names and minutes without overcrowding mobile layouts.
- [x] Add deterministic unit tests for no substitutions, three substitutions, post-match injury exposure, red cards, short benches, no available goalkeeper, extra time, and transferred-player club splits.
- [x] Add invariant checks for 11 starters, legal bench membership, legal substitution order, on-field event ownership, participation counter arithmetic, and aggregate-versus-segment totals.
- [x] Run 10 current-schema seasons and require `0 errors / 0 warnings` after every rollover with the new model.

### P1: Live Match And Animation Timing

- [x] Refactor `MatchLive` into an explicit playback state machine so event reveal, score updates, skip, close, and result changes cannot race each other.
- [x] Remove stale-closure risk from `MatchLive` effects and include every semantic dependency without restarting already-consumed events.
- [x] Reset live playback correctly when switching directly from one result to another.
- [x] Refactor `ResultAnimation` so sorted results are stable, completion fires exactly once, and a new result batch fully resets the reveal state.
- [x] Make skip behavior idempotent: repeated clicks must not duplicate completion callbacks or leave timers alive.
- [x] Refactor `NewsTicker` so list shrink/replace operations clamp the visible index without synchronous effect-driven state cascades.
- [x] Clear every animation timer on unmount and verify route changes do not update unmounted components.
- [x] Add fake-timer tests for normal playback, rapid skip, close/reopen, result replacement, empty results, and ticker list replacement.
- [x] Browser-test repeated fast advances and modal switching with zero console warnings, duplicate renders, or stale scores.

### P1: Current-Schema-Only Persistence Simplification

- [x] Remove the v1-v24 migration chain and migration-only helper functions from `game-store.ts`.
- [x] Delete migration-only tests and fixtures that no longer represent a supported capability.
- [x] Keep one exported current schema version constant used by persistence, import/export, tests, and audit tooling.
- [x] Validate the minimum current persisted envelope before hydration, including `version`, `state`, `world`, season state, teams, squads, and player stats.
- [x] On incompatible or malformed local storage, fail closed: preserve the bad payload only for diagnostics, clear it from the active key, and return to the new-game screen with a concise recovery message.
- [x] Ensure current valid saves still hydrate, debounce, flush on page hide, survive reload, and round-trip through standard JSON export/import.
- [x] Add tests for current save hydration, malformed JSON, wrong version, missing world fields, pending-write replacement, quota failure, and reload round-trip.
- [x] Measure and record the source/bundle reduction after migration removal.

### P2: Static Quality And Dead-Code Removal

- [x] Reduce production `src/` ESLint from the current baseline of 64 errors and 2 warnings to zero.
- [x] Remove unused imports, variables, parameters, and abandoned calculations instead of suppressing them globally.
- [x] Replace empty catches with an intentional fallback, user-visible failure, or a narrowly documented ignore.
- [x] Resolve all remaining `react-hooks/set-state-in-effect` and `react-hooks/exhaustive-deps` findings through behavior-preserving refactors.
- [x] Replace the remaining production `any` with a concrete type or `unknown` plus narrowing.
- [x] Decide which one-off visual/simulation scripts remain supported; delete obsolete scripts or move them outside the linted production toolset.
- [x] Reduce supported `scripts/` ESLint from the current baseline of 80 errors to zero.
- [x] Keep `pnpm lint`, `pnpm exec tsc -b`, and `pnpm test` green together before removing CI leniency.
- [x] Remove `continue-on-error` from the GitHub Actions lint step only after the repository reaches zero lint errors.

### P2: Route Loading And Bundle Performance

- [x] Record a repeatable baseline for production JS size, gzip size, PWA precache size, and cold-load timing; current main JS baseline is approximately 920 KB raw / 255 KB gzip.
- [x] Convert non-critical routes in `App.tsx` to `React.lazy` route-level chunks with a stable loading state that does not shift the layout.
- [x] Keep Dashboard and initial new-game flow in the critical path; defer history, legends, search, compare, settings, editor, and deep-detail pages.
- [x] Inspect shared chunks before adding manual vendor splitting; avoid duplicate React, engine, or locale code across route chunks.
- [x] Ensure PWA precache includes the application shell while large deferred route chunks can load on demand without breaking offline navigation after first use.
- [x] Add chunk-size reporting to CI and define a warning budget for the initial JS path.
- [x] Verify desktop and mobile cold start, route navigation, back navigation, refresh on deep links, and offline revisit.
- [x] Target an initial main chunk below 500 KB raw without trading away current functionality or producing excessive tiny requests.

### P2: Automated Current-Version Regression Gate

- [x] Add a CI browser job that installs Playwright, starts the built preview, and runs `pnpm audit:current` against the preview URL.
- [x] Run a short fixed-seed audit on every pull request and retain the 10-season audit for main or scheduled runs.
- [x] Upload the structured audit JSON when a run fails so season, issue codes, route, and runtime errors are visible in CI.
- [x] Fail CI on any world-data error/warning, browser page error, console error, empty route, or incomplete target-season count.
- [x] Include current-save export/import and reload as an automated browser flow, not only a unit test.
- [x] Cover at least 390x844 mobile and a standard desktop viewport for Dashboard, Players, Player Detail, Teams, Team Detail, History, and Settings.
- [x] Check horizontal overflow, clipped text, duplicate React keys, and minimum 44px primary touch targets in the browser audit.
- [x] Keep the online Vercel smoke check separate from deterministic local CI so deployment/network failures are distinguishable from product regressions.

### Final Acceptance For This Backlog

- [x] All P0 participation semantics are implemented, documented, and invariant-tested.
- [x] Player Center, Player Detail, Team Detail, match events, season review, and career history agree for sampled players before and after transfers.
- [x] Full repository lint, type check, unit/integration tests, production build, and browser audit all pass in one clean checkout.
- [x] Ten-season fixed-seed audit completes with zero validation issues and zero browser runtime errors.
- [x] Current JSON save export/import/reload succeeds; incompatible saves are rejected without corrupting the active game.
- [x] Initial production JS meets the agreed size budget and all audited routes remain usable on mobile and desktop.

## Recommended Execution Order For Section 13

- [x] Phase 1: Lock participation semantics and add failing lineup/substitution invariant tests.
- [x] Phase 2: Implement starters, substitutions, minutes, and authoritative stat propagation.
- [x] Phase 3: Update all player/team/review UI consumers and complete the 10-season data audit.
- [x] Phase 4: Repair live-match/result/ticker timing and add fake-timer interaction tests.
- [x] Phase 5: Remove historical migration code and harden current-save hydration/recovery.
- [x] Phase 6: Clear repository lint and make lint blocking in CI.
- [x] Phase 7: Split routes, establish performance budgets, and add the browser audit CI gate.
- [x] Phase 8: Run final mobile/desktop/current-save acceptance and update every checkbox only from recorded evidence.

### Completion Evidence (2026-07-16)

- Production baseline before route splitting: main JS `922,298 B` raw / approximately `255.74 KB` gzip, PWA precache approximately `2479.71 KiB`, local cold load `84 ms` DOMContentLoaded / `86 ms` load.
- Final production build: main JS `270,635 B` raw / `80,997 B` gzip; complete initial static JS graph `646,017 B` raw / `201,737 B` gzip; PWA precache `29` entries / `2213.90 KiB`.
- `pnpm bundle:check` passes the `500,000 B` main-entry and `700,000 B` full-initial-graph budgets.
- The PWA precache contains every static application-shell dependency and excludes all explicit deferred route chunks; `/history` reloads successfully offline after its first online visit.
- Full verification passes: ESLint zero findings, TypeScript build, `43` test files / `418` tests, Vite production/PWA build, and fixed-seed production browser audit.
- Ten-season audit completed `520` advances with `0 errors / 0 warnings` at every rollover. Current-save export/import/reload, browser back, deep-link refresh, and offline revisit all passed.
- Browser coverage passed for all `18` current routes at `390x844` and the `7` required key routes at `1440x900`, with zero runtime errors, horizontal overflow, clipped labels, or undersized primary targets.

## 14. Forecast, Narrative, And Match Presentation Pass (2026-07-16)

- [x] Use one deterministic pre-match strength/xG model for simulation inputs, predictions, odds, and upset semantics.
- [x] Derive win/draw/loss percentages from the shared expected-goals model and enforce monotonic calibration tests.
- [x] Format upset scores from the named winner's perspective, including away-team upsets.
- [x] Render match detail and live playback above every sticky page control on mobile.
- [x] Meet 44px touch targets for tabs and fixture-star actions; keep the optional floating advance control accessible and on-screen.
- [x] Make pitch playback refresh-rate independent and render sharply at the active device pixel ratio.
- [x] Animate the credited goalkeeper/defender toward saves and blocks, highlight the credited event player, and let misses cross the end line.
- [x] Give extra time and penalty shootouts dedicated playback phases without adding shootout goals to the match score.
- [x] Give repeated same-minute events stable unique animation identities.
- [x] Respect reduced-motion preferences and provide optional muted-by-default match audio.
- [x] Update stale roadmap claims and leave focused regression coverage for every fixed production issue.

Verification: Node 24 TypeScript and ESLint passed; all `433` Vitest tests passed; production/PWA build and bundle budget passed (`268,298` byte main chunk); current-schema production browser audit completed one full season (`52` advances) with `0 errors / 0 warnings`, all `18` mobile and `7` desktop routes clean, and save/back/deep-link/offline checks passing. `verify:match` additionally passed at `1440x900@2` and `390x844@3`, with nonblank full-DPR pitch buffers, deterministic ball movement, overlay ordering, mobile touch targets, Escape close, and zero runtime errors.

## Suggested Execution Order

- [x] Step 1: Add audit helpers and invariant tests without changing behavior.
- [x] Step 2: Fix initialization issues around final teams versus default teams.
- [x] Step 3: Centralize player-stat selectors used by all display pages.
- [x] Step 4: Fix season-end snapshot and Season Review data source.
- [x] Step 5: Fix transfer application and transfer-season attribution.
- [x] Step 6: Introduce segmented player stats if needed for club-specific contribution.
- [x] Step 7: Expand defensive, goalkeeper, and midfielder metrics in the UI.
- [x] Step 8: Update docs, Node version constraints, and final regression tests.

## Notes From Initial Code Review

- `src/pages/Players.tsx` currently reads top scorers and assists from `world.playerStats` and resolves player identity through current squads.
- `src/pages/TeamDetail.tsx` displays current squad players and reads each player's `world.playerStats[player.uuid]`, which can blur transferred-player contribution.
- `src/pages/PlayerDetail.tsx` reads current stats by uuid and uses current squads for rankings, which can exclude retired or historical players.
- `src/components/SeasonReview.tsx` reads `world.playerStats`; this needs verification because new-season initialization resets current stats.
- `src/engine/season/season-manager.ts` snapshots player stat history before reset, then recreates current stats.
- `src/engine/players/stats.ts` is the core place to audit match-result-to-player-stat updates.
- Manual transfer actions in `src/store/transfer-window-actions.ts` should be reconciled with the automatic transfer flow.
- Custom-world initialization should verify squad generation uses the final team list rather than default teams.
