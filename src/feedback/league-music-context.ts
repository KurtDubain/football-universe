// When the league bed is the right thing to be playing.
//
// The rule reads the season, not the URL. A route can only tell you where
// the viewer clicked; the calendar window tells you what the season is
// actually doing, and a cup window means a cup theme is already the honest
// soundtrack. The route is still consulted, but only to decide where the bed
// is welcome — the season decides whether it is true.

import type { GameWorld } from '../engine/season/season-manager';
import { getCurrentWindow } from '../engine/season/world-selectors';
import type { AmbientMusicScene } from './ambient-music';

export const LEAGUE_BED_SCENE: AmbientMusicScene = 'league_season';

/**
 * Where the season desk lives.
 *
 * Deliberately short. The bed is for sitting in front of the table and the
 * calendar, not for following the viewer into the transfer market.
 */
export function isLeagueBedRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/calendar' || pathname.startsWith('/league/');
}

/** Windows where the league itself is the story, rather than a cup. */
const LEAGUE_PHASE_WINDOWS: ReadonlySet<string> = new Set(['league', 'pre_season', 'season_end']);

function inLeaguePhase(world: GameWorld): boolean {
  const current = getCurrentWindow(world);
  // A finished season has no current window, and the archive is still the desk.
  if (!current) return world.seasonState.completed;
  return LEAGUE_PHASE_WINDOWS.has(current.type);
}

/**
 * The scene the league bed should hold on this route, or null for silence.
 *
 * Null covers both cases that must stay quiet: a route the bed does not
 * belong on, and a season that is currently inside a cup.
 */
export function leagueBedScene(world: GameWorld, pathname: string): AmbientMusicScene | null {
  if (!isLeagueBedRoute(pathname)) return null;
  return inLeaguePhase(world) ? LEAGUE_BED_SCENE : null;
}

/**
 * Whether a cup theme still playing should hand over to the bed.
 *
 * A cup theme outlives its own page on purpose, so that walking to another
 * screen mid-final does not cut the music off. Once the calendar has moved
 * back to a league window the cup is over, and the bed is the honest thing to
 * be playing again.
 */
export function shouldYieldToLeagueBed(
  world: GameWorld,
  pathname: string,
  scene: AmbientMusicScene | null,
): boolean {
  if (!scene || scene === LEAGUE_BED_SCENE) return false;
  if (!isLeagueBedRoute(pathname)) return false;
  return inLeaguePhase(world);
}
