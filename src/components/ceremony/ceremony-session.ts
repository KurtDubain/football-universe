// Which ceremony is on screen, and which ones are waiting behind it.
//
// Requests are derived from world state at render time, which means the
// component that asks for one re-renders freely. Two things stop a season
// opening from replaying on every unrelated state change: an in-memory set of
// keys already shown, and a session-scoped copy of that set so a reload
// mid-season does not turn the page again.
//
// The seen set is deliberately NOT part of the save file. Ceremonies are
// presentation; persisting them would bump the save schema for something the
// simulation has no opinion about.

import { useSyncExternalStore } from 'react';
import { editionStorageKey } from '../../edition/policy';
import { ceremonyKey, type CeremonyRequest } from './ceremony-types';

const SEEN_STORAGE_KEY = 'ui.ceremony.seen';
/** Old keys are dropped past this; a long session must not grow without bound. */
const SEEN_LIMIT = 48;

export interface CeremonySessionSnapshot {
  current: CeremonyRequest | null;
  /** How many ceremonies are queued behind the current one. */
  pending: number;
  revision: number;
}

interface SessionState {
  queue: CeremonyRequest[];
  seen: Set<string>;
  scope: string | null;
  revision: number;
}

const state: SessionState = { queue: [], seen: new Set(), scope: null, revision: 0 };
const listeners = new Set<() => void>();

function buildSnapshot(): CeremonySessionSnapshot {
  return {
    current: state.queue[0] ?? null,
    pending: Math.max(0, state.queue.length - 1),
    revision: state.revision,
  };
}

let snapshot = buildSnapshot();

function emit(): void {
  snapshot = buildSnapshot();
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface StoredSeen {
  scope: string;
  keys: string[];
}

/**
 * Read back the keys belonging to one scope.
 *
 * The scope travels with the keys on purpose. Without it a second save opened
 * in the same tab would inherit the first save's pages and never show its own
 * season one.
 */
function readStoredSeen(scope: string): string[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(editionStorageKey(SEEN_STORAGE_KEY));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    const stored = parsed as Partial<StoredSeen>;
    if (stored.scope !== scope || !Array.isArray(stored.keys)) return [];
    return stored.keys.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function writeStoredSeen(): void {
  if (typeof sessionStorage === 'undefined' || state.scope === null) return;
  try {
    const payload: StoredSeen = { scope: state.scope, keys: [...state.seen].slice(-SEEN_LIMIT) };
    sessionStorage.setItem(editionStorageKey(SEEN_STORAGE_KEY), JSON.stringify(payload));
  } catch {
    // Ceremony continuity is optional when storage is unavailable.
  }
}

export function getCeremonySession(): CeremonySessionSnapshot {
  return snapshot;
}

export function useCeremonySession(): CeremonySessionSnapshot {
  return useSyncExternalStore(subscribe, getCeremonySession, getCeremonySession);
}

/**
 * Point the seen set at one save.
 *
 * The scope is a cheap fingerprint of the world. Within a season it never
 * changes, so a reload keeps its place; when it does change the seen set is
 * dropped, which is what lets a brand new game show its own season one.
 */
export function setCeremonyScope(scope: string): void {
  if (state.scope === scope) return;
  state.scope = scope;
  state.seen = new Set(readStoredSeen(scope));
  state.queue = [];
  state.revision++;
  emit();
}

/**
 * Queue a ceremony unless it has already been shown.
 *
 * Returns whether it was accepted, which is what the tests assert on: a
 * duplicate request is not an error, it is the same world state being read
 * twice.
 */
export function requestCeremony(request: CeremonyRequest): boolean {
  const key = ceremonyKey(request);
  if (state.seen.has(key)) return false;
  state.seen.add(key);
  if (state.seen.size > SEEN_LIMIT) {
    const oldest = state.seen.values().next().value;
    if (typeof oldest === 'string') state.seen.delete(oldest);
  }
  state.queue.push(request);
  state.revision++;
  writeStoredSeen();
  emit();
  return true;
}

/** Turn the page: drop the current ceremony and promote the next one. */
export function dismissCeremony(): void {
  if (state.queue.length === 0) return;
  state.queue.shift();
  state.revision++;
  emit();
}

/** Drop the queue and forget every key. Used by tests and by a new game. */
export function resetCeremonySession(): void {
  state.queue = [];
  state.seen = new Set();
  state.scope = null;
  state.revision++;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(editionStorageKey(SEEN_STORAGE_KEY));
    } catch {
      // Nothing to clear when storage is unavailable.
    }
  }
  emit();
}
