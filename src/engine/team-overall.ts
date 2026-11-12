import { BALANCE } from '../config/balance';
import type { CoachBase } from '../types/coach';
import type { TeamBase } from '../types/team';
import type { PlayerBoosts } from './players/player-boosts';

/**
 * team.overall 的显示区间。三条线各自被 clamp 在 [35, 96]，叠加教练与球员
 * 加成后均值可能越出这个范围，所以这里单独给一个更宽的边界。
 */
const MIN_OVERALL = 30;
const MAX_OVERALL = 99;

/**
 * 压缩拐点。真实强度（含教练 buff 与球员加成）的实测跨度是 34~116，比
 * [30, 99] 的显示区间宽 13 点 —— 这是「OVR 等于比赛真正使用的强度」与
 * 「OVR 是 0~99 的足球惯例」之间无法同时满足的部分。
 *
 * 硬夹的代价是所有 raw > 99 的球队塌成同一个 99：V4 实测中 L1 有 42% 的
 * 队-季 raw ≥ 96，顶级球队之间彻底失去区分度。
 *
 * 拐点以上改用指数压缩，渐近 99 但永远达不到：
 *   - 严格单调，所以基于秩的预测力（Spearman）不受影响；
 *   - 不会产生并列，raw 100 与 raw 116 显示为 93 与 97。
 *
 * 拐点取 84 是解出来的，不是拍的。5 种子 × 60 赛季的 raw 分布是
 * p50 76.2 / p75 92.8 / p90 102.5 / p99 110.8，各候选拐点的代价：
 *
 *   拐点   OVR≥96 占比   平均|偏差|   F1
 *    90        16.5%        1.51     0.849
 *    86         9.2%        1.87     0.813
 *    84         4.8%        2.09     0.791
 *    80         0.6%        2.57     0.743
 *
 * 84 是同时满足「OVR≥96 不超过 10%」与「F1 ≥ 0.75」且两侧都留有余量的
 * 点。代价要说清楚：约 39% 的队-季落在压缩区，OVR 对它们只保序、不再等于
 * 真实强度。这是「OVR 计入教练与球员」和「OVR 是 0~99 的足球惯例」之间
 * 必须付的价 —— 原始 overall 字段不含这两项，所以它的量纲天然比真实强度
 * 低 5~8 点。
 */
const COMPRESSION_KNEE = 84;

/**
 * 从真实强度派生 team.overall。
 *
 * overall 此前是独立漂移的存量字段：赛季末九条路径（战绩成长、自然老化、
 * 弱队托底、均值回归、升降级、内部动荡、超预期Bonus）直接改它，再由
 * 「Proportional attribute sync」把变化量用随机区间分配到三条线。两条路径
 * 各自演化，60 赛季 × 5 种子实测中 OVR 与真实强度的 Spearman 相关性从
 * 0.964 掉到 0.559，OVR≥96 的撞顶比例从 2.1% 涨到 15.1%。
 *
 * 改为派生量后，overall 永远等于「三条线 + 教练 + 球员」的实际强度，不再能
 * 跟比赛真正使用的数值脱节。
 *
 * 它仍然不参与比赛计算 —— adjustedStrengths 只读 attack / midfield /
 * defense / stability，overall 在比赛里的唯一作用是 derbies.ts 的三个离散
 * 门槛（minOvr >= 83 / >= 78、ovrDiff <= 10）。派生之后那个作用也仍然只是
 * 开关，不是权重。
 *
 * 公式刻意复刻 adjustedStrengths 中与 state / tactics / 主场无关的部分：
 * 中立场、中性状态（morale 60 / fatigue 0 / momentum 0）、无战术调整时，
 * 一支球队的纸面强度。这样 OVR 与审计脚本里的「真实强度」基准同源，
 * 两者不会各自漂移出第二层偏差。
 */
export function deriveTeamOverall(
  team: TeamBase,
  coach: CoachBase | null,
  boosts: PlayerBoosts,
): number {
  const coachWeight = BALANCE.COACH_BUFF_WEIGHT;
  const attack = team.attack + (coach ? coach.attackBuff * coachWeight : 0) + boosts.attack;
  const midfield = team.midfield + boosts.midfield;
  const defense = team.defense
    + (coach ? coach.defenseBuff * coachWeight : 0)
    + boosts.defense
    + team.stability * 0.1;
  const raw = (attack + midfield + defense) / 3;
  const bounded = Math.max(MIN_OVERALL, raw);
  if (bounded <= COMPRESSION_KNEE) return Math.round(bounded);
  const span = MAX_OVERALL - COMPRESSION_KNEE;
  const compressed = COMPRESSION_KNEE
    + span * (1 - Math.exp(-(bounded - COMPRESSION_KNEE) / span));
  return Math.round(Math.min(MAX_OVERALL, compressed));
}
