import type { GameWorld } from '../season/season-manager';
import type {
  Player,
  PlayerPosition,
  PlayerRetirement,
  PlayerSeasonStats,
  PlayerSeasonStatsHistoryEntry,
} from '../../types/player';
import { emptyPlayerStat, playerTeamStatKey } from './stats';
import { leagueGoalsOf } from './player-stat-fields';
import {
  describeLeagueTopScorer,
  leagueTopScorerBreakdown,
  leagueTopScorerScore,
} from '../awards/award-scoring';
import type { LeagueTier } from '../awards/award-weights';
import { computePlayerCareerTotals } from './career-totals';
import {
  computePlayerPerformance,
  computeSegmentedPlayerPerformance,
  type PlayerPerformanceResult,
} from './player-performance';

export type PlayerIdentitySource = 'active' | 'retired' | 'history' | 'stat';

export interface PlayerStatIdentity {
  playerId: string;
  playerName: string;
  playerNumber?: number;
  position?: PlayerPosition;
  rating?: number;
  age?: number;
  marketValue?: number;
  teamId: string;
  teamName: string;
  teamShortName?: string;
  teamColor?: string;
  source: PlayerIdentitySource;
}

export type PlayerStatRow = PlayerSeasonStats & {
  identity: PlayerStatIdentity;
  player?: Player;
  season?: number;
  performanceSnapshot?: Pick<
    PlayerPerformanceResult,
    'seasonScore' | 'positionQuality' | 'availabilityScore' | 'leagueStrength' | 'confidence' | 'scoreVersion'
  >;
};

const currentPerformanceCache = new WeakMap<GameWorld, Map<string, PlayerPerformanceResult>>();

function indexActivePlayers(
  squads: GameWorld['squads'],
): Map<string, { player: Player; teamId: string }> {
  const index = new Map<string, { player: Player; teamId: string }>();
  for (const [teamId, squad] of Object.entries(squads ?? {})) {
    for (const player of squad ?? []) {
      if (!index.has(player.uuid)) index.set(player.uuid, { player, teamId });
    }
  }
  return index;
}

function indexRetiredPlayers(
  retirements: PlayerRetirement[] | undefined,
): Map<string, PlayerRetirement> {
  const index = new Map<string, PlayerRetirement>();
  for (const retired of retirements ?? []) {
    index.set(retired.uuid, retired);
  }
  return index;
}

function teamIdentity(world: GameWorld, teamId: string, history?: PlayerSeasonStatsHistoryEntry) {
  const team = world.teamBases[teamId];
  return {
    teamName: history?.teamName ?? team?.name ?? teamId,
    teamShortName: history?.teamShortName ?? team?.shortName,
    teamColor: team?.color,
  };
}

function resolveIdentity(
  world: GameWorld,
  stat: PlayerSeasonStats,
  activePlayers: Map<string, { player: Player; teamId: string }>,
  retiredPlayers: Map<string, PlayerRetirement>,
  history?: PlayerSeasonStatsHistoryEntry,
): { identity: PlayerStatIdentity; player?: Player } {
  const active = activePlayers.get(stat.playerId);
  const retired = retiredPlayers.get(stat.playerId);
  const team = teamIdentity(world, stat.teamId, history);

  if (active) {
    const player = active.player;
    return {
      player,
      identity: {
        playerId: stat.playerId,
        playerName: history?.playerName ?? player.name ?? `${player.number}号`,
        playerNumber: history?.playerNumber ?? player.number,
        position: history?.position ?? player.position,
        rating: history?.rating ?? player.rating,
        age: history?.age ?? player.age,
        marketValue: player.marketValue,
        teamId: stat.teamId,
        ...team,
        source: 'active',
      },
    };
  }

  if (retired) {
    return {
      identity: {
        playerId: stat.playerId,
        playerName: history?.playerName ?? retired.name,
        playerNumber: history?.playerNumber,
        position: history?.position ?? retired.position,
        rating: history?.rating ?? retired.peakRating,
        age: history?.age ?? retired.age,
        teamId: stat.teamId,
        teamName: history?.teamName ?? retired.teamName,
        teamShortName: history?.teamShortName ?? team.teamShortName,
        teamColor: team.teamColor,
        source: 'retired',
      },
    };
  }

  if (history?.playerName) {
    return {
      identity: {
        playerId: stat.playerId,
        playerName: history.playerName,
        playerNumber: history.playerNumber,
        position: history.position,
        rating: history.rating,
        age: history.age,
        teamId: stat.teamId,
        ...team,
        source: 'history',
      },
    };
  }

  return {
    identity: {
      playerId: stat.playerId,
      playerName: stat.playerId,
      position: history?.position,
      teamId: stat.teamId,
      ...team,
      source: 'stat',
    },
  };
}

