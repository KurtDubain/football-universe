# 比赛直播动画优化方案

创建日期：2026-11-11

> 状态：纯方案，未开始实施。诊断 = 代码通读（分支 `fix/records-ties-and-bugs`）+ 线上实测（`football.dyp02.vip` v4.61.11，常山龙 1-5 山东泰山，顶级联赛 R20）。

处理直播动画的**流畅度缺陷**与**观感承载力**。不改比赛模拟、不改播放模式数量、不加慢动作回放。

## 0. 结论摘要

这套动画的底层能力**远超它呈现出来的样子**。`physics.ts`（35KB）有盯人目标选择、防守角色分配、进攻跑位目标、球员分离、防守反应延迟；`sequence.ts`（24KB）有 6 种进攻模式的跑位路线；`renderer.ts`（25KB）有庆祝动画、镜头震动、白闪。这些都在跑。

问题分两类，**顺序不能反**：

**A 类是实现缺陷，必须先修。** 画质降级不可逆且会在动画中途改球员尺寸；射门触球瞬间的判定在两个播放模式下 100% 失效；所有 constrained 档设备从一开始就没有进球震动。在这三条修掉之前，任何镜头设计都会被 30fps 和尺寸突变毁掉。

**B 类是承载力问题。** 作者反馈的"卡卡的、很奇怪"属于 A 类；而"不够像直播"的根因是**俯视全局视角承载不了已有的数据**——`chanceStyle` 已经把传中球的弧线算到 26-33 帧的高度，但俯视图没有高度维度，那个弧线根本不可见。

## 1. 现状：这套动画已经有什么

### 1.1 分层

```
MatchResult.events
  → use-match-playback-controller.ts   事件时间轴、tick 节奏、presentation cue 提交
  → event-scene.ts                     事件 → 场景（谁进攻、结果类型、球的目标点）
  → sequence.ts                        场景 → 传球序列（模式、路线、chanceStyle、时长、弧线）
  → physics.ts                         序列 → 球员位置与球位置（跑位、盯人、分离、反应延迟）
  → renderer.ts                        位置 → 画面（球场、球员、球、庆祝、震动、白闪）
  → runtime.ts                         固定步长帧循环 + 可见性暂停
  → render-budget.ts                   画质档位与自动降级
```

### 1.2 已有能力清单

| 能力 | 位置 |
| --- | --- |
| 盯人目标选择 | `physics.ts:179` `selectMarkingTarget` |
| 防守角色分配 | `physics.ts:218` `selectDefensiveRoles`、`:244` `buildTacticalAssignments` |
| 进攻跑位目标 | `physics.ts:371` `computeAttackingShapeTarget` |
| 球员分离防重叠 | `physics.ts:138` `separateActivePlayers` |
| 防守反应延迟 | `physics.ts:88` `computeDefensiveReactionProgress`、`:102` `defensiveReactionDelay` |
| 6 种进攻模式路线 | `sequence.ts:145` `routeForPattern`（build_up / wing_overload / central_combination / switch_play / counter / recycle） |
| 4 套阵型 + 战术微调 | `types.ts` `FORMATION_LAYOUTS`、`getTacticalFormationSlots` |
| 进球庆祝 | `renderer.ts:492` `drawGoalCelebration`（110 帧） |
| 镜头震动 / 白闪 | `renderer.ts:663` `applyCameraShake`（18 帧）、`:708` `applyWhiteFlash`（8 帧） |
| 画质自适应 | `render-budget.ts` 4 档 + `runtime.ts` 可见性暂停 |

### 1.3 实测观察（常山龙 1-5 山东泰山）

**超出预期的部分**（读代码时低估了）：

- 球员是带号码的圆形标记，有队服配色区分，不是光点
- 焦点球员有黄色高亮弧线
- 进球时有事件浮层（如「反超 程皓宇 · FW 1-2」）
- 持球球员脚下有传球路线虚线
- 战术以文字呈现（`4-4-2 低位防守` vs `4-3-3 均衡应对`）
- 播报文案质量高：「二过一配合后轻松推射」「长途奔袭后怒射入网」「角球开向前点，甩头攻门偏出」

**问题**：

- **进球时刻画面没有任何变化。** 截到的 47' 程皓宇进球帧，「反超」浮层还挂着，画面是完整全场俯视，球员标记大小与平时完全一致。这是 `camera.ts` 缩放上限 1.115 的直接后果，不是推断。
- **播报密度极低。** 上半场 45 分钟「本场完整播报」只有 7-8 条，其中 3 条是占位符（「比赛开球，双方开始试探」「双方正在争夺中场控制」「比赛节奏逐渐稳定」）。45 分钟里真正有内容的只有 5 条。
- **事件有聚集倾向。** 40' 与 41' 是同一球员郑海涛的连续两次机会，中间大段空白靠占位符填。

