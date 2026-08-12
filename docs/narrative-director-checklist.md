# Narrative Director Implementation Checklist

Status: in progress; ND-0 through ND-2 complete  
Target release: v4.54.0  
Last updated: 2026-08-12  
Source of truth: this checklist supersedes conversational planning when a future session resumes the work.

## 0. Product Goal And Frozen Rules

The objective is to make the existing simulation depth perceptible through causality, interaction, continuity, and emergence. This is an orchestration and presentation project, not a second simulation engine.

- [x] Keep the player in the observer role.
- [x] Keep the existing Observation Theme, Judgment, focus-match, live-match, Season Review, Archive, and History loop.
- [x] Preserve the East Asian football annual and live broadcast visual direction.
- [x] Reuse all current Welcome, Story Chapter, World Moment, match broadcast, champion, and archive assets.
- [x] Keep Narrative code read-only with respect to authoritative simulation outcomes.
- [x] Keep identical seed plus identical actions deterministic.
- [x] Do not add AI runtime, a backend, networking, 3D, manual lineups, manual tactics, training, contracts, or manager gameplay.
- [x] Do not create duplicate standings, match results, player statistics, or history databases.
- [x] Do not expose hidden player potential or internal Narrative scores.
- [x] Keep generated prose separate from authoritative facts.
- [x] Keep the default Dashboard surface quieter while preserving full information behind an expandable detail surface.
- [x] Never add a new Dashboard section merely because a new Narrative source exists.

## 1. Final Experience Contract

### Matchday

- [x] Keep the full Observation Runway before all Narrative content.
- [x] Keep Observation Theme, focus fixtures, Judgment, and Advance visible in the first mobile workflow.
- [x] Add one `World Pulse` digest below the runway.
- [x] Show at most one world feature and two compact side signals.
- [x] Put all remaining deduplicated content in `More This Window`, collapsed by default.
- [x] Keep the full fixture list available after the digest.
- [x] Show a relation badge on a focus fixture when it belongs to the same Narrative arc; do not repeat the arc copy.

### Results

- [x] Upgrade WorldResponse into a clear sequence: pre-match factors, match turning points, result deviation, consequences.
- [x] Show why a result mattered without claiming Narrative evidence caused the result.
- [x] Show at most one large World Moment visual per advance action.
- [x] Keep complete results and the curated news feed collapsed by default.
- [x] Preserve direct access to match details, replay/live view, Season Review, and the next Advance action.

### Overview

- [ ] Show season shape rather than latest-window noise.
- [ ] Keep the observed-team trajectory.
- [ ] Add compact title, promotion, and relegation landscapes.
- [ ] Show at most three sustained Narrative arcs.
- [ ] Surface meaningful changes to followed players without turning the page into a player database.

### Detail And History

- [ ] Add a compact, collapsible current context or career-thread block to Team, Player, and Coach detail pages.
- [ ] Derive detail timelines from canonical season records, transfers, awards, injuries, careers, trophies, and Storyline history.
- [ ] Connect resolved arcs to Season Review and season-history summaries.
- [ ] Avoid a second long-term event store unless a fact cannot be reconstructed reliably.

## 2. Target Architecture

```text
Authoritative simulation facts
  -> Narrative source adapters
  -> NarrativeCandidate pool
  -> semantic merge and dedupe
  -> deterministic Narrative Director
  -> visual level selection
  -> Matchday / Results / Overview / Detail / History
```

### Candidate Contract

- [x] Add a structured candidate contract under `src/engine/observation`.
- [x] Include stable `id`, `arcKey`, `eventKey`, source, subject type, and subject IDs.
- [x] Separate `causes`, `evidence`, `turningPoints`, and `consequences` into typed fact arrays.
- [x] Include an optional destination and structured visual family.
- [x] Include a factual fingerprint and factual `changedAt` value.
- [x] Keep relevance, importance, novelty, continuity, and historical weight internal.
- [x] Use stable ID tie-breakers after score comparison.
- [x] Never persist the complete candidate pool or generated descriptions.

