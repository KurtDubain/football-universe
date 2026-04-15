<p align="center">
  <img src="public/favicon.svg" width="80" alt="Football Universe Logo"/>
</p>

<h1 align="center">足球联赛宇宙</h1>
<p align="center"><strong>电子斗蛐蛐模拟器 | Football League Universe Simulator</strong></p>
<p align="center">by <a href="https://github.com/KurtDubain">KurtDubain</a></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.0-blue" alt="version"/>
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
