import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../types/match';
import type { Player, PlayerPosition, PlayerSeasonStatsHistoryEntry } from '../../types/player';
import { emptyPlayerStat } from '../players/stats';
import { initializeGameWorld, type GameWorld } from '../season/season-manager';
import {
  buildCompetitionLandscapes,
  buildWorldNarrativeCandidates,
  WORLD_NARRATIVE_CAPS,
} from './narrative-world-scan';

function playerAt(world: GameWorld, position: PlayerPosition, offset = 0): Player {
  return Object.values(world.squads).flat().filter(player => player.position === position)[offset];
}

function setProductiveSeason(world: GameWorld, player: Player): void {
  const common = {
    appearances: 10,
    starts: 10,
    minutesPlayed: 900,
    teamMatchesAllCompetitions: 10,
  };
  const positional = player.position === 'GK'
    ? { routineSaves: 32, saves: 3, shotsOnTargetFaced: 45, cleanSheetMinutes: 360, goalsConcededWhileOnPitch: 10 }
    : player.position === 'DF'
      ? { interceptions: 23, clearances: 31, keyBlocks: 1, cleanSheetMinutes: 360, goalsConcededWhileOnPitch: 10, goals: 1, assists: 1 }
      : player.position === 'MF'
        ? { goals: 4, assists: 6, bigChances: 6, keyPasses: 12 }
        : { goals: 10, assists: 3, bigChances: 14, keyPasses: 5 };
  world.playerStats[player.uuid] = {
    ...emptyPlayerStat(player.uuid, player.teamId),
    ...common,
    ...positional,
  };
}

function historyRow(
  player: Pick<Player, 'uuid' | 'teamId' | 'name' | 'number' | 'position' | 'rating' | 'age'>,
  season: number,
  seasonScore: number,
  goals = 0,
): PlayerSeasonStatsHistoryEntry {
  return {
    season,
    teamId: player.teamId,
    teamName: player.teamId,
    playerName: player.name,
    playerNumber: player.number,
    position: player.position,
    rating: player.rating,
    age: player.age,
    goals,
    assists: 0,
    appearances: 10,
    starts: 10,
    minutesPlayed: 900,
    yellowCards: 0,
    redCards: 0,
    teamGoalsConceded: 20,
    teamMatches: 10,
    teamMatchesAllCompetitions: 10,
    seasonScore,
    scoreConfidence: 0.5,
  };
}

function scan(world: GameWorld, favoriteTeamIds: string[] = [], favoritePlayerIds: string[] = []) {
  return buildWorldNarrativeCandidates({
    world,
    currentWindow: world.seasonState.calendar[world.seasonState.currentWindowIndex],
    favoriteTeamIds,
    favoritePlayerIds,
  });
}

