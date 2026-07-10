# Data Chain Optimization Checklist

Created: 2026-07-08

This document tracks the data-chain issues found during the initial project review. The goal is to keep a durable checklist for follow-up work, especially around player stats, team/player page consistency, season boundaries, transfers, and review pages.

## Progress Log

- 2026-07-09: Added `validateWorldData(world)` and validation tests for missing/orphan/mismatched player stats, scoreline/event mismatches, and impossible aggregate stats. Fixed fresh-world squad generation to use final/custom teams. Verified with full Vitest suite under Node 24 and TypeScript build.

## Current Main Concerns

- [ ] Player goals, assists, defensive events, and goalkeeper stats may not have one clear source of truth across pages.
- [ ] Player Center, Team Detail, Advanced Search, and Season Review may read similar data with different assumptions.
- [ ] Transferred players can make current-season stats look like they all belong to the current team.
- [ ] Season Review may read `world.playerStats` after new-season reset instead of a frozen previous-season snapshot.
- [ ] Defensive players and goalkeepers are underrepresented in UI metrics compared with attackers.
- [x] Custom/sandbox team initialization may still generate squads from default teams in some paths.
- [ ] Manual transfer flow does not fully match the automatic transfer pipeline.
- [ ] Some random paths use wall-clock time, which weakens reproducibility.

## 1. Source Of Truth And Data Semantics

- [ ] Define the canonical meaning of `world.playerStats`: current season live totals only.
- [ ] Define the canonical meaning of `world.playerStatsHistory`: immutable historical season snapshots.
- [ ] Define whether a player's current-season total follows the player after a transfer.
- [ ] Define whether team pages show "player season total" or "contribution for this team".
- [ ] Add explicit stat segmentation by `season + playerId + teamId` if team-specific contribution is required.
- [ ] Separate current-season stats, club-specific stats, historical-season stats, and career totals.
- [ ] Define whether league, cup, super cup, extra time, and penalty shootouts count into each stat view.
- [ ] Define how own goals are represented: team goal, own-goal stat, or excluded from player scorer tables.
- [ ] Document all stat semantics close to the stat update engine.

## 2. Player Stat Accuracy

- [ ] Audit generation of `goals`, `assists`, `appearances`, `cleanSheets`, `saves`, `keyBlocks`, `bigChances`, and `keyPasses`.
- [x] Verify every completed match can explain its scoreline through match events plus explicit own-goal/penalty semantics.
- [ ] Verify goals and assists are never assigned to players who did not appear.
- [ ] Verify event players are valid active players at the time of the match.
- [ ] Verify injured, suspended, or otherwise unavailable players are not selected into match events.
- [x] Verify goalkeeper and defender clean sheets never exceed appearances.
- [ ] Verify defensive and goalkeeper events are only assigned to plausible positions unless deliberately allowed.
- [ ] Verify `penalty_goal`, regular `goal`, extra-time goal, and shootout penalty handling is consistent.
- [ ] Verify own goals do not inflate normal top-scorer tables unless a deliberate rule says so.
- [ ] Add audit warnings for invalid stat events instead of silently dropping or misattributing them.

## 3. Cross-Page Consistency

- [ ] Centralize stat display selectors for Player Center, Team Detail, Player Detail, Advanced Search, and Season Review.
- [ ] Make Player Center resolve players from active squads, retired history, and frozen historical snapshots.
- [ ] Avoid rendering `-` for historical or transferred players when a frozen player name is available.
- [ ] Ensure Team Detail does not accidentally attribute all transferred-player season totals to the current club.
- [ ] Ensure Advanced Search uses the same player-stat selector as Player Center.
- [ ] Ensure Player Detail ranking uses the same stat semantics as Player Center.
- [ ] Ensure Season Review uses the finished season's frozen data, not the newly reset current-season stats.
- [ ] Add page labels such as "season total", "for current club", and "career total" where needed.
- [ ] Add selector tests to prove the same player has the same displayed totals across relevant pages.

## 4. Season Boundary And History

- [ ] Freeze player stats before `initializeNewSeason` resets current-season stats.
- [ ] Store enough frozen player identity data: name, age, position, rating, teamId, teamName, and season.
- [ ] Store enough team context data for historical display: team name, league, final rank, goals for/against.
- [ ] Make Season Review read the frozen just-finished-season snapshot.
- [ ] Make retired-player career totals read from `playerStatsHistory + current season`, not only current season.
- [ ] Ensure transfer-window records use the season of the window, not accidentally the newly initialized season.
- [ ] Ensure finance records related to a transfer window are attributed to the intended season.
- [ ] Ensure news timeline entries use the same season/window identity as transfer history.
- [ ] Add tests covering season rollover, stat snapshotting, reset, and review rendering.

## 5. Transfers And Stat Ownership

