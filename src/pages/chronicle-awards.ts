/**
 * 编年史页的球员奖项读取层。
 *
 * `world.playerAwardsHistory` 按赛季裁剪（`PLAYER_AWARDS_SEASONS`，见
 * src/engine/season/storage-limits.ts），窗口外的赛季奖项已被丢弃且无法回溯。
 * 本模块把「已归档」和「窗口内确实没颁出奖」拆成两个互斥状态，交给 UI 分别表达。
 *
 * 只读取引擎已有导出，不复制任何评奖逻辑。
 */
import type { PlayerAward, PlayerAwardType } from '../types/award';
import type { GameWorld } from '../engine/season/season-manager';
import { AWARD_META } from '../engine/awards/season-awards';
import {
  getSeasonTopScorerRows,
  seasonTopScorerLabel,
} from '../engine/players/player-stat-selectors';
import type { SeasonTopScorerView } from '../components/SeasonAwardsBlock';

/** 展示与叙事共用的优先级：金球 → 金靴 → 位置奖 → 新星。 */
const AWARD_DISPLAY_ORDER: readonly PlayerAwardType[] = [
  'mvp',
  'golden_boot',
  'best_forward',
  'best_midfielder',
  'best_defender',
  'best_goalkeeper',
  'young_player',
];

/** 叙事句子只点名这两项；都没有时退回展示顺序里的第一项。 */
const HEADLINE_TYPES: readonly PlayerAwardType[] = ['mvp', 'golden_boot'];

export type SeasonAwardState =
  | { kind: 'awards'; awards: PlayerAward[] }
  | { kind: 'archived' }
  | { kind: 'none' };

export function selectSeasonAwards(
  awardsHistory: readonly PlayerAward[] | undefined,
  seasonNumber: number,
): PlayerAward[] {
  return (awardsHistory ?? [])
    .filter(award => award.season === seasonNumber)
    .sort((a, b) => AWARD_DISPLAY_ORDER.indexOf(a.type) - AWARD_DISPLAY_ORDER.indexOf(b.type));
}

export function earliestAwardSeason(
  awardsHistory: readonly PlayerAward[] | undefined,
): number | null {
  const seasons = (awardsHistory ?? []).map(award => award.season);
  return seasons.length > 0 ? Math.min(...seasons) : null;
}

/**
 * 该赛季的球员奖项是否已被容量裁剪。
 *
 * 判据只有一条：存档里仍有更晚赛季的奖项记录，而本赛季早于最早的那条。
 * 存档完全没有奖项记录时，无法区分「功能上线前的旧档」与「数据异常」，
 * 因此不做归档判定——那种情况走 `none`，UI 静默不渲染。
 */
export function isSeasonAwardsArchived(
  awardsHistory: readonly PlayerAward[] | undefined,
  seasonNumber: number,
): boolean {
  const earliest = earliestAwardSeason(awardsHistory);
  return earliest !== null && seasonNumber < earliest;
}

export function seasonAwardState(
  awardsHistory: readonly PlayerAward[] | undefined,
  seasonNumber: number,
): SeasonAwardState {
  const awards = selectSeasonAwards(awardsHistory, seasonNumber);
  if (awards.length > 0) return { kind: 'awards', awards };
  return isSeasonAwardsArchived(awardsHistory, seasonNumber)
    ? { kind: 'archived' }
    : { kind: 'none' };
}

/** 赛季最重磅的那座奖：金球优先，其次金靴，再次任意一个。 */
export function headlineAward(awards: readonly PlayerAward[]): PlayerAward | null {
  for (const type of HEADLINE_TYPES) {
    const hit = awards.find(award => award.type === type);
    if (hit) return hit;
  }
  return awards[0] ?? null;
}

/**
 * 赛季叙事里的球员分句，不含句末标点，由调用方决定终止符：
 * `SeasonDetail` 每段独立成句，全赛季叙事用「，」拼接。
 *
 * 已归档赛季与无奖项赛季都返回 null——归档提示只出现在区块里，不写进叙事。
 */
export function buildAwardNarrativeClause(
  awardsHistory: readonly PlayerAward[] | undefined,
  seasonNumber: number,
): string | null {
  const state = seasonAwardState(awardsHistory, seasonNumber);
  if (state.kind !== 'awards') return null;
  const award = headlineAward(state.awards);
  if (!award) return null;
  return `${award.playerName}（${award.teamName}）拿下了${AWARD_META[award.type].label}`;
}

/**
 * 赛季射手王（联赛口径）。
 *
 * 与金靴奖口径不同：射手王排联赛进球并按赛程折算，金靴排全赛事进球，
 * 所以口径说明必须来自 `seasonTopScorerLabel`，不能在 UI 里写死。
 * 行数据取自 `playerStatsHistory`（保留窗口比奖项更短），窗口外没有行时返回 null。
 */
export function selectSeasonTopScorer(
  world: GameWorld,
  seasonNumber: number,
): SeasonTopScorerView | null {
  const row = getSeasonTopScorerRows(world, seasonNumber, 1)[0];
  if (!row) return null;
  return {
    playerId: row.playerId,
    playerName: row.identity.playerName,
    teamName: row.identity.teamName,
    teamColor: row.identity.teamColor,
    label: seasonTopScorerLabel(world, row, seasonNumber),
  };
}

export interface AwardLeaderboardRow {
  playerId: string;
  playerName: string;
  /** 最近一次获奖时所在的球队。 */
  teamName: string;
  count: number;
}

/** 总览视图的「个人荣誉」排行：某个奖项的得奖次数排名。 */
export function buildAwardLeaderboard(
  awardsHistory: readonly PlayerAward[] | undefined,
  type: PlayerAwardType,
  limit = 5,
): AwardLeaderboardRow[] {
  const tally = new Map<string, AwardLeaderboardRow & { latestSeason: number }>();
  for (const award of awardsHistory ?? []) {
    if (award.type !== type) continue;
    const existing = tally.get(award.playerId);
    if (!existing) {
      tally.set(award.playerId, {
        playerId: award.playerId,
        playerName: award.playerName,
        teamName: award.teamName,
        count: 1,
        latestSeason: award.season,
      });
      continue;
    }
    existing.count += 1;
    if (award.season > existing.latestSeason) {
      existing.latestSeason = award.season;
      existing.teamName = award.teamName;
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.count - a.count || a.playerId.localeCompare(b.playerId))
    .slice(0, limit)
    .map(({ playerId, playerName, teamName, count }) => ({ playerId, playerName, teamName, count }));
}
