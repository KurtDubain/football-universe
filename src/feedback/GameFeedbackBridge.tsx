import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/game-store';
import {
  seasonFeedbackOutcomeForRecord,
  selectWorldFeedbackCue,
  type UiFeedbackCue,
} from './feedback-policy';
import { playGameFeedback, playUiFeedback, suspendGameAudio, unlockGameAudio } from './game-feedback';
import { getFeedbackPreferences } from './preferences';

export default function GameFeedbackBridge() {
  const advanceTick = useGameStore(state => state.advanceTick);
  const lastWorldResponse = useGameStore(state => state.lastWorldResponse);
  const primaryFavoriteTeamId = useGameStore(state => state.favoriteTeamId);
  const world = useGameStore(state => state.world);
  const previousAdvanceTick = useRef(advanceTick);

  useEffect(() => {
    const unlockFromGesture = () => {
      if (getFeedbackPreferences().soundEnabled) unlockGameAudio();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') suspendGameAudio();
    };
    document.addEventListener('pointerdown', unlockFromGesture, { capture: true });
    document.addEventListener('keydown', unlockFromGesture, { capture: true });
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('pointerdown', unlockFromGesture, { capture: true });
      document.removeEventListener('keydown', unlockFromGesture, { capture: true });
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    const handleAnnotatedFeedback = (event: MouseEvent) => {
      const control = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-ui-feedback]')
        : null;
      if (!control || control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true') return;
      const cue = control.dataset.uiFeedback as UiFeedbackCue | undefined;
      if (cue) playUiFeedback(cue);
    };
    document.addEventListener('click', handleAnnotatedFeedback, { capture: true });
    return () => document.removeEventListener('click', handleAnnotatedFeedback, { capture: true });
  }, []);

  useEffect(() => {
    if (advanceTick === previousAdvanceTick.current) return;
    previousAdvanceTick.current = advanceTick;
    const completedSeason = lastWorldResponse?.nextSeason != null
      ? lastWorldResponse.nextSeason - 1
      : null;
    const primaryRecord = primaryFavoriteTeamId && completedSeason != null
      ? world?.teamSeasonRecords[primaryFavoriteTeamId]
        ?.find(record => record.seasonNumber === completedSeason)
      : undefined;
    const cue = selectWorldFeedbackCue(
      lastWorldResponse,
      seasonFeedbackOutcomeForRecord(primaryRecord),
    );
    if (cue) playGameFeedback(cue);
  }, [advanceTick, lastWorldResponse, primaryFavoriteTeamId, world]);

  return null;
}
