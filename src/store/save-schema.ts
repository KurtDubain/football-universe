import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';
import type { GameWorld } from '../engine/season/season-manager';
import { parseCustomTeams } from '../engine/validation/custom-teams';
import { isNeutralVenueFixture } from '../engine/competitions/venue-policy';
import { compressedStorage, queueCompressedJSONValue } from './compressed-storage';
import { SAVE_DIAGNOSTIC_KEY, SAVE_SCHEMA_VERSION } from './save-constants';

export { SAVE_DIAGNOSTIC_KEY, SAVE_SCHEMA_VERSION, SAVE_STORAGE_KEY } from './save-constants';

type JsonRecord = Record<string, unknown>;
const OBSERVATION_THEME_PREFERENCES = new Set([
  'auto',
  'disabled',
  'giant_defense',
  'dark_horse_challenge',
  'promotion_survival',
  'player_growth',
  'pure_observation',
]);
const COMPETITION_TYPES = new Set([
  'league',
  'league_cup',
  'super_cup',
  'super_cup_group',
  'world_cup',
  'world_cup_group',
  'continental_cup',
  'relegation_playoff',
]);
const OBSERVATION_THEME_TYPES = new Set([
  'giant_defense',
  'dark_horse_challenge',
  'promotion_survival',
  'player_growth',
  'pure_observation',
]);
const OBSERVER_PHASES = new Set(['opening', 'midseason', 'run_in', 'final']);
const DESTINY_DEVIATION_TIERS = new Set(['normal', 'minor', 'upset', 'major_upset']);

export interface CurrentSaveEnvelope {
  version: typeof SAVE_SCHEMA_VERSION;
  state: JsonRecord & {
    initialized: true;
    world: GameWorld;
  };
}

export interface SaveRecoveryDiagnostic {
  recoveredAt: string;
  reason: string;
  payload: string;
}

let latestRecovery: SaveRecoveryDiagnostic | null = null;
let recoveryMessagePending = false;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(parent: JsonRecord, key: string): JsonRecord {
  const value = parent[key];
  if (!isRecord(value)) throw new Error(`存档缺少当前版本所需字段：${key}`);
  return value;
}

function requireArray(parent: JsonRecord, key: string): unknown[] {
  const value = parent[key];
  if (!Array.isArray(value)) throw new Error(`存档缺少当前版本所需字段：${key}`);
  return value;
}

function requireString(parent: JsonRecord, key: string, context: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${context}字段 ${key} 无效`);
  return value;
}

function requireBoolean(parent: JsonRecord, key: string, context: string): boolean {
  const value = parent[key];
  if (typeof value !== 'boolean') throw new Error(`${context}字段 ${key} 无效`);
  return value;
}

function requireFiniteNumber(parent: JsonRecord, key: string, context: string): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${context}字段 ${key} 无效`);
  return value;
}

const REQUIRED_WORLD_RECORDS = [
  'teamBases',
  'teamStates',
  'coachBases',
  'coachStates',
  'coachCareers',
  'teamTrophies',
  'coachTrophies',
  'teamSeasonRecords',
  'squads',
  'playerStats',
  'seasonStartLevels',
  'playerStatsHistory',
  'teamFinances',
] as const;

const REQUIRED_WORLD_ARRAYS = [
  'league1Standings',
  'league2Standings',
  'league3Standings',
  'honorHistory',
  'coachChangesThisSeason',
  'retirementHistory',
  'freeAgentPool',
  'transferRumors',
  'coachCandidatePool',
  'coachRetirementHistory',
  'activeEvents',
  'achievements',
  'newsLog',
  'seasonBuffs',
  'matchHistory',
  'seasonBuffsHistory',
  'playerAwardsHistory',
  'transferHistory',
  'memorableMatches',
  'observerSeasonTrajectories',
] as const;

const PLAYER_NUMBER_FIELDS = [
  'number',
  'rating',
  'peakRating',
  'peakAge',
  'goalScoring',
  'age',
  'marketValue',
] as const;

const PLAYER_STAT_NUMBER_FIELDS = [
  'goals',
  'assists',
  'yellowCards',
  'redCards',
  'appearances',
  'cleanSheets',
  'saves',
  'keyBlocks',
  'bigChances',
  'keyPasses',
] as const;

const OPTIONAL_PLAYER_STAT_NUMBER_FIELDS = [
  'starts',
  'substituteAppearances',
  'minutesPlayed',
  'routineSaves',
  'shotsOnTargetFaced',
  'cleanSheetMinutes',
  'goalsConcededWhileOnPitch',
  'interceptions',
  'clearances',
] as const;