## 2. A 类：必须先修的实现缺陷

### A1 画质降级不可逆，且会在动画中途改画面尺寸

这是作者反馈的"卡卡的"与"很奇怪"的**同一个根因**。

`PitchCanvas.tsx:494-507`：

```ts
function recordFrameInterval(interval: number): void {
  renderMetrics.recordFrameInterval(interval);
  if (renderBudget.quality === 'reduced' || renderBudget.quality === 'degraded') return;
  const metrics = renderMetrics.snapshot();
  if (!shouldDegradeRenderBudget({ ... })) return;
  renderBudget = degradeRenderBudget(renderBudget);
  particlesRef.current = particlesRef.current.slice(-renderBudget.particleCap);
  resizeCanvas();
}
```

**没有任何恢复路径**。`render-budget.ts:55` 里 `degradeRenderBudget` 对已经是 `reduced` / `degraded` 的档位直接返回原值——只降不升。

触发条件（`render-budget.ts:49-51`）也偏敏感：

```ts
return pressure.consecutiveSlowFrames >= 4
  || pressure.averageFrameIntervalMs > 30
  || pressure.averageRenderMs > 20;
```

`recordFrameInterval` 记录的是**帧间隔**，滑动窗口只有 60 帧（`render-metrics.ts:1` `DEFAULT_SAMPLE_LIMIT`）。页面初始化或一次 GC 的抖动就能把平均值拉过 30ms 线。而 `shouldDegradeRenderBudget` 要求 `renderedFrames >= 20` 才生效，前 20 帧恰好包含初始化开销。

触发之后发生四件事：

1. `frameStepMs` 从 16.67 变 33.33（`render-budget.ts:60`）——**60fps 掉到 30fps**，这是"卡卡的"
2. `resizeCanvas()` 把 dpr 从最高 2.5 砍到 1.5，canvas 重建——画面变糊
3. **球员和球突然放大**（`PitchCanvas.tsx:1245-1248`）：

   ```ts
   const playerVisualScale = quality === 'full' ? 1.04
     : quality === 'reduced' ? 1.08 : 1.16;
   const ballVisualScale = quality === 'full' ? 1.08 : 1.24;
   ```

   full → degraded：球员 **+11.5%**、球 **+14.8%**。在比赛放到一半时发生，就是"很奇怪"

4. 进球镜头震动**永久消失**（见 A3）

放大球员的意图本身合理（dpr 降了要补偿清晰度），问题是**突变而非过渡**。

### A2 射门触球瞬间的判定在两个播放模式下永久失效

`PitchCanvas.tsx:1037-1042`：

```ts
const contactFrame = Math.max(1, releaseDelayFrames);   // 默认 8，整数
if (... && phaseFrameRef.current === contactFrame && ...) {
  emitPresentationCue(directedShotScene, ...);
}
```

而 `phaseFrameRef` 是浮点累加（`PitchCanvas.tsx:889`）：

```ts
phaseFrameRef.current += playbackMotionRate(livePlaybackMode);
```

`playbackMotionRate`（`playback-mode.ts:147-151`）：精华 `1`、完整 `0.72`、沉浸 `0.58`。

| 模式 | 步长 | phaseFrame 序列 | 能命中 8 |
| --- | --- | --- | --- |
| 精华 | +1.00 | 0, 1, 2, …, **8** | ✓ |
| 完整 | +0.72 | 0, 0.72, 1.44, …, 7.92, **8.64** | ✗ |
| 沉浸 | +0.58 | 0, 0.58, 1.16, …, 7.54, **8.12** | ✗ |

**「完整」和「沉浸」模式下射门触球的 presentation cue 100% 不触发。** 浮点数用 `===` 比较本身就是 bug 模式，这里恰好踩中。

默认模式是「精华」所以不易察觉，但只要切过另外两档，射门的关键时刻就是哑的。

同类写法还有 `PitchCanvas.tsx:1033` 的 `phaseFrameRef.current <= 1`——这一处在 0.72 / 0.58 步长下仍能命中（前两帧），但同样是脆弱写法，应一并改成带一次性标志的阈值判断。

### A3 constrained 档设备从一开始就没有进球震动

`PitchCanvas.tsx:572`：

```ts
const allowGoalImpulse = renderBudget.quality === 'full' && !reducedMotion;
cameraShakeRef.current = allowGoalImpulse ? CAMERA_SHAKE_MAX_FRAMES : 0;
```

