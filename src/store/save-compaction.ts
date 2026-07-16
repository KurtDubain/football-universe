import type { GameWorld } from '../engine/season/season-manager';

export interface StorageCleanupResult {
  world: GameWorld;
  archivedResults: number;
  removedEvents: number;
  removedMatchdaySnapshots: number;
  rawBytesBefore: number;
  rawBytesAfter: number;
}

export function boundWorldStorageMetadata(world: GameWorld): GameWorld {
  if (world.newsLog.length <= 200) return world;
  return { ...world, newsLog: world.newsLog.slice(-200) };
}

export function archiveCompletedMatchDetails(world: GameWorld): StorageCleanupResult {
  const rawBytesBefore = new TextEncoder().encode(JSON.stringify(world)).byteLength;
  let archivedResults = 0;
  let removedEvents = 0;
  let removedMatchdaySnapshots = 0;

  const calendar = world.seasonState.calendar.map((window) => {
    if (!window.completed || window.results.length === 0) return window;
    let changed = false;
    const results = window.results.map((result) => {
      if (result.detailsArchived) return result;
      const hasReplayDetail = result.events.length > 0 || result.homeMatchday || result.awayMatchday;
      if (!hasReplayDetail) return result;
      changed = true;
      archivedResults++;
      removedEvents += result.events.length;
      removedMatchdaySnapshots += Number(Boolean(result.homeMatchday)) + Number(Boolean(result.awayMatchday));
      return {
        ...result,
        events: [],
        homeMatchday: undefined,
        awayMatchday: undefined,
        detailsArchived: true,
      };
    });
    return changed ? { ...window, results } : window;
  });

  const bounded = boundWorldStorageMetadata({
    ...world,
    seasonState: { ...world.seasonState, calendar },
  });
  const rawBytesAfter = new TextEncoder().encode(JSON.stringify(bounded)).byteLength;
  return {
    world: bounded,
    archivedResults,
    removedEvents,
    removedMatchdaySnapshots,
    rawBytesBefore,
    rawBytesAfter,
  };
}
