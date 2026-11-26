// What the world is actually celebrating.
//
// Every ceremony request is derived from world state, so this module is the
// only place that decides whether a moment deserves a page. It reads; it
// never writes, never rolls a die, and never invents a fact the simulation
// did not produce. If the simulation has no champion, there is no ceremony.

import type { CupFixture, CupRound, CupState, ContinentalCupState, SuperCupState, WorldCupState } from '../../types/cup';
import type { MatchResult } from '../../types/match';
import type { PlayerAward, PlayerAwardType } from '../../types/award';
import type { CalendarWindow } from '../../types/season';
import { AWARD_META, computeSeasonAwards } from '../../engine/awards/season-awards';
import { deriveCoachHonours } from '../../engine/awards/coach-honours';
import { buildSeasonOpening } from '../../engine/season/season-opening';
import type { GameWorld } from '../../engine/season/season-manager';
import { getCurrentWindow } from '../../engine/season/world-selectors';
import type { CeremonyHonour, CeremonyKind, CeremonyRequest, CeremonyTeam } from './ceremony-types';

/**
 * Which ceremony wins when several are true at once.
 *
 * A World Cup year opens with both a season draw and a tournament draw on the
 * table. Only one page turns: the rarer moment, not the louder one.
 */
export const CEREMONY_PRIORITY: readonly CeremonyKind[] = [
  'world_cup_closing',
  'world_cup_opening',
  'season_closing',
  'season_opening',
  'cup_stamp',
];

/** The individual honours a World Cup closing page is allowed to print. */
const CLOSING_HONOUR_TYPES: readonly string[] = ['mvp', 'golden_boot', 'best_goalkeeper', 'young_player'];

/**
 * The order a season closing prints its individual awards in.
 *
 * Ballon d'Or first, then the golden boot, then the pitch from front to back,
 * then the newcomer. It is the order a reader already expects, so the list
 * needs no explanation.
 */
const SEASON_HONOUR_ORDER: readonly PlayerAwardType[] = [
  'mvp',
  'golden_boot',
  'best_forward',
  'best_midfielder',
  'best_defender',
  'best_goalkeeper',
  'young_player',
];

/**
 * How many staggered elements a page sets, which is what sets its length.
 *
 * Lives here, on the initial side of the lazy boundary, so the director can
 * work out when a stamp passes without pulling the overlay in first. The
 * entrant list counts as one element: thirty-two clubs arrive as a single
 * block of type, the way a printed entry list does.
 */
export function countCeremonyLines(request: CeremonyRequest): number {
  switch (request.kind) {
    case 'season_opening':
      return Math.max(1, request.draws.length + request.lines.length);
    case 'season_closing':
      // Three pages turn under one key; the longest sets the rhythm.
      return Math.max(
        2 + request.podium.length,
        request.playerHonours.length,
        request.coachHonours.length,
      );
    case 'cup_stamp':
      return 2 + (request.finalMvp ? 1 : 0) + (request.topScorer ? 1 : 0);
    case 'world_cup_opening':
      return 2;
    case 'world_cup_closing':
      return 1 + request.honours.length;
  }
}

