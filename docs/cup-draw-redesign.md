# 杯赛抽签制度重构方案

创建日期：2026-11-11

> 状态：纯方案，未开始实施。诊断基于分支 `fix/records-ties-and-bugs`（基于 `origin/main` @ `09a5984`）的代码通读。方向已由作者确认，见第 3 节。

处理杯赛抽签的制度不自洽与仪式缺失。**不改变赛制本身**——参赛规模、轮次、晋级规则、中立场规则全部保持，只动抽签的分档逻辑与结果呈现。

## 0. 结论摘要

四个赛事里**只有超级杯的分组是纯随机的，而它偏偏是唯一按联赛级别分配参赛资格的赛事**。洲际杯按俱乐部系数分四档、世界杯按 `overall` 分四档，超级杯的 `drawGroups` 调用漏传了 `pots` 参数。结果是 16 队里 10 支顶级联赛球队被随机洗进 4 个组，会出现"四强同组"与"一强三弱"并存——资格精心按级别分完，分组把它扔了。

抽签的"仪式"目前只有四条新闻，其中两条没有实质内容：联赛杯的抽签新闻只有一句标题、没有任何对阵；洲际杯的抽签新闻只列系数排名、不列分组结果（分组数据在 `cup.groups` 里已经算好了）。

方向已定：**只补超级杯分档，仪式走新闻增强**。不做独立抽签页、不做赛季抽签窗口、不动联赛杯的纯随机。

## 1. 现状：四个赛事的抽签实现

| 赛事 | 参赛 | 分组分档 | 分档依据 | 淘汰赛对阵 |
| --- | --- | --- | --- | --- |
| 联赛杯 | 32 队全部 | 无 | — | R32 纯随机；之后胜者顺序配对 |
| 超级杯 | 16 队（10 顶 4 甲 2 乙） | **无** | — | 1A-2B / 1B-2A / 1C-2D / 1D-2C 固定 |
| 洲际杯 | 区域内全部 | 4 档 | 俱乐部系数 | 贪心避同组，确定性 |
| 世界杯 | 32 队全部 | 4 档 | `teamBases.overall` | 组交叉固定（A-B / C-D / E-F / G-H） |

关键位置：

- `src/engine/cups/draw.ts:13` `drawGroups`、`:51` `drawKnockoutBracket`、`:87` `drawSimpleKnockout`
- `src/engine/cups/super-cup.ts:247` `drawGroups(qualifiedTeamIds, 4, rng)` ← 缺 `pots`
- `src/engine/cups/world-cup.ts:154` `drawGroups(participantIds, 8, rng, pots)` ← 有 `pots`
- `src/engine/cups/continental-cup.ts:262` `drawGroups(teamIds, groupCount, rng, pots)` ← 有 `pots`

## 2. 缺陷

### 2.1 超级杯分组未分档

`super-cup.ts:247` 调用 `drawGroups` 时只传了三个参数，第四个 `pots` 缺省。`drawGroups` 在没有 `pots` 时走"全量洗牌 + 轮转发牌"分支（`draw.ts:32-36`），完全随机。

而 `superCupConfig`（`src/config/competitions.ts`）明确写着 `league1Spots: 10, league2Spots: 4, league3Spots: 2`——参赛资格是按级别分配的。资格分层、分组不分层，是这次要修的核心矛盾。

### 2.2 联赛杯零分档

`league-cup.ts:56` 用 `drawSimpleKnockout` 把 32 队纯随机洗牌配对，顶级联赛冠亚军可能在 R32 就碰面。全部 `isNeutralVenue: true`，弱队没有主场红利。

**这是有意保留的**，见 3.2。记录在此是为了说明它不是遗漏。

### 2.3 淘汰赛对阵是固定模式，且被测试锁定

三处 `void rng`：

- `draw.ts:55` `drawKnockoutBracket`——组 i 冠军 vs 组 (N-1-i) 亚军，注释写着 *Reserved for future seeded tie-breaking*
- `super-cup.ts:370` `completeSuperCupGroupStage`——1A-2B / 1B-2A / 1C-2D / 1D-2C
- `world-cup.ts:282` `completeWorldCupGroupStage`——`crossPairs = [[0,1],[2,3],[4,5],[6,7]]`，A-B / C-D / E-F / G-H 交叉
- `world-cup.ts:331` `advanceWorldCupKnockout`——胜者按 M1-M2 / M3-M4 顺序配对

**这不是疏忽，是被测试锁定的既有设计**。`draw.test.ts:70-80` 明确断言：

```ts
expect(pairs).toEqual([
  ['1A', '2D'], ['1B', '2C'], ['1C', '2B'], ['1D', '2A'],
]);
```

本方案**不改**这些配对。但要记录一个后果：玩家看两届就能摸清套路，第二届起淘汰赛对阵没有任何悬念。若将来要改成"受约束随机"（保留避同组 + 引入种子随机），这个测试必须一起改，而它目前是唯一保护对阵正确性的护栏——改的时候要把新规则同样锁进测试。