### Semantic Dedupe

- [x] Merge by stable structured arc identity and season, using structured subjects/fixtures as retained evidence; never merge by Chinese title text.
- [x] Merge Observation Theme, Storyline, focus fixture, result, and news when they describe one arc.
- [x] Preserve all unique evidence and destinations after merging.
- [x] Prefer authoritative structured sources over free-form News text.
- [x] Keep one main presentation and convert related sources into evidence, next watch, or relation badges.

### Attention Budget

- [x] Keep Slot A as the existing Observation Theme.
- [x] Select at most one Slot B world feature.
- [x] Select at most two Slot C signals.
- [x] Allow Slot B to be empty when no candidate clears the quality threshold.
- [x] Keep selected slots on distinct semantic arcs.
- [x] Keep remaining candidates available in the collapsed detail surface.
- [x] Prevent unchanged fingerprints from repeatedly receiving headline treatment.

### Narrative Memory

- [x] Add only the minimum bounded presentation memory needed for novelty suppression.
- [x] Store at most 32 arc entries containing `arcKey`, fingerprint, last change, and last selection.
- [x] Keep memory outside authoritative simulation decisions.
- [x] Ensure changing or clearing Narrative memory cannot change matches, transfers, injuries, tables, or RNG.
- [x] Validate save-size impact before accepting the field (representative 32-entry payload: 4,215 bytes).

### Implemented Ownership Map (ND-0 to ND-2)

- Authoritative outcomes remain in `season-manager`, `MatchResult`, standings, player/team state, Storylines, transfer records, and News. Narrative adapters only read these values.
- `narrative-sources.ts` is the bounded translation layer. It caps each source family before constructing typed candidates and never parses Chinese display text to recover IDs.
- `narrative-director.ts` owns deterministic merge, ranking, attention budgets, novelty suppression, and presentation-safe output. It never receives or mutates the simulation RNG.
- `game-store.ts` persists only the bounded `narrativeMemory` and the existing `lastWorldResponse`; complete candidate pools and generated descriptions are not stored.
- `Dashboard.tsx` assembles current source inputs and interaction callbacks. `NarrativeDigest.tsx` owns Matchday presentation, while `WorldResponseSummary.tsx` owns post-advance causality presentation.
- Match details and replay continue to consume the same canonical `MatchResult` used to build WorldResponse, so score, forecast factors, turning points, and tactical snapshots cannot fork into a second result model.

## 3. Source Scope

### First-Class Sources

- [ ] Observation Theme.
- [ ] Existing active and resolved Storylines.
- [ ] Focus fixtures and locked watch fixtures.
- [ ] Match prediction factors and frozen pre-match tactics.
- [ ] Destiny Deviation and real MatchResult turning points.
- [ ] Player match highlights and season leaders.
- [ ] Followed players and U23 breakout candidates.
- [ ] Coach pressure, dismissal, hiring, and credible turnaround signals.
- [ ] Major transfer rumors, completed major transfers, and post-transfer performance.
- [ ] Trophies, finals, promotion, relegation, continental cups, and the World Cup.
- [ ] Reliable records and season-history events.
- [ ] Structured high-importance News items not already represented by another source.

### Explicitly Deferred Or Rejected Sources

- [x] No revenge-against-former-club stories without canonical relationship data.
- [x] No media controversy, board conflict, personality drama, or invented dressing-room narrative.
- [x] No player potential story that exposes `peakRating`.
- [x] No separate persistent Storyline schema for every Player and Coach signal.
- [x] No image family per Narrative type.

## 4. Story Model Decisions

### Existing Persistent Team Stories

- [ ] Preserve `dark_horse` lifecycle and improve its dedupe with Observation Theme.
- [ ] Preserve `giant_crisis` lifecycle and connect coach-pressure consequences.
- [ ] Preserve `promoted_survival` lifecycle and connect promotion/relegation history.
- [ ] Keep bounded active stories, history, cooldowns, and per-season limits.

