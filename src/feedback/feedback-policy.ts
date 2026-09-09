import { analyzeDestinyDeviation } from '../engine/match/analysis';
import type { AdvanceWorldResponse } from '../engine/observation/world-response';
import type { SeasonRecord } from '../types/team';

export type GameFeedbackCue =
  | 'start'
  | 'goal'
  | 'major_upset'
  | 'story_upgrade'
  | 'season_champion'
  | 'season_promotion'
  | 'season_relegation'
  | 'season_end';

export type UiFeedbackCue =
  | 'advance'
  | 'selection'
  | 'confirm'
  | 'toggle_on'
  | 'toggle_off'
  | 'intervention'
  | 'reject';

export type FeedbackCue = GameFeedbackCue | UiFeedbackCue;

export type SeasonFeedbackOutcome = 'champion' | 'promotion' | 'relegation' | 'neutral';

export function seasonFeedbackOutcomeForRecord(
  record: Pick<SeasonRecord, 'leagueLevel' | 'leaguePosition' | 'promoted' | 'relegated'> | undefined,
): SeasonFeedbackOutcome {
  if (!record) return 'neutral';
  if (record.relegated) return 'relegation';
  if (record.promoted) return 'promotion';
  if (record.leagueLevel === 1 && record.leaguePosition === 1) return 'champion';
  return 'neutral';
}

export function selectWorldFeedbackCue(
  response: AdvanceWorldResponse | null,
  seasonOutcome: SeasonFeedbackOutcome = 'neutral',
): GameFeedbackCue | null {
  if (!response) return null;
  if (response.seasonChanged) {
    if (seasonOutcome === 'champion') return 'season_champion';
    if (seasonOutcome === 'promotion') return 'season_promotion';
    if (seasonOutcome === 'relegation') return 'season_relegation';
    return 'season_end';
  }
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

export function shouldVibrateForCue(cue: FeedbackCue): boolean {
  return cue === 'major_upset'
    || cue === 'season_end'
    || cue === 'season_champion'
    || cue === 'season_promotion'
    || cue === 'season_relegation';
}