### 2.4 抽签新闻内容缺失

赛季构建时同步算完，四条新闻全部挂在 `windowIndex: 0`（`src/engine/season/season-manager.ts`）：

| 新闻 id | 标题 | 内容 |
| --- | --- | --- |
| `draw-sc-S{N}` | 超级杯分组抽签揭晓 — X顶Y甲Z乙 | 有分组名单，纯文本 |
| `draw-wc-S{N}` | 环球冠军杯分组抽签揭晓 | 有分组名单，纯文本 |
| `draw-lc-S{N}` | 联赛杯抽签完成 — 32队单场淘汰 | **只有标题，没有任何对阵** |
| `draw-cc-{type}-S{N}` | {杯名}全员分组揭晓 · 六年一届 | **只列系数排名，不列分组结果** |

洲际杯那条尤其浪费：`cup.groups` 已经算好分组，但新闻只输出了 `participantIds` 按系数排序后的名单。

### 2.5 `drawGroups` 的 pots 分支会静默丢队

`draw.ts:26`：

```ts
for (let i = 0; i < shuffled.length && i < groupCount; i++) {
  groups[i].push(shuffled[i]);
}
```

当某个 pot 的球队数 > `groupCount` 时，多出来的队被**静默丢弃**；pot 数量 < `groupCount` 时部分组会缺队。两种情况都没有校验。

洲际杯（`teamIds.length % 4 === 0`，严格 4 队一组）和世界杯（8 组 × 8 队 pot）恰好安全，但这是运气不是设计。

更值得注意的是 `draw.test.ts:36-56` 的 pots 用例用的是 4 pot × 4 队 / 4 组——**恰好相等的唯一安全情况**。测试给了虚假的安全感。

### 2.6 `drawSimpleKnockout` 奇数队产生 `undefined` 对手

`draw.ts:94` `pairs.push([shuffled[i], shuffled[i + 1]])`，队数为奇数时最后一项越界。`league-cup.ts` 有 32 队校验所以安全，但函数本身没有。

### 2.7 UI 文案与实现不符

`src/pages/Cup.tsx:209` 的规则卡写着：

> 抽签: 4档分组 (按实力排位)，每组2顶+1甲+1乙

前半句对（4 档按 overall），后半句错。实际实现是每组从 4 个档各取 1 队。"2顶+1甲+1乙"是 `worldCupConfig` 注释里的旧说法（`teamsPerGroup: 4, // 2顶+1甲+1乙`），与实现对不上。

## 3. 已定方向

### 3.1 仪式形态：新闻增强

作者已确认走新闻增强，不做独立抽签页、不做赛季抽签窗口。

理由是投入产出：四条抽签新闻已经在赛季构建时生成，缺的只是内容。把分组结果、逐档归属、死亡之组与强弱对话写进正文，改动集中在 `season-manager.ts` 的新闻生成段，不动存档结构、不动 calendar、不新增路由。

### 3.2 分档范围：只补超级杯

作者已确认只补超级杯 `pots`，联赛杯保持纯随机。

联赛杯的定位是"32 队单场淘汰、全中立场、纯随机"——保留弱队也能碰弱队、顶级队也会早期翻车的空间，这符合杯赛调性，也符合 `isNeutralVenue: true` 已经放弃主场优势的设计。

### 3.3 明确不做的事

- 不做独立抽签回放页
- 不把抽签变成 calendar window（不改存档 schema）
- 不给联赛杯引入种子队保护
- 不改淘汰赛对阵模式（见 2.3）
- 不改超级杯的客场进球规则（`awayGoalRule: true`）。**另案记录**：客场进球规则 2021 年已被欧足联废除，是否跟进属于赛制调整，不在抽签范围内

## 4. 阶段划分

### 阶段 1：超级杯补 pots

改 `super-cup.ts:247`，按 `leagueLevel` 把 16 队切成 4 档，每档 4 队，传给 `drawGroups`。

10 顶 / 4 甲 / 2 乙无法均分成 4 档，需要定切法。建议按级别优先、档内按 `overall` 排序：档 1 = 顶级前 4，档 2 = 顶级 5-8，档 3 = 顶级 9-10 + 甲级前 2，档 4 = 甲级后 2 + 乙级 2。这样每组 1 档 1 队，结构上保证每组至少 2 支顶级队。

**这一步会改变历史赛季的超级杯分组结果**，属于种子变更的正常后果，不需要存档迁移。

测试：新增超级杯分组的档位均衡断言（每组恰好 1 队/档）。

### 阶段 2：抽签看点判定（纯函数 + 测试）

新建 `src/engine/cups/draw-highlights.ts`，输入分组结果与球队元数据，输出看点标签数组。纯函数、无副作用、可单测。

看点类型与判定规则见第 5 节。

### 阶段 3：新闻补全

改 `season-manager.ts` 的四条抽签新闻：

