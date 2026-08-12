// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCompressedStorageForTests, compressedStorage } from './compressed-storage';
import { useGameStore } from './game-store';
import { SAVE_STORAGE_KEY } from './save-schema';

describe('game store advance scheduling', () => {
  let frames: FrameRequestCallback[];

  async function completeAdvance(advance: Promise<boolean>): Promise<boolean> {
    expect(frames).toHaveLength(1);
    frames.shift()!(performance.now());
    expect(frames).toHaveLength(1);
    frames.shift()!(performance.now());
    return advance;
  }

  beforeEach(async () => {
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
      lastWorldResponse: null,
      isAdvancing: false,
      advanceError: null,
      advanceTick: 0,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      narrativeMemory: [],
      starredFixtureIds: [],
      newAchievements: [],
    });
    compressedStorage.removeItem(SAVE_STORAGE_KEY);
    await useGameStore.getState().newGame(20260716);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCompressedStorageForTests();
  });

  it('publishes busy feedback before engine work and rejects duplicate taps', async () => {
    const before = useGameStore.getState().world!.seasonState.currentWindowIndex;
    const first = useGameStore.getState().advanceWindow();
    const second = useGameStore.getState().advanceWindow();

    expect(useGameStore.getState().isAdvancing).toBe(true);
    expect(useGameStore.getState().world!.seasonState.currentWindowIndex).toBe(before);
    await second;

    expect(frames).toHaveLength(1);
    frames.shift()!(performance.now());
    expect(frames).toHaveLength(1);
    expect(useGameStore.getState().world!.seasonState.currentWindowIndex).toBe(before);
    frames.shift()!(performance.now());
    await first;

    expect(useGameStore.getState().isAdvancing).toBe(false);
    expect(useGameStore.getState().advanceTick).toBe(1);
    expect(useGameStore.getState().world!.seasonState.currentWindowIndex).toBe(before + 1);
    expect(useGameStore.getState().lastWorldResponse).toMatchObject({
      mode: 'single',
      advancedWindows: 1,
    });
    expect(useGameStore.getState().narrativeMemory.length).toBeGreaterThan(0);
    expect(useGameStore.getState().narrativeMemory.length).toBeLessThanOrEqual(32);
    expect(useGameStore.getState().advanceError).toBeNull();
  });

  it('restores interaction and publishes a readable error when engine work fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const validWorld = useGameStore.getState().world!;
    const brokenWorld = { ...validWorld, seasonState: undefined } as unknown as typeof validWorld;
    useGameStore.setState({ world: brokenWorld });

    const advance = useGameStore.getState().advanceWindow();
    frames.shift()!(performance.now());
    frames.shift()!(performance.now());
    const completed = await advance;

    expect(completed).toBe(false);
    expect(useGameStore.getState().isAdvancing).toBe(false);
    expect(useGameStore.getState().advanceError).toContain('本次推进没有完成');
    useGameStore.getState().dismissAdvanceError();
    expect(useGameStore.getState().advanceError).toBeNull();
    consoleError.mockRestore();
  });

  it('queues only favorite-team achievements and keeps batch advancement consistent', async () => {
    const favoriteTeamId = Object.keys(useGameStore.getState().world!.teamBases)[0];
    useGameStore.getState().setFavoriteTeams([favoriteTeamId]);

    await completeAdvance(useGameStore.getState().advanceUntil('season_end'));
    expect(useGameStore.getState().getCurrentWindow()?.type).toBe('season_end');
    await completeAdvance(useGameStore.getState().advanceWindow());

    const singleNotifications = useGameStore.getState().newAchievements;
    expect(useGameStore.getState().world!.achievements.length).toBeGreaterThan(singleNotifications.length);
    expect(singleNotifications.length).toBeGreaterThan(0);
    expect(singleNotifications.every(achievement => achievement.teamId === favoriteTeamId)).toBe(true);

    await useGameStore.getState().newGame(20260716);
    useGameStore.getState().setFavoriteTeams([favoriteTeamId]);
    await completeAdvance(useGameStore.getState().batchAdvance(60));

    const batchNotifications = useGameStore.getState().newAchievements;
    expect(batchNotifications.map(achievement => achievement.id)).toEqual(
      singleNotifications.map(achievement => achievement.id),
    );
    expect(batchNotifications.every(achievement => achievement.teamId === favoriteTeamId)).toBe(true);
  });

  it('keeps world achievements without global toast spam when no team is followed', async () => {
    await completeAdvance(useGameStore.getState().batchAdvance(60));

    expect(useGameStore.getState().world!.achievements.length).toBeGreaterThan(0);
    expect(useGameStore.getState().newAchievements).toEqual([]);
  });

  it('clears transient universe state for a new game and a full reset', async () => {
    const achievement = {
      id: 'test-achievement',
      title: '测试成就',
      description: '不应进入新宇宙',
      seasonNumber: 1,
    };
    useGameStore.setState({
      advanceTick: 8,
      favoriteTeamId: 'old-team',
      favoriteTeamIds: ['old-team'],
      narrativeMemory: [{
        arcKey: 'old-arc',
        fingerprint: 'old-fingerprint',
        lastChangedAt: 1,
        lastSelectedAt: 1,
      }],
      starredFixtureIds: ['old-fixture'],
      newAchievements: [achievement],
    });

    await useGameStore.getState().newGame(20260809);
    expect(useGameStore.getState()).toMatchObject({
      advanceTick: 0,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      narrativeMemory: [],
      starredFixtureIds: [],
      newAchievements: [],
    });

    useGameStore.setState({
      advanceTick: 3,
      narrativeMemory: [{
        arcKey: 'another-arc',
        fingerprint: 'another-fingerprint',
        lastChangedAt: 2,
        lastSelectedAt: 2,
      }],
      starredFixtureIds: ['another-fixture'],
      newAchievements: [achievement],
    });
    useGameStore.getState().resetGame();
    expect(useGameStore.getState()).toMatchObject({
      world: null,
      initialized: false,
      advanceTick: 0,
      narrativeMemory: [],
      starredFixtureIds: [],
      newAchievements: [],
    });
  });
});
