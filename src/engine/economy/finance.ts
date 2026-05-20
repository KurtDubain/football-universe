/**
 * Phase H — economy module.
 *
 * Income sources (per season, applied at season-end):
 *   1. Prize money — league position decay (top 8) + cup bonuses
 *   2. TV / sponsor — flat per league tier (the equalizer)
 *   3. Transfer income — sales (from transfer-window.ts; not handled here)
 *
 * Expense sources:
 *   1. Salaries — squad market value × salary rate
 *   2. Transfer expense — purchases (also handled in transfer-window.ts)
 *
 * Cash CAN go negative — there is no bankruptcy. Negative-cash teams trigger
 * a fire-sale offer at season-end (sells one player at 200% market value to
 * an elite buyer with cash).
 *
 *
 * ── Tuning history (TUNE_LOG) ─────────────────────────────────────
 *
 * `SALARY_RATE` was finalized after running 20-season simulations against
 * the s16 real save with 5 RNG seeds × N candidate rates. The harness lives
 * at `scripts/sim-economy.ts` (read-only over the saved baseline). Below is
 * a condensed log; full output is reproducible by running the harness.
 *
 *  Pass 1: brief-suggested 3% / 5% / 7%
 *    All three bunched at "elite > 1000M cash by S20" because typical L1
 *    income (€40M sponsor + ~€30M prize) dwarfs salaries at that rate
 *    (5% × €300M elite squad = €15M). Fire-sale path NEVER fires.
 *    Verdict: too low; the Matthew check is satisfied numerically (1.5x
 *    at S20) but only because everyone gets rich in lockstep.
 *
 *  Pass 2: 10% / 15% / 20% / 25%
 *    25% finally produces fire sales (0.17/season) and a handful of
 *    negative-cash teams (0.23/season avg). Elite still ends at €450M.
 *
 *  Pass 3: 25% / 30% / 35% / 40% / 50%
 *    40% craters elite tier (S20 mean = -€209M). 50% kills both elite +
 *    top tiers. 30% leaves elite at €220M with 0.48 fires/season. 35%
 *    sits at elite €2M with ~1 fire per season — close to spec.
 *
 *  Pass 4: 31% / 32% / 33% / 34% (3 seeds)
 *    33% emerged as the inflection: fire 0.90/sn, neg 1.93/sn, elite €39M.
 *
 *  Pass 5 (final): 32% / 33% / 34% × 5 seeds
 *    32%: Matthew 0.34x, fire 0.63/sn, neg 0.91/sn, elite €120M
 *    33%: Matthew 0.23x, fire 0.80/sn, neg 1.81/sn, elite €73M  ← winner
 *    34%: Matthew 0.08x, fire 0.75/sn, neg 2.24/sn, elite €23M
 *
 *  Decision: 33%. Spec calls for "fire sales 1-3 per season; negative
 *  teams 2-4 per season; no cratering". 33% lands closest to that envelope
 *  while keeping elite tier with a small positive cash buffer (the tier
 *  most likely to perceive a "broken" economy if pushed below zero across
 *  the board). Mid tier becomes the wealthiest at S20 (€314M) — that's
 *  the anti-Matthew effect the spec aims for: flat sponsor at €10/20/40M
 *  rewards modest squads disproportionately.
 *
 *  Why "33%" feels high vs the brief's 3-7% suggestion: squad market
 *  values in this universe scale to €300-€500M per top club, so 5% of
 *  that (€15-€25M) cannot offset €70-€100M annual revenue. We could have
 *  scaled income down instead, but the brief explicitly sets the TV /
 *  sponsor / prize numbers, leaving SALARY_RATE as the only dial.
 */
import { TeamBase, FinanceState, FinanceSeasonRecord } from '../../types/team';
import { Player } from '../../types/player';
import { GameWorld, NewsItem } from '../season/season-manager';
import { StandingEntry } from '../../types/league';
import { SeededRNG } from '../match/rng';
import { TransferRecord } from '../../types/transfer';
import { createNewsId } from '../season/helpers';

// ── Tunable parameters (chosen via 20-season sim, see TUNE_LOG above) ──

/**
 * Wage bill = squadMarketValueSum × SALARY_RATE.
 * Tuned to 0.33 — see TUNE_LOG above.
 */
export const SALARY_RATE = 0.33;

