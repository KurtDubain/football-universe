import type { GameWorld } from '../season/season-manager';
import { createInitialStandings, updateStandings } from '../standings/standings';

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
    bestStreak: number;
  };
}

export const OBSERVER_SEASON_TRAJECTORY_LIMIT = 40;

const PHASE_TARGETS: Array<{ phase: ObserverSeasonPhase; ratio: number }> = [
  { phase: 'opening', ratio: 0.25 },
  { phase: 'midseason', ratio: 0.5 },
  { phase: 'run_in', ratio: 0.75 },
  { phase: 'final', ratio: 1 },
];

/**
 * Replays only authoritative completed league results. The resulting four
 * checkpoints are the smallest piece of a season that cannot be recovered
 * after the live calendar rolls over.
 */
export function buildObserverSeasonTrajectory(
  world: Pick<GameWorld, 'seasonState' | 'seasonStartLevels' | 'observationRecord'>,
  teamId: string,
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
        bestStreak: observation.seasonBestStreak ?? 0,
      }
    : undefined;

  return {
    seasonNumber: world.seasonState.seasonNumber,
    teamId,
    leagueLevel,
    checkpoints,
    judgment,
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
