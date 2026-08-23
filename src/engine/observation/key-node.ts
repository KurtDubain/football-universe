import type { MatchFixture } from '../../types/match';
import type { CalendarWindow } from '../../types/season';
import { computeFixtureImportance } from '../season/match-importance';
import type { GameWorld } from '../season/season-manager';

export type KeyNodeReason =
  | 'pending_judgment'
  | 'starred_match'
  | 'story_climax'
  | 'favorite_match'
  | 'cup'
  | 'playoff'
  | 'season_end';

export interface KeyNodePlan {
  seasonNumber: number;
  windowIndex: number;
  windowLabel: string;
  skipWindows: number;
  reason: KeyNodeReason;
  reasonLabel: string;
  detail: string;
  blocked: boolean;
  fixtureId?: string;
  teamId?: string;
}

const INSPECTABLE_KEY_NODE_REASONS = new Set<KeyNodeReason>([
  'starred_match',
  'story_climax',
  'favorite_match',
  'cup',
  'playoff',
]);

/** Nodes with real pre-match context that should be viewed before simulation. */
export function isInspectableKeyNode(
  plan: KeyNodePlan | null | undefined,
): plan is KeyNodePlan {
  return Boolean(plan && INSPECTABLE_KEY_NODE_REASONS.has(plan.reason));
}

const CUP_KEY_TYPES = new Set<CalendarWindow['type']>([
  'league_cup',
  'super_cup',
  'continental_cup',
  'world_cup',
]);

const FAVORITE_IMPORTANCE_REASONS = new Set([
  '德比战',
  '争冠焦点',
  '保级大战',
  '杯赛决赛',
  '半决赛',
  '1/4决赛',
  '环球杯',
]);

function fixtureTeamId(fixture: MatchFixture, teamIds: ReadonlySet<string>): string | undefined {
  if (teamIds.has(fixture.homeTeamId)) return fixture.homeTeamId;
  if (teamIds.has(fixture.awayTeamId)) return fixture.awayTeamId;
  return undefined;
}

function favoriteKeyFixture(
  world: GameWorld,
  window: CalendarWindow,
  favoriteTeamIds: string[],
): { fixture: MatchFixture; teamId: string } | null {
  const favoriteSet = new Set(favoriteTeamIds);
  for (const fixture of window.fixtures) {
    const teamId = fixtureTeamId(fixture, favoriteSet);
    if (!teamId) continue;
    const importance = computeFixtureImportance(
      fixture,
      world,
      favoriteTeamIds,
      favoriteTeamIds[0] ?? null,
    );
    const knockout = fixture.competitionType !== 'league'
      && fixture.competitionType !== 'super_cup_group'
      && fixture.competitionType !== 'world_cup_group';
    if (knockout || importance.reasons.some(reason => FAVORITE_IMPORTANCE_REASONS.has(reason))) {
      return { fixture, teamId };
    }
  }
  return null;
}

function climaxFixture(
  world: GameWorld,
  window: CalendarWindow,
): { fixture: MatchFixture; teamId: string } | null {
  const climaxTeamIds = new Set(
    (world.activeStorylines ?? [])
      .filter(storyline => storyline.phase === '高潮')
      .map(storyline => storyline.teamId),
  );
  if (climaxTeamIds.size === 0) return null;
  for (const fixture of window.fixtures) {
    const teamId = fixtureTeamId(fixture, climaxTeamIds);
    if (teamId) return { fixture, teamId };
  }
  return null;
}