function validateOptionalNonNegativeNumbers(value: JsonRecord, context: string): void {
  for (const key of OPTIONAL_PLAYER_STAT_NUMBER_FIELDS) {
    if (value[key] === undefined) continue;
    const field = requireFiniteNumber(value, key, context);
    if (field < 0) throw new Error(`${context}字段 ${key} 不能为负数`);
  }
}

function validateCalendarWindow(value: unknown, index: number, teamIds: Set<string>): void {
  if (!isRecord(value)) throw new Error(`存档赛程窗口 ${index + 1} 无效`);
  requireFiniteNumber(value, 'id', `存档赛程窗口 ${index + 1} `);
  requireString(value, 'type', `存档赛程窗口 ${index + 1} `);
  requireString(value, 'label', `存档赛程窗口 ${index + 1} `);
  requireString(value, 'description', `存档赛程窗口 ${index + 1} `);
  requireBoolean(value, 'completed', `存档赛程窗口 ${index + 1} `);

  const fixtures = requireArray(value, 'fixtures');
  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    if (!isRecord(fixture)) throw new Error(`存档赛程窗口 ${index + 1} 的比赛 ${fixtureIndex + 1} 无效`);
    requireString(fixture, 'id', '存档比赛 ');
    const homeTeamId = requireString(fixture, 'homeTeamId', '存档比赛 ');
    const awayTeamId = requireString(fixture, 'awayTeamId', '存档比赛 ');
    const competitionType = requireString(fixture, 'competitionType', '存档比赛 ');
    if (!COMPETITION_TYPES.has(competitionType)) throw new Error(`存档比赛 ${fixture.id as string} 的赛事类型无效`);
    requireString(fixture, 'competitionName', '存档比赛 ');
    const roundLabel = requireString(fixture, 'roundLabel', '存档比赛 ');
    if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId) || homeTeamId === awayTeamId) {
      throw new Error(`存档比赛 ${fixture.id as string} 引用了无效球队`);
    }
    const expectedNeutral = isNeutralVenueFixture({
      competitionType: competitionType as GameWorld['seasonState']['calendar'][number]['fixtures'][number]['competitionType'],
      roundLabel,
    });
    if (expectedNeutral && fixture.isNeutralVenue !== true) {
      throw new Error(`存档比赛 ${fixture.id as string} 缺少中立场标记`);
    }
    if (!expectedNeutral && fixture.isNeutralVenue === true) {
      throw new Error(`存档比赛 ${fixture.id as string} 的场地标记与赛事规则不一致`);
    }
  }

  const results = requireArray(value, 'results');
  for (const [resultIndex, result] of results.entries()) {
    if (!isRecord(result)) throw new Error(`存档赛果 ${resultIndex + 1} 无效`);
    requireString(result, 'fixtureId', '存档赛果 ');
    const homeTeamId = requireString(result, 'homeTeamId', '存档赛果 ');
    const awayTeamId = requireString(result, 'awayTeamId', '存档赛果 ');
    requireFiniteNumber(result, 'homeGoals', '存档赛果 ');
    requireFiniteNumber(result, 'awayGoals', '存档赛果 ');
    requireBoolean(result, 'extraTime', '存档赛果 ');
    requireBoolean(result, 'penalties', '存档赛果 ');
    requireArray(result, 'events');
    requireRecord(result, 'stats');
    if (result.defensiveContributions !== undefined) {
      if (!isRecord(result.defensiveContributions)) {
        throw new Error(`存档赛果 ${result.fixtureId as string} 的防守贡献无效`);
      }
      for (const [playerId, contribution] of Object.entries(result.defensiveContributions)) {
        if (!isRecord(contribution) || contribution.playerId !== playerId) {
          throw new Error(`存档赛果 ${result.fixtureId as string} 的防守贡献球员无效`);
        }
        requireString(contribution, 'teamId', `球员 ${playerId} 防守贡献 `);
        for (const field of ['interceptions', 'clearances']) {
          const amount = requireFiniteNumber(contribution, field, `球员 ${playerId} 防守贡献 `);
          if (amount < 0) throw new Error(`球员 ${playerId} 防守贡献字段 ${field} 不能为负数`);
        }
        validateOptionalNonNegativeNumbers(contribution, `球员 ${playerId} 防守贡献 `);
      }
    }
    if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId)) {
      throw new Error(`存档赛果 ${result.fixtureId as string} 引用了无效球队`);
    }
    const competitionType = requireString(result, 'competitionType', '存档赛果 ');
    if (!COMPETITION_TYPES.has(competitionType)) throw new Error(`存档赛果 ${result.fixtureId as string} 的赛事类型无效`);
    const roundLabel = requireString(result, 'roundLabel', '存档赛果 ');
    const expectedNeutral = isNeutralVenueFixture({
      competitionType: competitionType as GameWorld['seasonState']['calendar'][number]['fixtures'][number]['competitionType'],
      roundLabel,
    });
    if (expectedNeutral && result.isNeutralVenue !== true) {
      throw new Error(`存档赛果 ${result.fixtureId as string} 缺少中立场标记`);
    }
    if (!expectedNeutral && result.isNeutralVenue === true) {
      throw new Error(`存档赛果 ${result.fixtureId as string} 的场地标记与赛事规则不一致`);
    }
  }
}

