# 评分体系与记录墙重构方案

创建日期：2026-11-11

> 状态：阶段 A / B / C 已实现于分支 `fix/records-ties-and-bugs`，阶段 D 未开始。本文件第 3–5 节的代码块为方案示意，与实现有若干已记录偏差（见 0.1）；第 6 节仍是纯方案。当前状态以 [`current-status.md`](current-status.md) 为准。与 [`star-player-presence-plan.md`](star-player-presence-plan.md) 共用 `player-performance.ts` 的评分基线，改动需同步评估该文件已验收的"四位置中位数最大差 1.9"结论。

这份方案处理三个相互耦合的问题：球员评分的位置方差失控、金球奖与球队成就完全解耦、记录墙的并列与轮次不公。**不增加球员养成、手动训练、临场指挥或任何新的玩家操作。** 玩家仍然是观察历史的"上帝"。

**完成规则：只有参数影响模拟、并列展示、转会归属修复、跨级别校准和长跑验证全部通过，相关任务才可以勾选。**

## 0. 完成记录

本节是当前任务状态的权威清单。

- [x] 阶段 A：记录墙收敛为 4 项率值纪录，统一 `bestRate` 实现，并列全部展示。→ `eafbfc9`
- [x] 阶段 B：`season-awards.ts` 预建索引消除 O(n²)，修复转会球员的球队归属判定。→ `3e5a79d`
- [x] 阶段 C：金球奖独立于 `seasonScore`，引入球队成就乘子与低级别折扣。→ `e53c476`
- [ ] 阶段 D：评分参数重构（`scale` 收敛、`leagueStrength` 提权、`availability` 降权），`PLAYER_SCORE_VERSION` 升至 2。
- [ ] 阶段 D 前置：50 季新旧算法对照模拟完成，金球得主位置分布与叙事阈值影响已量化。

### 0.1 实现与方案的偏差

阶段 A–C 落地时对方案做了以下修正，均已写入测试：

- **后四名按表长计算**。方案第 5.2 节写的 `leaguePosition >= 14` 在 16 队表里只覆盖倒数三名。实现改为 `position > leagueSize - 4`，表长变化时自动跟随。
- **冠军与名次一律由积分榜派生**，不从 `honours` 传入。复用引擎自身的 `sortStandings`，避免与 `honorHistory` 形成两个真相来源。`previousPosition` 描述的是上赛季排名，已显式排除并有回归测试。
- **低级别球队的 `leaguePosition` 记为 0**，不参与榜尾惩罚。否则次级联赛球员会同时吃到级别折扣与保级区惩罚，与方案意图不符。
- **洲际杯 winners 改为数组**。方案示意是单个 `continentalCupWinner`，实际有三个洲际杯（大陆 / 南洲 / 东洲），需支持同赛季多个冠军。
- **世界杯乘子当前不生效**。`season-end.ts` 在结算末尾才调用 `initializeWorldCup`，此刻 `world.worldCup` 仍是上一届；调用处显式传 `null`，避免把上届冠军算进本赛季金球奖。该乘子在 `world-cup-timing-redesign.md` 阶段 3 完成后才会拿到数据。
- **展示分数不变**。排名用 `awardScore`，但 `mvpScoreValue` 仍上报 `seasonScore`，球员页、生涯冻结值与叙事扫描阈值全部不受影响；唯一影响是历史存档的评奖结果会变化。

非阻塞后续不属于完成门槛：教练市场"挑战者"路径、`matchHistory` 关键事件保留、配额溢出自动清理（后两项见第 6 节）。

## 1. 问题来源

本方案的问题不是推测，来自一次 S1–S6 的实际试玩与随后的只读代码核查。

### 1.1 试玩观察