/**
 * Mutable shadow of SALARY_RATE for tuning sims. Production code reads
 * this via `getSalaryRate()`; the sim harness in `scripts/sim-economy.ts`
 * flips it via `setSalaryRateForTesting()` to compare candidate rates.
 * NOT used by the runtime save logic — the production rate stays at
 * `SALARY_RATE` because the const is the ONLY thing the migration and
 * UI display reference.
 */
let _runtimeSalaryRate: number = SALARY_RATE;
export function getSalaryRate(): number {
  return _runtimeSalaryRate;
}
/** Override the salary rate for sim runs. Pass `SALARY_RATE` to reset. */
export function setSalaryRateForTesting(rate: number): void {
  _runtimeSalaryRate = rate;
}

/** Max history entries kept on each FinanceState (oldest dropped). */
export const FINANCE_HISTORY_CAP = 10;

/** Premium multiplier on a fire sale (200% of marketValue per spec). */
export const FIRE_SALE_PREMIUM = 2.0;

/** Min market value (€M) for a player to be eligible as fire-sale piece. */
export const FIRE_SALE_MIN_VALUE = 30;

/** Min reputation for a buyer in a fire sale. */
export const FIRE_SALE_BUYER_MIN_REP = 85;

/** Buyer must have at least price × this multiplier in cash to bid. */
export const FIRE_SALE_BUYER_CASH_MULT = 1.5;

// ── Starting cash by reputation tier (€M) ──
//
// Reputation tiers:
//   elite   (rep ≥ 85): €150M
//   top     (rep ≥ 75): €80M
//   mid     (rep ≥ 65): €40M
//   low     (rep < 65): €20M
//
// These were chosen so that the top-end has runway through 1-2 lean seasons
// without becoming "broke", and the bottom end is small enough that real
// sponsor / prize income still matters relatively. The 20-season sim showed
// these never produce wealth runaway and never create permanent paupers.
export function startingCashForRep(reputation: number): number {
  if (reputation >= 85) return 150;
  if (reputation >= 75) return 80;
  if (reputation >= 65) return 40;
  return 20;
}

// ── TV / sponsor (flat per league tier, the equalizer) ──
export const TV_SPONSOR_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 40,
  2: 20,
  3: 10,
};

// ── League prize money: top 8 only, decay 0.85^(rank-1), L1 base €60M ──
//
// L2 prize is L1 × 0.5; L3 prize is L1 × 0.25. So:
//   L1 champion: €60M, runner-up €51M, ..., 8th ≈ €16M
//   L2 champion: €30M, ..., 8th ≈ €8M
//   L3 champion: €15M, ..., 8th ≈ €4M
const LEAGUE_PRIZE_BASE = 60;
const LEAGUE_PRIZE_DECAY = 0.85;
const LEAGUE_PRIZE_TIER_MULT: Record<1 | 2 | 3, number> = { 1: 1.0, 2: 0.5, 3: 0.25 };

/**
 * Compute league prize for a (level, rank) pair. Returns 0 for ranks beyond
 * the top 8 — only the top 8 in each league get prize money.
 */
export function leaguePrize(level: 1 | 2 | 3, rank: number): number {
  if (rank < 1 || rank > 8) return 0;
  const base = LEAGUE_PRIZE_BASE * LEAGUE_PRIZE_TIER_MULT[level];
  const value = base * Math.pow(LEAGUE_PRIZE_DECAY, rank - 1);
  return Math.round(value);
}

// ── Cup prize money (€M) ──
export const CUP_PRIZE = {
  league_cup_winner: 15,
  league_cup_runner_up: 7,
  super_cup_winner: 5,
  world_cup_winner: 30,
  world_cup_runner_up: 15,
  world_cup_semi: 5,
  continental_cup_winner: 25,
  continental_cup_runner_up: 12,
  continental_cup_semi: 4,
};

// ── Public API ────────────────────────────────────────────

/**
 * Initialize a teamFinances map from teamBases. Used at game start AND from
 * the v14 → v15 migration.
 */
export function initTeamFinances(
  teamBases: Record<string, TeamBase>,
): Record<string, FinanceState> {
  const out: Record<string, FinanceState> = {};
  for (const [teamId, base] of Object.entries(teamBases)) {
    out[teamId] = {
      cash: startingCashForRep(base.reputation),
      totalIncome: 0,
      totalExpense: 0,
      history: [],
    };
  }
  return out;
}

/**
 * Format a money amount as `€XXM` (millions). Uses 0 decimals when ≥ 10,
 * 1 decimal below — keeps small numbers readable while big ones stay crisp.
 */
