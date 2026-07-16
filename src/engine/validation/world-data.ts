import type { GameWorld } from '../season/season-manager';
import type { Player, PlayerSeasonStats } from '../../types/player';
import type { MatchEvent, MatchResult } from '../../types/match';
import type { TransferRecord } from '../../types/transfer';
import { playerTeamStatKey } from '../players/stats';
import { selectMatchday } from '../players/injuries';

export type WorldDataIssueSeverity = 'error' | 'warning';

export interface WorldDataIssue {
  severity: WorldDataIssueSeverity;
  code: string;
  message: string;
  teamId?: string;
  playerId?: string;
  fixtureId?: string;
  season?: number;
}

export interface WorldDataValidationResult {
  isValid: boolean;
  errors: WorldDataIssue[];
  warnings: WorldDataIssue[];
  issues: WorldDataIssue[];
}

function pushIssue(
  issues: WorldDataIssue[],
  issue: WorldDataIssue,
): void {
  issues.push(issue);
}

function indexActivePlayers(
  squads: GameWorld['squads'],
): {
  activePlayers: Map<string, Player>;
  activePlayerTeams: Map<string, string>;
  duplicatePlayerIds: Set<string>;
} {
  const activePlayers = new Map<string, Player>();
  const activePlayerTeams = new Map<string, string>();
  const duplicatePlayerIds = new Set<string>();

  for (const [teamId, squad] of Object.entries(squads ?? {})) {
    for (const player of squad ?? []) {
      if (activePlayers.has(player.uuid)) {
        duplicatePlayerIds.add(player.uuid);
        continue;
      }
      activePlayers.set(player.uuid, player);
      activePlayerTeams.set(player.uuid, teamId);
    }
  }

  return { activePlayers, activePlayerTeams, duplicatePlayerIds };
}

function isKnownHistoricalPlayer(world: GameWorld, playerId: string): boolean {
  if (world.playerStatsHistory?.[playerId]?.length > 0) return true;
  return (world.retirementHistory ?? []).some((p) => p.uuid === playerId);
}

function isKnownPlayer(
  world: GameWorld,
  playerId: string,
  activePlayers: Map<string, Player>,
): boolean {
  return activePlayers.has(playerId)
    || Boolean(world.playerStats[playerId])
    || isKnownHistoricalPlayer(world, playerId);
}

function playerHasKnownTeamAssociation(
  world: GameWorld,
  playerId: string,
  teamId: string,
  activePlayerTeams: Map<string, string>,
): boolean {
  if (activePlayerTeams.get(playerId) === teamId) return true;
  if (world.playerStats[playerId]?.teamId === teamId) return true;
  if (world.playerStatSegments?.[playerTeamStatKey(playerId, teamId)]) return true;
  if ((world.playerStatsHistory?.[playerId] ?? []).some((entry) => entry.teamId === teamId)) return true;
  return (world.retirementHistory ?? []).some((player) => player.uuid === playerId && player.teamId === teamId);
}

function resolvePlayerTeamAtWindow(
  world: GameWorld,
  playerId: string,
  season: number,
  windowIndex: number,
): { hasTransferEvidence: boolean; teamId?: string } {
  const records = (world.transferHistory ?? [])
    .filter((record) => record.playerId === playerId && record.season === season)
    .sort((a, b) => a.windowIndex - b.windowIndex);
  if (records.length === 0) return { hasTransferEvidence: false };

  const latestCompletedMove = records
    .filter((record) => record.windowIndex <= windowIndex)
    .at(-1);
  const nextMove = records.find((record) => record.windowIndex > windowIndex);
  const teamId = latestCompletedMove?.toTeamId ?? nextMove?.fromTeamId;
  return {
    hasTransferEvidence: true,
    teamId: teamId === '__free_market__' ? undefined : teamId,
  };
}

function getOpposingTeamId(result: MatchResult, teamId: string): string | undefined {
  if (teamId === result.homeTeamId) return result.awayTeamId;
  if (teamId === result.awayTeamId) return result.homeTeamId;
  return undefined;
}

function isPlayerInjuredAtWindow(
  player: Player,
  globalWindowIdx: number,
  season?: number,
): boolean {
  return (player.injuryHistory ?? []).some((injury) =>
    (season === undefined || injury.startSeason === season || injury.type === 'long_term')
    &&
    globalWindowIdx > injury.startWindow
    && globalWindowIdx <= injury.startWindow + injury.durationMatches
  );
}

function isPlayerSuspendedAtWindow(
  player: Player,
  globalWindowIdx: number,
  season?: number,
): boolean {
  return (player.suspensionHistory ?? []).some((suspension) =>
    (season === undefined || suspension.startSeason === season)
    &&
    globalWindowIdx >= suspension.unavailableFromWindow
    && globalWindowIdx < suspension.suspendedUntilWindow
  );
}

interface MatchdayAuditContext {
  playerIds: Set<string>;
  unavailablePlayerIds: Set<string>;
  emergencyFloor: boolean;
  availableCount: number;
}