### New Persistent Stories

- [ ] Add `unbeaten_run` only after a meaningful threshold; a normal three-match run stays a signal.
- [ ] Add trigger, development, climax, end, cooldown, and season-boundary tests for `unbeaten_run`.
- [ ] Add `cup_giant_killer` only after repeated or high-stage upsets supported by frozen prediction data.
- [ ] Add trigger, development, climax, end, cooldown, and season-boundary tests for `cup_giant_killer`.
- [ ] Keep title contention as a multi-team Competition Arc rather than duplicating one persistent story for every contender.

### Derived Player Signals

- [ ] U23 breakout based on age, minutes, current performance, and real contribution.
- [ ] Scoring or contribution streak based on chronological completed matches.
- [ ] Current season leader based on canonical rankings.
- [ ] Veteran resurgence based on age and actual season performance.
- [ ] Major injury as a Moment; only connect it to an Arc when subsequent factual change exists.
- [ ] Record chase only when the target record and distance are authoritative.
- [ ] Never predict a last dance before a real retirement or declared final-season fact exists.

### Derived Coach Signals

- [ ] High pressure based on current pressure and factual recent form.
- [ ] Pressure rising only when a real previous value or event delta is available.
- [ ] Dismissal and hiring from canonical coach events.
- [ ] New-coach turnaround only after sufficient before/after match samples.
- [ ] Connect tactical identity to match explanation without claiming tactics alone caused the outcome.

## 5. Visual Contract

- [x] Level 1 Signal uses an icon, one line, and no image.
- [x] Level 2 Story Chapter uses TeamBadge or an existing StoryChapterMark.
- [x] Level 3 World Moment uses one existing `rise`, `fall`, `legacy`, `transfer`, or `stage` asset.
- [x] Select visual family from structured Narrative data, not regex over Chinese prose.
- [x] Never place a World Moment image before the first-view Judgment and Advance controls.
- [x] Keep one Level 3 visual maximum per advance.
- [x] Preserve DecorativeImage loading, failure fallback, Save-Data suppression, high contrast, reduced motion, and low-performance fallback.
- [x] Keep all current match opener, live scoreboard, champion, archive, and Welcome assets unchanged.

## 6. Execution Work Packages

The packages below are the recommended Codex session boundaries. Files that share data contracts are deliberately grouped so a future session does not repeatedly reload the same context.

### ND-0: Baseline And Contracts

Status: complete (2026-08-12)  
Recommended commit boundary: yes  
Why grouped: types, structured references, memory, and deterministic selection must agree before any UI consumes them.

- [x] Record the current Dashboard source map and authoritative ownership rules.
- [x] Add Narrative types, facts, destinations, source references, digest, and memory contracts.
- [x] Add optional structured subject metadata to new News items where source adapters otherwise cannot identify subjects safely.
- [x] Implement Candidate merge, semantic dedupe, stable scoring, thresholds, and 1+1+2 selection.
- [x] Implement bounded Narrative memory or document why source timestamps are sufficient without it.
- [x] Add deterministic and mutation-safety tests.
- [x] Add tests for relevance, novelty, continuity, historical override, stable ties, empty Slot B, and hard attention limits.
- [x] Prove that Narrative selection does not consume simulation RNG.

Done only when:

- [x] Focused Narrative tests pass.
- [x] Existing Storyline, Observation Theme, WorldResponse, and News tests pass unchanged or with intentional assertions.
- [x] TypeScript and ESLint pass for touched files.
- [x] Repeated identical input produces byte-equivalent digest output.

### ND-1: Matchday World Pulse

Status: complete (2026-08-12)  
Depends on: ND-0  
Recommended commit boundary: yes  
Why grouped: matchday source adapters, Dashboard extraction, compact components, and mobile layout must be tuned together.

