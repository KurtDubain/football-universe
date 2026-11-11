# 下一季见：足球编年史 Current Status

Last reviewed: 2026-11-11
Current release: v4.62.0, deployed 2026-11-11 15:44 Asia/Shanghai to https://football.dyp02.vip/ from clean main/f0956e2cc96b862082741b664106abe3f1a7f825 with ICP enabled and audit disabled; see [deployment provenance and acceptance](tencent-cloud-deployment.md). Only the personal edition was rebuilt and switched this round: https://cup.dyp02.vip/ was not built, uploaded or touched, and was re-read after the personal switch to confirm it still serves v4.61.11 from main/09a59843ae00b449ef53a63c3bef59530d90c687. v4.62.0 raises SAVE_SCHEMA_VERSION from 25 to 26, so saves written by earlier versions are rejected by the version gate and must be restarted; this is intended, not a defect.
Status: v4.61.4 is the current feature-freeze candidate. Public-facing documentation and screenshots are aligned with this candidate; human and real-device validation comes next.

This file is the single current roadmap. Older checklists preserve implementation decisions and validation evidence, but unchecked boxes in those files are not active work unless they are promoted here.

## Product Contract

- The player remains an observer of an autonomous football universe, not a club manager.
- Match results, standings, player statistics, transfers, injuries, awards, and history come from one authoritative deterministic simulation.
- Narrative, animation, audio, and imagery explain or present simulation facts; they never rewrite outcomes.
- The project remains a pure-frontend, offline-capable PWA with current-schema saves and bounded long-term history.
- Real club names remain the personal default. The deployed contest build uses the Three Shores preset; local and Tencent edition isolation are verified, while human content review remains pending. See [build isolation](build-editions.md) and [content review](contest-content-review.md). The author authorized this v4.62.0 personal-edition Tencent deployment; the contest edition and Vercel were untouched.

## Current Health

- 1,192 unit and component tests across 164 files passed on the clean v4.62.0 release using one worker, with no test-timeout/config changes. The personal edition passed production build, edition isolation and unchanged byte budgets. The v4.62.0 release carries **no browser playtest and no real-device evidence**: the author explicitly skipped the pre-release preview on 2026-11-11, so broadcast camera feel, PWA offline update behavior and the save-gate rejection path rest on unit tests, build gates and post-deploy HTTP checks only. The earlier v4.61.11 release did carry three-viewport live flows and an actual 4.61.10-to-4.61.11 HTTPS/PWA update that preserved both isolated S1 QA saves byte-for-byte through reload and offline reopening; those QA saves do not prove every long-term user save compatible, and v4.62.0 rejects pre-26 saves by design. All 126 new public files passed SHA checks, the previous release was retained for rollback, and other server services remained unchanged.
- More than 68,000 production TypeScript lines across 271 production files (identity data is held in edition-specific JSON).
- Strict TypeScript, ESLint, production/PWA build, bundle, dependency, browser, performance, and long-save gates are available in CI or repository scripts.
- Production budgets are frozen at 210 KB / 66 KB gzip for the entry, 480 KB / 160 KB gzip for the initial JS graph, 190 KiB / 30 KiB gzip for CSS, 1.05 MB for application imagery, 2.4 MB for all deployed imagery, and 87 entries / 2.15 MB for the PWA precache. The entry ratchet moved 86 to 87 in v4.62.0 when the Ballon d'Or ranking made `src/engine/standings` a chunk shared by season-awards, season-manager and storage-limits; measured precache bytes are 1,949,209, so the byte cap did not move.
- Live Canvas verification gates rolling average, P95, and maximum draw cost under normal and 4x CPU profiles, alongside frame cadence, consecutive slow frames, particles, long tasks, pause/resume, and final-score integrity.
- The live broadcast uses one tested playback controller and one tested Canvas runtime. The browser matrix verifies ordered same-minute goals, score-on-impact semantics, mobile shootouts, covered-canvas pause, close/reopen behavior, and final-score integrity.
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

### 评奖系统重设计（第一期，分支 `feat/award-system-redesign`，未发布）

授权于 2026-11-11。起因是一次实测：山东泰山拿下联赛杯 + 超级杯双冠，五项个人奖加最佳教练无一入选，而射手王出自该队。完整设计见 [award-system-redesign.md](award-system-redesign.md)。

第一期已完成并通过审计，尚未合并 main、未部署：

- 七奖口径统一，系数集中在 `src/engine/awards/award-weights.ts`；每项奖的层级与团队加权**恰好施加一次**（此前 `seasonScore` 的 10% 联赛强度项与金球的 ×0.90 构成双重折扣）。
- 补最佳前锋 / 最佳中场两个位置奖——此前中场球员在评奖体系里没有任何位置路径。
- 联赛杯 / 超级杯进入荣誉表（此前只认三个六年一届的洲际杯，国内杯贡献为零）；国内杯合计上限 ×1.08，使双冠不超过洲际杯。
- 最佳教练拆为「冠军教头」（始终展示）+「最佳教练」（超额公式，排除冠军）。此前 `expectation = 5` 的三支豪门 `expectedPos = 0`，数学上永远拿不到该奖。
- 金靴改为**赛程归一 + 联赛系数**两个独立旋钮。90 季审计证实原方案（原始进球 × 0.90/0.80）低级别获奖 0 次——10% 折扣打不动 2.14 倍赛程差。现为 `进球 × (30/联赛轮次) × 系数`，系数 1.00 / 0.75 / 0.58。实测低级别 29%、乙级约 2%，且获奖者效率恒为本联赛均值 5.2–5.6 倍。
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
