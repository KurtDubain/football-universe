import easternCupThemeUrl from '../assets/audio/eastern-cup-theme-v1.m4a';
import leagueCupThemeUrl from '../assets/audio/league-cup-theme-v1.m4a';
import mainlandCupThemeUrl from '../assets/audio/mainland-cup-theme-v1.m4a';
import southernCupThemeUrl from '../assets/audio/southern-cup-theme-v1.m4a';
import superCupThemeUrl from '../assets/audio/super-cup-theme-v1.m4a';
import worldCupThemeUrl from '../assets/audio/world-cup-theme-v1.m4a';
import worldCupFinalUrl from '../assets/audio/world-cup-final-v1.m4a';
import worldCupChampionUrl from '../assets/audio/world-cup-champion-v1.m4a';
import type { CompetitionType } from '../types/match';
import { getFeedbackPreferences } from './preferences';

export type AmbientMusicScene =
  | 'league_cup'
  | 'super_cup'
  | 'mainland_cup'
  | 'southern_cup'
  | 'eastern_cup'
  | 'world_cup'
  | 'world_cup_final'
  | 'world_cup_champion';

interface ActiveMusic {
  owner: string;
  scene: AmbientMusicScene;
  audio: HTMLAudioElement;
  requested: boolean;
  fadeTimer: ReturnType<typeof setInterval> | null;
}

export interface AmbientMusicLease {
  started: Promise<boolean>;
  stop: (fadeOutMs?: number) => void;
}

export interface AmbientMusicStartOptions {
  fadeInMs?: number;
  transitionMs?: number;
}

export const AMBIENT_MUSIC_TRACKS: Readonly<Record<AmbientMusicScene, { source: string; loop: boolean; gain: number }>> = {
  league_cup: { source: leagueCupThemeUrl, loop: true, gain: 0.74 },
  super_cup: { source: superCupThemeUrl, loop: true, gain: 0.74 },
  mainland_cup: { source: mainlandCupThemeUrl, loop: true, gain: 0.76 },
  southern_cup: { source: southernCupThemeUrl, loop: true, gain: 0.76 },
  eastern_cup: { source: easternCupThemeUrl, loop: true, gain: 0.76 },
  world_cup: { source: worldCupThemeUrl, loop: true, gain: 0.7 },
  world_cup_final: { source: worldCupFinalUrl, loop: false, gain: 0.78 },
  world_cup_champion: { source: worldCupChampionUrl, loop: false, gain: 0.86 },
};

export function ambientMusicSceneForFinal(
  competitionType: CompetitionType,
  competitionName: string,
  finished: boolean,
): AmbientMusicScene | null {
  if (competitionType === 'world_cup') return finished ? 'world_cup_champion' : 'world_cup_final';
  if (competitionType === 'league_cup') return 'league_cup';
  if (competitionType === 'super_cup') return 'super_cup';
  if (competitionType !== 'continental_cup') return null;
  if (competitionName.includes('大陆')) return 'mainland_cup';
  if (competitionName.includes('南洲')) return 'southern_cup';
  if (competitionName.includes('东洲')) return 'eastern_cup';
  return null;
}

let activeMusic: ActiveMusic | null = null;

function report(owner: string, scene: AmbientMusicScene, state: 'started' | 'blocked' | 'stopped' | 'ended'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('football-ambient-music', { detail: { owner, scene, state } }));
}

function releaseAudio(current: ActiveMusic, state: 'blocked' | 'stopped'): void {
  if (current.fadeTimer !== null) clearInterval(current.fadeTimer);
  current.fadeTimer = null;
  current.audio.pause();
  current.audio.removeAttribute('src');
  current.audio.load();
  report(current.owner, current.scene, state);
}

function fadeAudio(current: ActiveMusic, target: number, durationMs: number, onComplete?: () => void): void {
  if (current.fadeTimer !== null) clearInterval(current.fadeTimer);
  current.fadeTimer = null;
  if (durationMs <= 0) {
    current.audio.volume = target;
    onComplete?.();
    return;
  }
  const initial = current.audio.volume;
  const startedAt = Date.now();
  current.fadeTimer = setInterval(() => {
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
    current.audio.volume = initial + (target - initial) * progress;
    if (progress < 1) return;
    if (current.fadeTimer !== null) clearInterval(current.fadeTimer);
    current.fadeTimer = null;
    onComplete?.();
  }, 25);
}

function stopActive(owner?: string, fadeOutMs = 0): void {
  if (!activeMusic || (owner && activeMusic.owner !== owner)) return;
  const current = activeMusic;
  activeMusic = null;
  current.requested = false;
  if (fadeOutMs > 0 && !current.audio.paused) {
    fadeAudio(current, 0, fadeOutMs, () => releaseAudio(current, 'stopped'));
  } else {
    releaseAudio(current, 'stopped');
  }
}

export function startAmbientMusic(
  scene: AmbientMusicScene,
  owner: string,
  options: AmbientMusicStartOptions = {},
): AmbientMusicLease {
  const preferences = getFeedbackPreferences();
  if (
    typeof Audio === 'undefined'
    || !preferences.soundEnabled
    || preferences.musicVolume <= 0
    || (typeof document !== 'undefined' && document.visibilityState === 'hidden')
  ) {
    return { started: Promise.resolve(false), stop: fadeOutMs => stopActive(owner, fadeOutMs) };
  }

  stopActive(undefined, options.transitionMs ?? 0);
  const track = AMBIENT_MUSIC_TRACKS[scene];
  const audio = new Audio(track.source);
  audio.preload = 'auto';
  audio.loop = track.loop;
  const targetVolume = Math.max(0, Math.min(1, track.gain * preferences.musicVolume));
  audio.volume = options.fadeInMs ? 0 : targetVolume;
  const current: ActiveMusic = { owner, scene, audio, requested: true, fadeTimer: null };
  activeMusic = current;
  audio.addEventListener('ended', () => {
    if (activeMusic !== current) return;
    activeMusic = null;
    current.requested = false;
    if (current.fadeTimer !== null) clearInterval(current.fadeTimer);
    current.fadeTimer = null;
    report(owner, scene, 'ended');
  }, { once: true });
  const started = audio.play()
    .then(() => {
      if (activeMusic !== current) return false;
      if (options.fadeInMs) fadeAudio(current, targetVolume, options.fadeInMs);
      report(owner, scene, 'started');
      return true;
    })
    .catch(() => {
      if (activeMusic === current) activeMusic = null;
      current.requested = false;
      releaseAudio(current, 'blocked');
      return false;
    });
  return { started, stop: fadeOutMs => stopActive(owner, fadeOutMs) };
}

export function stopAmbientMusic(owner?: string): void {
  stopActive(owner);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const current = activeMusic;
    if (!current) return;
    if (document.visibilityState === 'hidden') {
      current.audio.pause();
      return;
    }
    const preferences = getFeedbackPreferences();
    if (current.requested && preferences.soundEnabled && preferences.musicVolume > 0) {
      current.audio.volume = Math.max(0, Math.min(1, AMBIENT_MUSIC_TRACKS[current.scene].gain * preferences.musicVolume));
      void current.audio.play().catch(() => undefined);
    }
  });
}
