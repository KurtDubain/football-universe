import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from './season-manager';

/**
 * A world positioned on its first match-bearing window.
 *
 * Every season now opens with a fixture-less `pre_season` window that
 * carries the draw and the pre-season read. Tests that care about
 * fixtures, focus matches or results want the window after it, and this
 * keeps that intent out of the individual test bodies.
 *
 * Advancing past the opening window is RNG-free by construction, so the
 * matchday reached here is identical to the one a pre-opening-window
 * build produced for the same seed.
 */
export function firstMatchdayWorld(seed: number): GameWorld {
  let world = initializeGameWorld(seed);
  while (getCurrentWindow(world)?.type === 'pre_season') {
    world = executeCurrentWindow(world).world;
  }
  return world;
}

/**
 * Skip the opening window of an already-built world, in place of the
 * caller doing it by hand.
 */
export function pastSeasonOpening(world: GameWorld): GameWorld {
  let current = world;
  while (getCurrentWindow(current)?.type === 'pre_season') {
    current = executeCurrentWindow(current).world;
  }
  return current;
}
