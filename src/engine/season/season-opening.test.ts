import { describe, expect, it } from 'vitest';
import { planNextKeyNode } from '../observation/key-node';
import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from './season-manager';
import { buildSeasonOpening } from './season-opening';

const SEED = 20260722;

/** Play a whole season so the next opening window has a real archive to read. */
function playOneSeason(seed: number): GameWorld {
  let world = initializeGameWorld(seed);
  const startingSeason = world.seasonState.seasonNumber;
  for (let step = 0; step < 200 && world.seasonState.seasonNumber === startingSeason; step++) {
    world = executeCurrentWindow(world).world;
  }
  expect(world.seasonState.seasonNumber).toBe(startingSeason + 1);
  return world;
}

describe('season opening window', () => {
  it('opens every season on a fixture-less pre_season window', () => {
    const world = initializeGameWorld(SEED);
    const first = world.seasonState.calendar[0];
    expect(first.type).toBe('pre_season');
    expect(first.fixtures).toEqual([]);
    expect(first.completed).toBe(false);
    expect(getCurrentWindow(world)?.type).toBe('pre_season');
    expect(world.seasonState.calendar.length).toBeGreaterThan(1);
    expect(world.seasonState.calendar.filter(window => window.type === 'pre_season')).toHaveLength(1);

    // Not just the first season: the window is rebuilt with every calendar.
    const next = playOneSeason(SEED);
    expect(next.seasonState.calendar[0].type).toBe('pre_season');
    expect(getCurrentWindow(next)?.type).toBe('pre_season');
  });

  it('consumes no randomness and no match-bearing window budget', () => {
    const world = initializeGameWorld(SEED);
    const after = executeCurrentWindow(world).world;

    // This is the whole premise of the feature: adding the window must not
    // move a single seeded result.
    expect(after.rngState).toEqual(world.rngState);
    expect(after.totalElapsedWindows).toBe(world.totalElapsedWindows);

    expect(after.seasonState.calendar[0].completed).toBe(true);
    expect(after.seasonState.calendar[0].results).toEqual([]);
    expect(after.seasonState.currentWindowIndex).toBe(1);
    expect(getCurrentWindow(after)?.fixtures.length).toBeGreaterThan(0);
  });

  it('stays RNG-free in later seasons, transfer auto-resolve included', () => {
    // Season 1 has no transfer window, so the season-1 assertion above never
    // exercises the auto-resolve that runs *before* the pre_season branch.
    const favoriteTeamIds = Object.keys(initializeGameWorld(SEED).teamBases).slice(0, 6);
    let world = initializeGameWorld(SEED);
    let openingWindows = 0;
    let noticesReturned = 0;

    for (let step = 0; step < 300 && openingWindows < 2; step++) {
      const window = getCurrentWindow(world);
      if (!window) break;
      if (window.type === 'pre_season') {
        const rngBefore = world.rngState;
        const elapsedBefore = world.totalElapsedWindows;
        const outcome = executeCurrentWindow(world, { favoriteTeamIds });
        expect(outcome.world.rngState).toEqual(rngBefore);
        expect(outcome.world.totalElapsedWindows).toBe(elapsedBefore);
        noticesReturned += outcome.news
          .filter(item => item.title.includes('转会窗口已自动结算')).length;
        world = outcome.world;
        openingWindows++;
        continue;
      }
      world = executeCurrentWindow(world, { favoriteTeamIds }).world;
    }

    expect(openingWindows).toBe(2);
    // A window carried over from season end auto-resolves on the opening
    // window, and its notice has to survive the branch rather than be dropped.
    expect(noticesReturned).toBeGreaterThan(0);
  });

  it('reads the world without mutating it', () => {
    const world = initializeGameWorld(SEED);
    const before = JSON.stringify(world);
    buildSeasonOpening(world, { favoriteTeamIds: [Object.keys(world.teamBases)[0]] });
    expect(JSON.stringify(world)).toBe(before);
  });

  it('shows every draw the season has already had', () => {
    const world = initializeGameWorld(SEED);
    const opening = buildSeasonOpening(world);
    expect(opening.seasonNumber).toBe(1);

    const keys = opening.draws.map(draw => draw.key);
    expect(keys).toContain('league_cup');
    expect(keys).toContain('super_cup');

    for (const draw of opening.draws) {
      expect(draw.title.length).toBeGreaterThan(0);
      expect(draw.rule.length).toBeGreaterThan(0);
      expect(draw.groups.length + draw.pairings.length).toBeGreaterThan(0);
    }

    // The full first round, not a sample of it.
    const leagueCup = opening.draws.find(draw => draw.key === 'league_cup')!;
    expect(leagueCup.groups).toEqual([]);
    expect(leagueCup.pairings).toHaveLength(world.leagueCup.rounds[0].fixtures.length);

    const superCup = opening.draws.find(draw => draw.key === 'super_cup')!;
    expect(superCup.pairings).toEqual([]);
    expect(superCup.groups).toHaveLength(world.superCup.groups.length);
    expect(superCup.groups.flatMap(group => group.teams)).toHaveLength(
      world.superCup.groups.reduce((total, group) => total + group.teamIds.length, 0),
    );

    // Continental and world cups only exist in the seasons that run them.
    for (const cup of [
      world.continentalCups.mainland_cup,
      world.continentalCups.southern_cup,
      world.continentalCups.eastern_cup,
    ]) {
      if (!cup) continue;
      expect(keys).toContain(`continental:${cup.type}`);
    }
    expect(keys.includes('world_cup')).toBe(Boolean(world.worldCup));
  });

  it('names only real clubs and keeps group callouts scarce', () => {
    const world = initializeGameWorld(SEED);
    const opening = buildSeasonOpening(world);

    for (const draw of opening.draws) {
      // Eight flagged groups reads the same as none flagged.
      expect(draw.groups.filter(group => group.note).length).toBeLessThanOrEqual(2);
      for (const group of draw.groups) {
        expect(group.teams.length).toBeGreaterThan(0);
        // Strongest first, so the note above the table matches what the eye reads.
        expect(group.teams.map(team => team.overall))
          .toEqual([...group.teams.map(team => team.overall)].sort((a, b) => b - a));
        for (const team of group.teams) {
          expect(world.teamBases[team.teamId]).toBeDefined();
          expect(team.overall).toBe(world.teamBases[team.teamId].overall);
          expect(team.name).toBe(world.teamBases[team.teamId].name);
        }
      }
      for (const pairing of draw.pairings) {
        expect(world.teamBases[pairing.homeId]).toBeDefined();
        expect(world.teamBases[pairing.awayId]).toBeDefined();
        expect(pairing.homeId).not.toBe(pairing.awayId);
      }
    }
  });

  it('falls back to the paper favourite when there is no archive to read', () => {
    const world = initializeGameWorld(SEED);
    const opening = buildSeasonOpening(world);

    expect(opening.storylines.some(item => item.key === 'defending-champion')).toBe(false);
    const fallback = opening.storylines.find(item => item.key === 'paper-favourite');
    expect(fallback).toBeDefined();

    // The one thing the numbers actually state — not an invented history.
    const strongest = Object.values(world.teamBases)
      .slice()
      .sort((a, b) => b.overall - a.overall)[0];
    expect(fallback!.teamId).toBe(strongest.id);
    expect(fallback!.detail).toContain(String(strongest.overall));
  });

  it('adds a followed-club read only when a club is followed', () => {
    const world = initializeGameWorld(SEED);
    const favoriteTeamId = Object.keys(world.teamBases)[0];

    expect(buildSeasonOpening(world).storylines.some(item => item.key === 'favorite')).toBe(false);
    const followed = buildSeasonOpening(world, { favoriteTeamIds: [favoriteTeamId] });
    const item = followed.storylines.find(entry => entry.key === 'favorite');
    expect(item?.teamId).toBe(favoriteTeamId);
    expect(item?.title).toContain(world.teamBases[favoriteTeamId].name);
  });

  it('reads the real offseason once a season is on the books', () => {
    const world = playOneSeason(SEED);
    const opening = buildSeasonOpening(world);
    expect(opening.seasonNumber).toBe(2);

    const previous = world.honorHistory.find(row => row.seasonNumber === 1);
    expect(previous).toBeDefined();

    const champion = opening.storylines.find(item => item.key === 'defending-champion');
    expect(champion?.teamId).toBe(previous!.league1Champion);
    expect(champion!.title).toContain(world.teamBases[previous!.league1Champion].name);
    expect(opening.storylines.some(item => item.key === 'paper-favourite')).toBe(false);

    const promoted = previous!.promoted.filter(row => row.to === 1);
    const promotedItem = opening.storylines.find(item => item.key === 'promoted');
    expect(Boolean(promotedItem)).toBe(promoted.length > 0);
    if (promotedItem) expect(promotedItem.teamId).toBe(promoted[0].teamId);

    // Every storyline must point at something that exists.
    for (const item of opening.storylines) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
      if (item.teamId) expect(world.teamBases[item.teamId]).toBeDefined();
      if (item.coachId) expect(world.coachBases[item.coachId]).toBeDefined();
    }
  });

  it('stays readable from any window, not only the opening one', () => {
    let world = initializeGameWorld(SEED);
    for (let step = 0; step < 5; step++) world = executeCurrentWindow(world).world;

    const opening = buildSeasonOpening(world);
    expect(opening.seasonNumber).toBe(world.seasonState.seasonNumber);
    expect(opening.draws.length).toBeGreaterThan(0);
  });

  it('registers the opening window as a key node that blocks the jump to it', () => {
    const world = initializeGameWorld(SEED);
    const plan = planNextKeyNode(world, []);
    expect(plan?.reason).toBe('season_open');
    expect(plan?.windowIndex).toBe(0);
    expect(plan?.skipWindows).toBe(0);
    expect(plan?.blocked).toBe(true);

    // Once past it, it is behind us and no longer a jump target.
    const later = executeCurrentWindow(world).world;
    expect(planNextKeyNode(later, [])?.reason).not.toBe('season_open');
  });
});
