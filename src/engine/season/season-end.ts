import { SeasonState } from '../../types/season';
import { retainPlayerArchives } from '../players/retirement-archive';
import { SeasonRecord } from '../../types/team';
import { CoachBase } from '../../types/coach';
import { StandingEntry } from '../../types/league';
import { CupRound } from '../../types/cup';
import { PlayerSeasonStats } from '../../types/player';
import { SeededRNG } from '../match/rng';
import {
  coachAcademyBias,
  DOCTRINE_AXES,
  deriveConfirmedDoctrineTags,
  deriveInitialDoctrine,
  driftDoctrine,
  type ClubDoctrine,
  type DoctrineEvents,
} from '../clubs/doctrine';
import {
  computeAcademyInvestment,
  computeInvestRatio,
  deriveInitialAcademyState,
  driftAcademyState,
  selectSeriousTeams,
  type AcademySeasonInput,
  type AcademyState,
} from '../clubs/academy';
import { computeSalary } from '../economy/finance';
import { applySeasonEndReset } from '../state-updater';
import { createHonorRecord, generateTeamTrophies } from '../honors/honors';
import { checkAchievements } from '../achievements';
import { completeWorldCupEdition } from '../cups/world-cup-host';
import { getAllTeamIds, createNewsId, cnRoundLabel } from './helpers';
import { GameWorld, NewsItem } from './season-manager';
import { processCoachFiring } from '../coaches/coach-hiring';
import { getTeamCoachId } from '../coaches/coach-lookup';
import { computeSelectedPlayerBoosts } from '../players/player-boosts';
import { deriveTeamOverall } from '../team-overall';
import { applyEventEffect } from '../events';
import { computeSeasonAwards, AWARD_META } from '../awards/season-awards';
import {
  describeLeagueTopScorer,
  leagueTopScorerBreakdown,
  leagueTopScorerScore,
} from '../awards/award-scoring';
import type { LeagueTier } from '../awards/award-weights';
import { leagueGoalsOf } from '../players/player-stat-fields';
import { processTransferWindow } from '../transfers/transfer-window';
import { resolveSquadTargets, topUpSquads } from '../transfers/squad-topup';
import { applyFreeAgentReplacements, processRetirements } from '../players/retirement';
import { driftClimate, NEUTRAL_CLIMATE } from '../clubs/league-climate';
import { cloneSquadsForMutation } from '../players/injuries';
import { syncPlayerStatSegments, syncPlayerStatsTeamIds } from '../players/stats';
import { processCoachRetirements, COACH_RETIREMENT_HISTORY_CAP } from '../coaches/coach-retirement';
import { describeCoachIdentity } from '../coaches/tactics';
import { applyAnnualRevaluation } from '../economy/market-value';
import {
  applyIncome as applyFinanceIncome,
  applyExpense as applyFinanceExpense,
  addFinanceBreakdown,
  attemptFireSale,
  archiveSeasonFinance,
  createFinanceBreakdown,
  initTeamFinances,
  CUP_PRIZE,
  formatMoney,
  attributeCupPrizes,
  WORLD_CUP_TIERS,
  emptyFinanceBreakdown,
} from '../economy/finance';
import { getLeagueName } from '../../utils/format';

/**
 * Walk knockout rounds from latest to earliest, return the round in which
 * `teamId` was eliminated. Returns null if the team is still alive (won
 * their latest round or that round is not yet completed) or never appeared.
 */
function findTeamEliminationRound(rounds: CupRound[], teamId: string): string | null {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i];
    const playerFixture = r.fixtures.find(
      (f) => f.homeTeamId === teamId || f.awayTeamId === teamId,
    );
    if (!playerFixture) continue;
    if (!r.completed) return null;
    if (playerFixture.winnerId === teamId) return null;
    return r.roundName;
  }
  return null;
}

/**
 * Handle end-of-season processing: honors, trophies, records, and prep next season.
 *
 * Strictly immutable wrt the input `world` — all changes are accumulated into a
 * patch (a set of locals shadowing world fields) and merged at the very end.
 * Never write `world.X = ...`; write to the local with the same name and put
 * it on the patch object.
 */
/** Paid/asking ratio at or above which a transfer is reported as a premium deal. */
const PREMIUM_NEWS_THRESHOLD = 1.35;

// ── Reputation drift (B1) ──────────────────────────────────────────────
// Reputation had exactly one write site and no decline branch. A club that
// out-performed its expectation gained +2..+5 forever, while the three highest
// expectation clubs were frozen outright by the formula itself: expectation 5
// yields expectedPos 0, so `position < expectedPos - 3` can never fire for them.
// Measured over 300 seasons the consequence is not a slow climb but a lock —
// the distribution stops moving at S150, 11-12 of 32 clubs sit pinned at the
// hard ceiling 99, and the three-tier reputation spread collapses from 44.5
// to 16.9.
//
// Each path carries its own strength constant so verification can zero one at
// a time instead of reverting code. See docs/reputation-and-money-design.md.
/** R1 — sustained underperformance against what the reputation claims. */
const REP_R1_STRENGTH = 1;
const REP_R1_MIN = 72;             // below this a club claims nothing to miss
const REP_R1_BAND_TOP = 0.25;      // rep >= 90 must finish in the global top 25%
const REP_R1_BAND_MID = 0.45;      // rep 80-89 → global top 45%
const REP_R1_BAND_LOW = 0.65;      // rep 72-79 → global top 65%
const REP_R1_WINDOW = 3;           // seasons examined
const REP_R1_MISSES = 2;           // misses inside the window that trigger
/** R2 — relegation. Ability already pays -3..-5; reputation paying nothing was
 *  the loudest asymmetry in the whole drift model.
 *
 *  Flat points punished a small club as hard as a giant. Each club is relegated
 *  roughly 47 times per 300 seasons, so -3..-5 per event is 160+ points of
 *  cumulative decline, and the path showed up in 297 of 302 severe-drop news
 *  items. Charging a share of standing keeps a giant's fall dramatic while no
 *  longer draining a rep-45 club for the same event. */
const REP_R2_STRENGTH = 1;
const REP_R2_SHARE_L1 = 0.03;      // dropping out of the top flight
const REP_R2_SHARE_L2 = 0.02;      // dropping out of the second tier
const REP_R2_MIN = 1;              // any relegation still costs something
/** R3 — financial distress. Connects money to standing: a club in the red is
 *  worth less to sponsors and speaks softer in the market.
 *
 *  This path was dead until B3. Measured over 300 seasons x 4 seeds BEFORE the
 *  academy drain existed: cash never went negative, because the economy
 *  force-sells before it gets there. It was kept as a guard rather than deleted —
 *  it costs nothing while the economy holds, and it is the only path that would
 *  catch a future change to the finance model.
 *
 *  B3 drained the league's unbounded cash accumulation and woke it up. Same
 *  measurement after B3: 10 / 18 / 23 / 0 of 250 seasons carry at least one club
 *  in the red (4.0% / 7.2% / 9.2% / 0%), and NEVER more than one of 32 clubs at a
 *  time. That is the intended reading — a club whose academy spending pushes it
 *  into the red should speak a little softer, which is exactly what this path
 *  exists for.
 *
 *  The knock-on is the league's weighted reputation mean landing at 73.90 against
 *  a >= 74 target. DO NOT tune that away. The 0.10 shortfall was reviewed and
 *  accepted deliberately: closing it would mean either weakening the academy
 *  drain (and with it the pressure valve) or softening this penalty (and with it
 *  the only feedback running from money to standing). See 8.7.6 of
 *  docs/reputation-and-money-design.md. */
const REP_R3_STRENGTH = 1;
/** R4 — a marquee player was poached and the season did not cover for it. */
const REP_R4_STRENGTH = 1;
const REP_R4_MIN = 75;
const REP_R4_PEAK = 85;            // peak rating that counts as marquee
/** R4 keeps the DIVISION ratio while R1 uses the global one, and that is not an
 *  oversight. R1 asks whether a club's reputation matches its standing across the
 *  whole league, so it has to be read globally. R4 asks a narrower question: did
 *  this club cover for the marquee player it lost *within its own competition*? A
 *  second-tier club dropping to 6th there genuinely failed to cover, even though
 *  its global rank is only 18th of 32.
 *
 *  Still a rare path — 1-2 hits per 300 seasons per seed — because the clubs that
 *  lose a peak-85 player are usually the elite sellers, and elite sellers tend to
 *  finish in the top 40% anyway. It reads as a story beat, not a balance lever. */
const REP_R4_RATIO = 0.4;          // must also have finished outside the division top 40%
/** R5 — soft ceiling. Highest leverage path: it is the only one that cannot
 *  reach mid-table clubs, and 11-12 clubs pinned at 99 is the loudest symptom. */
const REP_R5_STRENGTH = 1;
const REP_R5_FLOOR = 92;
const REP_R5_SPAN = 16;            // (rep - 92) / 16 → 44% at 99
/** Gains converge as the ceiling approaches. Headroom form rather than a
 *  division so growth stays normal at 70 and all but stops at 99.
 *
 *  Note the direction: factor = (99 - rep) / headroom, so a SMALLER headroom
 *  raises the factor and makes clubs grow FASTER. Shrinking it to 18 was tried
 *  and is the wrong lever for lowering the mean. Raising it widens the decay
 *  band downwards, which is what actually slows the climb. */
const REP_GAIN_HEADROOM = 30;
const REP_GAIN_MIN_FACTOR = 0.08;
const REP_CEILING = 99;

/**
 * B2 — how many doctrine shifts get a headline per season.
 *
 * The axes jitter every season, so several clubs cross a tag threshold in any
 * given year. The team page badge always shows the live tags, so nothing is
 * hidden by this cap; it only decides how many of the season's shifts are worth
 * a line in the feed. The largest movements are picked, deterministically, so a
 * seed always produces the same feed.
 */
const DOCTRINE_NEWS_PER_SEASON = 4;
/** Gain is scaled by the division the club actually played in.
 *
 *  Reputation is partly a function of exposure: a third-tier champion cannot buy
 *  the standing of a top-flight champion in one season. Without this the tiers
 *  converge no matter how the mean is tuned — at gain floor 2 the spread was 25
 *  with the mean stuck at 70.7, and at floor 4 the mean reached a healthy 79.4
 *  but the spread collapsed to 16.9 with only 2 clubs left under 65. Opening the
 *  gain path lifts every division at once, so the ladder has to be priced in
 *  separately.
 *
 *  Promotion restores the full factor, so the route up is to win promotion
 *  rather than to accumulate reputation in the basement. */
const REP_GAIN_LEVEL_FACTOR: Record<number, number> = { 1: 1, 2: 0.65, 3: 0.25 };
/** Rank a club must finish at or above for the season to count as having exceeded
 *  expectations. Lower divisions demand a better finish, because reputation is
 *  priced against the whole league: a third-tier club finishing 5th of 8 has
 *  out-performed nobody. A flat bar made all three divisions compete for the same
 *  top-three slot and held the top flight down at 82.3. Promotion widens the bar,
 *  so the ladder remains the way up.
 *
 *  The divisions are 16 / 8 / 8, not the evenly-split 11/11/11 the design doc
 *  assumed. The third tier is the delicate one: rank 1 left it at 46.6 and rank 2
 *  at 62.5, straddling the ~55 the mean and spread targets jointly require, so
 *  rank 2 is paired with a much smaller level factor to land between them.
 *
 *  The top flight uses 8 because that is exactly where R1 stops charging: a club
 *  at reputation 90 or above is left alone while it finishes in the global top
 *  25%, which over 32 clubs is the top 8 — all of them in the first division.
 *  Aligning the two means the ladder reads cleanly: the top 8 gain and are not
 *  penalised, ranks 9-16 gain nothing and can be pulled down. Rank 6 was measured
 *  first and left the mean 1.0 short at 73.0 while the >= 85 band sat at 7.7. */
const REP_GAIN_RANK_BY_LEVEL: Record<number, number> = { 1: 8, 2: 3, 3: 2 };
/** An expectation shave for the low-expectation clubs was tried alongside this
 *  and had to be removed. Letting expectation 1-2 finish 6th or 7th in the top
 *  flight and still gain inflated the whole league: the >= 65 band thinned to a
 *  single club, the >= 50 band emptied, and the third tier rose from 57.5 to 67.3
 *  because the extra reputation bought better academies everywhere at once. The
 *  division already prices the difficulty; expectation does not need a second
 *  discount on top. */
/** Floors prevent a collapse — the v2 "底蕴" attempt drove reputation to 27 by
 *  declining unconditionally. They never push a club up. */
const REP_FLOOR_BY_LEVEL: Record<number, number> = { 1: 52, 2: 38, 3: 26 };
const REP_ABSOLUTE_FLOOR = 24;