function rowFromStat(
  world: GameWorld,
  stat: PlayerSeasonStats,
  activePlayers: Map<string, { player: Player; teamId: string }>,
  retiredPlayers: Map<string, PlayerRetirement>,
  history?: PlayerSeasonStatsHistoryEntry,
): PlayerStatRow {
  const resolved = resolveIdentity(world, stat, activePlayers, retiredPlayers, history);
  return {
    ...stat,
    identity: resolved.identity,
    player: resolved.player,
    season: history?.season,
    performanceSnapshot: history?.seasonScore !== undefined
      ? {
          seasonScore: history.seasonScore,
          positionQuality: history.positionQuality ?? history.seasonScore,
          availabilityScore: history.availabilityScore ?? 0,
          leagueStrength: history.leagueStrength ?? 100,
          confidence: history.scoreConfidence ?? 0,
          scoreVersion: history.scoreVersion ?? 1,
        }
      : undefined,
  };
}

function statFromHistory(playerId: string, history: PlayerSeasonStatsHistoryEntry): PlayerSeasonStats {
  return {
    playerId,
    teamId: history.teamId,
    goals: history.goals,
    // Absent on rows archived before the league/all-competitions split;
    // leagueGoalsOf applies the documented fallback.
    leagueGoals: history.leagueGoals,
    assists: history.assists,
    yellowCards: history.yellowCards,
    redCards: history.redCards,
    appearances: history.appearances,
    starts: history.starts ?? history.appearances,
    substituteAppearances: history.substituteAppearances ?? 0,
    minutesPlayed: history.minutesPlayed ?? history.appearances * 90,
    cleanSheets: history.cleanSheets ?? 0,
    saves: history.saves ?? 0,
    keyBlocks: history.keyBlocks ?? 0,
    bigChances: history.bigChances ?? history.goals,
    keyPasses: history.keyPasses ?? history.assists,
    routineSaves: history.routineSaves ?? 0,
    shotsOnTargetFaced: history.shotsOnTargetFaced ?? 0,
    cleanSheetMinutes: history.cleanSheetMinutes ?? 0,
    goalsConcededWhileOnPitch: history.goalsConcededWhileOnPitch ?? 0,
    interceptions: history.interceptions ?? 0,
    clearances: history.clearances ?? 0,
    teamMatchesAllCompetitions: history.teamMatchesAllCompetitions ?? history.teamMatches,
    missedMatches: history.missedMatches ?? Math.max(0, history.teamMatches - history.appearances),
    injuryAbsenceMatches: history.injuryAbsenceMatches ?? 0,
  };
}

export function getCurrentPlayerStatRows(world: GameWorld): PlayerStatRow[] {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  return Object.values(world.playerStats ?? {}).map((stat) =>
    rowFromStat(world, stat, activePlayers, retiredPlayers),
  );
}

export function getCurrentPlayerStatRowMap(world: GameWorld): Map<string, PlayerStatRow> {
  const rows = getCurrentPlayerStatRows(world);
  return new Map(rows.map((row) => [row.playerId, row]));
}

export function getCurrentPlayerStatRow(world: GameWorld, playerId: string): PlayerStatRow | undefined {
  return getCurrentPlayerStatRowMap(world).get(playerId);
}