而 `selectRenderBudget`（`render-budget.ts:33-35`）把 `constrained` 判给：

```ts
const constrained = environment.cssWidth <= 480
  || (environment.hardwareConcurrency ?? 8) <= 4
  || (environment.deviceMemory ?? 8) <= 4;
```

**所有 ≤480px 宽的设备、以及任何 4 核及以下的设备，从进游戏第一秒起就没有进球震动**，与降级无关。18 帧的震动开销极小，不该只留给 full 档。

## 3. B 类：观感承载力

### B1 镜头没有镜头语言

`camera.ts:28-35` 的缩放表：

```ts
const DESKTOP_ZOOM = {
  wide: 1.004, build: 1.018, attack: 1.048,
  set_piece: 1.078, finish: 1.105, outcome: 1.115,
};
```

`camera.ts:85` 还有硬上限 `maxZoom = compact ? 1.08 : 1.12`。

**从 wide 到 outcome 只有 11.5% 的推进**，实测确认进球帧画面与平时无差别。`FOCUS_WEIGHT` 最高 0.86 意味着焦点确实在跟着球走，但因为缩放几乎不变，观感上就是"画面轻微晃了一下"。

`CAMERA_SHAKE_MAX_FRAMES = 18`（0.3 秒）的震动在全局视图里同样无感——震动幅度是像素级的，全局视图下球员只有 30px 左右。

### B2 俯视全局视角承载不了已有的数据

**这一条修正了初诊的一个错误判断。**

初诊认为"播报里的叙事信息没有传到画面，`playOrigin` / `chanceStyle` / `setPiece.delivery` 都被丢弃"。**这是错的**，实际消费情况：

| 字段 | 消费情况 |
| --- | --- |
| `chanceStyle`（cross / cutback / through_ball / central） | **大量使用**。`sequence.ts:420-572` 有 20+ 处引用，影响 `shotProgress`、`shotY`、传球路线分支、`duration`、`arc` |
| `setPiece.delivery`（near_post / far_post）+ `setPiece.side` | **已使用**。`event-scene.ts:54-57` 用于计算球的落点 |
| `playOrigin` | **完全未使用**。只出现在 `event-scene.test.ts:34,39` 的测试数据里 |

所以真正的问题不是"数据没传下来"，而是**传下来了但看不见**：

1. `chanceStyle === 'cross'` 时 `arc` 是 `26 + r(31) * 7` 帧（`sequence.ts:572`）——**弧线高度是传中球最重要的视觉特征，而俯视图没有高度维度**。球从 A 点飞到 B 点，屏幕上看就是一条直线移动，弧线完全不可见。
2. `separateActivePlayers` 的分离、`selectMarkingTarget` 的盯人、6 种 `pattern` 的跑位路线差异，全部发生在 1.0-1.1 倍的全局视图里，球员标记只有 30px 左右，**分辨率不足以分辨**。
3. `getTacticalFormationSlots`（`types.ts`）的战术微调幅度是 depth ±0.008~0.036、widthScale 0.88~1.04。在全局俯视下 `pressing` 和 `low_block` 长得一样。

结论：**文案在讲故事，画面在摆点位，不是因为两者没连上，而是因为视角的信息带宽不够。**

### B3 只有射门类事件有场景

`event-scene.ts:42`：

```ts
if (!isShotEvent(event) && event.type !== 'corner' && event.type !== 'free_kick') return null;
```

传球、抢断、犯规、黄牌、换人都没有场景编排——而这些占了一场比赛 90% 的时间。当前这些时段画面上是"待机"状态（靠占位符播报填充）。

### B4 场景是预演而非同步

`event-scene.ts:90`：

```ts
return lead >= 0 && lead <= 5;
```

`findEventScene` 会找**未来 5 分钟内**最近的射门事件并开始演出。画面演的是还没发生的事，与时间轴当前分钟脱节。配合快节奏播放，会出现"画面在射门、时间轴还在 5 分钟前"的割裂。

## 4. C 类：待确认

### C1 球员分布偏向一侧

实测截到的那一帧里，常山龙（白）几乎全部压在左半场，山东泰山（橙）在右半场只有 6 人。

可能是 `4-4-2 低位防守`（`low_block`）的正确表现——回收本来就该在自己半场；也可能是阵型坐标或 `separateActivePlayers` 的问题。

**单帧无法判定，不下结论。** 需要连续截帧或录屏看动态。

## 5. 阶段划分

### 阶段 1：修 A1（降级机制）

