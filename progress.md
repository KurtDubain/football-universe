Original prompt: 那你处理一下吧，按照B；速度慢一点也没问题，如果你对性能有担忧的话

## 2026-08-09 Engineering Audit P1/P2 Closure

- Closed the advancement-feedback inconsistency with a dedicated pure `advance-orchestration` module. Single, batch, until-target, and key-node actions now share one success commit for world state, results, news, observation settlements, response metadata, advance ticks, and achievement notifications.
- Full world achievement history remains unchanged. Transient toasts now include only newly unlocked achievements for the currently followed teams; no-favorite simulation keeps all achievements without global toast spam. New-game and reset paths clear achievement, starred-fixture, favorite-team, advancing, and tick state.
- Added end-to-end store coverage for single-versus-batch achievement parity, no-favorite behavior, and universe reset isolation. A fixed-seed browser probe produced 32 world achievements but only two relevant favorite-team notifications, advanced the queue exactly once on click, and left zero notifications after reset.
- Reworked the achievement toast as a full-width mobile-safe, keyboard-operable notification below the persistent header/ticker. It exposes the remaining count, wraps long content, has zero horizontal overflow at 390px, and was visually inspected in the real Dashboard.
- Made audit-feature checks compare `VITE_ENABLE_AUDIT` with the exact string `true`, preventing an environment value of `false` from exposing audit-only behavior. The ordinary production bundle contains no game, save, or update audit bridge.
- Enabled TypeScript `strict`, `noUnusedLocals`, and `noUnusedParameters` in the committed app configuration and cleared all existing violations. Added `pnpm typecheck`, aligned `.nvmrc`, `.node-version`, and CI on Node 22.22.2, while retaining the documented Node 22.12 minimum.
- CI now runs current-schema browser/data validation, automatic PWA update verification, production mobile advance performance, and tactical match presentation for every PR. Main pushes and the weekly run additionally cover set pieces, shootouts, and the complete animation performance lifecycle; failure artifacts include reports, logs, and screenshots.
- Bundle governance now checks raw and gzip sizes. Final ordinary production output measured 230,633 bytes / 71,710 gzip for the entry and 638,429 bytes / 208,074 gzip for the initial graph, within 500,000/80,000 and 700,000/225,000 budgets.
- Updated README scale and validation commands, ignored browser audit output, and released the combined PWA, coherent animation, and engineering closure as v4.40.0.
- Final Node 22.22.2 verification passed 102 test files / 780 tests, strict TypeScript, ESLint, changelog consistency, ordinary and audit PWA builds, bundle budgets, and production dependency audit with no known vulnerabilities.
- The ten-season production browser audit completed 500 advances with zero data errors or warnings; save round-trip, deep links, back navigation, all audited mobile/desktop routes, and offline revisit passed. Mobile advance p50/p95 was 20.6/26.3ms normally and 43.6/66.7ms at 4x CPU, with one accepted advance from 20 rapid inputs and exact reload recovery.
- Tactical actor, corner, free-kick, and shootout audits passed desktop plus 320/390px mobile. Canvas rendering averaged about 0.24ms normally and 0.89ms at 4x CPU; hidden, covered, closed, reopened, next-batch, and authoritative final-score states all passed.

### Follow-up Boundary

- Dashboard, season manager, PitchCanvas, and MatchLive remain intentionally large domain orchestrators. Future feature work should extract one cohesive controller at a time, but no broad rewrite is justified while their strict build, focused unit suites, production browser matrix, performance budgets, and long-save invariants remain green.

## 2026-08-09 Coherent Tactical Match Presentation

- User reported that the current animation still felt disorganized and asked for a more realistic pass without replacing the lightweight top-down presentation or changing authoritative match results.
- Ordinary possession now selects one deterministic tactical episode: build-up, wing overload, central combination, switch, counter, or recycle. Pass routes share that intent and stage, off-ball support follows role-specific lanes, and defensive pressure/cover/marking assignments stay stable across the episode.
- Presentation-only possession can no longer invent a shot. Goals, saves, blocks, misses, and set-piece outcomes come from the existing authoritative event chain; score, player statistics, schedules, saves, and simulation RNG are unchanged.
- Highlight scenes now enter five simulated minutes before a shot or set piece. The match clock yields at the event minute until the final pass, release, and readable outcome complete; dense event scenes queue in order instead of replacing the active save, block, or celebration.
- The prior emergency jump to the final shot was removed. The credited goalkeeper or blocker reads the attack during the prelude, recovers into the shot lane, reacts after release, and holds the intervention position through the result. Browser audit reduced the credited goal-line blocker's result distance from roughly `0.16` to `0.02` normalized pitch units.
- Defending players preserve a spaced box line after release instead of swarming the ball. Counters send only the front unit and nearby support forward while the remaining players hold rest defence; mobile and reduced-motion profiles retain a fixed camera.
- The Canvas debug contract now reports tactical pattern/stage, event target, clock ownership, scene minute, queue depth, player identities, positions, and render health. Set-piece and shootout audits wait for the complete scene rather than assuming the commentary and Canvas enter on the same frame.
- Browser verification passed ordinary presentation at `1440x900`, `320x568`, `390x844`, and reduced motion; tactical scorer/creator/goalkeeper/blocker identity; corners, direct free kicks, shootouts, complete broadcast history, and the standard web-game client with inspected screenshots and no runtime error artifacts.
- Animation performance passed normal and 4x CPU profiles. Average Canvas render cost was about `0.25ms` and `0.57ms`; hidden, covered, paused, completed, closed, reopened, and next-batch states remained correct, and final scores matched.
- Final Node 22.22.2 verification passed 102 test files / 777 tests, ESLint, TypeScript, ordinary and audit PWA builds, automatic-update verification, changelog and bundle budgets, and production dependency audit. The ordinary production package contains no audit bridge; the main entry is 230,149 bytes (71,561 gzip) and initial load is 637,359 bytes (207,805 gzip).

## 2026-08-09 Automatic Deployment Updates

- User requested automatic remote-version recognition so Vercel deployments reach an already-open game without repeated manual refreshes. Existing saves and simulation data remain untouched.
- Added a build-generated, non-precache `version.json` carrying both the public app version and the deployment commit id, with explicit no-store Vercel headers for the probe and Service Worker.
- Replaced implicit PWA registration with an explicit production update monitor. It checks at startup, focus, foreground restore, online restore, and every 15 minutes, then asks the registered Service Worker to update when the deployment id changes.
- Service Worker activation now delegates to a tested safe-reload coordinator. Reload waits at least 500ms and is deferred while the page is hidden, a season window is advancing, or any modal/live dialog is open; duplicate notifications still reload only once.
- The dedicated audit build served `version.json` outside the Service Worker precache, registered and controlled the page, detected a simulated new deployment id, and completed exactly one explicit registration update request. Mobile overflow and runtime errors were zero.
- Final Node 22.22.2 verification passed 102 test files / 767 tests, ESLint, TypeScript, audit and ordinary PWA builds, changelog, bundle budget, production dependency audit, and the standard web-game client through a fresh start into Dashboard. The main entry is 230,149 bytes (71,570 gzip), initial load is 637,359 bytes (207,814 gzip), and no ordinary-production audit bridge remains.

## 2026-08-09 Stable Match Motion And Set Pieces

- User approved option B: prioritize stable, maintainable football motion and allow a slower presentation in exchange for credible setup, transitions, corners, and free kicks.
- Match events now expose optional `playOrigin` and `setPiece` context for open play, counters, corners, direct/crossed free kicks, and penalties. Old events remain readable as open play; no save migration or historical reset is required.
- The simulator keeps scores and existing MatchStats authoritative, reconciles structured corner origins against recorded corner totals, and adds at most one notable standalone corner plus one optional free kick from actual on-field participants. Eighty deterministic seeds passed score, corner, metadata, and lineup consistency assertions.
- Corners, direct free kicks, crossed free kicks, and penalties use pure deterministic sequence generators. Static preparation lets the taker, box runners, defenders, goalkeeper, and red-card-aware wall settle before the ball is released; deliveries can be cleared or retained without inventing a score.
- Player motion now uses capped desired velocity and acceleration. Marking and pressure assignments remain fixed for a phase, generic possession stays with the same attacking side until an explicit turnover, and event attacks bridge from the visible ball instead of jumping to a fresh random formation.
- Desktop camera following uses a dead zone with restrained `1.006-1.026` zoom; impact shake is sub-pixel and limited to full-quality goals. Mobile, constrained, and reduced-motion profiles stay at fixed `1.0` zoom.
- Highlights approach set pieces four minutes early, slow through the setup, and hold the event minute long enough to complete the action. Commentary history, match details, icons, and original Web Audio whistle/crowd cues now distinguish corner and free-kick events.
- Browser audits passed structured corners and free kicks at `1440x900` and `390x844`: six attackers reached the corner threat area, the red-card-aware three-man wall remained goal-side with visible spacing, and mobile camera zoom stayed exactly `1.0`. Ordinary live presentation, authoritative scorer/creator/defender tactics, and shootouts also passed desktop plus `320/390px` mobile checks.
- The tactical audit uncovered and fixed a real one-two edge case where route deduplication could let the creator take the registered scorer's shot. A dedicated regression test now preserves the final shooter even when the sequence starts with that same player.
- Animation performance passed normal and 4x CPU profiles at about `0.47ms` and `1.97ms` average Canvas render cost. Hidden, covered, closed, reopened, and next-batch states remained correct; final scores matched.
- The S150 long-save audit completed 7,609 advances with zero rollover errors, data errors, or warnings. Browser storage reached `2,169,054 B` against the `4,194,304 B` budget; S1/S50/S100/S150 reload and next-advance digests matched, and archival removed 7,513 event rows plus 892 matchday snapshots normally.
- Final Node 22.22.2 verification passed 101 test files / 763 tests, ESLint, TypeScript, production/PWA build, bundle budget, and production dependency audit. The main entry is 229,759 bytes (71,390 gzip), initial load is 636,855 bytes (207,499 gzip), and production dependencies report no known vulnerabilities.

