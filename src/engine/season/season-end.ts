import { SeasonState } from '../../types/season';
import { SeasonRecord } from '../../types/team';
import { CoachBase } from '../../types/coach';
import { StandingEntry } from '../../types/league';
import { CupFixture, CupRound } from '../../types/cup';
import { PlayerSeasonStats } from '../../types/player';
import { SeededRNG } from '../match/rng';
import { applySeasonEndReset } from '../state-updater';
import { createHonorRecord, generateTeamTrophies } from '../honors/honors';
import { checkAchievements } from '../achievements';
import { selectWorldCupParticipants, initWorldCup } from '../cups/world-cup';
import { getAllTeamIds, createNewsId, cnRoundLabel } from './helpers';
import { GameWorld, NewsItem } from './season-manager';
import { appendWorldCupWindows } from './calendar-builder';
import { processCoachFiring } from '../coaches/coach-hiring';
import { getTeamCoachId } from '../coaches/coach-lookup';
import { computeSeasonAwards, AWARD_META } from '../awards/season-awards';
import { processTransferWindow } from '../transfers/transfer-window';
import { processRetirements } from '../players/retirement';
import { syncPlayerStatsTeamIds } from '../players/stats';
import { processCoachRetirements, COACH_RETIREMENT_HISTORY_CAP } from '../coaches/coach-retirement';
import { applyAnnualRevaluation } from '../economy/market-value';
import {
  applyIncome as applyFinanceIncome,
  applyExpense as applyFinanceExpense,
  attemptFireSale,
  archiveSeasonFinance,
  initTeamFinances,
  leaguePrize,
  CUP_PRIZE,
  TV_SPONSOR_BY_TIER,
  computeSalary,
  formatMoney,
  attributeCupPrizes,
  LEAGUE_CUP_TIERS,
  SUPER_CUP_TIERS,
  WORLD_CUP_TIERS,
  MAINLAND_CUP_TIERS,
  SMALL_CONTINENTAL_CUP_TIERS,
} from '../economy/finance';

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
export function handleSeasonEnd(world: GameWorld, options?: { favoriteTeamIds?: string[] }): GameWorld {
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
  let squads = world.squads;
  // ── A2 retirement / coach-pool locals (introduced in v11) ──
  // Initialised to (defensive) empty arrays so legacy worlds that haven't yet
  // been touched by the v10 → v11 migration don't blow up here. The migration
  // backfills them; this is a belt-and-suspenders for in-memory worlds built
  // by tests.
  let retirementHistory = world.retirementHistory ?? [];
  let freeAgentPool = world.freeAgentPool ?? [];
  let coachCandidatePool = world.coachCandidatePool ?? [];
  let nextPlayerUuidCounter = world.nextPlayerUuidCounter ?? 0;
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
  const financeBreakdown: Record<string, {
    prizeMoney: number;
    tvSponsor: number;
    transferIncome: number;
    salaries: number;
    transferExpense: number;
  }> = {};
  for (const tid of Object.keys(teamFinances)) {
    financeBreakdown[tid] = {
      prizeMoney: 0, tvSponsor: 0, transferIncome: 0, salaries: 0, transferExpense: 0,
    };
  }

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
  const honor = createHonorRecord(
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
  );
  const honorHistory = [...world.honorHistory, honor];

  // Generate trophies for all teams
  const teamTrophies = { ...world.teamTrophies };
  const coachTrophies = { ...world.coachTrophies };
  for (const teamId of getAllTeamIds(teamStates)) {
    const teamState = teamStates[teamId];
    const trophies = generateTeamTrophies(
      teamId,
      seasonNumber,
      league1Champion,
      league2Champion,
      league3Champion,
      leagueCupWinner,
      superCupWinner,
      worldCupWinner,
      teamState.leagueLevel,
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
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[league1Champion]?.name} 夺得顶级联赛冠军!`,
      description: `${world.teamBases[league1Champion]?.name} 加冕顶级联赛冠军，以${world.league1Standings[0]?.points}分的成绩登顶。`,
    });
  }
  if (league2Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-l2'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[league2Champion]?.name} 夺得甲级联赛冠军!`,
      description: `${world.teamBases[league2Champion]?.name} 以${world.league2Standings[0]?.points}分荣膺甲级联赛冠军。`,
    });
  }
  if (leagueCupWinner) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-lc'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[leagueCupWinner]?.name} 夺得联赛杯冠军!`,
      description: `${world.teamBases[leagueCupWinner]?.name} 捧得联赛杯冠军奖杯。`,
    });
  }
  if (superCupWinner) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-sc'),
      seasonNumber, windowIndex, type: 'trophy',
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
      seasonNumber, windowIndex, type: 'trophy',
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
        seasonNumber, windowIndex, type: 'trophy',
        title: `${ruName} ${cup.name}决赛失利`,
        description: `${ruName} 在${cup.name}决赛中以 ${finalFix.homeTeamId === runnerUp ? homeScore : awayScore}-${finalFix.homeTeamId === runnerUp ? awayScore : homeScore} 不敌 ${winnerName}，屈居亚军。`,
      });
    }
  }

  // ── Multi-crown detection ──
  const allWinners = [league1Champion, leagueCupWinner, superCupWinner, worldCupWinner].filter(Boolean);
  const crownCounts = new Map<string, number>();
  for (const w of allWinners) { if (w) crownCounts.set(w, (crownCounts.get(w) ?? 0) + 1); }
  for (const [teamId, count] of crownCounts) {
    if (count >= 4) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `四冠王！${world.teamBases[teamId]?.name} 包揽所有冠军！`,
        description: `${world.teamBases[teamId]?.name}创造历史，在一个赛季内夺得全部冠军头衔！`,
      });
    } else if (count >= 3) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `三冠王！${world.teamBases[teamId]?.name} 创造伟业！`,
        description: `${world.teamBases[teamId]?.name}一个赛季夺得三座冠军奖杯，成就三冠王荣耀！`,
      });
    } else if (count >= 2) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
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

  // Top scorer — read from LOCAL playerStats (still equals world.playerStats
  // at this point, but we use the local for consistency with the patch convention).
  const allPlayerStats = Object.values(playerStats);
  const topScorer = allPlayerStats.reduce<PlayerSeasonStats | null>(
    (best, s) => (s.goals > (best?.goals ?? 0) ? s : best),
    null,
  );
  if (topScorer && topScorer.goals > 0) {
    const teamName = world.teamBases[topScorer.teamId]?.name ?? topScorer.teamId;
    // topScorer.playerId holds a uuid; locate the player by walking the
    // owner's squad. Fall back to a generic "##号" label only if the player
    // isn't found (e.g. a stale stat after a same-season club fold).
    const scorerPlayer = squads[topScorer.teamId]?.find(p => p.uuid === topScorer.playerId);
    const playerName = scorerPlayer?.name
      ?? (scorerPlayer ? `${scorerPlayer.number}号` : '射手王');
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'scorer'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `赛季射手王: ${teamName} ${playerName} (${topScorer.goals}球)`,
      description: `${teamName}的${playerName}以${topScorer.goals}粒进球荣获本赛季射手王。`,
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
  // Reads from `world.squads` directly (still equals the local `squads`
  // here). Writes to LOCAL `squads`, `retirementHistory`, `coachCandidatePool`,
  // `nextPlayerUuidCounter` — never to `world.X`.
  const retirementResult = processRetirements(world, rng);
  if (retirementResult.retirements.length > 0) {
    squads = retirementResult.squads;
    nextPlayerUuidCounter = retirementResult.nextPlayerUuidCounter;
    // FIFO with cap — keep the last RETIREMENT_HISTORY_CAP entries.
    const merged = [...retirementHistory, ...retirementResult.retirements];
    retirementHistory = merged.length > 300 ? merged.slice(-300) : merged;
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
    // Build a uuid → player lookup from the PRE-retirement world so we can
    // detect the "forced by long injury" case via injuryHistory.
    const preRetirePlayerLookup = new Map<string, import('../../types/player').Player>();
    for (const sq of Object.values(world.squads)) {
      if (!Array.isArray(sq)) continue;
      for (const p of sq) preRetirePlayerLookup.set(p.uuid, p);
    }
    for (const r of retirementResult.retirements) {
      if (r.peakRating < 80) continue;
      const yearsSnap = Math.max(1, r.age - 18); // rough career length estimate
      const posCN = positionLabel[r.position];
      const trophyCount = r.careerTrophies?.length ?? 0;
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

      const baseDesc = `${r.teamName} ${posCN} ${r.name}（${r.age} 岁）结束 ${yearsSnap} 年职业生涯，留下 ${r.careerGoals} 球的纪录`;
      const description = trophyCount > 0
        ? `${baseDesc}，并捧起 ${trophyCount} 座冠军奖杯。`
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
    { ...world, coachCandidatePool, nextCoachIdCounter },
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
          description: `传奇球员 ${hire.coach.name} 接手 ${teamName}，开启教练生涯。`,
        });
      } else {
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `coach-hire-fresh-${hire.coach.id}`),
          seasonNumber, windowIndex, type: 'coach_hired',
          title: `${teamName} 任命新帅 ${hire.coach.name}`,
          description: `${teamName} 完成与新教练 ${hire.coach.name} 的签约。`,
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
    // Compute per-team breakdown so the archive pass knows what came from
    // where. We mirror the logic in applyIncome here so the breakdown
    // stays in sync; refactoring applyIncome to return a breakdown is
    // possible but the duplication is ~15 lines so we keep them paired.
    for (const teamId of getAllTeamIds(teamStates)) {
      const standingsByLevel: Record<1 | 2 | 3, StandingEntry[]> = {
        1: world.league1Standings,
        2: world.league2Standings,
        3: world.league3Standings,
      };
      let lv: 1 | 2 | 3 = teamStates[teamId].leagueLevel;
      let rank = 99;
      for (const [lvStr, st] of Object.entries(standingsByLevel)) {
        const idx = st.findIndex(s => s.teamId === teamId && s.played > 0);
        if (idx >= 0) {
          lv = parseInt(lvStr) as 1 | 2 | 3;
          rank = idx + 1;
          break;
        }
      }
      const tv = TV_SPONSOR_BY_TIER[lv];
      const prize = leaguePrize(lv, rank);
      financeBreakdown[teamId].tvSponsor += tv;
      financeBreakdown[teamId].prizeMoney += prize;
    }
    // Cup prizes — tiered (mirrors applyIncome via shared helper).
    if (world.leagueCup?.rounds && world.leagueCup.rounds.length > 0) {
      const prizes = attributeCupPrizes(world.leagueCup.rounds, LEAGUE_CUP_TIERS);
      for (const [teamId, amt] of Object.entries(prizes)) {
        if (financeBreakdown[teamId]) financeBreakdown[teamId].prizeMoney += amt;
      }
    }
    if (world.superCup?.knockoutRounds && world.superCup.knockoutRounds.length > 0) {
      const prizes = attributeCupPrizes(world.superCup.knockoutRounds, SUPER_CUP_TIERS);
      for (const [teamId, amt] of Object.entries(prizes)) {
        if (financeBreakdown[teamId]) financeBreakdown[teamId].prizeMoney += amt;
      }
    }
    // World cup prize money (winner / runner-up / quarters / R16) is booked by
    // finalizeWorldCup AFTER the WC tail plays — see season-end.ts.
    // At this point in the pipeline (season_end window), the WC final
    // hasn't happened yet; reading world.worldCup.winnerId here gives
    // undefined every time, which is why this used to silently lose
    // prize money every WC year.
    // Continental cups — region-aware tier (mainland 16-team, others 8-team)
    const continentalConfigs: Array<[typeof continentalCups.mainland_cup, typeof LEAGUE_CUP_TIERS]> = [
      [continentalCups.mainland_cup, MAINLAND_CUP_TIERS],
      [continentalCups.southern_cup, SMALL_CONTINENTAL_CUP_TIERS],
      [continentalCups.eastern_cup, SMALL_CONTINENTAL_CUP_TIERS],
    ];
    for (const [cup, tier] of continentalConfigs) {
      if (!cup?.completed || !cup.rounds || cup.rounds.length === 0) continue;
      const prizes = attributeCupPrizes(cup.rounds, tier);
      for (const [teamId, amt] of Object.entries(prizes)) {
        if (financeBreakdown[teamId]) financeBreakdown[teamId].prizeMoney += amt;
      }
    }
    // Now apply via the canonical implementation — modifies cash + totalIncome.
    const incomeResult = applyFinanceIncome(teamFinances, world, seasonNumber);
    teamFinances = incomeResult.teamFinances;
    news.push(...incomeResult.news);
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
  const transferResult = processTransferWindow({ ...world, squads, playerStats, freeAgentPool }, rng, { favoriteTeamIds: favoriteSet });
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
      retirementHistory = merged.length > 300 ? merged.slice(-300) : merged;
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
    const topTransfers = transferResult.transfers
      .filter((t) => t.type === 'transfer')
      .slice(0, 3);
    for (const t of topTransfers) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `transfer-${t.playerId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `🔄 转会: ${t.playerName} 加盟 ${t.toTeamName}`,
        description: `${t.playerName}从${t.fromTeamName}转会至${t.toTeamName}${t.fee ? `，转会费约€${t.fee}M` : ''}。${t.reason}。`,
      });
    }
    if (transferResult.transfers.filter((t) => t.type === 'transfer').length > 3) {
      const total = transferResult.transfers.filter((t) => t.type === 'transfer').length;
      news.push({
        id: createNewsId(seasonNumber, windowIndex, 'transfer-summary'),
        seasonNumber, windowIndex, type: 'trophy',
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
    // Compute breakdown for archive using the same formula applyExpense uses
    // (otherwise the FinancePanel salary number diverges from the actual
    // cash deduction — a sneaky UI lie that bit us in v1).
    for (const [teamId, squad] of Object.entries(squads)) {
      const squadValue = (squad ?? []).reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
      const salaries = computeSalary(squadValue, teamLevels[teamId] ?? 1);
      financeBreakdown[teamId] = financeBreakdown[teamId] ?? {
        prizeMoney: 0, tvSponsor: 0, transferIncome: 0, salaries: 0, transferExpense: 0,
      };
      financeBreakdown[teamId].salaries += salaries;
    }
    // Apply via canonical implementation
    const expenseResult = applyFinanceExpense(teamFinances, squads, teamLevels);
    teamFinances = expenseResult.teamFinances;
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


  // ── Annual market value revaluation ──────────────────────────
  // Mutates squad in place (also bumps each player's age). Pass the LOCAL
  // squads/playerStats — when transfers happened, these are fresh records;
  // when they didn't, they reference the same Player objects as world.squads
  // and the in-place mutation persists into the new world via the spread.
  applyAnnualRevaluation(
    squads,
    playerStats,
    new Set(actualPromoted.map((p) => p.teamId)),
    league1Champion || null,
    world.totalElapsedWindows ?? 0,
  );

  // Promoted teams
  for (const p of actualPromoted) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `promo-${p.teamId}`),
      seasonNumber, windowIndex, type: 'promotion',
      title: `${world.teamBases[p.teamId]?.name} 升级成功!`,
      description: `${world.teamBases[p.teamId]?.name} 从${p.from}级联赛升入${p.to}级联赛。`,
    });
  }

  // Relegated teams
  for (const r of actualRelegated) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `releg-${r.teamId}`),
      seasonNumber, windowIndex, type: 'relegation',
      title: `${world.teamBases[r.teamId]?.name} 不幸降级`,
      description: `${world.teamBases[r.teamId]?.name} 从${r.from}级联赛降入${r.to}级联赛。`,
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

    // World cup
    if (world.worldCup) {
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
          } else if (world.worldCup.completed) {
            const inAnyKO = world.worldCup.knockoutRounds.some(r =>
              r.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId),
            );
            worldCupResult = inAnyKO ? '参赛中' : '小组赛淘汰';
          } else {
            worldCupResult = '参赛中';
          }
        }
      }
    }

    // Continental cup result — pick the cup matching this team's continent.
    // If no cup ran for the team's region this season, leave undefined so
    // the UI shows '—' / '未参加'. If the team is from a region with a cup
    // but didn't qualify for the top-N selection, mark them as 未参加.
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
          // Was this team in the bracket at all?
          const wasInBracket = cup.rounds.some(r =>
            r.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId),
          );
          if (!wasInBracket) {
            continentalCupResult = '未参加';
          } else {
            // Final loser?
            const finalRound = cup.rounds.at(-1);
            const finalFix = finalRound?.fixtures[0];
            const inFinal = finalFix && (finalFix.homeTeamId === teamId || finalFix.awayTeamId === teamId);
            if (inFinal && finalRound?.completed && cup.winnerId && teamId !== cup.winnerId) {
              continentalCupResult = '亚军';
            } else {
              const elimRound = findTeamEliminationRound(cup.rounds, teamId);
              if (elimRound) {
                continentalCupResult = cnRoundLabel(elimRound);
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
      // Coach is derived from LOCAL coachStates so any earlier season-end
      // logic that swapped the coach for this team is reflected here.
      coachId: getTeamCoachId(coachStates, teamId) ?? '',
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
    const newCoachName = coachBases[firingResult.newCoachId]?.name ?? firingResult.newCoachId;
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `retire-${coachId}`),
      seasonNumber, windowIndex, type: 'coach_fired',
      title: `${coachName} 功成身退，告别${world.teamBases[teamId]?.name}`,
      description: `${coachName}在率队夺冠后选择急流勇退，留下一段传奇执教生涯。${newCoachName}将接过教鞭。`,
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
          seasonNumber, windowIndex, type: 'trophy',
          title: `成就解锁: ${a.title}`,
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
  const teamBases = { ...world.teamBases };
  for (const teamId of getAllTeamIds(teamStates)) {
    const base = { ...teamBases[teamId] };
    const state = teamStates[teamId];
    const originalOvr = base.overall;

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
    if (ratio <= 0.15) {
      base.overall = Math.min(97, base.overall + rng.nextInt(1, 2));
    } else if (ratio <= 0.35) {
      base.overall = Math.min(97, base.overall + rng.nextInt(0, 1));
    } else if (ratio >= 0.85) {
      const declineMax = base.overall > 60 ? 2 : 1;
      base.overall = Math.max(38, base.overall - rng.nextInt(1, declineMax));
    } else if (ratio >= 0.7) {
      if (base.overall > 50) {
        base.overall = Math.max(38, base.overall - rng.nextInt(0, 1));
      }
    }

    // ── Natural aging: only the very top, and probabilistic ──
    if (base.overall >= 93 && rng.next() < 0.5) {
      base.overall = base.overall - 1;
    }

    // ── Floor uplift: weakest teams always improve a little ──
    if (base.overall <= 45) {
      base.overall = base.overall + 1;
    }

    // ── Mean reversion: gentle pull, skip teams that just won ──
    const leagueMean = 65;
    const distFromMean = base.overall - leagueMean;
    if (Math.abs(distFromMean) > 20 && ratio > 0.15) {
      const pullChance = Math.min(0.4, Math.abs(distFromMean) / 120);
      if (rng.next() < pullChance) {
        base.overall += distFromMean > 0 ? -1 : 1;
      }
    }

    // Clamp overall — top 3 teams have a higher floor (dynasty DNA)
    const PROTECTED_TEAMS = ['gz_hengda', 'shimazu', 'xibei_wolf'];
    const floor = PROTECTED_TEAMS.includes(teamId) ? 82 : 38;
    base.overall = Math.max(floor, Math.min(97, base.overall));

    // ── Proportional attribute sync ──
    const ovrDelta = base.overall - originalOvr;
    if (ovrDelta !== 0) {
      const sign = ovrDelta > 0 ? 1 : -1;
      const mag = Math.abs(ovrDelta);
      base.attack = Math.max(35, Math.min(96, base.attack + sign * rng.nextInt(0, mag)));
      base.midfield = Math.max(35, Math.min(96, base.midfield + sign * rng.nextInt(0, Math.max(1, mag - 1))));
      base.defense = Math.max(35, Math.min(96, base.defense + sign * rng.nextInt(0, Math.max(1, mag - 1))));
      base.stability = Math.max(35, Math.min(96, base.stability + sign * rng.nextInt(0, 1)));
      base.depth = Math.max(30, Math.min(96, base.depth + sign * rng.nextInt(0, mag)));
    }

    // ── Promoted teams get a boost ──
    const startLevel = (world.seasonStartLevels ?? {})[teamId] ?? base.initialLeagueLevel;
    if (state.leagueLevel < startLevel) {
      const promoBoost = rng.nextInt(3, 5);
      base.overall = Math.min(97, base.overall + promoBoost);
      base.depth = Math.min(97, base.depth + rng.nextInt(2, 4));
      base.attack = Math.min(97, base.attack + rng.nextInt(1, 3));
      base.midfield = Math.min(97, base.midfield + rng.nextInt(1, 2));
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `boost-${teamId}`),
        seasonNumber, windowIndex, type: 'match_result',
        title: `${base.name} 升级后大力引援`,
        description: `${base.name}升级后获得大量投资，整体实力提升${promoBoost}点。`,
      });
    }
    // Relegated teams decline
    if (state.leagueLevel > startLevel) {
      base.overall = Math.max(38, base.overall - rng.nextInt(1, 2));
      base.depth = Math.max(30, base.depth - rng.nextInt(1, 2));
    }

    // Strong teams have a chance of "internal turmoil"
    if (base.overall >= 87 && rng.next() < 0.10) {
      const drop = rng.nextInt(2, 4);
      base.overall = Math.max(70, base.overall - drop);
      base.attack = Math.max(60, base.attack - rng.nextInt(1, 2));
      base.stability = Math.max(50, base.stability - rng.nextInt(1, 3));
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `turmoil-${teamId}`),
        seasonNumber, windowIndex, type: 'coach_fired',
        title: `${base.name} 遭遇内部动荡`,
        description: `${base.name}核心球员出走，更衣室出现裂痕，实力下降${drop}点。`,
      });
    }

    // Underperformance bonus
    const expectedPos = Math.round(total * (1 - (base.expectation - 1) / 4));
    if (position < expectedPos - 3 && ratio <= 0.4) {
      const surpriseBoost = rng.nextInt(1, 3);
      base.overall = Math.min(97, base.overall + surpriseBoost);
      base.reputation = Math.min(99, base.reputation + rng.nextInt(2, 5));
    }

    teamBases[teamId] = base;
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
    achievements,
    prediction,
    predictionHistory,
    squads,
    playerStats,
    playerAwardsHistory,
    transferHistory,
    retirementHistory,
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
    activeEvents: [],
    newsLog: [...world.newsLog, ...news],
    rngState: rng.getState(),
  };

  // Check for world cup year — caller handles the transition
  if (seasonState.isWorldCupYear) {
    return initializeWorldCup(updatedWorld);
  }

  return updatedWorld;
}

/**
 * Initialize the world cup phase after a world cup year season ends.
 */
export function initializeWorldCup(world: GameWorld): GameWorld {
  const seasonNumber = world.seasonState.seasonNumber;
  const rng = new SeededRNG(world.rngState);

  // Select participants: all 32 teams
  const allTeamIds = getAllTeamIds(world.teamStates);
  const teamOveralls: Record<string, number> = {};
  for (const id of allTeamIds) {
    teamOveralls[id] = world.teamBases[id]?.overall ?? 0;
  }
  const participants = selectWorldCupParticipants(allTeamIds, teamOveralls);

  // Initialize world cup
  const worldCup = initWorldCup(participants, seasonNumber, rng);

  // Get group fixtures for all 6 rounds
  const groupRoundFixtures: CupFixture[][] = [];
  for (let r = 1; r <= 6; r++) {
    const roundFixtures: CupFixture[] = [];
    for (const group of worldCup.groups) {
      for (const fixture of group.fixtures) {
        if (fixture.round === r) {
          roundFixtures.push(fixture);
        }
      }
    }
    groupRoundFixtures.push(roundFixtures);
  }

  // Append world cup windows to the calendar
  const calendar = appendWorldCupWindows(
    world.seasonState.calendar,
    seasonNumber,
    groupRoundFixtures,
  );

  // Update season state to continue into world cup phase
  const seasonState: SeasonState = {
    ...world.seasonState,
    calendar,
    completed: false,
    worldCupPhase: true,
    // Reset current window to the first world cup window
    currentWindowIndex: world.seasonState.calendar.length, // starts at first new window
  };

  // WC draw news
  const wcGroupInfo = worldCup.groups.map(g =>
    `${g.groupName}组: ${g.teamIds.map(id => world.teamBases[id]?.name?.slice(0, 3) ?? id).join('/')}`
  ).join(' | ');
  const wcDrawNews: NewsItem = {
    id: `draw-wc-S${seasonNumber}`,
    seasonNumber, windowIndex: world.seasonState.calendar.length, type: 'trophy',
    title: `环球冠军杯抽签揭晓 — 32队8组`,
    description: wcGroupInfo,
  };

  return {
    ...world,
    seasonState,
    worldCup,
    newsLog: [...world.newsLog, wcDrawNews],
    rngState: rng.getState(),
  };
}

/**
 * Finalize the world cup phase: patch honors, trophies, records with WC results,
 * then initialize the next season.
 */
export function finalizeWorldCup(world: GameWorld): GameWorld {
  let updatedWorld = { ...world };

  const wcWinnerId = updatedWorld.worldCup?.winnerId;
  if (wcWinnerId) {
    const sn = updatedWorld.seasonState.seasonNumber;
    const honorHistory = [...updatedWorld.honorHistory];
    const lastHonor = honorHistory[honorHistory.length - 1];

    // Determine WC runner-up
    const wcFinal = updatedWorld.worldCup!.knockoutRounds.at(-1)?.fixtures[0];
    const wcRunnerUp = wcFinal
      ? (wcFinal.homeTeamId === wcWinnerId ? wcFinal.awayTeamId : wcFinal.homeTeamId)
      : undefined;

    if (lastHonor && lastHonor.seasonNumber === sn && !lastHonor.worldCupWinner) {
      honorHistory[honorHistory.length - 1] = {
        ...lastHonor,
        worldCupWinner: wcWinnerId,
      };
    }

    // Add WC trophy to winner
    const teamTrophies = { ...updatedWorld.teamTrophies };
    teamTrophies[wcWinnerId] = [...(teamTrophies[wcWinnerId] ?? []), { type: 'world_cup' as const, seasonNumber: sn }];

    // Add to coach trophies — derive coach for the WC winner from coachStates.
    const coachTrophies = { ...updatedWorld.coachTrophies };
    const winnerCoachId = getTeamCoachId(updatedWorld.coachStates, wcWinnerId);
    if (winnerCoachId) {
      coachTrophies[winnerCoachId] = [...(coachTrophies[winnerCoachId] ?? []), { type: 'world_cup' as const, seasonNumber: sn }];
    }

    // Patch team season records with WC results.
    // This runs AFTER the WC final, so we can give every team an exact
    // round label (16强 / 八强 / 四强 / 决赛 / 小组赛淘汰) — matching the
    // detail level we give super cup / league cup in handleSeasonEnd.
    const teamSeasonRecords = { ...updatedWorld.teamSeasonRecords };
    for (const teamId of getAllTeamIds(updatedWorld.teamStates)) {
      const recs = teamSeasonRecords[teamId];
      if (!recs || recs.length === 0) continue;
      const lastRec = recs[recs.length - 1];
      if (lastRec.seasonNumber !== sn) continue;
      let wcResult = '';
      if (teamId === wcWinnerId) {
        wcResult = '冠军';
      } else if (teamId === wcRunnerUp) {
        wcResult = '亚军';
      } else if (updatedWorld.worldCup!.participantIds?.includes(teamId)) {
        const elimRound = findTeamEliminationRound(updatedWorld.worldCup!.knockoutRounds, teamId);
        if (elimRound) {
          wcResult = cnRoundLabel(elimRound);
        } else {
          // Was a participant but never appeared in any knockout round
          // → eliminated in group stage
          const inAnyKO = updatedWorld.worldCup!.knockoutRounds.some(r =>
            r.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId),
          );
          wcResult = inAnyKO ? '参赛' : '小组赛淘汰';
        }
      }
      if (wcResult) {
        const updated = [...recs];
        updated[updated.length - 1] = { ...lastRec, worldCupResult: wcResult };
        teamSeasonRecords[teamId] = updated;
      }
    }

    updatedWorld = { ...updatedWorld, honorHistory, teamTrophies, coachTrophies, teamSeasonRecords };

    // ── Phase H: WC prize money (winner / runner-up / semis / quarters / R16) ──
    // This was originally in applyIncome (handleSeasonEnd), but at that
    // point in WC years the WC tail hadn't run yet — winnerId was always
    // unset, so prize money silently disappeared every WC year. Pay it
    // here instead, AFTER the final has resolved.
    //
    // Tiered: every team that advanced past groups earns at least the
    // R16 prize; quarter-finalists earn QF; semi-finalists earn SF;
    // runner-up + winner earn the big bucks.
    //
    // The season's FinanceSeasonRecord was archived seconds ago in
    // handleSeasonEnd. We patch its tail entry in-place so the breakdown
    // (and the FinancePanel which reads from history) shows the WC prize.
    const wcPrizes = attributeCupPrizes(updatedWorld.worldCup!.knockoutRounds, WORLD_CUP_TIERS);
    const teamFinances = { ...updatedWorld.teamFinances };
    const newsLog = [...updatedWorld.newsLog];
    const windowIndex = updatedWorld.seasonState.currentWindowIndex;
    // Sort recipients by amount desc so the news log surfaces winner first
    const recipients = Object.entries(wcPrizes).sort((a, b) => b[1] - a[1]);
    for (const [teamId, amount] of recipients) {
      const fin = teamFinances[teamId];
      if (!fin || amount <= 0) continue;
      // Patch tail history entry (the season we just archived) so prize
      // money is visible in the breakdown. If the tail isn't this season
      // (defensive — shouldn't happen), skip the patch and just bump cash.
      const history = [...fin.history];
      const tail = history[history.length - 1];
      if (tail && tail.season === sn) {
        history[history.length - 1] = {
          ...tail,
          prizeMoney: tail.prizeMoney + amount,
          endCash: tail.endCash + amount,
        };
      }
      teamFinances[teamId] = {
        ...fin,
        cash: fin.cash + amount,
        history,
      };
      // Determine role label by amount (winner/RU/SF/QF/R16)
      let role = '参赛';
      if (teamId === wcWinnerId) role = '冠军';
      else if (teamId === wcRunnerUp) role = '亚军';
      else if (amount >= CUP_PRIZE.world_cup_semi) role = '四强';
      else if (amount >= CUP_PRIZE.world_cup_qf) role = '八强';
      else if (amount >= CUP_PRIZE.world_cup_r16) role = '16强';
      const teamName = updatedWorld.teamBases[teamId]?.name ?? teamId;
      newsLog.push({
        id: createNewsId(sn, windowIndex, `wc-prize-${teamId}`),
        seasonNumber: sn,
        windowIndex,
        type: 'prize_money',
        title: `${teamName} 环球冠军杯${role}奖金 ${formatMoney(amount)}`,
        description: `${teamName} 在第${sn}届环球冠军杯打入${role}，收获 ${formatMoney(amount)} 奖金。`,
      });
    }
    updatedWorld = { ...updatedWorld, teamFinances, newsLog };
  }

  return updatedWorld;
}