- [x] Add adapters for Observation Theme relations, active Storylines, focus fixtures, window tips, player highlights, rumors, competition stages, and coach pressure.
- [x] Build `NarrativeDigest`, `NarrativeFeature`, `NarrativeSignalRow`, `NarrativeEvidence`, and `MoreWorldSignals` without over-fragmenting components.
- [x] Replace separate FavoriteStoryPanels, Player Highlights, Window Tips, and favorite Rumor blocks with one World Pulse.
- [x] Preserve every old item in the expanded detail surface when it is not selected.
- [x] Keep the full fixture list and all existing match controls.
- [x] Add relation badges to focus matches sharing the selected arc.
- [x] Remove hidden-potential wording and `peakRating` display from the Player Growth observation theme.
- [x] Reduce Dashboard responsibilities to data assembly, tabs, and interaction wiring.

Done only when:

- [x] Unit/component tests prove 1+1+2 and expanded-detail preservation.
- [x] 320x568, 390x844, 430x932, tablet, 1280, and 1440 layouts have no overflow or inaccessible controls.
- [x] 390x844 can still complete Theme, focus selection, Judgment, and Advance before Narrative imagery interferes.
- [x] Existing focus-watch and floating-advance workflows pass.

### ND-2: Result Causality And WorldResponse

Status: complete (2026-08-12)  
Depends on: ND-0  
Recommended commit boundary: yes  
Why grouped: post-advance candidates, match explanation, consequences, and World Moment selection share the same authoritative result snapshot.

- [x] Extend AdvanceWorldResponse rather than creating a parallel result store.
- [x] Build result candidates from frozen MatchResult prediction factors, tactics, featured players, events, standings effects, Storyline changes, coach events, and key News.
- [x] Render pre-match factors, turning points, deviation, and consequences in distinct semantic groups.
- [x] Add `Why this mattered` and `What changed next` interactions.
- [x] Use structured `visualKind` and historical importance to select a single World Moment.
- [x] Keep complete results and News collapsed and accessible.
- [x] Keep archived-detail fallbacks honest when events have been pruned.

Done only when:

- [x] Explanation tests prove causes come from MatchFactor, turning points from MatchResult, and evidence is never labelled as a cause.
- [x] WorldResponse tests cover single advance, batch advance, key-node advance, season boundary, final, upset, ordinary result, and no-major-moment cases.
- [x] Match details and WorldResponse agree on forecast, score, turning point, and tactical snapshot.
- [x] Browser checks pass result reveal, replay/live opening, full-report expansion, Season Review, and next Advance.

### ND-3: Story Expansion

Status: pending  
Depends on: ND-0 and ND-2  
Recommended commit boundary: yes  
Why grouped: persistent Storyline thresholds, lifecycle, News, season conclusions, and History mappings should be calibrated as one engine-only change.

- [ ] Implement chronological streak reconstruction from completed authoritative fixtures.
- [ ] Add `unbeaten_run` detection and lifecycle.
- [ ] Add `cup_giant_killer` detection using frozen forecast probability and competition stage.
- [ ] Add bounded phase milestones only if current fields cannot support `Later` honestly.
- [ ] Update StoryChapter/WorldMoment mapping without generating new art.
- [ ] Update Season Review and season-history summary labels and conclusions.
- [ ] Calibrate thresholds over multiple leagues and competition formats.

Done only when:

- [ ] Trigger, non-trigger, development, climax, interruption, cooldown, conclusion, and season-boundary tests pass for both new stories.
- [ ] Ordinary short runs and single low-stage upsets do not create persistent stories.
- [ ] Active/history/cooldown caps remain effective.
- [ ] Multi-seed audits show believable frequency without crowding out existing stories.

### ND-4: Player, Coach, Transfer, Competition, And Record Signals

Status: pending  
Depends on: ND-0, preferably after ND-3  
Recommended commit boundary: yes  
Why grouped: these remain derived signals and can share one bounded world-scan, ranking cache, and source-adapter test harness.