export function getPlayerClubStatRow(
  world: GameWorld,
  playerId: string,
  teamId: string,
): PlayerStatRow {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  const hasSegments = Object.keys(world.playerStatSegments ?? {}).length > 0;
  const stat = hasSegments
    ? world.playerStatSegments?.[playerTeamStatKey(playerId, teamId)] ?? emptyPlayerStat(playerId, teamId)
    : (world.playerStats?.[playerId]?.teamId === teamId ? world.playerStats[playerId] : undefined)
      ?? emptyPlayerStat(playerId, teamId);
  return rowFromStat(world, stat, activePlayers, retiredPlayers);
}

export function getPlayerClubStatRowMap(world: GameWorld, teamId: string): Map<string, PlayerStatRow> {
  const rows = new Map<string, PlayerStatRow>();
  for (const player of world.squads[teamId] ?? []) {
    rows.set(player.uuid, getPlayerClubStatRow(world, player.uuid, teamId));
  }
  return rows;
}

export function getCurrentPlayerClubStatRows(world: GameWorld, teamId?: string): PlayerStatRow[] {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  const hasSegments = Object.keys(world.playerStatSegments ?? {}).length > 0;
  const stats = hasSegments
    ? Object.values(world.playerStatSegments ?? {})
    : Object.values(world.playerStats ?? {});
  return stats
    .filter((stat) => !teamId || stat.teamId === teamId)
    .map((stat) => rowFromStat(world, stat, activePlayers, retiredPlayers));
}

export function getSeasonPlayerStatRows(world: GameWorld, seasonNumber: number): PlayerStatRow[] {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  const rows: PlayerStatRow[] = [];

  for (const [playerId, historyEntries] of Object.entries(world.playerStatsHistory ?? {})) {
    for (const history of historyEntries ?? []) {
      if (history.season !== seasonNumber) continue;
      rows.push(rowFromStat(
        world,
        statFromHistory(playerId, history),
        activePlayers,
        retiredPlayers,
        history,
      ));
    }
  }

  if (rows.length > 0) return rows;
  if (seasonNumber === world.seasonState.seasonNumber) return getCurrentPlayerStatRows(world);
  return [];
}

function latestHistoryEntry(
  entries: PlayerSeasonStatsHistoryEntry[] | undefined,
): PlayerSeasonStatsHistoryEntry | undefined {
  return [...(entries ?? [])].sort((a, b) => b.season - a.season)[0];
}

export function getCareerPlayerStatRows(world: GameWorld): PlayerStatRow[] {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  const playerIds = new Set<string>();

  for (const playerId of Object.keys(world.playerStats ?? {})) playerIds.add(playerId);
  for (const playerId of Object.keys(world.playerStatsHistory ?? {})) playerIds.add(playerId);
  for (const retired of world.retirementHistory ?? []) playerIds.add(retired.uuid);
  for (const { player } of activePlayers.values()) playerIds.add(player.uuid);

  const rows: PlayerStatRow[] = [];
  for (const playerId of playerIds) {
    const totals = computePlayerCareerTotals(world, playerId);
    if (
      totals.appearances === 0
      && totals.goals === 0
      && totals.assists === 0
      && totals.cleanSheets === 0
      && totals.saves === 0
      && totals.keyBlocks === 0
    ) {
      continue;
    }
    const history = latestHistoryEntry(world.playerStatsHistory?.[playerId]);
    const active = activePlayers.get(playerId);
    const historyForIdentity = active ? undefined : history;
    const teamId = world.playerStats?.[playerId]?.teamId
      ?? active?.teamId
      ?? history?.teamId
      ?? retiredPlayers.get(playerId)?.teamId
      ?? activePlayers.get(playerId)?.teamId
      ?? 'unknown';
    const stat: PlayerSeasonStats = {
      playerId,
      teamId,
      goals: totals.goals,
      assists: totals.assists,
      yellowCards: totals.yellowCards,
      redCards: totals.redCards,
      appearances: totals.appearances,
      starts: totals.starts,
      substituteAppearances: totals.substituteAppearances,
      minutesPlayed: totals.minutesPlayed,
      cleanSheets: totals.cleanSheets,
      saves: totals.saves,
      keyBlocks: totals.keyBlocks,
      bigChances: totals.bigChances,
      keyPasses: totals.keyPasses,
      routineSaves: totals.routineSaves,
      shotsOnTargetFaced: totals.shotsOnTargetFaced,
      cleanSheetMinutes: totals.cleanSheetMinutes,
      goalsConcededWhileOnPitch: totals.goalsConcededWhileOnPitch,
      interceptions: totals.interceptions,
      clearances: totals.clearances,
    };
    rows.push(rowFromStat(world, stat, activePlayers, retiredPlayers, historyForIdentity));
  }

  return rows;
}

