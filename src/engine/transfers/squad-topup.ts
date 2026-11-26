import type { Player, PlayerPosition, PlayerSeasonStats } from '../../types/player';
import type { TeamBase } from '../../types/team';
import type { TransferRecord } from '../../types/transfer';
import type { ClubDoctrine } from '../clubs/doctrine';
import type { LeagueClimate } from '../clubs/league-climate';
import { ACADEMY_LEVEL_DEFAULT } from '../clubs/academy';
import { SeededRNG } from '../match/rng';
import { generateYouthReplacement, pickReplacementNumber } from '../players/retirement';
import {
  assessSquadNeeds,
  estimateFreeAgentSigningCost,
  estimateTransferValue,
  isKeySquadPlayer,
  POSITION_TARGETS,
  sellerAcceptanceProbability,
  weightedPick,
} from './transfer-decision';
import {
  applyTransferMove,
  createTransferRecord,
  FREE_MARKET_DISPLAY_NAME,
  FREE_MARKET_TEAM_ID,
} from './transfer-application';
import { spendableBudget } from './transfer-window';
import { hasTag } from '../players/tags';

/**
 * Squad-size target and the top-up pass that enforces it.
 *
 * Before this existed the only squad-size rule in the engine was a floor:
 * `MIN_SQUAD_AFTER_RELEASE = 18` stopped a club releasing anyone below 19, and a
 * second guard stopped anyone in the 11-18 band being poached. Both are
 * protections, and together they turned 18 into a one-way trap — a club that
 * reached it could neither sell nor be sold from, and nothing anywhere pulled it
 * back up. Measured over 100 seasons on three seeds, squad means fell from 21.7-21.9
 * to 19.9-20.1 and 14-16 of 32 clubs were sitting on the floor.
 *
 * A floor with no target can only ever lose players. This replaces it with a
 * target plus two-sided feedback: clubs below target go shopping, clubs above
 * target list players, and clubs above target sell — two thresholds one player
 * apart rather than one, for the reason `SELLER_SLACK` documents.
 *
 * The target itself has to move, or the league converges on one squad size and
 * stays there — which is the exact failure the user asked to avoid. Three
 * independent moving parts feed it:
 *
 *   1. `climate.armsRace`, league-wide, 34-season half-life (see league-climate);
 *   2. the club's own `spending` doctrine axis, which B2 already drifts at a
 *      6.6-season half-life;
 *   3. the club's cash RANK inside the league, not its cash balance — an absolute
 *      money term would drift with the economy and stop discriminating, which is
 *      how R1's thresholds died.
 */

/** `POSITION_TARGETS` sums to exactly 22; that is the engine's design squad. */
export const SQUAD_TARGET_BASE = 22;
/**
 * Hard bounds. Wider than the reachable range on purpose: these are a guard
 * against pathological inputs, not a shaping tool. A clamp that actually bites
 * is a wall, and B3 already established that a wall is not a distribution.
 */
export const SQUAD_TARGET_MIN = 17;
export const SQUAD_TARGET_MAX = 27;
/** Squad-size contribution of the spending axis: ±0.9 at the axis bounds. */
const SPENDING_WEIGHT = 2.0;
/** Squad-size contribution of league cash rank: ±0.7 at the extremes. */
const CASH_RANK_WEIGHT = 1.4;

/** A club signs at most this many players in the top-up pass per season. */
export const MAX_TOPUP_SIGNINGS = 3;
/**
 * How far above target a club must sit before the top-up lists anyone.
 *
 * This is the width of the controller's dead zone and the most load-bearing
 * number in this file. Measured with it at 3 (slack 1 plus a reserve of 2), the
 * league settled at target + 0.7 — inside the zone, where neither channel has
 * any authority — and sat there for 60 seasons while `armsRace` swung a full
 * point underneath it. A dead zone wider than the signal amplitude is not a
 * controller, it is a rounding error.
 */
export const RELEASE_SLACK = 1;
/**
 * How far above target a club must sit to sell into a top-up.
 *
 * Strictly below `RELEASE_SLACK`, which is what keeps both halves alive at a
 * one-player band. One threshold cannot do both jobs: trimming surplus clubs
 * down to exactly the seller threshold leaves `surplusOf()` at zero everywhere
 * and starves the buy channel — the only one of the three that moves a fee.
 * That is not hypothetical; a unit test caught it as a seller showing fee income
 * with no matching `transfer` record, the money having come from a signing fee.
 */
