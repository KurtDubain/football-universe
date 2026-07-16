import { describe, expect, it } from 'vitest';
import { compressToUTF16 } from 'lz-string';
import { executeCurrentWindow, initializeGameWorld } from '../engine/season/season-manager';
import { validateWorldData } from '../engine/validation/world-data';
import { archiveCompletedMatchDetails, boundWorldStorageMetadata } from './save-compaction';
import { isSaveNearCapacity, SAVE_WARNING_BYTES } from './save-budget';
import { measureWorldSaveSize } from './save-size';

function withoutReplayDetails(world: ReturnType<typeof initializeGameWorld>): unknown {
  return JSON.parse(JSON.stringify(world, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    if (typeof record.fixtureId !== 'string' || !Array.isArray(record.events)) return value;
    const canonical = { ...record };
    delete canonical.events;
    delete canonical.homeMatchday;
    delete canonical.awayMatchday;
    delete canonical.detailsArchived;
    return canonical;
  }));
}

describe('save compaction', () => {
  it('warns at the conservative four-megabyte danger threshold', () => {
    expect(isSaveNearCapacity(SAVE_WARNING_BYTES - 1)).toBe(false);
    expect(isSaveNearCapacity(SAVE_WARNING_BYTES)).toBe(true);
  });

  it('archives replay detail while preserving canonical results and aggregates', () => {
    let world = initializeGameWorld(20260716);
    for (let index = 0; index < 8; index++) world = executeCurrentWindow(world).world;

    const beforeValidation = validateWorldData(world);
    expect(beforeValidation.errors).toEqual([]);
    expect(beforeValidation.warnings).toEqual([]);
    const beforeResults = world.seasonState.calendar.flatMap((window) => window.results);
    const canonicalBefore = beforeResults.map((result) => ({
      fixtureId: result.fixtureId,
      score: [result.homeGoals, result.awayGoals, result.etHomeGoals, result.etAwayGoals],
      stats: result.stats,
      prediction: result.prediction,
    }));
    const playerStatsBefore = structuredClone(world.playerStats);

    const cleanup = archiveCompletedMatchDetails(world);
    const afterResults = cleanup.world.seasonState.calendar.flatMap((window) => window.results);
    const canonicalAfter = afterResults.map((result) => ({
      fixtureId: result.fixtureId,
      score: [result.homeGoals, result.awayGoals, result.etHomeGoals, result.etAwayGoals],
      stats: result.stats,
      prediction: result.prediction,
    }));

    expect(cleanup.archivedResults).toBeGreaterThan(0);
    expect(cleanup.removedEvents).toBeGreaterThan(0);
    expect(cleanup.removedMatchdaySnapshots).toBe(cleanup.archivedResults * 2);
    expect(cleanup.rawBytesAfter).toBeLessThan(cleanup.rawBytesBefore);
    expect(canonicalAfter).toEqual(canonicalBefore);
    expect(cleanup.world.playerStats).toEqual(playerStatsBefore);
    expect(afterResults.filter((result) => result.detailsArchived)
      .every((result) => result.events.length === 0 && !result.homeMatchday && !result.awayMatchday)).toBe(true);
    expect(withoutReplayDetails(cleanup.world)).toEqual(withoutReplayDetails(world));

    const originalNext = executeCurrentWindow(structuredClone(world));
    const compactedNext = executeCurrentWindow(structuredClone(cleanup.world));
    expect(compactedNext.results).toEqual(originalNext.results);
    expect(withoutReplayDetails(compactedNext.world)).toEqual(withoutReplayDetails(originalNext.world));

    const afterValidation = validateWorldData(cleanup.world);
    expect(afterValidation.errors).toEqual([]);
    expect(afterValidation.warnings).toEqual([]);
  });

  it('reports separate size categories and bounds metadata without archiving matches', () => {
    let world = initializeGameWorld(99);
    world = executeCurrentWindow(world).world;
    world = { ...world, newsLog: Array.from({ length: 250 }, (_, index) => ({
      id: `news-${index}`,
      seasonNumber: 1,
      windowIndex: 0,
      type: 'match_result' as const,
      title: 'news',
      description: 'detail',
    })) };

    const bounded = boundWorldStorageMetadata(world);
    expect(bounded.newsLog).toHaveLength(200);
    expect(bounded.seasonState.calendar.flatMap((window) => window.results)
      .some((result) => result.events.length > 0)).toBe(true);

    const report = measureWorldSaveSize(bounded, 'test', compressToUTF16);
    expect(report.total.rawBytes).toBeGreaterThan(0);
    expect(report.total.compressedBytes).toBeGreaterThan(0);
    expect(report.categories.currentEvents.rawBytes).toBeGreaterThan(0);
    expect(report.categories.matchdaySnapshots.rawBytes).toBeGreaterThan(0);
    expect(report.categories.forecastsAndPredictions.rawBytes).toBeGreaterThan(0);
  });
});