Original prompt: 可以，那你来优化一下动画模块吧

## 2026-08-08 Match Realism And World Moments

- User approved the combined match-animation, event-image, and UI polish pass, with direct validation and push. The authoritative simulator, scores, events, statistics, saves, and observer-game positioning remain unchanged.
- Open-play sequences now use bounded role-aware receiving points instead of fixed formation slots. Possession shapes add supporting triangles, width, and a ball-side fullback option; defending adds stable marking assignments, passing-lane cover, goal-side positioning, and presser inertia.
- Shots, saves, and blocks retain their actual final ball position. Deterministic second-ball possession can continue from a spill or ricochet, while every next phase begins at the visible ball rather than snapping back to a nominal slot.
- The broadcast camera now follows danger with restrained zoom and smoothing. Players expose lightweight shoulder, facing, and stride cues; labels, flashes, trails, and celebration effects were reduced or repositioned to keep the pitch readable on small screens.
- Added five original, brand-free 1440x630 world-moment images for tournament stages, rises, falls, legacies, and transfers, plus three regenerated 256px story chapter marks. Art is limited to one authoritative narrative beat per response and routine match news remains text-led.
- All generated images are versioned WebP assets with explicit byte budgets, fallback behavior, source identifiers, and prompt records in `docs/visual-assets.md`. Save-Data, high contrast, failed requests, throttled mobile loading, and offline PWA use all passed.
- Dashboard watch actions now use a 44px icon control placed away from the draggable advance action, and Match Live scoreboards use real dynamic team badges. The 320px screenshot confirms that neither control overlaps and long team identities remain readable.
- Browser verification passed ordinary match presentation at desktop, 320px, 390px, and reduced modes; tactical goal/save fixtures; penalty shootouts; focus watching across all routes; audiovisual delivery; and five world-moment variants without overflow or runtime errors.
- Animation performance passed normal and 4x CPU profiles. Average Canvas render cost was 0.388ms and 1.583ms; hidden, covered, closed, rapidly reopened, and next-batch states remained correct, and final scores still matched.
- Final Node 22.22.2 verification passed 100 test files / 753 tests, ESLint, TypeScript, production/PWA build, changelog, visual assets, floating action, bundle, and dependency audits. The main entry is 229,759 bytes (71,387 gzip), initial load is 633,040 bytes (206,200 gzip), and production dependencies report no known vulnerabilities.

## 2026-08-08 Broadcast Atmosphere And Focus Watch

- User approved the complete P0/P1 audiovisual plan: stadium ambience, event and shootout sound, spoiler-free focus watching, key-match/champion art, and restrained short music without turning the observer game into a manager game.
- The existing transient multi-star auto-live path is now a single explicit watch lock. Advancing opens the selected fixture behind a score-hidden broadcast slate and only then starts the authoritative 0-0 playback clock; replacing a target cannot leave multiple auto-live matches.
- Match Live reuses the project's single gesture-unlocked AudioContext. A cached two-layer procedural crowd bed responds to competition prestige, match progress, close-score tension, pause state, and shootouts without reading or advancing simulation RNG.
- Goals distinguish home, away, and neutral crowd reactions. Saves, blocks, misses, woodwork, cards, substitutions, halftime, extra time, shootout entry, and fulltime have separate original synthesized cues. Local/global mute, hidden pages, reduced feedback environments, missing Web Audio, and unmount all degrade or stop cleanly.
- Start observation, featured/final broadcast openings, and season end now use short original musical motifs. Routine data browsing remains silent and no third-party audio file or license obligation was introduced.
- Generated two original, brand-free visual assets with the built-in image tool: a 1440x630 night-stadium opener (70,358 bytes) and a 1200x600 champion ceremony (34,786 bytes). Team names, short names, badges, competition, venue, season, and statistics remain dynamic accessible text.
- Season Review separates its champion image from the narrative paragraph so the trophy and club identity remain legible on mobile. The featured-match opener uses short names on mobile rather than ellipsizing long full names.
- Dedicated browser verification passes at 390x844 and 1440x900 through lock, advance, hidden-score opener, real Canvas playback, a scheduled away-goal crowd reaction, fulltime sound, season rollover, and champion archive with no overflow or runtime error. Standard game-client screenshots and text state were inspected across three deterministic animation iterations.
- Final Node 22.22.2 verification passed 98 test files / 746 tests, ESLint, TypeScript/PWA audit build, changelog and bundle budgets, production offline feedback, throttled visual assets, and the production focus-watch journey. The main entry is 229,840 bytes (71,459 gzip), initial load is 633,292 bytes (206,371 gzip), and the production dependency audit reports no known vulnerabilities.

## 2026-08-08 Shot And Second-Ball Motion Pass

- User requested another match-animation improvement after confirming the current traceability and storage capability is sufficient.
- Baseline inspection found that directed shots reached their result cleanly but still felt abrupt: the wind-up was too short, every flight was straight, and saves, blocks, and misses left the ball frozen at the impact point.
- Directed shots now use a longer eight-frame preparation, a small deterministic curve, and slightly more readable travel time. The actual event, score, statistics, restart, and save data remain authoritative and unchanged.
- Saves visibly spill a short second ball, blocks ricochet farther and wider, and misses continue beyond the post. These paths are seeded, bounded, and presentation-only.
- Shooters, goalkeepers, and blockers receive restrained action silhouettes around release and impact. Outcome labels are clamped inside the canvas, including narrow mobile layouts.
- Pure physics coverage asserts curved-flight endpoints and distinct save/block rebounds. The tactical browser fixture now freezes and verifies the post-impact ball as well as authoritative attacker, creator, and defender identities.
- Standard game-client inspection completed three deterministic iterations without console errors. Ordinary live presentation, fixed goal/save scenes, and penalty shootouts passed desktop plus 320/390 mobile verification.
- Animation performance passed at normal and 4x CPU profiles with average Canvas render costs of 0.268ms and 1.248ms. Covered, hidden, closed, rapidly reopened, and next-batch states remained correct, and final scores still matched.
- Final Node 22.22.2 verification passed 97 test files / 740 tests, ESLint, TypeScript/PWA production build, bundle budget (229,711-byte main; 632,983-byte initial load), changelog validation, and diff checks.

## 2026-08-08 Cross-Position Season Performance

- User requested one 0-100 season score that can compare forwards, midfielders, defenders, and goalkeepers without mixing player ability with season output or attendance.
- Position metrics now use fixed simulator-derived anchors plus a fixed composite calibration. The live universe never recalculates its own percentile scale, so identical performance remains comparable across saves and seasons.
- Final score is 70% confidence-adjusted position quality, 20% all-competition availability, and 10% league strength (100/95/90). Confidence uses `minutes / (minutes + 900)` and replaces the old 600-minute eligibility cliff.
- Team-match opportunities, missed matches, and injury absences are accumulated per real fixture in both player totals and `(playerId, teamId)` segments. Transfer-season quality and league strength are aggregated by actual segment minutes.
- Historical rows freeze score components with `scoreVersion: 1`; older rows remain readable and display as legacy rather than receiving invented defensive or attendance data.
- Players defaults to a cross-position overall table, Player Detail separates ability from season score and shows overall/position ranks, and Season Review records its top three complete-score performers.
- The repeatable long audit completed 30 seeds x 20 seasons (600 seasons): high-confidence position medians span 2.1 points, P90 scores span 2.0 points, zero low-confidence players entered 12,000 sampled top-20 places, injured availability averaged 83.74 versus 92.00 when healthy, and no invalid score or attendance field appeared.
- Dedicated browser verification passed the 30-row overall table and score detail at 390x844 and 1440x900 with no overflow or runtime errors. The existing player/team workflow also passed 320x568, 390x844, and 1440x900, including the new low-sample ranking plus confidence warning.
- Mobile floating advance remains draggable and route-wide, but its default action is reduced from 56px to the repository's 48px touch minimum to obscure less content. The dedicated audit passed 27 routes at 320/390/430/1440 widths, including position restore, resize, hide/show, and tap behavior.
- Final Node 22.22.2 verification passed 97 test files / 738 tests, ESLint, TypeScript/PWA production build, bundle budget (229,719-byte main; 632,991-byte initial load), changelog validation, and production dependency audit with no known vulnerabilities.

## 2026-08-08 All-Region Continental Cups

