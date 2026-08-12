import { describe, expect, it } from 'vitest';
import { getCurrentWindow, initializeGameWorld } from './season-manager';
import { computeFixtureImportance, pickFocusMatches } from './match-importance';
import type { MatchFixture } from '../../types/match';

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

  it('applies the documented focus hierarchy before raw importance score', () => {
    const world = initializeGameWorld(20260718);
    const template = getCurrentWindow(world)!.fixtures[0];
    const rankedIds = world.league1Standings.map(entry => entry.teamId);
    const otherIds = Object.keys(world.teamBases).filter(id => !rankedIds.slice(0, 4).includes(id));
    const primaryTeamId = otherIds[0];
    const fixtures: MatchFixture[] = [
      { ...template, id: '05-marquee', homeTeamId: otherIds[6], awayTeamId: otherIds[7] },
      { ...template, id: '04-derby', homeTeamId: otherIds[4], awayTeamId: otherIds[5] },
      { ...template, id: '03-stakes', homeTeamId: rankedIds[0], awayTeamId: rankedIds[1] },
      {
        ...template,
        id: '02-final',
        homeTeamId: otherIds[2],
        awayTeamId: otherIds[3],
        competitionType: 'league_cup',
        competitionName: '联赛杯',
        roundLabel: 'Final',
      },
      { ...template, id: '01-primary', homeTeamId: primaryTeamId, awayTeamId: otherIds[1] },
    ];

    world.teamBases[rankedIds[0]] = {
      ...world.teamBases[rankedIds[0]],
      overall: 75,
      tier: 'mid',
      region: '北洲+北城',
    };
    world.teamBases[rankedIds[1]] = {
      ...world.teamBases[rankedIds[1]],
      overall: 60,
      tier: 'mid',
      region: '南洲+南城',
    };
    world.teamBases[otherIds[4]] = {
      ...world.teamBases[otherIds[4]],
      overall: 70,
      tier: 'mid',
      region: '测试洲+同城',
    };
    world.teamBases[otherIds[5]] = {
      ...world.teamBases[otherIds[5]],
      overall: 69,
      tier: 'mid',
      region: '测试洲+同城',
    };
    world.teamBases[otherIds[6]] = {
      ...world.teamBases[otherIds[6]],
      overall: 95,
      tier: 'elite',
      region: '甲洲+甲城',
    };
    world.teamBases[otherIds[7]] = {
      ...world.teamBases[otherIds[7]],
      overall: 80,
      tier: 'strong',
      region: '乙洲+乙城',
    };

    const focus = pickFocusMatches(
      fixtures,
      world,
      [primaryTeamId, otherIds[6]],
      fixtures.length,
      primaryTeamId,
    );

    expect(focus.map(entry => entry.fixture.id)).toEqual([
      '01-primary',
      '02-final',
      '03-stakes',
      '04-derby',
      '05-marquee',
    ]);
    expect(focus.find(entry => entry.fixture.id === '04-derby')!.importance.score)
      .toBeGreaterThan(focus.find(entry => entry.fixture.id === '03-stakes')!.importance.score);
  });

  it('uses fixture id as a deterministic final tie-breaker', () => {
    const world = initializeGameWorld(20260718);
    const template = getCurrentWindow(world)!.fixtures[0];
    const fixtures: MatchFixture[] = [
      { ...template, id: 'fixture-b', roundLabel: 'Final', competitionType: 'league_cup' },
      { ...template, id: 'fixture-a', roundLabel: 'Final', competitionType: 'league_cup' },
    ];

    const forward = pickFocusMatches(fixtures, world, [], 2).map(entry => entry.fixture.id);
    const reversed = pickFocusMatches([...fixtures].reverse(), world, [], 2).map(entry => entry.fixture.id);

    expect(forward).toEqual(['fixture-a', 'fixture-b']);
    expect(reversed).toEqual(forward);
  });

  it('does not misclassify semi-finals or quarter-finals as finals', () => {
    const world = initializeGameWorld(20260718);
    const template = getCurrentWindow(world)!.fixtures[0];

    expect(computeFixtureImportance(
      { ...template, roundLabel: 'Semi-final' },
      world,
      [],
    ).reasons).toContain('半决赛');
    expect(computeFixtureImportance(
      { ...template, roundLabel: '半决赛' },
      world,
      [],
    ).reasons).toContain('半决赛');
    expect(computeFixtureImportance(
      { ...template, roundLabel: 'Quarter-final' },
      world,
      [],
    ).reasons).toContain('1/4决赛');
    expect(computeFixtureImportance(
      { ...template, roundLabel: 'Round of 16' },
      world,
      [],
    ).reasons).toContain('淘汰赛');
    expect(computeFixtureImportance(
      { ...template, roundLabel: 'SF' },
      world,
      [],
    ).reasons).toContain('半决赛');
    expect(computeFixtureImportance(
      { ...template, roundLabel: 'QF' },
      world,
      [],
    ).reasons).toContain('1/4决赛');
    expect(computeFixtureImportance(
      { ...template, roundLabel: 'R16' },
      world,
      [],
    ).reasons).toContain('淘汰赛');
    expect(computeFixtureImportance(
      { ...template, roundLabel: 'SF 首回合' },
      world,
      [],
    ).reasons).toContain('半决赛');
    expect(computeFixtureImportance(
      { ...template, roundLabel: 'QF 次回合' },
      world,
      [],
    ).reasons).toContain('1/4决赛');
  });
});
