<p align="center">
  <img src="public/favicon.svg" width="80" alt="Football Universe Logo"/>
</p>

<h1 align="center">足球联赛宇宙</h1>
<p align="center"><strong>电子斗蛐蛐模拟器 | Football League Universe Simulator</strong></p>
<p align="center">by <a href="https://github.com/KurtDubain">KurtDubain</a></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.6.0-blue" alt="version"/>
  <img src="https://img.shields.io/badge/React-18-61dafb" alt="React"/>
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Vite-8-646cff" alt="Vite"/>
</p>

---

## What is this?

A **fully client-side football season simulator** — not about controlling players or watching animations, but about watching an entire football universe unfold: league standings, cup upsets, coach firings, promotion battles, and glory accumulation across seasons.

Think of it as **"electronic cricket fighting" (电子斗蛐蛐)** for football leagues.

## Features

### Leagues & Competitions
- **3-tier league system**: Premier League (16 teams) / Championship (8 teams) / League One (8 teams)
- **Double round-robin** format: 30 rounds for top tier, 14 for lower tiers
- **Promotion & relegation** with playoff matches
- **League Cup**: 32-team single-leg knockout (5 rounds)
- **Super Cup**: 16 teams in 4 groups + two-legged knockouts + single-leg final
- **World Championship Cup**: Every 4 seasons, 16 teams, all advance from groups to knockout

### Simulation Engine
- **Seeded PRNG** (mulberry32) for deterministic, replayable results
- **Poisson-distributed** goal scoring
- **Multi-factor match simulation**: base stats, coach buffs, morale, fatigue, momentum, home advantage, squad health
- **Dynamic state system**: each match affects future matches through morale/fatigue/momentum cascades
- **Match events**: goals, cards, saves with minute-by-minute timeline

### Coach System
- **36 real coaches** with distinct styles (attacking/defensive/possession/counter/balanced)
- **Coach buffs** affect match outcomes (league specialist, cup specialist, etc.)
- **Pressure system**: consecutive losses, big defeats, cup eliminations build pressure
- **Auto-firing**: coaches get sacked when pressure exceeds threshold (elite teams fire faster)
- **Hiring**: best available unemployed coach is matched to team expectations
- **Career tracking**: full career history with trophies per stint

### Teams
- **32 real teams** from Europe's Big 5 leagues + Chinese Super League
- Each team has unique **color accent** throughout the UI
- Base attributes: attack, midfield, defense, stability, depth, reputation
- Dynamic state: morale, fatigue, momentum, squad health, coach pressure

### Global Calendar Window System
- The entire season is structured as **~48 sequential windows**
- Leagues, cups, and super cup are **interleaved** in a fixed order
- You can only advance the **current window** — no skipping ahead
- Each window's results cascade into subsequent matches
- View upcoming fixtures with **pre-match predictions** at any time

### Match Detail Modal
- Click **any fixture** (upcoming or completed) for a detailed breakdown
- **Pre-match**: win probability bars, state comparison, base stat comparison, coach analysis, verdict + hot tips
- **Post-match**: score, goal timeline, full match stats, event list

### Persistence
- Full game state saved to **localStorage** automatically
- Survives page refresh / browser close
- Reset game to start fresh

## Teams

| Tier | Teams |
|------|-------|
| **Premier** | 皇马, 曼城, 拜仁, 利物浦, 巴萨, 阿森纳, 国米, 大巴黎, 尤文, 马竞, 多特, AC米兰, 切尔西, 那不勒斯, 上海海港, 热刺 |
| **Championship** | 勒沃库森, 阿斯顿维拉, 罗马, 马赛, 山东泰山, 北京国安, 塞维利亚, 里昂 |
| **League One** | 成都蓉城, 武汉三镇, 浙江队, 南安普顿, 伯恩利, 河南队, 天津津门虎, 长春亚泰 |

## Tech Stack

| Layer | Tech |
|-------|------|
| Build | Vite 8 |
| Framework | React 18 + TypeScript |
| State | Zustand 5 (persisted) |
| Styling | Tailwind CSS 4 |
| Routing | React Router 7 |
| RNG | Seeded mulberry32 |
| Deploy | Vercel (static) |

