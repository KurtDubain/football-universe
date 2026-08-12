import { useSyncExternalStore } from 'react';

export interface AdvancePreferences {
  /** Keep the current route and Dashboard tab after a successful advance. */
  stayOnCurrentView: boolean;
}

export const ADVANCE_PREFERENCES_KEY = 'football-advance-preferences-v1';
export const DEFAULT_ADVANCE_PREFERENCES: AdvancePreferences = {
  stayOnCurrentView: false,
};

const listeners = new Set<() => void>();

export function parseAdvancePreferences(raw: string | null): AdvancePreferences {
  if (!raw) return DEFAULT_ADVANCE_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<AdvancePreferences>;
    return {
      stayOnCurrentView: typeof parsed.stayOnCurrentView === 'boolean'
        ? parsed.stayOnCurrentView
        : DEFAULT_ADVANCE_PREFERENCES.stayOnCurrentView,
    };
  } catch {
    return DEFAULT_ADVANCE_PREFERENCES;
  }
}

function readPreferences(): AdvancePreferences {
  if (typeof window === 'undefined') return DEFAULT_ADVANCE_PREFERENCES;
  try {
    return parseAdvancePreferences(window.localStorage.getItem(ADVANCE_PREFERENCES_KEY));
  } catch {
    return DEFAULT_ADVANCE_PREFERENCES;
  }
}

let currentPreferences = readPreferences();

function emitChange(): void {
  listeners.forEach(listener => listener());
}

export function getAdvancePreferences(): AdvancePreferences {
  return currentPreferences;
}

export function setAdvancePreferences(patch: Partial<AdvancePreferences>): AdvancePreferences {
  currentPreferences = { ...currentPreferences, ...patch };
  try {
    window.localStorage.setItem(ADVANCE_PREFERENCES_KEY, JSON.stringify(currentPreferences));
  } catch {
    // A display preference must never block simulation or navigation.
  }
  emitChange();
  return currentPreferences;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAdvancePreferences(): AdvancePreferences {
  return useSyncExternalStore(subscribe, getAdvancePreferences, () => DEFAULT_ADVANCE_PREFERENCES);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== ADVANCE_PREFERENCES_KEY) return;
    currentPreferences = parseAdvancePreferences(event.newValue);
    emitChange();
  });
}
