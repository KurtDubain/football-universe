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
  /** True when the bed faded itself out after a long silence, not by request. */
  idlePaused: boolean;
  revision: number;
}

interface SessionState {
  scene: AmbientMusicScene | null;
  originSeason: number | null;
  desired: boolean;
  manuallyPaused: boolean;
  idlePaused: boolean;
  status: TournamentMusicPlaybackStatus;
  revision: number;
}

const state: SessionState = {
  scene: null,
  originSeason: null,
  desired: false,
  manuallyPaused: false,
  idlePaused: false,
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
    idlePaused: state.idlePaused,
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
    // An idle bed stays quiet when the context comes back: silence was the
    // point of fading out, and only the viewer gets to undo it.
    state.desired = !state.manuallyPaused && !state.idlePaused;
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
  state.idlePaused = false;
  state.status = 'starting';
  state.revision++;
  emit();
}

export function pauseTournamentMusic(): void {
  if (!state.scene) return;
  state.desired = false;
  state.manuallyPaused = true;
  state.idlePaused = false;
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
  state.idlePaused = false;
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

/**
 * Fade the bed out because nobody has touched anything for a long time.
 *
 * Distinct from a manual pause on purpose: a manual pause is an instruction
 * and must survive, while an idle pause is the product being polite and is
 * undone by the next thing the viewer does.
 */
export function idlePauseTournamentMusic(): void {
  if (!state.scene || !state.desired || state.idlePaused) return;
  state.desired = false;
  state.idlePaused = true;
  state.status = 'paused';
  state.revision++;
  emit();
}

/** Bring an idled bed back. Does nothing if the viewer paused it themselves. */
export function wakeTournamentMusic(): void {
  if (!state.idlePaused) return;
  state.idlePaused = false;
  if (!state.scene || state.manuallyPaused) return;
  state.desired = true;
  state.status = 'starting';
  state.revision++;
  emit();
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
  state.idlePaused = false;
  state.status = 'idle';
  state.revision++;
  holds.clear();
  overrides.clear();
  emit();
}
