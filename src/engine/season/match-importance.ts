import { GameWorld } from './season-manager';
import { MatchFixture } from '../../types/match';
import { isDerby } from '../../config/derbies';

export interface FixtureImportance {
  fixtureId: string;
  score: number;
  reasons: string[];
}

/**
 * Compute an "importance score" for a fixture so we can highlight 1-2 must-watch
 * matches per advance window.
 *
 * Components:
 * - Derby (any tier): +6
 * - Both teams in top 4 of L1: +5
 * - Cup final: +8
 * - Cup semi-final: +4
 * - Favorite team involved: +5
 * - Title race implication (one of top 3 vs another top-6): +3
 * - Relegation battle (both bottom 5 of L1): +2
 * - World Cup match: +3
 */
export function computeFixtureImportance(
  fixture: MatchFixture,
  world: GameWorld,
  favoriteTeamIds: string[],
): FixtureImportance {
  const reasons: string[] = [];
  let score = 0;

  if (isDerby(fixture.homeTeamId, fixture.awayTeamId, world.teamBases)) {
    score += 6;
    reasons.push('德比战');
  }

  if (favoriteTeamIds.includes(fixture.homeTeamId) || favoriteTeamIds.includes(fixture.awayTeamId)) {
    score += 5;
    reasons.push('关注球队出战');
  }

  // L1 top-4 ranking
  const l1 = world.league1Standings;
  const top4Ids = new Set(l1.slice(0, 4).map((s) => s.teamId));
  const top6Ids = new Set(l1.slice(0, 6).map((s) => s.teamId));
  const bottom5Ids = new Set(l1.slice(-5).map((s) => s.teamId));

  if (top4Ids.has(fixture.homeTeamId) && top4Ids.has(fixture.awayTeamId)) {
    score += 5;
    reasons.push('争冠焦点');
  } else if (top6Ids.has(fixture.homeTeamId) && top6Ids.has(fixture.awayTeamId)) {
    score += 3;
    reasons.push('上游对话');
  }

  if (bottom5Ids.has(fixture.homeTeamId) && bottom5Ids.has(fixture.awayTeamId)) {
    score += 2;
    reasons.push('保级大战');
  }

  // Cup importance
  const lower = fixture.roundLabel.toLowerCase();
  if (lower.includes('final') || fixture.roundLabel.includes('决赛')) {
    score += 8;
    reasons.push('杯赛决赛');
  } else if (lower.includes('semi') || fixture.roundLabel.includes('半决')) {
    score += 4;
    reasons.push('半决赛');
  } else if (lower.includes('quarter') || fixture.roundLabel.includes('1/4')) {
    score += 2;
    reasons.push('1/4决赛');
  }

  if (fixture.competitionType === 'world_cup' || fixture.competitionType === 'world_cup_group') {
    score += 3;
    reasons.push('环球杯');
  }

  return { fixtureId: fixture.id, score, reasons };
}

/**
 * Pick the top N fixtures from the current window by importance.
 */
export function pickFocusMatches(
  fixtures: MatchFixture[],
  world: GameWorld,
  favoriteTeamIds: string[],
  topN: number = 2,
): { fixture: MatchFixture; importance: FixtureImportance }[] {
  const scored = fixtures.map((f) => ({
    fixture: f,
    importance: computeFixtureImportance(f, world, favoriteTeamIds),
  }));
  scored.sort((a, b) => b.importance.score - a.importance.score);
  // Only return scored > 4 (otherwise nothing exceptional)
  return scored.filter((s) => s.importance.score >= 4).slice(0, topN);
}
