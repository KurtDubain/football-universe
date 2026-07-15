import type { GameWorld } from '../season/season-manager';
import type { PlayerSeasonStats, PlayerSeasonStatsHistoryEntry } from '../../types/player';

export interface PlayerCareerTotals {
  seasons: number;
  appearances: number;
  starts: number;
  substituteAppearances: number;
  minutesPlayed: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  cleanSheets: number;
  saves: number;
  keyBlocks: number;
  bigChances: number;
  keyPasses: number;
  currentSeasonIncluded: boolean;
}

function addHistoryEntry(total: PlayerCareerTotals, entry: PlayerSeasonStatsHistoryEntry): void {
  total.seasons++;
  total.appearances += entry.appearances;
  total.starts += entry.starts ?? entry.appearances;
  total.substituteAppearances += entry.substituteAppearances ?? 0;
  total.minutesPlayed += entry.minutesPlayed ?? entry.appearances * 90;
  total.goals += entry.goals;
  total.assists += entry.assists;
  total.yellowCards += entry.yellowCards;
  total.redCards += entry.redCards;
  total.cleanSheets += entry.cleanSheets ?? 0;
  total.saves += entry.saves ?? 0;
  total.keyBlocks += entry.keyBlocks ?? 0;
  total.bigChances += entry.bigChances ?? entry.goals;
  total.keyPasses += entry.keyPasses ?? entry.assists;
}

function addCurrentSeason(total: PlayerCareerTotals, stat: PlayerSeasonStats): void {
  total.appearances += stat.appearances;
  total.starts += stat.starts ?? stat.appearances;
  total.substituteAppearances += stat.substituteAppearances ?? 0;
  total.minutesPlayed += stat.minutesPlayed ?? stat.appearances * 90;
  total.goals += stat.goals;
  total.assists += stat.assists;
  total.yellowCards += stat.yellowCards;
  total.redCards += stat.redCards;
  total.cleanSheets += stat.cleanSheets;
  total.saves += stat.saves;
  total.keyBlocks += stat.keyBlocks;
  total.bigChances += stat.bigChances;
  total.keyPasses += stat.keyPasses;
  total.currentSeasonIncluded = true;
}

/**
 * Career totals are display/retirement data, not match-engine state.
 * They are derived from immutable finished-season history plus the current
 * live season row when it has not been snapshotted yet.
 */
export function computePlayerCareerTotals(
  world: Pick<GameWorld, 'playerStats' | 'playerStatsHistory' | 'seasonState'>,
  playerUuid: string,
  options: { includeCurrentSeason?: boolean } = {},
): PlayerCareerTotals {
  const includeCurrentSeason = options.includeCurrentSeason ?? true;
  const total: PlayerCareerTotals = {
    seasons: 0,
    appearances: 0,
    starts: 0,
    substituteAppearances: 0,
    minutesPlayed: 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    cleanSheets: 0,
    saves: 0,
    keyBlocks: 0,
    bigChances: 0,
    keyPasses: 0,
    currentSeasonIncluded: false,
  };

  for (const entry of world.playerStatsHistory?.[playerUuid] ?? []) {
    addHistoryEntry(total, entry);
  }

  const current = world.playerStats?.[playerUuid];
  const currentSeasonAlreadySnapshotted = (world.playerStatsHistory?.[playerUuid] ?? [])
    .some((entry) => entry.season === world.seasonState.seasonNumber);
  if (includeCurrentSeason && current && !currentSeasonAlreadySnapshotted) {
    addCurrentSeason(total, current);
  }

  return total;
}
