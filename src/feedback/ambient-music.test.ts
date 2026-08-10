// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEDBACK_PREFERENCES, setFeedbackPreferences } from './preferences';
import {
  AMBIENT_MUSIC_TRACKS,
  ambientMusicSceneForFinal,
  startAmbientMusic,
  stopAmbientMusic,
} from './ambient-music';

class AudioMock {
  static instances: AudioMock[] = [];
  static playImpl: () => Promise<void> = () => Promise.resolve();
  src: string;
  preload = '';
  loop = false;
  volume = 1;
  paused = false;
  play = vi.fn(() => AudioMock.playImpl());
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn();
  addEventListener = vi.fn();

  constructor(src: string) {
    this.src = src;
    AudioMock.instances.push(this);
  }
}

describe('ambient tournament music', () => {
  beforeEach(() => {
    stopAmbientMusic();
    AudioMock.instances = [];
    AudioMock.playImpl = () => Promise.resolve();
    vi.stubGlobal('Audio', AudioMock);
    setFeedbackPreferences(DEFAULT_FEEDBACK_PREFERENCES);
  });

  it('plays the looping World Cup theme at its mastered default level', async () => {
    const lease = startAmbientMusic('world_cup', 'cup-page');
    expect(await lease.started).toBe(true);
    expect(AudioMock.instances).toHaveLength(1);
    expect(AudioMock.instances[0].loop).toBe(true);
    expect(AudioMock.instances[0].volume).toBeCloseTo(0.7);
    lease.stop();
    expect(AudioMock.instances[0].pause).toHaveBeenCalledTimes(1);
  });

  it('ships five distinct looping cup identities at an audible mastered level', async () => {
    const scenes = ['league_cup', 'super_cup', 'mainland_cup', 'southern_cup', 'eastern_cup'] as const;
    expect(new Set(scenes.map(scene => AMBIENT_MUSIC_TRACKS[scene].source)).size).toBe(scenes.length);
    for (const scene of scenes) {
      expect(AMBIENT_MUSIC_TRACKS[scene].loop).toBe(true);
      expect(AMBIENT_MUSIC_TRACKS[scene].gain).toBeGreaterThanOrEqual(0.74);
      expect(AMBIENT_MUSIC_TRACKS[scene].source).toContain(`${scene.replaceAll('_', '-')}-theme-v1`);
    }

    const lease = startAmbientMusic('southern_cup', 'regional-page');
    expect(await lease.started).toBe(true);
    expect(AudioMock.instances[0].volume).toBeCloseTo(0.76);
    lease.stop();
  });

  it('maps supported tournament finals to their own full themes', () => {
    expect(ambientMusicSceneForFinal('league_cup', '联赛杯', false)).toBe('league_cup');
    expect(ambientMusicSceneForFinal('super_cup', '超级杯', false)).toBe('super_cup');
    expect(ambientMusicSceneForFinal('continental_cup', '大陆杯', false)).toBe('mainland_cup');
    expect(ambientMusicSceneForFinal('continental_cup', '南洲杯', false)).toBe('southern_cup');
    expect(ambientMusicSceneForFinal('continental_cup', '东洲杯', false)).toBe('eastern_cup');
    expect(ambientMusicSceneForFinal('world_cup', '环球冠军杯', false)).toBe('world_cup_final');
    expect(ambientMusicSceneForFinal('world_cup', '环球冠军杯', true)).toBe('world_cup_champion');
    expect(ambientMusicSceneForFinal('league', '顶级联赛', false)).toBeNull();
  });

  it('keeps ownership isolated and respects music volume', async () => {
    setFeedbackPreferences({ musicVolume: 0.5 });
    const page = startAmbientMusic('world_cup', 'cup-page');
    await page.started;
    const final = startAmbientMusic('world_cup_final', 'match-final');
    expect(await final.started).toBe(true);
    expect(AudioMock.instances[0].pause).toHaveBeenCalledTimes(1);
    expect(AudioMock.instances[1].volume).toBeCloseTo(0.39);
    page.stop();
    expect(AudioMock.instances[1].pause).not.toHaveBeenCalled();
    final.stop();
  });

  it('crossfades tournament identities without an abrupt media release', async () => {
    vi.useFakeTimers();
    try {
      const page = startAmbientMusic('league_cup', 'director', { fadeInMs: 100 });
      expect(await page.started).toBe(true);
      expect(AudioMock.instances[0].volume).toBe(0);
      vi.advanceTimersByTime(125);
      expect(AudioMock.instances[0].volume).toBeCloseTo(AMBIENT_MUSIC_TRACKS.league_cup.gain);

      const final = startAmbientMusic('super_cup', 'director', {
        fadeInMs: 100,
        transitionMs: 100,
      });
      expect(await final.started).toBe(true);
      expect(AudioMock.instances[0].pause).not.toHaveBeenCalled();
      expect(AudioMock.instances[1].volume).toBe(0);
      vi.advanceTimersByTime(125);
      expect(AudioMock.instances[0].pause).toHaveBeenCalledTimes(1);
      expect(AudioMock.instances[1].volume).toBeCloseTo(AMBIENT_MUSIC_TRACKS.super_cup.gain);
      final.stop();
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('pauses in a background browser tab and resumes the same media instance', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    try {
      const lease = startAmbientMusic('super_cup', 'director');
      expect(await lease.started).toBe(true);
      const audio = AudioMock.instances[0];

      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      expect(audio.pause).toHaveBeenCalledTimes(1);

      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      expect(AudioMock.instances).toHaveLength(1);
      expect(audio.play).toHaveBeenCalledTimes(2);
      lease.stop();
    } finally {
      visibilitySpy.mockRestore();
    }
  });

  it('does not create an audio element when music is disabled', async () => {
    setFeedbackPreferences({ musicVolume: 0 });
    expect(await startAmbientMusic('world_cup_champion', 'champion').started).toBe(false);
    expect(AudioMock.instances).toHaveLength(0);
  });

  it('releases a media element when playback is blocked', async () => {
    AudioMock.playImpl = () => Promise.reject(new Error('autoplay blocked'));
    const lease = startAmbientMusic('world_cup', 'blocked-page');

    expect(await lease.started).toBe(false);
    expect(AudioMock.instances[0].pause).toHaveBeenCalledTimes(1);
    expect(AudioMock.instances[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(AudioMock.instances[0].load).toHaveBeenCalledTimes(1);
  });
});
