<p align="center">
  <img src="public/favicon.svg" width="80" alt="Football Universe Logo"/>
</p>

<h1 align="center">足球联赛宇宙</h1>
<p align="center"><strong>电子斗蛐蛐模拟器 | Football League Universe Simulator</strong></p>
<p align="center">by <a href="https://github.com/KurtDubain">KurtDubain</a></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.0.0-blue" alt="version"/>
  <img src="https://img.shields.io/badge/React-18-61dafb" alt="React"/>
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Vite-8-646cff" alt="Vite"/>
  <img src="https://img.shields.io/badge/15000+-lines-green" alt="lines"/>
</p>

---

## 这是什么？

一个**纯前端的足球赛季宇宙模拟器** — 不是操控球员踢球，而是看一整个足球世界自动运转：联赛积分、杯赛爆冷、教练下课、升降级、荣誉积累，长期游玩自然生成"历史"和"故事"。

核心体验：**电子斗蛐蛐** — 按下推进键，看比分一个个翻出来，看谁夺冠谁降级。

## 核心功能

### 联赛体系
- **三级联赛**：顶级联赛(16队) / 甲级联赛(8队) / 乙级联赛(8队)
- 双循环赛制：顶级30轮，甲乙14轮
- 升降级 + 附加赛（顶级倒3 vs 甲级第3，甲级倒3 vs 乙级第3）
- 积分榜排名变动箭头（▲▼—）
- 联赛积分走势折线图（前6名）
- 收官之战标签（最后3轮）

### 杯赛系统
- **联赛杯**：32队单场淘汰赛（5轮）
- **超级杯**：16队（10顶+4甲+2乙），4组小组赛 + 两回合淘汰赛 + 单场决赛
- **环球冠军杯**：每4赛季，32队全参加，8组×4队，每组前2名晋级16强
- 对称淘汰赛对阵树（左右半区 + 中间决赛）
- 杯赛晋级规则说明卡 + 抽签新闻

### 比赛模拟
- **Seeded PRNG** (mulberry32) — 同种子可复现
- 泊松分布进球采样
- 多因素加权：基础属性、教练buff、士气、疲劳、主场优势、势头、阵容深度
- **德比系统**：11组经典对决（国家德比/米兰德比/北伦敦德比/京沪大战等）
- **弱队加成**：实力差距>8时弱队获得小幅攻击力提升
- 杯赛随机性更高，更容易爆冷

### 比赛直播
- **Canvas 2D 球场**：22个带号码的球员 + 4-4-2阵型
- 球在球员之间传递（5种战术模式：后场组织/快速反击/边路进攻/中路渗透/防守倒脚）
- 进球时球飞向球门 + 金色光环 + 球网震动
- 半场休息自动暂停 + 解说文字
- 1x/2x/4x 速度控制 + 暂停/跳过
- 杯赛决赛自动触发直播，重要比赛可手动回放

### 球员系统
- 每队22名球员（3门将+7后卫+7中场+5前锋）
- 号码1-99，永久绑定俱乐部
- 2-3名明星球员（#1/#7/#9/#10/#11 标志性号码）
- 比赛事件绑定球员号码（"35' 7号 反击中冷静推射得手 [反超比分！]"）
- 球员详情页（/player/:id）
- 射手榜 / 助攻榜 / 纪律榜

### 教练系统
- 36名教练，5种风格（进攻/防守/控球/反击/均衡）
- 教练buff影响比赛结果（联赛专精/杯赛专精）
- 压力下课机制（连败/远低预期/杯赛耻辱出局）
- **急流勇退**：名帅夺冠后8%概率主动离任
- 执教成绩统计（胜率/场均积分/冠军数/最佳赛季）
- 名帅殿堂排行榜

### 球队系统
- 32支真实球队（五大联赛 + 中超）
- 5档分类：豪门/劲旅/中游/平民/草根
- 球队颜色标识 + 盾形徽章
- 赛季间成长/衰退（冠军+OVR，末位-OVR）
- 升级球队大幅补强（+3~5 OVR）
- 强队12%概率内部动荡
- **OVR走势折线图**（积分+排名+OVR三线并行）
- 每赛季杯赛成绩记录（冠军/亚军/八强/小组赛出局等）

### 赛历窗口系统
- 每赛季~48个窗口，联赛/杯赛/超级杯严格交叉推进
- 只能执行当前窗口，不能跳过
- 每个窗口的结果影响后续比赛（士气/疲劳/势头联动）
- **快速推进**：快进5步/10步/到杯赛/到赛季末

