<p align="center">
  <img src="public/favicon.svg" width="80" alt="Football Universe"/>
</p>

<h1 align="center">足球联赛宇宙 ⚽</h1>
<h3 align="center">Football League Universe Simulator</h3>

<p align="center">
  <strong>你不操控比赛 — 你观看整个足球宇宙自动演化</strong><br/>
  <em>You don't play the matches — you watch an entire football universe unfold on its own.</em>
</p>

<p align="center">
  <a href="https://football-universe-ebon.vercel.app/"><img src="https://img.shields.io/badge/%E2%96%B6%20Live%20Demo-Play%20Now-22c55e?style=for-the-badge&logo=vercel" alt="Live Demo"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.1.0-blue?style=flat-square" alt="version"/>
  <img src="https://img.shields.io/github/license/KurtDubain/football-universe?style=flat-square" alt="license"/>
  <img src="https://img.shields.io/badge/React_18-61dafb?style=flat-square&logo=react&logoColor=black" alt="React"/>
  <img src="https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Vite_8-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"/>
  <img src="https://img.shields.io/badge/16000%2B_lines-green?style=flat-square" alt="lines"/>
  <img src="https://img.shields.io/badge/language-中文-red?style=flat-square" alt="Chinese"/>
</p>

---

> **电子斗蛐蛐** — 按下推进键，联赛轮次翻出比分，杯赛冷门上演，教练被解雇，弱队奇迹升级……
> 长期游玩自然生成"历史"和"故事"。没有操控，只有命运。

---

## Why This Project? | 为什么做这个？

市面上的足球经理游戏（FM、ZenGM）都要你操控球队 — 买卖球员、排阵型、做决策。

**这个项目反其道而行**：你什么都不操控，只做一个上帝视角的观察者。

32支真实球队、3级联赛、4项杯赛、36名教练、700+球员，在确定性随机引擎驱动下自动演化。你唯一的操作就是点「推进」按钮 — 然后看着王朝崛起、豪门沉沦、黑马逆袭、名帅下课。

**No controls. No tactics. Just fate.** ⚡

---

## Features | 核心特性

### 🏟️ 完整联赛体系
三级联赛（16+8+8），双循环赛制，升降级 + 保级附加赛。
积分榜实时排名箭头、走势折线图、收官之战标签。

### 🏆 四大杯赛
| 赛事 | 赛制 | 频率 |
|------|------|------|
| **联赛杯** | 32队单场淘汰 5轮 | 每赛季 |
| **超级杯** | 16队 小组赛+两回合淘汰 | 每赛季 |
| **环球冠军杯** | 32队 8组循环+淘汰赛 | 每4赛季 |

对称淘汰赛对阵树 · 客场进球规则 · 杯赛规则卡

### ⚽ 深度模拟引擎
泊松分布进球采样 + 多因素加权：OVR · 教练buff · 士气 · 疲劳 · 主场 · 动量 · 德比加成 · 弱队补正。  
**Seeded PRNG (mulberry32)** — 同种子 100% 可复现。杯赛波动更高，爆冷常态化。

### 📺 Canvas 2D 比赛直播
22个带号码球员在球场上传球跑动。5种战术模式 · 进球金色光环 · 半场休息 · 解说文字。  
杯赛决赛自动触发直播，重要比赛可回放。

### 👔 教练生态
36名教练 × 5种风格 × 6项buff。压力累积 → 连败下课 / 杯赛耻辱出局。  
名帅夺冠后 8% 概率急流勇退。名帅殿堂排行榜。

### 📊 无限历史积累
赛季回顾 · 历史奖杯榜 · 趣味纪录（最高积分/连冠/最动荡赛季）·  
成就系统（不败赛季/百分赛季/连级跳）· OVR走势图 · 教练履历

### 🎬 动画与叙事
结算逐场揭晓 · 纸屑庆祝 · 比赛标签（决赛/德比/保级战/爆冷/绝杀）·  
进球上下文（[扳平！]/[反超！]/[帽子戏法！]）· 新闻轮播

---

## Quick Start | 快速开始

