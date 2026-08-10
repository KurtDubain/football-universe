// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getTournamentMusicSession,
  resetTournamentMusicSession,
  selectTournamentMusic,
  setTournamentMusicPlaybackStatus,
} from '../feedback/tournament-music-session';
import TournamentMusicNowPlaying from './TournamentMusicNowPlaying';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetTournamentMusicSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  resetTournamentMusicSession();
  container.remove();
});

describe('TournamentMusicNowPlaying', () => {
  it('appears only after music follows the observer away from its tournament page', () => {
    selectTournamentMusic('super_cup', 7);
    setTournamentMusicPlaybackStatus('super_cup', 'playing');
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/cup/super_cup']}>
          <TournamentMusicNowPlaying />
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[data-testid="tournament-music-now-playing"]')).toBeNull();

    act(() => {
      root.render(
        <MemoryRouter key="dashboard" initialEntries={['/']}>
          <TournamentMusicNowPlaying />
        </MemoryRouter>,
      );
    });
    const bar = container.querySelector<HTMLElement>('[data-testid="tournament-music-now-playing"]')!;
    expect(bar.dataset.musicScene).toBe('super_cup');
    expect(bar.textContent).toContain('正在播放 · 超级杯主题');

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="tournament-music-global-toggle"]')!.click());
    expect(getTournamentMusicSession()).toMatchObject({ desired: false, status: 'paused' });
  });
});