- S1–S6 冠军全部是岛津众城，但六届金球奖只有 S3（佐佐木雅人，岛津）出自该队。
- S6 金球得主是国安后卫周永康，市值仅 €16M，赛季评分 87.5。
- S4/S5 金球得主罗文博效力楚门世界，非顶级强队。
- S1 岛津与恒大同为 19 胜，记录墙"单赛季最多胜场"只显示恒大。
- 记录墙 6 项统计类纪录中，"最多败场"与"最多胜场"并排陈列。

### 1.2 代码核查结论

| 观察 | 根因位置 | 性质 |
| --- | --- | --- |
| 后卫能压过冠军核心 | `player-performance.ts:88-93` 的 `scale` 参数 | 参数设计错误 |
| 低级别球员可竞争金球 | `season-awards.ts:64-82` MVP 无级别限制 | 口径不一致 |
| 金球与球队战绩无关 | `player-performance.ts:250` 无成就项 | 目标冲突 |
| 纪录并列被吞 | `History.tsx:98-107` 严格 `>` / `<` | 实现缺陷 |
| 最少积分可能给了 3 场球队 | `History.tsx:100,103` filter/reduce 初始值不匹配 | 真实 bug |

## 2. 现状基线

### 2.1 评分三层结构

```text
positionQuality            位置内 per90 锚点归一化（0-100）
  ↓ × confidence           出场时间置信度 = minutes / (minutes + 900)
adjustedPositionQuality
  ↓
score = adjustedPositionQuality × 0.70
      + availabilityScore       × 0.20
      + leagueStrength          × 0.10
```

分层本身是清楚的，`ANCHORS` 固定采样自 50 季且不随实时世界重建，这一"同一表现永远得同一分"的设计应当保留。问题全在参数。

### 2.2 联赛结构

`config/competitions.ts`：

| 级别 | 队数 | 轮次 | 赛季场次 |
| --- | --- | --- | --- |
| 顶级联赛 | 16 | 30 | 240 |
| 甲级联赛 | 8 | 14 | 56 |
| 乙级联赛 | 8 | 14 | 56 |

轮次差异为记录墙的"最多 X 场"类纪录带来结构性不公：顶级联赛球队天然垄断全部"最多"类纪录。

### 2.3 评分的下游消费者

改动 `seasonScore` 会影响以下已验收行为，必须逐项回归：

- `narrative-world-scan.ts` 12 处硬编码阈值：`>= 70`、`>= 76`、`>= 85`、`confidence >= 0.25`。
- `career-score.ts` 的 `summarizeCareerScore` 与 `preserveRetiredCareerScores` 冻结的 `careerScore`。
- `season-awards.ts` 全部五个奖项。
- `Players.tsx` 综合榜与生涯榜展示。
- `market-value.ts` 不直接依赖 `seasonScore`，但转会决策读取球员表现。

## 3. 阶段 A：记录墙收敛

### 3.1 决策

8 项收敛为 4 项，全部改为**率值**以消除轮次不公。

保留：

1. 王朝最长连冠（沿用现有独立循环逻辑）。
2. 单赛季最高积分率 = `leaguePoints / leaguePlayed`。
3. 单赛季最强火力 = `leagueGF / leaguePlayed`。
4. 单赛季最稳防线 = `leagueGA / leaguePlayed`（取最低）。

删除：

- 最多胜场 / 最多败场 — 轮次不公；最多败场是耻辱柱而非荣誉。
- 最多积分 / 最少积分 / 最多进球 / 最少失球的绝对值版本 — 被率值版本取代。
- 单赛季最多换帅 — 管理层混乱指标，不是荣誉。

### 3.2 统一实现

四项共用一个函数，从结构上消除初始值不匹配的可能。