function validateMatchdaySnapshot(
  world: GameWorld,
  result: MatchResult,
  teamId: string,
  snapshot: NonNullable<MatchResult['homeMatchday']>,
  activePlayers: Map<string, Player>,
  activePlayerTeams: Map<string, string>,
  issues: WorldDataIssue[],
  resultSeason?: number,
  resultWindowIndex?: number,
): void {
  const playerIds = snapshot.players.map((player) => player.playerId);
  const uniquePlayerIds = new Set(playerIds);
  if (snapshot.players.length > 14) {
    pushIssue(issues, {
      severity: 'error',
      code: 'matchday_snapshot_too_large',
      message: `Fixture ${result.fixtureId} stores ${snapshot.players.length} matchday players for ${teamId}; maximum is 14.`,
      teamId,
      fixtureId: result.fixtureId,
      season: resultSeason,
    });
  }
  if (uniquePlayerIds.size !== playerIds.length) {
    pushIssue(issues, {
      severity: 'error',
      code: 'matchday_snapshot_duplicate_player',
      message: `Fixture ${result.fixtureId} stores duplicate player ids in ${teamId}'s matchday snapshot.`,
      teamId,
      fixtureId: result.fixtureId,
      season: resultSeason,
    });
  }
  if (
    snapshot.availableCount < 0
    || (snapshot.emergencyFloor && snapshot.availableCount >= 11)
    || (!snapshot.emergencyFloor && snapshot.availableCount < 11)
  ) {
    pushIssue(issues, {
      severity: 'warning',
      code: 'matchday_snapshot_emergency_mismatch',
      message: `Fixture ${result.fixtureId} has emergencyFloor=${snapshot.emergencyFloor} with availableCount=${snapshot.availableCount} for ${teamId}.`,
      teamId,
      fixtureId: result.fixtureId,
      season: resultSeason,
    });
  }
  const expectedNonEmergencySize = Math.min(14, snapshot.availableCount);
  if (!snapshot.emergencyFloor && snapshot.players.length !== expectedNonEmergencySize) {
    pushIssue(issues, {
      severity: 'warning',
      code: 'matchday_snapshot_size_mismatch',
      message: `Fixture ${result.fixtureId} stores ${snapshot.players.length} matchday players for ${teamId}, but ${snapshot.availableCount} available players require ${expectedNonEmergencySize}.`,
      teamId,
      fixtureId: result.fixtureId,
      season: resultSeason,
    });
  }

  const duration = snapshot.durationMinutes ?? (result.extraTime ? 120 : 90);
  if (duration !== (result.extraTime ? 120 : 90)) {
    pushIssue(issues, {
      severity: 'error',
      code: 'matchday_duration_mismatch',
      message: `Fixture ${result.fixtureId} stores ${duration} participation minutes but extraTime=${result.extraTime}.`,
      teamId, fixtureId: result.fixtureId, season: resultSeason,
    });
  }
  const starters = snapshot.players.filter(player => player.role === 'starter');
  const expectedStarters = Math.min(11, snapshot.players.length);
  if (starters.length !== expectedStarters) {
    pushIssue(issues, {
      severity: 'error',
      code: 'matchday_starter_count_mismatch',
      message: `Fixture ${result.fixtureId} stores ${starters.length} starters for ${teamId}; expected ${expectedStarters}.`,
      teamId, fixtureId: result.fixtureId, season: resultSeason,
    });
  }
  if (snapshot.players.some(player => player.position === 'GK')
    && starters.length > 0
    && !starters.some(player => player.position === 'GK')) {
    pushIssue(issues, {
      severity: 'error',
      code: 'matchday_starter_missing_goalkeeper',
      message: `Fixture ${result.fixtureId} has an available matchday goalkeeper but none in ${teamId}'s starting lineup.`,
      teamId, fixtureId: result.fixtureId, season: resultSeason,
    });
  }
  const substitutions = snapshot.substitutions ?? [];
  if (substitutions.length > 3) {
    pushIssue(issues, {
      severity: 'error', code: 'matchday_too_many_substitutions',
      message: `Fixture ${result.fixtureId} stores ${substitutions.length} substitutions for ${teamId}; maximum is 3.`,
      teamId, fixtureId: result.fixtureId, season: resultSeason,
    });
  }
  const substitutedIn = new Set<string>();
  const substitutedOut = new Set<string>();
  const entriesById = new Map(snapshot.players.map(player => [player.playerId, player]));
  for (const substitution of substitutions) {
    const incoming = entriesById.get(substitution.playerInId);
    const outgoing = entriesById.get(substitution.playerOutId);
    const invalid = !incoming || !outgoing
      || incoming.role !== 'bench'
      || outgoing.role !== 'starter'
      || incoming.enteredMinute !== substitution.minute
      || outgoing.exitedMinute !== substitution.minute
      || substitution.minute <= 0
      || substitution.minute >= duration
      || substitutedIn.has(substitution.playerInId)
      || substitutedOut.has(substitution.playerOutId);
    if (invalid) {
      pushIssue(issues, {
        severity: 'error', code: 'matchday_invalid_substitution',
        message: `Fixture ${result.fixtureId} contains an invalid substitution for ${teamId} at ${substitution.minute}'.`,
        teamId, fixtureId: result.fixtureId, season: resultSeason,
      });
    }
    substitutedIn.add(substitution.playerInId);
    substitutedOut.add(substitution.playerOutId);
  }

  for (const entry of snapshot.players) {
    const entered = entry.enteredMinute;
    const exited = entry.exitedMinute;
    const expectedMinutes = entered == null || exited == null ? 0 : exited - entered;
    if (entered != null && (entered < 0 || entered >= duration)
      || exited != null && (exited <= 0 || exited > duration)
      || entered != null && exited != null && exited <= entered
      || (entry.minutesPlayed ?? expectedMinutes) !== expectedMinutes
      || entry.role === 'starter' && entered !== 0
      || entry.role === 'bench' && entered == null && (entry.minutesPlayed ?? 0) !== 0) {
      pushIssue(issues, {
        severity: 'error', code: 'matchday_invalid_minutes',
        message: `Fixture ${result.fixtureId} has invalid participation minutes for ${entry.playerId}.`,
        teamId, playerId: entry.playerId, fixtureId: result.fixtureId, season: resultSeason,
      });
    }
    if (!isKnownPlayer(world, entry.playerId, activePlayers)) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'matchday_snapshot_unknown_player',
        message: `Fixture ${result.fixtureId} matchday snapshot references unknown player ${entry.playerId}.`,
        teamId,
        playerId: entry.playerId,
        fixtureId: result.fixtureId,
        season: resultSeason,
      });
      continue;
    }
    const activePlayer = activePlayers.get(entry.playerId);
    if (activePlayer && activePlayer.position !== entry.position) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'matchday_snapshot_position_mismatch',
        message: `Fixture ${result.fixtureId} stores ${entry.playerId} as ${entry.position}, but the player position is ${activePlayer.position}.`,
        teamId,
        playerId: entry.playerId,
        fixtureId: result.fixtureId,
        season: resultSeason,
      });
    }
    if (resultSeason !== undefined && resultWindowIndex !== undefined) {
      const exactTeam = resolvePlayerTeamAtWindow(
        world,
        entry.playerId,
        resultSeason,
        resultWindowIndex,
      );
      const associationMismatch = exactTeam.hasTransferEvidence
        ? exactTeam.teamId !== teamId
        : !playerHasKnownTeamAssociation(world, entry.playerId, teamId, activePlayerTeams);
      if (associationMismatch) {
        pushIssue(issues, {
          severity: 'warning',
          code: 'matchday_snapshot_team_at_window_mismatch',
          message: `Fixture ${result.fixtureId} stores ${entry.playerId} for ${teamId}, but transfer history resolves them to ${exactTeam.teamId ?? 'the free market'} at S${resultSeason} W${resultWindowIndex}.`,
          teamId,
          playerId: entry.playerId,
          fixtureId: result.fixtureId,
          season: resultSeason,
        });
      }
    }
  }
}

function buildMatchdayPlayerIds(
  world: GameWorld,
  result: MatchResult,
  resultGlobalWindowIdx: number | undefined,
  resultSeason: number | undefined,
  activePlayers: Map<string, Player>,
): Map<string, MatchdayAuditContext> {
  const idsByTeam = new Map<string, MatchdayAuditContext>();
  for (const [side, teamId] of [
    ['home', result.homeTeamId],
    ['away', result.awayTeamId],
  ] as const) {
    const snapshot = side === 'home' ? result.homeMatchday : result.awayMatchday;
    if (snapshot) {
      const playerIds = new Set(snapshot.players.map((player) => player.playerId));
      const unavailablePlayerIds = new Set<string>();
      if (resultGlobalWindowIdx !== undefined) {
        for (const playerId of playerIds) {
          const player = activePlayers.get(playerId);
          if (
            player
            && (isPlayerInjuredAtWindow(player, resultGlobalWindowIdx, resultSeason)
              || isPlayerSuspendedAtWindow(player, resultGlobalWindowIdx, resultSeason))
          ) {
            unavailablePlayerIds.add(playerId);
          }
        }
      }
      idsByTeam.set(teamId, {
        playerIds,
        unavailablePlayerIds,
        emergencyFloor: snapshot.emergencyFloor,
        availableCount: snapshot.availableCount,
      });
      continue;
    }
    if (resultGlobalWindowIdx === undefined) continue;
    const selection = selectMatchday(world.squads[teamId], resultGlobalWindowIdx);
    if (!selection) continue;
    idsByTeam.set(teamId, {
      playerIds: new Set(selection.players.map((player) => player.uuid)),
      unavailablePlayerIds: selection.unavailablePlayerIds,
      emergencyFloor: selection.emergencyFloor,
      availableCount: selection.availableCount,
    });
  }
  return idsByTeam;
}

type EventDerivedStatField =
  | 'goals'
  | 'assists'
  | 'saves'
  | 'keyBlocks'
  | 'bigChances'
  | 'keyPasses';

type EventDerivedStats = Record<EventDerivedStatField, number>;

const EVENT_DERIVED_FIELDS: EventDerivedStatField[] = [
  'goals',
  'assists',
  'saves',
  'keyBlocks',
  'bigChances',
  'keyPasses',
];

function emptyEventDerivedStats(): EventDerivedStats {
  return {
    goals: 0,
    assists: 0,
    saves: 0,
    keyBlocks: 0,
    bigChances: 0,
    keyPasses: 0,
  };
}

