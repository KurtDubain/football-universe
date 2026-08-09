import { useSyncExternalStore } from 'react';

export type SoundProfile = 'quiet' | 'balanced' | 'stadium';

export interface FeedbackPreferences {
  soundEnabled: boolean;
  soundProfile: SoundProfile;
  hapticsEnabled: boolean;
}

export const FEEDBACK_PREFERENCES_KEY = 'football-feedback-preferences-v1';
export const DEFAULT_FEEDBACK_PREFERENCES: FeedbackPreferences = {
  soundEnabled: true,
  soundProfile: 'balanced',
  hapticsEnabled: false,
};

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
  currentPreferences = { ...currentPreferences, ...patch };
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