export function sortRowsByGoals(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.appearances - a.appearances);
}

export function getPlayerRowPerformance(world: GameWorld, row: PlayerStatRow): PlayerPerformanceResult {
  const position = row.identity.position ?? 'MF';
  const cache = row.season === undefined
    ? currentPerformanceCache.get(world) ?? new Map<string, PlayerPerformanceResult>()
    : null;
  if (cache && !currentPerformanceCache.has(world)) currentPerformanceCache.set(world, cache);
  const cached = cache?.get(row.playerId);
  if (cached) return cached;
  const segments = Object.values(world.playerStatSegments ?? {})
    .filter(segment => segment.playerId === row.playerId);
  const dynamic = row.season === undefined && segments.length > 0
    ? computeSegmentedPlayerPerformance(position, segments, world.seasonStartLevels ?? {}, row)
    : computePlayerPerformance(position, row, world.seasonStartLevels?.[row.teamId]);
  const frozen = row.performanceSnapshot;
  if (!frozen) {
    cache?.set(row.playerId, dynamic);
    return dynamic;
  }
  const result = {
    ...dynamic,
    score: frozen.seasonScore,
    seasonScore: frozen.seasonScore,
    positionQuality: frozen.positionQuality,
    availabilityScore: frozen.availabilityScore,
    leagueStrength: frozen.leagueStrength,
    confidence: frozen.confidence,
    scoreVersion: frozen.scoreVersion,
  };
  return result;
}

export function sortRowsByOverall(rows: PlayerStatRow[], world: GameWorld): PlayerStatRow[] {
  return [...rows].sort((a, b) =>
    getPlayerRowPerformance(world, b).seasonScore - getPlayerRowPerformance(world, a).seasonScore
    || (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
    || a.playerId.localeCompare(b.playerId),
  );
}

export function sortRowsByAssists(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort((a, b) => b.assists - a.assists || b.goals - a.goals || b.appearances - a.appearances);
}

export function sortRowsByDiscipline(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      b.yellowCards + b.redCards - (a.yellowCards + a.redCards) ||
      b.redCards - a.redCards ||
      b.appearances - a.appearances,
  );
}

export function sortRowsByDefense(rows: PlayerStatRow[], world?: GameWorld): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      (world ? getPlayerRowPerformance(world, b).positionQuality : computePlayerPerformance('DF', b).positionQuality)
      - (world ? getPlayerRowPerformance(world, a).positionQuality : computePlayerPerformance('DF', a).positionQuality) ||
      (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0) ||
      (b.identity.rating ?? 0) - (a.identity.rating ?? 0),
  );
}

export function sortRowsByGoalkeeping(rows: PlayerStatRow[], world?: GameWorld): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      (world ? getPlayerRowPerformance(world, b).positionQuality : computePlayerPerformance('GK', b).positionQuality)
      - (world ? getPlayerRowPerformance(world, a).positionQuality : computePlayerPerformance('GK', a).positionQuality) ||
      (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0) ||
      (b.identity.rating ?? 0) - (a.identity.rating ?? 0),
  );
}

export function sortRowsByCreation(rows: PlayerStatRow[], world?: GameWorld): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      (world
        ? getPlayerRowPerformance(world, b).positionQuality
        : computePlayerPerformance(b.identity.position === 'FW' ? 'FW' : 'MF', b).positionQuality)
      - (world
        ? getPlayerRowPerformance(world, a).positionQuality
        : computePlayerPerformance(a.identity.position === 'FW' ? 'FW' : 'MF', a).positionQuality) ||
      b.assists - a.assists ||
      b.goals - a.goals ||
      b.appearances - a.appearances,
  );
}

