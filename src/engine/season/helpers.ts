import type { TeamBase } from '../../types/team';
import type { MatchResult, MatchFixture } from '../../types/match';
import type { SimulationContext } from '../match/simulator';
import type { SeededRNG } from '../match/rng';
import type { GameWorld } from './season-manager';
import { getTeamCoachId } from '../coaches/coach-lookup';

export function buildSimulationContext(
  fixture: MatchFixture,
  world: GameWorld,
  rng: SeededRNG,
): SimulationContext {
  const homeTeam = world.teamBases[fixture.homeTeamId];
  const awayTeam = world.teamBases[fixture.awayTeamId];
  const homeState = world.teamStates[fixture.homeTeamId];
  const awayState = world.teamStates[fixture.awayTeamId];
  const homeCoachId = getTeamCoachId(world.coachStates, fixture.homeTeamId);
  const awayCoachId = getTeamCoachId(world.coachStates, fixture.awayTeamId);
  const homeCoach = homeCoachId ? world.coachBases[homeCoachId] ?? null : null;
  const awayCoach = awayCoachId ? world.coachBases[awayCoachId] ?? null : null;

  const isKnockout = fixture.competitionType === 'league_cup'
    || fixture.competitionType === 'relegation_playoff'
    || fixture.competitionType === 'world_cup'
    || fixture.competitionType === 'super_cup'
    || fixture.competitionType === 'continental_cup';

  // Pass complete squads through. The simulator owns the one authoritative
  // matchday selection so its persisted availableCount describes the actual
  // roster rather than an already-truncated top 14.
  const currentWindowIdx = world.totalElapsedWindows ?? 0;

  return {
    homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach,
    competitionType: fixture.competitionType,
    isKnockout, rng,
    homeSquad: world.squads[fixture.homeTeamId],
    awaySquad: world.squads[fixture.awayTeamId],
    globalWindowIdx: currentWindowIdx,
  };
}

export function getTeamIdsByLeague(teamStates: Record<string, { leagueLevel: 1|2|3; id: string }>, level: 1 | 2 | 3): string[] {
  return Object.values(teamStates).filter(ts => ts.leagueLevel === level).map(ts => ts.id);
}

export function getAllTeamIds(teamStates: Record<string, { id: string }>): string[] {
  return Object.keys(teamStates);
}

export function createNewsId(seasonNumber: number, windowIndex: number, suffix: string): string {
  return `S${seasonNumber}-W${windowIndex}-${suffix}`;
}

export function isUpset(homeTeam: TeamBase, awayTeam: TeamBase, result: MatchResult): boolean {
  const homeGoalsTotal = result.homeGoals + (result.etHomeGoals ?? 0);
  const awayGoalsTotal = result.awayGoals + (result.etAwayGoals ?? 0);
  if (homeGoalsTotal === awayGoalsTotal) return false;
  if (result.prediction) {
    const probabilityGap = Math.abs(result.prediction.homeWinPct - result.prediction.awayWinPct);
    if (probabilityGap < 10) return false;
    return homeGoalsTotal > awayGoalsTotal
      ? result.prediction.homeWinPct < result.prediction.awayWinPct
      : result.prediction.awayWinPct < result.prediction.homeWinPct;
  }
  const overallDiff = Math.abs(homeTeam.overall - awayTeam.overall);
  if (overallDiff < 10) return false;
  const strongerIsHome = homeTeam.overall > awayTeam.overall;
  if (strongerIsHome) return awayGoalsTotal > homeGoalsTotal;
  return homeGoalsTotal > awayGoalsTotal;
}

export function countTrailingResult(form: ('W'|'D'|'L')[], target: 'W'|'D'|'L'): number {
  let count = 0;
  for (let i = form.length - 1; i >= 0; i--) {
    if (form[i] === target) count++;
    else break;
  }
  return count;
}

export function countTrailingNotResult(form: ('W'|'D'|'L')[], exclude: 'W'|'D'|'L'): number {
  let count = 0;
  for (let i = form.length - 1; i >= 0; i--) {
    if (form[i] !== exclude) count++;
    else break;
  }
  return count;
}

export function cnRoundLabel(name: string): string {
  const map: Record<string, string> = { R32: '32强', R16: '16强', QF: '八强', SF: '四强', Final: '决赛' };
  return map[name] ?? name;
}

export function countCompletedSuperCupGroupWindows(calendar: { type: string; completed: boolean }[]): number {
  return calendar.filter(w => w.type === 'super_cup_group' && w.completed).length;
}

export function isTeamEliminated(teamId: string, result: MatchResult): boolean {
  const homeGoalsTotal = result.homeGoals + (result.etHomeGoals ?? 0);
  const awayGoalsTotal = result.awayGoals + (result.etAwayGoals ?? 0);

  let winnerId: string;
  if (homeGoalsTotal !== awayGoalsTotal) {
    winnerId = homeGoalsTotal > awayGoalsTotal ? result.homeTeamId : result.awayTeamId;
  } else if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    winnerId = result.penaltyHome > result.penaltyAway ? result.homeTeamId : result.awayTeamId;
  } else {
    winnerId = result.homeTeamId;
  }
  return winnerId !== teamId;
}
