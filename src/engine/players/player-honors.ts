import type { PlayerAward, PlayerAwardType } from '../../types/award';
import type { PlayerRetirement } from '../../types/player';

export const PLAYER_AWARD_LABELS: Record<PlayerAwardType, string> = {
  mvp: '金球', golden_boot: '金靴', best_defender: '最佳后卫',
  best_goalkeeper: '最佳门将', young_player: '最佳新星',
};

export interface PlayerHonorContext {
  seasonNumber?: number;
  playerAwardsHistory?: PlayerAward[];
}

export function previousSeasonHonor(context: PlayerHonorContext, playerId: string): PlayerAward | undefined {
  const order: PlayerAwardType[] = ['mvp', 'golden_boot', 'best_defender', 'best_goalkeeper'];
  return context.playerAwardsHistory?.filter(award => award.playerId === playerId
    && award.season === (context.seasonNumber ?? 0) - 1 && order.includes(award.type))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0];
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
