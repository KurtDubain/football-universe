# Narrative Editorial And Time Control Checklist

Status: complete and release validated
Target release: v4.55.0
Last updated: 2026-08-13

This checklist records the editorial refinement accepted after the v4.54.0 Narrative Director release. It is deliberately scoped to making existing simulation depth easier to perceive. It does not add a second simulation, manager controls, generated fiction, or an unbounded history store.

## Product Contract

- [x] Preserve the observer role and all authoritative match, table, player, transfer, coach, injury, award, and archive data.
- [x] Separate source authority from runtime presentation maturity so one arc can adopt a later, stronger headline without changing its facts.
- [x] Separate artwork family from visual eligibility with `signal`, `chapter`, and `world_moment` levels.
- [x] Keep at most one World Moment per response and permit none when the advance has no rare historical event.
- [x] Limit More to six new, changed, or meaningfully continuing items; remember displayed More items in the existing bounded memory.
- [x] Keep match causality local to the match and present broader before/after changes in a separate post-advance world section.
- [x] Let no more than two routine position leaders reserve player-pool space; emergent player stories compete for the remaining budget.
- [x] Replace developer-facing prose such as “deduplicated” and “does not change simulation” with football editorial language.

## Matchday Density

- [x] Keep Observation Theme, focus matches, Judgment, and Advance before Narrative and the full schedule.
- [x] Group all fixtures by competition with truthful total and focused counts.
- [x] Default to the primary observed team's competition, or the first competition when no team is observed.
- [x] Render Fixture cards and their predictions only while a group is expanded.
- [x] Preserve one-tap access to every fixture and spoiler-free watch controls.

## Time Controls

- [x] Add a local UI preference that keeps the current route and Dashboard tab after successful single, batch, or key-node advancement.
- [x] Keep an explicitly starred fixture's spoiler-free live opening as an intentional exception.
- [x] Add a confirmed one-shot Skip Current Season command in the global advance menu.
- [x] Execute every remaining season window through the canonical observation/season pipeline.
- [x] Commit the world only after crossing the season boundary; failure restores interactivity without exposing a partial world.
- [x] Yield between bounded chunks so a full-season operation does not monopolize the mobile main thread.
- [x] Stop at the next season's first unplayed window with results, news, awards, histories, achievements, and Narrative memory committed once.

## Validation Gate

- [x] Focused type, Narrative, response, preference, fixture-disclosure, and full-season tests.
- [x] Full unit suite, ESLint, strict TypeScript, production/PWA build, changelog and bundle gates.
- [x] Narrative multi-seed determinism, boundedness, source coverage, visual frequency, and mutation audit.
- [x] Long advance/save data audit covering at least ten seasons.
- [x] Desktop and mobile browser verification of both controls, collapsed fixture DOM, WorldResponse, overflow, and runtime errors.
- [x] Standard deterministic web-game Playwright client with screenshot and error inspection.
- [x] Commit and push only after every applicable gate above passes.

## Release Validation Record

- Node 22.22.2: 132 test files / 953 tests passed; ESLint and strict TypeScript passed.
- Narrative audit: 8 seeds x 8 seasons, 3,232 scanned windows plus 506 deterministic baseline windows, no mutation, destination, freshness, or editorial-budget violation; `more` stayed capped at 6, all four player positions were represented, and World Moment appeared in 942 responses (29.1%). Narrative scan/digest p95 measured 2.68/3.15 ms.
- Recommended-seed audit retained `20260717`: all three observer lenses open with a one-goal-or-less match, the challenger opener is not 0:0, all 18 sampled windows expose an observation theme and meaningful choice, and no special-case seed logic was added.
- Current-schema browser audit: 10 completed seasons / 500 advances, zero world-data issues, save round-trip, back navigation, deep-link refresh, offline revisit, and all inspected mobile/desktop routes passed. Cold load measured 79 ms in the local production preview.
- Time-control browser audit: 390x844 and 1440x900 both retained `/league/1`, persisted the preference through reload, skipped 47 remaining windows into S2 window 0, generated honors and player history, and returned to the latest report when the preference was disabled. No overflow or runtime error occurred.
- WorldResponse browser audit caught an over-tall compact mobile response; broader world changes now use a collapsed summary. The final mobile response measured 666.5 px, retained its four factual causality steps, and correctly treated just-finished season-boundary facts as eligible for one World Moment.
- Dashboard, key-node, floating-control, Narrative Director, and WorldResponse browser workflows passed. The standard web-game client produced two visually inspected nonblank frames with no console-error artifact.
- Production PWA build: 88 precache entries / 3,268.57 KiB. Main bundle 244,107 bytes / 76,114 gzip; initial graph 498,918 bytes / 164,596 gzip. Bundle, changelog, portable-script, and zero-vulnerability production dependency gates passed; the ordinary build contains no audit bridge.