- User requested that every team in each continent participate instead of coefficient qualification excluding the lower half, then asked for the animation and competition work to be pushed together.
- New S5/S11/S17 format: Mainland includes all 16 clubs in four groups and runs QF/SF/Final; Southern and Eastern include all eight clubs in two groups and run SF/Final. All regions retain three neutral single-round-robin group windows, neutral single-leg knockouts, and the six-season interval.
- Rolling five-season club coefficient now controls four draw pots and the final group tie-break only. It never excludes a club. All three regions play in parallel, so the expanded format adds only one maximum calendar window.
- Continental knockout generation now derives its bracket from group count and supports the earlier 8/4 selective format for an already active current-schema save. Save validation derives participant and window counts from the stored groups instead of rejecting that in-progress format.
- The cup page and draw news state the all-region rule, dynamic team/group count, coefficient purpose, and expanded knockout path. New season integration asserts that all 32 clubs appear exactly once across the three continental competitions.
- Browser workflow verification passed at 320x568, 390x844, and 1440x900. Each viewport reached S5 with six continental windows, showed all four Mainland groups and 32 coefficient rows without horizontal overflow, and retained the three-round neutral World Cup group format.
- Final Node 22.22.2 verification passed 97 test files / 731 tests, ESLint, TypeScript/PWA production build, bundle budget (229,719-byte main; 627,280-byte initial load), changelog validation, and diff checks.

## 2026-08-08 Match Motion Continuity Pass

- User requested another realism pass after v4.32.0. Keep the existing lightweight top-down observer presentation and authoritative simulation facts.
- Audit findings: receivers currently chase the in-flight ball instead of committing to its destination; passes use an accelerating-then-decelerating curve; possession holds are static; the next pass can restart from a formation slot; defensive depth and goalkeeper starting position do not scale enough with threat distance.
- Planned scope: continuous carry-to-pass movement, destination-led receiving runs, football-like ball travel, layered defensive lines, goalkeeper angle/depth positioning, and short deterministic shot/reaction timing. No result, event, statistic, save, or competition changes.
- Verification target: focused physics tests, fixed tactical and shootout fixtures, ordinary presentation, standard web-game client, desktop/mobile screenshot inspection, full tests/lint/build, and animation performance audit. Local browser hosting may be unavailable in the current restricted environment and must be reported if it remains blocked.
- Implemented destination-led receiving runs, short role-scaled carries, real ball-position continuation into the next pass, fast-release/decelerating ground passes, near-linear lofted travel, and a four-frame shot wind-up. Directed final passes and shots now use longer, readable timing.
- Defensive movement now forms threat-relative depth layers. The presser closes the receiving point, the cover remains goal-side, and the goalkeeper steps off the line only as the ball enters a dangerous distance. Credited saves/blocks begin their reaction after release rather than anticipating the shot.
- Sequence endings now preserve match continuity: ordinary play resumes at the current ball, goals restart at midfield for the conceding team, misses restart as goal kicks, and saves/blocks restart with the defending side. Inactive preferred restart players fall back to the nearest actual player.
- Players expose a restrained facing/action marker for carries and authoritative shot/save/block actors. Debug state stops reporting a completed directed event after its restart begins.
- Final Node 22.22.2 verification passed 97 test files / 731 tests, ESLint, TypeScript/PWA production build, bundle budget (229,719-byte main; 627,280-byte initial load), changelog validation, and diff checks. The animation chunk increased by roughly 2.6 KB uncompressed and remains lazy.
- Browser verification passed through the standard game client, ordinary live presentation, fixed tactical goal/save fixtures, and desktop plus 320/390 mobile shootout fixtures. Screenshots confirm a goal-side pressure gap and shooters holding their real release positions instead of chasing completed shots.
- Animation performance passed at normal and 4x CPU profiles with average Canvas render costs of 0.340ms and 1.455ms. Hidden, covered, closed, rapidly reopened, and next-batch states all remained correct, and final scores still matched.

## 2026-08-07 Tactical Match Animation Pass

- User approved a lightweight realism pass after reviewing the current event-directed Canvas. Preserve deterministic results, match statistics, save compatibility, the observer identity, and mobile render budgets.
- Primary corrections: the authoritative event player must execute the shot or penalty, saves/blocks must use the real defender, interceptions must visibly transfer possession, and aerial height must not bend the top-down ground path.
- Tactical presentation: improve ball-side pressure, second-defender cover, compact defensive lines, supporting lanes, and contextual possession without adding collision physics, 3D, body animation, or a parallel match engine.
- Verification required: pure sequence/physics tests, actor identity assertions in `render_game_to_text`, fixed ordinary/goal/save/shootout scenes, the standard web-game client, desktop/mobile screenshots, full tests/lint/build, and animation performance audit.
- Event actors now resolve entirely from existing facts: scorer/miss player, paired assist, denied scorer/creator, credited goalkeeper/defender, and shootout goalkeeper UUID. Directed sequences map those identities to their real on-field slots; no save field or simulation result changed.
- Directed chances now deliver the final pass into a seeded attacking-third origin before the real shooter releases the shot. The reveal fast-forward atomically aligns ball, shooter, and release point instead of shooting from a stale midfield position.
- Interceptions immediately transfer possession at the interception point to the nearest active opponent. Free sequences use the real match possession split as a bounded visual bias.
- Aerial elevation is separate from the top-down ground path. One defender presses, another covers goal-side, the remaining block shifts laterally, same-side fullbacks overlap, and supporting attackers occupy separate lanes.
- Focused desktop/mobile tactical verification passes for a real creator-shooter-goal chain and denied-scorer-goalkeeper-save chain. Shootout verification passes at 1440x900, 320x568, and 390x844 with the authoritative taker as the final touch and the real goalkeeper present.
- Actual on-field indices now constrain pressure and cover selection, so dismissed players cannot remain as invisible defenders. Same-minute assist pairing is limited to the authoritative adjacent event and cannot leak across another incident.
- The standard web-game client completed three deterministic animation iterations with no browser error artifact. Desktop/mobile tactical screenshots were inspected after the ball, shooter, creator, defender, and shot source assertions passed.
- Final Node 22.22.2 verification passed 97 test files / 724 tests, ESLint, TypeScript/PWA production build, bundle and changelog budgets, ordinary-match presentation, shootout presentation, and tactical actor/path checks.
- Animation performance passed at normal and 4x CPU profiles. Average Canvas render cost was 0.203ms and 0.575ms; hidden, covered, closed, rapidly reopened, and next-batch states all remained correct, and final scores still matched.

## 2026-08-05 Immersive Match Live Pass

- User approved the recommended direction: replace numeric 3x playback with semantic highlight/live/immersive pacing, default to live, keep commentary text-led with lightweight feedback, and avoid interrupting ordinary simulation with automatic replays.
- Scope: authoritative penalty-shootout kick sequence, contextual commentary, reliable newest-first live-feed following, shootout-specific presentation, wider desktop broadcast layout, and desktop/mobile/reduced-motion verification.
- Preserve the lightweight observer-game identity, deterministic normal match results, existing matchday participation, and the current performant 2D canvas. Do not add 3D, TTS, or player body animation.
- Verification required: focused unit/component tests, full test/lint/build, match presentation and animation performance audits, required web-game client, and visual inspection of ordinary and shootout screenshots.
- Replaced aggregate-only shootout resolution with a seeded authoritative kick sequence covering alternating kicks, early clinches, sudden death, takers, goalkeepers, and scored/saved/off-target/woodwork outcomes. Match totals, event metadata, validation, replay, details, and live presentation now consume that same sequence.
- Reworked live pacing into `精华 / 直播 / 沉浸`, defaulting to live. The slower modes hold meaningful events and match breaks longer, while reduced-motion and the existing Canvas render budgets remain respected.
- Added event-grounded contextual commentary and a dedicated desktop broadcast rail. The newest-first feed follows the latest update until the user deliberately reviews older messages, then exposes an explicit new-update affordance instead of stealing scroll position.
- Added a shootout tracker with per-team kick marks, current shootout score, next taker, must-score/clinching/sudden-death states, and penalty-specific Canvas staging. Shootout events use `点1`/`骤1` labels rather than fake 121+ minute labels, and no longer contaminate ordinary equalizer or late-winner annotations.
- Mobile live controls now stay in a stable bottom control region outside the scrolling match content. At 320x568 and 390x844, controls fit without horizontal overflow and all interactive targets meet the mobile size threshold.
- Final verification under Node 22.22.2 passed 97 test files / 714 tests, ESLint, TypeScript/PWA production build, changelog and bundle budgets, ordinary-match presentation checks across four viewport/motion profiles, and dedicated shootout checks across desktop and two mobile viewports. Canvas movement, two-player penalty staging, score reconciliation, control bounds, and runtime-console checks all passed.
- The animation performance audit passed at normal and 4x CPU profiles with average Canvas draw costs of 0.287ms and 1.103ms. The player-defense long audit also remained clean across 72,910 matches, confirming that this presentation pass did not disturb simulation data.
- Production dependency audit still reports one high-severity ignored advisory with no actionable advisory record or upgrade action, matching the repository's previously documented audit exception.

## 2026-07-31 Contest Final Polish Phase 7