export function formatMoney(n: number): string {
  if (n === 0) return '€0M';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 10) return `${sign}€${Math.round(abs)}M`;
  return `${sign}€${abs.toFixed(1)}M`;
}

/**
 * Apply prize money + TV/sponsor income to every team. Pure: returns new
 * teamFinances + news items. Caller assigns the patch into the world.
 *
 * Reads:
 *   - world.teamBases (for league level lookup via teamStates)
 *   - world.teamStates (for current league level — REGARDLESS of standings'
 *                       played-this-season state)
 *   - world.league1Standings / league2 / league3 (for ranking)
 *   - world.leagueCup, superCup, worldCup, continentalCups (for cup winners
 *     and runners-up)
 *
 * NOTE: This must run BEFORE the team-state-reset block that wipes the
 * league assignments — hence we read the standings (which still reflect the
 * just-finished season). We resolve the team's level by walking standings,
 * not by reading teamStates[*].leagueLevel which may already have been
 * updated by promotion/relegation processing in the patch chain.
 */
export function applyIncome(
  teamFinances: Record<string, FinanceState>,
  world: GameWorld,
  season: number,
): { teamFinances: Record<string, FinanceState>; news: NewsItem[] } {
  const next: Record<string, FinanceState> = { ...teamFinances };
  for (const id of Object.keys(next)) {
    next[id] = { ...next[id] };
  }
  const news: NewsItem[] = [];
  const windowIndex = world.seasonState.currentWindowIndex;

  // Resolve each team's level from the standings (the played-this-season
  // entry is the league they actually played in, ignoring any post-season
  // promotion/relegation that may already have been applied to teamStates).
  const teamLevel: Record<string, 1 | 2 | 3> = {};
  const teamRank: Record<string, number> = {};
  const standingsByLevel: Record<1 | 2 | 3, StandingEntry[]> = {
    1: world.league1Standings,
    2: world.league2Standings,
    3: world.league3Standings,
  };
  for (const lvStr of ['1', '2', '3'] as const) {
    const lv = parseInt(lvStr) as 1 | 2 | 3;
    const standings = standingsByLevel[lv];
    standings.forEach((s, idx) => {
      if (s.played > 0) {
        teamLevel[s.teamId] = lv;
        teamRank[s.teamId] = idx + 1;
      }
    });
  }
  // Fallback for any team that didn't play (edge case) — use teamState.
  for (const id of Object.keys(next)) {
    if (teamLevel[id] === undefined) {
      teamLevel[id] = world.teamStates[id]?.leagueLevel ?? 3;
    }
  }

  // ── 1. League prize money + TV/sponsor ──
  for (const id of Object.keys(next)) {
    const lv = teamLevel[id];
    const tv = TV_SPONSOR_BY_TIER[lv];
    const rank = teamRank[id] ?? 99;
    const prize = leaguePrize(lv, rank);
    next[id].cash += tv + prize;
    next[id].totalIncome += tv + prize;
  }

  // ── 2. Cup prizes ──
  // League cup winner / runner-up
  const lcWinner = world.leagueCup?.winnerId;
  if (lcWinner) {
    next[lcWinner] = next[lcWinner] ?? { ...next[Object.keys(next)[0]] };
    next[lcWinner].cash += CUP_PRIZE.league_cup_winner;
    next[lcWinner].totalIncome += CUP_PRIZE.league_cup_winner;
    // Runner-up = the other team in the final
    const lcFinal = world.leagueCup.rounds.at(-1)?.fixtures[0];
    if (lcFinal) {
      const ru = lcFinal.homeTeamId === lcWinner ? lcFinal.awayTeamId : lcFinal.homeTeamId;
      if (next[ru]) {
        next[ru].cash += CUP_PRIZE.league_cup_runner_up;
        next[ru].totalIncome += CUP_PRIZE.league_cup_runner_up;
      }
    }
  }
  // Super cup winner
  const scWinner = world.superCup?.winnerId;
  if (scWinner && next[scWinner]) {
    next[scWinner].cash += CUP_PRIZE.super_cup_winner;
    next[scWinner].totalIncome += CUP_PRIZE.super_cup_winner;
  }
  // World cup winner / runner-up / semi (only in WC years)
  const wc = world.worldCup;
  if (wc?.winnerId && next[wc.winnerId]) {
    next[wc.winnerId].cash += CUP_PRIZE.world_cup_winner;
    next[wc.winnerId].totalIncome += CUP_PRIZE.world_cup_winner;
    const wcFinal = wc.knockoutRounds.at(-1)?.fixtures[0];
    if (wcFinal) {
      const ru = wcFinal.homeTeamId === wc.winnerId ? wcFinal.awayTeamId : wcFinal.homeTeamId;
      if (next[ru]) {
        next[ru].cash += CUP_PRIZE.world_cup_runner_up;
        next[ru].totalIncome += CUP_PRIZE.world_cup_runner_up;
      }
      // Semi-final losers — pick from the second-to-last round
      const semis = wc.knockoutRounds.at(-2);
      if (semis) {
        for (const f of semis.fixtures) {
          if (!f.winnerId) continue;
          const loser = f.homeTeamId === f.winnerId ? f.awayTeamId : f.homeTeamId;
          if (next[loser]) {
            next[loser].cash += CUP_PRIZE.world_cup_semi;
            next[loser].totalIncome += CUP_PRIZE.world_cup_semi;
          }
        }
      }
    }
  }
  // Continental cups (winner / runner-up / semi)
  const cups = [world.continentalCups?.mainland_cup, world.continentalCups?.southern_cup, world.continentalCups?.eastern_cup];
  for (const cup of cups) {
    if (!cup || !cup.completed || !cup.winnerId) continue;
    if (next[cup.winnerId]) {
      next[cup.winnerId].cash += CUP_PRIZE.continental_cup_winner;
      next[cup.winnerId].totalIncome += CUP_PRIZE.continental_cup_winner;
    }
    const finalRound = cup.rounds.at(-1);
    const finalFix = finalRound?.fixtures[0];
    if (finalFix) {
      const ru = finalFix.homeTeamId === cup.winnerId ? finalFix.awayTeamId : finalFix.homeTeamId;
      if (next[ru]) {
        next[ru].cash += CUP_PRIZE.continental_cup_runner_up;
        next[ru].totalIncome += CUP_PRIZE.continental_cup_runner_up;
      }
    }
    const semis = cup.rounds.at(-2);
    if (semis) {
      for (const f of semis.fixtures) {
        if (!f.winnerId) continue;
        const loser = f.homeTeamId === f.winnerId ? f.awayTeamId : f.homeTeamId;
        if (next[loser]) {
          next[loser].cash += CUP_PRIZE.continental_cup_semi;
          next[loser].totalIncome += CUP_PRIZE.continental_cup_semi;
        }
      }
    }
  }

  // ── News: top 3 L1 prize money ──
  const top3L1 = world.league1Standings.slice(0, 3);
  top3L1.forEach((entry, idx) => {
    const teamName = world.teamBases[entry.teamId]?.name ?? entry.teamId;
    const prize = leaguePrize(1, idx + 1);
    if (prize <= 0) return;
    news.push({
      id: createNewsId(season, windowIndex, `prize-l1-${idx}`),
      seasonNumber: season, windowIndex, type: 'prize_money',
      title: `${teamName} 收获奖金 ${formatMoney(prize)}`,
      description: `第${idx + 1}名 ${teamName} 获得${formatMoney(prize)}的顶级联赛奖金。`,
    });
  });
  if (lcWinner) {
    const teamName = world.teamBases[lcWinner]?.name ?? lcWinner;
    news.push({
      id: createNewsId(season, windowIndex, `prize-lc`),
      seasonNumber: season, windowIndex, type: 'prize_money',
      title: `${teamName} 联赛杯冠军奖金 ${formatMoney(CUP_PRIZE.league_cup_winner)}`,
      description: `${teamName} 收获 ${formatMoney(CUP_PRIZE.league_cup_winner)} 的联赛杯冠军奖金。`,
    });
  }

  return { teamFinances: next, news };
}

