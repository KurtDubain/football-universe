import { describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../season/season-manager';
import { validateWorldData } from './world-data';
import type { MatchResult } from '../../types/match';
import type { PlayerSeasonStats } from '../../types/player';

function issueCodes(result: ReturnType<typeof validateWorldData>): string[] {
  return result.issues.map((issue) => issue.code);
}

function firstPlayerFixture() {
  const world = initializeGameWorld(2024);
  const [teamId, squad] = Object.entries(world.squads)[0];
  const player = squad[0];
  return { world, teamId, player };
}

function makeResult(homeTeamId: string, awayTeamId: string): MatchResult {
  return {
    fixtureId: 'audit-fixture',
    homeTeamId,
    awayTeamId,
    homeGoals: 2,
    awayGoals: 0,
    extraTime: false,
    penalties: false,
    events: [
      {
        minute: 10,
        type: 'goal',
        teamId: homeTeamId,
        playerId: 'missing-player',
        description: 'Goal with an unknown player.',
      },
      {
        minute: 20,
        type: 'miss',
        teamId: 'missing-team',
        description: 'Event with an unknown team.',
      },
    ],
    stats: {
      possession: [50, 50],
      shots: [1, 1],
      shotsOnTarget: [1, 1],
      corners: [0, 0],
      fouls: [0, 0],
      yellowCards: [0, 0],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: 'Audit League',
    roundLabel: 'R1',
  };
}

describe('validateWorldData', () => {
  it('accepts a freshly initialized world', () => {
    const world = initializeGameWorld(2024);
    const result = validateWorldData(world);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('reports active players with missing playerStats rows', () => {
    const { world, player } = firstPlayerFixture();
    const playerStats = { ...world.playerStats };
    delete playerStats[player.uuid];

    const result = validateWorldData({ ...world, playerStats });

    expect(result.isValid).toBe(false);
    expect(issueCodes(result)).toContain('missing_player_stats');
  });

  it('reports playerStats team drift and unknown team references', () => {
    const { world, player } = firstPlayerFixture();
    const playerStats: Record<string, PlayerSeasonStats> = {
      ...world.playerStats,
      [player.uuid]: {
        ...world.playerStats[player.uuid],
        teamId: 'missing_team',
      },
    };

    const result = validateWorldData({ ...world, playerStats });

    expect(result.isValid).toBe(false);
    expect(issueCodes(result)).toContain('player_stat_unknown_team');
    expect(issueCodes(result)).toContain('player_stat_team_mismatch');
  });

  it('reports orphan playerStats rows as warnings', () => {
    const { world, teamId, player } = firstPlayerFixture();
    const playerStats: Record<string, PlayerSeasonStats> = {
      ...world.playerStats,
      'ghost-player': {
        ...world.playerStats[player.uuid],
        playerId: 'ghost-player',
        teamId,
      },
    };

    const result = validateWorldData({ ...world, playerStats });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(issueCodes(result)).toContain('orphan_player_stats');
  });

  it('reports impossible stat aggregates', () => {
    const { world, player } = firstPlayerFixture();
    const playerStats: Record<string, PlayerSeasonStats> = {
      ...world.playerStats,
      [player.uuid]: {
        ...world.playerStats[player.uuid],
        appearances: 1,
        cleanSheets: 2,
        goals: 3,
        bigChances: 2,
        assists: 2,
        keyPasses: 1,
      },
    };

    const result = validateWorldData({ ...world, playerStats });
    const codes = issueCodes(result);

    expect(result.isValid).toBe(false);
    expect(codes).toContain('clean_sheets_exceed_appearances');
    expect(codes).toContain('big_chances_below_goals');
    expect(codes).toContain('key_passes_below_assists');
  });

  it('reports scoreline mismatches and invalid event references', () => {
    const world = initializeGameWorld(2024);
    const [homeTeamId, awayTeamId] = Object.keys(world.teamBases);
    const result = makeResult(homeTeamId, awayTeamId);
    const calendar = [
      {
        ...world.seasonState.calendar[0],
        completed: true,
        results: [result],
      },
      ...world.seasonState.calendar.slice(1),
    ];

    const validation = validateWorldData({
      ...world,
      seasonState: {
        ...world.seasonState,
        calendar,
      },
    });
    const codes = issueCodes(validation);

    expect(validation.isValid).toBe(false);
    expect(codes).toContain('scoreline_event_mismatch');
    expect(codes).toContain('event_unknown_player');
    expect(codes).toContain('event_unknown_team');
  });

  it('reports invalid event semantics and implausible defensive positions', () => {
    const world = initializeGameWorld(2024);
    const [homeTeamId, awayTeamId, unrelatedTeamId] = Object.keys(world.teamBases);
    const homeForward = world.squads[homeTeamId].find((p) => p.position === 'FW') ?? world.squads[homeTeamId][0];
    const awayForward = world.squads[awayTeamId].find((p) => p.position === 'FW') ?? world.squads[awayTeamId][0];
    const result: MatchResult = {
      fixtureId: 'semantic-audit-fixture',
      homeTeamId,
      awayTeamId,
      homeGoals: 0,
      awayGoals: 0,
      extraTime: false,
      penalties: false,
      events: [
        {
          minute: 90,
          type: 'penalty_goal',
          teamId: homeTeamId,
          playerId: homeForward.uuid,
          description: 'Malformed regular-time shootout goal.',
        },
        {
          minute: 121,
          type: 'goal',
          teamId: homeTeamId,
          playerId: homeForward.uuid,
          description: 'Goal after match time.',
        },
        {
          minute: 40,
          type: 'gk_save',
          teamId: homeTeamId,
          playerId: homeForward.uuid,
          deniedScorerId: awayForward.uuid,
          description: 'Forward somehow makes a goalkeeper save.',
        },
        {
          minute: 50,
          type: 'df_block',
          teamId: homeTeamId,
          playerId: homeForward.uuid,
          deniedScorerId: awayForward.uuid,
          description: 'Forward somehow makes a defender block.',
        },
        {
          minute: 60,
          type: 'miss',
          teamId: unrelatedTeamId,
          description: 'Event assigned to a non-participant team.',
        },
      ],
      stats: {
        possession: [50, 50],
        shots: [1, 1],
        shotsOnTarget: [1, 1],
        corners: [0, 0],
        fouls: [0, 0],
        yellowCards: [0, 0],
        redCards: [0, 0],
      },
      competitionType: 'league',
      competitionName: 'Audit League',
      roundLabel: 'R1',
    };

    const validation = validateWorldData({
      ...world,
      seasonState: {
        ...world.seasonState,
        calendar: [
          {
            ...world.seasonState.calendar[0],
            completed: true,
            results: [result],
          },
          ...world.seasonState.calendar.slice(1),
        ],
      },
    });
    const codes = issueCodes(validation);

    expect(validation.isValid).toBe(false);
    expect(codes).toContain('shootout_event_inside_match_time');
    expect(codes).toContain('regular_event_after_match_time');
    expect(codes).toContain('invalid_goalkeeper_event_position');
    expect(codes).toContain('invalid_defender_event_position');
    expect(codes).toContain('event_team_not_in_fixture');
  });
});
