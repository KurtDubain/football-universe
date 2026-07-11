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
- [ ] Audit `appearances` and `cleanSheets` against persisted matchday/team context once lineups are stored historically.
- [x] Verify every completed match can explain its scoreline through match events plus explicit own-goal/penalty semantics.
- [x] Verify generated goals and assists are assigned only to players in the fixture matchday squad.
- [x] Verify event players resolve to known players and a plausible fixture-side team association.
- [ ] Verify event players are valid active players at the exact match window after mid-season transfers.
- [x] Verify injured players with active injury history are not silently accepted into match events.
- [x] Use matchday-filtered squads for generated events so injured/suspended players are not selected when enough players are available.
- [ ] Define and audit emergency-floor exceptions where unavailable players are used because fewer than 11 players are available.
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
- [ ] Ensure finance records related to a transfer window are attributed to the intended season.
- [ ] Ensure news timeline entries use the same season/window identity as transfer history.
- [x] Add tests covering season rollover, stat snapshotting, reset, and selector-based review data.

## 5. Transfers And Stat Ownership

- [ ] Make automatic and manual transfer flows call one shared transfer-application pipeline.
- [x] In manual offer acceptance, match automatic behavior for squad balance, weak-player release, and replacements.
- [x] After manual transfer-window actions, synchronize squad membership, player stat team references, transfer history, and finance.
- [ ] Add manual transfer-window news entries or a deliberate no-news policy.
- [x] Do not rewrite old team contribution into the new team if segmented stats are introduced.
- [x] Track transferred-player contribution by club for the same season.
- [ ] Keep a clear state for free agents, released players, and retired players.
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
- [ ] Decide whether team defensive context should include only league matches or all competitions.
- [ ] Make labels explicit when a defensive score mixes player stats with team standings data.

## 8. UI Labeling And User Trust

- [ ] Label all stat blocks clearly: "Current season", "For this club", "Career", or "Last season".
- [x] Show transferred-player split stats where helpful, for example "Team A: 8 goals, Team B: 3 goals".
- [x] For historical rows, display frozen team/player names even when the live object no longer exists.
- [x] Avoid showing zeroed current-season stats inside previous-season review components.
- [ ] Add empty/error states that explain when data is unavailable because the season just started.
- [ ] Add a lightweight data-health panel for development builds if useful.

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
- [ ] Audit invalid match events: suspended/non-injury unavailable player at match time.
- [x] Audit event-derived player stats against completed match events.
- [x] Audit event-derived club stat segments against completed match events.
- [x] Audit score mismatch: match result does not match countable goal events plus explicit exceptions.
- [ ] Audit transfer mismatch: transfer history, squad movement, and finance/news do not agree.
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
- [ ] Keep changes small and reviewable: selectors first, data model next, UI labels last.

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