function validateCupFixtureVenue(
  value: unknown,
  context: string,
  teamIds: Set<string>,
  competitionType: 'league_cup' | 'super_cup' | 'world_cup' | 'continental_cup',
): JsonRecord {
  if (!isRecord(value)) throw new Error(`${context}对阵无效`);
  const id = requireString(value, 'id', `${context}对阵 `);
  const homeTeamId = requireString(value, 'homeTeamId', `${context}对阵 `);
  const awayTeamId = requireString(value, 'awayTeamId', `${context}对阵 `);
  requireFiniteNumber(value, 'round', `${context}对阵 `);
  requireString(value, 'roundName', `${context}对阵 `);
  if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId) || homeTeamId === awayTeamId) {
    throw new Error(`${context}对阵 ${id} 引用了无效球队`);
  }
  const expectedNeutral = isNeutralVenueFixture({
    competitionType,
    roundLabel: value.roundName as string,
  });
  if (expectedNeutral && value.isNeutralVenue !== true) {
    throw new Error(`${context}对阵 ${id} 缺少中立场标记`);
  }
  if (!expectedNeutral && value.isNeutralVenue === true) {
    throw new Error(`${context}对阵 ${id} 的场地标记与赛事规则不一致`);
  }
  if (value.result !== undefined && !isRecord(value.result)) throw new Error(`${context}对阵 ${id} 的赛果无效`);
  return value;
}

function validateNeutralGroup(
  value: unknown,
  context: string,
  expectedTeams: number,
  teamIds: Set<string>,
  competitionType: 'world_cup' | 'continental_cup',
): string[] {
  if (!isRecord(value)) throw new Error(`${context}小组无效`);
  requireString(value, 'groupName', `${context}小组 `);
  const groupTeamIds = requireArray(value, 'teamIds').map((teamId) => {
    if (typeof teamId !== 'string' || !teamIds.has(teamId)) throw new Error(`${context}小组引用了无效球队`);
    return teamId;
  });
  if (groupTeamIds.length !== expectedTeams || new Set(groupTeamIds).size !== expectedTeams) {
    throw new Error(`${context}小组球队数量无效`);
  }
  const standings = requireArray(value, 'standings');
  if (standings.length !== expectedTeams) throw new Error(`${context}小组积分榜数量无效`);
  const standingIds = new Set(standings.map((entry) => {
    if (!isRecord(entry)) throw new Error(`${context}小组积分榜无效`);
    return requireString(entry, 'teamId', `${context}小组积分榜 `);
  }));
  if (standingIds.size !== expectedTeams || groupTeamIds.some(teamId => !standingIds.has(teamId))) {
    throw new Error(`${context}小组积分榜球队不一致`);
  }

  const fixtures = requireArray(value, 'fixtures');
  if (fixtures.length !== 6) throw new Error(`${context}小组必须包含 6 场单循环比赛`);
  const appearances = new Map(groupTeamIds.map(teamId => [teamId, 0]));
  const pairs = new Set<string>();
  const rounds = new Set<number>();
  for (const fixtureValue of fixtures) {
    const fixture = validateCupFixtureVenue(fixtureValue, context, teamIds, competitionType);
    const homeTeamId = fixture.homeTeamId as string;
    const awayTeamId = fixture.awayTeamId as string;
    if (!appearances.has(homeTeamId) || !appearances.has(awayTeamId)) {
      throw new Error(`${context}小组对阵包含组外球队`);
    }
    appearances.set(homeTeamId, appearances.get(homeTeamId)! + 1);
    appearances.set(awayTeamId, appearances.get(awayTeamId)! + 1);
    pairs.add([homeTeamId, awayTeamId].sort().join(':'));
    rounds.add(fixture.round as number);
  }
  if ([...appearances.values()].some(count => count !== 3) || pairs.size !== 6) {
    throw new Error(`${context}小组不是合法单循环赛程`);
  }
  if (rounds.size !== 3 || [...rounds].some(round => round < 1 || round > 3)) {
    throw new Error(`${context}小组轮次无效`);
  }
  return groupTeamIds;
}