function addEventDerivedStats(
  playerStats: Map<string, EventDerivedStats>,
  segmentStats: Map<string, EventDerivedStats>,
  playerId: string | undefined,
  teamId: string | undefined,
  updates: Partial<EventDerivedStats>,
): void {
  if (!playerId || !teamId) return;

  const playerCurrent = playerStats.get(playerId) ?? emptyEventDerivedStats();
  const segmentKey = playerTeamStatKey(playerId, teamId);
  const segmentCurrent = segmentStats.get(segmentKey) ?? emptyEventDerivedStats();
  for (const field of EVENT_DERIVED_FIELDS) {
    const delta = updates[field] ?? 0;
    if (delta === 0) continue;
    playerCurrent[field] += delta;
    segmentCurrent[field] += delta;
  }
  playerStats.set(playerId, playerCurrent);
  segmentStats.set(segmentKey, segmentCurrent);
}

function collectEventDerivedStats(
  result: MatchResult,
  playerStats: Map<string, EventDerivedStats>,
  segmentStats: Map<string, EventDerivedStats>,
): void {
  for (const event of result.events ?? []) {
    if (event.minute > 120) continue;
    if (event.type === 'penalty_goal' || event.type === 'penalty_miss') continue;

    if (event.type === 'goal') {
      addEventDerivedStats(playerStats, segmentStats, event.playerId, event.teamId, {
        goals: 1,
        bigChances: 1,
      });
      continue;
    }

    if (event.type === 'assist') {
      addEventDerivedStats(playerStats, segmentStats, event.playerId, event.teamId, {
        assists: 1,
        keyPasses: 1,
      });
      continue;
    }

    if (event.type !== 'gk_save' && event.type !== 'df_block') continue;

    addEventDerivedStats(playerStats, segmentStats, event.playerId, event.teamId, {
      saves: event.type === 'gk_save' ? 1 : 0,
      keyBlocks: event.type === 'df_block' ? 1 : 0,
    });

    const attackingTeamId = getOpposingTeamId(result, event.teamId);
    addEventDerivedStats(playerStats, segmentStats, event.deniedScorerId, attackingTeamId, {
      bigChances: 1,
    });
    addEventDerivedStats(playerStats, segmentStats, event.deniedAssisterId, attackingTeamId, {
      keyPasses: 1,
    });
  }
}

function eventDerivedMismatchDetails(
  expected: EventDerivedStats,
  actual: Pick<PlayerSeasonStats, EventDerivedStatField> | undefined,
): string[] {
  if (!actual) {
    return EVENT_DERIVED_FIELDS
      .filter((field) => expected[field] > 0)
      .map((field) => `${field} expected ${expected[field]} but row is missing`);
  }
  return EVENT_DERIVED_FIELDS
    .filter((field) => expected[field] !== actual[field])
    .map((field) => `${field} expected ${expected[field]} but found ${actual[field]}`);
}

function validateEventDerivedStats(
  world: GameWorld,
  eventDerivedByPlayer: Map<string, EventDerivedStats>,
  eventDerivedBySegment: Map<string, EventDerivedStats>,
  issues: WorldDataIssue[],
): void {
  const hasArchivedResults = world.seasonState.calendar.some((window) => (
    window.results.some((result) => result.detailsArchived)
  ));
  const playerIds = new Set([
    ...eventDerivedByPlayer.keys(),
    ...Object.entries(world.playerStats)
      .filter(([, stat]) => EVENT_DERIVED_FIELDS.some((field) => stat[field] > 0))
      .map(([playerId]) => playerId),
  ]);
  for (const playerId of playerIds) {
    const expected = eventDerivedByPlayer.get(playerId) ?? emptyEventDerivedStats();
    const actual = world.playerStats[playerId];
    const details = hasArchivedResults && actual
      ? EVENT_DERIVED_FIELDS
        .filter((field) => actual[field] < expected[field])
        .map((field) => `${field} expected at least ${expected[field]} but found ${actual[field]}`)
      : eventDerivedMismatchDetails(expected, actual);
    if (details.length === 0) continue;
    pushIssue(issues, {
      severity: 'warning',
      code: 'player_stat_event_mismatch',
      message: `playerStats row ${playerId} does not match completed match events: ${details.join(', ')}.`,
      teamId: actual?.teamId,
      playerId,
    });
  }

  if (Object.keys(world.playerStatSegments ?? {}).length === 0) return;

  const segmentKeys = new Set([
    ...eventDerivedBySegment.keys(),
    ...Object.entries(world.playerStatSegments ?? {})
      .filter(([, stat]) => EVENT_DERIVED_FIELDS.some((field) => stat[field] > 0))
      .map(([segmentKey]) => segmentKey),
  ]);
  for (const segmentKey of segmentKeys) {
    const expected = eventDerivedBySegment.get(segmentKey) ?? emptyEventDerivedStats();
    const [playerId, teamId] = segmentKey.split('@@');
    const actual = world.playerStatSegments?.[segmentKey];
    const details = hasArchivedResults && actual
      ? EVENT_DERIVED_FIELDS
        .filter((field) => actual[field] < expected[field])
        .map((field) => `${field} expected at least ${expected[field]} but found ${actual[field]}`)
      : eventDerivedMismatchDetails(expected, actual);
    if (details.length === 0) continue;
    pushIssue(issues, {
      severity: 'warning',
      code: 'player_segment_event_mismatch',
      message: `playerStatSegments row ${segmentKey} does not match completed match events: ${details.join(', ')}.`,
      teamId,
      playerId,
    });
  }
}

interface MatchdayDerivedStats {
  appearances: number;
  starts: number;
  substituteAppearances: number;
  minutesPlayed: number;
  cleanSheets: number;
}

function incrementMatchdayDerived(
  map: Map<string, MatchdayDerivedStats>,
  key: string,
  cleanSheet: boolean,
  role: 'starter' | 'bench',
  minutesPlayed: number,
): void {
  const current = map.get(key) ?? {
    appearances: 0, starts: 0, substituteAppearances: 0, minutesPlayed: 0, cleanSheets: 0,
  };
  map.set(key, {
    appearances: current.appearances + 1,
    starts: current.starts + (role === 'starter' ? 1 : 0),
    substituteAppearances: current.substituteAppearances + (role === 'bench' ? 1 : 0),
    minutesPlayed: current.minutesPlayed + minutesPlayed,
    cleanSheets: current.cleanSheets + (cleanSheet ? 1 : 0),
  });
}

