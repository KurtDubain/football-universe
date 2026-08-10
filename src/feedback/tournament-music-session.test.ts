import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearTournamentMusic,
  expireTournamentMusicForSeason,
  getTournamentMusicSession,
  holdTournamentMusic,
  overrideTournamentMusic,
  pauseTournamentMusic,
  playTournamentMusic,
  resetTournamentMusicSession,
  retryTournamentMusicPlayback,
  selectTournamentMusic,
} from './tournament-music-session';

describe('tournament music session', () => {
  beforeEach(resetTournamentMusicSession);
  afterEach(resetTournamentMusicSession);

  it('keeps a selected soundtrack until the originating season ends', () => {
    selectTournamentMusic('super_cup', 8);
    expect(getTournamentMusicSession()).toMatchObject({
      scene: 'super_cup',
      effectiveScene: 'super_cup',
      originSeason: 8,
      desired: true,
    });

    expireTournamentMusicForSeason(8);
    expect(getTournamentMusicSession().scene).toBe('super_cup');

    expireTournamentMusicForSeason(9);
    expect(getTournamentMusicSession()).toMatchObject({
      scene: null,
      originSeason: null,
      desired: false,
      status: 'idle',
    });
  });

  it('holds ordinary match playback and lets a final override it temporarily', () => {
    selectTournamentMusic('mainland_cup', 5);
    const releaseHold = holdTournamentMusic('match-modal');
    expect(getTournamentMusicSession()).toMatchObject({
      effectiveScene: 'mainland_cup',
      backgroundHeld: true,
      overrideActive: false,
    });

    const releaseOverride = overrideTournamentMusic('cup-final', 'world_cup_final');
    expect(getTournamentMusicSession()).toMatchObject({
      scene: 'mainland_cup',
      effectiveScene: 'world_cup_final',
      backgroundHeld: false,
      overrideActive: true,
    });

    releaseOverride();
    expect(getTournamentMusicSession()).toMatchObject({
      effectiveScene: 'mainland_cup',
      backgroundHeld: true,
      overrideActive: false,
    });
    releaseHold();
    expect(getTournamentMusicSession()).toMatchObject({
      effectiveScene: 'mainland_cup',
      backgroundHeld: false,
      status: 'starting',
    });
  });

  it('preserves an explicit pause across page selection until the user resumes', () => {
    selectTournamentMusic('league_cup', 3);
    pauseTournamentMusic();
    selectTournamentMusic('eastern_cup', 3);
    expect(getTournamentMusicSession()).toMatchObject({
      scene: 'eastern_cup',
      desired: false,
      status: 'paused',
    });

    playTournamentMusic();
    expect(getTournamentMusicSession()).toMatchObject({ desired: true, status: 'starting' });
    clearTournamentMusic();
    expect(getTournamentMusicSession().scene).toBeNull();
  });

  it('retries only blocked requested playback and does not restart a live override when closing the background', () => {
    selectTournamentMusic('league_cup', 3);
    const releaseOverride = overrideTournamentMusic('cup-final', 'super_cup');
    const revisionBeforeClose = getTournamentMusicSession().revision;
    clearTournamentMusic();
    expect(getTournamentMusicSession()).toMatchObject({
      scene: null,
      effectiveScene: 'super_cup',
      status: 'starting',
      revision: revisionBeforeClose,
    });

    releaseOverride();
    expect(getTournamentMusicSession()).toMatchObject({ effectiveScene: null, status: 'idle' });
    retryTournamentMusicPlayback();
    expect(getTournamentMusicSession().status).toBe('idle');
  });
});