function validateKnockoutRounds(
  value: unknown,
  context: string,
  teamIds: Set<string>,
  competitionType: 'league_cup' | 'super_cup' | 'world_cup' | 'continental_cup' = 'world_cup',
): void {
  if (!Array.isArray(value)) throw new Error(`${context}淘汰赛结构无效`);
  for (const [roundIndex, round] of value.entries()) {
    if (!isRecord(round)) throw new Error(`${context}淘汰赛第 ${roundIndex + 1} 轮无效`);
    requireFiniteNumber(round, 'roundNumber', `${context}淘汰赛 `);
    requireString(round, 'roundName', `${context}淘汰赛 `);
    requireBoolean(round, 'completed', `${context}淘汰赛 `);
    const fixtures = requireArray(round, 'fixtures');
    fixtures.forEach(fixture => validateCupFixtureVenue(
      fixture,
      context,
      teamIds,
      competitionType,
    ));
  }
}

function validateLeagueCup(value: JsonRecord, teamIds: Set<string>): void {
  if (value.type !== 'league_cup') throw new Error('联赛杯类型无效');
  requireBoolean(value, 'completed', '联赛杯 ');
  requireFiniteNumber(value, 'currentRound', '联赛杯 ');
  validateKnockoutRounds(value.rounds, '联赛杯', teamIds, 'league_cup');
}

function validateSuperCup(value: JsonRecord, teamIds: Set<string>): void {
  requireBoolean(value, 'groupStageCompleted', '超级杯 ');
  requireBoolean(value, 'completed', '超级杯 ');
  requireBoolean(value, 'awayGoalRule', '超级杯 ');
  const groups = requireArray(value, 'groups');
  for (const [groupIndex, group] of groups.entries()) {
    if (!isRecord(group)) throw new Error(`超级杯第 ${groupIndex + 1} 小组无效`);
    const groupTeamIds = requireArray(group, 'teamIds');
    if (
      groupTeamIds.length !== 4
      || new Set(groupTeamIds).size !== 4
      || groupTeamIds.some(teamId => typeof teamId !== 'string' || !teamIds.has(teamId))
    ) {
      throw new Error(`超级杯第 ${groupIndex + 1} 小组球队无效`);
    }
    requireArray(group, 'standings');
    const fixtures = requireArray(group, 'fixtures');
    fixtures.forEach(fixture => validateCupFixtureVenue(
      fixture,
      `超级杯第 ${groupIndex + 1} 小组`,
      teamIds,
      'super_cup',
    ));
  }
  validateKnockoutRounds(value.knockoutRounds, '超级杯', teamIds, 'super_cup');
}

function validateWorldCup(value: JsonRecord, teamIds: Set<string>): void {
  const participantIds = requireArray(value, 'participantIds');
  if (
    participantIds.length !== 32
    || new Set(participantIds).size !== 32
    || participantIds.some(teamId => typeof teamId !== 'string' || !teamIds.has(teamId))
  ) {
    throw new Error('世界杯参赛球队结构无效');
  }
  const groups = requireArray(value, 'groups');
  if (groups.length !== 8) throw new Error('世界杯必须包含 8 个小组');
  const grouped = groups.flatMap((group, index) =>
    validateNeutralGroup(group, `世界杯第 ${index + 1} `, 4, teamIds, 'world_cup'),
  );
  if (new Set(grouped).size !== 32) throw new Error('世界杯球队分组存在重复');
  requireBoolean(value, 'groupStageCompleted', '世界杯 ');
  requireBoolean(value, 'completed', '世界杯 ');
  validateKnockoutRounds(value.knockoutRounds, '世界杯', teamIds);
}