function validateMatchdayDerivedStats(world: GameWorld, issues: WorldDataIssue[]): void {
  const results = (world.seasonState.calendar ?? []).flatMap((window) => window.results ?? []);
  if (results.length === 0) return;
  const hasLegacyResults = results.some((result) => !result.homeMatchday || !result.awayMatchday);
  const auditableResults = results.filter((result) => result.homeMatchday && result.awayMatchday);
  if (auditableResults.length === 0) return;

  const expectedByPlayer = new Map<string, MatchdayDerivedStats>();
  const expectedBySegment = new Map<string, MatchdayDerivedStats>();

  for (const result of auditableResults) {
    const homeClean = result.awayGoals + (result.etAwayGoals ?? 0) === 0;
    const awayClean = result.homeGoals + (result.etHomeGoals ?? 0) === 0;
    for (const [teamId, snapshot, clean] of [
      [result.homeTeamId, result.homeMatchday!, homeClean],
      [result.awayTeamId, result.awayMatchday!, awayClean],
    ] as const) {
      for (const player of snapshot.players) {
        const minutesPlayed = player.minutesPlayed ?? 90;
        if (minutesPlayed <= 0) continue;
        const earnsCleanSheet = clean && (player.position === 'DF' || player.position === 'GK');
        incrementMatchdayDerived(expectedByPlayer, player.playerId, earnsCleanSheet, player.role ?? 'starter', minutesPlayed);
        incrementMatchdayDerived(
          expectedBySegment,
          playerTeamStatKey(player.playerId, teamId),
          earnsCleanSheet,
          player.role ?? 'starter',
          minutesPlayed,
        );
      }
    }
  }

  for (const [playerId, stat] of Object.entries(world.playerStats ?? {})) {
    const expected = expectedByPlayer.get(playerId) ?? {
      appearances: 0, starts: 0, substituteAppearances: 0, minutesPlayed: 0, cleanSheets: 0,
    };
    if (hasLegacyResults ? stat.appearances < expected.appearances : stat.appearances !== expected.appearances) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'player_appearance_matchday_mismatch',
        message: `Player ${playerId} has ${stat.appearances} appearances, but persisted matchday squads explain ${expected.appearances}.`,
        teamId: stat.teamId,
        playerId,
      });
    }
    for (const [field, actual] of [
      ['starts', stat.starts ?? 0],
      ['substituteAppearances', stat.substituteAppearances ?? 0],
      ['minutesPlayed', stat.minutesPlayed ?? 0],
    ] as const) {
      if (hasLegacyResults ? actual >= expected[field] : actual === expected[field]) continue;
      pushIssue(issues, {
        severity: 'warning', code: `player_${field}_matchday_mismatch`,
        message: `Player ${playerId} has ${actual} ${field}, but participation snapshots explain ${expected[field]}.`,
        teamId: stat.teamId, playerId,
      });
    }
    if (hasLegacyResults ? stat.cleanSheets < expected.cleanSheets : stat.cleanSheets !== expected.cleanSheets) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'player_clean_sheet_matchday_mismatch',
        message: `Player ${playerId} has ${stat.cleanSheets} clean sheets, but persisted matchday squads explain ${expected.cleanSheets}.`,
        teamId: stat.teamId,
        playerId,
      });
    }
  }

  for (const [segmentKey, stat] of Object.entries(world.playerStatSegments ?? {})) {
    const expected = expectedBySegment.get(segmentKey) ?? {
      appearances: 0, starts: 0, substituteAppearances: 0, minutesPlayed: 0, cleanSheets: 0,
    };
    if (hasLegacyResults ? stat.appearances < expected.appearances : stat.appearances !== expected.appearances) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'player_segment_appearance_matchday_mismatch',
        message: `Player segment ${segmentKey} has ${stat.appearances} appearances, but persisted matchday squads explain ${expected.appearances}.`,
        teamId: stat.teamId,
        playerId: stat.playerId,
      });
    }
    for (const [field, actual] of [
      ['starts', stat.starts ?? 0],
      ['substituteAppearances', stat.substituteAppearances ?? 0],
      ['minutesPlayed', stat.minutesPlayed ?? 0],
    ] as const) {
      if (hasLegacyResults ? actual >= expected[field] : actual === expected[field]) continue;
      pushIssue(issues, {
        severity: 'warning', code: `player_segment_${field}_matchday_mismatch`,
        message: `Player segment ${segmentKey} has ${actual} ${field}, but participation snapshots explain ${expected[field]}.`,
        teamId: stat.teamId, playerId: stat.playerId,
      });
    }
    if (hasLegacyResults ? stat.cleanSheets < expected.cleanSheets : stat.cleanSheets !== expected.cleanSheets) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'player_segment_clean_sheet_matchday_mismatch',
        message: `Player segment ${segmentKey} has ${stat.cleanSheets} clean sheets, but persisted matchday squads explain ${expected.cleanSheets}.`,
        teamId: stat.teamId,
        playerId: stat.playerId,
      });
    }
  }
}

const PARTICIPATION_FIELDS = [
  'appearances',
  'starts',
  'substituteAppearances',
  'minutesPlayed',
  'cleanSheets',
] as const;

function validateParticipationCounters(world: GameWorld, issues: WorldDataIssue[]): void {
  const segmentsByPlayer = new Map<string, PlayerSeasonStats[]>();
  for (const segment of Object.values(world.playerStatSegments ?? {})) {
    const rows = segmentsByPlayer.get(segment.playerId) ?? [];
    rows.push(segment);
    segmentsByPlayer.set(segment.playerId, rows);

    const starts = segment.starts ?? 0;
    const substitutes = segment.substituteAppearances ?? 0;
    const minutes = segment.minutesPlayed ?? 0;
    if (starts + substitutes !== segment.appearances || minutes < 0 || minutes > segment.appearances * 120) {
      pushIssue(issues, {
        severity: 'error', code: 'player_segment_invalid_participation_totals',
        message: `Player segment ${segment.playerId}@@${segment.teamId} has inconsistent appearances, starts, substitutes, or minutes.`,
        teamId: segment.teamId, playerId: segment.playerId,
      });
    }
  }

  for (const [playerId, stat] of Object.entries(world.playerStats ?? {})) {
    const starts = stat.starts ?? 0;
    const substitutes = stat.substituteAppearances ?? 0;
    const minutes = stat.minutesPlayed ?? 0;
    if (starts + substitutes !== stat.appearances || minutes < 0 || minutes > stat.appearances * 120) {
      pushIssue(issues, {
        severity: 'error', code: 'player_invalid_participation_totals',
        message: `Player ${playerId} has inconsistent appearances, starts, substitutes, or minutes.`,
        teamId: stat.teamId, playerId,
      });
    }

    const segments = segmentsByPlayer.get(playerId);
    if (!segments || Object.keys(world.playerStatSegments ?? {}).length === 0) continue;
    const mismatches = PARTICIPATION_FIELDS.filter(field => {
      const aggregate = stat[field] ?? 0;
      const segmented = segments.reduce((sum, segment) => sum + (segment[field] ?? 0), 0);
      return aggregate !== segmented;
    });
    if (mismatches.length > 0) {
      pushIssue(issues, {
        severity: 'error', code: 'player_participation_segment_sum_mismatch',
        message: `Player ${playerId} aggregate participation differs from club segments for: ${mismatches.join(', ')}.`,
        teamId: stat.teamId, playerId,
      });
    }
  }
}

function isFreeMarketTeam(teamId: string): boolean {
  return teamId === '__free_market__';
}

function isFeeBearingTransfer(record: TransferRecord): boolean {
  return (record.type === 'transfer' || record.type === 'free_agent') && (record.fee ?? 0) > 0;
}

function transferOrder(record: TransferRecord): number {
  return record.season * 10000 + record.windowIndex;
}

function validateFreeAgentAndRetirementState(
  world: GameWorld,
  activePlayerTeams: Map<string, string>,
  issues: WorldDataIssue[],
): void {
  const freeAgentIds = new Set((world.freeAgentPool ?? []).map((player) => player.uuid));
  const retiredIds = new Set((world.retirementHistory ?? []).map((player) => player.uuid));

  for (const player of world.freeAgentPool ?? []) {
    const activeTeamId = activePlayerTeams.get(player.uuid);
    if (activeTeamId) {
      pushIssue(issues, {
        severity: 'error',
        code: 'free_agent_active_overlap',
        message: `Free agent ${player.uuid} is also active in squad ${activeTeamId}.`,
        teamId: activeTeamId,
        playerId: player.uuid,
      });
    }
    if (retiredIds.has(player.uuid)) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'free_agent_retired_overlap',
        message: `Free agent ${player.uuid} also appears in retirement history.`,
        teamId: player.teamId,
        playerId: player.uuid,
      });
    }
  }

  for (const retired of world.retirementHistory ?? []) {
    const activeTeamId = activePlayerTeams.get(retired.uuid);
    if (activeTeamId) {
      pushIssue(issues, {
        severity: 'error',
        code: 'retired_player_active_overlap',
        message: `Retired player ${retired.uuid} is also active in squad ${activeTeamId}.`,
        teamId: activeTeamId,
        playerId: retired.uuid,
      });
    }
    if (freeAgentIds.has(retired.uuid)) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'retired_player_free_agent_overlap',
        message: `Retired player ${retired.uuid} also appears in the free agent pool.`,
        teamId: retired.teamId,
        playerId: retired.uuid,
      });
    }
  }
}

