# Football Universe Current Status

Last reviewed: 2026-08-23
Current release: v4.59.0
Status: release-ready core; active work is limited to human experience validation.

This file is the single current roadmap. Older checklists preserve implementation decisions and validation evidence, but unchecked boxes in those files are not active work unless they are promoted here.

## Product Contract

- The player remains an observer of an autonomous football universe, not a club manager.
- Match results, standings, player statistics, transfers, injuries, awards, and history come from one authoritative deterministic simulation.
- Narrative, animation, audio, and imagery explain or present simulation facts; they never rewrite outcomes.
- The project remains a pure-frontend, offline-capable PWA with current-schema saves and bounded long-term history.
- Real club names remain the personal default. A separate original preset is considered only for a submission that requires it.

## Current Health

- 982 unit and component tests across 139 test files.
- Approximately 64k production TypeScript lines across 236 source files.
- Strict TypeScript, ESLint, production/PWA build, bundle, dependency, browser, performance, and long-save gates are available in CI or repository scripts.
- The live broadcast uses one tested playback controller and one tested Canvas runtime. The browser matrix verifies ordered same-minute goals, score-on-impact semantics, mobile shootouts, covered-canvas pause, close/reopen behavior, and final-score integrity.
- Route intent preloading respects reduced-data connections; browser-history return restores route scroll, while high-use player, league, history, legend, and transfer controls retain their session context.
- First entry now exposes one compact theme-to-focus-to-reveal path. Ordinary rounds stay within the Dashboard feedback layer, while structural competition moments retain full-screen ceremony.
- Key-node jumps now stop as a visible pre-match arrival: the results view explains the reached node before the world report, and the matchday view carries the same cup, storyline, followed-match, or playoff reason into observation without changing simulation order.
- Season rollover now keeps completed-season meaning ahead of next-season operations: the champion archive opens first, then hands off to history, chronicle, transfers, or the untouched next matchday through one bounded closing section.
- A remote deployment mismatch converges through one guarded safe reload even when the stale page missed the worker lifecycle event; the social preview image remains deployable without delaying PWA precache installation.
- Node 22.22.2 and pnpm 10.34.5 are the release toolchain.

## Active Work

1. Conduct three unassisted first-five-minute playtests and record repeated points of confusion rather than individual visual preferences.
2. Complete one fifteen-minute observer-route walkthrough on an iPhone Safari and one mid-range Android Chrome device.
3. Promote only repeated human-test findings into this roadmap; do not reopen archived feature lists by default.

## Candidate Follow-Ups

- Add authoritative in-match injury events only if they can share the existing participation, substitution, injury, commentary, and post-match consequence chain.
- Complete English engine copy only when an actual distribution target requires it.
- Refresh submission screenshots or an original-name preset only for a concrete event with known delivery and rights requirements.

## Explicitly Not Planned

- Manual lineups, tactics, training, contracts, transfers, finances, or other traditional manager controls.
- A second narrative database, generated-fiction runtime, backend account system, cloud save tree, or branching world timeline.
- More visual/audio assets without a measured experience gap and an explicit loading budget.
- IndexedDB or additional historical schemas while current S150 durability and storage budgets continue to pass.

## Documentation Roles

- `README.md`: current player-facing product and development facts.
- `docs/current-status.md`: the only active roadmap and release-health summary.
- `progress.md`: chronological engineering log; never the active task list.
- `src/config/changelog.ts`: user-facing release history.
- Other `*-checklist.md` and `*-plan.md` files: historical implementation and verification ledgers.
- `docs/art-direction.md`, `docs/audio-feedback.md`, `docs/security-audit.md`, `docs/visual-assets.md`, and `docs/world-cup-hosting.md`: current specialist references.