## Getting Started

```bash
# Install
pnpm install

# Dev server
pnpm dev

# Production build
pnpm build

# Preview production build
pnpm preview
```

## Project Structure

```
src/
  app/          — App shell, layout, router
  components/   — Reusable UI (MatchDetailModal, Logo)
  pages/        — Route pages (Dashboard, League, Cup, Calendar, etc.)
  engine/       — Pure simulation logic (no React dependency)
    match/      — RNG, Poisson, simulator, events, prediction
    season/     — Calendar builder, season manager
    standings/  — League table, fixtures, promotion/relegation
    cups/       — League cup, super cup, world cup
    coaches/    — Coach effects, pressure, hiring
    honors/     — Trophy tracking
  config/       — Game data (teams, coaches, competitions, balance)
  store/        — Zustand store
  types/        — TypeScript interfaces
  utils/        — Formatting helpers
```

## Changelog

### v1.1.0
- **Game is now infinite** — world cup year no longer ends the game;
  next season auto-starts after world cup completes
- **Multi-crown detection**: 双冠王/三冠王/四冠王 news at season end
- **Underdog achievement news**: lower-league teams winning cups get special celebration
- **Underdog boost** in match simulation — weaker teams get small attack/midfield
  bonus when overall gap > 8 (makes upsets more possible without being absurd)
- **Cup win morale bonus**: extra morale for cup wins, big bonus for finals
- **Enriched Dashboard overview tab**:
  - Season stats cards: progress %, cup status, top scorer, coach changes
  - World cup status bar when applicable
  - League standings remain below
- **Balance**: cup randomness 0.22→0.25 for more drama

### v1.0.0
- **Match tags system**: special labels on key fixtures
  - 决赛 (gold, glowing border)
  - 四强 / 八强 (purple / blue)
  - 保级战 (red, glowing)
  - 冠军战 (gold, top 2 teams late in season)
  - 强弱对话 (top 3 vs bottom 3)
  - 生死战 (final group stage round)
- **Celebration animations** after big moments:
  - 🏆 Trophy celebration: bouncing trophy + confetti shower on cup finals
  - 🎊 Confetti rain on season end and relegation playoffs
  - Random shapes (■●▲★◆♦✦) in team colors falling with rotation
  - CSS animations: confetti-fall, sparkle, glow-pulse, trophy-bounce, slide-up
- **Result cards**: finals highlighted with gold gradient + sparkle ✦
- **Fixture cards**: glowing amber border on key matches

### v0.9.1
- **Bug fix: relegation playoff matchday empty** — playoff fixtures now written to
  calendar window before simulation, so Dashboard shows the matchups
- Fixed remaining English news: "promoted!"→"附加赛升级成功!", "relegated"→"附加赛降级"

### v0.9.0
- **Bug fix: ET goal double-counting** — MatchResult now stores regulation goals
  separately from ET goals; homeGoals = regulation only, etHomeGoals = extra time only
- **Bug fix: league cup matchday empty** — league cup windows beyond R1 now get
  pre-populated with fixtures after each round completes
- **Chinese shortNames** — all 32 teams use 2-char Chinese abbreviations
  (皇马/曼城/拜仁/利物/巴萨/国米/热刺/蓉城/亚泰 etc.)
- **Team badges** — new TeamBadge SVG component (shield shape + team color + initials)
  used in team detail header and teams hub

### v0.8.3
- **Bug fix**: promoted/relegated teams no longer show 0s in season records
  - Season records now search ALL league standings to find the team's actual data
  - leagueLevel in record reflects the league they played in, not the new one
- **Team detail: coach change history** — shows all coach changes for the team across seasons
- **Season records enhanced**:
  - Coach column: shows which coach managed that season (clickable)
  - Champion row highlighted in gold
  - League level shown as 顶/甲/乙 colored tags
  - Cup wins shown as badges (联杯/超杯/冠军杯)
  - Responsive: hides W/D/L and GF/GA on smaller screens