**在线体验（无需安装）：** **[football-universe-ebon.vercel.app](https://football-universe-ebon.vercel.app/)**

本地运行：

```bash
git clone https://github.com/KurtDubain/football-universe.git
cd football-universe
pnpm install
pnpm dev
```

> 需要 Node.js 22+

---

## Screenshots | 截图

> 📸 **TODO**: 添加游戏截图  
> *建议截取：比赛日主页、联赛积分榜、杯赛对阵树、比赛直播、赛季回顾*

<!--
添加截图后取消注释：
<p align="center">
  <img src="docs/screenshots/dashboard.png" width="45%" />
  <img src="docs/screenshots/league.png" width="45%" />
</p>
<p align="center">
  <img src="docs/screenshots/cup-bracket.png" width="45%" />
  <img src="docs/screenshots/match-live.png" width="45%" />
</p>
-->

---

## Teams | 球队阵容

| 级别 | 球队 |
|------|------|
| **顶级联赛** (16) | 皇马 · 曼城 · 拜仁 · 利物浦 · 巴萨 · 阿森纳 · 国米 · 大巴黎 · 尤文 · 马竞 · 多特 · AC米兰 · 切尔西 · 那不勒斯 · 上海海港 · 热刺 |
| **甲级联赛** (8) | 勒沃库森 · 阿斯顿维拉 · 罗马 · 马赛 · 山东泰山 · 北京国安 · 塞维利亚 · 里昂 |
| **乙级联赛** (8) | 成都蓉城 · 武汉三镇 · 浙江队 · 南安普顿 · 伯恩利 · 河南队 · 天津津门虎 · 长春亚泰 |

五大联赛 + 中超，5档分类：豪门 / 劲旅 / 中游 / 平民 / 草根

---

## Tech Stack | 技术栈

| Layer | Tech |
|-------|------|
| Build | **Vite 8** |
| UI | **React 18** + **TypeScript 5** |
| State | **Zustand 5** (persisted to localStorage) |
| Styling | **Tailwind CSS 4** |
| Routing | **React Router 7** |
| RNG | Seeded **mulberry32** (deterministic) |
| Rendering | **Canvas 2D** (match live broadcast) |
| Deploy | **Vercel** (static site) |

16,000+ lines · 70 source files · 13 pages · 11 components · 24 engine modules

<details>
<summary>📁 Project Structure</summary>

```
src/
├── engine/           — Pure simulation logic (UI-agnostic)
│   ├── match/        — RNG, Poisson sampling, simulator, events, prediction
│   ├── season/       — Calendar builder, season manager, helpers
│   ├── standings/    — League tables, schedules, promotion/relegation
│   ├── cups/         — League Cup, Super Cup, World Cup
│   ├── coaches/      — Coaching effects, pressure, hiring
│   ├── players/      — Player generation, stats tracking
│   └── honors/       — Trophy & achievement tracking
├── config/           — Game data (teams, coaches, derbies, balance)
├── pages/            — 13 route pages
├── components/       — 11 reusable components
├── store/            — Zustand state management
└── types/            — TypeScript type definitions
```

</details>

---

## Roadmap | 路线图

- [ ] 截图 & 演示 GIF
- [ ] 英文国际化 (i18n)
- [ ] 转会系统
- [ ] 球员成长 & 退役
- [ ] 更丰富的随机事件
- [ ] 自定义球队 & 联赛配置
- [ ] PWA 离线支持

---

## Contributing | 贡献

欢迎任何形式的贡献！Issues、PR、功能建议都可以。

```bash
pnpm install    # 安装依赖
pnpm dev        # 启动开发服务器
pnpm build      # 检查构建是否通过
```

---

## Changelog | 更新日志

<details>
<summary>展开查看完整日志</summary>

### v3.1.0
- 设置页面改造：游戏内指南、关注球队切换、历史统计面板
- Welcome 页面优化：玩法说明 + 无限赛季标签
- 修复：世界杯小组赛 competitionType 标记错误
- 修复：教练压力多场比赛处理
- 优化：教练压力衰减逻辑
- 移动端适配优化

### v3.0.0
- 首次完整版本发布
- 三级联赛 + 四项赛事 + 32支球队
- 比赛直播 Canvas 2D 引擎
- 教练/球员/德比/成就系统

</details>

---

## License

[MIT](./LICENSE) — free to use, modify, and distribute.

---

<p align="center">
  <a href="https://football-universe-ebon.vercel.app/">🎮 Play Now</a> · 
  <a href="https://github.com/KurtDubain">by KurtDubain</a>
</p>
<p align="center">
  <sub>Built with React + TypeScript + Canvas 2D + Zustand + Tailwind</sub>
</p>
