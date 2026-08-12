import { getFeedbackPreferences } from './preferences';
import { duckAmbientMusic } from './ambient-music';
import {
  shouldVibrateForCue,
  type FeedbackCue,
  type GameFeedbackCue,
  type UiFeedbackCue,
} from './feedback-policy';

type AudioContextConstructor = new () => AudioContext;

export interface FeedbackDelivery {
  cue: FeedbackCue;
  audioPlayed: boolean;
  hapticPlayed: boolean;
}

const RATE_LIMIT_MS: Record<FeedbackCue, number> = {
  start: 800,
  goal: 250,
  major_upset: 2_000,
  story_upgrade: 2_000,
  season_end: 2_000,
  advance: 280,
  selection: 70,
  confirm: 180,
  toggle_on: 120,
  toggle_off: 120,
  intervention: 900,
  reject: 300,
};

let audioContext: AudioContext | null = null;
const lastCueAt = new Map<FeedbackCue, number>();
let lastHapticAt = Number.NEGATIVE_INFINITY;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const audioWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function audioUnavailableEnvironment(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
  if (typeof navigator !== 'undefined') {
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if ((navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 1)
      || (deviceMemory != null && deviceMemory <= 1)) return true;
  }
  return false;
}

function hapticUnavailableEnvironment(): boolean {
  return audioUnavailableEnvironment() || Boolean(
    typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function unlockGameAudio(): boolean {
  if (!getFeedbackPreferences().soundEnabled || audioUnavailableEnvironment()) return false;
  try {
    if (!audioContext || audioContext.state === 'closed') {
      const AudioContextClass = audioContextConstructor();
      if (!AudioContextClass) return false;
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === 'suspended') void audioContext.resume();
    return true;
  } catch {
    audioContext = null;
    return false;
  }
}

/**
 * Reuse the single gesture-unlocked context for optional long-form feedback
 * such as the match soundscape. Callers must still degrade when Web Audio
 * features are unavailable.
 */
export function getUnlockedGameAudioContext(): AudioContext | null {
  return unlockGameAudio() ? audioContext : null;
}

export function suspendGameAudio(): void {
  if (audioContext?.state === 'running') {
    try {
      void audioContext.suspend();
    } catch {
      // Audio is optional; background transitions cannot affect the game loop.
    }
  }
}

function playAudioCue(cue: FeedbackCue): boolean {
  const preferences = getFeedbackPreferences();
  if (!preferences.soundEnabled || audioUnavailableEnvironment()) return false;
  const volumeScale = cue === 'start' || cue === 'season_end'
    ? preferences.musicVolume
    : preferences.effectsVolume;
  if (volumeScale <= 0) return false;
  const timestamp = now();
  if (timestamp - (lastCueAt.get(cue) ?? Number.NEGATIVE_INFINITY) < RATE_LIMIT_MS[cue]) return false;
  if (!unlockGameAudio() || !audioContext) return false;
  const context = audioContext;
  lastCueAt.set(cue, timestamp);
  const isMusical = cue === 'start' || cue === 'season_end';
  const isMajor = cue === 'goal' || cue === 'major_upset' || cue === 'story_upgrade';
  const isRoutine = cue === 'selection' || cue === 'toggle_on' || cue === 'toggle_off';
  duckAmbientMusic(isMajor
    ? { factor: 0.5, holdMs: 700, releaseMs: 420 }
    : isMusical
      ? { factor: 0.58, holdMs: 900, releaseMs: 450 }
      : isRoutine
        ? { factor: 0.84, holdMs: 110, releaseMs: 160 }
        : { factor: 0.7, holdMs: 220, releaseMs: 240 });
  void import('./feedback-sounds')
    .then(({ scheduleFeedbackCue }) => {
      if (!getFeedbackPreferences().soundEnabled || audioUnavailableEnvironment()
        || context.state === 'closed') return;
      scheduleFeedbackCue(context, cue, volumeScale);
    })
    .catch(() => {
      // A missing optional sound chunk must never affect the game.
    });
  return true;
}

function playHapticCue(cue: FeedbackCue): boolean {
  const preferences = getFeedbackPreferences();
  if (!preferences.hapticsEnabled || !shouldVibrateForCue(cue) || hapticUnavailableEnvironment()) return false;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  const timestamp = now();
  if (timestamp - lastHapticAt < 2_000) return false;
  try {
    const accepted = navigator.vibrate(cue === 'season_end' ? [18, 40, 24] : 22);
    if (accepted) lastHapticAt = timestamp;
    return accepted;
  } catch {
    return false;
  }
}

function deliverFeedback(cue: FeedbackCue): FeedbackDelivery {
  const delivery = {
    cue,
    audioPlayed: playAudioCue(cue),
    hapticPlayed: playHapticCue(cue),
  };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<FeedbackDelivery>('football-feedback-played', {
      detail: delivery,
    }));
  }
  return delivery;
}

export function playGameFeedback(cue: GameFeedbackCue): FeedbackDelivery {
  return deliverFeedback(cue);
}

export function playUiFeedback(cue: UiFeedbackCue): FeedbackDelivery {
  return deliverFeedback(cue);
}
