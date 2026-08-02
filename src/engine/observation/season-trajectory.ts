import type { GameWorld } from '../season/season-manager';
import { createInitialStandings, updateStandings } from '../standings/standings';
import { analyzeDestinyDeviation, type DestinyDeviationTier } from '../match/analysis';
import type { ObservationTheme, ObservationThemeType } from './observation-theme';

export type ObserverSeasonPhase = 'opening' | 'midseason' | 'run_in' | 'final';

export interface ObserverSeasonCheckpoint {
  phase: ObserverSeasonPhase;
  played: number;
  position: number;
  points: number;
  goalDifference: number;
}

export interface ObserverSeasonTrajectory {
  seasonNumber: number;
  teamId: string;
  leagueLevel: 1 | 2 | 3;
  checkpoints: ObserverSeasonCheckpoint[];
  judgment?: {
    total: number;
    correct: number;
    currentStreak: number;
    bestStreak: number;
  };
  /** Frozen preseason reference; future team changes cannot rewrite the archive. */
  expectedPosition?: number;
  /** UUID only; season statistics and identity remain canonical elsewhere. */
  representativePlayerId?: string;
  /** Minimal facts for the season's most surprising observed-team result. */
  destinyDeviation?: {
    fixtureId: string;
    homeTeamId: string;
    awayTeamId: string;
    homeGoals: number;
    awayGoals: number;
    competitionName: string;
    roundLabel: string;
    score: number;
    actualProbability: number;
    tier: DestinyDeviationTier;
  };
  /** Minimal final theme reference; all result evidence stays derived from canonical history. */
  theme?: {
    type: ObservationThemeType;
    playerId?: string;
  };
}

export const OBSERVER_SEASON_TRAJECTORY_LIMIT = 40;

const PHASE_TARGETS: Array<{ phase: ObserverSeasonPhase; ratio: number }> = [
  { phase: 'opening', ratio: 0.25 },
  { phase: 'midseason', ratio: 0.5 },
  { phase: 'run_in', ratio: 0.75 },
  { phase: 'final', ratio: 1 },
];

function expectedPosition(teamCount: number, expectation: number): number {
  return Math.max(1, Math.min(
    teamCount,
    Math.round(teamCount * (1 - (expectation - 1) / 4)),
  ));
}

function playerImpact(
  position: 'GK' | 'DF' | 'MF' | 'FW' | undefined,
  stat: GameWorld['playerStats'][string],
): number {
  if (position === 'GK') {
    return stat.saves * 0.7 + stat.cleanSheets * 3 + stat.appearances * 0.15;
  }
  if (position === 'DF') {
    return stat.keyBlocks * 1.5 + stat.cleanSheets * 1.2
      + stat.goals * 4 + stat.assists * 3 + stat.appearances * 0.1;
  }
  return stat.goals * 4 + stat.assists * 3
    + stat.bigChances * 0.2 + stat.keyPasses * 0.2 + stat.appearances * 0.1;
}

function selectRepresentativePlayerId(
  world: Pick<GameWorld, 'squads' | 'playerStats'>,
  teamId: string,
): string | undefined {
  const positionByPlayer = new Map(
    (world.squads[teamId] ?? []).map(player => [player.uuid, player.position]),
  );
  return Object.values(world.playerStats)
    .filter(stat => stat.teamId === teamId && stat.appearances > 0)
    .sort((a, b) =>
      playerImpact(positionByPlayer.get(b.playerId), b)
      - playerImpact(positionByPlayer.get(a.playerId), a)
      || b.appearances - a.appearances
      || a.playerId.localeCompare(b.playerId),
    )[0]?.playerId;
}

function selectDestinyDeviation(
  world: Pick<GameWorld, 'seasonState'>,
  teamId: string,
): ObserverSeasonTrajectory['destinyDeviation'] {
  const results = world.seasonState.calendar.flatMap(window =>
    window.completed ? window.results ?? [] : [],
  );
  const observedResults = results.filter(result =>
    result.homeTeamId === teamId || result.awayTeamId === teamId,
  );
  const source = observedResults.length > 0 ? observedResults : results;
  const selected = source
    .map(result => ({ result, deviation: analyzeDestinyDeviation(result) }))
    .filter(entry => entry.deviation.actualProbability < 100)
    .sort((a, b) =>
      b.deviation.score - a.deviation.score
      || a.result.fixtureId.localeCompare(b.result.fixtureId),
    )[0];
  if (!selected) return undefined;
  const { result, deviation } = selected;
  return {
    fixtureId: result.fixtureId,
    homeTeamId: result.homeTeamId,
    awayTeamId: result.awayTeamId,
    homeGoals: result.homeGoals + (result.etHomeGoals ?? 0),
    awayGoals: result.awayGoals + (result.etAwayGoals ?? 0),
    competitionName: result.competitionName,
    roundLabel: result.roundLabel,
    score: deviation.score,
    actualProbability: deviation.actualProbability,
    tier: deviation.tier,
  };
}

