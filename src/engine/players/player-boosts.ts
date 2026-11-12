import { Player, PlayerPosition } from '../../types/player';
import type { CoachFormation } from '../../types/coach';
import { BALANCE } from '../../config/balance';
import { getFormationShape } from '../coaches/tactics';

/**
 * Player-derived match strength. Team attributes remain the foundation; this
 * is a compact way to make the actual available XI and injuries matter.
 */

const BASELINE_RATING = 60;
// Lower than the minimum generated rating, so losing a player can never make
// a unit stronger. In an emergency-floor XI this is the explicit fitness cost
// of fielding an otherwise unavailable player.
const EMERGENCY_RATING = 30;
// 普通球员的权重。此前是 0.45 —— 一个球员评分 +10 只让球队强 0.3 个胜率点，
// 球员基本是装饰。0.70 让中游球员也真正参与胜负，同时把「球员占球队实力的
// 比重」从 7% 提到约 13%：翻倍，但没有大到让俱乐部数值失去意义。
const QUALITY_TO_BOOST = 0.70;

// ── 球星项 ──
// 86 分以上的球员按 (rating − 86)^1.3 额外加成。阈值以下贡献 0，所以中下游
// 球队的行为跟从前完全一致，只有真正的强队才吃得到这一项。
//
// 四个常数（连同 PLAYER_BOOST_CAP）是扫出来的：2 种子 × 12 个赛季快照 ×
// 240 组参数，目标是「单星 +10 值 1.5~4 个胜率点、缺阵值 3~6 个点、顶级/中游
// 边际比 1.8~3.0」，外加一条隐含约束 —— 加成上限不能让真实强队撞顶，否则
// 球星之间的差距会被抹平。这一组三项同时命中，撞顶率 2%。
//
// 门槛试过 82 / 84：都会让前四支球队的加成需求冲到 50~60，球员会占到球队
// 四成实力，联赛会失去悬念。86 把球星项收窄到真正的顶级球员身上。
const STAR_THRESHOLD = 86;
const STAR_EXPONENT = 1.3;
const STAR_WEIGHT = 1.8;

export interface PlayerBoosts {
  attack: number;
  midfield: number;
  defense: number;
}

export interface PlayerBoostReport {
  current: PlayerBoosts;
  fullStrength: PlayerBoosts;
  absenceLoss: PlayerBoosts;
}

function roundOne(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const POSITIONS: PlayerPosition[] = ['GK', 'DF', 'MF', 'FW'];

/**
 * 每条线上各位置的份额。这跟旧版「按位置取均值再加权」完全等价 ——
 * 展开成逐人权重之后，一个球员对某条线的影响力就是 份额 / 该位置人数。
 * 展开的目的是让球星项也能按人计算，不再被单元均值稀释掉。
 */
const LINE_WEIGHTS: Record<keyof PlayerBoosts, Partial<Record<PlayerPosition, number>>> = {
  attack: { FW: 0.7, MF: 0.3 },
  midfield: { MF: 0.7, FW: 0.15, DF: 0.15 },
  defense: { DF: 0.65, GK: 0.25, MF: 0.1 },
};

function calculateBoosts(players: Player[], formation: CoachFormation): PlayerBoosts {
  const shape = getFormationShape(formation);

  // 首发 XI：每个位置取最强的 N 人，人数不够按 emergency floor 补底。
  const xi: Array<{ position: PlayerPosition; rating: number }> = [];
  for (const position of POSITIONS) {
    const slots = shape[position];
    const ratings = players
      .filter(player => player.position === position)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, slots)
      .map(player => player.rating);
    while (ratings.length < slots) ratings.push(EMERGENCY_RATING);
    for (const rating of ratings) xi.push({ position, rating });
  }

  const cap = BALANCE.PLAYER_BOOST_CAP;
  const weight = BALANCE.PLAYER_BOOST_WEIGHT;
  const out: PlayerBoosts = { attack: 0, midfield: 0, defense: 0 };

  for (const line of ['attack', 'midfield', 'defense'] as const) {
    let quality = 0;
    let star = 0;
    for (const slot of xi) {
      const share = LINE_WEIGHTS[line][slot.position];
      if (share === undefined) continue;
      const slotWeight = share / shape[slot.position];
      quality += slotWeight * slot.rating;
      const over = slot.rating - STAR_THRESHOLD;
      if (over > 0) star += slotWeight * Math.pow(over, STAR_EXPONENT);
    }
    const raw = (quality - BASELINE_RATING) * QUALITY_TO_BOOST + star * STAR_WEIGHT;
    out[line] = roundOne(Math.max(-cap, Math.min(cap, raw)) * weight);
  }

  return out;
}

/** Authoritative boost for an already-selected lineup; no availability filtering. */
export function computeSelectedPlayerBoosts(
  players: Player[],
  formation: CoachFormation = '4-3-3',
): PlayerBoosts {
  if (players.length === 0 || (BALANCE.PLAYER_BOOST_WEIGHT as number) === 0) {
    return { attack: 0, midfield: 0, defense: 0 };
  }
  return calculateBoosts(players, formation);
}

function isAvailable(player: Player, globalWindowIdx: number): boolean {
  return (player.injuredUntilWindow ?? 0) <= globalWindowIdx
    && (player.suspendedUntilWindow ?? 0) <= globalWindowIdx;
}

export function computePlayerBoosts(
  squad: Player[] | undefined,
  globalWindowIdx: number,
  formation: CoachFormation = '4-3-3',
): PlayerBoosts {
  if (!squad || squad.length === 0 || (BALANCE.PLAYER_BOOST_WEIGHT as number) === 0) {
    return { attack: 0, midfield: 0, defense: 0 };
  }
  return calculateBoosts(squad.filter(player => isAvailable(player, globalWindowIdx)), formation);
}

export function computePlayerBoostReport(
  squad: Player[] | undefined,
  globalWindowIdx: number,
  formation: CoachFormation = '4-3-3',
): PlayerBoostReport {
  if (!squad || squad.length === 0 || (BALANCE.PLAYER_BOOST_WEIGHT as number) === 0) {
    const zero = { attack: 0, midfield: 0, defense: 0 };
    return { current: zero, fullStrength: zero, absenceLoss: zero };
  }

  const current = calculateBoosts(squad.filter(player => isAvailable(player, globalWindowIdx)), formation);
  const fullStrength = calculateBoosts(squad, formation);
  return {
    current,
    fullStrength,
    absenceLoss: {
      attack: roundOne(Math.max(0, fullStrength.attack - current.attack)),
      midfield: roundOne(Math.max(0, fullStrength.midfield - current.midfield)),
      defense: roundOne(Math.max(0, fullStrength.defense - current.defense)),
    },
  };
}