### v0.8.2
- **Super Cup two-legged ties merged** into single bracket columns
  - QF-L1 + QF-L2 → one "八强(两回合)" column showing aggregate scores
  - Each cell shows: team names, aggregate total, first/second leg scores below
  - Away goals rule indicator when aggregate is tied
  - Penalty result shown when applicable
  - "首回合 2-1 | 次回合待赛" for in-progress ties
- League Cup and World Cup brackets unchanged (single-leg, works correctly)
- Dashboard result cards: round labels translated (QF→八强, SF-L1→四强首回合, etc.)

### v0.8.1
- Cup pages: **qualification rules** banner for each cup type
  - 联赛杯: "全部32支球队, 单场淘汰制"
  - 超级杯: "顶级前10+甲级前4+乙级前2, 小组赛+两回合淘汰"
  - 环球冠军杯: "实力前16, 全员进淘汰赛, 每4赛季一次"
- **League level tags** (顶/甲/乙) shown next to every team name in bracket and group tables
  - Gold for 顶级, blue for 甲级, green for 乙级
- Group tables: added "前2名晋级" qualification line
- Bracket cells widened (w-40/w-48) for better readability with tags

### v0.8.0
- **Streak news**: 3+连胜/连败/5+不败自动推送新闻
- **Special event news**: 帽子戏法、补时绝杀自动推送
- **Team growth/decline**: 赛季结束后球队属性微调
  - 冠军/前列球队 overall +0~2
  - 末尾/降级球队 overall -0~2
  - 升级球队 depth/overall +1
- **League trend chart**: 联赛页新增"走势"tab
  - SVG 折线图展示前6名积分累计变化
  - 球队颜色对应折线，带图例
- **Settings page** (`/settings`):
  - 游戏信息（赛季/种子/球队数/存档大小）
  - 导出存档为 JSON 文件
  - 导入存档从 JSON 文件恢复
  - 重置游戏（二次确认）
- **Richer match events**: 新增5种进球描述、2种扑救描述、2种犯规描述

### v0.7.0
- **Season Review** component: shows full season summary after each season ends
  - Champions grid (all competitions)
  - Season stats: best attack, best defense, most wins, coach changes
  - Top 5 scorers with team colors
  - Promotions & relegations with color-coded cards
- Dashboard: new "S{N}回顾" tab appears after completing a season
- History page rewritten: expandable season cards with full SeasonReview inside
- **Season-end news push** — much richer end-of-season news:
  - League champions with points total
  - Season top scorer (射手王)
  - Best defense team
  - Best attack team
  - All promoted/relegated teams
  - Coach changes summary

### v0.6.1
- Cup page rewritten with **horizontal bracket/tree** for knockout rounds
  - Each match displayed as a card: team color dots + names + score
  - Winner highlighted in green, loser dimmed
  - Later rounds spaced wider to align with earlier match outcomes
  - Horizontal scroll on mobile for full bracket view
  - Placeholder cells for future rounds (待定)
- Round names fully Chinese: 第一轮/第二轮/八强/四强/决赛
- Two-legged knockout labels: 八强首回合/八强次回合/四强首回合/四强次回合
- Group tables: 4-team standings with expandable fixture list
- Winner celebration badge with team color accent
- Fixed remaining English: AET→加时, ET→加时, P→点球, OG→乌龙球
- Modal stat labels: ATK→进攻, MID→中场, DEF→防守, STA→稳定, DEP→深度, OVR→综合