function validateContinentalCup(
  value: JsonRecord,
  expectedType: 'mainland_cup' | 'southern_cup' | 'eastern_cup',
  teamIds: Set<string>,
): void {
  if (value.type !== expectedType) throw new Error(`洲际杯类型无效：${expectedType}`);
  const expectedTeams = expectedType === 'mainland_cup' ? 8 : 4;
  const expectedGroups = expectedType === 'mainland_cup' ? 2 : 1;
  const participantIds = requireArray(value, 'participantIds');
  const qualificationOrder = requireArray(value, 'qualificationOrder');
  if (
    participantIds.length !== expectedTeams
    || new Set(participantIds).size !== expectedTeams
    || participantIds.some(teamId => typeof teamId !== 'string' || !teamIds.has(teamId))
  ) {
    throw new Error(`${expectedType}参赛球队结构无效`);
  }
  if (
    qualificationOrder.length !== expectedTeams
    || new Set(qualificationOrder).size !== expectedTeams
    || qualificationOrder.some(teamId => !participantIds.includes(teamId))
  ) {
    throw new Error(`${expectedType}资格顺序无效`);
  }
  const groups = requireArray(value, 'groups');
  if (groups.length !== expectedGroups) throw new Error(`${expectedType}小组数量无效`);
  const grouped = groups.flatMap((group, index) =>
    validateNeutralGroup(
      group,
      `${expectedType}第 ${index + 1} `,
      4,
      teamIds,
      'continental_cup',
    ),
  );
  if (new Set(grouped).size !== expectedTeams || grouped.some(teamId => !participantIds.includes(teamId))) {
    throw new Error(`${expectedType}球队分组无效`);
  }
  requireBoolean(value, 'groupStageCompleted', `${expectedType} `);
  requireBoolean(value, 'completed', `${expectedType} `);
  requireFiniteNumber(value, 'currentRound', `${expectedType} `);
  validateKnockoutRounds(value.rounds, expectedType, teamIds);
}

function validateObserverSeasonTrajectories(
  values: unknown[],
  teamIds: Set<string>,
): void {
  if (values.length > 40) throw new Error('观察档案超过 40 个赛季上限');
  const seasons = new Set<number>();
  for (const [index, value] of values.entries()) {
    if (!isRecord(value)) throw new Error(`观察档案 ${index + 1} 无效`);
    const season = requireFiniteNumber(value, 'seasonNumber', `观察档案 ${index + 1} `);
    if (!Number.isInteger(season) || season < 1 || seasons.has(season)) {
      throw new Error(`观察档案 ${index + 1} 的赛季编号无效`);
    }
    seasons.add(season);
    const teamId = requireString(value, 'teamId', `观察档案 S${season} `);
    if (!teamIds.has(teamId)) throw new Error(`观察档案 S${season} 引用了无效球队`);
    const leagueLevel = requireFiniteNumber(value, 'leagueLevel', `观察档案 S${season} `);
    if (![1, 2, 3].includes(leagueLevel)) throw new Error(`观察档案 S${season} 的联赛级别无效`);
    const checkpoints = requireArray(value, 'checkpoints');
    if (checkpoints.length !== 4) throw new Error(`观察档案 S${season} 的赛季节点数量无效`);
    for (const checkpoint of checkpoints) {
      if (!isRecord(checkpoint) || !OBSERVER_PHASES.has(checkpoint.phase as string)) {
        throw new Error(`观察档案 S${season} 的赛季节点无效`);
      }
      for (const field of ['played', 'position', 'points', 'goalDifference']) {
        requireFiniteNumber(checkpoint, field, `观察档案 S${season} 节点 `);
      }
    }
    if (value.expectedPosition !== undefined) {
      const expected = requireFiniteNumber(value, 'expectedPosition', `观察档案 S${season} `);
      if (!Number.isInteger(expected) || expected < 1 || expected > 16) {
        throw new Error(`观察档案 S${season} 的赛前预期无效`);
      }
    }
    if (value.representativePlayerId !== undefined && typeof value.representativePlayerId !== 'string') {
      throw new Error(`观察档案 S${season} 的代表球员引用无效`);
    }
    if (value.judgment !== undefined) {
      if (!isRecord(value.judgment)) throw new Error(`观察档案 S${season} 的判断记录无效`);
      const total = requireFiniteNumber(value.judgment, 'total', `观察档案 S${season} 判断 `);
      const correct = requireFiniteNumber(value.judgment, 'correct', `观察档案 S${season} 判断 `);
      const currentStreak = requireFiniteNumber(value.judgment, 'currentStreak', `观察档案 S${season} 判断 `);
      const bestStreak = requireFiniteNumber(value.judgment, 'bestStreak', `观察档案 S${season} 判断 `);
      if (
        ![total, correct, currentStreak, bestStreak].every(Number.isInteger)
        || total < 1
        || correct < 0
        || correct > total
        || currentStreak < 0
        || currentStreak > correct
        || bestStreak < currentStreak
        || bestStreak > correct
      ) {
        throw new Error(`观察档案 S${season} 的判断计数无效`);
      }
    }
    if (value.theme !== undefined) {
      if (!isRecord(value.theme) || !OBSERVATION_THEME_TYPES.has(value.theme.type as string)) {
        throw new Error(`观察档案 S${season} 的观察主题无效`);
      }
      if (value.theme.playerId !== undefined && typeof value.theme.playerId !== 'string') {
        throw new Error(`观察档案 S${season} 的主题球员引用无效`);
      }
    }
    if (value.destinyDeviation !== undefined) {
      const deviation = value.destinyDeviation;
      if (!isRecord(deviation)) throw new Error(`观察档案 S${season} 的偏差比赛无效`);
      requireString(deviation, 'fixtureId', `观察档案 S${season} 偏差比赛 `);
      const homeTeamId = requireString(deviation, 'homeTeamId', `观察档案 S${season} 偏差比赛 `);
      const awayTeamId = requireString(deviation, 'awayTeamId', `观察档案 S${season} 偏差比赛 `);
      if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId) || homeTeamId === awayTeamId) {
        throw new Error(`观察档案 S${season} 的偏差比赛球队无效`);
      }
      for (const field of ['homeGoals', 'awayGoals', 'score', 'actualProbability']) {
        requireFiniteNumber(deviation, field, `观察档案 S${season} 偏差比赛 `);
      }
      requireString(deviation, 'competitionName', `观察档案 S${season} 偏差比赛 `);
      requireString(deviation, 'roundLabel', `观察档案 S${season} 偏差比赛 `);
      if (!DESTINY_DEVIATION_TIERS.has(deviation.tier as string)) {
        throw new Error(`观察档案 S${season} 的偏差等级无效`);
      }
    }
  }
}