function validateLatestTransferDestinations(
  world: GameWorld,
  activePlayerTeams: Map<string, string>,
  issues: WorldDataIssue[],
): void {
  const latestByPlayer = new Map<string, TransferRecord>();
  for (const record of world.transferHistory ?? []) {
    const existing = latestByPlayer.get(record.playerId);
    if (!existing || transferOrder(record) >= transferOrder(existing)) {
      latestByPlayer.set(record.playerId, record);
    }
  }

  const freeAgentIds = new Set((world.freeAgentPool ?? []).map((player) => player.uuid));
  const retiredIds = new Set((world.retirementHistory ?? []).map((player) => player.uuid));
  const unresolvedCutoffSeason = Math.max(1, world.seasonState.seasonNumber - 1);

  for (const record of latestByPlayer.values()) {
    const activeTeamId = activePlayerTeams.get(record.playerId);
    if (isFreeMarketTeam(record.toTeamId)) {
      if (activeTeamId) {
        pushIssue(issues, {
          severity: 'warning',
          code: 'transfer_latest_free_market_but_active',
          message: `Latest transfer sends ${record.playerId} to the free market, but they are active in ${activeTeamId}.`,
          teamId: activeTeamId,
          playerId: record.playerId,
          season: record.season,
        });
      }
      if (
        record.season >= unresolvedCutoffSeason
        && !activeTeamId
        && !freeAgentIds.has(record.playerId)
        && !retiredIds.has(record.playerId)
      ) {
        pushIssue(issues, {
          severity: 'warning',
          code: 'transfer_latest_destination_unresolved',
          message: `Latest transfer sends ${record.playerId} to the free market, but they are neither in freeAgentPool nor retired.`,
          teamId: record.toTeamId,
          playerId: record.playerId,
          season: record.season,
        });
      }
      continue;
    }

    if (activeTeamId && activeTeamId !== record.toTeamId) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'transfer_latest_squad_mismatch',
        message: `Latest transfer sends ${record.playerId} to ${record.toTeamId}, but active squad is ${activeTeamId}.`,
        teamId: record.toTeamId,
        playerId: record.playerId,
        season: record.season,
      });
      continue;
    }

    if (
      record.season >= unresolvedCutoffSeason
      && !activeTeamId
      && !retiredIds.has(record.playerId)
      && !freeAgentIds.has(record.playerId)
    ) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'transfer_latest_destination_unresolved',
        message: `Latest transfer sends ${record.playerId} to ${record.toTeamId}, but no active, retired, or free-agent state resolves them.`,
        teamId: record.toTeamId,
        playerId: record.playerId,
        season: record.season,
      });
    }
  }
}

function validateTransferFinanceHistory(
  world: GameWorld,
  issues: WorldDataIssue[],
): void {
  const expected = new Map<string, { season: number; teamId: string; income: number; expense: number }>();
  const ensure = (season: number, teamId: string) => {
    const key = `${season}@@${teamId}`;
    const current = expected.get(key) ?? { season, teamId, income: 0, expense: 0 };
    expected.set(key, current);
    return current;
  };

  for (const record of world.transferHistory ?? []) {
    if (!isFeeBearingTransfer(record)) continue;
    const fee = record.fee ?? 0;
    if (!isFreeMarketTeam(record.fromTeamId)) ensure(record.season, record.fromTeamId).income += fee;
    if (!isFreeMarketTeam(record.toTeamId)) ensure(record.season, record.toTeamId).expense += fee;
  }

  for (const row of expected.values()) {
    const finance = world.teamFinances[row.teamId];
    const history = finance?.history.find((entry) => entry.season === row.season);
    if (!history) continue;
    // Finance archives round to one decimal. Normalize the reconstructed
    // transfer sum to the same boundary so 77.6 is not treated as lower than
    // the IEEE-754 artifact 77.60000000000001.
    const expectedIncome = Math.round(row.income * 10) / 10;
    const expectedExpense = Math.round(row.expense * 10) / 10;
    const actualIncome = Math.round(history.transferIncome * 10) / 10;
    const actualExpense = Math.round(history.transferExpense * 10) / 10;
    const missingIncome = actualIncome < expectedIncome;
    const missingExpense = actualExpense < expectedExpense;
    if (!missingIncome && !missingExpense) continue;
    pushIssue(issues, {
      severity: 'warning',
      code: 'transfer_finance_history_mismatch',
      message: `Finance history for ${row.teamId} S${row.season} has transfer income/expense ${history.transferIncome}/${history.transferExpense}, below transferHistory expectation ${expectedIncome}/${expectedExpense}.`,
      teamId: row.teamId,
      season: row.season,
    });
  }
}

function parseManualTransferNewsId(id: string): {
  season: number;
  windowIndex: number;
  playerId: string;
  toTeamId: string;
} | null {
  const match = /^manual-transfer:S(\d+):W(\d+):(.+):([^:]+)$/.exec(id);
  if (!match) return null;
  return {
    season: Number(match[1]),
    windowIndex: Number(match[2]),
    playerId: match[3],
    toTeamId: match[4],
  };
}

function validateTransferNewsLinks(
  world: GameWorld,
  issues: WorldDataIssue[],
): void {
  for (const news of world.newsLog ?? []) {
    const parsed = parseManualTransferNewsId(news.id);
    if (!parsed) continue;
    if (news.seasonNumber !== parsed.season || news.windowIndex !== parsed.windowIndex) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'transfer_news_identity_mismatch',
        message: `Transfer news ${news.id} has season/window ${news.seasonNumber}/${news.windowIndex}, but its id encodes ${parsed.season}/${parsed.windowIndex}.`,
        teamId: parsed.toTeamId,
        playerId: parsed.playerId,
        season: parsed.season,
      });
    }

    const hasTransfer = (world.transferHistory ?? []).some((record) =>
      record.season === parsed.season
      && record.windowIndex === parsed.windowIndex
      && record.playerId === parsed.playerId
      && record.toTeamId === parsed.toTeamId
    );
    if (hasTransfer) continue;
    pushIssue(issues, {
      severity: 'warning',
      code: 'transfer_news_history_mismatch',
      message: `Transfer news ${news.id} does not resolve to a matching transferHistory record.`,
      teamId: parsed.toTeamId,
      playerId: parsed.playerId,
      season: parsed.season,
    });
  }
}

function validateTransferConsistency(
  world: GameWorld,
  activePlayerTeams: Map<string, string>,
  issues: WorldDataIssue[],
): void {
  validateFreeAgentAndRetirementState(world, activePlayerTeams, issues);
  validateLatestTransferDestinations(world, activePlayerTeams, issues);
  validateTransferFinanceHistory(world, issues);
  validateTransferNewsLinks(world, issues);
}

function countScorelineEvents(result: MatchResult): { home: number; away: number } {
  let home = 0;
  let away = 0;
  const countableTypes = new Set(['goal', 'own_goal']);

  for (const event of result.events ?? []) {
    if (!countableTypes.has(event.type)) continue;
    if (event.minute > 120) continue;
    if (event.teamId === result.homeTeamId) home++;
    if (event.teamId === result.awayTeamId) away++;
  }

  return { home, away };
}

function snapshotForTeam(result: MatchResult, teamId: string) {
  if (teamId === result.homeTeamId) return result.homeMatchday;
  if (teamId === result.awayTeamId) return result.awayMatchday;
  return undefined;
}