### v0.6.0
- **Player system**: each team has 22 permanent players (3 GK, 7 DF, 7 MF, 5 FW)
- Players identified by shirt number (1-99), permanently bound to clubs
- 2-3 star players per squad with boosted ratings and iconic numbers (#1, #7, #9, #10, #11)
- Match events now bind to player numbers: "7号 反击中冷静推射得手"
- All match event descriptions rewritten in Chinese
- Player stats tracked per season: goals, assists, yellow/red cards, appearances
- New **Players Hub** page (`/players`) with tabs: 射手榜 / 助攻榜 / 纪律
- Top scorers/assisters with gold/silver/bronze badges
- **Team detail page** now shows full squad roster grouped by position
- Squad roster: number badge, position tag, rating bar, season stats, star indicator
- Sidebar: added "球员中心" nav link

### v0.5.1
- Match day fixtures grouped by league level (顶级联赛/甲级联赛/乙级联赛/杯赛)
- Contextual tips for key matches:
  - 强强对话: elite/strong teams facing each other
  - 爆冷预警: big overall gap between teams
  - 保级生死战: both teams in relegation zone
  - 争冠焦点: both teams in top 3
  - 下课危机: coach pressure > 55
- Results tab also grouped by competition
- League fixture competitionName changed to Chinese (顶级联赛/甲级联赛/乙级联赛)
- All news text fully Chinese (promotions, relegations, firings, upsets, trophies)

### v0.5.0
- Full Chinese localization: W/D/L → 胜/平/负, all labels in Chinese
- New **Teams Hub** page (`/teams`) with tier classification system
  - 5 tiers: 豪门 / 劲旅 / 中游 / 平民 / 草根
  - Toggle view: "按档次" (by tier) or "按联赛" (by league level)
  - Team cards with color badge, OVR, coach, morale indicator, form
- Added `tier` field to TeamBase type for all 32 teams
- **Dashboard completely redesigned** with tabbed layout:
  - "比赛日" tab: fixture cards with predictions
  - "战报" tab: results + news (auto-switches after advancing)
  - "总览" tab: quick standings for all leagues
  - Compact single-row header, no excessive scrolling
- Sidebar: added "球队中心" nav link under 管理 section

### v0.4.1
- Full mobile responsive overhaul
- Collapsible hamburger menu for mobile (sidebar hidden, overlay nav drawer)
- League standings: hide W/D/L/GF/GA columns on mobile, show #/Team/Played/GD/Pts/Form
- Cup group tables: hide secondary columns on mobile
- Dashboard: stacked match day header, responsive banner, hidden decorative elements
- Modal slides up from bottom on mobile (sheet-style)
- Team detail: color badge header with OVR and star rating
- Coaches page: responsive card padding and sizing
- All touch targets >= 44px
- Responsive font sizes and padding throughout

### v0.4.0
- New **Coaches Hub** page (`/coaches`) with full coach roster
- Filter tabs: all / employed / unemployed
- Sort by: rating, trophies, pressure, name
- Each coach card shows: rating badge, style label, team color dot, buffs, pressure gauge
- Redesigned coach detail page with gradient header, buff grid, trait bars, career timeline
- Added "教练中心" nav link in sidebar under new "管理" section

### v0.3.1
- Balance overhaul: fatigue, morale, squad health, coach pressure all retuned
- Fatigue per match: 8 → 4, recovery per rest: 5 → 6
- Morale: win +6/loss -4 (was +5/-8), natural drift toward 65
- Squad health: lighter wear (-1/match), injury risk only above 70 fatigue
- Coach pressure: loss +5 (was +8), win -4 (was -3), firing threshold raised to 80
- Fatigue penalty on match strength halved
- Initial states: morale 70, squad health 92, fatigue 5, pressure 5
- Season reset carries only 30% of pressure
- Momentum decays naturally toward 0

### v0.3.0
- Custom logo icon (favicon + in-app)
- Author credit (by KurtDubain)
- README with full game documentation

### v0.2.0
- Real teams from Big 5 leagues + Chinese Super League
- Team color accents throughout UI
- MatchDetailModal with pre-match predictions and post-match analysis
- Clickable fixtures everywhere (Dashboard, Calendar, League, Cup)
- UI overhaul: gradient banners, better cards, zone indicators
- Enhanced league page with schedule tab and season stats
- Improved welcome screen and layout design

### v0.1.0
- Initial release
- 3-tier league system with 32 teams
- Global calendar window system (~48 windows/season)
- Match simulation engine (seeded Poisson)
- League Cup, Super Cup, World Championship Cup
- Coach system with 36 coaches, firing/hiring
- Honor system and season history
- localStorage persistence
- 7 pages: Dashboard, Calendar, League, Cup, Team, Coach, History

---

<p align="center">
  <sub>Built with Vite + React + TypeScript + Tailwind</sub><br/>
  <sub>by <a href="https://github.com/KurtDubain">KurtDubain</a></sub>
</p>
