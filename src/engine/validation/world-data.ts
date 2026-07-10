import type { GameWorld } from '../season/season-manager';
import type { Player } from '../../types/player';
import type { MatchResult } from '../../types/match';

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

function countScorelineEvents(result: MatchResult): { home: number; away: number } {
  let home = 0;
  let away = 0;
  const countableTypes = new Set(['goal', 'own_goal', 'penalty_goal']);

  for (const event of result.events ?? []) {
    if (!countableTypes.has(event.type)) continue;
    if (event.minute > 120) continue;
    if (event.teamId === result.homeTeamId) home++;
    if (event.teamId === result.awayTeamId) away++;
  }

  return { home, away };
}

function validateResult(
  world: GameWorld,
  result: MatchResult,
  activePlayers: Map<string, Player>,
  issues: WorldDataIssue[],
): void {
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
  if (counted.home !== expectedHome || counted.away !== expectedAway) {
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

    const eventPlayerIds = [
      ['event_unknown_player', event.playerId],
      ['event_unknown_denied_scorer', event.deniedScorerId],
      ['event_unknown_denied_assister', event.deniedAssisterId],
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
  const teamBaseIds = new Set(Object.keys(world.teamBases ?? {}));
  const teamStateIds = new Set(Object.keys(world.teamStates ?? {}));
  const squadTeamIds = new Set(Object.keys(world.squads ?? {}));
  const { activePlayers, activePlayerTeams, duplicatePlayerIds } = indexActivePlayers(world.squads);

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

    if (!liveTeam && !isKnownHistoricalPlayer(world, playerId)) {
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

  for (const window of world.seasonState?.calendar ?? []) {
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
    for (const result of window.results ?? []) {
      validateResult(world, result, activePlayers, issues);
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}
