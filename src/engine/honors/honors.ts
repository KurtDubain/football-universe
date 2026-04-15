import { Trophy } from '../../types/team';
import { HonorRecord } from '../../types/honor';

/**
 * Create a season honor record from season results.
 */
export function createHonorRecord(
  seasonNumber: number,
  league1Champion: string,
  league2Champion: string,
  league3Champion: string,
  leagueCupWinner: string,
  superCupWinner: string,
  worldCupWinner: string | undefined,
  promoted: { teamId: string; from: number; to: number }[],
  relegated: { teamId: string; from: number; to: number }[],
  coachChanges: { teamId: string; oldCoachId: string; newCoachId: string; reason: string }[],
): HonorRecord {
  return {
    seasonNumber,
    league1Champion,
    league2Champion,
    league3Champion,
    leagueCupWinner,
    superCupWinner,
    worldCupWinner,
    promoted: [...promoted],
    relegated: [...relegated],
    coachChanges: [...coachChanges],
  };
}

/**
 * Generate trophies for a team based on season results.
 */
export function generateTeamTrophies(
  teamId: string,
  seasonNumber: number,
  league1ChampionId: string,
  league2ChampionId: string,
  league3ChampionId: string,
  leagueCupWinnerId: string,
  superCupWinnerId: string,
  worldCupWinnerId: string | undefined,
  teamLeagueLevel: 1 | 2 | 3,
): Trophy[] {
  const trophies: Trophy[] = [];

  // League championship (only the league the team participates in)
  if (teamLeagueLevel === 1 && teamId === league1ChampionId) {
    trophies.push({ type: 'league1', seasonNumber });
  }
  if (teamLeagueLevel === 2 && teamId === league2ChampionId) {
    trophies.push({ type: 'league2', seasonNumber });
  }
  if (teamLeagueLevel === 3 && teamId === league3ChampionId) {
    trophies.push({ type: 'league3', seasonNumber });
  }

  // Cup competitions (open to all)
  if (teamId === leagueCupWinnerId) {
    trophies.push({ type: 'league_cup', seasonNumber });
  }
  if (teamId === superCupWinnerId) {
    trophies.push({ type: 'super_cup', seasonNumber });
  }
  if (worldCupWinnerId && teamId === worldCupWinnerId) {
    trophies.push({ type: 'world_cup', seasonNumber });
  }

  return trophies;
}

/**
 * Count trophies of a specific type.
 */
export function countTrophies(trophies: Trophy[], type: Trophy['type']): number {
  return trophies.filter((t) => t.type === type).length;
}

/**
 * Get a summary of all trophies.
 */
export function getTrophySummary(trophies: Trophy[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const trophy of trophies) {
    summary[trophy.type] = (summary[trophy.type] || 0) + 1;
  }
  return summary;
}
