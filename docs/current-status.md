# 下一季见：足球编年史 Current Status

Last reviewed: 2026-11-13
Current release: v4.66.0, **not merged to `main` and not deployed** — it lives on the `feat/player-center-redesign` branch. https://football.dyp02.vip/ is still serving v4.65.0 from `main/7257be5` as `v4.65.0-a26dae8-20261112` (switched 2026-11-12 23:53 Beijing time), with `v4.64.0-6af5017-20261112` retained as `previous` for rollback; provenance and post-deploy acceptance for that round are recorded in [deployment provenance and acceptance](tencent-cloud-deployment.md). https://cup.dyp02.vip/ remains on v4.61.11 from `main/09a59843ae00b449ef53a63c3bef59530d90c687` and **must not be upgraded**: the edition closes manual import, so its players cannot recover from a rejected or mis-behaving save, and the v4.65.0 engine-scale changes (OVR, player boosts, market value) would make existing contest saves silently re-derive. v4.66.0 is **display-layer only**: it changes no engine, scoring or award formula, so match results, transfers and award outcomes stay identical to v4.65.0. SAVE_SCHEMA_VERSION stays at 26 and no save field was added or renamed. Archive of earlier rounds: v4.63.0 introduced the optional league-goal counter read through `leagueGoalsOf` with an all-competitions fallback; v4.64.0 added the `pre_season` calendar window, derived at render time, requiring no migration; v4.65.0 re-derived team OVR, made strong players move results, re-anchored market value on present ability, and fixed three storyline verdict thresholds.
Status: v4.66.0 is implemented on a feature branch and passes its own gates; it is not merged and not deployed. Its evidence is 1,371 unit tests across 173 files — 46 of them new, covering the forward board, the minutes gate and its 45-minute legacy fallback, the position filter, award de-duplication and aggregation, the chronicle's archived / in-window / no-award three-way distinction, and the two-legged scoreline direction — plus typecheck, lint, and the docs / changelog / scripts checks. **Browser playtest for v4.66.0 is still pending, and no real-device playtest has been done at any point in this line.** The live v4.65.0 carries only HTTP-level post-deploy verification plus a SHA-256 comparison against the local build; its smoke playtest did not advance a full season and was not run against the deployed bundle. The season-opening window from v4.64.0 still has desktop-browser evidence from a dev-server playtest only.

This file is the single current roadmap. Older checklists preserve implementation decisions and validation evidence, but unchecked boxes in those files are not active work unless they are promoted here.

## Product Contract

- The player remains an observer of an autonomous football universe, not a club manager.
- Every season now opens on a fixture-less 赛季开幕 window carrying the cup draws and the pre-season read. It consumes no randomness and adds no save field, so seeded results and existing saves are unchanged; batch advance, season skip and key-node jumps all stop in front of it rather than consuming it.
- Match results, standings, player statistics, transfers, injuries, awards, and history come from one authoritative deterministic simulation.
- Narrative, animation, audio, and imagery explain or present simulation facts; they never rewrite outcomes.
- The project remains a pure-frontend, offline-capable PWA with current-schema saves and bounded long-term history.
- Real club names remain the personal default. The deployed contest build uses the Three Shores preset; local and Tencent edition isolation are verified, while human content review remains pending. See [build isolation](build-editions.md) and [content review](contest-content-review.md). The author authorized this v4.63.0 personal-edition Tencent deployment; the contest edition and Vercel were untouched.

## Current Health