- [ ] Make automatic and manual transfer flows call one shared transfer-application pipeline.
- [ ] In manual offer acceptance, match automatic behavior for squad balance, weak-player release, and replacements.
- [ ] After every transfer, synchronize squad membership, player stat team references, transfer history, finance, and news.
- [ ] Do not rewrite old team contribution into the new team if segmented stats are introduced.
- [ ] Track transferred-player contribution by club for the same season.
- [ ] Keep a clear state for free agents, released players, and retired players.
- [ ] Validate squad size after every transfer.
- [ ] Validate positional balance after every transfer.
- [ ] Ensure transfer history season equals `transferWindow.season`.
- [ ] Remove `Date.now()` from transfer/random news paths to preserve deterministic seed replay.

## 6. Custom Teams And Initialization

- [x] Ensure game-world initialization generates squads from the final team list, not hardcoded default teams.
- [x] Verify `teamBases`, `teamStates`, `squads`, `standings`, and fixtures share the same team ids.
- [x] Add tests for sandbox/custom-team mode initialization.
- [x] Validate that every `playerStats[uuid].teamId` resolves to an existing team.
- [x] Validate that every active squad player has a matching `playerStats` entry.
- [x] Validate that no generated squad exists for a team outside the current world.

## 7. Defensive And Goalkeeper Metrics

- [ ] Add Player Center tabs or rankings for defenders and goalkeepers.
- [ ] Surface clean sheets, saves, key blocks, and possibly goals prevented for defensive players.
- [ ] Surface key passes, big chances, and chance creation for midfielders.
- [ ] Make Team Detail roster chips position-aware instead of only goals/assists.
- [ ] Make Player Detail position ranking score use position-appropriate metrics.
- [ ] Decide whether team defensive context should include only league matches or all competitions.
- [ ] Make labels explicit when a defensive score mixes player stats with team standings data.

## 8. UI Labeling And User Trust

- [ ] Label stat blocks clearly: "Current season", "For this club", "Career", or "Last season".
- [ ] Show transferred-player split stats where helpful, for example "Team A: 8 goals, Team B: 3 goals".
- [ ] For historical rows, display frozen team/player names even when the live object no longer exists.
- [ ] Avoid showing zeroed current-season stats inside previous-season review components.
- [ ] Add empty/error states that explain when data is unavailable because the season just started.
- [ ] Add a lightweight data-health panel for development builds if useful.

## 9. Audit Tools And Tests

- [x] Add `validateWorldData(world)` for local development and test usage.
- [x] Audit orphan player stats: stat exists but player cannot be resolved.
- [x] Audit missing player stats: active player has no stat record.
- [x] Audit team mismatch: active squad team and stat team disagree.
- [x] Audit invalid match events: unknown player and unknown team.
- [ ] Audit invalid match events: impossible position and unavailable player.
- [x] Audit score mismatch: match result does not match countable goal events plus explicit exceptions.
- [ ] Audit transfer mismatch: transfer history, squad movement, and finance/news do not agree.
- [ ] Add tests for regular goal, assist, own goal, penalty goal, shootout penalty, and extra-time goal.
- [ ] Add tests for player transfer during a season and after season-end transfer window.
- [ ] Add tests for retired-player historical display and career totals.
- [ ] Add one long-season simulation smoke test that runs multiple seasons and validates invariants.

## 10. Engineering Hygiene

- [ ] Add a Node version guard in `package.json` or `.nvmrc`; the README says Node 22+.
- [ ] Update README roadmap so implemented transfer/growth/retirement features are not still marked as TODO.
- [ ] Keep `pnpm exec tsc -b` passing after each data-chain change.
- [ ] Re-run the full test suite after fixing the local Node runtime issue.
- [ ] Keep changes small and reviewable: selectors first, data model next, UI labels last.

## Suggested Execution Order

- [x] Step 1: Add audit helpers and invariant tests without changing behavior.
- [x] Step 2: Fix initialization issues around final teams versus default teams.
- [ ] Step 3: Centralize player-stat selectors used by all display pages.
- [ ] Step 4: Fix season-end snapshot and Season Review data source.
- [ ] Step 5: Fix transfer application and transfer-season attribution.
- [ ] Step 6: Introduce segmented player stats if needed for club-specific contribution.
- [ ] Step 7: Expand defensive, goalkeeper, and midfielder metrics in the UI.
- [ ] Step 8: Update docs, Node version constraints, and final regression tests.

## Notes From Initial Code Review

- `src/pages/Players.tsx` currently reads top scorers and assists from `world.playerStats` and resolves player identity through current squads.
- `src/pages/TeamDetail.tsx` displays current squad players and reads each player's `world.playerStats[player.uuid]`, which can blur transferred-player contribution.
- `src/pages/PlayerDetail.tsx` reads current stats by uuid and uses current squads for rankings, which can exclude retired or historical players.
- `src/components/SeasonReview.tsx` reads `world.playerStats`; this needs verification because new-season initialization resets current stats.
- `src/engine/season/season-manager.ts` snapshots player stat history before reset, then recreates current stats.
- `src/engine/players/stats.ts` is the core place to audit match-result-to-player-stat updates.
- Manual transfer actions in `src/store/transfer-window-actions.ts` should be reconciled with the automatic transfer flow.
- Custom-world initialization should verify squad generation uses the final team list rather than default teams.
