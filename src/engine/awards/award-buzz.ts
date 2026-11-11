import type { GameWorld } from '../season/season-manager';
import type { PlayerAwardType } from '../../types/award';
import type { Player, PlayerPosition, PlayerSeasonStats } from '../../types/player';
import type { TeamBase } from '../../types/team';
import type { MatchResult } from '../../types/match';
import type { PlayerPerformanceResult } from '../players/player-performance';
import { leagueConfigs } from '../../config/competitions';
import { sortStandings } from '../standings/standings';
import { buildRecentPlayerForm, type RecentPlayerForm } from '../players/star-presence';
import { principalCareerHonor } from '../players/player-honors';
import { createCandidateContext } from './candidate-context';
import { AWARD_META } from './season-awards';
import { goldenBootBreakdown, goldenBootScore, tierNeutralScore } from './award-scoring';
import {
  BALLON_DOR_MIN_APPEARANCES,
  BUZZ_AWARDS,
  BUZZ_BAND_WIDTH,
  BUZZ_GOLDEN_BOOT_CEILING,
  BUZZ_MAX_CANDIDATES,
  BUZZ_MAX_TIERS,
  BUZZ_MOMENTUM_MATCHES,
  BUZZ_RUNAWAY_GAP,
  BUZZ_START_ROUND,
  BUZZ_WEIGHTS,
  type LeagueTier,
} from './award-weights';

/**
 * "Who is in the running" projection for the season's individual awards.
 *
 * This is deliberately **not** the award computation, and it must never be
 * presented as one:
 *
 * - The buzz blends current season score with recent form and team momentum.
 *   The award uses full-season aggregates plus the *final* league table.
 * - Candidates are grouped into bands by threshold, not ranked. Inside a band
 *   they are ordered by team name, so no ordering signal leaks.
 * - No number from this module is ever rendered. If it were, the player could
 *   read off the winner.
 *
 * The unpredictability is therefore honest rather than manufactured: the band
 * width reflects genuine closeness, the form term is real, and the single
 * largest input to the Ballon d'Or — final league position — is still unknown
 * at the halfway point.
 *
 * Nothing here touches the RNG. Awards stay fully deterministic.
 */

export type BuzzTier = 'frontrunner' | 'contender' | 'outsider';

export interface BuzzCandidate {
  playerId: string;
  playerName: string;
  playerNumber?: number;
  position: PlayerPosition;
  teamId: string;
  teamName: string;
  teamShortName: string;
  teamColor: string;
  /** 1-indexed position in the team's current table; 0 when unknown. */
  teamPosition: number;
  leagueLevel: LeagueTier;
  tier: BuzzTier;
  /** Award-specific current-season line. */
  line: string;
  /** Career honours such as "2届金球". Null when the player has none. */
  honours: string | null;
  /**
   * Previous season score, for the season-over-season context line.
   *
   * Public data — the same number the player page and the 综合榜 already show —
   * so exposing it reveals nothing about the buzz ranking. The protection
   * against a readable winner is that the buzz formula is not the award formula
   * (form and momentum are weighted in here, and the award's largest input,
   * final league position, is still unknown), not that any single number is
   * hidden.
   */
  previousSeasonScore: number | null;
  /** Recent form, e.g. "近5场 2次决定性". Null when the player has no recent runs. */
  form: string | null;
}

export interface AwardBuzzCard {
  award: PlayerAwardType;
  label: string;
  emoji: string;
  color: string;
  /** 'runaway' when one candidate is clear of the field. */
  mood: 'open' | 'runaway';
  candidates: BuzzCandidate[];
}

export interface AwardBuzz {
  /** Top-flight rounds played when this snapshot was taken. */
  asOfRound: number;
  roundsRemaining: number;
  cards: AwardBuzzCard[];
}

const POSITION_LABELS: Record<PlayerPosition, string> = {
  GK: '门将', DF: '后卫', MF: '中场', FW: '前锋',
};

