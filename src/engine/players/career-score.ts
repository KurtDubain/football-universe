import type { GameWorld } from '../season/season-manager';
import type { PlayerSeasonStatsHistoryEntry } from '../../types/player';

export interface CareerScoreSummary {
  weightedTotal: number;
  minutes: number;
  complete: boolean;
}

/** Missing seasons may mean no appearances or lost history; never guess which. */
export function summarizeCareerScore(rows: PlayerSeasonStatsHistoryEntry[], retiredSeason?: number): CareerScoreSummary {
  let weightedTotal = 0;
  let minutes = 0;
  const covered = new Set<number>();
  for (const row of rows) {
    const played = row.minutesPlayed ?? row.appearances * 90;
    if (row.seasonScore === undefined || !Number.isFinite(row.seasonScore) || played <= 0) continue;
    weightedTotal += row.seasonScore * played;
    minutes += played;
    covered.add(row.season);
  }
  const complete = retiredSeason !== undefined && retiredSeason > 0 && covered.size === retiredSeason
    && [...covered].every(season => Number.isInteger(season) && season >= 1 && season <= retiredSeason)
    && rows.every(row => row.seasonScore !== undefined || (row.minutesPlayed ?? row.appearances * 90) === 0);
  return { weightedTotal, minutes, complete };
}

export function playerCareerScore(world: Pick<GameWorld, 'retirementHistory' | 'playerStatsHistory'>, id: string) {
  const retired = world.retirementHistory.find(player => player.uuid === id);
  const score = retired?.careerScore ?? summarizeCareerScore(world.playerStatsHistory[id] ?? [], retired?.seasonRetired);
  return { value: score.minutes > 0 ? score.weightedTotal / score.minutes : null,
    label: score.complete ? '生涯评分' : '现存记录均分' };
}

/** Freeze only after every competition has finished, before rolling history is pruned. */
export function preserveRetiredCareerScores(world: GameWorld): GameWorld['retirementHistory'] {
  let changed = false;
  const records = world.retirementHistory.map(player => {
    if (player.careerScore || player.seasonRetired >= world.seasonState.seasonNumber) return player;
    const careerScore = summarizeCareerScore(world.playerStatsHistory[player.uuid] ?? [], player.seasonRetired);
    if (!careerScore.minutes) return player;
    changed = true;
    return { ...player, careerScore };
  });
  return changed ? records : world.retirementHistory;
}