export function handleSeasonEnd(world: GameWorld, options?: { favoriteTeamIds?: string[]; favoritePlayerIds?: string[] }): GameWorld {
  const seasonNumber = world.seasonState.seasonNumber;
  const rng = new SeededRNG(world.rngState);

  // ── Patch locals (shadow world fields; merged into patch at return) ──
  // These start as fresh shallow copies so per-key writes inside this
  // function never reach the input world. Reads MUST come from these locals
  // (not from `world.X`) once we've started writing to them.
  const coachCareers = { ...world.coachCareers };
  const coachStates = { ...world.coachStates };
  const coachChangesThisSeason = [...world.coachChangesThisSeason];
  // teamStates is `let` because the season-end reset block reassigns entries
  // (it builds a fresh entry via applySeasonEndReset). The Record reference
  // itself is also reused for the team-growth/decline pass below.
  const teamStates = { ...world.teamStates };
  let playerAwardsHistory = world.playerAwardsHistory;
  let transferHistory = world.transferHistory;
  let playerStats = world.playerStats;
  let playerStatSegments = world.playerStatSegments ?? {};
  // Annual development and some transfer/economy paths mutate Player fields.
  // Establish one writable ownership boundary before any of those passes.
  let squads = cloneSquadsForMutation(world.squads);
  // ── A2 retirement / coach-pool locals (introduced in v11) ──
  // Initialised to (defensive) empty arrays so legacy worlds that haven't yet
  // been touched by the v10 → v11 migration don't blow up here. The migration
  // backfills them; this is a belt-and-suspenders for in-memory worlds built
  // by tests.
  let retirementHistory = world.retirementHistory ?? [];
  let freeAgentPool = world.freeAgentPool ?? [];
  let coachCandidatePool = world.coachCandidatePool ?? [];
  let nextPlayerUuidCounter = world.nextPlayerUuidCounter ?? 0;
  // League climate advances once per season, ahead of everything that reads it.
  // Both axes are league-scoped, so they are advanced here rather than inside
  // any of the per-club passes below.
  const leagueClimate = driftClimate(world.leagueClimate ?? NEUTRAL_CLIMATE, rng);
  // ── Phase B coach lifecycle locals (introduced in v12) ──
  // Coach retirement history mirrors the player retirement-history shape;
  // capped at 200 entries (FIFO). nextCoachIdCounter is used by the
  // replacement engine when generating fresh coaches.
  let coachRetirementHistory = world.coachRetirementHistory ?? [];
  let nextCoachIdCounter = world.nextCoachIdCounter ?? 0;
  // coachBases is a `let` because we may add freshly-generated coaches
  // into it during the coach-retirement pass below.
  let coachBases = world.coachBases;
  // ── Phase H Economy locals (introduced in v15) ──
  // Initialised defensively for in-memory worlds built by tests that haven't
  // been touched by the v14 → v15 migration. The migration backfills
  // `teamFinances` from reputation tier; the runtime path always has it.
  let teamFinances = world.teamFinances && Object.keys(world.teamFinances).length > 0
    ? { ...world.teamFinances }
    : initTeamFinances(world.teamBases);
  // Snapshot start-of-season cash for each team so the archive pass can
  // record startCash → endCash on the FinanceSeasonRecord.
  const startCashByTeam: Record<string, number> = {};
  for (const [tid, fin] of Object.entries(teamFinances)) {
    startCashByTeam[tid] = fin.cash;
  }
  // Per-team breakdown of this season's income / expense flows. Populated
  // incrementally as each economy step runs; consumed by archiveSeasonFinance.
  const financeBreakdown = createFinanceBreakdown(Object.keys(teamFinances));

  // Determine champions
  const league1Champion = world.league1Standings[0]?.teamId ?? '';
  const league2Champion = world.league2Standings[0]?.teamId ?? '';
  const league3Champion = world.league3Standings[0]?.teamId ?? '';
  const leagueCupWinner = world.leagueCup.winnerId ?? '';
  const superCupWinner = world.superCup.winnerId ?? '';
  const worldCupWinner = world.worldCup?.winnerId;
  // Continental cup winners (Phase C). Each may be undefined either because
  // the cup didn't run this season (even season) or it didn't complete.
  const continentalCups = world.continentalCups ?? { mainland_cup: null, southern_cup: null, eastern_cup: null };
  const mainlandCupWinner = continentalCups.mainland_cup?.completed ? continentalCups.mainland_cup.winnerId : undefined;
  const southernCupWinner = continentalCups.southern_cup?.completed ? continentalCups.southern_cup.winnerId : undefined;
  const easternCupWinner = continentalCups.eastern_cup?.completed ? continentalCups.eastern_cup.winnerId : undefined;

  // Promotion / relegation — derive ACTUAL movements from teamStates
  const proRelStandings: Record<number, StandingEntry[]> = {
    1: world.league1Standings, 2: world.league2Standings, 3: world.league3Standings,
  };
  const actualPromoted: { teamId: string; from: number; to: number }[] = [];
  const actualRelegated: { teamId: string; from: number; to: number }[] = [];
  for (const teamId of getAllTeamIds(teamStates)) {
    const currentLevel = teamStates[teamId].leagueLevel;
    let playedLevel = currentLevel;
    for (const [lvStr, st] of Object.entries(proRelStandings)) {
      if (st.some(s => s.teamId === teamId && s.played > 0)) {
        playedLevel = parseInt(lvStr) as 1 | 2 | 3;
        break;
      }
    }
    if (currentLevel < playedLevel) actualPromoted.push({ teamId, from: playedLevel, to: currentLevel });
    else if (currentLevel > playedLevel) actualRelegated.push({ teamId, from: playedLevel, to: currentLevel });
  }

  // Create honor record
  const worldCupHostId = world.worldCupEditions?.find(
    edition => edition.seasonNumber === seasonNumber,
  )?.hostTeamId;
  const honor = {
    ...createHonorRecord(
    seasonNumber,
    league1Champion,
    league2Champion,
    league3Champion,
    leagueCupWinner,
    superCupWinner,
    worldCupWinner,
    actualPromoted,
    actualRelegated,
    coachChangesThisSeason,
    ),
    ...(worldCupHostId ? { worldCupHostId } : {}),
  };
  const honorHistory = [...world.honorHistory, honor];

  // Generate trophies for all teams
  const teamTrophies = { ...world.teamTrophies };
  const coachTrophies = { ...world.coachTrophies };
  for (const teamId of getAllTeamIds(teamStates)) {
    const trophies = generateTeamTrophies(
      teamId,
      seasonNumber,
      league1Champion,
      league2Champion,
      league3Champion,
      leagueCupWinner,
      superCupWinner,
      worldCupWinner,
    );
    // Continental cup trophies (Phase C) — attributed alongside league /
    // domestic trophies. Each cup type has its own Trophy['type'] so the
    // /history page and TrophyBreakdown can break them out per region.
    if (teamId === mainlandCupWinner) {
      trophies.push({ type: 'mainland_cup', seasonNumber });
    }
    if (teamId === southernCupWinner) {
      trophies.push({ type: 'southern_cup', seasonNumber });
    }
    if (teamId === easternCupWinner) {
      trophies.push({ type: 'eastern_cup', seasonNumber });
    }
    teamTrophies[teamId] = [...(teamTrophies[teamId] ?? []), ...trophies];

    // Also attribute trophies to the coach (derived from coachStates).
    const coachId = getTeamCoachId(coachStates, teamId);
    if (coachId && trophies.length > 0) {
      coachTrophies[coachId] = [...(coachTrophies[coachId] ?? []), ...trophies];

      // Update coach career entry with trophies — write to local, NOT world.
      const careerList = [...(coachCareers[coachId] ?? [])];
      const lastEntry = careerList[careerList.length - 1];
      if (lastEntry && lastEntry.toSeason === null) {
        careerList[careerList.length - 1] = {
          ...lastEntry,
          trophies: [...lastEntry.trophies, ...trophies],
        };
      }
      coachCareers[coachId] = careerList;
    }
  }

  // Generate trophy news + season summary news
  const news: NewsItem[] = [];
  const windowIndex = world.seasonState.currentWindowIndex;

  if (league1Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-l1'),
      seasonNumber, windowIndex, type: 'trophy', importance: 'major',
      title: `${world.teamBases[league1Champion]?.name} 夺得顶级联赛冠军!`,
      description: `${world.teamBases[league1Champion]?.name} 加冕顶级联赛冠军，以${world.league1Standings[0]?.points}分的成绩登顶。`,
    });
  }
  if (league2Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-l2'),
      seasonNumber, windowIndex, type: 'trophy', importance: 'normal',
      title: `${world.teamBases[league2Champion]?.name} 夺得甲级联赛冠军!`,
      description: `${world.teamBases[league2Champion]?.name} 以${world.league2Standings[0]?.points}分荣膺甲级联赛冠军。`,
    });
  }
  if (leagueCupWinner) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-lc'),
      seasonNumber, windowIndex, type: 'trophy', importance: 'major',
      title: `${world.teamBases[leagueCupWinner]?.name} 夺得联赛杯冠军!`,
      description: `${world.teamBases[leagueCupWinner]?.name} 捧得联赛杯冠军奖杯。`,
    });
  }
  if (superCupWinner) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-sc'),
      seasonNumber, windowIndex, type: 'trophy', importance: 'major',
      title: `${world.teamBases[superCupWinner]?.name} 夺得超级杯冠军!`,
      description: `${world.teamBases[superCupWinner]?.name} 赢得超级杯冠军荣耀。`,
    });
  }

  // Continental cup trophy news + runner-up news — only for cups that ran
  // and completed this season.
  for (const cup of [continentalCups.mainland_cup, continentalCups.southern_cup, continentalCups.eastern_cup]) {
    if (!cup || !cup.completed || !cup.winnerId) continue;
    const winnerName = world.teamBases[cup.winnerId]?.name ?? cup.winnerId;
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `trophy-${cup.type}`),
      seasonNumber, windowIndex, type: 'trophy', importance: 'major',
      title: `${winnerName} 夺得${cup.name}冠军！`,
      description: `${winnerName} 在${cup.region}地区${cup.name}决赛中胜出，捧起冠军奖杯。`,
    });
    // Runner-up note (final loser)
    const finalRound = cup.rounds.at(-1);
    const finalFix = finalRound?.fixtures[0];
    if (finalFix && finalRound?.completed) {
      const runnerUp = finalFix.homeTeamId === cup.winnerId ? finalFix.awayTeamId : finalFix.homeTeamId;
      const ruName = world.teamBases[runnerUp]?.name ?? runnerUp;
      const homeScore = finalFix.result?.home ?? 0;
      const awayScore = finalFix.result?.away ?? 0;
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `trophy-${cup.type}-ru`),
        seasonNumber, windowIndex, type: 'trophy', importance: 'normal',
        title: `${ruName} ${cup.name}决赛失利`,
        description: `${ruName} 在${cup.name}决赛中以 ${finalFix.homeTeamId === runnerUp ? homeScore : awayScore}-${finalFix.homeTeamId === runnerUp ? awayScore : homeScore} 不敌 ${winnerName}，屈居亚军。`,
      });
    }
  }

  // ── Multi-crown detection ──
  const allWinners = [
    league1Champion,
    leagueCupWinner,
    superCupWinner,
    worldCupWinner,
    mainlandCupWinner,
    southernCupWinner,
    easternCupWinner,
  ].filter(Boolean);
  const crownCounts = new Map<string, number>();
  for (const w of allWinners) { if (w) crownCounts.set(w, (crownCounts.get(w) ?? 0) + 1); }
  for (const [teamId, count] of crownCounts) {
    if (count >= 4) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy', importance: 'major',
        title: `四冠王！${world.teamBases[teamId]?.name} 包揽所有冠军！`,
        description: `${world.teamBases[teamId]?.name}创造历史，在一个赛季内夺得全部冠军头衔！`,
      });
    } else if (count >= 3) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy', importance: 'major',
        title: `三冠王！${world.teamBases[teamId]?.name} 创造伟业！`,
        description: `${world.teamBases[teamId]?.name}一个赛季夺得三座冠军奖杯，成就三冠王荣耀！`,
      });
    } else if (count >= 2) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy', importance: 'major',
        title: `双冠王！${world.teamBases[teamId]?.name}`,
        description: `${world.teamBases[teamId]?.name}本赛季荣获两座冠军奖杯，成就双冠王！`,
      });
    }
  }

  // ── Underdog achievements ──
  // Cup finalist from lower leagues
  const cupFinalists = [leagueCupWinner, superCupWinner].filter(Boolean);
  for (const fId of cupFinalists) {
    if (!fId) continue;
    const teamState = teamStates[fId];
    if (teamState && teamState.leagueLevel >= 2) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `underdog-${fId}`),
        seasonNumber, windowIndex, type: 'upset',
        title: `黑马奇迹！${world.teamBases[fId]?.name} 以下克上夺冠！`,
        description: `来自${teamState.leagueLevel === 2 ? '甲级' : '乙级'}联赛的${world.teamBases[fId]?.name}在杯赛中上演了不可思议的夺冠之旅！`,
      });
    }
  }

  // ── Season summary news ──

  // League top scorer (射手王) — LEAGUE goals only, ranked through the same
  // schedule-normalised score the season-review card uses, so the news line and
  // the card can no longer name different players. Read from LOCAL playerStats
  // (still equals world.playerStats here, per the patch convention).
  //
  // Distinct from the Golden Boot, which ranks all-competitions goals.
  const allPlayerStats = Object.values(playerStats);
  const seasonStartLevels = (world.seasonStartLevels ?? {}) as Record<string, LeagueTier>;
  let topScorer: PlayerSeasonStats | null = null;
  let topScorerScore = -Infinity;
  for (const stat of allPlayerStats) {
    const leagueGoals = leagueGoalsOf(stat);
    if (leagueGoals <= 0) continue;
    const score = leagueTopScorerScore(leagueGoals, seasonStartLevels[stat.teamId] ?? 1);
    // Ties fall through to raw league goals, then assists, matching the card.
    const better = topScorer === null
      || score > topScorerScore
      || (score === topScorerScore && (
        leagueGoals > leagueGoalsOf(topScorer)
        || (leagueGoals === leagueGoalsOf(topScorer) && stat.assists > topScorer.assists)
      ));
    if (better) { topScorer = stat; topScorerScore = score; }
  }
  if (topScorer) {
    const teamName = world.teamBases[topScorer.teamId]?.name ?? topScorer.teamId;
    // topScorer.playerId holds a uuid; locate the player by walking the
    // owner's squad. Fall back to a generic "##号" label only if the player
    // isn't found (e.g. a stale stat after a same-season club fold).
    const scorerPlayer = squads[topScorer.teamId]?.find(p => p.uuid === topScorer.playerId);
    const playerName = scorerPlayer?.name
      ?? (scorerPlayer ? `${scorerPlayer.number}号` : '射手王');
    const breakdown = leagueTopScorerBreakdown(
      leagueGoalsOf(topScorer),
      seasonStartLevels[topScorer.teamId] ?? 1,
    );
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'scorer'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `赛季射手王: ${teamName} ${playerName} (${describeLeagueTopScorer(breakdown)})`,
      description: `${teamName}的${playerName}以${leagueGoalsOf(topScorer)}粒联赛进球荣获本赛季射手王。`,
    });
  }

  // Best defense (least goals conceded in top league)
  const bestDefense = [...world.league1Standings].sort((a, b) => a.goalsAgainst - b.goalsAgainst)[0];
  if (bestDefense && bestDefense.played > 0) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'defense'),
      seasonNumber, windowIndex, type: 'streak',
      title: `最佳防守: ${world.teamBases[bestDefense.teamId]?.name} (仅失${bestDefense.goalsAgainst}球)`,
      description: `${world.teamBases[bestDefense.teamId]?.name}以全赛季仅丢${bestDefense.goalsAgainst}球成为顶级联赛最佳防线。`,
    });
  }

  // Most goals scored in top league
  const bestAttack = [...world.league1Standings].sort((a, b) => b.goalsFor - a.goalsFor)[0];
  if (bestAttack && bestAttack.played > 0 && bestAttack.teamId !== league1Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'attack'),
      seasonNumber, windowIndex, type: 'streak',
      title: `火力最猛: ${world.teamBases[bestAttack.teamId]?.name} (${bestAttack.goalsFor}球)`,
      description: `${world.teamBases[bestAttack.teamId]?.name}以${bestAttack.goalsFor}粒进球成为顶级联赛最强火力。`,
    });
  }

  // ── Individual player awards (颁奖典礼) ──────────────────────
  // Pass LOCAL playerStats / squads — these still equal world.X here, but the
  // patch convention is to read from locals once they exist.
  const seasonAwards = computeSeasonAwards(
    seasonNumber,
    playerStats,
    squads,
    world.teamBases,
    world.league1Standings,
    world.playerStatSegments ?? {},
    world.seasonStartLevels ?? {},
    {
      continentalCupWinners: [mainlandCupWinner, southernCupWinner, easternCupWinner]
        .filter((id): id is string => Boolean(id)),
      // The domestic cups were previously omitted entirely, so a league-cup +
      // super-cup double contributed nothing to any individual award.
      domesticCupWinners: [leagueCupWinner, superCupWinner]
        .filter((id): id is string => Boolean(id)),
    },
    // The tournament now closes the season, so this is the live edition and
    // its winner is eligible for the world cup multiplier.
    world.worldCup,
  );
  for (const award of seasonAwards) {
    const meta = AWARD_META[award.type];
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `award-${award.type}`),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${meta.emoji} ${meta.label}: ${award.teamName} ${award.playerName}`,
      description: `${award.playerName}（${award.teamName}）荣膺本赛季${meta.label}，${award.statLabel}。`,
    });
  }
  // Append to history (will be saved with world below)
  if (seasonAwards.length > 0) {
    playerAwardsHistory = [...(playerAwardsHistory ?? []), ...seasonAwards];
  } else if (!playerAwardsHistory) {
    playerAwardsHistory = [];
  }

  // ── A2: Retirements + youth replacements + coach-pool seeding ──
  // Runs BEFORE the transfer window so the new youths are eligible to be
  // transferred (and any retiree slot is already filled when the window
  // logic looks for swap targets). playerStats are intentionally PRESERVED
  // for retired players — historical references resolve, but they no longer
  // accrue stats since their uuid is removed from squads.
  //
  // Reads from the writable local squad snapshot. Writes to LOCAL `squads`,
  // `retirementHistory`, `coachCandidatePool`,
  // `nextPlayerUuidCounter` — never to `world.X`.
  const preRetirementSquads = squads;
  const retirementResult = processRetirements(
    { ...world, squads: preRetirementSquads }, rng, leagueClimate.talentEra,
  );
  if (retirementResult.retirements.length > 0) {
    squads = retirementResult.squads;
    nextPlayerUuidCounter = retirementResult.nextPlayerUuidCounter;
    // Apply the recent FIFO and important-person retention together after all retirements.
    const merged = [...retirementHistory, ...retirementResult.retirements];
    retirementHistory = merged;
    coachCandidatePool = retirementResult.coachCandidatePool;

    // Generate news for major retirements (peakRating >= 80). Don't spam —
    // a typical season produces only a handful of these. The blurb mentions
    // club + age + position + career goals, plus a trophy count tail when
    // the player walked away with silverware.
    //
    // Phase G: a player who retired carrying an active major / long_term
    // injury gets a different headline so the news ticker reflects the
    // "forced by injury" narrative.
    const positionLabel: Record<'GK' | 'DF' | 'MF' | 'FW', string> = {
      GK: '门将', DF: '后卫', MF: '中场', FW: '前锋',
    };
    const currentWindowIdx = world.totalElapsedWindows ?? 0;
    // Build a uuid → player lookup from the pre-retirement snapshot so we can
    // detect the "forced by long injury" case via injuryHistory.
    const preRetirePlayerLookup = new Map<string, import('../../types/player').Player>();
    for (const sq of Object.values(preRetirementSquads)) {
      if (!Array.isArray(sq)) continue;
      for (const p of sq) preRetirePlayerLookup.set(p.uuid, p);
    }
    for (const r of retirementResult.retirements) {
      if (r.peakRating < 80) continue;
      const posCN = positionLabel[r.position];
      const awardCount = playerAwardsHistory.filter(award => award.playerId === r.uuid).length;
      const pre = preRetirePlayerLookup.get(r.uuid);
      const lastInj = pre?.injuryHistory?.[pre.injuryHistory.length - 1];
      const forcedByInjury = !!lastInj
        && (lastInj.type === 'major' || lastInj.type === 'long_term')
        && (pre?.injuredUntilWindow ?? 0) > currentWindowIdx;

      if (forcedByInjury) {
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `retire-${r.uuid}`),
          seasonNumber, windowIndex, type: 'retirement',
          title: `传奇陨落: ${r.name} 因长期伤病被迫挂靴`,
          description: `${r.teamName} ${posCN} ${r.name}（${r.age} 岁）因${lastInj?.reason}的长期伤病不得不告别绿茵场，留下 ${r.careerGoals} 球的纪录。`,
        });
        continue;
      }

      const baseDesc = `${r.teamName} ${posCN} ${r.name}（${r.age} 岁）宣布退役，留下 ${r.careerGoals} 球的纪录`;
      const description = awardCount > 0
        ? `${baseDesc}，档案保留 ${awardCount} 项个人奖项。`
        : `${baseDesc}。`;
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `retire-${r.uuid}`),
        seasonNumber, windowIndex, type: 'retirement',
        title: `${r.name} 宣布退役`,
        description,
      });
    }
  }

  // ── Phase B: Coach retirements + replacements (mirrors player retirement) ──
  // Runs AFTER player retirements so the candidate pool seeded by the player
  // pass is immediately consumable by the coach replacement engine. Runs
  // BEFORE the transfer window so any team that just got a new coach
  // doesn't show up as coach-less mid-tick.
  //
  // Synthetic world view: feed the LOCAL coachCandidatePool (it may have
  // grown via processRetirements above). Writes go to local
  // coachStates / coachBases / coachCareers / coachCandidatePool /
  // nextCoachIdCounter / coachRetirementHistory.
  const coachRetResult = processCoachRetirements(
    { ...world, coachCareers, coachTrophies, coachCandidatePool, nextCoachIdCounter },
    rng,
  );
  if (coachRetResult.retirements.length > 0) {
    // Apply coachStates updates from the result (retirees marked as
    // unemployed; new hires assigned).
    Object.assign(coachStates, coachRetResult.coachStates);
    // Merge fresh CoachBase entries into coachBases.
    coachBases = { ...coachBases, ...coachRetResult.newCoachBases };
    // CareerEntry updates were already constructed in coachRetResult; merge
    // them into coachCareers.
    Object.assign(coachCareers, coachRetResult.coachCareers);
    coachCandidatePool = coachRetResult.coachCandidatePool;
    nextCoachIdCounter = coachRetResult.nextCoachIdCounter;

    // Append + cap retirement history (FIFO).
    const mergedCoachHistory = [...coachRetirementHistory, ...coachRetResult.retirements];
    coachRetirementHistory = mergedCoachHistory.length > COACH_RETIREMENT_HISTORY_CAP
      ? mergedCoachHistory.slice(-COACH_RETIREMENT_HISTORY_CAP)
      : mergedCoachHistory;

    // News: major retirements (rating >= 80) + each new hire.
    for (const r of coachRetResult.retirements) {
      if (r.trophies.length > 0 || r.totalSeasons >= 5) {
        // Use rating threshold via lookup since the retirement record
        // itself doesn't carry rating — fetch from world.coachBases.
        const finalRating = world.coachBases[r.id]?.rating ?? 0;
        if (finalRating < 80 && r.trophies.length === 0) continue;
        const trophiesText = r.trophies.length > 0
          ? `，捧起 ${r.trophies.length} 座冠军奖杯`
          : '';
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `coach-retire-${r.id}`),
          seasonNumber, windowIndex, type: 'retirement',
          title: `${r.name} 宣布退休`,
          description: `${r.finalTeamName} 名帅 ${r.name}（${r.age} 岁）执教 ${r.totalSeasons} 年后挂靴${trophiesText}。`,
        });
      } else if ((world.coachBases[r.id]?.rating ?? 0) >= 80) {
        // Lower-trophy elite retiree — still worth a line.
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `coach-retire-${r.id}`),
          seasonNumber, windowIndex, type: 'retirement',
          title: `${r.name} 宣布退休`,
          description: `${r.finalTeamName} 名帅 ${r.name}（${r.age} 岁）选择挂靴，结束 ${r.totalSeasons} 年执教生涯。`,
        });
      }
    }
    for (const hire of coachRetResult.newHires) {
      const teamName = world.teamBases[hire.teamId]?.name ?? hire.teamId;
      if (hire.source === 'candidate') {
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `coach-hire-cand-${hire.coach.id}`),
          seasonNumber, windowIndex, type: 'coach_hired',
          title: `${hire.coach.name} 转型为教练`,
          description: `传奇球员 ${hire.coach.name} 接手 ${teamName}，将从 ${describeCoachIdentity(hire.coach)} 开启教练生涯。`,
        });
      } else {
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `coach-hire-fresh-${hire.coach.id}`),
          seasonNumber, windowIndex, type: 'coach_hired',
          title: `${teamName} 任命新帅 ${hire.coach.name}`,
          description: `${teamName} 完成与新教练 ${hire.coach.name} 的签约，新帅主张 ${describeCoachIdentity(hire.coach)}。`,
        });
      }
      // Mirror the manual coach-firing path: log this as a coach change.
      coachChangesThisSeason.push({
        teamId: hire.teamId,
        oldCoachId: hire.replacedCoachId,
        newCoachId: hire.coach.id,
        reason: '退休换帅',
      });
    }
  }

  // Teams whose coach was just replaced via retirement (above). We skip these
  // in the voluntary-departure and contract-expiry loops below: a fresh hire
  // should not immediately be subject to "急流勇退" or contract-renewal
  // judgment on a contract they never signed.
  const replacedTeamIdsByRetirement = new Set<string>(
    coachRetResult.retirements.length > 0
      ? coachRetResult.newHires.map((h) => h.teamId)
      : [],
  );

  // ── Phase H: Economy income (prize money + TV/sponsor) ─────────
  // Runs BEFORE the transfer window so teams have post-prize cash to bid
  // with (the transfer-window engine doesn't yet read finances, but elite
  // fire-sale buys later will). We resolve each team's level and rank from
  // the just-finished standings — NOT from teamStates which may already
  // reflect promotion/relegation by this point in the patch chain.
  {
    const incomeResult = applyFinanceIncome(teamFinances, world, seasonNumber);
    teamFinances = incomeResult.teamFinances;
    news.push(...incomeResult.news);
    for (const [teamId, breakdown] of Object.entries(incomeResult.breakdown)) {
      financeBreakdown[teamId] = addFinanceBreakdown(financeBreakdown[teamId], breakdown);
    }
  }

  // ── Transfer window ──────────────────────────────────────────
  // Player UUIDs are stable across transfers, so playerStats keys, awards,
  // and prior transferHistory entries continue to resolve without any
  // post-process rewrite. The only thing that needs touching is each
  // affected stat entry's `teamId` (so this season's freshly-attributed
  // top-scorer / awards news points to the new club) — processTransferWindow
  // returns the refreshed playerStats record.
  //
  // Synthetic world view: pass post-retirement `squads` so transfer logic
  // operates on the current rosters (not on `world.squads` which still has
  // the retirees). `playerStats` is unchanged at this point — preserved for
  // historical lookups.
  const favoriteSet = new Set(options?.favoriteTeamIds ?? []);
  // Resolved from the same inputs the top-up pass will use, so the window's
  // free-agent gate and the top-up cannot disagree about how big a squad should be.
  const squadTargets = resolveSquadTargets({
    teamIds: Object.keys(squads),
    cashByTeam: Object.fromEntries(
      Object.keys(squads).map(id => [id, world.teamFinances[id]?.cash ?? 0]),
    ),
    doctrines: world.clubDoctrines,
    climate: leagueClimate,
  });
  const transferResult = processTransferWindow(
    { ...world, squads, playerStats, freeAgentPool }, rng,
    { favoriteTeamIds: favoriteSet, squadTargets },
  );
  // v17 — always pick up the pool the transfer engine returns (may grow
  // or shrink even when no transfers fire, due to overflow/age-out checks).
  freeAgentPool = transferResult.freeAgentPool;
  // v20 — staged offers/targets for favorite teams. If non-empty, opens
  // a transfer window for the UI to resolve.
  const stagedOffers = transferResult.pendingOffers;
  const stagedTargets = transferResult.pendingTargets;
  // Free agent pool snapshot for UI to display (uuids only; full lookup
  // via world.freeAgentPool live).
  const freeAgentPoolSnapshot = freeAgentPool.map(p => p.uuid);
  if (transferResult.transfers.length > 0 || transferResult.freeAgentRetirees.length > 0) {
    squads = transferResult.squads;
    playerStats = transferResult.playerStats;
    transferHistory = [...(transferHistory ?? []), ...transferResult.transfers];

    // v2: any free agent that didn't get re-signed → retire. Add to
    // retirementHistory with reason "未获自由市场报价" via the description
    // field. Keeps player count from inflating ("球员太多" feedback).
    if (transferResult.freeAgentRetirees.length > 0) {
      const newRetirements = transferResult.freeAgentRetirees.map(fa => ({
        uuid: fa.uuid,
        name: fa.name,
        teamId: fa.teamId,
        teamName: fa.teamName,
        position: fa.position,
        peakRating: fa.peakRating,
        age: fa.age,
        seasonRetired: seasonNumber,
        careerGoals: fa.careerGoals,
      }));
      const merged = [...retirementHistory, ...newRetirements];
      retirementHistory = merged;

      // 1:1 for the age-out path only. That path used to be the one retirement
      // route with no youth replacement behind it, which leaked players out of the
      // universe — see `applyFreeAgentReplacements` for the measured numbers.
      //
      // Overflow is deliberately excluded, and excluding it is what makes the
      // league able to shrink. Replacing those too closes the universe: total
      // player count can then only ever rise, which puts a hard floor under the
      // squad mean's down-swing — it can fall by at most the pool's 40-player
      // parking capacity (~1.25 players per club) before every extra body bounces
      // straight back into a squad. Measured with the replacement in place, seed
      // 20260722's `armsRace` fell from +0.52 to -1.43 over 80 seasons and the
      // squad mean moved 0.09.
      const replacement = applyFreeAgentReplacements({
        squads,
        retirees: transferResult.freeAgentRetirees.filter(fa => !fa.overflow),
        teamBases: world.teamBases,
        academyLevels: world.academyLevels,
        talentEra: leagueClimate.talentEra,
        rng,
        nextPlayerUuidCounter,
      });
      squads = replacement.squads;
      nextPlayerUuidCounter = replacement.nextPlayerUuidCounter;

      // News for elite released players who weren't picked up
      for (const fa of transferResult.freeAgentRetirees) {
        if (fa.peakRating >= 80) {
          news.push({
            id: createNewsId(seasonNumber, windowIndex, `freeagent-retire-${fa.uuid}`),
            seasonNumber, windowIndex, type: 'retirement',
            title: `${fa.name} 未获报价后挂靴`,
            description: `${fa.teamName} 释放的 ${fa.name}（${fa.age}岁，巅峰 ${fa.peakRating}）在自由市场上未收到任何报价，宣布退役。`,
          });
        }
      }
    }

    // Phase H: book transfer cash flows. Both 'transfer' (poach) and
    // 'free_agent' (free-market signing) carry a fee with seller→buyer
    // (or released-from→recipient for free_agent) flow. 'free' and 'loan'
    // have no fee.
    for (const t of transferResult.transfers) {
      if (t.type !== 'transfer' && t.type !== 'free_agent') continue;
      if (!t.fee) continue;
      if (financeBreakdown[t.fromTeamId]) financeBreakdown[t.fromTeamId].transferIncome += t.fee;
      if (financeBreakdown[t.toTeamId]) financeBreakdown[t.toTeamId].transferExpense += t.fee;
      if (teamFinances[t.fromTeamId]) {
        teamFinances[t.fromTeamId] = {
          ...teamFinances[t.fromTeamId],
          cash: teamFinances[t.fromTeamId].cash + t.fee,
          totalIncome: teamFinances[t.fromTeamId].totalIncome + t.fee,
        };
      }
      if (teamFinances[t.toTeamId]) {
        teamFinances[t.toTeamId] = {
          ...teamFinances[t.toTeamId],
          cash: teamFinances[t.toTeamId].cash - t.fee,
          totalExpense: teamFinances[t.toTeamId].totalExpense + t.fee,
        };
      }
    }

    // Top 3 transfers as news
    // Premium deals lead the window: a club paying twice a player's valuation is
    // the story of the summer, not whichever transfer happened to be processed
    // first. Sorted by premium first, then by raw fee as the tiebreak.
    const topTransfers = [...transferResult.transfers
      .filter((t) => t.type === 'transfer')]
      .sort((a, b) => (b.premiumRatio ?? 0) - (a.premiumRatio ?? 0) || (b.fee ?? 0) - (a.fee ?? 0))
      .slice(0, 3);
    for (const t of topTransfers) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `transfer-${t.playerId}`),
        seasonNumber, windowIndex, type: 'trophy', importance: 'minor',
        title: (t.premiumRatio ?? 1) >= PREMIUM_NEWS_THRESHOLD
          ? `💰 天价转会: ${t.playerName} 以 ${t.premiumRatio!.toFixed(1)} 倍身价加盟 ${t.toTeamName}`
          : `🔄 转会: ${t.playerName} 加盟 ${t.toTeamName}`,
        description: `${t.playerName}从${t.fromTeamName}转会至${t.toTeamName}${t.fee ? `，转会费约€${t.fee}M` : ''}。${t.reason}。`,
      });
    }
    if (transferResult.transfers.filter((t) => t.type === 'transfer').length > 3) {
      const total = transferResult.transfers.filter((t) => t.type === 'transfer').length;
      news.push({
        id: createNewsId(seasonNumber, windowIndex, 'transfer-summary'),
        seasonNumber, windowIndex, type: 'trophy', importance: 'minor',
        title: `转会窗口: 共完成 ${total} 笔转会`,
        description: `本赛季转会窗口共有${total}名球员易主，详情查看转会页面。`,
      });
    }
  } else if (!transferHistory) {
    transferHistory = [];
  }

  // ── Phase H: Economy expense (salaries) + fire sale ─────────────
  // Salaries are computed AFTER the transfer window so the wage bill
  // reflects the current squad's market value sum (just-poached stars
  // raise the buyer's bill; sold stars reduce the seller's). v3 also
  // applies a league-level wage cap — `applyExpense` needs to know each
  // team's league so the cap binds correctly.
  {
    // Resolve each team's just-played league level from standings (same
    // logic applyIncome uses for prize lookup).
    const teamLevels: Record<string, 1 | 2 | 3> = {};
    for (const lv of [1, 2, 3] as const) {
      const arr = lv === 1 ? world.league1Standings : lv === 2 ? world.league2Standings : world.league3Standings;
      for (const s of arr) {
        if (s.played > 0) teamLevels[s.teamId] = lv;
      }
    }
    for (const tid of Object.keys(squads)) {
      if (teamLevels[tid] === undefined) {
        teamLevels[tid] = (world.teamStates[tid]?.leagueLevel ?? 3) as 1 | 2 | 3;
      }
    }
    const expenseResult = applyFinanceExpense(teamFinances, squads, teamLevels);
    teamFinances = expenseResult.teamFinances;
    for (const [teamId, breakdown] of Object.entries(expenseResult.breakdown)) {
      financeBreakdown[teamId] = addFinanceBreakdown(financeBreakdown[teamId], breakdown);
    }
  }

  // ── Phase H: Fire sale for negative-cash teams ─────────────────
  // After salaries land, any team with cash < 0 AND a €30M+ player on
  // squad triggers a forced sale at 200% of marketValue to an elite
  // buyer with cash. Up to 1 sale per team per season; news + transfer
  // record generated for each.
  {
    const fireSaleResult = attemptFireSale(
      teamFinances, squads, world.teamBases,
      seasonNumber, windowIndex, rng,
    );
    teamFinances = fireSaleResult.teamFinances;
    squads = fireSaleResult.squads;
    playerStats = syncPlayerStatsTeamIds(playerStats, squads);
    if (fireSaleResult.transfers.length > 0) {
      transferHistory = [...(transferHistory ?? []), ...fireSaleResult.transfers];
      // Book the cash flows in the breakdown (cash already moved by
      // attemptFireSale; we just track the breakdown for the archive).
      for (const t of fireSaleResult.transfers) {
        if (!t.fee) continue;
        if (financeBreakdown[t.fromTeamId]) financeBreakdown[t.fromTeamId].transferIncome += t.fee;
        if (financeBreakdown[t.toTeamId]) financeBreakdown[t.toTeamId].transferExpense += t.fee;
      }
    }
    news.push(...fireSaleResult.news);
  }

  // ── Squad top-up: enforce the squad-size target ────────────────
  // Runs after the fire sale, so a club that just had to sell is measured on
  // the squad it actually finished with, and before the annual revaluation so
  // promoted graduates age on the same pass as everyone else.
  //
  // Doctrine is read from `world`, not from the local `clubDoctrines`, because
  // that local is created further down when the board reacts to the season it
  // just had. The target should reflect the stance the club held while playing
  // it, which is what `world.clubDoctrines` still holds here.
  {
    const cashByTeam: Record<string, number> = {};
    const levelByTeam: Record<string, 1 | 2 | 3> = {};
    for (const teamId of Object.keys(squads)) {
      cashByTeam[teamId] = teamFinances[teamId]?.cash ?? 0;
      levelByTeam[teamId] = (teamStates[teamId]?.leagueLevel ?? 1) as 1 | 2 | 3;
    }
    const topUp = topUpSquads({
      squads,
      teamBases: world.teamBases,
      playerStats,
      cashByTeam,
      levelByTeam,
      doctrines: world.clubDoctrines,
      academyLevels: world.academyLevels,
      freeAgentPool,
      climate: leagueClimate,
      rng,
      nextPlayerUuidCounter,
      seasonNumber,
      windowIndex,
    });
    squads = topUp.squads;
    freeAgentPool = topUp.freeAgentPool;
    playerStats = topUp.playerStats;
    nextPlayerUuidCounter = topUp.nextPlayerUuidCounter;
    if (topUp.transfers.length > 0) {
      transferHistory = [...(transferHistory ?? []), ...topUp.transfers];
      const nextFinances = { ...teamFinances };
      for (const [teamId, amount] of Object.entries(topUp.incomeByTeam)) {
        const fin = nextFinances[teamId];
        if (!fin || amount <= 0) continue;
        nextFinances[teamId] = {
          ...fin, cash: fin.cash + amount, totalIncome: fin.totalIncome + amount,
        };
      }
      for (const [teamId, amount] of Object.entries(topUp.expenseByTeam)) {
        const fin = nextFinances[teamId];
        if (!fin || amount <= 0) continue;
        nextFinances[teamId] = {
          ...fin, cash: fin.cash - amount, totalExpense: fin.totalExpense + amount,
        };
      }
      teamFinances = nextFinances;
      for (const t of topUp.transfers) {
        if (!t.fee) continue;
        if (financeBreakdown[t.fromTeamId]) financeBreakdown[t.fromTeamId].transferIncome += t.fee;
        if (financeBreakdown[t.toTeamId]) financeBreakdown[t.toTeamId].transferExpense += t.fee;
      }
      playerStats = syncPlayerStatsTeamIds(playerStats, squads);
    }
  }

  // ── Annual market value revaluation ──────────────────────────
  // Mutates squad in place (also bumps each player's age). `squads` has been
  // isolated from the input world at the start of this function.
  applyAnnualRevaluation(
    squads,
    playerStats,
    new Set(actualPromoted.map((p) => p.teamId)),
    league1Champion || null,
    world.totalElapsedWindows ?? 0,
  );
  playerStats = syncPlayerStatsTeamIds(playerStats, squads);
  playerStatSegments = syncPlayerStatSegments(playerStatSegments, squads);

  // Promoted teams
  for (const p of actualPromoted) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `promo-${p.teamId}`),
      seasonNumber, windowIndex, type: 'promotion',
      title: `${world.teamBases[p.teamId]?.name} 升级成功!`,
      description: `${world.teamBases[p.teamId]?.name} 从${getLeagueName(p.from)}升入${getLeagueName(p.to)}。`,
    });
  }

  // Relegated teams
  for (const r of actualRelegated) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `releg-${r.teamId}`),
      seasonNumber, windowIndex, type: 'relegation',
      title: `${world.teamBases[r.teamId]?.name} 不幸降级`,
      description: `${world.teamBases[r.teamId]?.name} 从${getLeagueName(r.from)}降入${getLeagueName(r.to)}。`,
    });
  }

  // Coach changes summary (uses the count BEFORE season-end logic adds more)
  if (coachChangesThisSeason.length > 0) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'coach-summary'),
      seasonNumber, windowIndex, type: 'coach_fired',
      title: `本赛季共有 ${coachChangesThisSeason.length} 次换帅`,
      description: coachChangesThisSeason.map(c => `${world.teamBases[c.teamId]?.name}`).join('、') + ' 更换了教练。',
    });
  }

  // Create season records for all teams
  const teamSeasonRecords = { ...world.teamSeasonRecords };
  const allStandings: Record<number, StandingEntry[]> = {
    1: world.league1Standings,
    2: world.league2Standings,
    3: world.league3Standings,
  };

  for (const teamId of getAllTeamIds(teamStates)) {
    const teamState = teamStates[teamId];
    // Find this team's standings entry — search ALL leagues since leagueLevel
    // may have changed due to promotion/relegation
    let entry: StandingEntry | undefined;
    let foundLevel: 1 | 2 | 3 = teamState.leagueLevel;
    for (const [lvStr, st] of Object.entries(allStandings)) {
      const found = st.find((s) => s.teamId === teamId);
      if (found && found.played > 0) {
        entry = found;
        foundLevel = parseInt(lvStr) as 1 | 2 | 3;
        break;
      }
    }
    const standings = allStandings[foundLevel] ?? [];
    const position = entry ? standings.indexOf(entry) + 1 : standings.length;

    // Determine cup results for this team
    let cupResult: string | undefined;
    let superCupResult: string | undefined;
    let worldCupResult: string | undefined;
    let continentalCupResult: string | undefined;

    // League cup
    if (teamId === leagueCupWinner) cupResult = '冠军';
    else {
      // Check if runner-up (in final but lost)
      const lcFinal = world.leagueCup.rounds.at(-1);
      if (lcFinal?.fixtures[0] && (lcFinal.fixtures[0].homeTeamId === teamId || lcFinal.fixtures[0].awayTeamId === teamId)) {
        cupResult = '亚军';
      } else {
        // Find which round they were eliminated
        for (const round of world.leagueCup.rounds) {
          const inRound = round.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId);
          if (inRound && round.completed) {
            const won = round.fixtures.some(f => f.winnerId === teamId);
            if (!won) { cupResult = cnRoundLabel(round.roundName); break; }
          }
        }
      }
    }

    // Super cup
    if (teamId === superCupWinner) superCupResult = '冠军';
    else {
      const inGroup = world.superCup.groups.some(g => g.teamIds.includes(teamId));
      if (inGroup) {
        const scFinal = world.superCup.knockoutRounds.at(-1);
        const inFinal = scFinal && scFinal.fixtures[0]
          && (scFinal.fixtures[0].homeTeamId === teamId || scFinal.fixtures[0].awayTeamId === teamId);
        if (inFinal && scFinal.completed) {
          superCupResult = '亚军';
        } else {
          const elimRound = findTeamEliminationRound(world.superCup.knockoutRounds, teamId);
          if (elimRound) {
            superCupResult = cnRoundLabel(elimRound);
          } else if (world.superCup.groupStageCompleted) {
            const inAnyKO = world.superCup.knockoutRounds.some(r =>
              r.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId),
            );
            superCupResult = inAnyKO ? '参赛中' : '小组赛淘汰';
          } else {
            superCupResult = '参赛中';
          }
        }
      }
    }

    // World cup. The tournament closes the season, so by settlement every
    // branch resolves. The old post-season timing could leave a team recorded
    // as '参赛中' permanently, because the bracket had not resolved yet when
    // the season record was written.
    if (world.worldCup?.completed) {
      if (teamId === worldCupWinner) worldCupResult = '冠军';
      else if (world.worldCup.participantIds.includes(teamId)) {
        const wcFinal = world.worldCup.knockoutRounds.at(-1);
        const inFinal = wcFinal && wcFinal.fixtures[0]
          && (wcFinal.fixtures[0].homeTeamId === teamId || wcFinal.fixtures[0].awayTeamId === teamId);
        if (inFinal && wcFinal.completed) {
          worldCupResult = '亚军';
        } else {
          const elimRound = findTeamEliminationRound(world.worldCup.knockoutRounds, teamId);
          if (elimRound) {
            worldCupResult = cnRoundLabel(elimRound);
          } else {
            const inAnyKO = world.worldCup.knockoutRounds.some(r =>
              r.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId),
            );
            worldCupResult = inAnyKO ? '参赛' : '小组赛淘汰';
          }
        }
      }
    }

    // Continental cup result — pick the cup matching this team's continent.
    // If no cup ran for the team's region this season, leave undefined. New
    // tournaments include every regional club; the membership check remains
    // for an in-progress cup loaded from the earlier selective format.
    {
      const teamRegion = world.teamBases[teamId]?.region?.split('+')[0];
      const cup = teamRegion === '大陆' ? continentalCups.mainland_cup
        : teamRegion === '南洲' ? continentalCups.southern_cup
        : teamRegion === '东洲' ? continentalCups.eastern_cup
        : null;
      if (cup) {
        if (teamId === cup.winnerId) {
          continentalCupResult = '冠军';
        } else {
          if (!cup.participantIds.includes(teamId)) {
            continentalCupResult = '未参加';
          } else {
            const finalRound = cup.rounds.at(-1);
            const finalFix = finalRound?.fixtures[0];
            const inFinal = finalFix && (finalFix.homeTeamId === teamId || finalFix.awayTeamId === teamId);
            if (inFinal && finalRound?.completed && cup.winnerId && teamId !== cup.winnerId) {
              continentalCupResult = '亚军';
            } else {
              const elimRound = findTeamEliminationRound(cup.rounds, teamId);
              if (elimRound) {
                continentalCupResult = cnRoundLabel(elimRound);
              } else if (cup.groupStageCompleted) {
                const inKnockout = cup.rounds.some(round =>
                  round.fixtures.some(fixture =>
                    fixture.homeTeamId === teamId || fixture.awayTeamId === teamId,
                  ),
                );
                continentalCupResult = inKnockout ? '参赛中' : '小组赛淘汰';
              } else {
                continentalCupResult = '参赛中';
              }
            }
          }
        }
      }
    }

    const record: SeasonRecord = {
      seasonNumber,
      leagueLevel: foundLevel,
      leaguePosition: position,
      leaguePlayed: entry?.played ?? 0,
      leagueWon: entry?.won ?? 0,
      leagueDrawn: entry?.drawn ?? 0,
      leagueLost: entry?.lost ?? 0,
      leagueGF: entry?.goalsFor ?? 0,
      leagueGA: entry?.goalsAgainst ?? 0,
      leaguePoints: entry?.points ?? 0,
      cupResult,
      superCupResult,
      worldCupResult,
      continentalCupResult,
      // Archive the title-awarding coach, before season-end retirements/replacements.
      coachId: getTeamCoachId(world.coachStates, teamId) ?? '',
      teamOverall: world.teamBases[teamId]?.overall ?? 0,
      promoted: teamState.leagueLevel < foundLevel,
      relegated: teamState.leagueLevel > foundLevel,
    };

    teamSeasonRecords[teamId] = [...(teamSeasonRecords[teamId] ?? []), record];
  }

  // ── Coach voluntary departure (急流勇退) ─────────────────────
  // Top coaches who just won a major trophy have a small chance of leaving.
  // All writes target the LOCAL coachStates / teamStates / coachCareers /
  // coachChangesThisSeason — never world.X[id].
  for (const teamId of getAllTeamIds(teamStates)) {
    // Skip teams whose coach was just installed via retirement replacement —
    // a fresh hire shouldn't be subject to "急流勇退" the same season they
    // signed.
    if (replacedTeamIdsByRetirement.has(teamId)) continue;
    const coachId = getTeamCoachId(coachStates, teamId);
    if (!coachId) continue;
    const coach = coachBases[coachId];
    if (!coach || coach.rating < 78) continue; // only elite coaches do this

    // Check if this coach's team won a major trophy this season
    const wonMajor = teamId === league1Champion || teamId === leagueCupWinner || teamId === superCupWinner;
    if (!wonMajor) continue;

    // 8% chance per major trophy won
    if (rng.next() >= 0.08) continue;

    // Coach voluntarily leaves — read from LOCAL coachStates so iterations
    // earlier in this loop are visible (the new hire from the previous team
    // appears here as a candidate to consider).
    const allCoachData = Object.entries(coachStates).map(([id, cs]) => ({
      base: coachBases[id], state: cs,
    })).filter(c => c.base != null);

    const firingResult = processCoachFiring(teamId, coachId, world.teamBases[teamId], allCoachData, seasonNumber, rng);

    coachStates[coachId] = { ...coachStates[coachId], ...firingResult.firedCoachUpdate };
    coachStates[firingResult.newCoachId] = { ...coachStates[firingResult.newCoachId], ...firingResult.newCoachUpdate };
    teamStates[teamId] = { ...teamStates[teamId], coachPressure: 5 };

    const careerList = [...(coachCareers[coachId] ?? [])];
    if (careerList.length > 0) {
      careerList[careerList.length - 1] = { ...careerList[careerList.length - 1], toSeason: seasonNumber, fired: false };
    }
    coachCareers[coachId] = careerList;
    coachCareers[firingResult.newCoachId] = [...(coachCareers[firingResult.newCoachId] ?? []), firingResult.newCareerEntry];

    const coachName = coach.name;
    const newCoach = coachBases[firingResult.newCoachId];
    const newCoachName = newCoach?.name ?? firingResult.newCoachId;
    const successorIdentity = newCoach ? `，并带来 ${describeCoachIdentity(newCoach)} 的新思路` : '';
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `retire-${coachId}`),
      seasonNumber, windowIndex, type: 'coach_fired',
      title: `${coachName} 功成身退，告别${world.teamBases[teamId]?.name}`,
      description: `${coachName}在率队夺冠后选择急流勇退，留下一段传奇执教生涯。${newCoachName}将接过教鞭${successorIdentity}。`,
    });

    coachChangesThisSeason.push({
      teamId, oldCoachId: coachId, newCoachId: firingResult.newCoachId,
      reason: '功成身退',
    });
  }

  // ── Coach contract expiry ──────────────────────────────────
  // Reads `currentTeamId` and `contractEnd` from LOCAL coachStates so
  // changes from the voluntary-departure loop above are picked up here.
  for (const teamId of getAllTeamIds(teamStates)) {
    // Skip teams whose coach was just installed via retirement replacement —
    // their contract was just generated; nothing to expire this season.
    if (replacedTeamIdsByRetirement.has(teamId)) continue;
    const coachId = getTeamCoachId(coachStates, teamId);
    if (!coachId) continue;
    const coachState = coachStates[coachId];
    if (!coachState?.contractEnd || coachState.contractEnd > seasonNumber) continue;

    // Contract expired — decide renewal
    const standings = allStandings[teamStates[teamId].leagueLevel] ?? [];
    const pos = standings.findIndex(s => s.teamId === teamId) + 1;
    const total = standings.length;
    const ratio = total > 0 ? pos / total : 1;
    const wonTrophy = teamId === league1Champion || teamId === leagueCupWinner || teamId === superCupWinner;

    const renewChance = wonTrophy ? 0.85 : ratio <= 0.3 ? 0.70 : ratio <= 0.6 ? 0.45 : 0.25;

    if (rng.next() < renewChance) {
      const extension = wonTrophy ? rng.nextInt(2, 3) : rng.nextInt(1, 2);
      coachStates[coachId] = { ...coachStates[coachId], contractEnd: seasonNumber + extension };
      const coachName = coachBases[coachId]?.name ?? coachId;
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `renew-${coachId}`),
        seasonNumber, windowIndex, type: 'coach_hired',
        title: `${coachName} 与${world.teamBases[teamId]?.name}续约${extension}年`,
        description: `${coachName}续签了一份${extension}年的新合同。`,
      });
    } else {
      const allCoachData = Object.entries(coachStates).map(([id, cs]) => ({
        base: coachBases[id], state: cs,
      })).filter(c => c.base != null);
      const firingResult = processCoachFiring(teamId, coachId, world.teamBases[teamId], allCoachData, seasonNumber, rng);

      coachStates[coachId] = { ...coachStates[coachId], ...firingResult.firedCoachUpdate };
      if (coachStates[firingResult.newCoachId]) {
        coachStates[firingResult.newCoachId] = { ...coachStates[firingResult.newCoachId], ...firingResult.newCoachUpdate };
      } else {
        coachStates[firingResult.newCoachId] = { id: firingResult.newCoachId, currentTeamId: teamId, isUnemployed: false, unemployedSince: null, contractEnd: seasonNumber + rng.nextInt(2, 4) };
      }
      teamStates[teamId] = { ...teamStates[teamId], coachPressure: 5 };

      const careerList = [...(coachCareers[coachId] ?? [])];
      if (careerList.length > 0) {
        careerList[careerList.length - 1] = { ...careerList[careerList.length - 1], toSeason: seasonNumber, fired: false };
      }
      coachCareers[coachId] = careerList;
      coachCareers[firingResult.newCoachId] = [...(coachCareers[firingResult.newCoachId] ?? []), firingResult.newCareerEntry];

      const coachName = coachBases[coachId]?.name ?? coachId;
      const newName = coachBases[firingResult.newCoachId]?.name ?? firingResult.newCoachId;
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `expire-${coachId}`),
        seasonNumber, windowIndex, type: 'coach_fired',
        title: `${coachName} 合同到期离开${world.teamBases[teamId]?.name}`,
        description: `${coachName}合同到期后未能续约，${newName}接任。`,
      });
      coachChangesThisSeason.push({ teamId, oldCoachId: coachId, newCoachId: firingResult.newCoachId, reason: '合同到期' });
    }
  }

  // ── Check achievements ──────────────────────────────────────
  let achievements = [...(world.achievements ?? [])];
  for (const teamId of getAllTeamIds(teamStates)) {
    const records = teamSeasonRecords[teamId] ?? [];
    const currentRecord = records[records.length - 1];
    if (!currentRecord) continue;
    const newAch = checkAchievements(teamId, world.teamBases[teamId]?.name ?? teamId, seasonNumber, currentRecord, records, achievements);
    if (newAch.length > 0) {
      achievements = [...achievements, ...newAch];
      for (const a of newAch) {
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `ach-${a.id}`),
          seasonNumber, windowIndex, type: 'trophy', importance: 'minor',
          title: `${world.teamBases[teamId]?.name ?? teamId} 解锁成就: ${a.title}`,
          description: a.description,
        });
      }
    }
  }

  // Apply season-end reset to team states. teamStates is already a local
  // (initialized at the top of the function) so we keep writing into it
  // rather than spinning a fresh copy here.
  for (const teamId of getAllTeamIds(teamStates)) {
    const state = teamStates[teamId];
    const standings = allStandings[state.leagueLevel] ?? [];
    const entry = standings.find((s) => s.teamId === teamId);
    const position = entry ? standings.indexOf(entry) + 1 : standings.length;

    teamStates[teamId] = applySeasonEndReset(state, position, standings.length);
  }

  // ── Team growth/decline based on season performance ─────────
  // 赛季内仍在生效的窗口事件必须先回滚。post-match 只在事件自然到期时
  // 反向，而收尾处原本直接 `activeEvents: []` 清空 —— 跨赛季未到期的
  // 临时事件（例如 5 窗口的 injury，attack −3）会把效果永久留在球队身上。
  let teamBases = { ...world.teamBases };
  for (const event of world.activeEvents ?? []) {
    teamBases = applyEventEffect(teamBases, event, true);
  }

  // 漂移路径的参考量是「俱乐部三线均值」，不是 overall。
  //
  // overall 现在是派生量（三线 + 教练 + 球员），赛季末会被 deriveTeamOverall
  // 整个覆盖。把它当中间量有两个后果：
  //   1. 路径里的 [38, 97] 硬夹是按旧存量字段调的，而派生值可以到 99
  //      （raw 最高 116）。于是 OVR ≥ 95 的球队夺冠拿到的是
  //      min(97, ovr + 3..4) − ovr ≤ 0 —— 顶级球队赢球反而被扣分。
  //   2. 阈值（93 老化 / 87 动荡 / 45 托底 / 均值 81）的语义随派生值漂移：
  //      均值回归的 `dist > 20` 分支在 97 夹之后永远不触发，只剩 `dist < −20`
  //      的托底侧，一个稳定器退化成了单向棘轮。
  //
  // 改用三线均值后，漂移系统读写的正是「俱乐部自身能力」，与教练和球员
  // 加成解耦；上界由每条线的 [35, 96] 夹承担，不再需要 overall 上的硬夹。
  const levelMeanLines = new Map<number, number>();
  for (const level of [1, 2, 3]) {
    const ids = getAllTeamIds(teamStates).filter(id => teamStates[id].leagueLevel === level);
    if (ids.length === 0) continue;
    const sum = ids.reduce((acc, id) => {
      const b = teamBases[id];
      return acc + (b.attack + b.midfield + b.defense) / 3;
    }, 0);
    levelMeanLines.set(level, sum / ids.length);
  }

  // ── B2: club doctrine ─────────────────────────────────────────────
  // Best academy graduate this season, per club. Built from the post-retirement
  // squads rather than the post-transfer ones, so a graduate who was sold in the
  // same window still counts for the club that raised him.
  const youthPeakByTeam: Record<string, number> = {};
  {
    const existing = new Set<string>();
    for (const squad of Object.values(preRetirementSquads)) {
      for (const entry of squad) existing.add(entry.uuid);
    }
    const graduateSource = retirementResult.retirements.length > 0
      ? retirementResult.squads
      : preRetirementSquads;
    for (const [teamId, squad] of Object.entries(graduateSource)) {
      for (const entry of squad) {
        if (existing.has(entry.uuid)) continue;
        const peak = entry.peakRating ?? entry.rating;
        if (youthPeakByTeam[teamId] === undefined || peak > youthPeakByTeam[teamId]) {
          youthPeakByTeam[teamId] = peak;
        }
      }
    }
  }
  let coachBiasMean = 0;
  const squadValueByTeam: Record<string, number> = {};
  for (const [teamId, squad] of Object.entries(squads)) {
    let total = 0;
    for (const entry of squad) total += entry.marketValue ?? 0;
    squadValueByTeam[teamId] = total;
  }

  // ── B2: league-relative inputs ────────────────────────────────────────
  //
  // Both of the quantities below were first written as absolute per-club
  // scores, and both of them locked the doctrine system solid. The lesson is
  // the same one B1 learned about reputation bands: an absolute threshold
  // silently changes meaning as the world drifts underneath it.
  //
  // Money. `cash < 3 seasons of wages` looked reasonable. Measured over 50
  // seasons the median club climbs from 3.2 to 15.6 seasons of wages in cash
  // — the economy accumulates cash without bound — so cashTight fired for 43%
  // of club-seasons in the first decade and 2% by S50, while cashFlush went
  // 20% -> 88%. Every club became a buyer and none became a seller: spending
  // pinned at 0.94, selling at 0.05. Ranking inside the league cannot fail
  // that way — a third of the clubs are tight and a third are flush in every
  // season whatever the absolute level — and the two pushes are exact
  // mirrors, so neither money axis has a net lean.
  const cashRatioByTeam: Record<string, number> = {};
  for (const teamId of Object.keys(squads)) {
    const wage = computeSalary(squadValueByTeam[teamId] ?? 0, teamStates[teamId]?.leagueLevel ?? 3);
    const cash = teamFinances[teamId]?.cash ?? 0;
    cashRatioByTeam[teamId] = wage > 0 ? cash / wage : Number.POSITIVE_INFINITY;
  }
  const cashRatioOrder = Object.keys(cashRatioByTeam)
    .sort((a, b) => (cashRatioByTeam[a] - cashRatioByTeam[b]) || a.localeCompare(b));
  const cashTightShare = Math.floor(cashRatioOrder.length / 3);
  const cashTightTeamIds = new Set(cashRatioOrder.slice(0, cashTightShare));
  const cashFlushTeamIds = new Set(cashRatioOrder.slice(cashRatioOrder.length - cashTightShare));

  // Coach bias. coachAcademyBias is a raw opinion score and is NOT mean-zero:
  // stabilityBuff runs -5..+10, so its term alone averages about +0.075. Applied
  // uncentred that is +0.019 per season on the academy axis, which walked the
  // league average from 0.54 to 0.81 over 150 seasons. Subtracting the mean
  // over the clubs currently in the league keeps every coach individually as
  // opinionated as before — a coach change still moves a club, which is the
  // point — while making the league as a whole go nowhere.
  const coachBiasByTeam: Record<string, number> = {};
  {
    const ids = Object.keys(teamBases);
    let sum = 0;
    for (const teamId of ids) {
      const coachId = getTeamCoachId(coachStates, teamId);
      const bias = coachId ? coachAcademyBias(coachBases[coachId]) : 0;
      coachBiasByTeam[teamId] = bias;
      sum += bias;
    }
    coachBiasMean = ids.length > 0 ? sum / ids.length : 0;
  }
  // Peak of every player actually poached this window. Built once from the
  // post-transfer squads; only fee-bearing moves count, which excludes the
  // zero-sum elite swaps and keeps the path about losing a marquee name. Shared
  // by R4 (reputation) and the B2 doctrine `lostCorePlayer` event, so it is
  // built before either consumer.
  const poachedPeakByUuid = new Map<string, number>();
  {
    const peakByUuid = new Map<string, number>();
    for (const squad of Object.values(squads)) {
      for (const player of squad) peakByUuid.set(player.uuid, player.peakRating ?? player.rating);
    }
    for (const record of transferResult.transfers) {
      if (record.type !== 'transfer' || !record.fee || record.fee <= 0) continue;
      const peak = peakByUuid.get(record.playerId);
      if (peak !== undefined) poachedPeakByUuid.set(record.playerId, peak);
    }
  }

  /** Clubs that lost a peak-85 player to a paid transfer this window. */
  const lostCoreTeamIds = new Set<string>();
  for (const record of transferResult.transfers) {
    if (record.type !== 'transfer' || !record.fee || record.fee <= 0) continue;
    if ((poachedPeakByUuid.get(record.playerId) ?? 0) >= REP_R4_PEAK) {
      lostCoreTeamIds.add(record.fromTeamId);
    }
  }
  const titleTeamIds = new Set(
    [league1Champion, leagueCupWinner, superCupWinner].filter(Boolean),
  );
  const clubDoctrines: Record<string, ClubDoctrine> = { ...(world.clubDoctrines ?? {}) };
  // `movement` is how far the four axes travelled this season. Tag changes are
  // frequent by design — the axes jitter every season, so a club sitting near a
  // threshold crosses it now and then — and the news feed only reports the
  // biggest shifts. Nothing is hidden by this: the team page badge always shows
  // the current tags, so the cap only decides what gets a headline.
  const doctrineTagChanges: { teamId: string; before: string[]; after: string[]; movement: number }[] = [];

  // R1 reads its bands against the whole league, so the global rank of a club is
  // its division offset plus its finishing position. Both the total and the
  // offsets are league-wide constants for this season, so they are computed once
  // here instead of per club per season-record inside the drift loop.
  const globalTeamCount = (allStandings[1]?.length ?? 0)
    + (allStandings[2]?.length ?? 0)
    + (allStandings[3]?.length ?? 0);
  const levelRankOffset: Record<number, number> = {};
  {
    let acc = 0;
    for (const lv of [1, 2, 3]) {
      levelRankOffset[lv] = acc;
      acc += allStandings[lv]?.length ?? 0;
    }
  }

  for (const teamId of getAllTeamIds(teamStates)) {
    const base = { ...teamBases[teamId] };
    const state = teamStates[teamId];

    const clampTo = (value: number, lo: number, hi: number): number =>
      Math.max(lo, Math.min(hi, value));

    /** 俱乐部三线均值 —— 漂移路径的读写基准。 */
    const clubLines = (): number => (base.attack + base.midfield + base.defense) / 3;

    /** 把强度变化对称施加到三条线；depth 与 stability 同步跟随。 */
    const applyDrift = (delta: number): void => {
      if (delta === 0) return;
      const sign = delta > 0 ? 1 : -1;
      const mag = Math.abs(delta);
      base.attack = clampTo(base.attack + sign * mag, 35, 96);
      base.midfield = clampTo(base.midfield + sign * mag, 35, 96);
      base.defense = clampTo(base.defense + sign * mag, 35, 96);
      base.depth = clampTo(base.depth + sign * mag, 30, 96);
      base.stability = clampTo(base.stability + sign * rng.nextInt(0, 1), 35, 96);
    };

    let growthEntry: StandingEntry | undefined;
    let growthLevel: number = state.leagueLevel;
    for (const [lvStr, st] of Object.entries(allStandings)) {
      const found = st.find((s) => s.teamId === teamId);
      if (found && found.played > 0) { growthEntry = found; growthLevel = parseInt(lvStr); break; }
    }
    const standings = allStandings[growthLevel] ?? [];
    const position = growthEntry ? standings.indexOf(growthEntry) + 1 : standings.length;
    const total = standings.length;
    const ratio = total > 0 ? position / total : 1;

    // ── Performance-based growth ──
    if (position === 1) {
      // Winning the division has to be worth more than the drift a strong
      // club pays every season. The old ladder had a single top bracket,
      // `ratio <= 0.15` → +1..+2, so a champion earned exactly what a
      // mid-table top-15% finish earned. A club at OVR 90 then needed to
      // win roughly one season in three just to hold station, against an
      // expected title rate of one in sixteen.
      //
      // Keyed on position rather than ratio so the bonus means the same
      // thing in a 16-team top flight and an 8-team third tier.
      applyDrift(rng.nextInt(3, 4));
    } else if (ratio <= 0.15) {
      applyDrift(rng.nextInt(1, 2));
    } else if (ratio <= 0.35) {
      applyDrift(rng.nextInt(0, 1));
    } else if (ratio >= 0.85) {
      const declineMax = clubLines() > 60 ? 3 : 2;
      applyDrift(-rng.nextInt(1, declineMax));
    } else if (ratio >= 0.7) {
      if (clubLines() > 50) {
        applyDrift(-rng.nextInt(0, 1));
      }
    }

    // ── Natural aging: only the very top, and probabilistic ──
    // 阈值从 overall 93 换成三线均值 88。两者在初始数据里几乎相等
    // （恒大 overall 92 / 三线均值 91.0），但派生 OVR 含教练与球员加成，
    // 93 在 L1 会命中近四成球队；88 在三线均值上约等于 L1 的 p95。
    if (clubLines() >= 88 && rng.next() < 0.5) {
      applyDrift(-1);
    }

    // ── Floor uplift: weakest teams always improve a little ──
    if (clubLines() <= 45) {
      applyDrift(1);
    }

    // ── Mean reversion: gentle two-sided pull toward the team's own level ──
    // The target has to track the real population, and it has to be the
    // team's own division. A single global constant cannot serve three
    // tiers whose three-line means sit roughly twenty points apart, and the
    // old `|dist| > 20` band around 81 was unreachable above the [38, 97]
    // clamp — only the `dist < −20` side ever fired, which turned a
    // stabiliser into a one-way ratchet that lifted the whole pyramid.
    const levelMean = levelMeanLines.get(state.leagueLevel) ?? clubLines();
    const distFromMean = clubLines() - levelMean;
    if (Math.abs(distFromMean) > 12 && ratio > 0.15) {
      const pullChance = Math.min(0.4, Math.abs(distFromMean) / 120);
      if (rng.next() < pullChance) {
        applyDrift(distFromMean > 0 ? -1 : 1);
      }
    }

    // Dynasty DNA — the three legacy clubs never sink into mid-table.
    // The floor sits on the three-line mean so it constrains the club's own
    // ability; a floor on `overall` would be erased by the derivation below.
    const PROTECTED_TEAMS = ['gz_hengda', 'shimazu', 'xibei_wolf'];
    const floor = PROTECTED_TEAMS.includes(teamId) ? 82 : 38;
    const shortfall = floor - clubLines();
    if (shortfall > 0) applyDrift(Math.ceil(shortfall));

    // ── Promoted teams get a boost ──
    const startLevel = (world.seasonStartLevels ?? {})[teamId] ?? base.initialLeagueLevel;
    if (state.leagueLevel < startLevel) {
      const promoBoost = rng.nextInt(3, 5);
      applyDrift(promoBoost);
      base.depth = clampTo(base.depth + rng.nextInt(2, 4), 30, 96);
      base.attack = clampTo(base.attack + rng.nextInt(1, 3), 35, 96);
      base.midfield = clampTo(base.midfield + rng.nextInt(1, 2), 35, 96);
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `boost-${teamId}`),
        seasonNumber, windowIndex, type: 'match_result',
        title: `${base.name} 升级后大力引援`,
        description: `${base.name}升级后获得大量投资，整体实力提升${promoBoost}点。`,
      });
    }
    // Relegated teams decline
    // Relegated teams decline — symmetric with the promotion bonus.
    // 此前升级是 +3..+5 而降级只有 −1..−2，每季 3 升 3 降就在 48 队里净
    // 留下约 +7.5 点（+0.156/队/季）。V3 实测的通胀速率是 +0.19/季，两者
    // 吻合 —— 这是整个金字塔向上的唯一系统性推力，与战绩无关。
    if (state.leagueLevel > startLevel) {
      applyDrift(-rng.nextInt(3, 5));
      base.depth = clampTo(base.depth - rng.nextInt(2, 4), 30, 96);
      base.attack = clampTo(base.attack - rng.nextInt(1, 3), 35, 96);
      base.midfield = clampTo(base.midfield - rng.nextInt(1, 2), 35, 96);
    }

    // Strong teams have a chance of "internal turmoil"
    // A 10% chance of a small drop taxed every strong club by 0.30 a season,
    // which compressed the whole top flight. A rarer, sharper shock keeps
    // the drama but spreads clubs apart instead of levelling them.
    // 阈值读三线均值而非派生 OVR：派生值在 L1 中位数就有 90，87 会命中
    // 半数以上的顶级联赛球队，把「强队偶发动荡」变成对整个联赛的普遍抽税。
    if (clubLines() >= 87 && rng.next() < 0.04) {
      const drop = rng.nextInt(4, 8);
      applyDrift(-drop);
      base.attack = clampTo(base.attack - rng.nextInt(1, 2), 35, 96);
      base.stability = clampTo(base.stability - rng.nextInt(1, 3), 35, 96);
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `turmoil-${teamId}`),
        seasonNumber, windowIndex, type: 'coach_fired',
        title: `${base.name} 遭遇内部动荡`,
        description: `${base.name}核心球员出走，更衣室出现裂痕，实力下降${drop}点。`,
      });
    }

    // Overperformance bonus — the label said "underperformance", but the
    // condition (finishing well ahead of expectedPos) is the opposite. Reputation
    // is the only thing this ever moved, and it only ever moved up.
    // The old form was `position < expectedPos - 3 && ratio <= 0.4`, both read
    // inside the club's own division. Two defects came out of that. expectation 4
    // and 5 evaluate to expectedPos 3 and 0, so `expectedPos - 3` was never
    // positive and those clubs could never gain reputation at all — frozen by
    // arithmetic rather than by results. And `ratio <= 0.4` asked a third-tier
    // leader for the same top-40% finish as a top-flight contender, so all three
    // divisions competed for one identical bar and the ladder could not separate.
    //
    // The bar is now a rank that widens with the division, plus a shave for clubs
    // that were never expected to be here. `ratio` stays in use elsewhere in this
    // loop; it no longer gates reputation growth.
    const gainRank = REP_GAIN_RANK_BY_LEVEL[growthLevel] ?? 4;
    if (position <= gainRank) {
      applyDrift(rng.nextInt(1, 3));
      // Headroom convergence replaces the hard min(99): growth stays normal at 70,
      // halves around 85, and all but stops at 99. Without this a club at 99 can
      // be pulled down by R5 and climb straight back in the same breath.
      const gainFactor = Math.max(
        REP_GAIN_MIN_FACTOR,
        Math.min(1, (REP_CEILING - base.reputation) / REP_GAIN_HEADROOM),
      ) * (REP_GAIN_LEVEL_FACTOR[growthLevel] ?? 1);
      base.reputation = Math.min(REP_CEILING, base.reputation + rng.nextInt(2, 5) * gainFactor);
    }

    // ── Reputation: decline paths ───────────────────────────────
    // Every path is conditional on a real failure. An unconditional decay is what
    // drove the v2 "底蕴" attempt down to 27.
    let reputationDelta = 0;
    const declinePaths: string[] = [];

    // R1 — sustained underperformance against what the reputation claims. Read
    // from the season-record history rather than new persisted state, so the
    // streak survives a save/load with no schema change.
    if (REP_R1_STRENGTH > 0 && base.reputation >= REP_R1_MIN) {
      const band = base.reputation >= 90
        ? REP_R1_BAND_TOP
        : base.reputation >= 80 ? REP_R1_BAND_MID : REP_R1_BAND_LOW;
      const recent = (teamSeasonRecords[teamId] ?? []).slice(-REP_R1_WINDOW);
      if (recent.length >= REP_R1_WINDOW) {
        let misses = 0;
        // Bands are read against the whole league, not the club's own division.
        // Reading `leaguePosition / divisionSize` made a third-tier champion score
        // 9% and a mid-table top-flight club score 60%, so R1 punished exactly the
        // wrong clubs: the top flight settled at 81.6 while the second tier reached
        // 75.5, and no amount of gain tuning could fix an inverted ladder.
        for (const record of recent) {
          if (globalTeamCount <= 0) continue;
          const globalRank = (levelRankOffset[record.leagueLevel] ?? 0) + record.leaguePosition;
          if (globalRank / globalTeamCount > band) misses++;
        }
        if (misses >= REP_R1_MISSES) {
          const magnitude = misses >= REP_R1_WINDOW ? rng.nextInt(1, 2) : 1;
          reputationDelta -= magnitude * REP_R1_STRENGTH;
          declinePaths.push('长期未达声望预期');
        }
      }
    }

    // R2 — relegation, charged as a share of standing rather than a flat number.
    if (REP_R2_STRENGTH > 0 && state.leagueLevel > startLevel) {
      const share = startLevel === 1 ? REP_R2_SHARE_L1 : REP_R2_SHARE_L2;
      const loss = Math.max(REP_R2_MIN, Math.round(base.reputation * share * REP_R2_STRENGTH));
      reputationDelta -= loss;
      declinePaths.push('降级');
    }

    // R3 — financial distress.
    if (REP_R3_STRENGTH > 0 && (teamFinances[teamId]?.cash ?? 0) < 0) {
      reputationDelta -= Math.round(rng.nextInt(3, 6) * REP_R3_STRENGTH);
      declinePaths.push('财政危机');
    }

    // R4 — a marquee player was poached and the season did not cover for it.
    if (REP_R4_STRENGTH > 0 && base.reputation >= REP_R4_MIN && ratio > REP_R4_RATIO) {
      const lostMarquee = transferResult.transfers.some(record =>
        record.type === 'transfer'
        && !!record.fee && record.fee > 0
        && record.fromTeamId === teamId
        && (poachedPeakByUuid.get(record.playerId) ?? 0) >= REP_R4_PEAK);
      if (lostMarquee) {
        reputationDelta -= Math.round(rng.nextInt(1, 2) * REP_R4_STRENGTH);
        declinePaths.push('当家球星被挖');
      }
    }

    // R5 — soft ceiling.
    if (REP_R5_STRENGTH > 0 && base.reputation >= REP_R5_FLOOR) {
      const chance = (base.reputation - REP_R5_FLOOR) / REP_R5_SPAN;
      if (rng.next() < chance) {
        reputationDelta -= Math.round(rng.nextInt(1, 2) * REP_R5_STRENGTH);
        declinePaths.push('顶格自然回落');
      }
    }

    if (reputationDelta !== 0) {
      const before = base.reputation;
      base.reputation = before + reputationDelta;
      if (before - base.reputation >= 4) {
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `repdrop-${teamId}`),
          seasonNumber, windowIndex, type: 'coach_fired', importance: 'minor',
          title: `${base.name} 声望下滑${Math.round(before - base.reputation)}点`,
          description: `${declinePaths.join('、')}，${base.name}的业界评价随之下降。`,
        });
      }
    }

    // Floors only stop a collapse; they never lift a club that is already above them.
    const levelFloor = Math.max(
      REP_ABSOLUTE_FLOOR,
      REP_FLOOR_BY_LEVEL[state.leagueLevel] ?? REP_ABSOLUTE_FLOOR,
    );
    base.reputation = Math.max(levelFloor, Math.min(REP_CEILING, Math.round(base.reputation)));

    // ── B2: doctrine drift ──────────────────────────────────────────────
    // Same band arithmetic as R1, read globally: a club that finished inside the
    // band its reputation claims has met expectations, outside it has missed them.
    // Whether the board concludes its approach is working.
    //
    // Read against the club's OWN division, not its reputation band. The R1
    // bands are deliberately permissive below REP_R1_MIN (R1 uses a band of 1
    // there so a small club is never charged), and reusing them here made
    // metExpectation fire for 94% of club-seasons against 6% for
    // missedExpectation. That is a net outward push on all four axes every
    // season, and it drove every axis into its hard bound within twenty
    // seasons — the exact lock-up this system exists to avoid.
    //
    // Top 60% of your own division is balanced across the population by
    // construction, so reinforcement and reversal cancel in aggregate and only
    // a club's own results decide which way it leans. The two magnitudes are
    // deliberately unequal (0.03 up, 0.045 down) and the split is deliberately
    // uneven (60/40) so that the products match: 0.6 x 0.03 = 0.4 x 0.045. A
    // single failed season still moves a board further than a single good one
    // confirms it, without biasing the league as a whole.
    const doctrineDivisionSize = allStandings[growthLevel]?.length ?? 0;
    const doctrineMetExpectation = doctrineDivisionSize > 0
      ? position <= Math.ceil(doctrineDivisionSize * 0.6)
      : true;
    const doctrineEvents: DoctrineEvents = {
      metExpectation: doctrineMetExpectation,
      missedExpectation: !doctrineMetExpectation,
      cashTight: cashTightTeamIds.has(teamId),
      cashFlush: cashFlushTeamIds.has(teamId),
      youthBreakthrough: (youthPeakByTeam[teamId] ?? 0) >= 88,
      lostCorePlayer: lostCoreTeamIds.has(teamId),
      wonTitle: titleTeamIds.has(teamId),
      relegated: state.leagueLevel > startLevel,
    };
    const doctrineBefore = clubDoctrines[teamId] ?? deriveInitialDoctrine(base);
    const doctrineAfter = driftDoctrine(
      doctrineBefore,
      doctrineEvents,
      (coachBiasByTeam[teamId] ?? 0) - coachBiasMean,
      rng,
    );
    clubDoctrines[teamId] = doctrineAfter;
    // News reads the CONFIRMED tag set, not the plain one. The plain set moves
    // every three to five seasons per club because the axes jitter across the
    // thresholds; reporting that would be reporting noise. The badge on the team
    // page still shows the plain set as a live readout.
    const tagsBefore = deriveConfirmedDoctrineTags(doctrineBefore);
    const tagsAfter = deriveConfirmedDoctrineTags(doctrineAfter);
    const beforeKeys = tagsBefore.map((tag) => tag.key);
    const afterKeys = tagsAfter.map((tag) => tag.key);
    if (afterKeys.length !== beforeKeys.length || afterKeys.some((key) => !beforeKeys.includes(key))) {
      let movement = 0;
      for (const axis of DOCTRINE_AXES) {
        movement += Math.abs(doctrineAfter[axis] - doctrineBefore[axis]);
      }
      doctrineTagChanges.push({
        teamId,
        before: tagsBefore.map((tag) => tag.label),
        after: tagsAfter.map((tag) => tag.label),
        movement,
      });
    }

    // OVR 不再独立漂移：从三条线 + 教练 + 球员重算，让它始终等于比赛真正
    // 使用的强度。上面九条路径现在直接改三条线（applyDrift），完全不经过
    // base.overall —— 它只是这三条线加上教练与球员加成之后的读数。
    //
    // 此刻 squads 与教练都已是新赛季状态（退役 → 转会 → fireSale → 教练
    // 解雇都已跑完），所以派生值描述的是新赛季的开局实力。
    const derivedCoachId = getTeamCoachId(coachStates, teamId);
    base.overall = deriveTeamOverall(
      base,
      derivedCoachId ? coachBases[derivedCoachId] ?? null : null,
      computeSelectedPlayerBoosts(squads[teamId] ?? [], '4-3-3'),
    );

    teamBases[teamId] = base;
  }

  // ── B2: doctrine shift headlines ────────────────────────────────────────
  // Only the largest few shifts of the season are headlined; see the cap note
  // where doctrineTagChanges is declared. Sorted rather than sampled so the
  // same seed always produces the same feed.
  const headlineShifts = [...doctrineTagChanges]
    .sort((a, b) => (b.movement - a.movement) || a.teamId.localeCompare(b.teamId))
    .slice(0, DOCTRINE_NEWS_PER_SEASON);
  for (const shift of headlineShifts) {
    const teamName = teamBases[shift.teamId]?.name ?? shift.teamId;
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `doctrine-${shift.teamId}`),
      seasonNumber, windowIndex, type: 'storyline', importance: 'minor',
      title: `${teamName} 经营路线转向「${shift.after.join('、')}」`,
      description: shift.before.length > 0
        ? `从「${shift.before.join('、')}」一路走来，${teamName}在这个夏天换了建队思路。`
        : `${teamName}的建队思路在这个夏天逐渐清晰起来。`,
      subject: { teamIds: [shift.teamId] },
    });
  }

  // Update season state awards
  const seasonState: SeasonState = {
    ...world.seasonState,
    completed: true,
    awards: {
      league1Champion,
      league1RunnerUp: world.league1Standings[1]?.teamId,
      league2Champion,
      league3Champion,
      leagueCupWinner,
      leagueCupRunnerUp: world.leagueCup.rounds.at(-1)?.fixtures[0]
        ? (world.leagueCup.rounds.at(-1)!.fixtures[0].homeTeamId === leagueCupWinner
          ? world.leagueCup.rounds.at(-1)!.fixtures[0].awayTeamId
          : world.leagueCup.rounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      superCupWinner,
      superCupRunnerUp: world.superCup.knockoutRounds.at(-1)?.fixtures[0]
        ? (world.superCup.knockoutRounds.at(-1)!.fixtures[0].homeTeamId === superCupWinner
          ? world.superCup.knockoutRounds.at(-1)!.fixtures[0].awayTeamId
          : world.superCup.knockoutRounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      worldCupWinner,
      worldCupRunnerUp: world.worldCup?.knockoutRounds.at(-1)?.fixtures[0]
        ? (world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].homeTeamId === worldCupWinner
          ? world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].awayTeamId
          : world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      promoted: actualPromoted.map((p) => p.teamId),
      relegated: actualRelegated.map((r) => r.teamId),
    },
  };

  // ── Settle prediction ──
  let prediction = world.prediction;
  let predictionHistory = world.predictionHistory ?? [];
  if (prediction && !prediction.settled) {
    const relegatedTeamIds = actualRelegated.map(r => r.teamId);
    const championCorrect = prediction.champion === league1Champion;
    const relegatedCorrect = relegatedTeamIds.includes(prediction.relegated);
    const correct = Number(championCorrect) + Number(relegatedCorrect);
    prediction = { ...prediction, settled: true, correctCount: correct };
    predictionHistory = [...predictionHistory.filter((entry) => entry.season !== seasonNumber), {
      season: seasonNumber,
      champion: prediction.champion,
      relegated: prediction.relegated,
      championCorrect,
      relegatedCorrect,
      correctCount: correct,
    }];
  }

  // ── Coach age aging ──────────────────────────────────────────
  // Increment age on every coach AFTER the retirement pass — so the
  // freshly-generated replacement (age 38-43 / 35-50) doesn't immediately
  // age twice in its first season. Mirrors the player applyAnnualRevaluation
  // pass which also bumps age in-place. We rebuild a fresh record here
  // because `coachBases` may already be a fresh shallow copy from the
  // retirement merge — but to be safe we always create a new local.
  const agedCoachBases: Record<string, CoachBase> = {};
  for (const [coachId, base] of Object.entries(coachBases)) {
    agedCoachBases[coachId] = { ...base, age: (base.age ?? 50) + 1 };
  }
  coachBases = agedCoachBases;

  // ── World cup prize money + edition record ───────────────────
  // The tournament now closes the season, so its bracket is already settled
  // when income lands and the prize belongs in the normal breakdown.
  //
  // Before the timing redesign this had to be patched onto the just-archived
  // finance record after the fact, because the tournament ran in windows
  // appended after settlement — and before that patch existed the prize
  // silently vanished in every world cup year.
  let worldCupEditions = world.worldCupEditions;
  if (worldCupWinner && world.worldCup?.completed) {
    const wcFinal = world.worldCup.knockoutRounds.at(-1)?.fixtures[0];
    const worldCupRunnerUp = wcFinal
      ? (wcFinal.homeTeamId === worldCupWinner ? wcFinal.awayTeamId : wcFinal.homeTeamId)
      : undefined;

    worldCupEditions = completeWorldCupEdition(
      world.worldCupEditions,
      world.worldCup,
      seasonNumber,
      worldCupWinner,
      worldCupRunnerUp,
    );

    const winnerName = world.teamBases[worldCupWinner]?.name ?? worldCupWinner;
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-world-cup'),
      seasonNumber, windowIndex, type: 'trophy',
      importance: 'major',
      title: `${winnerName} 夺得环球冠军杯冠军！`,
      description: `${winnerName} 在第${seasonNumber}届环球冠军杯决赛中胜出，登上世界之巅。`,
    });

    // Sorted by amount so the news log surfaces the winner first.
    const wcPrizes = attributeCupPrizes(world.worldCup.knockoutRounds, WORLD_CUP_TIERS);
    for (const [teamId, amount] of Object.entries(wcPrizes).sort((a, b) => b[1] - a[1])) {
      const fin = teamFinances[teamId];
      const currentBreakdown = financeBreakdown[teamId];
      if (!fin || !currentBreakdown || amount <= 0) continue;

      teamFinances[teamId] = { ...fin, cash: fin.cash + amount };
      financeBreakdown[teamId] = addFinanceBreakdown(
        currentBreakdown,
        { ...emptyFinanceBreakdown(), prizeMoney: amount },
      );

      let role = '参赛';
      if (teamId === worldCupWinner) role = '冠军';
      else if (teamId === worldCupRunnerUp) role = '亚军';
      else if (amount >= CUP_PRIZE.world_cup_semi) role = '四强';
      else if (amount >= CUP_PRIZE.world_cup_qf) role = '八强';
      else if (amount >= CUP_PRIZE.world_cup_r16) role = '16强';
      const teamName = world.teamBases[teamId]?.name ?? teamId;
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `wc-prize-${teamId}`),
        seasonNumber, windowIndex, type: 'prize_money',
        title: `${teamName} 环球冠军杯${role}奖金 ${formatMoney(amount)}`,
        description: `${teamName} 在第${seasonNumber}届环球冠军杯打入${role}，收获 ${formatMoney(amount)} 奖金。`,
      });
    }
  }

  // ── B3: Academy investment + level drift ────────────────────────────────
  //
  // Placed after the doctrine drift so the budget reflects the club CURRENT
  // operating stance, and before the finance archive so the spend lands in this
  // season's history record.
  //
  // The doctrine events above (cashTight / cashFlush) deliberately read PRE-drain
  // cash. Letting the drain feed back into the same season drift would close a
  // loop inside one season-end — a keen academy spends more, so it looks tighter,
  // so it turns seller, so next season it spends less — and the two systems would
  // be impossible to reason about separately. Sequential is also the honest model:
  // the board reacts to the season it just had, then allocates the surplus.
  const academyLevels: Record<string, AcademyState> = { ...(world.academyLevels ?? {}) };
  {
    // League level from the just-finished standings — same resolution the income
    // and expense passes use.
    const academyTeamLevels: Record<string, 1 | 2 | 3> = {};
    for (const lv of [1, 2, 3] as const) {
      const arr = lv === 1
        ? world.league1Standings
        : lv === 2 ? world.league2Standings : world.league3Standings;
      for (const s of arr) {
        if (s.played > 0) academyTeamLevels[s.teamId] = lv;
      }
    }
    for (const tid of Object.keys(squads)) {
      if (academyTeamLevels[tid] === undefined) {
        academyTeamLevels[tid] = (world.teamStates[tid]?.leagueLevel ?? 3) as 1 | 2 | 3;
      }
    }

    // Investment INTENT, ranked across the league. League-relative for the same
    // reason B2's cashTight / cashFlush are: an absolute bar silently changes
    // meaning as the economy drifts underneath it.
    const intentByTeam: Record<string, number> = {};
    for (const teamId of Object.keys(squads)) {
      const doctrine = clubDoctrines[teamId] ?? deriveInitialDoctrine(teamBases[teamId]);
      intentByTeam[teamId] = computeInvestRatio(
        doctrine.academy,
        (coachBiasByTeam[teamId] ?? 0) - coachBiasMean,
      );
    }
    const seriousTeamIds = selectSeriousTeams(intentByTeam);

    for (const teamId of Object.keys(squads)) {
      const fin = teamFinances[teamId];
      const bd = financeBreakdown[teamId];
      if (!fin || !bd) continue;
      const squad = squads[teamId] ?? [];
      const squadValue = squad.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
      const doctrine = clubDoctrines[teamId] ?? deriveInitialDoctrine(teamBases[teamId]);
      const coachBias = (coachBiasByTeam[teamId] ?? 0) - coachBiasMean;
      const input: AcademySeasonInput = {
        revenue: bd.prizeMoney + bd.tvSponsor + bd.transferIncome,
        cash: fin.cash,
        wage: computeSalary(squadValue, academyTeamLevels[teamId] ?? 1),
        academyAxis: doctrine.academy,
        coachBias,
        reputation: teamBases[teamId]?.reputation ?? 50,
        seriousRank: seriousTeamIds.has(teamId),
      };
      const invest = computeAcademyInvestment(input);
      if (invest > 0) {
        teamFinances = {
          ...teamFinances,
          [teamId]: {
            ...fin,
            cash: Math.round((fin.cash - invest) * 10) / 10,
            totalExpense: fin.totalExpense + invest,
          },
        };
        financeBreakdown[teamId] = { ...bd, academy: (bd.academy ?? 0) + invest };
      }
      academyLevels[teamId] = driftAcademyState(
        academyLevels[teamId] ?? deriveInitialAcademyState(),
        input,
        invest,
        rng,
      );
    }
  }

  // ── Phase H: Archive finance — push the season's totals to history ──
  // and reset the running totalIncome / totalExpense counters. Cash carries
  // forward unchanged. We do this LAST so all flows from this season
  // (income, transfers, salaries, fire sales) have already landed on the
  // teamFinances locals.
  teamFinances = archiveSeasonFinance(teamFinances, seasonNumber, startCashByTeam, financeBreakdown);

  // Final patch — apply ALL accumulated locals over `world` in one spread.
  // No `world.X = ...` mutation has happened above; every change went through
  // a local of the same name.
  const updatedWorld: GameWorld = {
    ...world,
    seasonState,
    teamBases,
    teamStates,
    coachBases,
    coachStates,
    coachCareers,
    coachChangesThisSeason,
    teamTrophies,
    coachTrophies,
    teamSeasonRecords,
    honorHistory,
    worldCupEditions,
    achievements,
    prediction,
    predictionHistory,
    squads,
    playerStats,
    playerStatSegments,
    playerAwardsHistory,
    transferHistory,
    retirementHistory: retainPlayerArchives({ ...world, retirementHistory, playerAwardsHistory }, options?.favoritePlayerIds),
    freeAgentPool,
    /** v18 — rumors are transient; cleared at season-end. */
    transferRumors: [],
    /** v20 — open transfer window if favorites have pending offers/targets. */
    transferWindow: (favoriteSet.size > 0 && (stagedOffers.length > 0 || stagedTargets.length > 0))
      ? {
          season: seasonNumber,
          status: 'open' as const,
          incomingOffers: stagedOffers,
          outgoingTargets: stagedTargets,
          freeAgentUuids: freeAgentPoolSnapshot,
          signedFromPool: [],
        }
      : null,
    coachCandidatePool,
    coachRetirementHistory,
    nextCoachIdCounter,
    nextPlayerUuidCounter,
    teamFinances,
    /** B2 — four drifting operating axes per club. Absent on pre-B2 saves. */
    clubDoctrines,
    /** B3 — per-club academy level. Absent on pre-B3 saves. */
    academyLevels,
    /** League-wide arms-race and talent-era indices. Absent on older saves. */
    leagueClimate,
    activeEvents: [],
    newsLog: [...world.newsLog, ...news],
    rngState: rng.getState(),
  };

  return updatedWorld;
}