export interface CeremonyDeriveOptions {
  favoriteTeamIds?: readonly string[];
  /** How many cup stamps a single advance may queue. */
  maxStamps?: number;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function ceremonyTeam(world: GameWorld, teamId: string | null | undefined): CeremonyTeam | null {
  if (!teamId) return null;
  const base = world.teamBases[teamId];
  if (!base) return null;
  return { teamId: base.id, name: base.name, shortName: base.shortName, color: base.color };
}

type KnockoutCup = CupState | SuperCupState | WorldCupState | ContinentalCupState;

interface DecidedCup {
  name: string;
  completed: boolean;
  winnerId?: string;
  rounds: CupRound[];
  /** Group-stage fixtures, for the cups that have a group stage at all. */
  groupFixtureIds: string[];
}

function roundsOf(cup: KnockoutCup): CupRound[] {
  return 'knockoutRounds' in cup ? cup.knockoutRounds : cup.rounds;
}

function decidedCup(name: string, cup: KnockoutCup | null): DecidedCup | null {
  if (!cup) return null;
  const groups = 'groups' in cup ? cup.groups : [];
  return {
    name,
    completed: cup.completed,
    winnerId: cup.winnerId,
    rounds: roundsOf(cup),
    groupFixtureIds: groups.flatMap(group => group.fixtures.map(fixture => fixture.id)),
  };
}

function finalRound(cup: DecidedCup): CupRound | null {
  return cup.rounds[cup.rounds.length - 1] ?? null;
}

/** A cup final score, with the extra time or shoot-out that decided it. */
export function formatCupScore(fixture: CupFixture | null): string {
  const result = fixture?.result;
  if (!result) return '—';
  const base = result.home + '-' + result.away;
  if (result.penalties) {
    return base + ' · 点球 ' + (result.penHome ?? 0) + '-' + (result.penAway ?? 0);
  }
  return result.extraTime ? base + ' · 加时' : base;
}

/** The last window the season actually finished, which is where a cup is decided. */
function lastCompletedWindow(world: GameWorld): CalendarWindow | null {
  const { calendar } = world.seasonState;
  for (let index = calendar.length - 1; index >= 0; index--) {
    if (calendar[index].completed) return calendar[index];
  }
  return null;
}

function cupsForWindow(world: GameWorld, window: CalendarWindow): DecidedCup[] {
  const { continentalCups } = world;
  switch (window.type) {
    case 'league_cup':
      return [decidedCup(world.leagueCup.name, world.leagueCup)].filter(isPresent);
    case 'super_cup':
    case 'super_cup_group':
      return [decidedCup('超级杯', world.superCup)].filter(isPresent);
    case 'continental_cup':
      return [
        decidedCup(continentalCups.mainland_cup?.name ?? '大陆杯', continentalCups.mainland_cup),
        decidedCup(continentalCups.southern_cup?.name ?? '南洲杯', continentalCups.southern_cup),
        decidedCup(continentalCups.eastern_cup?.name ?? '东洲杯', continentalCups.eastern_cup),
      ].filter(isPresent);
    case 'world_cup':
      return [decidedCup('环球冠军杯', world.worldCup)].filter(isPresent);
    default:
      return [];
  }
}

function favoriteRank(request: CeremonyRequest, favorites: ReadonlySet<string>): number {
  if (request.kind !== 'cup_stamp') return 0;
  if (favorites.has(request.champion.teamId)) return 2;
  if (request.runnerUp && favorites.has(request.runnerUp.teamId)) return 1;
  return 0;
}

/**
 * Every match result of the current season, keyed by fixture.
 *
 * A cup fixture only stores its scoreline, so the players who made it have to
 * be read back out of the calendar. Results are not trimmed inside a season,
 * so every round of a cup is still here when its final is decided.
 */
function seasonResults(world: GameWorld): Map<string, MatchResult> {
  const index = new Map<string, MatchResult>();
  for (const window of world.seasonState.calendar) {
    for (const result of window.results) index.set(result.fixtureId, result);
  }
  return index;
}

function cupFixtureIds(cup: DecidedCup): string[] {
  const ids = [...cup.groupFixtureIds];
  for (const round of cup.rounds) {
    for (const fixture of round.fixtures) ids.push(fixture.id);
  }
  return ids;
}

/**
 * The competition's leading scorer, counted from the goals the cup actually
 * produced. Shoot-out kicks and own goals are excluded: neither is a goal the
 * player scored for their own club.
 */
function cupTopScorer(
  world: GameWorld,
  cup: DecidedCup,
  results: Map<string, MatchResult>,
): CeremonyHonour | null {
  const tally = new Map<string, { goals: number; name: string; teamId: string }>();
  for (const id of cupFixtureIds(cup)) {
    const result = results.get(id);
    if (!result) continue;
    for (const event of result.events) {
      if (event.type !== 'goal' || !event.playerId) continue;
      const entry = tally.get(event.playerId)
        ?? { goals: 0, name: event.playerName ?? '', teamId: event.teamId };
      entry.goals += 1;
      if (!entry.name && event.playerName) entry.name = event.playerName;
      tally.set(event.playerId, entry);
    }
  }

  let best: { goals: number; name: string; teamId: string } | null = null;
  for (const entry of tally.values()) {
    if (!best || entry.goals > best.goals) best = entry;
  }
  if (!best || best.goals === 0) return null;

  return {
    label: '赛事金靴',
    name: best.name || '—',
    detail: best.goals + ' 球',
    team: ceremonyTeam(world, best.teamId),
  };
}

/**
 * The player who decided the final.
 *
 * Goals, assists and saves are the only things the match records about an
 * individual, so those are the only things weighed. The honour belongs to the
 * winning side: a final is remembered for who lifted it.
 */
function finalManOfTheMatch(
  world: GameWorld,
  fixture: CupFixture | null,
  winnerId: string,
  results: Map<string, MatchResult>,
): CeremonyHonour | null {
  if (!fixture) return null;
  const result = results.get(fixture.id);
  if (!result) return null;

  interface Tally { weight: number; goals: number; assists: number; saves: number; name: string; teamId: string }
  const score = new Map<string, Tally>();
  for (const event of result.events) {
    if (!event.playerId) continue;
    let entry = score.get(event.playerId);
    if (!entry) {
      entry = { weight: 0, goals: 0, assists: 0, saves: 0, name: event.playerName ?? '', teamId: event.teamId };
      score.set(event.playerId, entry);
    }
    if (!entry.name && event.playerName) entry.name = event.playerName;
    if (event.type === 'goal') { entry.goals += 1; entry.weight += 3; }
    else if (event.type === 'assist') { entry.assists += 1; entry.weight += 2; }
    else if (event.type === 'save' || event.type === 'gk_save') { entry.saves += 1; entry.weight += 0.5; }
  }

  let best: Tally | null = null;
  for (const entry of score.values()) {
    if (entry.teamId !== winnerId) continue;
    if (!best || entry.weight > best.weight) best = entry;
  }
  if (!best || best.weight <= 0) return null;

  const parts: string[] = [];
  if (best.goals > 0) parts.push(best.goals + ' 球');
  if (best.assists > 0) parts.push(best.assists + ' 助');
  if (best.saves > 0) parts.push(best.saves + ' 次扑救');
  return {
    label: '决赛最佳球员',
    name: best.name || '—',
    detail: parts.join(' · ') || '决赛主导者',
    team: ceremonyTeam(world, best.teamId),
  };
}

function cupStamps(world: GameWorld, options: CeremonyDeriveOptions): CeremonyRequest[] {
  const window = lastCompletedWindow(world);
  if (!window) return [];
  const favorites = new Set(options.favoriteTeamIds ?? []);
  const results = seasonResults(world);
  const stamps: CeremonyRequest[] = [];

  for (const cup of cupsForWindow(world, window)) {
    if (!cup.completed || !cup.winnerId) continue;
    const champion = ceremonyTeam(world, cup.winnerId);
    if (!champion) continue;
    const round = finalRound(cup);
    const fixture = round?.fixtures[0] ?? null;
    const loserId = fixture
      ? fixture.homeTeamId === cup.winnerId ? fixture.awayTeamId : fixture.homeTeamId
      : null;
    stamps.push({
      kind: 'cup_stamp',
      competitionName: cup.name,
      roundLabel: round?.roundName ?? '决赛',
      champion,
      runnerUp: ceremonyTeam(world, loserId),
      score: formatCupScore(fixture),
      finalMvp: finalManOfTheMatch(world, fixture, cup.winnerId, results),
      topScorer: cupTopScorer(world, cup, results),
    });
  }

  return stamps
    .sort((a, b) => favoriteRank(b, favorites) - favoriteRank(a, favorites))
    .slice(0, options.maxStamps ?? 2);
}

function seasonOpening(world: GameWorld, favoriteTeamIds: readonly string[]): CeremonyRequest | null {
  const current = getCurrentWindow(world);
  if (!current || current.type !== 'pre_season') return null;
  const opening = buildSeasonOpening(world, { favoriteTeamIds });
  return {
    kind: 'season_opening',
    seasonNumber: opening.seasonNumber,
    lines: opening.storylines.slice(0, 3).map(item => item.title),
    draws: opening.draws.map(draw => draw.title),
  };
}

function seasonClosing(world: GameWorld): CeremonyRequest | null {
  const current = getCurrentWindow(world);
  if (!current || current.type !== 'season_end') return null;
  const standings = world.league1Standings;
  const leader = standings[0];
  const second = standings[1];
  const championId = world.seasonState.awards?.league1Champion ?? leader?.teamId ?? null;
  const champion = ceremonyTeam(world, championId);
  const podium = standings
    .slice(0, 3)
    .map(entry => {
      const team = ceremonyTeam(world, entry.teamId);
      return team ? { team, points: entry.points } : null;
    })
    .filter(isPresent);

  let summary = '本赛季顶级联赛未能决出冠军。';
  if (champion && leader) {
    summary = champion.name + '以 ' + leader.points + ' 分夺得顶级联赛冠军';
    summary += second ? '，领先第二名 ' + (leader.points - second.points) + ' 分。' : '。';
  }

  return {
    kind: 'season_closing',
    seasonNumber: world.seasonState.seasonNumber,
    champion,
    podium,
    summary,
    playerHonours: seasonPlayerHonours(world),
    coachHonours: seasonCoachHonours(world),
  };
}

function worldCupOpening(world: GameWorld): CeremonyRequest | null {
  const cup = world.worldCup;
  if (!cup || cup.completed || cup.groupStageCompleted) return null;
  const kickedOff = cup.groups.some(group => group.fixtures.some(fixture => fixture.result));
  if (kickedOff) return null;

  const edition = world.seasonState.seasonNumber;
  const hostId = cup.hostTeamId
    ?? world.worldCupEditions?.find(entry => entry.seasonNumber === edition)?.hostTeamId
    ?? null;

  return {
    kind: 'world_cup_opening',
    edition,
    host: ceremonyTeam(world, hostId),
    entrants: cup.participantIds.map(id => ceremonyTeam(world, id)).filter(isPresent),
  };
}

/**
 * The season's individual awards, computed exactly the way the awards panel
 * computes them.
 *
 * Both ceremonies and the season review read this, so a page can never
 * contradict the table it is celebrating.
 */
function computeAwards(world: GameWorld): PlayerAward[] {
  return computeSeasonAwards(
    world.seasonState.seasonNumber,
    world.playerStats,
    world.squads,
    world.teamBases,
    world.league1Standings,
    world.playerStatSegments ?? {},
    world.seasonStartLevels ?? {},
    {
      continentalCupWinners: [
        world.continentalCups.mainland_cup?.winnerId,
        world.continentalCups.southern_cup?.winnerId,
        world.continentalCups.eastern_cup?.winnerId,
      ].filter((id): id is string => Boolean(id)),
      domesticCupWinners: [world.leagueCup.winnerId, world.superCup.winnerId]
        .filter((id): id is string => Boolean(id)),
    },
    world.worldCup,
  );
}

function closingHonours(world: GameWorld): Array<{ label: string; name: string }> {
  const wanted = new Set(CLOSING_HONOUR_TYPES);
  return computeAwards(world)
    .filter(award => wanted.has(award.type))
    .slice(0, 4)
    .map(award => ({ label: AWARD_META[award.type].label, name: award.playerName }));
}

/** Every individual award the season produced, in printing order. */
function seasonPlayerHonours(world: GameWorld): CeremonyHonour[] {
  const byType = new Map(computeAwards(world).map(award => [award.type, award]));
  const honours: CeremonyHonour[] = [];
  for (const type of SEASON_HONOUR_ORDER) {
    const award = byType.get(type);
    if (!award) continue;
    honours.push({
      label: AWARD_META[type].label,
      name: award.playerName,
      detail: award.teamName + ' · ' + award.statLabel,
      team: ceremonyTeam(world, award.teamId),
    });
  }
  return honours;
}

/** 冠军教头 and 最佳教练, read from the final table rather than invented. */
function seasonCoachHonours(world: GameWorld): CeremonyHonour[] {
  const clubName = (teamId: string) => world.teamBases[teamId]?.name ?? teamId;
  return deriveCoachHonours(world, world.seasonState.seasonNumber).map(honour => ({
    label: honour.kind === 'champion_coach' ? '冠军教头' : '最佳教练',
    name: honour.coachName,
    detail: honour.kind === 'champion_coach'
      ? clubName(honour.teamId) + ' · 顶级联赛冠军'
      : clubName(honour.teamId) + ' 第 ' + honour.leaguePosition + ' 名 · 超预期 '
        + honour.overperformance + ' 位',
    team: ceremonyTeam(world, honour.teamId),
  }));
}

function worldCupClosing(world: GameWorld): CeremonyRequest | null {
  const cup = world.worldCup;
  if (!cup || !cup.completed || !cup.winnerId) return null;
  // The closing page belongs to the final, not to the rest of the season: once
  // another window has been played, the tournament is history rather than news.
  if (lastCompletedWindow(world)?.type !== 'world_cup') return null;
  const champion = ceremonyTeam(world, cup.winnerId);
  if (!champion) return null;
  const round = cup.knockoutRounds[cup.knockoutRounds.length - 1] ?? null;

  return {
    kind: 'world_cup_closing',
    edition: world.seasonState.seasonNumber,
    champion,
    finalScore: formatCupScore(round?.fixtures[0] ?? null),
    honours: closingHonours(world),
  };
}

/**
 * Every ceremony this world state has earned, rarest first.
 *
 * The caller plays one holding ceremony and lets the stamps follow it.
 */
export function deriveCeremonies(
  world: GameWorld,
  options: CeremonyDeriveOptions = {},
): CeremonyRequest[] {
  const requests: CeremonyRequest[] = [];
  const opening = seasonOpening(world, options.favoriteTeamIds ?? []);
  if (opening) requests.push(opening);
  const closing = seasonClosing(world);
  if (closing) requests.push(closing);
  const cupOpening = worldCupOpening(world);
  if (cupOpening) requests.push(cupOpening);
  const cupClosing = worldCupClosing(world);
  if (cupClosing) requests.push(cupClosing);
  requests.push(...cupStamps(world, options));

  return requests.sort(
    (a, b) => CEREMONY_PRIORITY.indexOf(a.kind) - CEREMONY_PRIORITY.indexOf(b.kind),
  );
}

/**
 * A cheap fingerprint of one save, used to scope the seen set.
 *
 * Team identities do not change inside a season and honours only arrive at a
 * season boundary, so the scope is stable exactly where it needs to be: a
 * reload mid-season keeps its place, and a new game starts clean.
 */
export function ceremonyScope(world: GameWorld): string {
  let hash = 2166136261;
  for (const id of Object.keys(world.teamBases).sort()) {
    for (let index = 0; index < id.length; index++) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36) + ':' + world.honorHistory.length;
}