- Added six original, versioned visual assets for only the four approved families: Welcome universe hero, three reusable story chapter marks, live-score foundation, and season archive frame. No names, scores, season identifiers, Chinese copy, commands, or real club marks are baked into artwork.
- Welcome now uses one 126,952-byte full-bleed stadium/history scene and no longer runs the old random particle Canvas. The product name, observer premise, start path, lens choice, and action remain live text over a stable dark fallback.
- Dark horse, giant crisis, and promoted survival share one engraved broadcast family. Their 192px images remain route/surface lazy, while the existing shared Icon remains visible under every mark for Save-Data, extreme low-resource, high-contrast, and failed-image cases.
- Match Live uses a 12,692-byte neutral graphite foundation under dynamic team colors, live names, scores, and a real stage label. Mobile names use stable short names; visual QA found and fixed the 390px playback group clipping its 3x option.
- Season archive export dynamically imports, predecodes, and caches one 72,600-byte frame only after the export command. The 1200x1500 Canvas keeps all text and team color dynamic, falls back to the former plain background, and exported a visually inspected 1.98MB PNG in about 110ms.
- `docs/visual-assets.md` records generation source, version, use, dimensions, budgets, prompt intent, and delivery rules. PWA precaching now includes WebP.
- Dedicated production verification passed 320x568 reduced-motion, 390x844 mobile, and 1440x900 desktop with zero overflow and CLS, decoded live/story assets, lazy archive loading, no clipped playback modes, Save-Data/high-contrast/broken-request fallbacks, a 2.30s Welcome decode under a 1.6Mbps/150ms mobile profile, and offline Welcome replay.
- Final regression passed 94 test files / 699 tests, ESLint, frozen install, TypeScript/PWA production build, bundle/changelog budgets, production dependency audit with the existing documented ignored advisory, match presentation, storyline signals, 82 mobile route checks, the standard game client, and a 10-season/499-advance audit with zero data or runtime issues.

### Phase 8 Handoff

- Run three-person blind testing, refresh the repeatable 15-minute judge route, capture submission media, verify current Tencent contest rules, and perform the final Vercel/release gate.

## 2026-07-30 Season Observation Archive

- Reused the bounded primary-observer season trajectory as the archive identity. The only new frozen facts are preseason expected position, season-ending current judgment streak, representative player UUID, and a compact highest-deviation match summary; no standings, trophies, full results, event lists, or prose are duplicated.
- Added a pure archive descriptor for final fate, preseason deviation, cup paths, season-only judgment accuracy, restrained observation impressions, representative-player resolution, and exactly one next-season hook. Zero judgments remain `纯粹见证者`, one to four remain `记录形成中`, and only five or more receive a tested descriptive impression.
- Season Review now presents the archive conclusion before evidence. Dashboard exposes an explicit `Sx档案` tab, History adds a compact impression, and a still-resolvable deviation match links to its real memorable replay. Changing the primary favorite and advancing into later seasons cannot rewrite the archived team or facts.
- Added a deterministic `1200x1500` Chinese PNG export. Its roughly `2.5 KB` renderer is dynamically imported only after the user clicks `保存档案图`; the game card remains fully readable when export is unavailable.
- Current-save validation now enforces the 40-season cap, unique seasons, team references, four checkpoints, judgment invariants, theme values, and compact deviation facts. Fixed-seed tests cover pure/small/rated samples, promotion, championship without a cup, duplicate-name UUID identity, export naming, and malformed archive rejection.
- Final verification passed 90 test files / 680 tests, ESLint, TypeScript/PWA audit build, the standard game client, real PNG download, memorable-match replay, and `320x568`, `390x844`, `430x932`, and `1440x900` browser checks with no overflow. The 10-season audit completed 499 advances with zero issues; S150 completed 7,584 advances with zero issues, kept exactly 40 archives, matched all reload/advance digests, and stored 1,733,548 compressed bytes.

## 2026-07-30 Competition Format And Venue Pass

- Centralized competition venue policy now distinguishes genuine hosted league/super-cup fixtures from neutral single-leg cups, finals, World Cup matches, continental cups, and relegation playoffs. Prediction, simulation, result persistence, save validation, Calendar, Cup, Settings, and match details consume the same semantics.
- Continental cups now run in S5/S11/S17 on a six-season cycle. Mainland uses two four-team neutral groups followed by semifinals and a final; Southern/Eastern use one four-team neutral group followed by a final. Qualification remains based on the rolling five-season club coefficient.
- The World Cup keeps 32 teams and four pots but now uses three neutral single-round-robin group windows plus four neutral single-leg knockout windows. Invalid current-schema group schedules, duplicated pairs, wrong rounds, and venue mismatches are rejected at import.
- Removed hidden home-slot fallbacks from single-leg cups. Super Cup aggregate ties that the match simulator cannot anticipate are now resolved by a seeded, persisted shootout instead of favoring the second-leg home team.
- Final verification passed 89 test files / 669 tests, ESLint, TypeScript/PWA audit build, bundle/changelog budgets, production dependency audit with the documented router advisory exception, and 320/390/1440px World Cup/continental UI workflows. The 10-season browser audit completed 499 advances with zero errors/warnings; S150 completed 7,584 advances with zero errors/warnings and a 1,729,906-byte compressed save. Mobile advance p50/p95 was 16.2/26.1ms normally and 27.1/45.4ms at 4x CPU, with 20 rapid attempts accepting exactly one advance.

## 2026-07-30 Season Rollover Immutability Closure

- Added one explicit writable squad boundary for season and match-window orchestration. It copies player records plus injury and suspension histories before discipline cleanup, retirement, transfer, or annual age/rating/value mutation.
- `initializeNewSeason` and the real `season_end` path now preserve their input world deeply. Short injuries and every suspension reset in the returned season, active long-term injuries carry over, and old player/history objects remain untouched.
- Window handlers now receive a shallow writable calendar shell. Dynamic league-cup, super-cup, continental-cup, playoff, and World Cup fixture population is retained in the returned world without mutating current or future windows in the caller's calendar.
- Fixed the retirement-news lookup to retain a dedicated pre-retirement squad snapshot, preserving injury-forced retirement narratives after ownership isolation.
- Added regression coverage for nested squad cloning, direct new-season initialization, real season-end aging and injury rollover, and every World Cup phase window. Fixed-seed RNG, calendars, squads, save reloads, and next-advance digests remain deterministic.
- Final verification passed 89 test files / 672 tests, ESLint, TypeScript/PWA audit build, and the production browser audit. The 10-season audit completed 499 advances with zero errors/warnings; S150 completed 7,584 advances with zero errors/warnings or cap failures, all four browser checkpoint digests matched, and the S150 compressed save measured 1,730,538 bytes.

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

## 2026-07-22 Observer Gameplay And Contest Roadmap

- Created `docs/observer-gameplay-contest-checklist.md` as the durable roadmap for balancing narrative, lightweight interaction, operational convenience, feedback, historical payoff, and the contest-facing first five minutes.
- Froze the product role as an omniscient observer and historian rather than a manager: focus, prediction, time control, optional intervention, and historical review are allowed; lineups, tactics, training, and management progression remain out of scope.
- Kept the current default club and coach names unchanged for the personal classic universe. A separate original contest preset is explicitly deferred until submission preparation and must share the same engine rather than fork runtime logic.
- Prioritized existing prediction settlement correctness, a minimal observer-challenge loop, the first-five-minute path, model-grounded match explanations, three deterministic storyline lifecycles, and season/history integration before additional art or contest packaging.
- No runtime behavior, save data, names, or assets changed in this planning pass. Checklist items remain open until implementation plus automated, browser, deterministic, performance, and long-save verification all pass.

## 2026-07-22 Observer Gameplay Phase 1

- Unified match-bet settlement behind one pure execution boundary used by single-window, batch, next-cup, and season-end advance paths. Only completed fixture ids settle; unmatched predictions remain pending, malformed duplicate fixture rows pay once, and final outcomes include extra time plus shootouts.
- Removed the direct `world.coins` mutation from bet replacement. Focused store tests now cover immutable placement, wins/losses, unmatched fixtures, batch advance, cup jumps, and season-end jumps.
- Reframed God's Hand as an optional permanent universe intervention. The pure intervention engine records before/after attribute values without consuming RNG, enforces one use per season, caps history at 100 entries, emits a dedicated major news type, survives save export/reload, and remains visible in the History route.
- Added `verify:observer-foundation`, which validates batch settlement plus the intervention confirmation/history flow at `390x844` and `1440x900`, with no overflow or runtime errors. The standard web-game client was also run and its latest ambient-canvas screenshot inspected.
- Final verification passed 71 files / 535 tests, ESLint, TypeScript/PWA production build, changelog consistency, bundle budgets (272,945-byte main; 697,645-byte initial graph), Dashboard browser regression, and observer-foundation browser checks. Mobile advance remained responsive at 18/19.5ms normal p50/p95 and 31.7/41.7ms under 4x CPU, with one accepted and persisted advance from 20 rapid attempts.
- Validation note: the shell's default old Node failed before test startup, so all valid checks used the bundled Node 24 runtime. The first observer browser run also used the wrong accessibility role for the Dashboard's custom tab buttons; after correcting the verifier and adding explicit readiness waits, both viewports passed. Neither failed harness attempt was counted as product evidence.

## 2026-07-22 Observer Gameplay Phase 2