function planForWindow(
  world: GameWorld,
  window: CalendarWindow,
  windowIndex: number,
  skipWindows: number,
  favoriteTeamIds: string[],
  starredFixtureIds: string[],
  includeCurrentGuards: boolean,
): KeyNodePlan | null {
  const seasonNumber = world.seasonState.seasonNumber;
  if (
    includeCurrentGuards
    && world.pendingObservationJudgment?.seasonNumber === seasonNumber
    && world.pendingObservationJudgment.windowIndex === windowIndex
  ) {
    return {
      seasonNumber,
      windowIndex,
      windowLabel: window.label,
      skipWindows: 0,
      reason: 'pending_judgment',
      reasonLabel: '当前判断待结算',
      detail: '先推进本轮查看判断结果，再前往下一关键节点。',
      blocked: true,
      fixtureId: world.pendingObservationJudgment.fixtureId,
    };
  }

  const starred = window.fixtures.find(fixture => starredFixtureIds.includes(fixture.id));
  if (starred) {
    return {
      seasonNumber,
      windowIndex,
      windowLabel: window.label,
      skipWindows,
      reason: 'starred_match',
      reasonLabel: includeCurrentGuards ? '当前有已关注比赛' : '已关注比赛',
      detail: includeCurrentGuards
        ? '先推进本轮观看已关注比赛，再继续跳转。'
        : `已关注的${starred.competitionName}${starred.roundLabel}将在本轮进行。`,
      blocked: includeCurrentGuards,
      fixtureId: starred.id,
    };
  }

  const climax = climaxFixture(world, window);
  if (climax) {
    const teamName = world.teamBases[climax.teamId]?.shortName ?? climax.teamId;
    return {
      seasonNumber,
      windowIndex,
      windowLabel: window.label,
      skipWindows,
      reason: 'story_climax',
      reasonLabel: `${teamName}故事高潮`,
      detail: `${teamName}的故事进入高潮，本轮值得单独观察。`,
      blocked: skipWindows === 0,
      fixtureId: climax.fixture.id,
      teamId: climax.teamId,
    };
  }

  const favorite = favoriteKeyFixture(world, window, favoriteTeamIds);
  if (favorite) {
    const teamName = world.teamBases[favorite.teamId]?.shortName ?? favorite.teamId;
    return {
      seasonNumber,
      windowIndex,
      windowLabel: window.label,
      skipWindows,
      reason: 'favorite_match',
      reasonLabel: `${teamName}关键比赛`,
      detail: `${teamName}将在${favorite.fixture.competitionName}${favorite.fixture.roundLabel}出战。`,
      blocked: skipWindows === 0,
      fixtureId: favorite.fixture.id,
      teamId: favorite.teamId,
    };
  }

  if (window.type === 'relegation_playoff') {
    return {
      seasonNumber,
      windowIndex,
      windowLabel: window.label,
      skipWindows,
      reason: 'playoff',
      reasonLabel: '升降级附加赛',
      detail: '升降级命运将在这一阶段决定。',
      blocked: skipWindows === 0,
    };
  }

  if (CUP_KEY_TYPES.has(window.type)) {
    return {
      seasonNumber,
      windowIndex,
      windowLabel: window.label,
      skipWindows,
      reason: 'cup',
      reasonLabel: '杯赛节点',
      detail: skipWindows === 0
        ? `当前是${window.label}，先单独观察这一阶段。`
        : `下一项杯赛阶段是${window.label}。`,
      blocked: skipWindows === 0,
    };
  }

  if (window.type === 'season_end') {
    return {
      seasonNumber,
      windowIndex,
      windowLabel: window.label,
      skipWindows,
      reason: 'season_end',
      reasonLabel: '赛季收官',
      detail: '将在赛季结算前停下。',
      blocked: skipWindows === 0,
    };
  }

  return null;
}

export function getCurrentKeyNodeGuard(
  world: GameWorld,
  favoriteTeamIds: string[],
  starredFixtureIds: string[] = [],
): KeyNodePlan | null {
  const index = world.seasonState.currentWindowIndex;
  const window = world.seasonState.calendar[index];
  if (!window) return null;
  return planForWindow(
    world,
    window,
    index,
    0,
    favoriteTeamIds,
    starredFixtureIds,
    true,
  );
}

export function planNextKeyNode(
  world: GameWorld,
  favoriteTeamIds: string[],
  starredFixtureIds: string[] = [],
): KeyNodePlan | null {
  const currentIndex = world.seasonState.currentWindowIndex;
  const currentGuard = getCurrentKeyNodeGuard(world, favoriteTeamIds, starredFixtureIds);
  if (currentGuard) return currentGuard;

  for (let index = currentIndex + 1; index < world.seasonState.calendar.length; index++) {
    const window = world.seasonState.calendar[index];
    const plan = planForWindow(
      world,
      window,
      index,
      index - currentIndex,
      favoriteTeamIds,
      starredFixtureIds,
      false,
    );
    if (plan) return plan;
  }
  return null;
}