- [ ] Implement the approved Player signals.
- [ ] Implement the approved Coach signals.
- [ ] Implement major rumor, completed transfer, and post-transfer resurgence signals.
- [ ] Implement title race, promotion/relegation decider, final, continental, and World Cup Competition arcs.
- [ ] Implement record signals only for records with canonical targets.
- [ ] Apply favorite-team and eight-player watchlist relevance.
- [ ] Ensure every position can appear in Player Narrative signals.
- [ ] Cap each adapter before merging so the Director never receives an unbounded pool.

Done only when:

- [ ] Source tests cover true, false, threshold-edge, transfer-segment, injury, firing, hiring, and competition-stage cases.
- [ ] No signal exposes hidden potential.
- [ ] No source parses Chinese prose to recover IDs.
- [ ] One world build and one digest build stay within the agreed performance budget.
- [ ] Long simulations show all intended source families without one family monopolizing selection.

### ND-5: Later, Detail Threads, Overview, And History

Status: pending  
Depends on: ND-1 through ND-4  
Recommended commit boundary: yes  
Why grouped: these surfaces consume the now-stable arc identities and should reuse one timeline derivation layer.

- [ ] Add `Later` or `Story Thread` expansion to active and resolved Narrative features.
- [ ] Build compact Team thread derivation from season records, trophies, movement, Storylines, and dynasty labels.
- [ ] Build compact Player thread derivation from season snapshots, transfers, awards, injuries, and retirement history.
- [ ] Build compact Coach thread derivation from careers, trophies, dismissal, hiring, and factual turnaround samples.
- [ ] Add the compact thread to existing detail pages without redesigning them.
- [ ] Add sustained arcs and competition landscapes to Overview.
- [ ] Connect resolved high-weight arcs to Season Review and season-history summaries.
- [ ] Keep all timelines bounded and derived wherever possible.

Done only when:

- [ ] Timeline facts link back to canonical entities or matches where available.
- [ ] Missing/pruned detail produces a truthful summary-only state.
- [ ] Detail pages remain usable at 320/390/430/1440 widths.
- [ ] History reconstruction tests pass for sparse, mature, transferred, retired, fired, rehired, promoted, relegated, and dynasty cases.

### ND-6: Integrated Release Validation

Status: pending  
Depends on: all previous packages  
Recommended commit boundary: final release commit  
Why grouped: full simulation, save-size, PWA, bundle, and end-to-end audits are expensive and should run once after all Narrative behavior stabilizes.

- [ ] Add v4.54.0 changelog and update README feature/architecture descriptions.
- [ ] Update this checklist only after each verified package is genuinely complete.
- [ ] Run all unit tests, ESLint, strict TypeScript, production build, PWA build, bundle budget, changelog checks, script portability, and production dependency audit.
- [ ] Scan the ordinary production bundle for audit bridges.
- [ ] Run deterministic repeated-digest tests.
- [ ] Run at least 20 seeds x 30 seasons for Narrative frequency and balance.
- [ ] Run at least 5 seeds x 100 seasons for long-term continuity.
- [ ] Run S150 save, restore, and next-advance determinism audit.
- [ ] Compare simulation digests against a pre-Narrative baseline for unchanged authoritative outcomes.
- [ ] Run the complete browser smoke suite.
- [ ] Run focused browser checks for Matchday Pulse, Results causality, More This Window, Later, details, Overview, Season Review, and History.
- [ ] Run the standard web-game client and inspect live Canvas screenshots and text state.

Release is blocked unless:

- [ ] Simulation outcomes remain unchanged for baseline seeds.
- [ ] Narrative has no NaN, invalid destination, duplicate arc, or unbounded list.
- [ ] Slot B is never forced below its quality threshold.
- [ ] Slot C never exceeds two signals.
- [ ] One advance never displays more than one World Moment image.
- [ ] 390x844 retains the complete first-view observation workflow.
- [ ] S150 remains under the storage budget and reloads deterministically.
- [ ] Production performance, initial bundle, and PWA budgets remain within existing gates.

