import { describe, expect, it } from 'vitest';
import { getCurrentWindow, initializeGameWorld } from './season-manager';
import { computeFixtureImportance, pickFocusMatches } from './match-importance';

describe('observer fixture importance', () => {
  it('weights the primary observer team above secondary favorites', () => {
    const world = initializeGameWorld(20260718);
    const window = getCurrentWindow(world)!;
    const primaryTeamId = window.fixtures[0].homeTeamId;
    const secondaryFixture = window.fixtures.find(fixture => (
      fixture.homeTeamId !== primaryTeamId && fixture.awayTeamId !== primaryTeamId
    ))!;
    const secondaryTeamId = secondaryFixture.homeTeamId;
    const primaryFixture = window.fixtures.find(fixture => (
      fixture.homeTeamId === primaryTeamId || fixture.awayTeamId === primaryTeamId
    ))!;
    const favorites = [primaryTeamId, secondaryTeamId];

    const primaryBase = computeFixtureImportance(primaryFixture, world, []);
    const secondaryBase = computeFixtureImportance(secondaryFixture, world, []);
    const primary = computeFixtureImportance(primaryFixture, world, favorites, primaryTeamId);
    const secondary = computeFixtureImportance(secondaryFixture, world, favorites, primaryTeamId);

    expect(primary.score - primaryBase.score).toBe(8);
    expect(primary.reasons).toContain('主要观察球队出战');
    expect(secondary.score - secondaryBase.score).toBe(5);
    expect(secondary.reasons).toContain('关注球队出战');
  });

  it('keeps the primary team in the focus list ahead of unrelated marquee matches', () => {
    const world = initializeGameWorld(20260718);
    const window = getCurrentWindow(world)!;
    const primaryTeamId = window.fixtures.at(-1)!.awayTeamId;

    const focus = pickFocusMatches(window.fixtures, world, [primaryTeamId], 2, primaryTeamId);

    expect(focus[0].fixture.homeTeamId === primaryTeamId
      || focus[0].fixture.awayTeamId === primaryTeamId).toBe(true);
    expect(focus[0].importance.reasons).toContain('主要观察球队出战');
  });
});
