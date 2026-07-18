# UI Polish Checklist

Created: 2026-07-17

This document tracks the UI and experience work found during the July 2026 multi-agent review and production audit. The target direction is a **night football broadcast desk**: clear operational data, recognizable club and competition identity, and restrained illustrated match/story assets.

Checkboxes stay open until implementation and the listed acceptance checks both pass.

## Progress Log

- 2026-07-17: Completed a four-agent read-only review covering mobile usability, visual-system consistency, information architecture, and custom visual assets. Audited the deployed game at desktop and `390x844`; core routes had no page-level horizontal overflow and no console errors or warnings. Created this checklist without changing runtime behavior.
- 2026-07-17: Completed Phase 1 mobile correctness. The navigation drawer now owns overlay/focus behavior, mobile cups use a round selector with readable compact matchups, League columns match their headers, History tabs no longer crush the title, and lazy routes use layout-shaped skeletons. Verified with 474 tests, ESLint, TypeScript, production/PWA build, bundle budgets, browser checks at `320x568`, `390x844`, `430x932`, and `1440x900`, plus the match-presentation harness. The broad `audit:current` route runner was not counted because it stalled in browser waiting without producing a report.
- 2026-07-18: Completed Phase 2 visual foundations. Added charcoal/grass/gold semantic tokens and shared `PageShell`, header, panel, segmented-control, status, empty, and loading primitives; migrated League, Teams, Players, History, Transfers, the route skeleton, and the global app surfaces without changing simulation or save behavior. A repeatable browser harness checked all five routes at `320x568`, `390x844`, and `1440x900`, including tab state, 44px mobile targets, panel radius, overflow, console errors, and 125% root text sizing. Final verification passed 58 files / 477 tests, ESLint, TypeScript, production/PWA build, bundle budgets, and the existing match-presentation harness. Global tiny-label cleanup, old card radii, tab-edge affordances, and remaining page migrations stay open.
- 2026-07-18: Fixed the optional floating advance control on mobile and desktop. Replaced the ambiguous draggable circle and 8px stage label with separate 44px move and 85px advance targets, safe-area docking, visual-viewport clamping, edge snapping, keyboard movement, and Home reset. Browser interaction verified that dragging never advances and one action click advances exactly one window; final verification passed 60 files / 481 tests, ESLint, production/PWA build, and bundle budgets.
- 2026-07-18: Completed Phase 3 Dashboard workflow. The global header now owns the only primary advance action, while favorite teams, tabs, and up to two deduplicated focus notices fill the first mobile viewport. Favorite-team results are pinned above the ordinary sequence; ordinary 6/12/48-result batches reveal in about 960/960/1000ms while important matches keep sequential pauses. `verify:dashboard` passed the full advance/skip flow at `390x844` and `1440x900` with 44px skip targets and zero runtime errors. Final verification passed 61 files / 487 tests, ESLint, TypeScript, production/PWA build, bundle budgets, match presentation, mobile advance performance, and animation performance.

## Product Direction And Guardrails

- [ ] Use deep charcoal for the page background, grass green for primary actions, trophy gold for honors, and red only for danger/failure.
- [ ] Keep team colors limited to club identity, matchup presentation, and club-specific surfaces; do not reuse them as generic success/warning colors.
- [ ] Keep tables, rosters, transfer tools, filters, and finance views dense and operational rather than illustrative.
- [ ] Reserve custom artwork for club identity, competition identity, trophies, classic moments, match atmosphere, and story chapters.
- [ ] Do not add a large hero image to every page, illustrations behind dense tables, generic player portraits, larger radii, gradient orbs, or more nested cards.
- [ ] Preserve current simulation, data, persistence, and history semantics during the UI pass.

## 1. P0 Mobile Usability And Correctness

### Navigation And Overlays

- [x] Raise the mobile navigation drawer and backdrop above the sticky top bar so the global advance action cannot remain visible or clickable.
- [x] Add `role="dialog"`, `aria-modal`, Escape-to-close, initial focus, focus containment, and focus return to the mobile drawer.
- [x] Prevent background scrolling while the drawer is open.
- [x] Verify drawer open/close behavior at `320x568`, `390x844`, and `430x932`.

Primary file: `src/app/Layout.tsx`.

### Cup Bracket Readability