```ts
interface RateRecord {
  teamId: string;
  teamName: string;
  seasonNumber: number;
  value: number;    // 率值
  raw: number;      // 原始值，用于展示
  played: number;
}

function bestRate(
  records: SeasonRecord[],
  pick: (r: SeasonRecord) => number,
  direction: 'max' | 'min',
  minPlayed = 10,
): RateRecord[] {
  const eligible = records
    .filter(r => r.leaguePlayed >= minPlayed)
    .map(r => ({
      teamId: r.teamId,
      teamName: r.teamName,
      seasonNumber: r.seasonNumber,
      value: pick(r) / r.leaguePlayed,
      raw: pick(r),
      played: r.leaguePlayed,
    }));
  if (eligible.length === 0) return [];

  const values = eligible.map(e => e.value);
  const best = direction === 'max' ? Math.max(...values) : Math.min(...values);

  // 并列全部返回；排序稳定可复现
  return eligible
    .filter(e => Math.abs(e.value - best) < 1e-9)
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.teamId.localeCompare(b.teamId));
}
```

三个关键点：

- 返回数组而非单条，并列不再抽签。
- 单一实现覆盖全部四项，不可能再出现 filter 与 reduce 初始值不一致。
- `seasonNumber` 再 `teamId` 排序，结果可复现。

### 3.3 展示

并列时标题显示 `19胜（2 队并列）`，展开列出全部持有者。S1 的岛津与恒大 19 胜将成为"并列纪录"，而不是"恒大独占"。

### 3.4 验收

- [ ] 四项纪录在 30 轮与 14 轮联赛之间不再系统性偏向顶级联赛。
- [ ] 构造并列数据时全部持有者均展示，顺序稳定。
- [ ] `leaguePlayed < 10` 的记录不参与，且不因初始值问题胜出。
- [ ] 现有 `History.tsx` 相关测试全部通过或按新契约更新。

## 4. 阶段 B：评奖性能与归属修复

### 4.1 O(n²) 消除

现状两处每次调用都重建全量数组：

```ts
// season-awards.ts:38-40
const findPlayer = (uuid, teamId) =>
  squads[teamId]?.find(p => p.uuid === uuid)
  ?? Object.values(squads).flat().find(p => p.uuid === uuid);

// season-awards.ts:43-45
const segments = Object.values(playerStatSegments).filter(s => s.playerId === player.uuid);
```

MVP 循环对约 800 条 stat 各调用一次，每次重建 800 元素数组。

改法：循环外预建索引。

```ts
const playerByUuid = new Map<string, Player>();
for (const squad of Object.values(squads)) {
  for (const p of squad) playerByUuid.set(p.uuid, p);
}

const segmentsByPlayer = new Map<string, PlayerTeamSeasonStats[]>();
for (const seg of Object.values(playerStatSegments)) {
  const list = segmentsByPlayer.get(seg.playerId);
  if (list) list.push(seg);
  else segmentsByPlayer.set(seg.playerId, [seg]);
}
```

### 4.2 转会球员归属 bug

`rankedDefensivePlayer` 筛选用 `player.teamId`（球员当前球队），而 `buildAward` 颁奖用 `stat.teamId`（统计所属球队）：

```ts
.filter(player => player.position === position && topLeagueTeamIds.has(player.teamId))
```

中途转会的球员可能被错误归类或错误排除。统一使用 `stat.teamId`。

### 4.3 并列决胜

金球奖并列时按次要指标决胜，替代当前"保留先出现者"：

1. 球队成绩（冠军 > 前四 > 其他）
2. 出场时间
3. `uuid` 字典序（保证稳定）

### 4.4 验收

- [ ] 评奖耗时在 800 球员规模下可测量地下降，且无行为变化（除 4.2/4.3）。
- [ ] 构造赛季中期转会至顶级联赛的球员，最佳后卫判定使用统计所属球队。
- [ ] 构造并列评分，两次运行结果一致。

## 5. 阶段 C：金球奖独立设计

### 5.1 为什么不复用 seasonScore

`seasonScore` 服务球员页、生涯榜、转会价值与叙事扫描，首要目标是**稳定、可比、跨赛季一致**。金球奖要回答"本赛季谁最闪耀"，需要 `seasonScore` 刻意排除的**球队成就**维度。两者目标冲突，必须分开。

### 5.2 公式

