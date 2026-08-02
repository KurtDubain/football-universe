import { analyzeDestinyDeviation } from '../engine/match/analysis';
import type { AdvanceWorldResponse } from '../engine/observation/world-response';

export type GameFeedbackCue =
  | 'start'
  | 'goal'
  | 'major_upset'
  | 'story_upgrade'
  | 'season_end';

export function selectWorldFeedbackCue(response: AdvanceWorldResponse | null): GameFeedbackCue | null {
  if (!response) return null;
  if (response.seasonChanged) return 'season_end';
  if (response.featuredResults.some(({ result }) => (
    analyzeDestinyDeviation(result).tier === 'major_upset'
  ))) {
    return 'major_upset';
  }
  if (response.storyUpdates.some(item => item.importance === 'major')) {
    return 'story_upgrade';
  }
  return null;
}

export function shouldVibrateForCue(cue: GameFeedbackCue): boolean {
  return cue === 'major_upset' || cue === 'season_end';
}