function validateCurrentWorld(world: JsonRecord): GameWorld {
  for (const key of REQUIRED_WORLD_RECORDS) requireRecord(world, key);
  for (const key of REQUIRED_WORLD_ARRAYS) requireArray(world, key);
  const leagueCup = requireRecord(world, 'leagueCup');
  const superCup = requireRecord(world, 'superCup');
  const continentalCups = requireRecord(world, 'continentalCups');
  const worldCup = world.worldCup;
  if (worldCup !== null && !isRecord(worldCup)) throw new Error('存档字段 worldCup 无效');
  if (world.transferWindow !== null && !isRecord(world.transferWindow)) throw new Error('存档字段 transferWindow 无效');
  requireBoolean(world, 'godHandUsed', '存档世界 ');
  for (const key of ['seed', 'rngState', 'nextPlayerUuidCounter', 'nextCoachIdCounter', 'totalElapsedWindows']) {
    requireFiniteNumber(world, key, '存档世界 ');
  }

  const teamBases = requireRecord(world, 'teamBases');
  let teams;
  try {
    teams = parseCustomTeams(Object.values(teamBases));
  } catch (error) {
    throw new Error(`存档球队数据无效：${error instanceof Error ? error.message : '结构错误'}`);
  }
  const teamIds = new Set(teams.map(team => team.id));
  for (const [key, team] of Object.entries(teamBases)) {
    if (!isRecord(team) || team.id !== key) throw new Error(`存档球队键与 id 不一致：${key}`);
  }
  validateObserverSeasonTrajectories(
    requireArray(world, 'observerSeasonTrajectories'),
    teamIds,
  );
  validateLeagueCup(leagueCup, teamIds);
  validateSuperCup(superCup, teamIds);

  const teamStates = requireRecord(world, 'teamStates');
  const squads = requireRecord(world, 'squads');
  const playerStats = requireRecord(world, 'playerStats');
  const playerIds = new Set<string>();
  for (const teamId of teamIds) {
    const state = teamStates[teamId];
    if (!isRecord(state) || state.id !== teamId) throw new Error(`存档缺少有效球队状态：${teamId}`);
    requireFiniteNumber(state, 'leagueLevel', `球队 ${teamId} `);
    for (const key of ['morale', 'fatigue', 'momentum', 'squadHealth', 'coachPressure']) {
      requireFiniteNumber(state, key, `球队 ${teamId} `);
    }
    requireArray(state, 'recentForm');

    const squad = squads[teamId];
    if (!Array.isArray(squad) || squad.length === 0) throw new Error(`存档缺少有效球队阵容：${teamId}`);
    for (const [playerIndex, player] of squad.entries()) {
      if (!isRecord(player)) throw new Error(`球队 ${teamId} 的球员 ${playerIndex + 1} 无效`);
      const uuid = requireString(player, 'uuid', `球队 ${teamId} 球员 `);
      if (playerIds.has(uuid)) throw new Error(`存档存在重复球员 UUID：${uuid}`);
      playerIds.add(uuid);
      if (requireString(player, 'teamId', `球员 ${uuid} `) !== teamId) {
        throw new Error(`球员 ${uuid} 的球队归属不一致`);
      }
      requireString(player, 'name', `球员 ${uuid} `);
      const position = requireString(player, 'position', `球员 ${uuid} `);
      if (!['GK', 'DF', 'MF', 'FW'].includes(position)) throw new Error(`球员 ${uuid} 的位置无效`);
      for (const key of PLAYER_NUMBER_FIELDS) requireFiniteNumber(player, key, `球员 ${uuid} `);

      const stats = playerStats[uuid];
      if (!isRecord(stats)) throw new Error(`存档缺少球员统计：${uuid}`);
      if (stats.playerId !== uuid || typeof stats.teamId !== 'string' || !teamIds.has(stats.teamId)) {
        throw new Error(`球员 ${uuid} 的统计归属无效`);
      }
      for (const key of PLAYER_STAT_NUMBER_FIELDS) requireFiniteNumber(stats, key, `球员 ${uuid} 统计 `);
      validateOptionalNonNegativeNumbers(stats, `球员 ${uuid} 统计 `);
    }
  }

  if (world.playerStatSegments !== undefined) {
    if (!isRecord(world.playerStatSegments)) throw new Error('存档字段 playerStatSegments 无效');
    for (const [segmentKey, segment] of Object.entries(world.playerStatSegments)) {
      if (!isRecord(segment)) throw new Error(`球员球队分段 ${segmentKey} 无效`);
      requireString(segment, 'playerId', `球员球队分段 ${segmentKey} `);
      const teamId = requireString(segment, 'teamId', `球员球队分段 ${segmentKey} `);
      if (!teamIds.has(teamId)) throw new Error(`球员球队分段 ${segmentKey} 引用了无效球队`);
      for (const key of PLAYER_STAT_NUMBER_FIELDS) requireFiniteNumber(segment, key, `球员球队分段 ${segmentKey} `);
      validateOptionalNonNegativeNumbers(segment, `球员球队分段 ${segmentKey} `);
    }
  }

  const playerStatsHistory = requireRecord(world, 'playerStatsHistory');
  for (const [playerId, entries] of Object.entries(playerStatsHistory)) {
    if (!Array.isArray(entries)) throw new Error(`球员 ${playerId} 历史统计无效`);
    for (const [index, entry] of entries.entries()) {
      if (!isRecord(entry)) throw new Error(`球员 ${playerId} 历史统计第 ${index + 1} 行无效`);
      validateOptionalNonNegativeNumbers(entry, `球员 ${playerId} 历史统计第 ${index + 1} 行 `);
    }
  }

  const seasonState = requireRecord(world, 'seasonState');
  const seasonNumber = requireFiniteNumber(seasonState, 'seasonNumber', '存档赛季 ');
  const currentWindowIndex = requireFiniteNumber(seasonState, 'currentWindowIndex', '存档赛季 ');
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(currentWindowIndex)) {
    throw new Error('存档赛季状态无效');
  }
  requireBoolean(seasonState, 'completed', '存档赛季 ');
  requireBoolean(seasonState, 'isWorldCupYear', '存档赛季 ');
  requireBoolean(seasonState, 'worldCupPhase', '存档赛季 ');
  const calendar = requireArray(seasonState, 'calendar');
  if (calendar.length === 0 || currentWindowIndex < 0 || currentWindowIndex > calendar.length) {
    throw new Error('存档赛程索引无效');
  }
  calendar.forEach((entry, index) => validateCalendarWindow(entry, index, teamIds));

  if (isRecord(worldCup)) {
    validateWorldCup(worldCup, teamIds);
    const worldCupGroupWindows = calendar.filter(entry => isRecord(entry) && entry.type === 'world_cup_group');
    const worldCupKnockoutWindows = calendar.filter(entry => isRecord(entry) && entry.type === 'world_cup');
    if (worldCupGroupWindows.length !== 3 || worldCupKnockoutWindows.length !== 4) {
      throw new Error('世界杯赛程必须为 3 轮小组赛和 4 轮淘汰赛');
    }
    if (seasonNumber % 4 !== 0) throw new Error('世界杯状态出现在非世界杯赛季');
  }

  let hasContinentalCup = false;
  for (const type of ['mainland_cup', 'southern_cup', 'eastern_cup'] as const) {
    const cup = continentalCups[type];
    if (cup === null) continue;
    if (!isRecord(cup)) throw new Error(`存档字段 ${type} 无效`);
    validateContinentalCup(cup, type, teamIds);
    hasContinentalCup = true;
  }
  const continentalWindows = calendar.filter(entry => isRecord(entry) && entry.type === 'continental_cup');
  if (hasContinentalCup) {
    if (seasonNumber < 5 || (seasonNumber - 5) % 6 !== 0) {
      throw new Error('洲际杯状态出现在非洲际杯赛季');
    }
    const expectedWindows = continentalCups.mainland_cup ? 5 : 4;
    if (continentalWindows.length !== expectedWindows) {
      throw new Error(`洲际杯赛程窗口数量无效：需要 ${expectedWindows} 个`);
    }
  } else if (continentalWindows.length > 0) {
    throw new Error('非洲际杯赛季包含空洲际杯窗口');
  }

  return world as unknown as GameWorld;
}