- 1,299 unit and component tests across 168 files pass on v4.64.0 with no test-timeout/config changes. The personal edition passed production build, edition isolation and unchanged byte budgets. v4.63.0 carries browser evidence for the broadcast surface that v4.62.0 lacked — the four-viewport `verify:match` gate passes end to end, and the live view was frame-captured at 390x844, 430x932, 375x667 and 320x568 — but still **no real-device playtest**: touch feel, PWA offline update behavior and the save-gate rejection path rest on unit tests, build gates and post-deploy HTTP checks. The earlier v4.61.11 release did carry three-viewport live flows and an actual 4.61.10-to-4.61.11 HTTPS/PWA update that preserved both isolated S1 QA saves byte-for-byte through reload and offline reopening; those QA saves do not prove every long-term user save compatible, and v4.62.0 rejects pre-26 saves by design. All 126 new public files passed SHA checks, the previous release was retained for rollback, and other server services remained unchanged.
- v4.63.0 post-deploy acceptance on 2026-11-11: `/healthz` returned `football-personal-ok`, `/version.json` reported 4.63.0 with a buildId identical to the build identity, the contest site re-read as v4.61.11 with its `current` symlink untouched, the PWA shipped 88 precache entries matching the budget, and all 23 JS/CSS assets referenced by `index.html` were re-downloaded and re-hashed against the local `dist/personal` and matched byte for byte. The previous release was kept for rollback; no Nginx, DNS, certificate or unrelated service was changed.
- More than 70,000 production TypeScript lines across 274 production files (identity data is held in edition-specific JSON).
- Strict TypeScript, ESLint, production/PWA build, bundle, dependency, browser, performance, and long-save gates are available in CI or repository scripts.
- Production budgets are frozen at 210 KB / 66 KB gzip for the entry, 480 KB / 160 KB gzip for the initial JS graph, 190 KiB / 30 KiB gzip for CSS, 1.05 MB for application imagery, 2.4 MB for all deployed imagery, and 88 entries / 2.15 MB for the PWA precache. The entry ratchet moved 86 to 87 in v4.62.0 when the Ballon d'Or ranking made `src/engine/standings` a chunk shared by season-awards, season-manager and storage-limits, and 87 to 88 in v4.63.0 when the award rework made `src/engine/awards/award-scoring` a chunk shared by season-end, season-awards, ballon-dor, award-buzz and the player stat selectors; measured precache bytes are 1,957,575, so the byte cap did not move either time.
- Live Canvas verification gates rolling average, P95, and maximum draw cost under normal and 4x CPU profiles, alongside frame cadence, consecutive slow frames, particles, long tasks, pause/resume, and final-score integrity.
- The live broadcast uses one tested playback controller and one tested Canvas runtime. The browser matrix verifies ordered same-minute goals, score-on-impact semantics, mobile shootouts, covered-canvas pause, close/reopen behavior, and final-score integrity.
- A phone held upright now frames the pitch lengthwise: the quarter turn happens only in the render transform, so drawing space stays the landscape 520x344 pitch and every formation slot, pass arc, camera framing value and physics constant is unchanged. Measured 4.5 px per metre at 390x844 and 5.4 at 430x932 against 3.2 for the old landscape letterbox, with the full 105x68 m field visible and jersey numbers legible. Portrait is gated on a 760 px viewport height — below it the height cap shrinks the canvas past what the letterbox already delivered (1.9 against 2.8 px per metre at 320x568), so short screens stay landscape.
- Route intent preloading respects reduced-data connections; browser-history return restores route scroll, while high-use player, league, history, legend, and transfer controls retain their session context.
- First entry now exposes one compact theme-to-focus-to-reveal path. Ordinary rounds stay within the Dashboard feedback layer, while structural competition moments retain full-screen ceremony.
- Key-node jumps now stop as a visible pre-match arrival: the results view explains the reached node before the world report, and the matchday view carries the same cup, storyline, followed-match, or playoff reason into observation without changing simulation order.
- Season rollover now keeps completed-season meaning ahead of next-season operations: the champion archive opens first, then hands off to history, chronicle, transfers, or the untouched next matchday through one bounded closing section.
- New reports reset to their score and headline while preserving scroll within the same report. Recommended themes can follow promotion or relegation at a season boundary, zero-match tables never expose seeded order as rank, and transfer auto-resolution leaves a concise visible handoff.
- Season-boundary editing now gives the followed team's final fate first claim, then preserves top-flight champions, major historical resolutions, cups, promotion, and relegation ahead of routine transfer, prize, and coach news. History summaries identify every storyline subject and group promotion/relegation links by direction and tier without adding persisted data.
- Mobile advance controls now live in the layout flow at 320–430px instead of covering route content. Concurrent season-end achievements collapse into one dismissible archive notice while every unlock remains stored.
- The recommended observer experience is seed `20260722`: all three lenses retain viable opening matches, while the default challenger route combines a 2:2 opener with three World Moment windows in the first six advances. The selection comes from the shared scoring audit, not seed-specific simulation behavior. v4.62.0 moved it from `20260709` because giving the Super Cup real pots replaced one 16-team shuffle with four 4-team shuffles, shifting every downstream draw in season construction; the candidate window base moved from 20260701 to 20260705, and the audit script's readiness test was tightened to match the unit-test assertion, which it had been looser than.
- Cup-stage meaning now comes from one shared contract: Chinese and English knockout labels rank consistently, while World Cup/continental third rounds and Super Cup sixth rounds surface as group-stage finales with focused match tags, protected key-node arrival, and restrained transition feedback.
- A remote deployment mismatch converges through one guarded safe reload even when the stale page missed the worker lifecycle event; the social preview image remains deployable without delaying PWA precache installation.
- Node 22.22.2 and pnpm 10.34.5 are the release toolchain.
- Every remote push is treated as a release: bump `package.json` and `APP_VERSION`, add the matching in-game changelog entry, and synchronize the current-version documentation before pushing.

## Active Work

### 评奖系统重设计（第一期，已随 v4.63.0 发布）