const POSITION_FOR_AWARD: Partial<Record<PlayerAwardType, PlayerPosition>> = {
  best_forward: 'FW',
  best_midfielder: 'MF',
  best_defender: 'DF',
  best_goalkeeper: 'GK',
};

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Points a team took from one result, treating extra time as part of the score. */
function pointsFrom(result: MatchResult, teamId: string): number {
  const home = result.homeGoals + (result.etHomeGoals ?? 0);
  const away = result.awayGoals + (result.etAwayGoals ?? 0);
  if (home === away) return 1;
  const won = teamId === result.homeTeamId ? home > away : away > home;
  return won ? 3 : 0;
}

/**
 * Momentum as points taken from a team's most recent matches, normalised to
 * 0-100. Deliberately competition-agnostic: a cup run is momentum too.
 */
function buildTeamMomentum(results: MatchResult[]): Map<string, number> {
  const recent = new Map<string, number[]>();
  for (const result of results) {
    for (const teamId of [result.homeTeamId, result.awayTeamId]) {
      const list = recent.get(teamId) ?? [];
      list.push(pointsFrom(result, teamId));
      if (list.length > BUZZ_MOMENTUM_MATCHES) list.shift();
      recent.set(teamId, list);
    }
  }
  const out = new Map<string, number>();
  for (const [teamId, list] of recent) {
    const total = list.reduce((sum, points) => sum + points, 0);
    out.set(teamId, (total / (3 * list.length)) * 100);
  }
  return out;
}

/** Current position in whichever table the team plays in. */
function buildPositionIndex(world: GameWorld): Map<string, number> {
  const index = new Map<string, number>();
  for (const standings of [world.league1Standings, world.league2Standings, world.league3Standings]) {
    if (!standings) continue;
    sortStandings(standings).forEach((row, position) => {
      if (!index.has(row.teamId)) index.set(row.teamId, position + 1);
    });
  }
  return index;
}

function previousSeasonScore(world: GameWorld, playerId: string): number | null {
  const season = world.seasonState.seasonNumber - 1;
  if (season < 1) return null;
  const entry = world.playerStatsHistory?.[playerId]?.find(row => row.season === season);
  return entry?.seasonScore ?? null;
}

function describeForm(form: RecentPlayerForm | undefined): string | null {
  if (!form || form.appearances === 0) return null;
  const decisive = form.decisiveMatches > 0 ? ` ${form.decisiveMatches}次决定性` : '';
  return `近${form.appearances}场${decisive}`;
}

/**
 * Award-specific current-season line. Kept to one short string: the card shows
 * a shortlist, not a stat table.
 */
function describeLine(
  award: PlayerAwardType,
  player: Player,
  stat: PlayerSeasonStats,
  performance: { seasonScore: number; positionQuality: number; metrics: { savePercentage: number } },
  level: LeagueTier,
): string {
  const goals = `${stat.goals}球`;
  const assists = `${stat.assists}助`;
  switch (award) {
    case 'golden_boot': {
      // Mirrors the award label. The weighted value is public award arithmetic,
      // not buzz state — the player can already rank scorers from the player
      // centre — so showing it leaks nothing the buzz ranking depends on.
      const breakdown = goldenBootBreakdown(stat.goals, level);
      return breakdown.isTopFlightBasis
        ? `${goals} · ${assists}`
        : `${breakdown.goals}球/${breakdown.rounds}轮 · 折算${breakdown.score.toFixed(1)}`;
    }
    case 'best_goalkeeper':
      return `位置表现 ${performance.positionQuality.toFixed(1)} · 扑救率 ${(performance.metrics.savePercentage * 100).toFixed(1)}%`;
    case 'best_defender':
      return `位置表现 ${performance.positionQuality.toFixed(1)} · ${stat.interceptions ?? 0}拦截 · 在场失${stat.goalsConcededWhileOnPitch ?? 0}球`;
    case 'best_midfielder':
      return `位置表现 ${performance.positionQuality.toFixed(1)} · ${assists} · ${stat.keyPasses ?? 0}关键传球`;
    case 'best_forward':
      return `位置表现 ${performance.positionQuality.toFixed(1)} · ${goals}${assists}`;
    case 'young_player':
      return `${player.age}岁 · 赛季评分 ${performance.seasonScore.toFixed(1)}`;
    default:
      return `赛季评分 ${performance.seasonScore.toFixed(1)} · ${goals}${assists}`;
  }
}

