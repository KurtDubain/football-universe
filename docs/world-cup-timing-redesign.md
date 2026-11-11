# 环球冠军杯时序重构方案

创建日期：2026-11-11

> 状态：设计阶段，未实现。本文件所有代码块均为方案示意，不代表仓库现状。当前状态以 [\`current-status.md](\`current-status.md) 为准。
>
> **依赖关系**：\`rating-and-records-redesign.md\` 阶段 C 的 \`wonWorldCup\` 乘子依赖本方案完成。在本方案落地前，该乘子拿不到数据。

这份方案把环球冠军杯从“赛季结算之后的尾巴”改为“赛季之内的收官赛事”，使世界杯冠军能够参与当季评奖、荣誉与档案记录。**不改变赛事规模、赛制、分档规则或东道主选择逻辑。**

**完成规则：只有时序迁移、评奖纳入、档案正确性、僵尸状态清理、存档迁移和长跑验证全部通过，相关任务才可以勾选。**

## 0. 完成记录

- [ ] 阶段 1：日历插入函数与窗口编号重排。
- [ ] 阶段 2：世界杯初始化时机前移至赛季构建期。
- [ ] 阶段 3：评奖、荣誉与档案在世界杯决赛后统一结算。
- [ ] 阶段 4：删除 \`finalizeWorldCup\` 回补逻辑与 \`worldCupPhase\` 字段。
- [ ] 阶段 5：存档迁移与回归验证。

已完成的准备工作：`rating-and-records-redesign.md` 阶段 C 的 `wonWorldCup` 乘子已按"赛事未完成则不生效"实现（`ballon-dor.ts` 读 `worldCup.completed`），且 `season-end.ts` 调用处显式传 `null` 而非 `world.worldCup`——后者此刻仍是上一届赛事。本方案阶段 3 完成后，只需把该实参改为当季赛事即可激活乘子，无需改动 `ballon-dor.ts`。

## 1. 问题确认

### 1.1 现状时序

\`season-end.ts:1367\`：

```ts
if (seasonState.isWorldCupYear) {
  return initializeWorldCup(updatedWorld);   // 结算全部跑完之后
}
```

\`appendWorldCupWindows\` 把 7 个窗口追加到日历末尾：

```text
W0–W45   联赛 30 轮 + 联赛杯 + 超级杯 + 洲际杯
W46      升降级附加赛
W47      赛季结算        ← 金球奖、退役、转会窗、身价重估、教练下课全部完成
W48–W50  环球冠军杯小组赛 R1–R3
W51–W54  R16 / QF / SF / 决赛
```

窗口 description 自认“赛季后”：

```ts
description: `第${seasonNumber}赛季后 环球冠军杯小组赛第${i + 1}轮 (8组×4队)`
```

### 1.2 四个具体后果

| 后果 | 证据位置 | 说明 |
| --- | --- | --- |
| 世界杯冠军拿不到当季金球奖 | \`season-end.ts:395\` 早于 \`initializeWorldCup\` | \`computeSeasonAwards\` 运行时 \`world.worldCup\` 为 null |
| 冠军奖金曾经发不出去 | \`finalize-world-cup.test.ts\` 注释 | 结算时 \`winnerId\` 未产生，\`applyIncome\` 静默支付 €0 |
| 球队档案写入僵尸状态 | \`season-end.ts:898-904\` | \`worldCupResult = '参赛中'\` 永不更新 |
| 世界杯期间阵容已变 | 结算含退役与转会窗 | 球员可能已转会、退役或换帅 |

### 1.3 历史修复痕迹

\`finalize-world-cup.test.ts\` 的文件头注释记录了一次同源 bug：

```text
Bug: At the season_end window in WC years, world.worldCup.winnerId is
still unset (the WC tail hasn't played yet) — applyIncome silently
paid €0 to nobody. Then initializeNewSeason nulled worldCup, so the
winner was never paid.

Fix: finalizeWorldCup (which runs after the WC final, before
initializeNewSeason) pays cash directly + patches the just-archived
FinanceSeasonRecord so the breakdown shows the prize.
```

\`finalizeWorldCup\` 是打在时序错位上的补丁，不是设计。\`season-end.ts:1522\` 的 \`updated[updated.length - 1] = { ...lastRec, worldCupResult: wcResult }\` 是对已归档财务记录的**回补**——这类“先归档再修改”的模式是时序错位的直接产物，改造后应整体删除。

### 1.4 与洲际杯的不一致

洲际杯已经是赛季内赛事（\`addContinentalCupWindow\` 插在联赛窗口之间，\`continentalCupConfig.firstSeason = 5, interval = 6\`）。世界杯是唯一被放在赛季之后的赛事。**改造的目标是与洲际杯对齐时序语义，而不是引入新概念。**

## 2. 现状基线

### 2.1 相关字段与函数

| 位置 | 内容 |
| --- | --- |
| \`types/season.ts:20-21\` | \`isWorldCupYear: boolean\`；\`worldCupPhase: boolean; // true when in world cup phase after season\` |
| \`season-manager.ts:739\` | \`isWorldCupYear = seasonNumber % BALANCE.WORLD_CUP_INTERVAL === 0\` |
| \`season-manager.ts:1104,1266,1275\` | 三处依赖 \`worldCupPhase\`，其中 1275 触发 \`finalizeWorldCup\` |
| \`season-end.ts:1377\` | \`initializeWorldCup(world)\` |
| \`season-end.ts\` 末尾 | \`finalizeWorldCup(world)\` |
| \`calendar-builder.ts\` | \`appendWorldCupWindows(calendar, seasonNumber, groupRoundFixtures)\` |
| \`window-handlers.ts:637-640\` | \`case 'world_cup_group'\` / \`case 'world_cup'\` |

### 2.2 赛事结构（不变）

\`config/competitions.ts\`：

```ts
worldCupConfig = {
  name: '环球冠军杯',
  interval: 4,           // S4, S8, S12...
  participantCount: 32,  // 全部球队
  groupCount: 8,
  teamsPerGroup: 4,
  groupRounds: 3,        // 中立场单循环
  advancePerGroup: 2,    // 每组前 2 进 R16
}
```

窗口总数 7（3 小组赛 + R16 + QF + SF + 决赛）。

### 2.3 关键事实：世界杯计入球员统计

\`window-handlers.ts:637-640\`：

```ts
case 'world_cup_group':
case 'world_cup':
```

与其他赛事类型共用同一分支，**世界杯的进球、助攻、出场全部计入 \`playerStats\`**。

**设计结论**：金球奖无法拆分“世界杯个人数据”，因为它已混入赛季统计。因此 \`wonWorldCup\` 必须按**球队是否夺冠**判断，而非个人赛事数据。这条路径可行，且更贴近现实（金球奖看球队荣誉）。

### 2.4 参赛队与东道主

\`selectWorldCupParticipants\` 实际返回全部 32 队，仅按 \`teamOveralls\` 排序用于分档：

```ts
export function selectWorldCupParticipants(allTeamIds, teamOveralls): string[] {
  // All 32 teams participate
  return [...allTeamIds].sort((a, b) => (teamOveralls[b] ?? 0) - (teamOveralls[a] ?? 0));
}
```

东道主由 \`ensureWorldCupEdition\` → \`selectWorldCupHost\` 选出：洲际轮换（承办次数最少的大洲优先）+ 排除上届大洲 + 排除近三届东道主 + 不看能力/声望/级别。

**当前问题**：东道主在赛季结算后才公布，\`announcedSeasonNumber = seasonNumber\`，玩家整季无感知。

## 3. 目标时序

```text
W0–W45   联赛 30 轮 + 联赛杯 + 超级杯 + 洲际杯
W46      升降级附加赛
W47–W49  环球冠军杯小组赛 R1–R3        ← 移入
W50–W53  R16 / QF / SF / 决赛           ← 移入
W54      赛季结算                       ← 世界杯冠军已产生
```

窗口总数不变（56），但全部属于同一赛季。

## 4. 阶段 1：日历插入

### 4.1 抽出共用构造

现有 \`appendWorldCupWindows\` 同时承担“构造窗口”和“追加到末尾”两件事。拆开：

```ts
function buildWorldCupWindows(
  seasonNumber: number,
  groupRoundFixtures: CupFixture[][],
  startId: number,
): CalendarWindow[] {
  const windows: CalendarWindow[] = [];
  let windowId = startId;

  for (let i = 0; i < groupRoundFixtures.length; i++) {
    windows.push({
      id: windowId++,
      type: 'world_cup_group',
      label: `环球冠军杯 小组赛R${i + 1}`,
      description: `第${seasonNumber}赛季 环球冠军杯小组赛第${i + 1}轮 (8组×4队)`,  // 去掉“后”
      fixtures: cupFixturesToMatchFixtures(groupRoundFixtures[i], 'world_cup_group', '环球冠军杯'),
      completed: false,
      results: [],
    });
  }

  for (const round of ['16强', 'QF', 'SF', '决赛']) {
    windows.push({
      id: windowId++,
      type: 'world_cup',
      label: `环球冠军杯 ${round}`,
      description: `第${seasonNumber}赛季 环球冠军杯${round}`,
      fixtures: [],
      completed: false,
      results: [],
    });
  }

  return windows;
}
```

### 4.2 新增插入函数

```ts
export function insertWorldCupWindows(
  calendar: CalendarWindow[],
  seasonNumber: number,
  groupRoundFixtures: CupFixture[][],
): CalendarWindow[] {
  const seasonEndIdx = calendar.findIndex(w => w.type === 'season_end');
  // 找不到 season_end 时退回追加行为，避免静默丢窗口
  if (seasonEndIdx === -1) {
    return appendWorldCupWindows(calendar, seasonNumber, groupRoundFixtures);
  }

  const wcWindows = buildWorldCupWindows(seasonNumber, groupRoundFixtures, seasonEndIdx);
  const merged = [
    ...calendar.slice(0, seasonEndIdx),
    ...wcWindows,
    ...calendar.slice(seasonEndIdx),
  ];
  // 窗口 id 必须连续且与数组下标一致
  return merged.map((w, i) => ({ ...w, id: i }));
}
```

### 4.3 保留 append 还是删除

建议**保留 \`appendWorldCupWindows\` 并标注为存档迁移专用**。现存存档中存在 \`worldCupPhase: true\` 且世界杯窗口已在日历末尾的中间态，迁移逻辑需要识别并重排它们（见阶段 5）。删除该函数会让迁移代码无处安放。

### 4.4 验收

- [ ] 世界杯年日历长度为 56，世界杯窗口位于 \`relegation_playoff\` 与 \`season_end\` 之间。
- [ ] 所有窗口 \`id\` 与数组下标一致，无重复、无跳号。
- [ ] 非世界杯年日历长度与结构完全不变。
- [ ] description 不再包含“赛季后”。

## 5. 阶段 2：初始化时机前移

### 5.1 当前流程

```text
handleSeasonEnd
  ├─ 荣誉 / 奖杯 / 评奖 / 退役 / 转会窗 / 身价 / 教练
  └─ if (isWorldCupYear) return initializeWorldCup(world)
        ├─ selectWorldCupParticipants
        ├─ ensureWorldCupEdition        ← 东道主此时才公布
        ├─ initWorldCup
        └─ appendWorldCupWindows
```

### 5.2 目标流程

世界杯的**参赛队、分组、东道主**应在赛季开始时确定（日历构建期），赛程窗口在同一份日历里生成；结算在世界杯决赛之后统一进行。

```text
initializeNewSeason (世界杯年)
  ├─ ensureWorldCupEdition          ← 东道主在赛季开始公布
  ├─ initWorldCup                   ← 分组与分档
  └─ buildSeasonCalendar + insertWorldCupWindows

赛季推进 W0–W53
  └─ 世界杯窗口走 window-handlers 既有分支

handleSeasonEnd (W54)
  ├─ 世界杯冠军已产生，全部结算正确
  └─ 不再需要 initializeWorldCup / finalizeWorldCup
```

### 5.3 东道主公布时机

\`ensureWorldCupEdition\` 的 \`announcedSeasonNumber = seasonNumber\` 语义保持不变，但调用点前移后，玩家从赛季第一轮就能看到东道主身份。

\`selectWorldCupHost\` 依赖 \`editions\` 历史与 \`teamBases.region\`，两者在赛季开始时均已就绪，**无需修改选择逻辑**。

抽签新闻（当前在 \`initializeWorldCup\` 末尾生成）应移到赛季开始的新闻批次中，\`windowIndex\` 相应改为 0 或首个世界杯窗口的 id。

### 5.4 分档数据来源

\`initWorldCup\` 的分档依赖 \`teamOveralls\`（\`world.teamBases[id].overall\`）。赛季开始时该值与赛季结束时可能因 \`applyAnnualRevaluation\`、\`god-hand\` 或教练效果而不同。

**需决策**：分档用赛季开始的 overall（本方案默认），还是上赛季结算后的 overall。

建议用**赛季开始值**：与“东道主在赛季开始公布”一致，且避免世界杯分档反过来受当季表现影响（那会造成“表现越好分档越难”的反直觉结果）。

### 5.5 验收

- [ ] 世界杯年赛季开始即存在 \`world.worldCup\` 与 \`worldCupEditions\` 条目。
- [ ] 东道主在赛季第一轮新闻中公布。
- [ ] 分档使用赛季开始的 \`teamOveralls\`，与旧实现（结算后）差异已量化。
- [ ] \`rngState\` 消耗顺序变化已记录，长跑对照可解释。

## 6. 阶段 3：结算纳入世界杯

### 6.1 评奖

\`season-end.ts:395\` 的 \`computeSeasonAwards\` 调用增加世界杯上下文：

```ts
const seasonAwards = computeSeasonAwards(
  seasonNumber, playerStats, squads, world.teamBases,
  world.league1Standings, world.playerStatSegments ?? {}, world.seasonStartLevels ?? {},
  world.worldCup,          // 新增
);
```

按 2.3 的结论，**乘子按球队是否夺冠计算**，不拆分个人赛事数据：

```ts
// rating-and-records-redesign.md 阶段 C 的 ballonDorScore 中
if (context.wonWorldCup) multiplier *= 1.15;
```

### 6.2 球队档案

\`season-end.ts:886-904\` 的 \`worldCupResult\` 判定在新时序下所有分支都有确定值：

```ts
if (teamId === worldCupWinner) worldCupResult = '冠军';
else if (world.worldCup.participantIds.includes(teamId)) {
  const wcFinal = world.worldCup.knockoutRounds.at(-1);
  // ... 亚军 / cnRoundLabel(elimRound) / 小组赛淘汰
}
```

**\`'参赛中'\` 两个分支应当删除**（见阶段 4）。

### 6.3 奖金

\`finalizeWorldCup\` 的直接现金支付 + \`FinanceSeasonRecord\` 回补逻辑，在新时序下**由常规 \`applyIncome\` 路径取代**：

- 世界杯奖金成为当季收入的一部分，在 \`archiveSeasonFinance\` 之前计入。
- \`season-end.ts:1522\` 的 \`updated[updated.length - 1] = { ...lastRec, worldCupResult }\` 回补删除。
- \`season-end.ts:1556\` 的 \`attributeCupPrizes(knockoutRounds, WORLD_CUP_TIERS)\` 保留，但调用点移入正常财务流程。

### 6.4 验收

- [ ] 世界杯冠军可获得当季金球奖乘子。
- [ ] \`SeasonRecord.worldCupResult\` 在世界杯年对全部 32 队均有确定值，无 \`'参赛中'\`。
- [ ] 世界杯奖金出现在当季 \`FinanceSeasonRecord\` 的正常字段中，无需回补。
- [ ] \`finalize-world-cup.test.ts\` 按新契约重写或标记废弃。

## 7. 阶段 4：清理时序错位产物

### 7.1 \`worldCupPhase\` 字段

\`types/season.ts:21\` 的注释自认 \`// true when in world cup phase after season\`。新时序下不存在“赛季已结算但日历未走完”的状态。

处理方式：

- 从 \`SeasonState\` 移除该字段。
- \`season-manager.ts:1104,1266,1275\` 三处条件改为等价语义（通常是“赛季已完成且世界杯未完成”→ 直接删除该分支）。
- \`save-schema.ts:893\` 的 \`requireBoolean(seasonState, 'worldCupPhase', ...)\` 改为可选或移除。
- 约 15 个测试文件中的 \`worldCupPhase: false\` 字面量需清理。

**注意**：这是本方案中波及面最广的单项改动，但每处都是删除而非重写。

### 7.2 \`finalizeWorldCup\`

整个函数删除，其职责被常规结算路径吸收。对应测试 \`finalize-world-cup.test.ts\` 按新契约重写，或在阶段 3 验证通过后删除。

### 7.3 \`initializeWorldCup\`

不再作为 \`handleSeasonEnd\` 的返回分支。其逻辑拆分：

- 参赛队选择、分组、东道主确定 → 移入 \`initializeNewSeason\` 的世界杯年分支。
- 日历窗口插入 → 调用 \`insertWorldCupWindows\`。
- 抽签新闻 → 移入赛季开始新闻批次。

### 7.4 验收

- [ ] \`SeasonState\` 不再包含 \`worldCupPhase\`。
- [ ] \`finalizeWorldCup\` 与 \`initializeWorldCup\` 已删除或明确标注废弃。
- [ ] 全仓库无 \`worldCupPhase\` 引用。
- [ ] \`pnpm typecheck\` 通过，无残留可选字段告警。

## 8. 阶段 5：存档迁移

### 8.1 需要处理的中间态

现存存档可能处于以下状态：

| 状态 | 特征 | 处理 |
| --- | --- | --- |
| A | 世界杯年结算已完成，\`worldCupPhase: true\`，世界杯未打完 | 最复杂：需把世界杯窗口重排进刚结算完的赛季，或整体回退 |
| B | 世界杯年结算已完成，世界杯已打完，尚未进新赛季 | 需把已产生的世界杯结果归入正确赛季的档案 |
| C | 世界杯年赛季进行中，尚未结算 | 直接按新逻辑继续，无需迁移 |
| D | 非世界杯年 | 无影响 |

### 8.2 建议策略

**状态 C/D 直接兼容，状态 A/B 走一次性迁移。**

对状态 A/B，\`save-schema.ts\` 的版本迁移中：

1. 检测 \`worldCupPhase === true\`。
2. 若 \`world.worldCup?.completed === true\`：把该世界杯结果写入其 \`seasonNumber\` 对应的 \`honorHistory\` 与 \`teamSeasonRecords\`，清空 \`worldCup\`，重置 \`worldCupPhase\`。
3. 若未完成：将当前日历中的世界杯窗口移除，\`worldCup\` 清空，\`worldCupPhase\` 置回，赛季回到 \`season_end\` 窗口之前重新结算（**或**允许该存档在旧时序下打完，迁移仅在新赛季开始时生效）。
4. 迁移后 \`SAVE_SCHEMA_VERSION\` 递增。

**方案选择需作者决策**：状态 A 的两种处理（回退重结算 vs 允许打完）各有代价。回退更干净但会让玩家重看一次结算；允许打完更平滑但保留了旧时序的档案错误。

### 8.3 验收

- [ ] 四种状态的存档均能加载且不崩溃。
- [ ] 状态 A/B 迁移后，世界杯成绩归属赛季正确。
- [ ] \`save-schema.test.ts\` 覆盖四种状态。
- [ ] 真实旧档（若有）迁移前后手动比对，无数据丢失。

## 9. 风险清单

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| \`season-end.ts\` 1613 行巨型函数，多链路耦合 | 高 | 阶段化提交，每阶段独立验证 |
| 存档中间态迁移 | 高 | 四状态分类处理，作者决策回退策略 |
| \`rngState\` 消耗顺序变化导致长跑结果不同 | 中 | 记录变化并解释，不追求与旧实现逐季一致 |
| \`worldCupPhase\` 波及 15+ 测试文件 | 中 | 纯删除操作，逐文件清理 |
| 与评分方案阶段 C 的依赖 | 中 | **本方案先于评分方案执行** |
| 世界杯奖金路径改变影响财务平衡 | 低 | 长跑对照验证 |

## 10. 执行顺序建议

本方案应**先于** \`rating-and-records-redesign.md\` 执行，理由：

1. 阶段 C 的 \`wonWorldCup\` 乘子在时序修好前拿不到数据。
2. 本方案改时序，评分方案改参数；同时进行将无法定位问题来源。
3. 本方案完成后，评分方案的验证基线才稳定。

建议顺序：

```text
本方案阶段 1–5  →  验证通过  →  rating-and-records-redesign.md 阶段 A/B/C/D
```

## 11. 本方案不做的事

- 不改变世界杯规模（32 队）、赛制（8 组 × 4 队）、晋级规则（每组前 2）。
- 不改变分档方式（4 档 × 8 队）。
- 不改变东道主选择逻辑（洲际轮换 + 近三届排除 + 不看能力）。
- 不改变中立场规则与东道主 4% 氛围加成。
- 不改变世界杯计入球员统计的现状。
- 不追溯修正已归档赛季的世界杯成绩（仅新赛季生效）。