### 动画与视觉
- 结算逐场揭晓动画（重要比赛最后揭晓，比分弹跳）
- 纸屑庆祝 / 奖杯庆祝（决赛/赛季结束自动触发）
- 比赛标签：决赛/保级战/冠军战/德比战/爆冷/收官之战/生死战
- Canvas 粒子背景（欢迎页）+ 侧边栏微光
- 进球上下文：[扳平比分！]/[反超！]/[绝杀！]/[帽子戏法！]
- 新闻轮播条（可展开详情面板）

### 随机事件 & 成就
- 每窗口15%概率触发随机事件（伤病/青训新星/财团注资/球迷风波/状态回暖）
- 成就系统：不败赛季/统治级表现/百分赛季/连级跳/进球机器
- 双冠王/三冠王/四冠王检测
- 赛季半程里程碑新闻
- 赛季前展望（夺冠热门/升降级球队）

### 历史与数据
- 赛季回顾：冠军墙 + 亚军 + 射手王高光 + 升降级一览
- **趣味数据**：最高积分/最多进球/最佳防守/连冠纪录/最动荡赛季
- **名帅殿堂**：教练生涯排行（奖杯数/执教赛季/被解雇次数）
- 历史奖杯榜 + 成就殿堂

### 持久化
- localStorage 自动存档
- 导出/导入存档（JSON文件）
- 自动裁剪旧新闻和事件数据防溢出
- 关注球队持久化

## 球队阵容

| 级别 | 球队 |
|------|------|
| **顶级联赛** | 皇马, 曼城, 拜仁, 利物浦, 巴萨, 阿森纳, 国米, 大巴黎, 尤文, 马竞, 多特, AC米兰, 切尔西, 那不勒斯, 上海海港, 热刺 |
| **甲级联赛** | 勒沃库森, 阿斯顿维拉, 罗马, 马赛, 山东泰山, 北京国安, 塞维利亚, 里昂 |
| **乙级联赛** | 成都蓉城, 武汉三镇, 浙江队, 南安普顿, 伯恩利, 河南队, 天津津门虎, 长春亚泰 |

## 技术栈

| 层 | 技术 |
|---|------|
| 构建 | Vite 8 |
| 框架 | React 18 + TypeScript |
| 状态 | Zustand 5 (persisted) |
| 样式 | Tailwind CSS 4 |
| 路由 | React Router 7 |
| 随机 | Seeded mulberry32 |
| 渲染 | Canvas 2D (比赛直播) |
| 部署 | Vercel (静态站点) |

## 快速开始

```bash
pnpm install
pnpm dev      # 开发服务器
pnpm build    # 生产构建
pnpm preview  # 预览
```

## 项目结构

```
src/
  app/            — 应用外壳、布局、路由
  components/     — 可复用组件 (11个)
    MatchDetailModal  — 赛前预测/赛后分析弹窗
    MatchLive         — 比赛直播模拟器
    PitchCanvas       — Canvas 2D 球场引擎
    ResultAnimation   — 结算逐场揭晓
    Celebration       — 庆祝动画 + 比赛标签
    SeasonReview      — 赛季回顾
    NewsTicker        — 新闻轮播条
    TeamBadge         — 球队盾形徽章
    TeamName          — 球队名+档次标签
    CanvasEffects     — 粒子背景/能量波/微光
    Logo              — 应用Logo
  pages/          — 路由页面 (13个)
    Dashboard, Calendar, League, Cup
    Teams, Coaches, Players
    TeamDetail, CoachDetail, PlayerDetail
    History, Settings, Welcome
  engine/         — 纯模拟逻辑 (24个文件)
    match/        — RNG, 泊松分布, 模拟器, 事件, 预测
    season/       — 赛历构建, 赛季管理, 辅助函数
    standings/    — 积分榜, 赛程, 升降级
    cups/         — 联赛杯, 超级杯, 环球冠军杯
    coaches/      — 教练效果, 压力, 招聘
    players/      — 球员生成, 统计
    honors/       — 荣誉追踪
    events.ts     — 随机赛季事件
    achievements.ts — 成就系统
  config/         — 游戏数据 (球队/教练/赛事/平衡)
  store/          — Zustand 状态管理
  types/          — TypeScript 类型定义
  utils/          — 格式化工具
```

## 规模

- **69 个源文件**
- **15,000+ 行 TypeScript/React 代码**
- **50+ 次 Git 提交**
- **13 个页面 + 11 个组件 + 24 个引擎模块**

---

<p align="center">
  <sub>Built with Vite + React + TypeScript + Tailwind + Canvas</sub><br/>
  <sub>by <a href="https://github.com/KurtDubain">KurtDubain</a></sub>
</p>