- `draw-lc`：补 R32 的 16 组对阵（当前完全缺失），标注级别差最大的几组
- `draw-cc`：补分组结果（`cup.groups` 已有数据），当前只输出系数排名
- `draw-sc` / `draw-wc`：在现有分组名单基础上追加阶段 2 的看点标签

### 阶段 4：`draw.ts` 边界加固

- `drawGroups` 的 pots 分支加校验：pot 数必须等于 `groupCount`、每个 pot 的队数必须等于 `groupCount`，不满足直接抛错
- `drawSimpleKnockout` 加奇数队校验
- 补测试：pot 队数 ≠ 组数必须抛错（当前完全未测）

### 阶段 5：UI 文案修正

`src/pages/Cup.tsx:209` 的"每组2顶+1甲+1乙"改为与实现一致的描述，并同步 `worldCupConfig` 的注释。

## 5. 看点判定的具体规则

### 5.1 数据可用性

| 需要的信息 | 来源 | 可用性 |
| --- | --- | --- |
| 球队实力 | `world.teamBases[id].overall` | ✓ |
| 联赛级别 | `world.teamStates[id].leagueLevel` | ✓ |
| 俱乐部系数排名 | `rankClubCoefficients(...)` | ✓ 仅洲际杯赛季 |
| 分组结果 | `cup.groups` / `cup.rounds` | ✓ |
| 历史交手 | `matchHistory` | ⚠ 只保留 3 季（`MATCH_HISTORY_SEASONS = 3`） |
| 球队地区 | — | ✗ 没有这个字段，"德比"无法按地理判定 |

### 5.2 超级杯（补 pots 后）

结构上每组 1 档 1 队，看点在于**档内错位**：

- **死亡之组**：组内 4 队的 `overall` 极差 < 6（实力接近且都不弱）
- **弱组**：组内最高 `overall` < 该档中位数 - 5
- **档位倒挂**：档 4 球队的 `overall` 高于档 2 球队（说明分档依据与实际实力脱节）

### 5.3 世界杯 / 洲际杯

同样是 4 档结构，每组各档 1 队，实力差是结构性的，所以看点是**组内最强两队的接近程度**：

- **死亡之组**：组内 overall 排序后第 1 与第 2 的差 < 3
- **一枝独秀**：第 1 与第 2 的差 > 12
- 按"死亡程度"排序取前 2 组标注，避免 8 组全标

### 5.4 联赛杯（纯随机）

没有分档，看点全在**级别差与重复对阵**：

- **级别悬殊**：R32 中出现「顶级 vs 乙级」
- **同级别强强**：两支 `overall` 排名联赛前 4 的球队在 R32 相遇
- **重赛**：两队在本赛季联赛或最近 3 季 `matchHistory` 里交手过（受保留期限制，只查得到 3 季内）

### 5.5 输出形态

```ts
interface DrawHighlight {
  kind: 'group_of_death' | 'weak_group' | 'level_gap' | 'heavyweight_clash' | 'rematch' | 'upset_watch';
  teamIds: string[];
  groupName?: string;
  label: string;      // 短标签，进新闻标题
  detail: string;     // 一句话，进新闻正文
}
```

每个赛事最多输出 3 条看点，按"值得说"的程度排序，避免新闻变成清单。

## 6. 验收

- [ ] 超级杯分组每组恰好 1 队/档，有测试断言
- [ ] `drawGroups` 在 pot 队数 ≠ 组数时抛错，有测试覆盖（当前完全未测）
- [ ] `drawSimpleKnockout` 在奇数队时抛错
- [ ] 四条抽签新闻都包含对阵或分组结果，`draw-lc` 不再只有标题
- [ ] 看点判定是纯函数，单测覆盖每种 `kind` 的触发与不触发
- [ ] `pages/Cup.tsx` 文案与实现一致
- [ ] 全量测试通过，未调整超时或产品断言

## 7. 风险与未决

- **阶段 1 会改变历史超级杯分组**。种子变了，同一种子的历史赛季结果会不同。这是分档修正的必然代价，不需要迁移，但要知道重放旧种子不会得到旧结果。
- **"德比"无法实现**。数据里没有球队地区字段，只能用"同联赛"近似，或者不做。
- **"重赛"只能查 3 季**。`MATCH_HISTORY_SEASONS = 3`，更早的交手记录已被清理。
- **看点阈值是拍的**。5.2 / 5.3 里的 6、3、12 这些数字没有数据支撑，需要跑几个赛季看命中频率再调。建议先按现值实现，附一个统计脚本统计各 `kind` 的触发率。

## 8. 相关文件

- `src/engine/cups/draw.ts` / `draw.test.ts`
- `src/engine/cups/super-cup.ts` / `world-cup.ts` / `continental-cup.ts` / `league-cup.ts`
- `src/engine/season/season-manager.ts`（抽签新闻生成段）
- `src/config/competitions.ts`
- `src/pages/Cup.tsx`
- `src/engine/history/storage-limits.ts`（`MATCH_HISTORY_SEASONS`）
