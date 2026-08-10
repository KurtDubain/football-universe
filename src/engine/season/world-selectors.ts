import type { CalendarWindow } from '../../types/season';
import type { GameWorld } from './season-manager';

/** Return the active calendar window without loading the season runtime. */
export function getCurrentWindow(world: GameWorld): CalendarWindow | null {
  const { seasonState } = world;
  if (seasonState.completed) return null;
  const { calendar, currentWindowIndex } = seasonState;
  if (currentWindowIndex >= calendar.length) return null;
  return calendar[currentWindowIndex];
}

export function isSeasonFullyComplete(world: GameWorld): boolean {
  return world.seasonState.completed;
}