- [x] Replace the narrow mobile first-round bracket with a full-width list or one-round-at-a-time view.
- [x] Show team abbreviations when full names do not fit; never truncate a team to an ambiguous single character.
- [x] Hide region/tier metadata before reducing the space available to team identity.
- [x] Add a clear round selector or horizontal-scroll affordance when multiple rounds are available.
- [x] Keep the complete desktop bracket behavior unchanged.

Primary file: `src/pages/Cup.tsx`.

### League Table Semantics

- [x] Make every visible mobile table header correspond to a visible data cell.
- [x] Use an unambiguous mobile column set such as `赛 / 胜 / 平 / 负 / 净胜 / 分`.
- [x] Show the form column completely or hide it completely on narrow screens.
- [x] Hide zero-value superlatives such as "进攻最强 0球" before any match has been played.

Primary file: `src/pages/League.tsx`.

### History Header And Route Loading

- [x] Let the History title and segmented control stack cleanly on narrow screens without wrapping the title into isolated characters.
- [x] Replace the `50vh` solid loading block with a quiet page-shell skeleton matching the destination layout.
- [x] Ensure lazy-route transitions do not cause large luminance flashes or layout jumps.

Primary files: `src/pages/History.tsx`, `src/App.tsx`.

### Touch Targets And Horizontal Tabs

- [ ] Give mobile navigation items, tabs, filters, icon buttons, and skip controls at least a `44x44px` interaction area.
- [ ] Make league/team/player rows clickable across a meaningful cell or row area rather than only the text glyphs.
- [ ] Add edge fade, scroll snap, and active-tab scroll-into-view to horizontally overflowing tab bars.
- [ ] Verify Players, Memorable Matches, League, Teams, Advanced Search, and History with touch emulation.

## 2. P0 Visual Foundation

### Semantic Tokens

- [x] Define three surface levels: page, panel, and floating/overlay.
- [x] Define primary, secondary, and muted text tokens with WCAG-aware contrast.
- [x] Define action, success, warning, and danger tokens with one meaning each.
- [x] Define competition gold and team identity colors as explicit extensions.
- [x] Replace direct `slate/blue/amber/emerald` usage incrementally in shared shells and newly touched pages.

Primary file: `src/index.css`.

### Typography And Numbers

- [ ] Remove essential `8px`, `9px`, and `10px` labels from mobile layouts.
- [ ] Use `11-12px` only for tertiary labels and `13-14px` for normal body content.
- [ ] Apply `tabular-nums` consistently to scores, ranks, records, money, percentages, and match clocks.
- [x] Define consistent page-title, section-title, panel-title, label, and value styles.
- [x] Check Chinese team/player names at large-text browser settings.

### Shared UI Primitives

- [x] Add or standardize `PageShell`, `PageHeader`, `SectionHeader`, and `Panel`.
- [x] Add or standardize `SegmentedControl`, `StatusBadge`, `EmptyState`, and `LoadingSkeleton`.
- [ ] Use stable dimensions for controls and data tiles so dynamic labels do not shift surrounding layout.
- [ ] Keep operational cards at an `8px` radius or less unless an existing specialized component requires otherwise.
- [x] Migrate shared page shells before performing page-specific cosmetic rewrites.

### Reduce Card And Accent Noise

- [ ] Reserve bordered cards for clickable entities, repeated records, dialogs, and framed tools.
- [ ] Convert nested attribute/status/finance/history cards into unframed groups with spacing and dividers.
- [ ] Limit each viewport to one primary action and a small number of competing accent colors.
- [ ] Remove duplicate borders, shadows, and large rounded containers from the Dashboard and Team Detail first.

## 3. P1 Core Workflow And Information Hierarchy

### Dashboard

- [x] Keep one authoritative primary advance action on the Dashboard viewport.
- [x] Remove duplicate current-window labels between the global header and page header.
- [x] Deduplicate focus-match and strong-matchup messages; show at most two secondary matchup notices.
- [x] Prioritize favorite team, focus match, and advance action in the first mobile viewport.
- [x] Pin "我的球队本轮赛果" above the general result sequence.
- [x] Cap ordinary result reveal time near `1-1.2s`; reserve sequential drama for derbies, upsets, finals, and decisive matches.
- [x] Increase the skip-animation interaction target to `44px` without making it visually heavy.

Primary files: `src/pages/Dashboard.tsx`, `src/components/ResultAnimation.tsx`, `src/app/Layout.tsx`.

### Player Detail And Player Center