interface ScoredCandidate {
  player: Player;
  stat: PlayerSeasonStats;
  buzzScore: number;
  candidate: BuzzCandidate;
}

/**
 * Build the award buzz, or null before the panel's start round.
 *
 * @param recentForms Optional precomputed form map. The player centre already
 *   builds one for the star-observation panel; passing it avoids scoring every
 *   completed match twice.
 */
export function buildAwardBuzz(
  world: GameWorld,
  options: { recentForms?: Map<string, RecentPlayerForm> } = {},
): AwardBuzz | null {
  const league1 = world.league1Standings ?? [];
  const asOfRound = league1.reduce((max, row) => Math.max(max, row.played), 0);
  if (asOfRound < BUZZ_START_ROUND) return null;

  const topFlightRounds = leagueConfigs.find(config => config.level === 1)?.rounds ?? 30;
  const roundsRemaining = Math.max(0, topFlightRounds - asOfRound);

  const seasonStartLevels = (world.seasonStartLevels ?? {}) as Record<string, LeagueTier>;
  const { findPlayer, performanceFor, levelOf } = createCandidateContext(
    world.squads ?? {},
    world.playerStatSegments ?? {},
    seasonStartLevels,
  );

  const completedResults = (world.seasonState.calendar ?? [])
    .filter(window => window.completed)
    .flatMap(window => window.results ?? []);

  const momentum = buildTeamMomentum(completedResults);
  const positions = buildPositionIndex(world);
  const topLeagueTeamIds = new Set(league1.map(row => row.teamId));

  const recentForms = options.recentForms ?? buildRecentPlayerForm(
    completedResults,
    new Map(Object.values(world.squads ?? {}).flat().map(player => [player.uuid, player])),
  );

  /**
   * One pass over the league.
   *
   * Scoring a player is the expensive part — segmented performance walks every
   * club segment — and all seven awards need the same result. Computing it once
   * here instead of inside the award loop turns ~5,600 scorings into ~800.
   */
  interface BuzzEntry {
    player: Player;
    stat: PlayerSeasonStats;
    team: TeamBase;
    performance: PlayerPerformanceResult;
    level: LeagueTier;
    form: RecentPlayerForm | undefined;
    formComponent: number;
    momentumComponent: number;
  }

  const entries: BuzzEntry[] = [];
  for (const stat of Object.values(world.playerStats ?? {})) {
    const player = findPlayer(stat.playerId);
    if (!player) continue;
    const team = world.teamBases[stat.teamId];
    if (!team) continue;
    const performance = performanceFor(player, stat);
    if (!performance.eligible) continue;

    const form = recentForms.get(player.uuid);
    entries.push({
      player,
      stat,
      team,
      performance,
      level: levelOf(stat.teamId),
      form,
      formComponent: form && form.appearances > 0
        ? clamp(45 + form.averageImpact * 8, 0, 100)
        : 45,
      momentumComponent: momentum.get(stat.teamId) ?? 50,
    });
  }

  const cards: AwardBuzzCard[] = [];

  for (const award of BUZZ_AWARDS) {
    const requiredPosition = POSITION_FOR_AWARD[award];
    const scored: ScoredCandidate[] = [];

    for (const entry of entries) {
      const { player, stat, team, performance, level } = entry;

      // Mirror the real award's eligibility so the shortlist cannot name
      // someone the award itself would never consider.
      if (award === 'mvp' && stat.appearances < BALLON_DOR_MIN_APPEARANCES) continue;
      if (award === 'golden_boot' && stat.goals <= 0) continue;
      if (award === 'young_player' && player.age >= 23) continue;
      if (requiredPosition) {
        if (player.position !== requiredPosition) continue;
        // Position awards have always been top-flight only.
        if (!topLeagueTeamIds.has(stat.teamId)) continue;
      }

      // Each award's own ranking metric, bounded to 0-100 so it can blend with
      // form and momentum on one scale.
      let base: number;
      if (award === 'golden_boot') {
        base = clamp(goldenBootScore(stat.goals, level) / BUZZ_GOLDEN_BOOT_CEILING * 100, 0, 100);
      } else if (requiredPosition) {
        base = performance.positionQuality;
      } else {
        base = tierNeutralScore(performance);
      }

      const buzzScore = base * BUZZ_WEIGHTS.season
        + entry.formComponent * BUZZ_WEIGHTS.recentForm
        + entry.momentumComponent * BUZZ_WEIGHTS.teamMomentum;

      scored.push({
        player,
        stat,
        buzzScore,
        candidate: {
          playerId: player.uuid,
          playerName: player.name ?? `${player.number}号`,
          playerNumber: player.number,
          position: player.position,
          teamId: stat.teamId,
          teamName: team.name,
          teamShortName: team.shortName,
          teamColor: team.color,
          teamPosition: positions.get(stat.teamId) ?? 0,
          leagueLevel: level,
          // Assigned below, once the band boundaries are known.
          tier: 'outsider',
          line: describeLine(award, player, stat, performance, level),
          honours: principalCareerHonor(world, player.uuid),
          previousSeasonScore: previousSeasonScore(world, player.uuid),
          form: describeForm(entry.form),
        },
      });
    }

    if (scored.length === 0) continue;

    scored.sort((a, b) => b.buzzScore - a.buzzScore || a.player.uuid.localeCompare(b.player.uuid));
    const shortlist = scored.slice(0, BUZZ_MAX_CANDIDATES);

    // A new band starts only when the gap to the previous candidate exceeds the
    // band width. Inside a band the players are genuinely close, so presenting
    // them as one unordered group is honest — and it removes the "first place
    // wins" read that a numbered list would invite.
    let band = 0;
    shortlist[0].candidate.tier = 'frontrunner';
    for (let index = 1; index < shortlist.length; index += 1) {
      const gap = shortlist[index - 1].buzzScore - shortlist[index].buzzScore;
      if (gap > BUZZ_BAND_WIDTH && band < BUZZ_MAX_TIERS - 1) band += 1;
      shortlist[index].candidate.tier =
        band === 0 ? 'frontrunner' : band === 1 ? 'contender' : 'outsider';
    }

    // A runaway means ONE player is clear of the field. It is explicitly not
    // "the leader is far ahead of the second band" — a leading band holding two
    // genuinely close players is a contested race, and calling it a runaway
    // would be exactly the false certainty this panel exists to avoid.
    const leader = shortlist[0];
    const second = shortlist[1];
    const leaderIsAloneInBand = second === undefined || second.candidate.tier !== 'frontrunner';
    const gapToNext = second === undefined
      ? Number.POSITIVE_INFINITY
      : leader.buzzScore - second.buzzScore;
    const mood: AwardBuzzCard['mood'] =
      leaderIsAloneInBand && gapToNext > BUZZ_RUNAWAY_GAP ? 'runaway' : 'open';

    // Inside a band, order by team then player name. Never by score.
    const candidates = [...shortlist]
      .sort((a, b) => {
        const bandDelta = bandIndex(a.candidate.tier) - bandIndex(b.candidate.tier);
        if (bandDelta !== 0) return bandDelta;
        const teamDelta = a.candidate.teamName.localeCompare(b.candidate.teamName, 'zh-Hans-CN');
        if (teamDelta !== 0) return teamDelta;
        return a.candidate.playerName.localeCompare(b.candidate.playerName, 'zh-Hans-CN');
      })
      .map(entry => entry.candidate);

    const meta = AWARD_META[award];
    cards.push({
      award,
      label: meta.label,
      emoji: meta.emoji,
      color: meta.color,
      mood,
      candidates,
    });
  }

  return { asOfRound, roundsRemaining, cards };
}

function bandIndex(tier: BuzzTier): number {
  return tier === 'frontrunner' ? 0 : tier === 'contender' ? 1 : 2;
}

/** Position label for display, re-exported so the panel does not redefine it. */
export { POSITION_LABELS };