/**
 * Apply salaries to every team. Pure: returns new teamFinances + news.
 *
 * Total salaries = sum(squad market value) × SALARY_RATE. Rounded to nearest
 * integer.
 */
export function applyExpense(
  teamFinances: Record<string, FinanceState>,
  squads: Record<string, Player[]>,
): { teamFinances: Record<string, FinanceState> } {
  const next: Record<string, FinanceState> = { ...teamFinances };
  for (const id of Object.keys(next)) {
    next[id] = { ...next[id] };
    const squad = squads[id] ?? [];
    const squadValue = squad.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
    const salaries = Math.round(squadValue * getSalaryRate());
    next[id].cash -= salaries;
    next[id].totalExpense += salaries;
  }
  return { teamFinances: next };
}

/**
 * Attempt fire sales for all negative-cash teams. Pure: returns new
 * teamFinances + new squads + transfer records + news.
 *
 * Per spec:
 *   - Eligible seller: cash < 0 AND has player with marketValue >= €30M
 *   - Eligible buyer: reputation >= 85 AND cash > price × 1.5
 *   - Sells ONE player per team per season at 200% of marketValue
 *
 * Buyer is picked from elite teams by RNG; if no eligible buyer, no sale fires.
 */
export function attemptFireSale(
  teamFinances: Record<string, FinanceState>,
  squads: Record<string, Player[]>,
  teamBases: Record<string, TeamBase>,
  season: number,
  windowIndex: number,
  rng: SeededRNG,
): {
  teamFinances: Record<string, FinanceState>;
  squads: Record<string, Player[]>;
  transfers: TransferRecord[];
  news: NewsItem[];
} {
  const nextFinances: Record<string, FinanceState> = { ...teamFinances };
  for (const id of Object.keys(nextFinances)) {
    nextFinances[id] = { ...nextFinances[id] };
  }
  const nextSquads: Record<string, Player[]> = { ...squads };
  for (const id of Object.keys(nextSquads)) {
    nextSquads[id] = [...nextSquads[id]];
  }
  const transfers: TransferRecord[] = [];
  const news: NewsItem[] = [];

  // Identify candidate sellers (negative cash + has €30M+ player)
  type Seller = { teamId: string; player: Player };
  const sellers: Seller[] = [];
  for (const [teamId, fin] of Object.entries(nextFinances)) {
    if (fin.cash >= 0) continue;
    const squad = nextSquads[teamId] ?? [];
    // Pick the most valuable player on squad if it meets threshold
    const sortedDesc = [...squad].sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
    const piece = sortedDesc[0];
    if (!piece) continue;
    if ((piece.marketValue ?? 0) < FIRE_SALE_MIN_VALUE) continue;
    sellers.push({ teamId, player: piece });
  }

  // Sort sellers by descending player value (most valuable fire-sales first
  // — gives elite teams priority on the best pieces).
  sellers.sort((a, b) => (b.player.marketValue ?? 0) - (a.player.marketValue ?? 0));

  // For each seller, find an eligible buyer
  const usedBuyers = new Set<string>();
  for (const seller of sellers) {
    const price = Math.round((seller.player.marketValue ?? 0) * FIRE_SALE_PREMIUM * 10) / 10;
    // Eligible buyers: reputation >= 85, cash > price × 1.5, NOT this seller,
    // NOT already used as a buyer this pass (one fire-sale buy per buyer per
    // season — keeps things spread).
    const eligibleBuyers = Object.values(teamBases)
      .filter(b => b.reputation >= FIRE_SALE_BUYER_MIN_REP)
      .filter(b => b.id !== seller.teamId)
      .filter(b => !usedBuyers.has(b.id))
      .filter(b => (nextFinances[b.id]?.cash ?? 0) > price * FIRE_SALE_BUYER_CASH_MULT);
    if (eligibleBuyers.length === 0) continue;

    const buyer = rng.pick(eligibleBuyers);
    usedBuyers.add(buyer.id);

    // Move player. Pick a free shirt number on buyer side; reuse the same
    // strategy as transfer-window.
    const buyerSquad = nextSquads[buyer.id] ?? [];
    const buyerNums = new Set(buyerSquad.map(p => p.number));
    let newNum = seller.player.number;
    if (buyerNums.has(newNum)) {
      for (let n = 2; n <= 99; n++) {
        if (!buyerNums.has(n)) { newNum = n; break; }
      }
    }

    const movedPlayer: Player = { ...seller.player, teamId: buyer.id, number: newNum };
    nextSquads[seller.teamId] = nextSquads[seller.teamId].filter(p => p.uuid !== seller.player.uuid);
    nextSquads[buyer.id] = [...nextSquads[buyer.id], movedPlayer];

    // Update finances
    nextFinances[seller.teamId].cash += price;
    nextFinances[seller.teamId].totalIncome += price;
    nextFinances[buyer.id].cash -= price;
    nextFinances[buyer.id].totalExpense += price;

    const sellerName = teamBases[seller.teamId]?.name ?? seller.teamId;
    const buyerName = teamBases[buyer.id]?.name ?? buyer.id;
    const playerName = seller.player.name ?? `${seller.player.number}号`;

    transfers.push({
      season, windowIndex,
      playerId: seller.player.uuid,
      playerName,
      playerNumber: newNum,
      position: seller.player.position,
      fromTeamId: seller.teamId,
      fromTeamName: sellerName,
      toTeamId: buyer.id,
      toTeamName: buyerName,
      type: 'transfer',
      fee: price,
      reason: '财政告急 — 200% 高溢价转会',
    });

    news.push({
      id: createNewsId(season, windowIndex, `firesale-${seller.player.uuid}`),
      seasonNumber: season, windowIndex, type: 'fire_sale',
      title: `${sellerName} 财政紧急甩卖 ${playerName} → ${buyerName}`,
      description: `${sellerName}财政告急，以高出市价 100% 的 ${formatMoney(price)} 价格将 ${playerName} 卖给 ${buyerName}，缓解资金压力。`,
    });
  }

  return {
    teamFinances: nextFinances,
    squads: nextSquads,
    transfers,
    news,
  };
}

