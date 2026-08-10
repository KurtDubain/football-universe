import type { TeamBase } from '../../types/team';
import type { WorldCupEdition, WorldCupState } from '../../types/cup';
import { SeededRNG } from '../match/rng';

export const WORLD_CUP_EDITION_HISTORY_LIMIT = 50;
const RECENT_HOST_EXCLUSION = 3;

function continentOf(team: TeamBase | undefined): string {
  return team?.region?.split('+')[0] || '未知';
}

function hostSelectionSeed(seed: number, seasonNumber: number): number {
  return (seed ^ Math.imul(seasonNumber, 0x45d9f3b)) | 0;
}

/**
 * Select a host without consulting rating, reputation, tier, or league level.
 * Continents with fewer historical editions are served first; recent hosts
 * are then excluded before a seeded uniform draw among all remaining clubs.
 */
export function selectWorldCupHost(
  teamIds: string[],
  teamBases: Record<string, TeamBase>,
  editions: WorldCupEdition[],
  seasonNumber: number,
  seed: number,
): string {
  const candidates = [...new Set(teamIds)].filter(teamId => Boolean(teamBases[teamId])).sort();
  if (candidates.length === 0) throw new Error('World Cup host selection requires at least one team');
  const chronologicalEditions = [...editions].sort((a, b) => a.seasonNumber - b.seasonNumber);

  const byContinent = new Map<string, string[]>();
  for (const teamId of candidates) {
    const continent = continentOf(teamBases[teamId]);
    byContinent.set(continent, [...(byContinent.get(continent) ?? []), teamId]);
  }

  const hostCounts = new Map<string, number>();
  for (const edition of chronologicalEditions) {
    const continent = continentOf(teamBases[edition.hostTeamId]);
    hostCounts.set(continent, (hostCounts.get(continent) ?? 0) + 1);
  }
  const continents = [...byContinent.keys()].sort();
  const previousEdition = chronologicalEditions.at(-1);
  const previousContinent = previousEdition
    ? continentOf(teamBases[previousEdition.hostTeamId])
    : null;
  const rotationPool = continents.length > 1
    ? continents.filter(continent => continent !== previousContinent)
    : continents;
  const minimumHostCount = Math.min(...rotationPool.map(continent => hostCounts.get(continent) ?? 0));
  const eligibleContinents = rotationPool.filter(
    continent => (hostCounts.get(continent) ?? 0) === minimumHostCount,
  );

  const rng = new SeededRNG(hostSelectionSeed(seed, seasonNumber));
  const selectedContinent = rng.pick(eligibleContinents);
  const recentHosts = new Set(
    chronologicalEditions.slice(-RECENT_HOST_EXCLUSION).map(edition => edition.hostTeamId),
  );
  const continentTeams = byContinent.get(selectedContinent) ?? candidates;
  const freshHosts = continentTeams.filter(teamId => !recentHosts.has(teamId));
  return rng.pick(freshHosts.length > 0 ? freshHosts : continentTeams);
}

export function ensureWorldCupEdition(
  editions: WorldCupEdition[] | undefined,
  teamIds: string[],
  teamBases: Record<string, TeamBase>,
  seasonNumber: number,
  seed: number,
): { editions: WorldCupEdition[]; edition: WorldCupEdition; created: boolean } {
  const existing = editions?.find(edition => edition.seasonNumber === seasonNumber);
  if (existing) return { editions: editions ?? [], edition: existing, created: false };

  const source = editions ?? [];
  const edition: WorldCupEdition = {
    seasonNumber,
    hostTeamId: selectWorldCupHost(teamIds, teamBases, source, seasonNumber, seed),
    announcedSeasonNumber: seasonNumber,
  };
  return {
    editions: [...source, edition].slice(-WORLD_CUP_EDITION_HISTORY_LIMIT),
    edition,
    created: true,
  };
}

export function worldCupHostResult(state: WorldCupState, hostTeamId: string): string {
  if (state.winnerId === hostTeamId) return '冠军';
  const rounds = [...state.knockoutRounds].reverse();
  for (const round of rounds) {
    const fixture = round.fixtures.find(
      item => item.homeTeamId === hostTeamId || item.awayTeamId === hostTeamId,
    );
    if (!fixture) continue;
    if (round.roundName === 'Final') return '亚军';
    if (round.roundName === 'SF') return '四强';
    if (round.roundName === 'QF') return '八强';
    return '16强';
  }
  return '小组赛';
}

export function completeWorldCupEdition(
  editions: WorldCupEdition[] | undefined,
  state: WorldCupState,
  seasonNumber: number,
  winnerId: string,
  runnerUpId: string | undefined,
): WorldCupEdition[] {
  const hostTeamId = state.hostTeamId;
  if (!hostTeamId) return editions ?? [];
  const source = editions ?? [];
  const existing = source.find(edition => edition.seasonNumber === seasonNumber);
  const completed: WorldCupEdition = {
    ...(existing ?? {
      seasonNumber,
      hostTeamId,
      announcedSeasonNumber: seasonNumber,
    }),
    hostTeamId,
    winnerId,
    ...(runnerUpId ? { runnerUpId } : {}),
    hostResult: worldCupHostResult(state, hostTeamId),
  };
  return [
    ...source.filter(edition => edition.seasonNumber !== seasonNumber),
    completed,
  ].sort((a, b) => a.seasonNumber - b.seasonNumber).slice(-WORLD_CUP_EDITION_HISTORY_LIMIT);
}