## 7. Validation Economy For Future Sessions

Use this matrix to maximize Codex and wall-clock efficiency without weakening correctness.

| Work package | Run during iteration | Run before package completion | Defer until ND-6 |
| --- | --- | --- | --- |
| ND-0 | focused Director tests | related observation/story/news tests, typecheck, touched-file lint | full browser, S150 |
| ND-1 | component tests, one 390px browser loop | mobile route/focus workflows, typecheck, lint | full long run |
| ND-2 | WorldResponse/explanation tests | result/replay browser workflows, typecheck, lint | full S150 |
| ND-3 | focused Storyline tests | medium multi-seed calibration, typecheck, lint | 100-season run |
| ND-4 | source adapter tests | medium source-frequency audit, typecheck, lint | full S150 |
| ND-5 | timeline tests, one mobile/desktop loop | focused detail/history browser suite | full production suite |
| ND-6 | release-only fixes | all release gates | nothing deferred |

Rules for every future session:

- [ ] Read this file, `progress.md`, and the latest commit before editing.
- [ ] Confirm the worktree status and never overwrite unrelated changes.
- [ ] Work on one numbered package at a time unless the user explicitly combines adjacent packages.
- [ ] Do not run expensive full long-save audits while contracts and UI are still changing.
- [ ] Do not mark a package complete before its `Done only when` checks pass.
- [ ] Record material decisions and discovered constraints in this file before committing.
- [ ] Prefer one cohesive commit per package so regressions can be isolated.
- [ ] Do not push unless the user asks.

## 8. Current Progress

- [x] Product direction reviewed against v4.53.0.
- [x] Existing partial directors identified: Storyline Cards, Observation Theme, WorldResponse, News curation, and World Moment mapping.
- [x] One-release target architecture agreed in conversation.
- [x] Work packages organized for efficient future Codex sessions.
- [x] ND-0 complete: typed contracts, deterministic Director, semantic merge, bounded memory, save validation, and mutation/RNG safety.
- [x] ND-1 complete: one Matchday World Pulse, relation badges, collapsed remainder, hidden-potential cleanup, and six-viewport observation workflow.
- [x] ND-2 complete: factual four-stage result causality, one World Moment maximum, collapsed full report, and canonical detail/replay/Season Review links.
- [ ] ND-3 not started.
- [ ] ND-4 not started.
- [ ] ND-5 not started.
- [ ] ND-6 not started.

### Batch A Verification Record (2026-08-12)

- Node 22.22.2: 126 test files and 910 tests passed; full ESLint and strict TypeScript passed.
- Ordinary and audit production/PWA builds passed. The ordinary initial graph is 493,186 bytes / 162,900 gzip, within the 700,000 / 225,000 budgets.
- Matchday checks passed World Pulse selection/expansion, observation routing, existing Dashboard behavior, focus watch, and persistent floating Advance.
- Layout checks passed at 320x568, 390x844, 430x932, 768x1024, 1280x800, and 1440x900 with zero horizontal overflow. At 390x844 the primary observation Advance ends within the first viewport before World Pulse content.
- Results checks passed single advance, five-window batch, season boundary, result/detail score agreement, frozen forecast/turning-point/tactical facts, full-report expansion, live replay, Season Review, and the next Advance action.
- Visual checks passed story marks, all five World Moment families, Save-Data/high-contrast/failure fallback, offline loading, and the unchanged live-match assets.
- The standard game client completed three deterministic live-Canvas bursts. Text state and inspected frames agreed on formation, featured players, ball movement, and a corner sequence; no console-error artifact was produced.
- Expensive Narrative frequency calibration, long continuity runs, S150 storage/determinism, complete smoke, production audit-bridge scan, and release metadata remain intentionally deferred to ND-6.