- Rebuilt the first-run screen as the actual observer setup rather than a feature-heavy landing page. `推荐体验` uses audited seed `20260718`; `自选宇宙` retains modes, optional primary team, custom seed, and the team editor; `纯观察` starts with no favorites.
- Added a deterministic audit over 20 candidate seeds and their first six windows. The selected seed led the bounded score with 18 model-defined upsets, 18 close matchups, five naturally focused windows, and 2.35 average goals without changing simulation rules or hard-coding outcomes.
- Made `favoriteTeamId` the explicit primary observer focus. Adding secondary favorites preserves the primary, settings can promote another favorite, persisted disagreement is normalized, and the primary fixture is guaranteed to lead the Dashboard focus list before unrelated marquee matches.
- Fixed restart navigation so beginning a universe from a Welcome screen reached through `/settings` or another stale route always returns to the Dashboard.
- Lazy-loaded Dashboard at the route boundary. The first build correctly failed the existing initial-graph budget at 701,700 bytes; after splitting, the main entry is 219,552 bytes and the initial graph is 548,593 bytes against the unchanged 700,000-byte budget.
- Added focused configuration, importance, favorite-ordering, seed-audit, and `verify:observer-onboarding` coverage. Final verification passed 74 files / 542 tests, ESLint, TypeScript/PWA production build, bundle budget, the standard game client, Dashboard browser regression, and complete recommended/neutral/custom onboarding at `390x844` and `1440x900` with no overflow or runtime errors.
- The browser verifier exposed two real defects during implementation: a primary team could still be displaced by unrelated marquee matches, and restarting from Settings could reopen Settings after initialization. Both were fixed and the complete flow was rerun successfully before checklist updates.

## 2026-07-22 Observer Gameplay Phase 3

- Replaced the runtime coin/odds betting loop with one optional observation judgment per window. The first version supports match outcome, final total goals (`0-2` / `3+`), and the existing prediction-based upset definition without consuming resources or changing RNG state.
- Added one immutable settlement path for single, batch, next-cup, and season-end advances. A fixture settles once; unmatched judgments stay pending; final outcomes include extra time and shootouts; a transient action summary survives multi-window skips.
- Added lifetime total/correct/current-streak/best-streak counters and capped detailed observation history at 50 rows. New worlds no longer initialize coins or bets; those fields remain optional deprecated save properties ignored by current gameplay. Save-size reporting now includes observation state.
- Moved the compact judgment control directly below focus matches. Results show judgment, actual outcome, hit/miss, and record before the animated sequence; fewer than five judgments display sample accumulation rather than a misleading percentage.
- Added `verify:observation-judgment` and updated the observer-foundation verifier to use the new model. Visual review caught the first placement below all fixture groups; the panel was moved beside the focus area and both viewports were rerun successfully.
- Final verification passed 74 files / 541 tests, ESLint, TypeScript/PWA production build, the 700,000-byte initial bundle budget (550,243 bytes), Dashboard/foundation/judgment browser workflows, and the 150-season long-save audit. S150 used 1,686,394 compressed bytes of the 4 MiB budget with no rollover errors; mobile advance p50/p95 was 18.7/23.7ms normally and 29/45.7ms at 4x CPU, with one accepted advance from 20 rapid attempts.

## 2026-07-22 Observer Gameplay Phase 4

- Added a structured public `MatchFactor` snapshot to the authoritative match model. Prediction and simulation now freeze the same top three category-distinct factors from team strength, available lineup, absence loss, morale, fatigue, momentum, venue, coach, competition fit, derby intensity, and underdog response.
- Added one destiny-deviation metric with normal, minor, upset, and major-upset tiers. Knockout results split the forecast draw branch between the two advancing sides, while regulation draws remain draws.
- Observation judgments, result animation stamps/importance, match details, upset news, and memorable-match collection now consume the same upset result instead of overall-rating or probability-gap variants.
- Match reports show up to two factual turning points reconstructed from persisted goals, own goals, red cards, extra time, and shootouts. With no reliable event they explicitly decline to invent a cause; real-time injury remains open because the match event schema has no injury event.
- Added `verify:match-explanation` for pre/post dialogs at 390x844 and 1440x900. Both viewports showed three model factors, visible deviation/turning sections, zero horizontal overflow, 44px close controls, and no runtime errors; screenshots were inspected.
- Final verification passed 75 files / 547 tests, ESLint, TypeScript/PWA build, the existing Dashboard/observation/live-match browser suites, and bundle budgets (219,666-byte main; 556,735-byte initial graph). The S150 save was 1,730,880 compressed bytes of 4 MiB. Mobile advance p50/p95 was 11.6/21.7ms normally and 26.7/43.7ms at 4x CPU, with one accepted/persisted action from 20 rapid attempts.

## 2026-07-22 Contest UI Polish

- Established a contest-facing night-broadcast thesis without changing simulation, persistence, or historical data semantics.
- Replaced the single-template club shield with deterministic club-ID visuals: six frames, four field patterns, and twelve center symbols. Abbreviations remain visible and every crest has an accessible full-name label.
- Added custom competition marks for all three leagues and six cup identities, seven mapped trophy forms, champion/promotion/relegation marks, and seven match-story stamps for derbies, finals, penalties, upsets, comebacks, late winners, and high-scoring games.
- Applied the identity system to Dashboard focus fixtures, ordinary fixture/result cards, League standings, Cup brackets, and the Team Detail club banner/trophy cabinet.
- Replaced the desktop cup tree's season-start blank space with a responsive round explorer. Mobile keeps readable abbreviations; desktop uses full club names and four-column match grids.
- Removed remaining 8-10px HTML labels from the five core surfaces, added keyboard activation to clickable fixture cards, and added a global reduced-motion fallback.
- Final verification passed 68 files / 519 tests, ESLint, TypeScript and production/PWA build, changelog consistency, and bundle budgets (274,592-byte main entry; 698,303-byte initial graph). Shared UI, Dashboard, player/team, and match workflows passed at 320x568, 390x844, and 1440x900 with zero overflow/runtime errors; representative screenshots were inspected and the desktop Cup layout was corrected from that evidence.
- Mobile advance remained responsive at 12.3/20.9ms normal p50/p95 and 30.9/39.1ms under 4x CPU, with one accepted/persisted action from 20 rapid attempts. Match rendering passed normal/4x profiles, hidden and covered views paused, reduced motion downgraded correctly, and the standard game client completed two iterations without an error artifact.

## 2026-07-23 Observer Gameplay Phase 5A

- Replaced the split mobile floating control with one `56x56px` advance action. It can be dragged, snaps to the nearest edge, remembers its position, supports keyboard nudging and Home reset, and defaults away from the bottom navigation/content area.
- A cross-page floating advance now waits for the simulation and then returns to the Dashboard results tab, so advancing from Teams, Players, or other secondary routes always produces visible result feedback.
- Reworked Dashboard story cards into deterministic, evidence-grounded live signals for dark horses, giant crises, and promoted-side survival. At most one primary-focus signal and one separate world signal are shown with a phase, factual evidence, and next observation point.
- Removed unsupported narrative claims about fans, management, dressing rooms, and dismissal rumors. No save-schema or simulation/RNG behavior changed; persistent lifecycle, cooling, endings, season review, and history integration remain the next story phase.
- Added focused component/engine tests plus `verify:floating-advance` and `verify:storyline-signals`. Floating interaction passed at 320x568, 390x844, 430x932, and 1440x900 with no overflow, no drag-triggered advance, restored position, and exactly one advance per tap.
- Full evidence: 76 files / 552 tests, ESLint, TypeScript/PWA build, bundle budget, Dashboard and observation regressions, story-signal browser checks, and the standard game client. Mobile advance p50/p95 remained 12.2/23.2ms normally and 27.1/59.5ms at 4x CPU; 20 rapid attempts accepted and restored exactly one advance.

### Phase 5A Handoff (completed in Phase 5B)

- Persist a bounded storyline lifecycle with cooling/hysteresis and explicit endings.
- Feed only story upgrades and endings into news, season review, and a compact history timeline.

## 2026-07-25 Observer Gameplay Phase 5B

- Added a deterministic, display-only `Storyline` lifecycle with `出现 / 发展 / 高潮 / 落幕`, two quiet-window hysteresis, six effective-window cooldowns, and factual success/failure conclusions for dark horses, giant crises, and promoted-side survival.
- Story detection runs once at the authoritative engine boundary after standings and coach pressure settle. Season-end finalization runs before promotion/relegation resets the tables. It consumes no RNG and cannot affect simulation, transfers, finances, or observation judgments.
- Bounded the director to eight active stories, eight starts per season, 60 completed stories, and 64 cooldown keys. Existing current saves initialize lazily; no compatibility migration or duplicated prose payload was added.
- Story news is emitted only for starts, phase upgrades, climaxes, and endings. Dashboard still selects at most one primary-focus and one world story, while focus fixtures show a team-qualified relation such as `泰山危机转折战`.
- Season Review and the History season directory now expose compact story endings with factual evidence and outcome-specific labels:兑现/回落、化解/延续、保级/降级.
- Added six constructed trigger/boundary scenarios per story type plus lifecycle, hysteresis, cooldown, ending, determinism, RNG, engine integration, news priority, and storage-cap coverage.
- Verification passed 77 files / 587 tests, ESLint, TypeScript/PWA build, bundle budget (566,179-byte initial graph), the standard game client, Dashboard/observation/story browser workflows, and mobile screenshot review.
- A 10-season/509-advance current-schema audit passed with zero errors or warnings across all audited routes. Mobile advance p50/p95 was 12.5/24.2ms normally and 30.3/52.3ms at 4x CPU.
- The 150-season audit completed 7,684 advances with zero rollover errors, warnings, or cap failures. S150 compressed storage was 1,739,090 bytes of 4 MiB; bounded storyline metadata used 6,772 bytes. S1/S50/S100/S150 browser reload and next-advance digests all matched.