function isOnFieldAtMinute(
  result: MatchResult,
  teamId: string,
  playerId: string,
  minute: number,
  allowDismissalMinute = false,
): boolean {
  const snapshot = snapshotForTeam(result, teamId);
  if (!snapshot) return true;
  const entry = snapshot.players.find(player => player.playerId === playerId);
  if (!entry) return false;
  if (entry.enteredMinute === undefined || entry.exitedMinute === undefined) return true;
  if (entry.enteredMinute == null || entry.exitedMinute == null) return false;
  const effectiveMinute = Math.min(minute, (snapshot.durationMinutes ?? (result.extraTime ? 120 : 90)) - 1);
  if (entry.enteredMinute > effectiveMinute) return false;
  if (entry.exitedMinute < effectiveMinute) return false;
  if (entry.exitedMinute === effectiveMinute && !allowDismissalMinute) return false;
  return !(result.events ?? []).some(event =>
    event.type === 'red_card'
    && event.teamId === teamId
    && event.playerId === playerId
    && event.minute < minute
  );
}

function validateEventSemantics(
  world: GameWorld,
  result: MatchResult,
  event: MatchEvent,
  activePlayers: Map<string, Player>,
  activePlayerTeams: Map<string, string>,
  matchdayPlayerIdsByTeam: Map<string, MatchdayAuditContext>,
  issues: WorldDataIssue[],
  resultGlobalWindowIdx?: number,
  resultSeason?: number,
  resultWindowIndex?: number,
): void {
  const eventTeamInFixture = event.teamId === result.homeTeamId || event.teamId === result.awayTeamId;
  if (!eventTeamInFixture) {
    pushIssue(issues, {
      severity: 'error',
      code: 'event_team_not_in_fixture',
      message: `Match event team ${event.teamId} is not part of fixture ${result.fixtureId}.`,
      teamId: event.teamId,
      fixtureId: result.fixtureId,
    });
  }

  if (event.type === 'substitution') {
    const matchingSubstitution = snapshotForTeam(result, event.teamId)?.substitutions?.some(substitution =>
      substitution.minute === event.minute
      && substitution.playerInId === event.playerInId
      && substitution.playerOutId === event.playerOutId
    );
    if (!matchingSubstitution) {
      pushIssue(issues, {
        severity: 'error', code: 'substitution_event_snapshot_mismatch',
        message: `Substitution event at ${event.minute}' does not match ${event.teamId}'s participation snapshot.`,
        teamId: event.teamId, fixtureId: result.fixtureId,
      });
    }
  }

  if (
    event.playerId
    && event.type !== 'own_goal'
    && eventTeamInFixture
    && isKnownPlayer(world, event.playerId, activePlayers)
    && !playerHasKnownTeamAssociation(world, event.playerId, event.teamId, activePlayerTeams)
  ) {
    pushIssue(issues, {
      severity: 'warning',
      code: 'event_player_team_mismatch',
      message: `Match event player ${event.playerId} is not associated with event team ${event.teamId}.`,
      teamId: event.teamId,
      playerId: event.playerId,
      fixtureId: result.fixtureId,
    });
  }

  if (
    event.playerId
    && event.type !== 'own_goal'
    && eventTeamInFixture
    && resultSeason !== undefined
    && resultWindowIndex !== undefined
  ) {
    const exactTeam = resolvePlayerTeamAtWindow(
      world,
      event.playerId,
      resultSeason,
      resultWindowIndex,
    );
    if (exactTeam.hasTransferEvidence && exactTeam.teamId !== event.teamId) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'event_player_team_at_window_mismatch',
        message: `Match event player ${event.playerId} belonged to ${exactTeam.teamId ?? 'the free market'} at S${resultSeason} W${resultWindowIndex}, not ${event.teamId}.`,
        teamId: event.teamId,
        playerId: event.playerId,
        fixtureId: result.fixtureId,
        season: resultSeason,
      });
    }
  }

  const attackingTeamId = event.type === 'gk_save' || event.type === 'df_block'
    ? getOpposingTeamId(result, event.teamId)
    : undefined;
  const deniedPlayerIds = [event.deniedScorerId, event.deniedAssisterId].filter(Boolean) as string[];
  if (attackingTeamId) {
    for (const playerId of deniedPlayerIds) {
      if (resultSeason !== undefined && resultWindowIndex !== undefined) {
        const exactTeam = resolvePlayerTeamAtWindow(world, playerId, resultSeason, resultWindowIndex);
        if (exactTeam.hasTransferEvidence && exactTeam.teamId !== attackingTeamId) {
          pushIssue(issues, {
            severity: 'warning',
            code: 'event_denied_player_team_at_window_mismatch',
            message: `Denied attacking player ${playerId} belonged to ${exactTeam.teamId ?? 'the free market'} at S${resultSeason} W${resultWindowIndex}, not ${attackingTeamId}.`,
            teamId: attackingTeamId,
            playerId,
            fixtureId: result.fixtureId,
            season: resultSeason,
          });
          continue;
        }
      }
      if (!isKnownPlayer(world, playerId, activePlayers)) continue;
      if (playerHasKnownTeamAssociation(world, playerId, attackingTeamId, activePlayerTeams)) continue;
      pushIssue(issues, {
        severity: 'warning',
        code: 'event_denied_player_team_mismatch',
        message: `Denied attacking player ${playerId} is not associated with attacking team ${attackingTeamId}.`,
        teamId: attackingTeamId,
        playerId,
        fixtureId: result.fixtureId,
      });
    }
  }

  if (resultGlobalWindowIdx !== undefined) {
    const unavailableChecks = [
      { playerId: event.playerId, teamId: event.teamId, denied: false },
      ...deniedPlayerIds.map((playerId) => ({ playerId, teamId: attackingTeamId, denied: true })),
    ];
    for (const check of unavailableChecks) {
      if (!check.playerId || !check.teamId) continue;
      const checkPlayer = activePlayers.get(check.playerId);
      if (!checkPlayer) continue;
      const injured = isPlayerInjuredAtWindow(checkPlayer, resultGlobalWindowIdx, resultSeason);
      const suspended = isPlayerSuspendedAtWindow(checkPlayer, resultGlobalWindowIdx, resultSeason);
      if (!injured && !suspended) continue;
      const matchday = matchdayPlayerIdsByTeam.get(check.teamId);
      const emergencyException = Boolean(
        matchday?.emergencyFloor
        && matchday.playerIds.has(check.playerId)
        && matchday.unavailablePlayerIds.has(check.playerId),
      );
      const subject = check.denied ? 'denied attacking player' : 'match event player';
      const availabilityReason = injured ? 'injury' : 'suspension';
      pushIssue(issues, {
        severity: 'warning',
        code: emergencyException
          ? (check.denied ? 'event_denied_player_emergency_exception' : 'event_player_emergency_exception')
          : suspended
            ? (check.denied ? 'event_denied_player_suspended' : 'event_player_suspended')
            : (check.denied ? 'event_denied_player_unavailable' : 'event_player_unavailable'),
        message: emergencyException
          ? `Fixture ${result.fixtureId} used ${subject} ${check.playerId} despite ${availabilityReason} because only ${matchday?.availableCount ?? 0} players were available.`
          : `Fixture ${result.fixtureId} references ${subject} ${check.playerId} while ${availabilityReason} history says they were unavailable at global window ${resultGlobalWindowIdx}.`,
        teamId: check.teamId,
        playerId: check.playerId,
        fixtureId: result.fixtureId,
      });
    }
  }

  if (eventTeamInFixture && event.playerId && event.type !== 'own_goal') {
    const activeTeamId = activePlayerTeams.get(event.playerId);
    const matchdayPlayerIds = matchdayPlayerIdsByTeam.get(event.teamId)?.playerIds;
    if (
      activeTeamId === event.teamId
      && matchdayPlayerIds
      && !matchdayPlayerIds.has(event.playerId)
    ) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'event_player_not_in_matchday',
        message: `Match event player ${event.playerId} is associated with ${event.teamId} but was not in that fixture's matchday squad.`,
        teamId: event.teamId,
        playerId: event.playerId,
        fixtureId: result.fixtureId,
      });
    }
    if (!isOnFieldAtMinute(result, event.teamId, event.playerId, event.minute, event.type === 'red_card')) {
      pushIssue(issues, {
        severity: 'error', code: 'event_player_not_on_field',
        message: `Match event player ${event.playerId} was not on the field for ${event.teamId} at ${event.minute}'.`,
        teamId: event.teamId, playerId: event.playerId, fixtureId: result.fixtureId,
      });
    }
  }

  if (attackingTeamId) {
    const matchdayPlayerIds = matchdayPlayerIdsByTeam.get(attackingTeamId)?.playerIds;
    for (const playerId of deniedPlayerIds) {
      if (!matchdayPlayerIds) continue;
      if (activePlayerTeams.get(playerId) !== attackingTeamId) continue;
      if (matchdayPlayerIds.has(playerId)) continue;
      pushIssue(issues, {
        severity: 'warning',
        code: 'event_denied_player_not_in_matchday',
        message: `Denied attacking player ${playerId} is associated with ${attackingTeamId} but was not in that fixture's matchday squad.`,
        teamId: attackingTeamId,
        playerId,
        fixtureId: result.fixtureId,
      });
    }
    for (const playerId of deniedPlayerIds) {
      if (isOnFieldAtMinute(result, attackingTeamId, playerId, event.minute)) continue;
      pushIssue(issues, {
        severity: 'error', code: 'event_denied_player_not_on_field',
        message: `Denied attacking player ${playerId} was not on the field for ${attackingTeamId} at ${event.minute}'.`,
        teamId: attackingTeamId, playerId, fixtureId: result.fixtureId,
      });
    }
  }

  if ((event.type === 'goal' || event.type === 'assist' || event.type === 'own_goal') && event.minute > 120) {
    pushIssue(issues, {
      severity: 'warning',
      code: 'regular_event_after_match_time',
      message: `Match event ${event.type} at ${event.minute}' should not count after 120'.`,
      teamId: event.teamId,
      playerId: event.playerId,
      fixtureId: result.fixtureId,
    });
  }

  if ((event.type === 'penalty_goal' || event.type === 'penalty_miss') && event.minute <= 120) {
    pushIssue(issues, {
      severity: 'warning',
      code: 'shootout_event_inside_match_time',
      message: `${event.type} at ${event.minute}' appears inside regulation/extra time; regular penalties should be emitted as goal/miss events.`,
      teamId: event.teamId,
      playerId: event.playerId,
      fixtureId: result.fixtureId,
    });
  }

  const player = event.playerId ? activePlayers.get(event.playerId) : undefined;
  if (!player) return;

  if ((event.type === 'save' || event.type === 'gk_save') && player.position !== 'GK') {
    pushIssue(issues, {
      severity: 'warning',
      code: 'invalid_goalkeeper_event_position',
      message: `${event.type} event references non-GK player ${event.playerId}.`,
      teamId: event.teamId,
      playerId: event.playerId,
      fixtureId: result.fixtureId,
    });
  }

  if (event.type === 'df_block' && player.position !== 'DF') {
    pushIssue(issues, {
      severity: 'warning',
      code: 'invalid_defender_event_position',
      message: `df_block event references non-DF player ${event.playerId}.`,
      teamId: event.teamId,
      playerId: event.playerId,
      fixtureId: result.fixtureId,
    });
  }
}