export const SELLER_SLACK = 0;
/** A club releases at most this many players in the top-up pass per season. */
export const MAX_TOPUP_RELEASES = 2;
/**
 * What a top-up buyer bids over the seller's asking price.
 *
 * Deliberately modest. The premium lane in the main window is driven by
 * competition between several interested clubs; a squad-filler bought to fix a
 * headcount problem is not a bidding war, and paying 2x for one would let the
 * top-up pass quietly become the most expensive lane in the game.
 */
const TOPUP_BID_MULTIPLIER = 1.05;

const POSITIONS: PlayerPosition[] = ['GK', 'DF', 'MF', 'FW'];
const POS_ORDER: Record<PlayerPosition, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * The squad size this club is trying to run.
 *
 * Pure and deterministic — no RNG, no world access — so the target curve can be
 * swept offline and unit-tested without simulating a season.
 */
export function squadTarget(input: {
  armsRace: number;
  spendingAxis: number;
  cashRank: number;
}): number {
  const clubTerm =
    (clamp01(input.spendingAxis) - 0.5) * SPENDING_WEIGHT
    + (clamp01(input.cashRank) - 0.5) * CASH_RANK_WEIGHT;
  const raw = SQUAD_TARGET_BASE + input.armsRace + clubTerm;
  return Math.max(SQUAD_TARGET_MIN, Math.min(SQUAD_TARGET_MAX, Math.round(raw)));
}

export interface TopUpParams {
  squads: Record<string, Player[]>;
  teamBases: Record<string, TeamBase>;
  playerStats: Record<string, PlayerSeasonStats>;
  /** Current cash per club. Read-only here — the caller applies the income/expense maps. */
  cashByTeam: Record<string, number>;
  levelByTeam: Record<string, 1 | 2 | 3>;
  doctrines?: Record<string, ClubDoctrine>;
  academyLevels?: Record<string, { level: number }>;
  freeAgentPool: Player[];
  climate: LeagueClimate;
  rng: SeededRNG;
  nextPlayerUuidCounter: number;
  seasonNumber: number;
  windowIndex: number;
}

export interface TopUpResult {
  squads: Record<string, Player[]>;
  freeAgentPool: Player[];
  playerStats: Record<string, PlayerSeasonStats>;
  transfers: TransferRecord[];
  /** Fees received per club. The caller books cash, totals and the breakdown. */
  incomeByTeam: Record<string, number>;
  /** Fees paid per club. */
  expenseByTeam: Record<string, number>;
  /** Resolved target per club, so the season can report or audit it. */
  targets: Record<string, number>;
  nextPlayerUuidCounter: number;
}

/**
 * Resolve every club's squad-size target from league-relative inputs.
 *
 * Exported because the main transfer window needs the same numbers: its
 * free-agent lane is an ADDITIVE signing with no squad-size awareness of its own,
 * and left ungated it outruns the top-up's release pass badly enough to make the
 * whole target meaningless. Both callers must resolve from the same inputs or
 * they will disagree about how big a squad should be.
 */
export function resolveSquadTargets(params: {
  teamIds: string[];
  cashByTeam: Record<string, number>;
  doctrines?: Record<string, ClubDoctrine>;
  climate: LeagueClimate;
}): Record<string, number> {
  const { teamIds, cashByTeam, doctrines, climate } = params;
  // League cash rank, 0 = poorest … 1 = richest. Relative by construction, so it
  // keeps discriminating as the whole league's balances inflate together.
  const cashRank: Record<string, number> = {};
  const ranked = teamIds
    .map(id => ({ id, cash: cashByTeam[id] ?? 0 }))
    .sort((a, b) => a.cash - b.cash);
  const span = Math.max(1, ranked.length - 1);
  ranked.forEach((entry, index) => { cashRank[entry.id] = index / span; });

  const targets: Record<string, number> = {};
  for (const id of teamIds) {
    targets[id] = squadTarget({
      armsRace: climate.armsRace,
      spendingAxis: doctrines?.[id]?.spending ?? 0.5,
      cashRank: cashRank[id] ?? 0.5,
    });
  }
  return targets;
}