### Remaining Story Enhancements

- Add key-win evidence to dark-horse detection and decisive cup-exit evidence to giant-crisis detection before marking those richer trigger definitions complete.
- The unified post-advance world response was completed in Phase 6A. A complete primary-team season trajectory remains broader than the existing story-ending section.

## 2026-07-25 Observer Gameplay Phase 6A

- Added a transient, deterministic `AdvanceWorldResponse` shared by single, batch, cup-target, and season-end advances. It records only the current operation's bounded presentation summary and is excluded from save persistence.
- Featured-result ranking prioritizes the primary observer team, other favorites, finals, upsets, and recency. At most three matches, two story updates, two other key-news candidates, and one observation settlement survive into the response.
- The compact response shows a real turning point for the primary result, falling back to the shared destiny-deviation explanation when no discrete event exists.
- Results now open on the compact response. The latest full result animation and curated news mount only after an explicit expand action; starred matches and finals retain the existing automatic live presentation.
- Successful header or floating advances from another route return to the response. All advance actions now report success, restore interaction on failure, expose a dismissible UI error, and avoid committing a locally partial batch.
- The response measured 329px high at 390x844 with zero horizontal overflow. Single and five-window batch flows, expansion, cross-route advance, bounded content, and error dismissal passed on mobile and desktop.
- Verification passed 78 files / 591 tests, ESLint, TypeScript/PWA build, the 570,358-byte initial graph budget, Dashboard/floating advance/match explanation/observation/world-response browser workflows, and the standard game client.
- The 10-season current-schema audit completed 509 advances with zero errors or warnings across audited routes. Normal advance p50/p95 was 12.7/18.6ms; 4x CPU was 31.6/48.8ms; 20 rapid attempts still executed and restored exactly one advance.

### Phase 6 Handoff

- The broader primary-team season trajectory was completed in Phase 6B.
- A later time-control pass still owns "next key node" skip guards, live `精华 / 1x / 3x`, and background/reduced-motion behavior.

## 2026-07-25 Observer Gameplay Phase 6B

- Added a bounded `ObserverSeasonTrajectory` for the primary observer team. At season end it replays completed authoritative league results through the shared standings sorter and freezes only four irreconstructible checkpoints: opening, midseason, run-in, and final.
- Final league/cup records, key player contribution, coach identity, trophies, and story endings remain derived from existing canonical history. The trajectory stores no duplicate match, player, or prose history and is capped at 40 seasons.
- Observation judgments now keep exact current-season totals, hits, and best streak alongside unchanged lifetime counters and the existing 50-row detailed history cap.
- Season Review shows the observed club's full name, four-stage path, final record, cup path, key contributor, judgment summary, and direct team/player/coach links. The History season directory freezes that season's observed club, so later favorite changes do not rewrite old focus records.
- Shared cup-round formatting now maps two-leg internal codes such as `QF-L2` and `SF-L1` to player-facing `八强` and `四强`.
- Focused tests cover replay ordering, cup exclusion, missing teams, same-season replacement, 40-season caps, cross-season judgment resets, all advance paths, season rollover, focus switching, and persistence.
- Visual verification passed at `1280x900` and `390x844`: no horizontal overflow, no console errors/warnings, readable four-stage layout, exact judgment summary, and valid team/player/coach links. The standard game client was also run and its screenshot inspected.
- Final verification passed 80 files / 597 tests, ESLint, TypeScript/PWA build, changelog, and the 572,316-byte initial graph budget. The 10-season audit completed 509 advances with no data/runtime issues across 25 mobile/desktop route checks.
- Mobile advance p50/p95 was 11.7/22.8ms normally and 30.9/42.7ms at 4x CPU. A favorite-team S150 audit completed 7,684 advances with zero rollover issues; trajectories stayed capped at 40, the compressed save was 1,731,946 bytes, and S1/S50/S100/S150 reload plus next-advance digests matched.

### Phase 7 Handoff (completed below)

- Guarded “next key node” time control was completed in Phase 7.
- Observation themes, related-match/trophy detail jumps, and richer dark-horse/key-cup evidence remain deliberately open in the durable checklist.

## 2026-07-26 Observer Gameplay Phase 7

- Unified the header fast-forward menu around a pure next-key-node planner. It previews the destination, reason, and number of windows to settle, then stops before the target window rather than simulating it.
- Key nodes include future starred fixtures, storyline climaxes, favorite-team derbies/title/relegation/knockout matches, cup stages, relegation playoffs, and season end. Cup group stages remain ordinary windows so the control does not stop too often.
- Unresolved observation judgments, starred current fixtures, and current key matches disable both the key-node jump and fixed 5/10-window controls. Fixed counts remain available as an explicitly continuous alternative outside guarded windows; there is no extra confirmation dialog.
- The key-node advance reuses the authoritative observation-settlement boundary and atomic world-response commit. It stops early after a judgment settlement or major storyline update and adds no persisted metadata.
- Verification passed 81 files / 605 tests, ESLint, TypeScript/PWA build, bundle and changelog budgets, the standard game client, world-response regression, and dedicated `390x844`/`1440x900` key-node flows with zero overflow/runtime errors. Both viewports advanced four windows to an uncompleted League Cup R32 node.
- Mobile advance performance remained healthy at 15.4/26.6ms p50/p95 normally and 26.7/56.4ms under 4x CPU. Twenty rapid attempts still executed and restored one advance.
- The 150-season audit completed 7,684 advances with zero rollover errors, warnings, or cap failures. S150 compressed storage was 1,731,946 bytes, and S1/S50/S100/S150 reload plus next-advance digests matched.

### Phase 8 Handoff (completed below)

- Live `精华 / 1x / 3x` playback speed and background/reduced-motion verification were completed in Phase 8.
- Observation themes, related-match/trophy detail jumps, richer dark-horse/key-cup evidence, and broader historical summaries remain open in the durable checklist.

## 2026-07-26 Observer Gameplay Phase 8

- Replaced the old `1x / 2x / 4x` live controls with `精华 / 1x / 3x`. Highlights is the default because it preserves important moments while fitting the observer game's first-five-minute and mobile pacing goals.
- Highlights uses one pure deterministic scheduler over the existing event cursor. Quiet periods advance in bounded five-minute steps; goals, own goals, red cards, penalties, goalkeeper saves, and defensive blocks are approached minute by minute and receive a short real-time hold.
- Halftime, extra-time, and shootout boundaries are clamped before event reveal, so no playback mode can cross a structural break. Modes never alter match events, final scores, RNG, simulation, or persisted state.
- The controls use one segmented mode group. At 320px the command group wraps to a second row; 390px and desktop remain compact. All mobile controls measure at least 44px and the control surface has zero horizontal overflow.
- Hidden pages freeze both the match clock and Canvas scheduler. Covered, manually paused, break, and completed states stop rendering. Reduced motion keeps the essential tactical view at 4fps/60 particles while shortening flashes, auto-scroll motion, and break/highlight holds; global nonessential CSS animation remains disabled.
- `render_game_to_text` now includes the active playback mode alongside minute, event, ball, lineup, and rendering state.
- Verification passed 82 files / 610 tests, ESLint, TypeScript/PWA build, bundle budget, the standard game client, and desktop/mobile/reduced-motion browser matrices. In 620ms, 1x advanced two minutes and 3x advanced six; 320px/390px controls had zero overflow.
- Normal/4x CPU animation audits passed with average Canvas draw times around 0.22/0.77ms, one or fewer consecutive slow frames, correct hidden/covered pauses, exact final scores, clean rapid reopen, and clean next-match reset.

### Phase 9 Handoff

- Observation themes and a repeatable 15-minute review route are the strongest remaining gameplay-feedback tasks.
- Related-match/trophy detail jumps, richer dark-horse/key-cup evidence, and broader historical summaries remain open in the durable checklist.

## 2026-07-28 Observer Gameplay Phase 9

- Added a display-only season observation theme derived from canonical standings, expectations, promotion history, squad ratings, current player stats, fixtures, and active story evidence. The five lenses are `豪门守成 / 黑马挑战 / 升级或保级 / 球员成长 / 纯观察`; automatic selection, manual selection, and disabled state never enter simulation or consume RNG.
- Recommended onboarding lenses now continue into a matching Dashboard theme. The compact panel exposes the real season phase, played/total league matches, up to three facts, and one next observation hook; theme preference persists while each new game starts from a coherent lens.
- Changed the young-player selector to prioritize prospects likely to play, after the first fixed-seed test found that maximum-potential-only selection could leave the theme static on a reserve.
- Added a repeatable browser review route covering a pre-match focus inspection, one optional judgment and settlement, two ordinary advances, a staged storyline update by window 6, visible team progress, and a continuing story hook. At both `390x844` and `1440x900`, changing or disabling the theme left window index, points, and RNG unchanged with zero overflow/runtime errors.
- Visual review caught and fixed the favorite summary's old mobile `大...` ambiguity; mobile now displays the stable club short name while desktop keeps the full name.
- Final verification passed 83 test files / 621 tests, ESLint, TypeScript/PWA production build, bundle/changelog budgets, the mandatory standard web-game client, and production-preview observation-route/onboarding/Dashboard/world-response/key-node workflows.
- The initial dependency graph remains within budget at 580,064 bytes. Mobile advance p50/p95 was 12.8/20.5ms normally and 28.3/49.3ms under 4x CPU; 20 rapid attempts accepted and restored exactly one advance.
- The 10-season current-schema audit completed 509 advances with zero data/runtime issues across 25 mobile/desktop route checks. The S150 audit completed 7,684 advances with zero rollover errors/warnings or cap failures; actual storage was 1,731,952 bytes, and S1/S50/S100/S150 reload plus next-advance digests matched.