/**
 * Replays only authoritative completed league results. The resulting four
 * checkpoints are the smallest piece of a season that cannot be recovered
 * after the live calendar rolls over.
 */
export function buildObserverSeasonTrajectory(
  world: Pick<GameWorld, 'seasonState' | 'seasonStartLevels' | 'observationRecord'>
    & Partial<Pick<GameWorld, 'teamBases' | 'squads' | 'playerStats'>>,
  teamId: string,
  observationTheme?: Pick<ObservationTheme, 'type' | 'playerId'> | null,
): ObserverSeasonTrajectory | null {
  const leagueLevel = world.seasonStartLevels?.[teamId];
  if (!leagueLevel) return null;

  const leagueTeamIds = Object.entries(world.seasonStartLevels)
    .filter(([, level]) => level === leagueLevel)
    .map(([id]) => id);
  if (!leagueTeamIds.includes(teamId)) return null;

  let standings = createInitialStandings(leagueTeamIds);
  const snapshots: ObserverSeasonCheckpoint[] = [];

  for (const window of world.seasonState.calendar) {
    if (!window.completed) continue;
    const leagueResults = (window.results ?? []).filter(result =>
      result.competitionType === 'league'
      && leagueTeamIds.includes(result.homeTeamId)
      && leagueTeamIds.includes(result.awayTeamId),
    );
    if (leagueResults.length === 0) continue;

    standings = updateStandings(standings, leagueResults);
    const entry = standings.find(row => row.teamId === teamId);
    const playedThisWindow = leagueResults.some(result =>
      result.homeTeamId === teamId || result.awayTeamId === teamId,
    );
    if (!entry || !playedThisWindow) continue;

    snapshots.push({
      phase: 'final',
      played: entry.played,
      position: standings.findIndex(row => row.teamId === teamId) + 1,
      points: entry.points,
      goalDifference: entry.goalDifference,
    });
  }

  const finalPlayed = snapshots.at(-1)?.played ?? 0;
  if (finalPlayed === 0) return null;

  const checkpoints = PHASE_TARGETS.map(({ phase, ratio }) => {
    const targetPlayed = Math.max(1, Math.ceil(finalPlayed * ratio));
    const snapshot = snapshots.find(entry => entry.played >= targetPlayed) ?? snapshots.at(-1)!;
    return { ...snapshot, phase };
  });

  const observation = world.observationRecord;
  const judgment = observation?.seasonNumber === world.seasonState.seasonNumber
    && (observation.seasonTotal ?? 0) > 0
      ? {
        total: observation.seasonTotal ?? 0,
        correct: observation.seasonCorrect ?? 0,
        currentStreak: observation.seasonCurrentStreak ?? 0,
        bestStreak: observation.seasonBestStreak ?? 0,
      }
    : undefined;

  return {
    seasonNumber: world.seasonState.seasonNumber,
    teamId,
    leagueLevel,
    checkpoints,
    judgment,
    expectedPosition: expectedPosition(
      leagueTeamIds.length,
      world.teamBases?.[teamId]?.expectation ?? 3,
    ),
    representativePlayerId: world.squads && world.playerStats
      ? selectRepresentativePlayerId({ squads: world.squads, playerStats: world.playerStats }, teamId)
      : undefined,
    destinyDeviation: selectDestinyDeviation(world, teamId),
    theme: observationTheme
      ? {
          type: observationTheme.type,
          ...(observationTheme.playerId ? { playerId: observationTheme.playerId } : {}),
        }
      : undefined,
  };
}

export function appendObserverSeasonTrajectory(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory | null,
): GameWorld {
  if (!trajectory) return world;
  const previous = (world.observerSeasonTrajectories ?? [])
    .filter(entry => entry.seasonNumber !== trajectory.seasonNumber);
  const observerSeasonTrajectories = [...previous, trajectory]
    .slice(-OBSERVER_SEASON_TRAJECTORY_LIMIT);
  return { ...world, observerSeasonTrajectories };
}