function validateResult(
  world: GameWorld,
  result: MatchResult,
  activePlayers: Map<string, Player>,
  activePlayerTeams: Map<string, string>,
  issues: WorldDataIssue[],
  resultGlobalWindowIdx?: number,
  resultSeason?: number,
  resultWindowIndex?: number,
): void {
  const matchdayPlayerIdsByTeam = buildMatchdayPlayerIds(
    world,
    result,
    resultGlobalWindowIdx,
    resultSeason,
    activePlayers,
  );
  if (result.homeMatchday) {
    validateMatchdaySnapshot(
      world,
      result,
      result.homeTeamId,
      result.homeMatchday,
      activePlayers,
      activePlayerTeams,
      issues,
      resultSeason,
      resultWindowIndex,
    );
  }
  if (result.awayMatchday) {
    validateMatchdaySnapshot(
      world,
      result,
      result.awayTeamId,
      result.awayMatchday,
      activePlayers,
      activePlayerTeams,
      issues,
      resultSeason,
      resultWindowIndex,
    );
  }

  if (!world.teamBases[result.homeTeamId]) {
    pushIssue(issues, {
      severity: 'error',
      code: 'result_unknown_home_team',
      message: `Match result references unknown home team ${result.homeTeamId}.`,
      teamId: result.homeTeamId,
      fixtureId: result.fixtureId,
    });
  }
  if (!world.teamBases[result.awayTeamId]) {
    pushIssue(issues, {
      severity: 'error',
      code: 'result_unknown_away_team',
      message: `Match result references unknown away team ${result.awayTeamId}.`,
      teamId: result.awayTeamId,
      fixtureId: result.fixtureId,
    });
  }

  const expectedHome = result.homeGoals + (result.etHomeGoals ?? 0);
  const expectedAway = result.awayGoals + (result.etAwayGoals ?? 0);
  const counted = countScorelineEvents(result);
  if (!result.detailsArchived && (counted.home !== expectedHome || counted.away !== expectedAway)) {
    pushIssue(issues, {
      severity: 'warning',
      code: 'scoreline_event_mismatch',
      message: `Fixture ${result.fixtureId} scoreline is ${expectedHome}-${expectedAway}, but countable goal events are ${counted.home}-${counted.away}.`,
      fixtureId: result.fixtureId,
    });
  }

  for (const event of result.events ?? []) {
    if (!world.teamBases[event.teamId]) {
      pushIssue(issues, {
        severity: 'error',
        code: 'event_unknown_team',
        message: `Match event references unknown team ${event.teamId}.`,
        teamId: event.teamId,
        fixtureId: result.fixtureId,
      });
    }

    validateEventSemantics(
      world,
      result,
      event,
      activePlayers,
      activePlayerTeams,
      matchdayPlayerIdsByTeam,
      issues,
      resultGlobalWindowIdx,
      resultSeason,
      resultWindowIndex,
    );

    const eventPlayerIds = [
      ['event_unknown_player', event.playerId],
      ['event_unknown_denied_scorer', event.deniedScorerId],
      ['event_unknown_denied_assister', event.deniedAssisterId],
      ['event_unknown_player_in', event.playerInId],
      ['event_unknown_player_out', event.playerOutId],
    ] as const;

    for (const [code, playerId] of eventPlayerIds) {
      if (!playerId) continue;
      if (activePlayers.has(playerId)) continue;
      if (world.playerStats[playerId]) continue;
      if (isKnownHistoricalPlayer(world, playerId)) continue;
      pushIssue(issues, {
        severity: 'warning',
        code,
        message: `Match event references unknown player ${playerId}.`,
        playerId,
        fixtureId: result.fixtureId,
      });
    }
  }
}