### Phase 10 Handoff

- Freeze the completed theme result into the existing bounded primary-observer season trajectory and show it in Season Review without copying standings or player statistics.
- The broader Dashboard focus unification, related-match/trophy detail jumps, richer dark-horse/key-cup evidence, and historical world summaries remain open in the durable checklist.

## 2026-07-28 Observer Gameplay Phase 10

- Extended each bounded primary-observer trajectory with only the final theme type and an optional tracked player id. No standings, points, player totals, progress values, verdicts, or prose are duplicated.
- The store resolves the currently selected theme only when the authoritative `season_end` window is executed. A last-moment theme switch is archived; a disabled theme writes no theme reference.
- Added a pure completed-theme reader for giant defense, dark-horse challenge, promotion/survival, player growth, and neutral observation. Team verdicts use frozen `teamSeasonRecords`; player verdicts use the shared season stat selector and retain position-specific contribution semantics.
- Season Review now places the theme conclusion inside the existing primary-team observation archive, while the History season directory exposes a compact theme badge. Both continue to show the originally archived team after the live primary focus changes.
- Final verification passed 84 test files / 630 tests, ESLint, TypeScript/PWA production build, bundle/changelog budgets, the mandatory standard web-game client, and production-preview observation archive, Season Review, History, storyline, and 15-minute route workflows at mobile and desktop sizes. Dedicated archive checks survived reload and a later primary-team change with zero overflow or runtime errors.
- The initial dependency graph remains within budget at 587,337 bytes. Mobile advance p50/p95 was 15.1/22.8ms normally and 27.1/53ms under 4x CPU; 20 rapid attempts accepted and restored exactly one advance.
- The 10-season current-schema audit completed 509 advances with zero data/runtime issues across 25 mobile/desktop route checks. The S150 audit completed 7,684 advances with zero rollover errors/warnings or cap failures; actual storage was 1,732,478 bytes, the observer trajectory remained capped at 40 seasons, and S1/S50/S100/S150 reload plus next-advance digests matched.

### Phase 11 Handoff

- Unify the Dashboard's competing focus surfaces so the primary team, current observation theme, key fixture, optional judgment, and next action read as one compact observation sequence.
- Keep related-match/trophy detail jumps, richer dark-horse/key-cup evidence, and broader historical world summaries as separate bounded follow-ups in the durable checklist.

## 2026-07-28 Observer Gameplay Phase 11

- Reframed the Dashboard matchday opening as one `本轮观察` tool surface. The primary club, season theme, focus fixtures, optional judgment, and advance action now form one continuous hierarchy without changing prediction, simulation, RNG, or persistence.
- Dashboard owns the only `开始模拟` action on the home route. The global header keeps its fast-forward menu there, while other routes retain their existing header advance and optional floating advance behavior.
- The collapsed judgment and advance action share one 44px action row. Expanding the judgment preserves exactly one advance action; settling a choice returns to the compact row.
- Mobile keeps the primary focus fixture at full detail and compresses only the second focus fixture to a 44px actionable row. Desktop keeps both fixtures fully expanded.
- The primary focus fixture now exposes one canonical key player without adding a second statistic source: the current team scorer when available, otherwise the highest-rated current squad player. It replaces one generic reason chip, so information density stays bounded.
- The first performance run exposed that moving the home action out of the header left the Results tab without visible first-frame feedback or a direct continuation. Results now owns the same single action after a response; Matchday and Results never show their actions at the same time.
- The dedicated three-favorite production workflow passes at `390x844` and `1440x900`: all focus controls share one container, the mobile advance action ends at 840px inside the first viewport, secondary focus remains clickable, one judgment and one window settle, Results exposes one 44px continuation, horizontal overflow is zero, and runtime errors are zero.
- Final verification passed 85 test files / 632 tests, ESLint, TypeScript/PWA production build, bundle/changelog budgets, the mandatory standard web-game client, and production Dashboard, theme, judgment, key-node, world-response, and report workflows.
- The initial dependency graph remains within budget at 587,328 bytes. Mobile advance p50/p95 was 18.6/27.1ms normally and 36.9/67.1ms under 4x CPU; every sample rendered busy feedback first, and 20 rapid attempts accepted and restored exactly one advance.
- The 10-season current-schema audit completed 509 advances with zero data/runtime issues across 25 mobile/desktop route checks. The S150 audit completed 7,684 advances with zero rollover errors/warnings or cap failures; actual storage was 1,732,478 bytes, and S1/S50/S100/S150 reload plus next-advance digests matched.

### Phase 12 Handoff

- Add explicit boundary tests for focus-match priority and suppress remaining duplicate fixture mentions across the focus tool, secondary notices, and ordinary news surfaces.
- Refine the single state-aware action vocabulary for starred live viewing, ordinary reveal, and post-result continuation without adding more buttons or changing simulation behavior.

## 2026-07-29 Observer Gameplay Phase 12

- Made focus selection explicitly lexicographic and deterministic: primary observer club, knockout stage, title/relegation stakes, derby, marquee matchup, existing importance, then fixture id. Boundary tests prove the hierarchy even when a lower-priority derby has a higher raw score and when fixture input order is reversed.
- Replaced substring-based cup-stage detection with explicit `Final / SF / QF / R16` and Chinese/long-form parsing. `Semi-final`, `Quarter-final`, and `半决赛` no longer inherit the final bonus; ordinary world responses likewise reserve decisive-final weighting for an actual final.
- Added an optional fixture reference only to match-derived upset, hat-trick, and late-drama news. The Dashboard full report excludes news for every result it already renders, while the global ticker excludes the currently featured world-response fixtures. Existing bounded news history remains unchanged.
- Kept focus cards, secondary notices, world-response rows, and ordinary news traceable by fixture id. The dedicated browser route verifies no focus/notice or featured/news intersection instead of relying on text coincidence.
- Replaced the fixed Dashboard action label with one pure state vocabulary: `揭晓本轮`, `揭晓判断`, `观看焦点`, `观看并揭晓`, `继续观察`, plus one shared busy state. The same single button still calls the existing advance action and consumes no additional RNG.
- The production browser flow passed at `390x844` and `1440x900`: all four pre-match action states appeared, a starred focus opened the real live replay, exit reached the settled world response, one judgment settled, the continuation remained 44px, the mobile action ended at 840px, and duplicate ids, overflow, and runtime errors were all zero.
- Final mandatory canvas inspection exposed an existing welcome-background edge case: a drifting icon could use a negative modulo index and draw the literal word `undefined`. Each icon particle now keeps one glyph assigned at creation, eliminating the invalid draw and visual flicker.
- Final verification passed 86 test files / 639 tests, ESLint, TypeScript/PWA production build, bundle/changelog budgets, the mandatory standard web-game client with visual inspection, and the Dashboard, judgment, world-response, observation-theme, and ten-season production workflows.
- The initial dependency graph remains within budget at 588,767 bytes. Production mobile advance p50/p95 was 16.7/20.9ms normally and 32.3/51.1ms under 4x CPU; every sample rendered busy feedback first, and 20 rapid attempts accepted and restored exactly one advance.
- The 10-season current-schema audit completed 509 advances with zero data/runtime issues across 25 mobile/desktop route checks. The S150 audit completed 7,684 advances with zero rollover errors/warnings or cap failures; actual storage was 1,732,722 bytes, and S1/S50/S100/S150 reload plus next-advance digests matched.

### Phase 13 Handoff

- Audit the already-recorded observation streak, season accuracy, and total-count feedback against checklist 4.3; fill only any missing presentation or season-archive link without introducing rewards or a second progression system.
- Keep related-match/trophy detail jumps and broader historical world summaries as separate bounded follow-ups after the observation feedback audit.

## 2026-07-30 Contest Engineering Audit Closure

