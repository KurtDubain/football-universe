import { describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../season/season-manager';
import { validateWorldData } from './world-data';
import { pickMatchday } from '../players/injuries';
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
          minute: 55,
          type: 'assist',
          teamId: homeTeamId,
          playerId: awayForward.uuid,
          description: 'Away player incorrectly credited to the home team.',
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
    expect(codes).toContain('event_player_team_mismatch');
  });

  it('reports match events for players injured before the match window', () => {
    const world = initializeGameWorld(2024);
    const [homeTeamId, awayTeamId] = Object.keys(world.teamBases);
    const homeForward = world.squads[homeTeamId].find((p) => p.position === 'FW') ?? world.squads[homeTeamId][0];
    const injuredForward = {
      ...homeForward,
      injuredUntilWindow: 4,
      injuryHistory: [
        {
          type: 'major' as const,
          startSeason: 1,
          startWindow: 0,
          durationMatches: 3,
          reason: '膝伤',
        },
      ],
    };
    const result: MatchResult = {
      fixtureId: 'unavailable-player-fixture',
      homeTeamId,
      awayTeamId,
      homeGoals: 1,
      awayGoals: 0,
      extraTime: false,
      penalties: false,
      events: [
        {
          minute: 31,
          type: 'goal',
          teamId: homeTeamId,
          playerId: homeForward.uuid,
          description: 'Injured player is incorrectly credited with a goal.',
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
      totalElapsedWindows: 1,
      squads: {
        ...world.squads,
        [homeTeamId]: world.squads[homeTeamId].map((player) =>
          player.uuid === homeForward.uuid ? injuredForward : player,
        ),
      },
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

    expect(validation.errors).toHaveLength(0);
    expect(issueCodes(validation)).toContain('event_player_unavailable');
  });

  it('reports event players that are not in the fixture matchday squad', () => {
    const world = initializeGameWorld(2024);
    const [homeTeamId, awayTeamId] = Object.keys(world.teamBases);
    const homeMatchday = pickMatchday(world.squads[homeTeamId], 1) ?? [];
    const awayMatchday = pickMatchday(world.squads[awayTeamId], 1) ?? [];
    const homeMatchdayIds = new Set(homeMatchday.map((player) => player.uuid));
    const awayMatchdayIds = new Set(awayMatchday.map((player) => player.uuid));
    const homeBenchPlayer = world.squads[homeTeamId].find((player) => !homeMatchdayIds.has(player.uuid))!;
    const awayBenchPlayer = world.squads[awayTeamId].find((player) => !awayMatchdayIds.has(player.uuid))!;
    const homeKeeper = homeMatchday.find((player) => player.position === 'GK') ?? homeMatchday[0];
    const result: MatchResult = {
      fixtureId: 'matchday-audit-fixture',
      homeTeamId,
      awayTeamId,
      homeGoals: 1,
      awayGoals: 0,
      extraTime: false,
      penalties: false,
      events: [
        {
          minute: 24,
          type: 'goal',
          teamId: homeTeamId,
          playerId: homeBenchPlayer.uuid,
          description: 'Bench player is incorrectly credited with a goal.',
        },
        {
          minute: 64,
          type: 'gk_save',
          teamId: homeTeamId,
          playerId: homeKeeper.uuid,
          deniedScorerId: awayBenchPlayer.uuid,
          description: 'Bench attacker is incorrectly credited with a denied goal.',
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
      totalElapsedWindows: 1,
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

    expect(validation.errors).toHaveLength(0);
    expect(codes).toContain('event_player_not_in_matchday');
    expect(codes).toContain('event_denied_player_not_in_matchday');
  });

  it('reports player stat counters that drift from completed match events', () => {
    const world = initializeGameWorld(2024);
    const [homeTeamId, awayTeamId] = Object.keys(world.teamBases);
    const homeMatchday = pickMatchday(world.squads[homeTeamId], 1) ?? [];
    const awayMatchday = pickMatchday(world.squads[awayTeamId], 1) ?? [];
    const scorer = homeMatchday.find((player) => player.position === 'FW') ?? homeMatchday[0];
    const assister = homeMatchday.find((player) => player.position === 'MF' && player.uuid !== scorer.uuid)
      ?? homeMatchday.find((player) => player.uuid !== scorer.uuid)
      ?? scorer;
    const awayKeeper = awayMatchday.find((player) => player.position === 'GK') ?? awayMatchday[0];
    const awayDefender = awayMatchday.find((player) => player.position === 'DF' && player.uuid !== awayKeeper.uuid)
      ?? awayMatchday.find((player) => player.uuid !== awayKeeper.uuid)
      ?? awayKeeper;
    const result: MatchResult = {
      fixtureId: 'event-stat-audit-fixture',
      homeTeamId,
      awayTeamId,
      homeGoals: 1,
      awayGoals: 0,
      extraTime: false,
      penalties: false,
      events: [
        {
          minute: 18,
          type: 'goal',
          teamId: homeTeamId,
          playerId: scorer.uuid,
          description: 'Goal should update scorer totals.',
        },
        {
          minute: 18,
          type: 'assist',
          teamId: homeTeamId,
          playerId: assister.uuid,
          description: 'Assist should update creator totals.',
        },
        {
          minute: 41,
          type: 'gk_save',
          teamId: awayTeamId,
          playerId: awayKeeper.uuid,
          deniedScorerId: scorer.uuid,
          deniedAssisterId: assister.uuid,
          description: 'Denied chance should update keeper and attackers.',
        },
        {
          minute: 73,
          type: 'df_block',
          teamId: awayTeamId,
          playerId: awayDefender.uuid,
          deniedScorerId: scorer.uuid,
          description: 'Block should update defender and attacker.',
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
      totalElapsedWindows: 1,
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

    expect(validation.errors).toHaveLength(0);
    expect(codes).toContain('player_stat_event_mismatch');
    expect(codes).toContain('player_segment_event_mismatch');
  });

  it('reports transfer history, finance, news, and roster-state inconsistencies', () => {
    const world = initializeGameWorld(2024);
    const [homeTeamId, awayTeamId] = Object.keys(world.teamBases);
    const player = world.squads[homeTeamId][0];
    const financeHistory = {
      season: 1,
      startCash: 100,
      endCash: 100,
      prizeMoney: 0,
      tvSponsor: 0,
      transferIncome: 0,
      salaries: 0,
      transferExpense: 0,
    };

    const validation = validateWorldData({
      ...world,
      freeAgentPool: [player],
      transferHistory: [
        {
          season: 1,
          windowIndex: 5,
          playerId: player.uuid,
          playerName: player.name,
          playerNumber: player.number,
          position: player.position,
          fromTeamId: homeTeamId,
          fromTeamName: world.teamBases[homeTeamId].name,
          toTeamId: awayTeamId,
          toTeamName: world.teamBases[awayTeamId].name,
          type: 'transfer',
          fee: 20,
          reason: '测试转会记录',
        },
      ],
      teamFinances: {
        ...world.teamFinances,
        [homeTeamId]: {
          ...world.teamFinances[homeTeamId],
          history: [financeHistory],
        },
        [awayTeamId]: {
          ...world.teamFinances[awayTeamId],
          history: [financeHistory],
        },
      },
      newsLog: [
        {
          id: `manual-transfer:S1:W5:missing-player:${awayTeamId}`,
          seasonNumber: 1,
          windowIndex: 5,
          type: 'trophy',
          title: '孤立转会新闻',
          description: '这条新闻没有对应的转会记录。',
        },
      ],
    });
    const codes = issueCodes(validation);

    expect(codes).toContain('free_agent_active_overlap');
    expect(codes).toContain('transfer_latest_squad_mismatch');
    expect(codes).toContain('transfer_finance_history_mismatch');
    expect(codes).toContain('transfer_news_history_mismatch');
  });
});
