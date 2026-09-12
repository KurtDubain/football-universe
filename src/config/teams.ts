import mechanics from '../edition/team-mechanics.json';
import { preset } from '../edition/preset';
import { TeamBase, TeamState } from '../types/team';

export const defaultTeams: TeamBase[] = mechanics.map(team => ({ ...team, ...preset.teams[team.id] })) as TeamBase[];
export function createInitialTeamStates(teams: TeamBase[]): Record<string, TeamState> {
  const states: Record<string, TeamState> = {};
  for (const team of teams) {
    states[team.id] = {
      id: team.id,
      leagueLevel: team.initialLeagueLevel,
      morale: 70,
      fatigue: 5,
      momentum: 0,
      squadHealth: 92,
      coachPressure: 5,
      recentForm: [],
    };
  }
  return states;
}
