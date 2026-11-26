// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { editionStorageKey } from '../../edition/policy';
import {
  dismissCeremony,
  getCeremonySession,
  requestCeremony,
  resetCeremonySession,
  setCeremonyScope,
} from './ceremony-session';
import type { CeremonyRequest } from './ceremony-types';

function stamp(champion: string): CeremonyRequest {
  return {
    kind: 'cup_stamp',
    competitionName: '联赛杯',
    roundLabel: '决赛',
    champion: { teamId: champion, name: champion, shortName: champion, color: '#ffffff' },
    runnerUp: null,
    score: '2-1',
    finalMvp: null,
    topScorer: null,
  };
}

function opening(seasonNumber: number): CeremonyRequest {
  return {
    kind: 'season_opening',
    seasonNumber,
    lines: ['格局'],
    draws: [],
  };
}

beforeEach(() => {
  sessionStorage.clear();
  resetCeremonySession();
});

describe('ceremony session', () => {
  it('accepts a ceremony once and refuses the same key afterwards', () => {
    expect(requestCeremony(stamp('alpha'))).toBe(true);
    expect(requestCeremony(stamp('alpha'))).toBe(false);
    expect(getCeremonySession().current?.kind).toBe('cup_stamp');
  });

  it('queues behind the current page and promotes on dismiss', () => {
    requestCeremony(opening(3));
    requestCeremony(stamp('alpha'));
    expect(getCeremonySession().current?.kind).toBe('season_opening');
    expect(getCeremonySession().pending).toBe(1);

    dismissCeremony();
    expect(getCeremonySession().current?.kind).toBe('cup_stamp');
    expect(getCeremonySession().pending).toBe(0);

    dismissCeremony();
    expect(getCeremonySession().current).toBeNull();
  });

  it('ignores a dismiss with nothing on screen', () => {
    const before = getCeremonySession().revision;
    dismissCeremony();
    expect(getCeremonySession().revision).toBe(before);
  });

  it('drops the queue and the memory when the scope changes', () => {
    setCeremonyScope('world-a:3');
    requestCeremony(opening(3));
    expect(getCeremonySession().current).not.toBeNull();

    setCeremonyScope('world-b:0');
    expect(getCeremonySession().current).toBeNull();
    // A different save is a different annual: its season one must still play.
    expect(requestCeremony(opening(3))).toBe(true);
  });

  it('keeps its place across a reload inside one scope', () => {
    setCeremonyScope('world-a:3');
    requestCeremony(opening(3));

    // A reload keeps sessionStorage but loses the in-memory queue.
    resetCeremonySession();
    sessionStorage.setItem(
      editionStorageKey('ui.ceremony.seen'),
      JSON.stringify({ scope: 'world-a:3', keys: ['season_opening:3'] }),
    );
    setCeremonyScope('world-a:3');
    expect(requestCeremony(opening(3))).toBe(false);
    expect(requestCeremony(opening(4))).toBe(true);
  });
});