export function sortRowsByForward(rows: PlayerStatRow[], world?: GameWorld): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      (world ? getPlayerRowPerformance(world, b).positionQuality : computePlayerPerformance('FW', b).positionQuality)
      - (world ? getPlayerRowPerformance(world, a).positionQuality : computePlayerPerformance('FW', a).positionQuality) ||
      (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0) ||
      (b.identity.rating ?? 0) - (a.identity.rating ?? 0),
  );
}

/**
 * Display-layer minutes floor for current-season tables: a quarter of the
 * team's all-competitions minutes, never below 45.
 *
 * This is a presentation filter only. `player-performance.ts` keeps its own
 * `eligible` rule and `PLAYER_RANKING_MINUTES`, so award candidates and stored
 * season scores are untouched by it.
 */
export const PLAYER_TABLE_MIN_MINUTES = 45;
export const PLAYER_TABLE_MINUTES_SHARE = 0.25;

export function minimumTableMinutes(
  row: Pick<PlayerSeasonStats, 'teamMatchesAllCompetitions'>,
): number {
  const teamMatches = row.teamMatchesAllCompetitions ?? 0;
  // Legacy saves predate the field; a fixed floor keeps them rankable.
  if (!(teamMatches > 0)) return PLAYER_TABLE_MIN_MINUTES;
  return Math.max(
    PLAYER_TABLE_MIN_MINUTES,
    Math.floor(teamMatches * 90 * PLAYER_TABLE_MINUTES_SHARE),
  );
}

export function meetsTableMinutes(
  row: Pick<PlayerSeasonStats, 'minutesPlayed' | 'teamMatchesAllCompetitions'>,
): boolean {
  return (row.minutesPlayed ?? 0) >= minimumTableMinutes(row);
}

/** Optional narrowing layered on top of a table's own candidate rule. */
export interface PlayerTableOptions {
  /** Mixed-position tables only; single-position tables already fix it. */
  position?: PlayerPosition;
}

function currentTableRows(world: GameWorld, options?: PlayerTableOptions): PlayerStatRow[] {
  const position = options?.position;
  return getCurrentPlayerStatRows(world).filter(row =>
    meetsTableMinutes(row) && (position === undefined || row.identity.position === position),
  );
}

export function getCurrentTopScorerRows(
  world: GameWorld,
  limit = 20,
  options?: PlayerTableOptions,
): PlayerStatRow[] {
  return sortRowsByGoals(currentTableRows(world, options).filter((row) => row.goals > 0)).slice(0, limit);
}

export function getCurrentOverallRows(
  world: GameWorld,
  limit = 20,
  options?: PlayerTableOptions,
): PlayerStatRow[] {
  return sortRowsByOverall(
    currentTableRows(world, options).filter(row => getPlayerRowPerformance(world, row).eligible),
    world,
  ).slice(0, limit);
}

export function getSeasonOverallRows(world: GameWorld, seasonNumber: number, limit = 20): PlayerStatRow[] {
  return sortRowsByOverall(
    getSeasonPlayerStatRows(world, seasonNumber).filter(row =>
      row.performanceSnapshot !== undefined && getPlayerRowPerformance(world, row).eligible
    ),
    world,
  ).slice(0, limit);
}

export function getCurrentTopAssistRows(
  world: GameWorld,
  limit = 20,
  options?: PlayerTableOptions,
): PlayerStatRow[] {
  return sortRowsByAssists(currentTableRows(world, options).filter((row) => row.assists > 0)).slice(0, limit);
}

export function getCurrentDisciplineRows(
  world: GameWorld,
  limit = 20,
  options?: PlayerTableOptions,
): PlayerStatRow[] {
  return sortRowsByDiscipline(
    currentTableRows(world, options).filter((row) => row.yellowCards + row.redCards > 0),
  ).slice(0, limit);
}

export function getCurrentDefenderRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByDefense(
    getCurrentPlayerStatRows(world).filter((row) =>
      row.identity.position === 'DF'
      && meetsTableMinutes(row)
      && computePlayerPerformance('DF', row, world.seasonStartLevels?.[row.teamId]).eligible
    ),
    world,
  ).slice(0, limit);
}

export function getCurrentGoalkeeperRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByGoalkeeping(
    getCurrentPlayerStatRows(world).filter((row) =>
      row.identity.position === 'GK'
      && meetsTableMinutes(row)
      && computePlayerPerformance('GK', row, world.seasonStartLevels?.[row.teamId]).eligible
    ),
    world,
  ).slice(0, limit);
}

export function getCurrentForwardRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByForward(
    getCurrentPlayerStatRows(world).filter((row) =>
      row.identity.position === 'FW'
      && meetsTableMinutes(row)
      && computePlayerPerformance('FW', row, world.seasonStartLevels?.[row.teamId]).eligible
    ),
    world,
  ).slice(0, limit);
}

export function getCurrentCreatorRows(
  world: GameWorld,
  limit = 20,
  options?: PlayerTableOptions,
): PlayerStatRow[] {
  return sortRowsByCreation(
    currentTableRows(world, options).filter((row) =>
      (row.identity.position === 'MF' || row.identity.position === 'FW')
      && (row.keyPasses > 0 || row.assists > 0)
    ),
    world,
  ).slice(0, limit);
}

/**
 * Tier a team played in during a given season.
 *
 * `teamSeasonRecords` is authoritative once a season is archived; the
 * in-progress season has no record yet, so it falls back to the levels captured
 * at season start.
 */
export function teamTierInSeason(
  world: GameWorld,
  teamId: string,
  seasonNumber?: number,
): LeagueTier {
  if (seasonNumber !== undefined) {
    const record = world.teamSeasonRecords?.[teamId]
      ?.find((row) => row.seasonNumber === seasonNumber);
    if (record?.leagueLevel) return record.leagueLevel as LeagueTier;
  }
  return (world.seasonStartLevels?.[teamId] ?? 1) as LeagueTier;
}

/**
 * 射手王 — the season's league top scorer.
 *
 * Ranks LEAGUE goals over league rounds, schedule-normalised so a 14-round tier
 * is not structurally excluded by the top flight's 30. Deliberately a different
 * measurement from the Golden Boot, which ranks all-competitions goals; the two
 * name different players in roughly two seasons out of three.
 */
export function getSeasonTopScorerRows(world: GameWorld, seasonNumber: number, limit = 20): PlayerStatRow[] {
  const scored = getSeasonPlayerStatRows(world, seasonNumber)
    .filter((row) => leagueGoalsOf(row) > 0)
    .map((row) => {
      const leagueGoals = leagueGoalsOf(row);
      return {
        row,
        leagueGoals,
        score: leagueTopScorerScore(leagueGoals, teamTierInSeason(world, row.teamId, seasonNumber)),
      };
    });

  // Same tiebreak chain as the award comparator: score, then raw league goals,
  // then assists. Never object-key order.
  scored.sort((a, b) => b.score - a.score
    || b.leagueGoals - a.leagueGoals
    || b.row.assists - a.row.assists);

  return scored.slice(0, limit).map((entry) => entry.row);
}

/**
 * Display line for a league top-scorer row, printing the schedule derivation
 * whenever an adjustment applies so the result stays reconstructable.
 */
export function seasonTopScorerLabel(
  world: GameWorld,
  row: Pick<PlayerStatRow, 'teamId' | 'goals'> & { leagueGoals?: number },
  seasonNumber?: number,
): string {
  return describeLeagueTopScorer(leagueTopScorerBreakdown(
    leagueGoalsOf(row),
    teamTierInSeason(world, row.teamId, seasonNumber),
  ));
}

export function getSeasonTopAssistRows(world: GameWorld, seasonNumber: number, limit = 20): PlayerStatRow[] {
  return sortRowsByAssists(getSeasonPlayerStatRows(world, seasonNumber).filter((row) => row.assists > 0)).slice(0, limit);
}

export function getCareerTopScorerRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByGoals(getCareerPlayerStatRows(world).filter((row) => row.goals > 0)).slice(0, limit);
}

export function getCareerTopAssistRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByAssists(getCareerPlayerStatRows(world).filter((row) => row.assists > 0)).slice(0, limit);
}