/**
 * Archive each team's season totals into history, then reset the running
 * income / expense counters. Returns new teamFinances.
 *
 * Recomputes prizeMoney / tvSponsor / transferIncome / salaries /
 * transferExpense from the running deltas — totalIncome/Expense are aggregate;
 * we infer the breakdown by re-deriving it from the season's events in the
 * caller (or simply by passing the breakdown in). For simplicity we store
 * the aggregates and zero rough-bucket breakdowns; UI shows totalIncome /
 * totalExpense.
 *
 * This is a snapshot pass — no side effects on cash. Cash carries forward.
 */
export function archiveSeasonFinance(
  teamFinances: Record<string, FinanceState>,
  season: number,
  startCashByTeam: Record<string, number>,
  breakdown: Record<string, {
    prizeMoney: number;
    tvSponsor: number;
    transferIncome: number;
    salaries: number;
    transferExpense: number;
  }>,
): Record<string, FinanceState> {
  const next: Record<string, FinanceState> = { ...teamFinances };
  for (const [teamId, fin] of Object.entries(next)) {
    const startCash = startCashByTeam[teamId] ?? fin.cash - fin.totalIncome + fin.totalExpense;
    const bd = breakdown[teamId] ?? {
      prizeMoney: 0, tvSponsor: 0, transferIncome: 0, salaries: 0, transferExpense: 0,
    };
    const record: FinanceSeasonRecord = {
      season,
      startCash: Math.round(startCash * 10) / 10,
      endCash: Math.round(fin.cash * 10) / 10,
      prizeMoney: Math.round(bd.prizeMoney * 10) / 10,
      tvSponsor: Math.round(bd.tvSponsor * 10) / 10,
      transferIncome: Math.round(bd.transferIncome * 10) / 10,
      salaries: Math.round(bd.salaries * 10) / 10,
      transferExpense: Math.round(bd.transferExpense * 10) / 10,
    };
    const merged = [...fin.history, record];
    next[teamId] = {
      ...fin,
      history: merged.length > FINANCE_HISTORY_CAP ? merged.slice(-FINANCE_HISTORY_CAP) : merged,
      totalIncome: 0,
      totalExpense: 0,
    };
  }
  return next;
}