- [ ] Replace the season-start wall of zero metrics with one compact empty state.
- [ ] Do not display misleading position ranks before a player has a meaningful sample.
- [ ] Surface four position-relevant headline metrics for forwards, midfielders, defenders, and goalkeepers.
- [ ] Move position-performance context above low-value zero efficiency panels.
- [ ] Keep overflowing Player Center tabs discoverable and automatically reveal the active tab.

Primary files: `src/pages/PlayerDetail.tsx`, `src/pages/Players.tsx`.

### Team Detail And Team Center

- [ ] Replace fixed-width mobile player-name cells with flexible names and a two-line stat layout.
- [ ] Make the whole roster row a meaningful player-detail target.
- [ ] Collapse empty story/rivalry blocks into one compact line until real story content exists.
- [ ] Add lightweight `概览 / 阵容 / 历史` in-page sections or tabs to shorten the mobile scan path.
- [ ] Merge basic attributes and current state into one coherent club data area.
- [ ] Change the Team Center from heavily framed cards toward a compact club directory.

Primary files: `src/pages/TeamDetail.tsx`, `src/pages/Teams.tsx`.

### History, Chronicle, And Legends

- [ ] Make the History tabs own their content: trophies under honors, finance under statistics, and coaches under the coach hall.
- [ ] Rename "财政告急" to a neutral label when the lowest-cash club is still solvent.
- [ ] Show only coaches with meaningful trophies or completed-season achievements in the hall of fame.
- [ ] Keep responsibilities distinct: History for records, Chronicle for season stories, Legends for retired people.
- [ ] Verify no History tab starts with unrelated content or produces an unnecessarily long season-one page.

Primary files: `src/pages/History.tsx`, `src/pages/Chronicle.tsx`, `src/pages/Legends.tsx`.

### Transfer Pages

- [ ] Rename `/transfers` UI from "转会窗口" to "转会记录" where it represents historical transactions.
- [ ] Rename "强援转会" to "付费转会" unless the filter gains a real quality threshold.
- [ ] Make player and team identities clickable in the market where navigation is expected.
- [ ] Group budget change, post-deal squad impact, and displaced player into a readable "交易影响" area.

Primary files: `src/pages/Transfers.tsx`, `src/pages/Market.tsx`, `src/app/Layout.tsx`.

### Welcome And First Run

- [ ] Bring the mobile new-game setup into or partially into the first viewport.
- [ ] Replace generic feature-card/emoji presentation with the actual game setup experience.
- [ ] Treat a future night-stadium illustration as a full-bleed background, not a split hero card.

Primary file: `src/pages/Welcome.tsx`.

## 4. P1 Custom Visual Asset System

### Club Identity

- [ ] Design `5-6` consistent badge frames and `12-16` center symbols instead of 32 unrelated crests.
- [ ] Define deterministic frame, symbol, primary-color, secondary-color, and accent-color assignments for every club.
- [ ] Preserve visible club name or abbreviation so color/crest is never the only identifier.
- [ ] Add a `120-160px` Team Detail club banner using the badge, team colors, and a restrained regional/stadium pattern.

Primary component: `src/components/TeamBadge.tsx`.

### Competition And Honor Assets

- [ ] Create nine competition badges for the three leagues, League Cup, Super Cup, World Cup, and three continental cups.
- [ ] Create `5-6` distinct trophy silhouettes and map competitions to trophy forms.
- [ ] Create champion, promotion, and relegation commemorative marks.
- [ ] Apply these assets consistently to Cup, League, History, Chronicle, Trophy Breakdown, and Season Review.

### Match And Story Assets

- [ ] Create seven event stamps: derby, upset, late winner, comeback, penalty shootout, goalfest, and final.
- [ ] Keep event names as HTML text; do not bake Chinese text into the images.
- [ ] Show stamps only for special matches so ordinary result cards remain quiet.
- [ ] Create small chapter marks for dynasty, revival, dark horse, survival, rebuild, and decline stories.
- [ ] Add one subtle cached grass-grain texture to the match canvas with a low-power fallback.
- [ ] Add a restrained scoreboard plate using competition and club identity while keeping score/team text in the DOM.

### Icon Consistency

- [ ] Inventory all remaining system Emoji and hand-authored one-off functional icons.
- [ ] Extend the existing `Icon` component for navigation, status, injury, honor, and empty-state utility icons.
- [ ] Keep emotionally expressive artwork only in celebrations and story moments.
- [ ] Do not redraw familiar arrows, close, menu, search, filter, play, pause, or skip controls as bitmap assets.