export function parseCurrentSave(text: string): CurrentSaveEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON 存档');
  }

  if (!isRecord(parsed)) throw new Error('存档顶层结构无效');
  if (parsed.version !== SAVE_SCHEMA_VERSION) {
    throw new Error(`仅支持当前版本存档（需要 v${SAVE_SCHEMA_VERSION}）`);
  }

  const state = requireRecord(parsed, 'state');
  if (state.initialized !== true) throw new Error('存档未包含已初始化的游戏状态');
  requireArray(state, 'lastResults');
  requireArray(state, 'lastNews');
  requireArray(state, 'favoriteTeamIds');
  if (state.favoriteTeamId !== null && typeof state.favoriteTeamId !== 'string') {
    throw new Error('存档字段 favoriteTeamId 无效');
  }
  if (
    state.observationThemePreference !== undefined
    && (
      typeof state.observationThemePreference !== 'string'
      || !OBSERVATION_THEME_PREFERENCES.has(state.observationThemePreference)
    )
  ) {
    throw new Error('存档字段 observationThemePreference 无效');
  }

  const world = validateCurrentWorld(requireRecord(state, 'world'));

  return {
    ...(parsed as JsonRecord),
    version: SAVE_SCHEMA_VERSION,
    state: {
      ...state,
      initialized: true,
      world,
    },
  };
}

