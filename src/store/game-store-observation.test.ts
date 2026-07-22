// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveObservationSelection } from '../engine/observation/judgment';
import { __resetCompressedStorageForTests, compressedStorage } from './compressed-storage';
import { useGameStore } from './game-store';
import { SAVE_STORAGE_KEY } from './save-schema';

describe('game store observation settlement paths', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    __resetCompressedStorageForTests();
    localStorage.clear();
    useGameStore.setState({
      world: null,
      initialized: false,
      lastResults: [],
      lastNews: [],
      lastObservationSettlements: [],
      isAdvancing: false,
      advanceTick: 0,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      starredFixtureIds: [],
      newAchievements: [],
    });
    compressedStorage.removeItem(SAVE_STORAGE_KEY);
    useGameStore.getState().newGame(20260722);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCompressedStorageForTests();
  });

  async function completeAdvance(promise: Promise<void>) {
    frames.shift()!(performance.now());
    frames.shift()!(performance.now());
    await promise;
  }

  function judgeFirstFixture() {
    const original = useGameStore.getState().world!;
    const fixtureId = original.seasonState.calendar[original.seasonState.currentWindowIndex].fixtures[0].id;
    useGameStore.getState().setObservationJudgment(fixtureId, 'outcome', 'home');
    expect(original.pendingObservationJudgment).toBeNull();
    expect(useGameStore.getState().world?.rngState).toBe(original.rngState);
    return fixtureId;
  }

  it('settles one judgment through a single-window advance', async () => {
    const fixtureId = judgeFirstFixture();
    await completeAdvance(useGameStore.getState().advanceWindow());

    const state = useGameStore.getState();
    const result = state.lastResults.find(entry => entry.fixtureId === fixtureId)!;
    const correct = resolveObservationSelection('outcome', result) === 'home';
    expect(state.world?.pendingObservationJudgment).toBeNull();
    expect(state.world?.observationRecord).toMatchObject({ total: 1, correct: Number(correct) });
    expect(state.lastObservationSettlements).toHaveLength(1);
  });

  it.each([
    ['batch advance', () => useGameStore.getState().batchAdvance(2)],
    ['next cup', () => useGameStore.getState().advanceUntil('cup')],
    ['season end', () => useGameStore.getState().advanceUntil('season_end')],
  ])('preserves compact settlement feedback through %s', async (_label, advance) => {
    judgeFirstFixture();
    await completeAdvance(advance());

    expect(useGameStore.getState().world?.observationRecord?.total).toBe(1);
    expect(useGameStore.getState().lastObservationSettlements).toHaveLength(1);
  });

  it('allows only current-window fixtures and replaces the one pending judgment', () => {
    const world = useGameStore.getState().world!;
    const [first, second] = world.seasonState.calendar[0].fixtures;
    useGameStore.getState().setObservationJudgment('future-fixture', 'upset', 'yes');
    expect(useGameStore.getState().world?.pendingObservationJudgment).toBeNull();

    useGameStore.getState().setObservationJudgment(first.id, 'outcome', 'home');
    useGameStore.getState().setObservationJudgment(second.id, 'goals', 'over-2');
    expect(useGameStore.getState().world?.pendingObservationJudgment).toMatchObject({
      fixtureId: second.id,
      kind: 'goals',
      selection: 'over-2',
    });
  });
});