```ts
function ballonDorScore(
  performance: PlayerPerformanceResult,
  context: {
    isLeagueChampion: boolean;
    leaguePosition: number;
    wonContinentalCup: boolean;
    wonWorldCup: boolean;
    leagueLevel: 1 | 2 | 3;
  },
): number {
  let score = performance.seasonScore;

  let multiplier = 1.0;
  if (context.isLeagueChampion) multiplier *= 1.18;
  else if (context.leaguePosition <= 4) multiplier *= 1.08;
  else if (context.leaguePosition >= 14) multiplier *= 0.94;

  if (context.wonContinentalCup) multiplier *= 1.10;
  if (context.wonWorldCup) multiplier *= 1.15;

  // 金球奖是"世界最佳"，低级别需要折扣
  if (context.leagueLevel === 2) multiplier *= 0.90;
  if (context.leagueLevel === 3) multiplier *= 0.78;

  // 出场样本门槛
  const sampleGate = performance.metrics.minutes >= 1800 ? 1.0
    : performance.metrics.minutes >= 1200 ? 0.95
    : 0.85;

  return score * multiplier * sampleGate;
}
```

### 5.3 设计要点

- **乘子而非加法**。加法会让冠军队的平庸球员分数虚高；乘法保证只有本身就强的球员才能受益。
- **低级别折扣补齐口径**。当前最佳后卫/门将限定顶级联赛，金球奖却全级别通吃，这是真实的不一致。
- **环球冠军杯权重最高**（×1.15），因为 `worldCupConfig.interval = 4`，四年一届的稀有度应被奖励。
- **出场门槛用乘子而非硬截断**。现状 `appearances < 5` 太松；改为 1800 分钟满分、1200 分钟 0.95、以下 0.85，保留"半季爆发"的竞争力。

### 5.4 兼容性

金球奖乘子**不改变** `seasonScore`，因此：

- 球员页展示分数不变。
- `careerScore` 冻结值不变。
- `narrative-world-scan.ts` 的阈值不变。

**唯一影响是历史存档的评奖结果会变化。** 这是本阶段唯一需要作者明确接受的取舍。

### 5.5 验收

- [ ] 50 季模拟中，金球得主出自当季顶级联赛冠军或前四的比例显著高于现状。
- [ ] 低级别球员仍可获奖，但需要明显更高的个人表现。
- [ ] 出场不足 1200 分钟的球员获奖比例下降。
- [ ] 五个奖项的互斥规则保持现状（仅最佳新星排除已获奖者）。

## 6. 阶段 D：评分参数重构

**本阶段风险最高，必须在 A/B/C 完成并验证后单独进行。**

### 6.1 scale 收敛

```ts
// 现状
GK: { median: 52.7, scale: 0.83 },
DF: { median: 52.1, scale: 1.85 },   // 方差最大
MF: { median: 48.5, scale: 1.42 },
FW: { median: 50.9, scale: 1.14 },

// 方案
GK: { median: 52.7, scale: 1.00 },
DF: { median: 52.1, scale: 1.15 },
MF: { median: 48.5, scale: 1.25 },
FW: { median: 50.9, scale: 1.20 },
```

`scale` 是放大系数：后卫偏离中位数 1 分，最终评分偏离 1.85 分。保级队中卫因被压着打，防守动作基数天然更大，per90 冲到 P90 后 `positionQuality` 被放大到 85+，足以压过冠军队核心前锋。

### 6.2 leagueStrength 提权

```ts
// 现状：10% 权重 × 10 分差 = ±1 分，形同虚设
if (level === 2) return 95;
if (level === 3) return 90;
return 100;

// 方案：15% 权重 × 24 分差 = ±3.6 分
if (level === 2) return 88;
if (level === 3) return 76;
return 100;
```

不更激进的原因：跨级别转会应仍然可能。压得太狠会让转会市场僵化。

### 6.3 availability 降权

