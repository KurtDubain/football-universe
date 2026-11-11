import type { PlayerAward, PlayerAwardType } from '../../types/award';
import type { PlayerRetirement } from '../../types/player';
import type { GameWorld } from '../season/season-manager';

/**
 * Most prestigious first. Drives which honour a one-line summary names, so the
 * order is a presentation decision, not a ranking of the awards themselves.
 */
export const PLAYER_AWARD_PRECEDENCE: readonly PlayerAwardType[] = [
  'mvp',
  'golden_boot',
  'best_forward',
  'best_midfielder',
  'best_defender',
  'best_goalkeeper',
  'young_player',
] as const;

/**
 * Honours worth naming in a tight summary line. The youth award is excluded
 * because it reads as a prospect label rather than a career credential.
 */
const MAJOR_AWARD_PRECEDENCE: readonly PlayerAwardType[] =
  PLAYER_AWARD_PRECEDENCE.filter(type => type !== 'young_player');

/** Only a display fallback: as soon as minutes exist, current-season facts take over. */
export function followedPlayerFact(world: GameWorld, playerId: string): { fact: string; factTarget: string } | null {
  const path = `/player/${playerId}`;
  const stats = world.playerStats[playerId];
  if ((stats?.minutesPlayed ?? 0) > 0) return {
    fact: `本季 ${stats.appearances}场 · ${stats.goals}球 · ${stats.assists}助攻`, factTarget: `${path}#season-performance`,
  };
  const awards = playerCareerAwards(world, playerId);
  for (const type of MAJOR_AWARD_PRECEDENCE) {
    const wins = awards.filter(award => award.type === type);
    if (wins.length) return { fact: `档案记载${wins.length}届${PLAYER_AWARD_LABELS[type]} · 最近S${wins.at(-1)!.season}`,
      factTarget: `${path}#player-awards` };
  }
  const previous = world.playerStatsHistory?.[playerId]?.filter(row => row.season === world.seasonState.seasonNumber - 1);
  if (previous?.length) return { fact: `上季 ${previous.reduce((sum, row) => sum + row.goals, 0)}球 · ${previous.reduce((sum, row) => sum + row.assists, 0)}助攻`,
    factTarget: `${path}#career-seasons` };
  return null;
}

export const PLAYER_AWARD_LABELS: Record<PlayerAwardType, string> = {
  mvp: '金球', golden_boot: '金靴',
  best_forward: '最佳前锋', best_midfielder: '最佳中场',
  best_defender: '最佳后卫', best_goalkeeper: '最佳门将',
  young_player: '最佳新星',
};

export function principalCareerHonor(world: Parameters<typeof playerCareerAwards>[0], playerId: string): string | null {
  const awards = playerCareerAwards(world, playerId);
  for (const type of PLAYER_AWARD_PRECEDENCE) {
    const count = awards.filter(award => award.type === type).length;
    if (count) return `${count}届${PLAYER_AWARD_LABELS[type]}`;
  }
  return null;
}

export interface PlayerHonorContext {
  seasonNumber?: number;
  playerAwardsHistory?: PlayerAward[];
}

export function previousSeasonHonor(context: PlayerHonorContext, playerId: string): PlayerAward | undefined {
  return context.playerAwardsHistory?.filter(award => award.playerId === playerId
    && award.season === (context.seasonNumber ?? 0) - 1
    && MAJOR_AWARD_PRECEDENCE.includes(award.type))
    .sort((a, b) => MAJOR_AWARD_PRECEDENCE.indexOf(a.type) - MAJOR_AWARD_PRECEDENCE.indexOf(b.type))[0];
}

export function describePreviousHonor(award: PlayerAward): string {
  return `上季${award.type === 'golden_boot' ? `${award.statLabel} · ` : ''}${PLAYER_AWARD_LABELS[award.type]}得主`;
}

/** Retained summaries and live history can overlap after saving; facts are unique by season/type. */
export function playerCareerAwards(
  world: { playerAwardsHistory?: PlayerAward[]; retirementHistory?: PlayerRetirement[] },
  playerId: string,
): PlayerAward[] {
  const archived = world.retirementHistory?.find(player => player.uuid === playerId)?.careerSummary?.awards ?? [];
  const unique = new Map<string, PlayerAward>();
  for (const award of [...archived, ...(world.playerAwardsHistory ?? [])]) {
    if (award.playerId === playerId) unique.set(`${award.season}:${award.type}`, award);
  }
  return [...unique.values()].sort((a, b) => a.season - b.season || a.type.localeCompare(b.type));
}