function quarantineInvalidSave(name: string, payload: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : '存档结构无效';
  latestRecovery = {
    recoveredAt: new Date().toISOString(),
    reason,
    payload,
  };
  recoveryMessagePending = true;

  compressedStorage.removeItem(name);
  try {
    localStorage.setItem(SAVE_DIAGNOSTIC_KEY, JSON.stringify(latestRecovery));
  } catch {
    // The in-memory diagnostic remains available when browser storage is full.
  }
}

export const currentSaveStorage: StateStorage = {
  getItem: (name) => {
    const raw = compressedStorage.getItem(name) as string | null;
    if (raw === null) return null;
    try {
      parseCurrentSave(raw);
      return raw;
    } catch (error) {
      quarantineInvalidSave(name, raw, error);
      return null;
    }
  },
  setItem: (name, value) => compressedStorage.setItem(name, value),
  removeItem: (name) => compressedStorage.removeItem(name),
};

function hasSamePersistedState<T>(a: StorageValue<T> | null, b: StorageValue<T>): boolean {
  if (!a || a.version !== b.version) return false;
  if (!isRecord(a.state) || !isRecord(b.state)) return Object.is(a.state, b.state);
  const aState = a.state as JsonRecord;
  const bState = b.state as JsonRecord;
  const aKeys = Object.keys(aState);
  const bKeys = Object.keys(bState);
  return aKeys.length === bKeys.length
    && aKeys.every((key) => Object.prototype.hasOwnProperty.call(bState, key)
      && Object.is(aState[key], bState[key]));
}

/**
 * Zustand persistence boundary that queues the envelope as an object. This
 * lets the compression Worker perform JSON serialization as well as LZ work,
 * and skips writes triggered only by non-persisted UI state changes.
 */
export function createCurrentSavePersistStorage<T>(): PersistStorage<T> {
  let lastValue: StorageValue<T> | null = null;
  return {
    getItem: (name) => {
      const raw = currentSaveStorage.getItem(name);
      if (raw === null || raw instanceof Promise) return null;
      const parsed = parseCurrentSave(raw) as unknown as StorageValue<T>;
      lastValue = parsed;
      return parsed;
    },
    setItem: (name, value) => {
      if (hasSamePersistedState(lastValue, value)) return;
      lastValue = value;
      queueCompressedJSONValue(name, value);
    },
    removeItem: (name) => {
      lastValue = null;
      compressedStorage.removeItem(name);
    },
  };
}

export function getSaveRecoveryMessage(): string | null {
  if (!latestRecovery || !recoveryMessagePending) return null;
  return `检测到不兼容或损坏的存档，已隔离并返回新游戏。${latestRecovery.reason}`;
}

export function consumeSaveRecoveryMessage(): string | null {
  const message = getSaveRecoveryMessage();
  recoveryMessagePending = false;
  return message;
}

export function getLatestSaveRecoveryDiagnostic(): SaveRecoveryDiagnostic | null {
  return latestRecovery;
}

export function __resetSaveRecoveryForTests(): void {
  latestRecovery = null;
  recoveryMessagePending = false;
}