export function validateWorldData(world: GameWorld): WorldDataValidationResult {
  const issues: WorldDataIssue[] = [];
  const eventDerivedByPlayer = new Map<string, EventDerivedStats>();
  const eventDerivedBySegment = new Map<string, EventDerivedStats>();
  const teamBaseIds = new Set(Object.keys(world.teamBases ?? {}));
  const teamStateIds = new Set(Object.keys(world.teamStates ?? {}));
  const squadTeamIds = new Set(Object.keys(world.squads ?? {}));
  const freeAgentIds = new Set((world.freeAgentPool ?? []).map((player) => player.uuid));
  const { activePlayers, activePlayerTeams, duplicatePlayerIds } = indexActivePlayers(world.squads);
  const completedResultWindowCount = (world.seasonState?.calendar ?? [])
    .filter((window) => (window.results?.length ?? 0) > 0)
    .length;
  const currentSeasonStartGlobalIdx = Math.max(
    0,
    (world.totalElapsedWindows ?? completedResultWindowCount) - completedResultWindowCount,
  );
  let completedResultWindowOrdinal = 0;

  for (const teamId of teamBaseIds) {
    if (!teamStateIds.has(teamId)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'missing_team_state',
        message: `Team ${teamId} has a base record but no team state.`,
        teamId,
      });
    }
    if (!squadTeamIds.has(teamId)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'missing_squad',
        message: `Team ${teamId} has a base record but no squad.`,
        teamId,
      });
    }
  }

  for (const teamId of teamStateIds) {
    if (!teamBaseIds.has(teamId)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'team_state_without_base',
        message: `Team state ${teamId} does not resolve to a team base.`,
        teamId,
      });
    }
  }

  for (const teamId of squadTeamIds) {
    if (!teamBaseIds.has(teamId)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'squad_without_team_base',
        message: `Squad ${teamId} does not resolve to a team base.`,
        teamId,
      });
    }
    if (!teamStateIds.has(teamId)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'squad_without_team_state',
        message: `Squad ${teamId} does not resolve to a team state.`,
        teamId,
      });
    }
  }

  for (const playerId of duplicatePlayerIds) {
    pushIssue(issues, {
      severity: 'error',
      code: 'duplicate_active_player',
      message: `Player ${playerId} appears in multiple active squads.`,
      playerId,
    });
  }

  for (const [teamId, squad] of Object.entries(world.squads ?? {})) {
    for (const player of squad ?? []) {
      if (player.teamId !== teamId) {
        pushIssue(issues, {
          severity: 'error',
          code: 'player_team_mismatch',
          message: `Player ${player.uuid} is in squad ${teamId}, but player.teamId is ${player.teamId}.`,
          teamId,
          playerId: player.uuid,
        });
      }

      if (!world.playerStats[player.uuid]) {
        pushIssue(issues, {
          severity: 'error',
          code: 'missing_player_stats',
          message: `Active player ${player.uuid} has no playerStats row.`,
          teamId,
          playerId: player.uuid,
        });
      }
    }
  }

  for (const [playerId, stat] of Object.entries(world.playerStats ?? {})) {
    if (stat.playerId !== playerId) {
      pushIssue(issues, {
        severity: 'error',
        code: 'player_stat_key_mismatch',
        message: `playerStats key ${playerId} contains playerId ${stat.playerId}.`,
        teamId: stat.teamId,
        playerId,
      });
    }

    if (!teamBaseIds.has(stat.teamId)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'player_stat_unknown_team',
        message: `playerStats row ${playerId} references unknown team ${stat.teamId}.`,
        teamId: stat.teamId,
        playerId,
      });
    }

    const liveTeam = activePlayerTeams.get(playerId);
    if (liveTeam && liveTeam !== stat.teamId) {
      pushIssue(issues, {
        severity: 'error',
        code: 'player_stat_team_mismatch',
        message: `playerStats row ${playerId} belongs to ${stat.teamId}, but active squad is ${liveTeam}.`,
        teamId: stat.teamId,
        playerId,
      });
    }

    if (!liveTeam && !freeAgentIds.has(playerId) && !isKnownHistoricalPlayer(world, playerId)) {
      pushIssue(issues, {
        severity: 'warning',
        code: 'orphan_player_stats',
        message: `playerStats row ${playerId} does not resolve to an active, retired, or historical player.`,
        teamId: stat.teamId,
        playerId,
      });
    }

    if (stat.cleanSheets > stat.appearances) {
      pushIssue(issues, {
        severity: 'error',
        code: 'clean_sheets_exceed_appearances',
        message: `Player ${playerId} has ${stat.cleanSheets} clean sheets but only ${stat.appearances} appearances.`,
        teamId: stat.teamId,
        playerId,
      });
    }
    if (stat.bigChances < stat.goals) {
      pushIssue(issues, {
        severity: 'error',
        code: 'big_chances_below_goals',
        message: `Player ${playerId} has fewer big chances than goals.`,
        teamId: stat.teamId,
        playerId,
      });
    }
    if (stat.keyPasses < stat.assists) {
      pushIssue(issues, {
        severity: 'error',
        code: 'key_passes_below_assists',
        message: `Player ${playerId} has fewer key passes than assists.`,
        teamId: stat.teamId,
        playerId,
      });
    }

    const livePlayer = activePlayers.get(playerId);
    if (livePlayer && stat.saves > 0 && livePlayer.position !== 'GK') {
      pushIssue(issues, {
        severity: 'warning',
        code: 'non_gk_saves',
        message: `Non-GK player ${playerId} has saves.`,
        teamId: stat.teamId,
        playerId,
      });
    }
    if (livePlayer && stat.keyBlocks > 0 && livePlayer.position !== 'DF') {
      pushIssue(issues, {
        severity: 'warning',
        code: 'non_df_key_blocks',
        message: `Non-DF player ${playerId} has key blocks.`,
        teamId: stat.teamId,
        playerId,
      });
    }
  }

  const standings = [
    ...(world.league1Standings ?? []),
    ...(world.league2Standings ?? []),
    ...(world.league3Standings ?? []),
  ];
  for (const standing of standings) {
    if (!teamBaseIds.has(standing.teamId)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'standing_unknown_team',
        message: `Standing row references unknown team ${standing.teamId}.`,
        teamId: standing.teamId,
      });
    }
  }

  for (const [windowIndex, window] of (world.seasonState?.calendar ?? []).entries()) {
    for (const fixture of window.fixtures ?? []) {
      if (!teamBaseIds.has(fixture.homeTeamId)) {
        pushIssue(issues, {
          severity: 'error',
          code: 'fixture_unknown_home_team',
          message: `Fixture ${fixture.id} references unknown home team ${fixture.homeTeamId}.`,
          teamId: fixture.homeTeamId,
          fixtureId: fixture.id,
        });
      }
      if (!teamBaseIds.has(fixture.awayTeamId)) {
        pushIssue(issues, {
          severity: 'error',
          code: 'fixture_unknown_away_team',
          message: `Fixture ${fixture.id} references unknown away team ${fixture.awayTeamId}.`,
          teamId: fixture.awayTeamId,
          fixtureId: fixture.id,
        });
      }
    }
    const hasResults = (window.results?.length ?? 0) > 0;
    const resultGlobalWindowIdx = hasResults
      ? currentSeasonStartGlobalIdx + completedResultWindowOrdinal
      : undefined;
    for (const result of window.results ?? []) {
      validateResult(
        world,
        result,
        activePlayers,
        activePlayerTeams,
        issues,
        resultGlobalWindowIdx,
        world.seasonState.seasonNumber,
        windowIndex,
      );
      collectEventDerivedStats(result, eventDerivedByPlayer, eventDerivedBySegment);
    }
    if (hasResults) completedResultWindowOrdinal++;
  }

  validateEventDerivedStats(world, eventDerivedByPlayer, eventDerivedBySegment, issues);
  validateMatchdayDerivedStats(world, issues);
  validateParticipationCounters(world, issues);
  validateTransferConsistency(world, activePlayerTeams, issues);

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}
