// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEDBACK_PREFERENCES, setFeedbackPreferences } from './preferences';
import { startAmbientMusic, stopAmbientMusic } from './ambient-music';

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