`confidence` 已压缩低出场球员的 `positionQuality`，`availabilityScore` 再占 20% 是**双重惩罚**。一个 20 轮出场 15 次的轮换球员，真实水平被系统性低估。

```ts
// 现状
adjustedPositionQuality * 0.70 + availabilityScore * 0.20 + leagueStrength * 0.10

// 方案
adjustedPositionQuality * 0.73 + availabilityScore * 0.12 + leagueStrength * 0.15
```

### 6.4 版本标记

`PLAYER_SCORE_VERSION` 由 1 升至 2，UI 标注"旧口径"。`PLAYER_STAT_SCOPE_TOOLTIPS.legacy` 已有文案基础：*"旧赛季缺少完整评分字段时标记为旧口径，不补造历史动作"*。

### 6.5 存档兼容性分析

- **已冻结的 `careerScore`**：`preserveRetiredCareerScores` 写入 `retirementHistory` 的值不会重算，历史评分保持稳定。这是好事，不会出现"退役球星生涯评分突变"。
- **`playerStatsHistory` 滚动行**：存的是当时算好的值，新算法不追溯重算。
- **当前赛季与未来赛季**：受新算法影响。

因此改算法只影响当前及未来赛季，**不破坏存档兼容性**。

### 6.6 前置要求

**阶段 D 不得在参数影响模拟完成前开始。** 需要一份 50 季对照报告，至少包含：

- 新旧算法下四位置评分的分布变化（中位数、P10、P90）。
- 金球得主的联赛级别与球队排名分布对比。
- `narrative-world-scan.ts` 四个硬编码阈值（70 / 76 / 85 / confidence 0.25）触发的叙事条数变化。
- `star-player-presence-plan.md` 已验收的"四位置中位数最大差 1.9、P90 最大差 2.0"是否仍然成立。

### 6.7 验收

- [ ] 参数影响模拟报告完成并经作者确认。
- [ ] 四位置中位数差仍控制在既有验收范围内，或差异有明确解释。
- [ ] 叙事扫描阈值重新校准，无叙事稀疏或泛滥。
- [ ] `PLAYER_SCORE_VERSION = 2`，旧口径正确标注。
- [ ] 现有 1,110 项测试全部通过，未调整超时或产品断言。

## 7. 本方案不做的事

- 不增加球员养成、训练、签约经营或临场指挥。
- 不修改 `ANCHORS` 的采样方式，继续保持"同一表现永远得同一分"。
- 不追溯重算历史赛季评分。
- 不修改球队名称、自定义球队能力或观察者游戏模式。
- 不改动 `market-value.ts` 的 €150M 封顶与荣誉脱钩问题（另案）。

## 8. 相关但不在本方案内的事项

以下问题在核查中发现，与本方案相邻但独立，建议单独立项：

- **配额溢出无自救**：`compressed-storage.ts:70` 的 `QuotaExceededError` 只 `console.error` 加派发事件，不触发 `archiveCompletedMatchDetails`。玩家在 4MB 预警线之上继续玩会丢失进度。
- **`matchHistory` 归档即丢回放**：`season-manager.ts:849-873` 只存比分与教练，不存 events。`MATCH_HISTORY_SEASONS = 3` 的真实含义是"保留 3 季比分记录"而非"3 季回放"。
- **快进路径重复裁剪**：`game-store.ts` 四个快进 action 各自调用 `enforceStorageLimits`，而 `initializeNewSeason` 内部已调用。注释要求"exactly once per season boundary"，代码未遵守。
- **教练市场僵化**：`coach-hiring.ts` 的 `scoreRatingFit` 用 `Math.abs` 惩罚过度合格，rating 90 名帅去期望值 3 的球队得分（39.5）远低于 rating 71 普通教练（64.2），`randomFactor` ±5 无法翻盘。
- **`types/award.ts:11` 注释漂移**：`young_player` 注释写 "top scorer in low-tier team"，实现是 U23 最高评分。