Primary component: `src/components/Icon.tsx`.

## 5. P2 Motion, Empty States, And Final Polish

- [ ] Define standard durations and easing for hover, tab changes, route transitions, score changes, and result reveals.
- [ ] Add complete `prefers-reduced-motion` behavior for decorative motion and match presentation.
- [ ] Ensure hidden, covered, or paused match views stop nonessential rendering work.
- [ ] Create layout-matched skeletons for Teams, Players, History, Cup, and lazy route transitions.
- [ ] Create no more than `3-4` reusable illustrated empty-state families for trophies, transfers, retired players, and stories.
- [ ] Reduce rainbow attribute bars to a consistent base color plus meaningful exceptional states.
- [ ] Verify focus-visible, hover, pressed, disabled, loading, empty, error, and success states for shared controls.

## 6. Asset Performance And Accessibility Budget

- [ ] Competition badge runtime assets: transparent `192x192` WebP or SVG, target below `12KB` each.
- [ ] Club frame/symbol assets: prefer SVG; if raster is required, use transparent `128x128` WebP.
- [ ] Trophy assets: transparent SVG or `256x256` WebP, designed to display clearly from `24-72px`.
- [ ] Event stamps: runtime `192x64` WebP, without embedded UI text.
- [ ] Tileable grass/paper textures: `512x512` WebP, target below `50KB` and `35KB` respectively.
- [ ] Champion scene: `960x320` WebP, target below `80KB`, lazy-loaded outside the initial route.
- [ ] Keep new first-viewport assets below `150KB` and the initial complete art pack near `400KB`.
- [ ] Predecode and cache Canvas images; never decode or reconstruct image patterns per frame.
- [ ] Use empty `alt`/`aria-hidden` for decorative art and retain DOM text for club, competition, score, and status meaning.
- [ ] Keep a consistent line weight, light direction, edge treatment, and visual density across all custom assets.

## 7. Verification Matrix

### Automated

- [x] ESLint passes with zero errors.
- [x] TypeScript project build passes.
- [x] Full Vitest suite passes.
- [x] Production/PWA build passes and existing bundle budgets remain green.
- [ ] Add focused interaction tests for drawer keyboard behavior, tab overflow, History tab ownership, and result-animation completion.

### Browser

- [ ] Verify Welcome, Dashboard, League, Cup, Teams, Team Detail, Players, Player Detail, Transfers, Market, History, Chronicle, and Legends.
- [ ] Verify mobile at `320x568`, `390x844`, and `430x932` with no page-level horizontal overflow or overlapping controls.
- [ ] Verify desktop at `1280x720` and `1440x900` with coherent maximum widths and no excessively stretched content.
- [ ] Verify normal, large-text, keyboard-only, touch-emulated, and reduced-motion modes.
- [ ] Verify advance, skip, live replay, drawer, tab scrolling, and back-navigation flows with zero console errors or warnings.
- [ ] Confirm custom assets load correctly after a cold reload and under network throttling.

### Performance

- [x] Re-run the existing mobile advance and match-animation profiles after UI changes.
- [ ] Confirm new images do not increase match Canvas frame cost through per-frame decoding or allocation.
- [ ] Confirm route skeletons and banners do not cause significant cumulative layout shift.
- [x] Confirm the first game screen remains responsive on mobile CPU throttling.

## Recommended Implementation Order

1. Mobile drawer, Cup bracket, League columns, History header, and route-loading defects.
2. Semantic tokens, typography, shared page shell, segmented control, and skeleton primitives.
3. Dashboard hierarchy, result timing, favorite-team result, and touch-target normalization.
4. Player, Team, History, and Transfer information hierarchy.
5. Icon cleanup and modular club-badge system.
6. Competition badges, trophies, event stamps, and Team Detail banner.
7. Match texture, scoreboard treatment, story marks, and final motion/accessibility pass.
8. Full automated, desktop/mobile, accessibility, asset-budget, and performance verification.

## Definition Of Done

A task is complete only when:

- [ ] The implementation is present and uses the shared visual/interaction rules.
- [ ] Relevant automated tests exist and pass.
- [ ] Desktop and mobile browser behavior has been inspected.
- [ ] No new console error, warning, overflow, overlap, or ambiguous truncation is introduced.
- [ ] Asset, rendering, persistence, and advance-performance budgets remain within their existing guardrails.
- [ ] This checklist and Progress Log are updated with the verified result.
