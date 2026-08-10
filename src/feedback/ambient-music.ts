import worldCupThemeUrl from '../assets/audio/world-cup-theme-v1.m4a';
import worldCupFinalUrl from '../assets/audio/world-cup-final-v1.m4a';
import worldCupChampionUrl from '../assets/audio/world-cup-champion-v1.m4a';
import { getFeedbackPreferences } from './preferences';

export type AmbientMusicScene = 'world_cup' | 'world_cup_final' | 'world_cup_champion';

interface ActiveMusic {
  owner: string;
  scene: AmbientMusicScene;
  audio: HTMLAudioElement;
  requested: boolean;
}

export interface AmbientMusicLease {
  started: Promise<boolean>;
  stop: () => void;
}

const TRACKS: Record<AmbientMusicScene, { source: string; loop: boolean; gain: number }> = {
  world_cup: { source: worldCupThemeUrl, loop: true, gain: 0.52 },
  world_cup_final: { source: worldCupFinalUrl, loop: false, gain: 0.58 },
  world_cup_champion: { source: worldCupChampionUrl, loop: false, gain: 0.64 },
};

let activeMusic: ActiveMusic | null = null;

function report(scene: AmbientMusicScene, state: 'started' | 'blocked' | 'stopped' | 'ended'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('football-ambient-music', { detail: { scene, state } }));
}

function stopActive(owner?: string): void {
  if (!activeMusic || (owner && activeMusic.owner !== owner)) return;
  const current = activeMusic;
  activeMusic = null;
  current.requested = false;
  current.audio.pause();
  current.audio.removeAttribute('src');
  current.audio.load();
  report(current.scene, 'stopped');
}

export function startAmbientMusic(scene: AmbientMusicScene, owner: string): AmbientMusicLease {
  const preferences = getFeedbackPreferences();
  if (
    typeof Audio === 'undefined'
    || !preferences.soundEnabled
    || preferences.musicVolume <= 0
    || (typeof document !== 'undefined' && document.visibilityState === 'hidden')
  ) {
    return { started: Promise.resolve(false), stop: () => stopActive(owner) };
  }

  stopActive();
  const track = TRACKS[scene];
  const audio = new Audio(track.source);
  audio.preload = 'auto';
  audio.loop = track.loop;
  audio.volume = Math.max(0, Math.min(1, track.gain * preferences.musicVolume));
  const current: ActiveMusic = { owner, scene, audio, requested: true };
  activeMusic = current;
  audio.addEventListener('ended', () => {
    if (activeMusic !== current) return;
    activeMusic = null;
    current.requested = false;
    report(scene, 'ended');
  }, { once: true });
  const started = audio.play()
    .then(() => {
      if (activeMusic !== current) return false;
      report(scene, 'started');
      return true;
    })
    .catch(() => {
      if (activeMusic === current) activeMusic = null;
      current.requested = false;
      current.audio.pause();
      current.audio.removeAttribute('src');
      current.audio.load();
      report(scene, 'blocked');
      return false;
    });
  return { started, stop: () => stopActive(owner) };
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
      current.audio.volume = Math.max(0, Math.min(1, TRACKS[current.scene].gain * preferences.musicVolume));
      void current.audio.play().catch(() => undefined);
    }
  });
}
