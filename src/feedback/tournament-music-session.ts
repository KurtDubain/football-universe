import { useSyncExternalStore } from 'react';
import type { AmbientMusicScene } from './ambient-music';

export type TournamentMusicPlaybackStatus =
  | 'idle'
  | 'starting'
  | 'playing'
  | 'paused'
  | 'blocked'
  | 'ended';

export interface TournamentMusicSessionSnapshot {
  scene: AmbientMusicScene | null;
  effectiveScene: AmbientMusicScene | null;
  originSeason: number | null;
  desired: boolean;
  status: TournamentMusicPlaybackStatus;
  backgroundHeld: boolean;
  overrideActive: boolean;
  revision: number;
}

interface SessionState {
  scene: AmbientMusicScene | null;
  originSeason: number | null;
  desired: boolean;
  manuallyPaused: boolean;
  status: TournamentMusicPlaybackStatus;
  revision: number;
}

const state: SessionState = {
  scene: null,
  originSeason: null,
  desired: false,
  manuallyPaused: false,
  status: 'idle',
  revision: 0,
};
const listeners = new Set<() => void>();
const holds = new Set<string>();
const overrides = new Map<string, AmbientMusicScene>();

function activeOverride(): AmbientMusicScene | null {
  return [...overrides.values()].at(-1) ?? null;
}

function buildSnapshot(): TournamentMusicSessionSnapshot {
  const override = activeOverride();
  return {
    scene: state.scene,
    effectiveScene: override ?? state.scene,
    originSeason: state.originSeason,
    desired: state.desired,
    status: state.status,
    backgroundHeld: holds.size > 0 && !override,
    overrideActive: Boolean(override),
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

export function getTournamentMusicSession(): TournamentMusicSessionSnapshot {
  return snapshot;
}

export function useTournamentMusicSession(): TournamentMusicSessionSnapshot {
  return useSyncExternalStore(subscribe, getTournamentMusicSession, getTournamentMusicSession);
}

export function selectTournamentMusic(scene: AmbientMusicScene, seasonNumber: number): void {
  const contextChanged = state.scene !== scene || state.originSeason !== seasonNumber;
  state.scene = scene;
  state.originSeason = seasonNumber;
  if (contextChanged || state.status === 'idle' || state.status === 'ended') {
    state.desired = !state.manuallyPaused;
    state.status = state.desired ? 'starting' : 'paused';
    state.revision++;
  }
  emit();
}

export function playTournamentMusic(scene?: AmbientMusicScene, seasonNumber?: number): void {
  if (scene) state.scene = scene;
  if (seasonNumber !== undefined) state.originSeason = seasonNumber;
  if (!state.scene) return;
  state.desired = true;
  state.manuallyPaused = false;
  state.status = 'starting';
  state.revision++;
  emit();
}

export function pauseTournamentMusic(): void {
  if (!state.scene) return;
  state.desired = false;
  state.manuallyPaused = true;
  state.status = 'paused';
  state.revision++;
  emit();
}

export function clearTournamentMusic(): void {
  const overrideActive = overrides.size > 0;
  state.scene = null;
  state.originSeason = null;
  state.desired = false;
  state.manuallyPaused = false;
  if (!overrideActive) {
    state.status = 'idle';
    state.revision++;
  }
  emit();
}

export function retryTournamentMusicPlayback(): void {
  const requested = overrides.size > 0 || (Boolean(state.scene) && state.desired);
  if (!requested || state.status !== 'blocked') return;
  state.status = 'starting';
  state.revision++;
  emit();
}

export function expireTournamentMusicForSeason(seasonNumber: number): void {
  if (state.originSeason === null || state.originSeason === seasonNumber) return;
  clearTournamentMusic();
}

export function holdTournamentMusic(owner: string): () => void {
  holds.add(owner);
  state.revision++;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!holds.delete(owner)) return;
    state.status = state.scene && state.desired ? 'starting' : state.status;
    state.revision++;
    emit();
  };
}

export function overrideTournamentMusic(owner: string, scene: AmbientMusicScene): () => void {
  overrides.delete(owner);
  overrides.set(owner, scene);
  state.status = 'starting';
  state.revision++;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!overrides.delete(owner)) return;
    state.status = state.scene && state.desired ? 'starting' : state.scene ? 'paused' : 'idle';
    state.revision++;
    emit();
  };
}

export function setTournamentMusicPlaybackStatus(
  scene: AmbientMusicScene,
  status: TournamentMusicPlaybackStatus,
): void {
  if (snapshot.effectiveScene !== scene || state.status === status) return;
  state.status = status;
  if (status === 'ended' && overrides.size === 0) state.desired = false;
  emit();
}

export function resetTournamentMusicSession(): void {
  state.scene = null;
  state.originSeason = null;
  state.desired = false;
  state.manuallyPaused = false;
  state.status = 'idle';
  state.revision++;
  holds.clear();
  overrides.clear();
  emit();
}