function result(teamId: string, opponentId: string, won: boolean, fixtureId: string): MatchResult {
  return {
    fixtureId,
    homeTeamId: teamId,
    awayTeamId: opponentId,
    homeGoals: won ? 1 : 0,
    awayGoals: won ? 0 : 1,
    extraTime: false,
    penalties: false,
    events: [],
    stats: {
      possession: [50, 50],
      shots: [8, 8],
      shotsOnTarget: [3, 3],
      corners: [3, 3],
      fouls: [8, 8],
      yellowCards: [1, 1],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '顶级联赛',
    roundLabel: fixtureId,
  };
}

describe('world narrative scan', () => {
  it('surfaces all four positions, applies watch relevance, stays bounded, and never mutates the world', () => {
    const world = initializeGameWorld(20260812);
    world.playerStatSegments = undefined;
    const players = (['GK', 'DF', 'MF', 'FW'] as PlayerPosition[]).map(position => playerAt(world, position));
    players.forEach(player => setProductiveSeason(world, player));
    const watched = players[3];
    const before = structuredClone(world);

    const candidates = scan(world, [], [watched.uuid]);
    const leaders = candidates.filter(candidate => candidate.id.startsWith('player-leader:'));

    expect(leaders.map(candidate => candidate.title.split('标杆')[0])).toEqual(
      expect.arrayContaining(['门将', '后卫', '中场', '前锋']),
    );
    expect(leaders.find(candidate => candidate.subjectIds.includes(watched.uuid))?.weights.relevance).toBe(72);
    expect(candidates.filter(candidate => candidate.source === 'player_story').length).toBeLessThanOrEqual(WORLD_NARRATIVE_CAPS.player);
    expect(candidates.length).toBeLessThanOrEqual(WORLD_NARRATIVE_CAPS.total);
    expect(JSON.stringify(candidates)).not.toContain('peakRating');
    expect(world).toEqual(before);
  });

  it('requires a current injury of at least six match windows', () => {
    const world = initializeGameWorld(20260813);
    const shortInjury = playerAt(world, 'DF');
    const majorInjury = playerAt(world, 'GK');
    shortInjury.injuryHistory = [{ type: 'moderate', startSeason: 1, startWindow: 1, durationMatches: 5, reason: '脚踝扭伤' }];
    shortInjury.injuredUntilWindow = 20;
    majorInjury.injuryHistory = [{ type: 'major', startSeason: 1, startWindow: 2, durationMatches: 6, reason: '膝伤' }];
    majorInjury.injuredUntilWindow = 20;

    const injuries = scan(world).filter(candidate => candidate.id.startsWith('player-injury:'));

    expect(injuries).toHaveLength(1);
    expect(injuries[0].subjectIds).toContain(majorInjury.uuid);
    expect(injuries[0].subjectIds).not.toContain(shortInjury.uuid);
  });

  it('requires structured hiring evidence and three matches on each side before declaring a turnaround', () => {
    const world = initializeGameWorld(20260814);
    const [teamId, opponentId] = Object.keys(world.teamBases);
    const [oldCoachId, newCoachId] = Object.keys(world.coachBases);
    world.coachChangesThisSeason = [{ teamId, oldCoachId, newCoachId, reason: '战绩不佳' }];
    world.seasonState.calendar = Array.from({ length: 7 }, (_, index) => ({
      id: index,
      type: 'league' as const,
      label: `第${index + 1}轮`,
      description: '测试赛程',
      fixtures: [],
      completed: true,
      results: [result(teamId, opponentId, index >= 4, `coach-sample-${index}`)],
    }));
    world.seasonState.currentWindowIndex = 6;
    world.newsLog = [{
      id: 'coach-hired',
      seasonNumber: 1,
      windowIndex: 3,
      type: 'coach_hired',
      importance: 'major',
      subject: { teamIds: [teamId], coachIds: [newCoachId] },
      title: '新帅上任',
      description: '结构化换帅事实',
    }];

    expect(scan(world).some(candidate => candidate.id.startsWith('coach-turnaround:'))).toBe(true);

    const unstructured = structuredClone(world);
    unstructured.newsLog[0].subject = undefined;
    expect(scan(unstructured).some(candidate => candidate.id.startsWith('coach-turnaround:'))).toBe(false);

    world.teamStates[teamId].coachPressure = 64;
    expect(scan(world).some(candidate => candidate.id.startsWith('coach-pressure:') && candidate.subjectIds.includes(teamId))).toBe(false);
    world.teamStates[teamId].coachPressure = 65;
    expect(scan(world).some(candidate => candidate.id.startsWith('coach-pressure:') && candidate.subjectIds.includes(teamId))).toBe(true);
  });

  it('uses only the destination-club segment for post-transfer resurgence', () => {
    const world = initializeGameWorld(20260815);
    const player = playerAt(world, 'FW');
    const fromTeamId = Object.keys(world.teamBases).find(teamId => teamId !== player.teamId)!;
    world.seasonState.seasonNumber = 2;
    world.transferHistory = [{
      season: 2,
      windowIndex: 0,
      playerId: player.uuid,
      playerName: player.name,
      playerNumber: player.number,
      position: player.position,
      fromTeamId,
      fromTeamName: world.teamBases[fromTeamId].name,
      toTeamId: player.teamId,
      toTeamName: world.teamBases[player.teamId].name,
      type: 'transfer',
      fee: 42,
      reason: '核心补强',
    }];
    world.playerStatsHistory[player.uuid] = [historyRow(player, 1, 55)];
    const strongOldClub = {
      ...emptyPlayerStat(player.uuid, fromTeamId),
      appearances: 10,
      starts: 10,
      minutesPlayed: 900,
      teamMatchesAllCompetitions: 10,
      goals: 15,
      assists: 5,
      bigChances: 20,
      keyPasses: 8,
    };
    const quietNewClub = {
      ...emptyPlayerStat(player.uuid, player.teamId),
      appearances: 5,
      starts: 5,
      minutesPlayed: 450,
      teamMatchesAllCompetitions: 5,
    };
    world.playerStatSegments = { old: strongOldClub, destination: quietNewClub };
    world.playerStats[player.uuid] = {
      ...strongOldClub,
      teamId: player.teamId,
      appearances: 15,
      starts: 15,
      minutesPlayed: 1_350,
      teamMatchesAllCompetitions: 15,
    };

    expect(scan(world).some(candidate => candidate.id.startsWith('transfer-complete:'))).toBe(true);
    expect(scan(world).some(candidate => candidate.id.startsWith('transfer-resurgence:'))).toBe(false);

    world.playerStatSegments.destination = {
      ...quietNewClub,
      appearances: 10,
      starts: 10,
      minutesPlayed: 900,
      teamMatchesAllCompetitions: 10,
      goals: 15,
      assists: 5,
      bigChances: 20,
      keyPasses: 8,
    };
    expect(scan(world).some(candidate => candidate.id.startsWith('transfer-resurgence:'))).toBe(true);
  });

  it('derives title, promotion, relegation, final, continental, and World Cup signals from structured state', () => {
    const world = initializeGameWorld(20260816);
    for (const [index, row] of world.league1Standings.entries()) {
      Object.assign(row, { played: 20, points: 45 - index * 2 });
    }
    Object.assign(world.league1Standings[0], { points: 50 });
    Object.assign(world.league1Standings[1], { points: 49 });
    Object.assign(world.league1Standings[2], { points: 48 });
    const safeIndex = world.league1Standings.length - 3;
    Object.assign(world.league1Standings[safeIndex], { points: 19 });
    Object.assign(world.league1Standings[safeIndex + 1], { points: 18 });
    for (const [index, row] of world.league2Standings.entries()) {
      Object.assign(row, { played: 20, points: 44 - index * 2 });
    }
    Object.assign(world.league2Standings[1], { points: 40 });
    Object.assign(world.league2Standings[2], { points: 38 });

    const fixture = world.seasonState.calendar.flatMap(window => window.fixtures)[0];
    const finalWindow = {
      ...world.seasonState.calendar[world.seasonState.currentWindowIndex],
      fixtures: [{
        ...fixture,
        id: 'world-final',
        competitionType: 'world_cup' as const,
        competitionName: '世界杯',
        roundLabel: 'Final',
        isNeutralVenue: true,
      }],
    };
    world.seasonState.calendar[world.seasonState.currentWindowIndex] = finalWindow;

    const landscapes = buildCompetitionLandscapes(world);
    const candidates = scan(world);
    expect(landscapes.map(item => item.kind)).toEqual(expect.arrayContaining(['title', 'promotion', 'relegation']));
    expect(candidates).toContainEqual(expect.objectContaining({
      id: 'competition-fixture:world-final',
      source: 'competition',
      visualKind: 'stage',
    }));
  });

  it('only chases a canonical retained record and omits an unresolvable historical-player link', () => {
    const world = initializeGameWorld(20260817);
    const challenger = playerAt(world, 'FW');
    setProductiveSeason(world, challenger);
    world.playerStats[challenger.uuid].goals = 10;
    world.playerStatsHistory['pruned-holder'] = [historyRow({
      ...challenger,
      uuid: 'pruned-holder',
      name: '旧档射手',
    }, 0, 80, 12)];

    const record = scan(world).find(candidate => candidate.source === 'record');

    expect(record?.summary).toContain('还差2球');
    expect(record?.destinations).toEqual([
      expect.objectContaining({ to: `/player/${challenger.uuid}` }),
    ]);
    world.playerStats[challenger.uuid].goals = 8;
    expect(scan(world).some(candidate => candidate.source === 'record')).toBe(false);
  });
});
