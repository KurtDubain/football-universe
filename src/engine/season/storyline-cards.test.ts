import { describe, expect, it } from 'vitest';
import type { StandingEntry } from '../../types/league';
import type { SeasonRecord, TeamBase, TeamState } from '../../types/team';
import type { GameWorld } from './season-manager';
import { generateStorylineCards } from './storyline-cards';

function team(id: string, expectation: number): TeamBase {
  return {
    id, name: id, shortName: id, color: '#123456', tier: 'mid', overall: 75,
    attack: 75, midfield: 75, defense: 75, stability: 75, depth: 75,
    reputation: 75, initialLeagueLevel: 1, expectation, region: '测试',
  };
}

function state(id: string, coachPressure = 20): TeamState {
  return {
    id, leagueLevel: 1, morale: 60, fatigue: 10, momentum: 0,
    squadHealth: 90, coachPressure, recentForm: ['W', 'W', 'D', 'W', 'L'],
  };
}

function standing(teamId: string, points: number, played = 10): StandingEntry {
  return {
    teamId, played, won: 5, drawn: 2, lost: 3, goalsFor: 15, goalsAgainst: 10,
    goalDifference: 5, points, form: ['W', 'D', 'W'],
  };
}

function record(overrides: Partial<SeasonRecord>): SeasonRecord {
  return {
    seasonNumber: 1, leagueLevel: 2, leaguePosition: 1, leaguePlayed: 14,
    leagueWon: 10, leagueDrawn: 2, leagueLost: 2, leagueGF: 30, leagueGA: 12,
    leaguePoints: 32, coachId: 'coach', promoted: true, relegated: false,
    ...overrides,
  };
}

function world(params: {
  team: TeamBase;
  teamState?: TeamState;
  rank: number;
  season?: number;
  history?: SeasonRecord[];
}): GameWorld {
  const table = Array.from({ length: 8 }, (_, index) => standing(
    index === params.rank - 1 ? params.team.id : `other-${index}`,
    30 - index * 2,
  ));
  return {
    seasonState: { seasonNumber: params.season ?? 1, currentWindowIndex: 10, calendar: [], completed: false, isWorldCupYear: false, worldCupPhase: false },
    teamBases: { [params.team.id]: params.team },
    teamStates: { [params.team.id]: params.teamState ?? state(params.team.id) },
    league1Standings: table,
    league2Standings: [],
    league3Standings: [],
    teamSeasonRecords: { [params.team.id]: params.history ?? [] },
  } as unknown as GameWorld;
}

describe('evidence-grounded storyline cards', () => {
  it('detects an underdog materially outperforming its expected position', () => {
    const game = world({ team: team('dark', 2), rank: 1 });
    const card = generateStorylineCards(game, ['dark']).find(item => item.scope === 'focus');

    expect(card).toMatchObject({ type: 'dark_horse', teamId: 'dark' });
    expect(card?.body).toContain('排名提升');
    expect(card?.evidence).toContain('联赛第1/8');
  });

  it('describes a points tie with the leader without showing a zero-point gap', () => {
    const game = world({ team: team('dark', 2), rank: 2 });
    game.league1Standings[1].points = game.league1Standings[0].points;
    const card = generateStorylineCards(game, ['dark']).find(item => item.scope === 'focus');

    expect(card?.nextWatch).toBe('与榜首同分');
  });

  it('describes a giant crisis as ranking deviation without inventing off-field causes', () => {
    const game = world({ team: team('giant', 5), teamState: state('giant', 70), rank: 7 });
    const card = generateStorylineCards(game, ['giant']).find(item => item.scope === 'focus');

    expect(card).toMatchObject({ type: 'giant_crisis', teamId: 'giant' });
    expect(card?.body).toContain('不预设任何场外原因');
    expect(card?.evidence).toContain('教练压力 70');
  });

  it('recognizes a promoted side only from the immediately previous season record', () => {
    const promoted = team('promoted', 3);
    const game = world({
      team: promoted,
      rank: 7,
      season: 2,
      history: [record({ seasonNumber: 1, promoted: true })],
    });
    const card = generateStorylineCards(game, ['promoted']).find(item => item.type === 'promoted_survival');

    expect(card).toBeDefined();
    expect(card?.evidence[0]).toBe('上赛季升级');
    expect(generateStorylineCards({ ...game, seasonState: { ...game.seasonState, seasonNumber: 3 } }, ['promoted'])
      .some(item => item.type === 'promoted_survival')).toBe(false);
  });

  it('keeps at most one focus story and one separate world story', () => {
    const focus = team('focus', 2);
    const global = team('global', 5);
    const game = world({ team: focus, rank: 1 });
    game.teamBases[global.id] = global;
    game.teamStates[global.id] = state(global.id, 80);
    game.league1Standings[6] = standing(global.id, 18);

    const cards = generateStorylineCards(game, [focus.id]);
    expect(cards).toHaveLength(2);
    expect(cards.map(card => card.scope)).toEqual(['focus', 'world']);
  });
});
