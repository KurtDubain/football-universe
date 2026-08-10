// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEDBACK_PREFERENCES, setFeedbackPreferences } from '../feedback/preferences';
import { getTournamentMusicSession, resetTournamentMusicSession } from '../feedback/tournament-music-session';
import TournamentMusicDirector from './TournamentMusicDirector';
import TournamentMusicControl from './TournamentMusicControl';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class AudioMock {
  static instances: AudioMock[] = [];
  preload = '';
  loop = false;
  volume = 1;
  paused = false;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn();
  addEventListener = vi.fn();

  constructor(readonly src: string) {
    AudioMock.instances.push(this);
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  AudioMock.instances = [];
  vi.stubGlobal('Audio', AudioMock);
  setFeedbackPreferences(DEFAULT_FEEDBACK_PREFERENCES);
  resetTournamentMusicSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  act(() => vi.runAllTimers());
  resetTournamentMusicSession();
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('TournamentMusicControl', () => {
  it('identifies, starts, and pauses the selected competition theme', async () => {
    await act(async () => {
      root.render(
        <>
          <TournamentMusicDirector seasonNumber={6} />
          <TournamentMusicControl scene="eastern_cup" label="东洲杯主题" tone="rose" seasonNumber={6} />
        </>,
      );
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(400);
    });

    const button = container.querySelector<HTMLButtonElement>('[data-testid="tournament-music-toggle"]')!;
    expect(button.dataset.musicScene).toBe('eastern_cup');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('东洲杯主题播放中');
    expect(AudioMock.instances[0].src).toContain('eastern-cup-theme-v1');

    act(() => button.click());
    act(() => vi.advanceTimersByTime(400));
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toContain('播放东洲杯主题');
    expect(AudioMock.instances[0].pause).toHaveBeenCalled();
  });

  it('does not stop the theme when its route control unmounts', async () => {
    await act(async () => {
      root.render(
        <>
          <TournamentMusicDirector seasonNumber={4} />
          <TournamentMusicControl scene="super_cup" label="超级杯主题" tone="violet" seasonNumber={4} />
        </>,
      );
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(400);
    });
    const playingAudio = AudioMock.instances[0];

    await act(async () => {
      root.render(<TournamentMusicDirector seasonNumber={4} />);
      await Promise.resolve();
    });

    expect(AudioMock.instances).toHaveLength(1);
    expect(playingAudio.pause).not.toHaveBeenCalled();
    expect(getTournamentMusicSession()).toMatchObject({
      scene: 'super_cup',
      originSeason: 4,
      status: 'playing',
    });

    act(() => root.render(<TournamentMusicDirector seasonNumber={5} />));
    act(() => vi.advanceTimersByTime(400));
    expect(getTournamentMusicSession().scene).toBeNull();
    expect(playingAudio.pause).toHaveBeenCalled();
  });
});
