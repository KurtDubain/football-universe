import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/game-store';
import { selectWorldFeedbackCue } from './feedback-policy';
import { playGameFeedback, suspendGameAudio, unlockGameAudio } from './game-feedback';
import { getFeedbackPreferences } from './preferences';

export default function GameFeedbackBridge() {
  const advanceTick = useGameStore(state => state.advanceTick);
  const lastWorldResponse = useGameStore(state => state.lastWorldResponse);
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
    if (advanceTick === previousAdvanceTick.current) return;
    previousAdvanceTick.current = advanceTick;
    const cue = selectWorldFeedbackCue(lastWorldResponse);
    if (cue) playGameFeedback(cue);
  }, [advanceTick, lastWorldResponse]);

  return null;
}