- 给降级加**恢复路径**：连续 N 帧流畅后逐级回升，而不是一降到底
- `playerVisualScale` / `ballVisualScale` 改为随时间插值过渡，不在降级瞬间跳变
- 降级判定改用百分位（如 p95 帧间隔）而非平均值，避免初始化抖动误伤
- 降级时不要立刻 `resizeCanvas()`，或把 dpr 变化也做成过渡

### 阶段 2：修 A2 + A3

- `=== contactFrame` 改为 `>= contactFrame` + 一次性触发标志（`useRef` 布尔）
- `phaseFrameRef.current <= 1` 同样改成阈值 + 标志
- 进球震动放开到 `constrained`（开销极小）

### 阶段 3：B1 镜头

把 `DESKTOP_ZOOM` 的 `finish` / `outcome` 放开到 1.6-1.8 量级，`maxZoom` 同步上调。这是让已有物理层第一次"被看见"性价比最高的一步——改一张表，不碰物理。

需要同时处理：`cameraPointToScreen` 的坐标映射、`padding` 与边界钳制、以及降级档位的 `COMPACT_ZOOM` 同步。

### 阶段 4：B2 承载力

按性价比排序：

1. **用球的阴影 / 拖尾偏移表达高度**，让 `arc` 在俯视图上可见。这比换视角便宜得多
2. **放大跑位差异**：把 `getTacticalFormationSlots` 的 depth / widthScale 幅度调到画面可辨
3. `playOrigin` 接入 `selectPattern`，让"这次进攻从哪来"影响跑位路线

### 阶段 5（可选）：B3 / B4

- 给抢断、犯规、黄牌加轻量场景（不必像射门那么重）
- `findEventScene` 的 `lead <= 5` 收窄，或改成"到点才演"

## 6. 验收

- [ ] 连续播放 3 场比赛不出现画质降级（或降级后能自动回升）
- [ ] 降级过程中球员与球的视觉尺寸无跳变
- [ ] 「完整」与「沉浸」模式下射门触球 cue 正常触发，有测试覆盖三个模式
- [ ] constrained 档设备有进球震动
- [ ] 进球时刻画面有可辨识的推近
- [ ] 传中球（`chanceStyle === 'cross'`）的弧线在画面上可辨
- [ ] `pressing` 与 `low_block` 在画面上可区分
- [ ] 全量测试通过，未调整超时或产品断言

验收方式需要补充：目前 `physics.test.ts`（20KB）与 `sequence.test.ts`（9.6KB）测的都是状态机正确性，**没有任何测试断言动画的观感质量**（球员不该瞬移、球不该穿模、尺寸不该跳变）。建议在阶段 1-2 补几条这类断言，否则修完还会再退化。

## 7. 明确不做的事

- **不加慢动作回放**（作者明确不需要）
- 不重写 `physics.ts` / `sequence.ts`，它们的能力已经足够
- 不新增播放模式，现有「精华 / 完整 / 沉浸」三档保持
- 不改 `playbackMotionRate` 的三个步长值（A2 是判定写法的问题，不是步长的问题）
- 不做第一人称 / 侧视等视角切换（成本过高，阶段 4 的阴影方案能覆盖大部分收益）
- 不改比赛模拟引擎

## 8. 相关文件

- `src/components/PitchCanvas.tsx`（65KB，帧循环与绘制编排）
- `src/components/pitch-canvas/camera.ts` / `render-budget.ts` / `render-metrics.ts` / `runtime.ts`
- `src/components/pitch-canvas/event-scene.ts` / `sequence.ts` / `physics.ts` / `renderer.ts` / `types.ts`
- `src/components/match-live/playback-mode.ts` / `playback-state.ts` / `use-match-playback-controller.ts` / `moment-emphasis.ts`
- `src/types/match-presentation.ts`

## 9. 诊断过程中被推翻的判断

留档，避免后续重复踩：

1. ~~"庆祝动画会被时间轴切断"~~ —— `goalCelebFrame`（`PitchCanvas.tsx:571`）是 canvas 内部独立帧计数器，不受 tick 驱动，会自己播完 110 帧。证据不足，已撤回。
2. ~~"球员就是十几个小点挪动"~~ —— 实测是带号码的圆形标记，有队服配色、焦点高亮、传球虚线。已撤回。
3. ~~"`playOrigin` / `chanceStyle` / `setPiece.delivery` 都被丢弃"~~ —— 只有 `playOrigin` 未使用，另两个消费得很细致。见 B2。
4. ~~"一场比赛精华只有 12 秒"~~ —— 实测两次操作间隔几十秒推进 6 分钟比赛时间，整场估计 2-3 分钟。量级判断偏了，但"快进"的定性成立。
