// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { initializeGameWorld, initializeNewSeason } from '../engine/season/season-manager';
import { __flushCompressedStorageForTests, compressedStorage } from './compressed-storage';
import {
  __resetSaveRecoveryForTests,
  consumeSaveRecoveryMessage,
  currentSaveStorage,
  getLatestSaveRecoveryDiagnostic,
  getSaveRecoveryMessage,
  SAVE_DIAGNOSTIC_KEY,
  SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_KEY,
} from './save-schema';

function makeSave(seasonNumber = 3) {
  const initializedWorld = initializeGameWorld(20260730);
  const world = {
    ...initializedWorld,
    seasonState: {
      ...initializedWorld.seasonState,
      seasonNumber,
    },
  };
  const favoriteTeamId = Object.keys(world.teamBases)[0];
  return {
    version: SAVE_SCHEMA_VERSION,
    state: {
      initialized: true,
      lastResults: [],
      lastNews: [],
      favoriteTeamId: null,
      favoriteTeamIds: [favoriteTeamId],
      world,
    },
  };
}

function makeSeasonFiveSave() {
  const initializedWorld = initializeGameWorld(20260730);
  const world = initializeNewSeason({
    ...initializedWorld,
    seasonState: {
      ...initializedWorld.seasonState,
      seasonNumber: 4,
    },
  });
  const favoriteTeamId = Object.keys(world.teamBases)[0];
  return {
    version: SAVE_SCHEMA_VERSION,
    state: {
      initialized: true,
      lastResults: [],
      lastNews: [],
      favoriteTeamId: null,
      favoriteTeamIds: [favoriteTeamId],
      world,
    },
  };
}

beforeEach(() => {
  __flushCompressedStorageForTests();
  localStorage.clear();
  __resetSaveRecoveryForTests();
});