/**
 * Run the squad top-up pass.
 *
 * Three channels, in priority order. The ordering is the whole design: a club
 * that needs bodies takes the cheap option first and only pays real money when
 * it has to, which is both how clubs behave and what keeps this pass from
 
 *   1. free agents    — produces a `free_agent` record and a signing fee
 *   2. squad-filler buys from clubs sitting above target — produces a `transfer`
 *      record and a fee. This is the channel that keeps the market alive: it is
 *      driven by headcount, not by season statistics, so it does not wither when
 *      the league's goals-per-game rate drifts (the failure that killed the
 *      stat-threshold lanes).
 *   3. academy promotion — free, and the reason a broke club cannot get stuck
 *      short-handed. It is last on purpose: the graduate is the worst player of
 *      the three, so being unable to afford 1 or 2 still costs something real.
 *
 * IMMUTABLE wrt `squads`, `playerStats` and `freeAgentPool`: every mutation goes
 * through `applyTransferMove` or a fresh array, so callers can pass live world
 * slices without them being touched.
 */
export function topUpSquads(params: TopUpParams): TopUpResult {
  const { teamBases, doctrines, academyLevels, climate, rng } = params;
  let squads = params.squads;
  let playerStats = params.playerStats;
  let pool = [...params.freeAgentPool];
  const transfers: TransferRecord[] = [];
  const incomeByTeam: Record<string, number> = {};
  const expenseByTeam: Record<string, number> = {};
  let targets: Record<string, number> = {};
  const nextUuid = { value: params.nextPlayerUuidCounter };

  const teamIds = Object.keys(squads);
  if (teamIds.length === 0) {
    return {
      squads, freeAgentPool: pool, playerStats, transfers,
      incomeByTeam, expenseByTeam, targets,
      nextPlayerUuidCounter: nextUuid.value,
    };
  }

  targets = resolveSquadTargets({
    teamIds,
    cashByTeam: params.cashByTeam,
    doctrines,
    climate,
  });

  const squadSize = (id: string): number => squads[id]?.length ?? 0;
  const deficitOf = (id: string): number => Math.max(0, targets[id] - squadSize(id));
  const surplusOf = (id: string): number => Math.max(0, squadSize(id) - targets[id] - SELLER_SLACK);
  const budgetOf = (id: string): number => {
    const cash = (params.cashByTeam[id] ?? 0)
      + (incomeByTeam[id] ?? 0)
      - (expenseByTeam[id] ?? 0);
    const squadValue = (squads[id] ?? []).reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
    const level = params.levelByTeam[id] ?? 1;
    return spendableBudget({ cash, squadValue, level });
  };

  // ── Release pass: surplus clubs list players ────────────────────
  //
  // This is the other half of the feedback. Without it the pass is a one-way
  // ratchet: measured with release omitted, squad means climbed 22.2 → 22.9 over
  // 100 seasons and the player count went 711 → 731, because a club above target
  // only shed players through the transfer window's 10% random release — about
  // one player per club per decade — while every club below target was topped up
  // every single season.
  //
  // Three constraints, each of which cost a version to learn:
  //
  //   1. It runs FIRST, ahead of every signing channel. Running it last means each
  //      short-handed club has already been filled by the free academy fallback, so
  //      nothing is left to absorb a released player and the pool turns into a
  //      warehouse — measured at a mean of 26.5 pooled players (peak 59) on seed
  //      688735950, against 2-4 before this system existed.
  //
  //   2. Volume is capped by SUPPLY, so it stops on its own once the league is at
  //      target. It used to be capped by demand as well, which is what broke the
  //      down-swing: in a downturn nobody is short-handed, so demand — and with it
  //      the whole release budget — went to zero exactly when shedding was needed.
  //      Measured on seed 20260722, `armsRace` fell from +0.52 to -1.43 across 80
  //      seasons and the squad mean moved 0.09, while releases ran at 3.3/season
  //      against the main window's ~10 free signings: a treadmill, not a controller.
  //
  //   3. The warehouse that constraint 2 used to guard against is now handled where
  //      it belongs — the pool overflows at its cap and those players leave the
  //      universe unreplaced. A league that collectively runs smaller squads SHOULD
  //      end up with more unattached players, and then with fewer players.
  //
  // RELEASE_FLOW_CAP is a per-season league-wide rate limit, not a target: it stops
  // a single season from dumping half a league into the pool, and it is far above
  // the trickle a settled league produces (supply approaches zero at equilibrium).
  //
  // The seller threshold sits BELOW the release threshold rather than a reserve
  // being held back above it; see SELLER_SLACK for why one number cannot do both.
  const RELEASE_FLOW_CAP = 12;
  const releasableSupply = teamIds.reduce(
    (sum, id) => sum + Math.max(0, squadSize(id) - targets[id] - RELEASE_SLACK), 0,
  );
  let releaseBudget = Math.min(releasableSupply, RELEASE_FLOW_CAP);
  const listersBySurplus = teamIds
    .filter(id => squadSize(id) - targets[id] - RELEASE_SLACK > 0)
    .sort((a, b) => surplusOf(b) - surplusOf(a));
  for (const teamId of listersBySurplus) {
    if (releaseBudget <= 0) break;
    let excess = Math.min(
      squadSize(teamId) - targets[teamId] - RELEASE_SLACK,
      releaseBudget,
      MAX_TOPUP_RELEASES,
    );
    while (excess > 0) {
      const squad = squads[teamId] ?? [];
      const candidate = squad
        .filter(player => !isKeySquadPlayer(squad, player) && !hasTag(player, 'loyal'))
        .sort((a, b) => a.rating - b.rating)[0];
      if (!candidate) break;
      const applied = applyTransferMove({
        squads, playerStats, player: candidate,
        fromTeamId: teamId, toTeamId: FREE_MARKET_TEAM_ID,
      });
      if (!applied) break;
      squads = applied.squads;
      playerStats = applied.playerStats;
      pool.push(applied.movedPlayer);
      transfers.push(createTransferRecord({
        season: params.seasonNumber,
        windowIndex: params.windowIndex,
        player: applied.movedPlayer,
        fromTeamId: teamId,
        fromTeamName: teamBases[teamId]?.name ?? teamId,
        toTeamId: FREE_MARKET_TEAM_ID,
        toTeamName: FREE_MARKET_DISPLAY_NAME,
        type: 'free',
        reason: '阵容超额，挂牌离队',
      }));
      excess--;
      releaseBudget--;
    }
  }

  const buyers = teamIds
    .filter(id => deficitOf(id) > 0)
    .sort((a, b) => deficitOf(b) - deficitOf(a));
  const remaining: Record<string, number> = {};
  for (const id of buyers) {
    remaining[id] = Math.min(MAX_TOPUP_SIGNINGS, deficitOf(id));
  }

  // ── Channel 1: squad-filler buys from clubs above target ────────
  //
  // Runs BEFORE the free-agent pool, not after. A club with money and a hole
  // goes shopping before it goes rummaging, which is both how clubs behave and
  // what makes this the lane that actually moves fees. With the pool first the
  // cheap option soaked up every gap and this channel fired only 1.6-2.7 times a
  // season league-wide, a rounding error next to the 6-17 free signings it was
  // competing with.
  for (const buyerId of buyers) {
    while (remaining[buyerId] > 0) {
      const sellers = teamIds
        .filter(id => id !== buyerId && surplusOf(id) > 0)
        .sort((a, b) => surplusOf(b) - surplusOf(a));
      if (sellers.length === 0) break;
      let signed = false;
      for (const sellerId of sellers) {
        const sellerSquad = squads[sellerId] ?? [];
        const target = sellerSquad
          .filter(player => !isKeySquadPlayer(sellerSquad, player) && !hasTag(player, 'loyal'))
          .sort((a, b) => a.rating - b.rating)[0];
        if (!target) continue;
        const askingValue = estimateTransferValue({
          player: target,
          sellerSquad,
          sellerCash: params.cashByTeam[sellerId],
          stats: params.playerStats[target.uuid],
        });
        const bid = Math.round(askingValue * TOPUP_BID_MULTIPLIER * 10) / 10;
        if (bid > budgetOf(buyerId)) continue;
        const acceptance = sellerAcceptanceProbability({
          bid,
          askingValue,
          sellerCash: params.cashByTeam[sellerId],
          keyPlayer: false,
        });
        if (rng.next() >= acceptance) continue;
        const applied = applyTransferMove({
          squads, playerStats, player: target,
          fromTeamId: sellerId, toTeamId: buyerId,
        });
        if (!applied) continue;
        squads = applied.squads;
        playerStats = applied.playerStats;
        expenseByTeam[buyerId] = (expenseByTeam[buyerId] ?? 0) + bid;
        incomeByTeam[sellerId] = (incomeByTeam[sellerId] ?? 0) + bid;
        transfers.push(createTransferRecord({
          season: params.seasonNumber,
          windowIndex: params.windowIndex,
          player: applied.movedPlayer,
          fromTeamId: sellerId,
          fromTeamName: teamBases[sellerId]?.name ?? sellerId,
          toTeamId: buyerId,
          toTeamName: teamBases[buyerId]?.name ?? buyerId,
          type: 'transfer',
          fee: bid,
          reason: '补强阵容人数',
        }));
        remaining[buyerId]--;
        signed = true;
        break;
      }
      if (!signed) break;
    }
  }

  // ── Channel 2: free agents ──────────────────────────────────────
  for (const buyerId of buyers) {
    while (remaining[buyerId] > 0 && pool.length > 0) {
      const budget = budgetOf(buyerId);
      const needs = assessSquadNeeds(squads[buyerId] ?? []);
      const affordable = pool
        .map((player, index) => ({ player, index, cost: estimateFreeAgentSigningCost(player) }))
        .filter(option => option.cost <= budget);
      if (affordable.length === 0) break;
      const selected = weightedPick(
        affordable,
        option => 0.2 + (needs[option.player.position]?.needScore ?? 0) * 1.5 + option.player.rating / 120,
        rng,
      );
      if (!selected) break;
      const applied = applyTransferMove({
        squads, playerStats, player: selected.player,
        fromTeamId: FREE_MARKET_TEAM_ID, toTeamId: buyerId,
      });
      // Drop it from the pool either way: a player who cannot be moved must not
      // stay in the candidate list, or this loop never terminates.
      pool = pool.filter(candidate => candidate.uuid !== selected.player.uuid);
      if (!applied) continue;
      squads = applied.squads;
      playerStats = applied.playerStats;
      expenseByTeam[buyerId] = (expenseByTeam[buyerId] ?? 0) + selected.cost;
      const releaser = selected.player.releasedFromTeamId;
      // A player who has been out of contract long enough to lose their last club
      // has no one to owe the fee to; it simply leaves the universe, which is
      // what the main window already does for unsigned free agents.
      if (releaser && releaser !== FREE_MARKET_TEAM_ID) {
        incomeByTeam[releaser] = (incomeByTeam[releaser] ?? 0) + selected.cost;
      }
      transfers.push(createTransferRecord({
        season: params.seasonNumber,
        windowIndex: params.windowIndex,
        player: applied.movedPlayer,
        fromTeamId: releaser ?? FREE_MARKET_TEAM_ID,
        fromTeamName: teamBases[releaser ?? '']?.name ?? FREE_MARKET_DISPLAY_NAME,
        toTeamId: buyerId,
        toTeamName: teamBases[buyerId]?.name ?? buyerId,
        type: 'free_agent',
        fee: selected.cost,
        reason: '补强阵容人数',
      }));
      remaining[buyerId]--;
    }
  }

  // ── Channel 3: academy promotion (free fallback) ────────────────
  for (const buyerId of buyers) {
    while (remaining[buyerId] > 0) {
      const squad = squads[buyerId] ?? [];
      const team = teamBases[buyerId];
      if (!team) break;
      const counts: Record<PlayerPosition, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
      for (const player of squad) counts[player.position]++;
      const position = POSITIONS
        .slice()
        .sort((a, b) => (POSITION_TARGETS[b] - counts[b]) - (POSITION_TARGETS[a] - counts[a]))[0];
      const usedNumbers = new Set(squad.map(player => player.number));
      const usedNames = new Set(squad.map(player => player.name));
      const youth = generateYouthReplacement(
        team, position, pickReplacementNumber(usedNumbers, position),
        usedNumbers, usedNames, rng, nextUuid,
        academyLevels?.[buyerId]?.level ?? ACADEMY_LEVEL_DEFAULT,
        climate.talentEra,
      );
      squads = {
        ...squads,
        [buyerId]: [...squad, youth].sort(
          (a, b) => POS_ORDER[a.position] - POS_ORDER[b.position] || a.number - b.number,
        ),
      };
      remaining[buyerId]--;
    }
  }

  return {
    squads, freeAgentPool: pool, playerStats, transfers,
    incomeByTeam, expenseByTeam, targets,
    nextPlayerUuidCounter: nextUuid.value,
  };
}