授权于 2026-11-11。起因是一次实测：山东泰山拿下联赛杯 + 超级杯双冠，五项个人奖加最佳教练无一入选，而射手王出自该队。完整设计见 [award-system-redesign.md](award-system-redesign.md)。

第一期已完成并通过审计，已合并 main 并随 v4.63.0 部署：

- 七奖口径统一，系数集中在 `src/engine/awards/award-weights.ts`；每项奖的层级与团队加权**恰好施加一次**（此前 `seasonScore` 的 10% 联赛强度项与金球的 ×0.90 构成双重折扣）。
- 补最佳前锋 / 最佳中场两个位置奖——此前中场球员在评奖体系里没有任何位置路径。
- 联赛杯 / 超级杯进入荣誉表（此前只认三个六年一届的洲际杯，国内杯贡献为零）；国内杯合计上限 ×1.08，使双冠不超过洲际杯。
- 最佳教练拆为「冠军教头」（始终展示）+「最佳教练」（超额公式，排除冠军）。此前 `expectation = 5` 的三支豪门 `expectedPos = 0`，数学上永远拿不到该奖。
- 两个进球荣誉拆成两个口径。此前 `playerStats.goals` 实为**全赛事**口径（`season-manager.ts` 把整个 `windowResult.results` 交给 `updatePlayerStatsAndSegmentsFromResults`，`buildMatchStatDeltas` 不做赛事过滤），而「射手王」名义上只该看联赛。现为**金靴 = 全赛事进球 × 联赛系数**、**射手王 = 纯联赛进球 × (30/联赛轮次) × 联赛系数**。赛程归一只属于射手王：金靴的分子含杯赛而分母只知道联赛轮次，任何归一都会重蹈第一版分子分母不匹配的覆辙。新增可选计数器 `leagueGoals`，读取一律走 `leagueGoalsOf`，对拆分前存档回退到 `goals`，因此不升 `SAVE_SCHEMA_VERSION`。
- 进球系数 1.00 / 0.75 / 0.58 由两个荣誉共用（原 0.90 / 0.80 实测恰好是层级中立值，等于完全抵消低级别每轮多进 22% 的效率优势，想表达任何偏好必须低于它）。60 季实测：射手王低级别 38%、最佳新星 15%、金靴 0%——全赛事口径下顶级球队踢更多杯赛、走得更深，这个优势是挣来的，低级别通道在射手王那边。两荣誉颁给不同球员占 72%；不变量「联赛进球 ≤ 全赛事进球」60 季 0 例违例；获奖者进球效率恒为本联赛均值 5.2–5.6 倍。
- 「奖项风向」面板挂在球员中心顶部，第 16 轮起出现。热度公式与评奖公式**不同**（0.5 赛季分 + 0.3 近 5 场状态 + 0.2 球队势头），用阈值带代替名次，不显示任何 buzz 专有数字。不引入随机——RNG 流是承重墙，颁奖时插抽签会让全部种子审计作废。
- 存档兼容：奖项类型白名单加法扩展，**不升 `SAVE_SCHEMA_VERSION`**，现有存档不丢。已归档赛季的旧奖项按旧规则保留，不回溯重算。

第二期（球员中心整体重构：单层榜单导航、每榜口径说明行、荣誉列、候选徽标、拆掉创造力榜混排）已获授权，排在第一期之后。

### 既有在办事项

Work authorized on 2026-09-23 and refined on 2026-09-25 is included in the deployed v4.61.11: the default ten world-focus seats now protect at most four distinct previous-season major award winners for one season, independently from actual match lineups. Followed cards retain known identity at zero minutes; season-boundary summaries prioritize champion changes, individual honors and team movement. Player threads keep at most four nodes with current injuries protected. Important retirees keep compact facts without new club-trophy copies; unmatched legacy snapshots remain readable. Goal drama follows one complete score timeline. Save schema and edition identities remain unchanged; no real user save was opened or rewritten. This does not reactivate older checklists. One nonblocking display omission remains: the contest Settings changelog's newest entry is still v4.61.10, although the actual app and update identity are v4.61.11; deployment did not alter application code to address it.

1. Conduct three unassisted first-five-minute playtests and record repeated points of confusion rather than individual visual preferences.
2. Complete one fifteen-minute observer-route walkthrough on an iPhone Safari and one mid-range Android Chrome device.
3. Accept only reproducible, repeated human/real-device findings or P0 failures during the freeze. Do not reopen archived feature lists.
4. Prepare a demonstrated fifteen-minute route and submission materials after blind playtests and real-device checks.

## Deferred, Not Active During Freeze

- Add authoritative in-match injury events only if they can share the existing participation, substitution, injury, commentary, and post-match consequence chain.
- Complete English engine copy only when an actual distribution target requires it.
- Consider an original-name preset only for a concrete event with known delivery and rights requirements. Current documentation screenshots already reflect v4.61.4.

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