describe('current schema hydration boundary', () => {
  it('hydrates a valid current save through Zustand JSON storage', () => {
    compressedStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(makeSave(7)));
    __flushCompressedStorageForTests();

    type TestState = { initialized: boolean; world: unknown };
    const useTestStore = create<TestState>()(
      persist<TestState>(
        () => ({ initialized: false, world: null }),
        {
          name: SAVE_STORAGE_KEY,
          version: SAVE_SCHEMA_VERSION,
          storage: createJSONStorage(() => currentSaveStorage),
        },
      ),
    );

    expect(useTestStore.getState().initialized).toBe(true);
    expect(useTestStore.getState().world).toMatchObject({
      seasonState: { seasonNumber: 7 },
    });
    expect(getSaveRecoveryMessage()).toBeNull();
  });

  it('accepts current-version saves created before optional defensive fields existed', () => {
    const save = makeSave();
    for (const stat of Object.values(save.state.world.playerStats)) {
      delete stat.routineSaves;
      delete stat.shotsOnTargetFaced;
      delete stat.cleanSheetMinutes;
      delete stat.goalsConcededWhileOnPitch;
      delete stat.interceptions;
      delete stat.clearances;
    }
    for (const stat of Object.values(save.state.world.playerStatSegments ?? {})) {
      delete stat.routineSaves;
      delete stat.shotsOnTargetFaced;
      delete stat.cleanSheetMinutes;
      delete stat.goalsConcededWhileOnPitch;
      delete stat.interceptions;
      delete stat.clearances;
    }
    compressedStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(save));
    __flushCompressedStorageForTests();
    expect(currentSaveStorage.getItem(SAVE_STORAGE_KEY)).not.toBeNull();
    expect(getSaveRecoveryMessage()).toBeNull();
  });

  it('keeps an in-progress selective continental cup save readable', () => {
    const save = makeSeasonFiveSave();
    const cups = save.state.world.continentalCups;
    for (const [cup, groupCount] of [
      [cups.mainland_cup, 2],
      [cups.southern_cup, 1],
      [cups.eastern_cup, 1],
    ] as const) {
      if (!cup) throw new Error('Expected active continental cup');
      cup.groups = cup.groups.slice(0, groupCount);
      cup.participantIds = cup.groups.flatMap(group => group.teamIds);
      const participants = new Set(cup.participantIds);
      cup.qualificationOrder = cup.qualificationOrder.filter(teamId => participants.has(teamId));
    }
    let continentalWindows = 0;
    save.state.world.seasonState.calendar = save.state.world.seasonState.calendar.filter(window => {
      if (window.type !== 'continental_cup') return true;
      continentalWindows += 1;
      return continentalWindows <= 5;
    });

    compressedStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(save));
    __flushCompressedStorageForTests();

    expect(currentSaveStorage.getItem(SAVE_STORAGE_KEY)).not.toBeNull();
    expect(getSaveRecoveryMessage()).toBeNull();
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['wrong version', JSON.stringify({ ...makeSave(), version: SAVE_SCHEMA_VERSION - 1 })],
    ['missing world fields', JSON.stringify({
      ...makeSave(),
      state: { ...makeSave().state, world: { seasonState: { seasonNumber: 1, calendar: [] } } },
    })],
    ['missing nested runtime fields', JSON.stringify({
      ...makeSave(),
      state: {
        ...makeSave().state,
        world: { ...makeSave().state.world, rngState: undefined },
      },
    })],
    ['duplicate player UUID', (() => {
      const save = makeSave();
      const teamIds = Object.keys(save.state.world.squads);
      save.state.world.squads[teamIds[1]][0].uuid = save.state.world.squads[teamIds[0]][0].uuid;
      return JSON.stringify(save);
    })()],
    ['invalid observation theme', JSON.stringify({
      ...makeSave(),
      state: { ...makeSave().state, observationThemePreference: 'score_boost' },
    })],
    ['invalid observer archive counters', (() => {
      const save = makeSave();
      const teamId = Object.keys(save.state.world.teamBases)[0];
      save.state.world.observerSeasonTrajectories = [{
        seasonNumber: 1,
        teamId,
        leagueLevel: 1,
        checkpoints: [
          { phase: 'opening', played: 4, position: 1, points: 10, goalDifference: 4 },
          { phase: 'midseason', played: 8, position: 1, points: 20, goalDifference: 8 },
          { phase: 'run_in', played: 12, position: 1, points: 30, goalDifference: 12 },
          { phase: 'final', played: 16, position: 1, points: 40, goalDifference: 16 },
        ],
        judgment: { total: 3, correct: 4, currentStreak: 4, bestStreak: 4 },
      }];
      return JSON.stringify(save);
    })()],
    ['league cup fixture missing neutral venue', (() => {
      const save = makeSave();
      delete save.state.world.leagueCup.rounds[0].fixtures[0].isNeutralVenue;
      return JSON.stringify(save);
    })()],
    ['super cup group fixture falsely marked neutral', (() => {
      const save = makeSave();
      save.state.world.superCup.groups[0].fixtures[0].isNeutralVenue = true;
      return JSON.stringify(save);
    })()],
    ['continental group fixture using an illegal fourth round', (() => {
      const save = makeSeasonFiveSave();
      save.state.world.continentalCups.mainland_cup!.groups[0].fixtures[0].round = 4;
      return JSON.stringify(save);
    })()],
  ])('quarantines %s, clears the active key, and exposes a recovery notice', (_label, payload) => {
    localStorage.setItem(SAVE_STORAGE_KEY, payload);

    expect(currentSaveStorage.getItem(SAVE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SAVE_DIAGNOSTIC_KEY)).not.toBeNull();
    expect(getLatestSaveRecoveryDiagnostic()?.payload).toBe(payload);
    expect(getSaveRecoveryMessage()).toContain('已隔离并返回新游戏');
    expect(consumeSaveRecoveryMessage()).toContain('已隔离并返回新游戏');
    expect(consumeSaveRecoveryMessage()).toBeNull();
  });
});
