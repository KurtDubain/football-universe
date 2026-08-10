import { useSyncExternalStore } from 'react';

export type SoundProfile = 'quiet' | 'balanced' | 'stadium';

export interface FeedbackPreferences {
  soundEnabled: boolean;
  soundProfile: SoundProfile;
  /** Relative gain for UI, crowd, and match-action sound. */
  effectsVolume: number;
  /** Relative gain for short motifs and longer tournament music. */
  musicVolume: number;
  hapticsEnabled: boolean;
}

export const FEEDBACK_PREFERENCES_KEY = 'football-feedback-preferences-v1';
export const DEFAULT_FEEDBACK_PREFERENCES: FeedbackPreferences = {
  soundEnabled: true,
  soundProfile: 'balanced',
  effectsVolume: 1,
  musicVolume: 1,
  hapticsEnabled: false,
};

function safeVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function isSoundProfile(value: unknown): value is SoundProfile {
  return value === 'quiet' || value === 'balanced' || value === 'stadium';
}

const listeners = new Set<() => void>();

export function parseFeedbackPreferences(raw: string | null): FeedbackPreferences {
  if (!raw) return DEFAULT_FEEDBACK_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<FeedbackPreferences>;
    return {
      soundEnabled: typeof parsed.soundEnabled === 'boolean'
        ? parsed.soundEnabled
        : DEFAULT_FEEDBACK_PREFERENCES.soundEnabled,
      soundProfile: isSoundProfile(parsed.soundProfile)
        ? parsed.soundProfile
        : DEFAULT_FEEDBACK_PREFERENCES.soundProfile,
      effectsVolume: safeVolume(parsed.effectsVolume, DEFAULT_FEEDBACK_PREFERENCES.effectsVolume),
      musicVolume: safeVolume(parsed.musicVolume, DEFAULT_FEEDBACK_PREFERENCES.musicVolume),
      hapticsEnabled: typeof parsed.hapticsEnabled === 'boolean'
        ? parsed.hapticsEnabled
        : DEFAULT_FEEDBACK_PREFERENCES.hapticsEnabled,
    };
  } catch {
    return DEFAULT_FEEDBACK_PREFERENCES;
  }
}

function readPreferences(): FeedbackPreferences {
  if (typeof window === 'undefined') return DEFAULT_FEEDBACK_PREFERENCES;
  try {
    return parseFeedbackPreferences(window.localStorage.getItem(FEEDBACK_PREFERENCES_KEY));
  } catch {
    return DEFAULT_FEEDBACK_PREFERENCES;
  }
}

let currentPreferences = readPreferences();

function emitChange(): void {
  listeners.forEach(listener => listener());
}

export function getFeedbackPreferences(): FeedbackPreferences {
  return currentPreferences;
}

export function setFeedbackPreferences(patch: Partial<FeedbackPreferences>): FeedbackPreferences {
  currentPreferences = {
    ...currentPreferences,
    ...patch,
    effectsVolume: safeVolume(patch.effectsVolume, currentPreferences.effectsVolume),
    musicVolume: safeVolume(patch.musicVolume, currentPreferences.musicVolume),
  };
  try {
    window.localStorage.setItem(FEEDBACK_PREFERENCES_KEY, JSON.stringify(currentPreferences));
  } catch {
    // Feedback preferences are optional and must never block play.
  }
  emitChange();
  return currentPreferences;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFeedbackPreferences(): FeedbackPreferences {
  return useSyncExternalStore(subscribe, getFeedbackPreferences, () => DEFAULT_FEEDBACK_PREFERENCES);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== FEEDBACK_PREFERENCES_KEY) return;
    currentPreferences = parseFeedbackPreferences(event.newValue);
    emitChange();
  });
}