- Upgraded React Router to the latest published stable release and documented the single ignored advisory. Its affected RSC server-action path is absent from this static BrowserRouter application; production audit exits successfully.
- Removed the game-store audit bridge from ordinary production bundles. Browser audits now require both the dedicated `build:audit` command and the `?audit` query, while CI uses that explicit path.
- Added a root Error Boundary with reload, home, and confirmed save-reset recovery paths. A forced lazy-chunk failure reached the recovery UI cleanly on mobile with no secondary runtime errors.
- Made season-window execution copy squads, players, injury histories, and dynamically assigned playoff calendars before mutation. Fixed-seed tests and a runtime identity probe confirm the input world remains deep-equal and returned nested objects are not shared.
- Replaced shallow save and custom-team checks with structural validation for all teams, states, squads, players, UUID references, numeric ranges, fixtures, results, calendar state, and league quotas. Malformed nested saves and duplicate player identities are rejected before persistence.
- Changed MOTM aggregation and storage from display names to player UUIDs, while retaining player name and team identity for presentation. Duplicate-name players can no longer merge into one candidate.
- Pinned Node 22.12.0 and pnpm 10.34.5 across local metadata and CI, refreshed README scale/commands, and published the v4.23.0 changelog and security-audit rationale.
- Final verification passed 88 test files / 648 tests, ESLint, frozen install, TypeScript/PWA production build, bundle/changelog budgets, match presentation at desktop and two mobile widths, Error Boundary browser recovery, and production bridge absence.
- The 10-season audit completed 509 advances with zero issues. The S150 audit completed 7,684 advances with zero rollover errors/warnings or cap failures; actual storage was 1,735,758 bytes and S1/S50/S100/S150 reload plus next-advance digests matched.
- Production mobile advance p95 measured 21.6ms normally and 54.3ms under 4x CPU. Every sample rendered feedback first, and 20 rapid attempts accepted exactly one advance.

## 2026-07-30 Contest Final Polish Planning

- Added `docs/contest-final-polish-checklist.md` as the bounded execution plan after v4.23.0. It separates eight independently verifiable phases: season-rollover immutability, competition format/venue semantics, season observer archive, mobile route consistency, key audiovisual feedback, historical season summaries, original visual assets, and blind-test/submission closure.
- The plan defines canonical data sources, persistence and performance limits, mobile/desktop acceptance matrices, release gates, and explicit exclusions. It keeps the observer identity intact and defers manager systems, currencies, branching saves, IndexedDB, aggressive compaction, and broad asset production.
- No feature implementation was marked complete during planning. Future phases must update the new checklist only after automated, browser, performance, and long-save evidence passes.
- Added a dedicated competition-design phase: continental cups move from every four seasons to S5 and every six seasons thereafter, using the existing five-season coefficient and a compact neutral-venue group-plus-knockout format; the World Cup moves from six to three neutral group rounds while retaining four single-leg neutral knockout rounds. A full venue matrix prevents home advantage from leaking into neutral fixtures while preserving it for league and genuine two-leg home/away matches.

## 2026-07-30 Contest Final Polish Phase 4

- Completed the mobile all-route interaction pass without changing simulation, RNG, or persisted game data. Mobile detail routes now have deterministic return targets, drawer rows are fully actionable, and Team Editor rows support focus, Enter, and Space.
- Replaced local tab implementations on Dashboard, Coaches, Chronicle, Advanced Search, and Memorable Matches with the shared segmented control. Selected tabs scroll into view, expose proper tab semantics, and retain compact desktop density.
- Established a 44px mobile target floor, visible global focus treatment, safe-area-aware shell spacing, 11px minimum microcopy, and tabular numeric rendering. Truncated club, player, coach, competition, and story labels now retain a full accessible name.
- Reworked Memorable Matches and Team Editor at narrow widths so club identity remains distinguishable instead of collapsing to a single character or unexplained ellipsis.
- Added `verify:mobile-routes`, a fixed-seed production browser audit covering 22 routes/states across `320x568`, `390x844`, `430x932`, `1280x720`, and `1440x900`. Its 82 route/viewport checks also cover drawer focus restoration, keyboard rows, detail return, selected-tab scrolling, large text, reduced motion, offline revisit, Welcome, and Error Boundary recovery.
- Final verification passed 90 test files / 680 tests, ESLint, TypeScript/PWA production build, bundle/changelog budgets, match presentation, floating advance, and the standard game client. The 10-season audit completed 499 advances with zero errors or warnings.
- Mobile advance p50/p95 measured 14.7/19.5ms normally and 33.6/61.3ms under 4x CPU. Twenty rapid attempts accepted exactly one advance; match animation remained within its desktop/mobile/reduced-motion budgets.

### Phase 5 Handoff

- Add a deliberately small feedback layer for start observation, goals, major upsets, story escalation, and season end.
- Keep audio and optional haptics nonessential, rate-limited, persisted through one global preference, and absent from simulation or the initial critical bundle.

## 2026-07-30 Contest Final Polish Phase 5

- Added five deliberately short feedback cues for start observation, live goals, major upsets, major story escalation, and season end. Existing transitions, score flashes, deviation labels, story cards, and season archives remain the sole visual source of truth.
- Ordinary matches, ordinary news, and batch advancement stay silent. One completed world response selects at most one global cue in the order season end, major upset, then major story; per-cue and haptic limits prevent repeated playback.
- Added one persisted global sound preference and a separately persisted, default-off haptic preference outside the game save. The header exposes the global control, Settings explains both controls, and Match Live shares the global state while retaining a local mute.
- AudioContext is created or resumed only after a pointer or keyboard gesture. Hidden pages, reduced motion, extreme low-resource environments, disabled sound, missing Web Audio, and a failed optional chunk all degrade without touching advancement or rendering.
- Haptics are restricted to major upsets and season end, never carry exclusive information, and silently skip browsers without `navigator.vibrate`. Browser validation caught and fixed a first-use rate-limit boundary that could suppress an immediate season-end vibration.
- All tones are generated from original in-repo Web Audio parameters documented in `docs/audio-feedback.md`. The tone definitions load on first actual feedback as a 1,340-byte / 510-byte gzip chunk and are absent from the initial dependency graph while remaining PWA-precacheable.
- Dedicated production-browser validation passed first-gesture unlock, 44px global control, persisted mute, live/global semantics, one three-tone and one-vibration season ending, reduced-motion suppression, offline revisit, and zero mobile overflow/runtime errors.
- Final verification passed 92 test files / 687 tests, ESLint, TypeScript/PWA builds, bundle/changelog budgets, match presentation, animation performance, the standard game client, and a ten-season 499-advance audit with zero data warnings or errors.
- Mobile advance p50/p95 measured 15.5/25.2ms normally and 30.3/56.4ms under 4x CPU. Match Canvas averaged 0.31/0.88ms per draw under normal/4x CPU and retained hidden/covered pauses, exact final scores, and clean reopen/reset behavior.

### Phase 6 Handoff

- Build the bounded History summary answering “what happened this season” from frozen season records, archived story conclusions, canonical destiny deviation, and existing awards.
- Keep each season to five to seven events, render details on demand, and avoid storing duplicate standings, results, or prose unless an old bounded record cannot reproduce the fact.

## 2026-07-31 Floating Advance All-Route Fix

- Made the floating advance action default-on for initialized games and available on Dashboard plus every routed game page, while preserving the explicit global hide preference. Welcome and pre-game Team Editor remain excluded because no season can advance there.
- Restricted drag and restore coordinates to the current route content rectangle, keeping the control away from the desktop sidebar, mobile header, and news strip. Existing modal and drawer layers remain above it.
- Stored edge, relative vertical position, and viewport dimensions alongside legacy absolute coordinates. Same-view reloads remain pixel-stable, while viewport and breakpoint changes restore the control inside the new usable area.
- Expanded `verify:floating-advance` from one route to 27 routes across `320x568`, `390x844`, `430x932`, and `1440x900`, for 108 route checks plus preference, drag, reload, resize, dashboard persistence, and exactly-once advancement.
- Final verification passed 92 test files / 690 tests, ESLint, TypeScript/PWA audit build, and browser visual inspection. The change does not touch simulation, RNG, save schema, or the advancement computation path.

## 2026-07-31 Contest Final Polish Phase 6

- Added a read-only season-history summary derived from frozen honors, trophy records, the canonical destiny-deviation snapshot, completed storylines, player awards, and team season records. No persisted field, random decision, or parallel ranking was introduced.
- Every completed season now yields three fixed facts (league champions, major cups, promotion/relegation) plus the largest available destiny deviation, at most two archived story endings, and one representative award winner, capped at seven events.
- Added evidence thresholds for long-term labels: at least three consecutive top-flight titles for a dynasty, two adjacent promotion/relegation seasons for a movement run, and three consecutively worse seasons with a material level or position decline.
- History defaults to the latest ten seasons and can switch to the latest forty or all seasons. The compact narrative opens first; the existing full Season Review remains available behind a second on-demand control.
- Entity links resolve teams, award-winning players, and champion coaches only when their canonical records still exist. Trimmed memorable-match detail falls back to a score, competition, round, and canonical pre-match probability summary.
- Added six fixed-seed unit tests plus `verify:history-summary` for mobile/desktop interaction and synthetic S40/S100/S150 route, filter, scroll, and expansion budgets. The S150 summary expanded in about 31ms and switching all 150 rows took about 11ms.
- Full verification passed 93 test files / 696 tests, ESLint, the 82-check mobile route audit, and a ten-season 499-advance current audit with zero data issues. The real S150 audit completed 7,584 advances with zero warnings/errors; all reload/next-advance digests matched and storage remained 1,733,574 bytes.

### Phase 7 Handoff

- Produce only the four bounded asset families already listed in the contest checklist: start-observation hero, three story chapter marks, live-score foundation, and season archive frame.
- Keep all names, scores, season numbers, and Chinese copy as accessible live text; no functional command should become a bitmap.