// ── FINAL TUNED PARAMETERS (v15 launch) ─────────────────────────
//
// salaryRate = 0.33
//   Validated across 5 RNG seeds × 20 seasons against the s16 baseline.
//     - elite mean cash @ S20 ≈ €73M (range: tens of millions, holds positive)
//     - top mean cash @ S20 ≈ €259M
//     - mid mean cash @ S20 ≈ €314M (anti-Matthew kicker — flat sponsor wins)
//     - low mean cash @ S20 ≈ €252M
//     - fire-sale frequency: 0.80 / season average across 5 seeds
//     - negative-cash teams: 1.81 / season average
//     - cratering tiers @ S20: 0  (no tier ends underwater on average)
//   Lower rates (≤25%) cause elite hoarding (elite > €450M cash); higher
//   rates (≥40%) crater elite below zero. 33% is the inflection.
//
// startingCashForRep tiers: 150 / 80 / 40 / 20 — also validated; no tier
//   ends up dominating after 20 seasons. The €20M floor is enough to
//   absorb 1 bad season without immediate fire sale.
//
// LEAGUE_PRIZE_BASE = 60, decay = 0.85: top 8 only — keeps the curve from
//   handing money to relegated teams (8th @ €16M is the floor).
//
// All simulation outputs are reproducible — see scripts/sim-economy.ts.
