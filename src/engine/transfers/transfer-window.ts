import { GameWorld } from '../season/season-manager';
import { Player, PlayerSeasonStats, PlayerPosition } from '../../types/player';
import { TransferRecord } from '../../types/transfer';
import { SeededRNG } from '../match/rng';
import {
  applyTransferMove,
  createTransferRecord,
  FREE_MARKET_DISPLAY_NAME,
  FREE_MARKET_TEAM_ID,
  pickTransferReleaseCandidate,
} from './transfer-application';
import {
  MARKET_VALUE_CAP,
  MARKET_VALUE_FLOOR,
  applyMarketInertia,
  computePresentMarketValue,
} from '../economy/market-value';
import { computeCurrentRating } from '../players/development';
import { computeSalary } from '../economy/finance';
import { computePlayerCareerTotals } from '../players/career-totals';
import { hasTag, tagPoachMultiplier } from '../players/tags';
import {
  STARTER_TARGETS,
  assessSquadNeeds,
  createPremiumOffer,
  estimateBuyerValuation,
  estimateFreeAgentSigningCost,
  estimateTransferValue,
  isKeySquadPlayer,
  scoreTransferFit,
  sellerAcceptanceProbability,
  weightedPick,
} from './transfer-decision';

/**
 * End-of-season transfer window (v2 — 4-position support + free agent pool).
 *
 * ─── Flow ───────────────────────────────────────────────────────────
 *
 * 1. Build position-specific candidate shortlists (FW/MF/DF/GK).
 *    Each position has its own "standout" indicator since
 *    PlayerSeasonStats only carries goals/assists/appearances:
 *      - FW: rating ≥ 75 AND goals ≥ 6 (top scorer)
 *      - MF: rating ≥ 75 AND (goals + assists) ≥ 6 (creator)
 *      - DF: rating ≥ 78 AND appearances ≥ 25 (regular high-rated)
 *      - GK: rating ≥ 78 AND appearances ≥ 25 (regular high-rated)
 *
 * 2. Roll poachings (30%/candidate). For each successful poach:
 *    - Candidate moves to an elite buyer (overall ≥ 82)
 *    - Elite's WEAKEST same-position player is RELEASED to the free
 *      agent pool (NOT directly back to seller — that was v1 behavior)
 *    - Buyer pays a fee, seller receives it
 *
 * 3. Distribute free agents. Priority order:
 *    a) Sellers that lost a player to poaching this round (compensate)
 *    b) Non-elite teams by inverse league rank (weakest pick first)
 *    Each recipient signs at most 1 free agent that fits its squad need.
 *    Signing premium scales with market value and age; released-from elite
 *    team receives that premium as compensation.
 *
 * 4. Leftover free agents are retired (added to retirementHistory with
 *    reason "未获自由市场报价"). Avoids player count inflation per the
 *    "球员太多" feedback.
 *
 * Cash conservation: poach fee is buyer→seller. Free-agent premium is
 * recipient→released-from. No universe drain.
 *
 * UUIDs survive the swap — playerStats, transferHistory, etc. all
 * continue to resolve correctly.
 */

const POACH_PROBABILITY = 0.30;
// Hard floors. The rank shares below decide how many clubs a window wants to
// involve; these keep the "elite buys, non-elite sells" semantics intact, so a
// league with no genuinely strong club still produces no transfers at all.
const ELITE_OVERALL_FLOOR = 82;
const NON_ELITE_OVERALL_CEILING = 80;
// Market tiers resolve as live rank shares, not fixed overall cut-offs. A long
// save drifts the whole league downward (mean OVR ~75 → ~71), which used to
// starve the market: absolute thresholds stopped matching the population they
// were written for, and the window slowly died on mature saves.
const BUYER_RANK_SHARE = 0.38;        // buyers ≈ top 38% of the live OVR table
const CANDIDATE_RANK_SHARE = 0.52;    // sellers ≈ bottom 52%
const RANK_SHARE_SWING = 0.045;       // per-window jitter so the tiers breathe
// Per-window market temperature. Real windows alternate between frenzied and
// quiet summers; a fixed activity rate reads as a metronome over 300 seasons.
const MARKET_HEAT_MIN = 0.62;
const MARKET_HEAT_MAX = 1.48;
const FW_GOALS_MIN = 6;
const MF_CONTRIB_MIN = 6;                 // goals + assists
const DF_GK_APPEARANCES_MIN = 20;
// Potential lane — wonderkids who have not banked a headline season yet.
const POTENTIAL_PEAK_MIN = 84;
const POTENTIAL_AGE_MAX = 24;
const POTENTIAL_LANE_LIMIT: Record<PlayerPosition, number> = { FW: 2, MF: 2, DF: 2, GK: 1 };
// Blockbuster lane — players exposed by an elite club that opened as a seller.
// Its own budget is what keeps the giants from being strip-mined: without it,
// weak-club stat leaders fill every per-position slot first and "rich club raids
// rich club" stays a rounding error.
const BLOCKBUSTER_LANE_LIMIT: Record<PlayerPosition, number> = { FW: 2, MF: 2, DF: 2, GK: 1 };
// Elite-to-elite swaps. Zero-sum by construction — both sides surrender a
// surplus player — so this reshuffles the top of the table without ever
// concentrating talent the way one-way poaching does.
const ELITE_SWAP_MAX = 2;
const ELITE_SWAP_ATTEMPT_CHANCE = 0.55;
const ELITE_SWAP_MIN_NEED = 0.24;
const ELITE_SWAP_VALUE_TOLERANCE = 0.35;
// ── Wanderer lane ───────────────────────────────────────────
// A wanderer who asks out is SHOPPED, not dumped — see Step 2.7. He only
// actually leaves when a club signs him, so these three numbers decide how
// often the tag fires at all rather than how often it strands a player.
const WANDERER_DEPARTURE_CHANCE = 0.08;
/**
 * Share of the asking price a wanderer fetches. Below 1 because he has asked
 * out: the buyer knows the seller cannot hold him, and a player who wants to
 * go is not a player two clubs bid against.
 */
const WANDERER_BID_SHARE = 0.85;
/**
 * Minimum squad-need score before a club takes a wanderer. Deliberately below
 * ELITE_SWAP_MIN_NEED (0.24) — a wanderer is a market opportunity rather than
 * a targeted signing, so a club with a mild hole takes him.
 */
const WANDERER_MIN_NEED = 0.15;
// ── Premium bidding ──────────────────────────────────────────
// A long save accumulates cash with almost no outlet: measured at S150 the
// league held €54.3bn, not one club was in the red across 150 seasons, and
// the richest clubs spent €0-€3.4M per season on transfers against €34-€64M
// of annual profit. Bidding was capped at 1.02x valuation, so no amount of
// money could buy a player the seller valued highly.
//
// These constants let cash actually convert into talent, bounded by a
// solvency floor rather than by an arbitrary valuation ceiling.
const PREMIUM_CEILING_MAX = 3.0;      // hard cap on paid / asking value
// Cash RANK, not cash balance. Measuring "years of income in the bank" looked
// right at S150 (median club ~21 years) and collapsed by S300: cash has no
// outlet, so every balance sheet inflates together, the whole league passed 40
// years of income, and the markup stopped being a markup — 37% of deals landed
// above 1.8x. Ranking against the league keeps the premium attached to the
// handful of clubs that are genuinely richer than their peers.
const PREMIUM_CASH_RANK_FLOOR = 0.72;  // below the 72nd percentile: bid at value
const PREMIUM_CASH_RANK_SPAN = 0.28;   // richest club in the league: full ceiling
// A markup on a squad-filler is noise, not a statement — without this a club with
// a hole at the back paid 3.0x for a 62-rated reserve and the window headlined it
// as a record deal.
const PREMIUM_RATING_FLOOR = 66;
const PREMIUM_RATING_SPAN = 18;
// Raiding a giant is what costs real money; farming a minnow's standout gets a
// fraction of the ceiling. This keeps the premium rare instead of universal.
const WEAK_SELLER_PREMIUM_SHARE = 0.5;
// Safety floor: never let a window leave a club unable to cover wages.
// Squad value is deliberately NOT part of it — cash spent on a transfer converts
// into squad assets, so it is not a solvency input. Wages are.
const SAFETY_WAGE_SEASONS = 2;
const SAFETY_ABSOLUTE_FLOOR = 25;
// …but the floor may never exceed this share of the balance, or early seasons
// freeze outright: a club starts on €20-150M against a real wage bill, so a hard
// two-season floor left most of the league with a budget of zero and the market
// never opened at all.
const SAFETY_MAX_FLOOR_SHARE = 0.5;
// Elite clubs are usually permanent buyers and never sellers. Opening a
// random subset each window is what makes "rich club raids rich club"
// possible at all — otherwise the only tradeable players are the ones the
// candidate pool already exposes from weak clubs.
const ELITE_SELLER_CHANCE = 0.6;
const ELITE_SELLER_MAX = 3;
// Key players are normally untouchable. A small per-candidate chance keeps
// the occasional blockbuster possible without making squads unstable.
const CORE_CANDIDATE_CHANCE = 0.15;
// Concentration caps — one of the v2 pain points was "the same 3-4 weak
// teams keep losing stars every season because they always produce the
// most candidates". Caps here force variety: each team is in/out at most
// the limit per window. Combined with shuffled iteration order this gives
// a much more diverse market across seasons.
const MAX_POACHES_PER_SELLER = 1;
const MAX_POACHES_PER_BUYER = 2;
// NOTE: no rating gate on candidates — the "released.rating >= incomingPlayer.rating"
// check at swap time naturally filters out players who aren't an upgrade
// for the buyer's bench. Adding an absolute rating floor here filtered out
// too many mature-save candidates (top scorers on weak teams are often
// rating 65-70).

const PER_POSITION_LIMIT: Record<PlayerPosition, number> = {
  FW: 4,
  MF: 4,
  DF: 3,
  GK: 3,
};

type Candidate = {
  playerUuid: string;
  teamId: string;
  position: PlayerPosition;
  rating: number;
  // metric used for tier-internal sort (higher is better):
  // FW: goals; MF: goals + assists; DF/GK: appearances × rating
  // potential lane: ceiling × 2 − age
  sortKey: number;
  lane: 'form' | 'potential' | 'blockbuster';
  /** Seller was opened from the elite tier — the player is a statement signing. */
  sellerIsElite: boolean;
};

function buildCandidates(
  world: GameWorld,
  sellerIds: Set<string>,
  rng: SeededRNG,
  coreProtectedTeamIds: Set<string>,
): Candidate[] {
  const allCands: Candidate[] = [];
  // The potential-lane gates wander a little each window so the same wonderkid
  // is not permanently "too raw" — or permanently the obvious target.
  const peakGate = Math.round(rng.nextFloat(POTENTIAL_PEAK_MIN, POTENTIAL_PEAK_MIN + 2));
  const ageGate = Math.round(rng.nextFloat(POTENTIAL_AGE_MAX - 1, POTENTIAL_AGE_MAX + 1));
  for (const stat of Object.values(world.playerStats)) {
    const team = world.teamBases[stat.teamId];
    if (!team || !sellerIds.has(stat.teamId)) continue;
    // Find the player object for rating + position
    const squad = world.squads[stat.teamId] ?? [];
    const player = squad.find(p => p.uuid === stat.playerId);
    if (!player) continue;
    const rating = player.rating;
    const pos = player.position;
    const sellerIsElite = coreProtectedTeamIds.has(stat.teamId);

    // Blockbuster lane — an elite club that opened as a seller. Its squad is
    // strong by definition, so a headline season is not the entry ticket: the
    // club deciding to sell is the story. Core players still need the roll, which
    // is what stops a giant's spine from walking out every single window.
    if (sellerIsElite) {
      if (isKeySquadPlayer(squad, player) && rng.next() >= CORE_CANDIDATE_CHANCE) continue;
      allCands.push({
        playerUuid: stat.playerId,
        teamId: stat.teamId,
        position: pos,
        rating,
        sortKey: rating * 2 + (player.peakRating ?? rating) - player.age * 0.5,
        lane: 'blockbuster',
        sellerIsElite: true,
      });
      continue;
    }

    // Weak sellers carry no core-player gate on purpose: a weak club's top
    // scorer is almost by definition one of its own starters, so a blanket gate
    // strips ~85% of the pool and the window starves. The key-player penalty in
    // sellerAcceptanceProbability already makes them expensive to buy.
    let passes = false;
    let sortKey = 0;
    switch (pos) {
      case 'FW':
        if (stat.goals >= FW_GOALS_MIN) {
          passes = true;
          sortKey = stat.goals;
        }
        break;
      case 'MF':
        if ((stat.goals + stat.assists) >= MF_CONTRIB_MIN) {
          passes = true;
          sortKey = stat.goals + stat.assists;
        }
        break;
      case 'DF':
      case 'GK':
        if (stat.appearances >= DF_GK_APPEARANCES_MIN) {
          passes = true;
          sortKey = stat.appearances * (rating / 100);
        }
        break;
    }
    if (passes) {
      allCands.push({ playerUuid: stat.playerId, teamId: stat.teamId, position: pos, rating, sortKey, lane: 'form', sellerIsElite: false });
      continue;
    }

    // Potential lane — a high-ceiling youngster is a target whether or not he
    // has banked a headline season yet. Without this the market only ever sees
    // players who already produced, which strands wonderkids on weak clubs for
    // their entire career.
    if ((player.peakRating ?? 0) >= peakGate && player.age <= ageGate && !hasTag(player, 'loyal')) {
      allCands.push({
        playerUuid: stat.playerId,
        teamId: stat.teamId,
        position: pos,
        rating,
        sortKey: (player.peakRating ?? rating) * 2 - player.age,
        lane: 'potential',
        sellerIsElite: false,
      });
    }
  }
  // Cap per position to keep poaching counts roughly consistent across seasons.
  // The lanes get separate budgets so a wave of in-form veterans can never crowd
  // the wonderkid lane out — and, more importantly, so weak-club stat leaders
  // cannot crowd the elite-seller lane out. Without a dedicated blockbuster
  // budget the giants never surface, because their bench does not out-score a
  // minnow's striker.
  const byPos: Record<PlayerPosition, Candidate[]> = { FW: [], MF: [], DF: [], GK: [] };
  for (const c of allCands) byPos[c.position].push(c);
  const picked: Candidate[] = [];
  for (const pos of ['FW', 'MF', 'DF', 'GK'] as PlayerPosition[]) {
    const bucket = byPos[pos];
    const form = bucket.filter(c => c.lane === 'form')
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, PER_POSITION_LIMIT[pos]);
    const potential = bucket.filter(c => c.lane === 'potential')
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, POTENTIAL_LANE_LIMIT[pos]);
    const blockbuster = bucket.filter(c => c.lane === 'blockbuster')
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, BLOCKBUSTER_LANE_LIMIT[pos]);
    picked.push(...form, ...potential, ...blockbuster);
  }
  return picked;
}

/**
 * Resolve who can buy and who can sell this window from the live OVR table.
 * Both cuts jitter a few points per window so the market never settles into a
 * frozen buyer/seller caste across a long save.
 */
function resolveMarketTiers(world: GameWorld, rng: SeededRNG): {
  buyerIds: string[];
  sellerIds: Set<string>;
  coreProtectedTeamIds: Set<string>;
} {
  const sorted = Object.values(world.teamBases).slice().sort((a, b) => b.overall - a.overall);
  const n = sorted.length;
  const buyerShare = BUYER_RANK_SHARE + rng.nextFloat(-RANK_SHARE_SWING, RANK_SHARE_SWING);
  const sellerShare = CANDIDATE_RANK_SHARE + rng.nextFloat(-RANK_SHARE_SWING, RANK_SHARE_SWING);
  const buyerCount = Math.max(1, Math.min(n - 1, Math.round(n * buyerShare)));
  const sellerFloor = Math.max(buyerCount, Math.min(n - 1, n - Math.max(1, Math.round(n * sellerShare))));
  const buyerIds = sorted.slice(0, buyerCount).filter(t => t.overall >= ELITE_OVERALL_FLOOR).map(t => t.id);
  const sellerIds = new Set(sorted.slice(sellerFloor).filter(t => t.overall < NON_ELITE_OVERALL_CEILING).map(t => t.id));

  // Open a random slice of the elite tier as sellers. Without this an elite
  // club is structurally a permanent buyer, so the only players money can buy
  // are weak-club stat leaders and "rich club raids rich club" never happens.
  const coreProtectedTeamIds = new Set<string>();
  if (rng.next() < ELITE_SELLER_CHANCE) {
    const buyerSet = new Set(buyerIds);
    const eliteSellers = sorted.filter(t => t.overall >= ELITE_OVERALL_FLOOR && !buyerSet.has(t.id));
    const picks = rng.shuffle(eliteSellers).slice(0, Math.round(rng.nextFloat(1, ELITE_SELLER_MAX)));
    for (const t of picks) {
      sellerIds.add(t.id);
      coreProtectedTeamIds.add(t.id);
    }
  }
  return { buyerIds, sellerIds, coreProtectedTeamIds };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * How far above asking value a buyer is willing to go.
 *
 * Three gates, all of which must open together: the club has to be near the top
 * of the league's cash table, it has to actually want the player, and the player
 * has to be worth a public fight. A club with a normal balance sheet bids at
 * valuation exactly like before; only the richest few, chasing a genuine
 * difference-maker, ever reach PREMIUM_CEILING_MAX.
 */
function premiumCeilingFor(params: {
  cashRank: number;
  needScore: number;
  upgradeScore: number;
  playerRating: number;
  sellerIsElite: boolean;
}): number {
  const purchasingPower = clamp01((params.cashRank - PREMIUM_CASH_RANK_FLOOR) / PREMIUM_CASH_RANK_SPAN);
  const quality = clamp01((params.playerRating - PREMIUM_RATING_FLOOR) / PREMIUM_RATING_SPAN);
  const desire = clamp01(params.needScore * 1.2 + params.upgradeScore * 0.8);
  // Quality gates desire rather than adding to it: a squad-filler can be a huge
  // relative upgrade for a club with a hole and still not be worth a markup.
  const drive = clamp01(desire * (0.45 + quality * 0.55));
  const stature = params.sellerIsElite ? 1 : WEAK_SELLER_PREMIUM_SHARE;
  return 1 + purchasingPower * drive * stature * (PREMIUM_CEILING_MAX - 1);
}

/**
 * Cash a club may spend this window without endangering its wage bill.
 *
 * There is no bankruptcy mechanic by design, so without a floor a rich club
 * could empty itself in a single window and then bleed for years. This keeps two
 * seasons of wages on the books — capped at half the balance so that a club whose
 * starting cash cannot cover a full wage bill is still allowed to trade rather
 * than being frozen out of its own market.
 */
export function spendableBudget(params: { cash: number; squadValue: number; level: 1 | 2 | 3 }): number {
  const wage = computeSalary(params.squadValue, params.level);
  const wageFloor = Math.max(wage * SAFETY_WAGE_SEASONS, SAFETY_ABSOLUTE_FLOOR);
  const floor = Math.min(wageFloor, params.cash * SAFETY_MAX_FLOOR_SHARE);
  return Math.max(0, params.cash - floor);
}

/**
 * Elite-to-elite swaps.
 *
 * The candidate pool structurally excludes elite squads, so before this the top
 * of the table had literally zero player movement — every elite club was a
 * permanent buyer and never a seller. Both sides here surrender a surplus
 * (non-starter, over target depth) player, so roster sizes and the league-wide
 * talent distribution are unchanged: this reshuffles, it never concentrates.
 *
 * Recorded without a fee on purpose — season-end skips cash booking for
 * fee-less transfers, which keeps a swap deal out of the finance ledger and
 * guarantees it cannot perturb club cash or the wage cap.
 */
function attemptEliteSwaps(params: {
  world: GameWorld;
  squads: Record<string, Player[]>;
  playerStats: Record<string, PlayerSeasonStats>;
  buyerIds: string[];
  rng: SeededRNG;
  seasonNumber: number;
  windowIndex: number;
  needsByTeam: Record<string, ReturnType<typeof assessSquadNeeds>>;
}): { squads: Record<string, Player[]>; playerStats: Record<string, PlayerSeasonStats>; transfers: TransferRecord[] } {
  const { world, rng, seasonNumber, windowIndex } = params;
  let squads = params.squads;
  let playerStats = params.playerStats;
  const transfers: TransferRecord[] = [];
  if (params.buyerIds.length < 2) return { squads, playerStats, transfers };

  const positions: PlayerPosition[] = ['FW', 'MF', 'DF', 'GK'];
  const spent = new Set<string>();
  const attempts = rng.next() < 0.35 ? 0 : rng.next() < 0.7 ? 1 : ELITE_SWAP_MAX;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (rng.next() >= ELITE_SWAP_ATTEMPT_CHANCE) continue;

    // Precompute per club: surplus list, weakest player per position, and each
    // surplus player's valuation. The obvious shape of this search re-ran
    // filter/sort and estimateTransferValue in the innermost loop, which is
    // O(clubs² × surplus²) valuations every season — harmless in a unit test,
    // painful when a player clicks "finish season" deep into a long save.
    const surplusByTeam = new Map<string, Player[]>();
    const weakestByTeam = new Map<string, Partial<Record<PlayerPosition, Player>>>();
    const valueByUuid = new Map<string, number>();
    for (const teamId of params.buyerIds) {
      const squad = squads[teamId] ?? [];
      const surplus: Player[] = [];
      const weakest: Partial<Record<PlayerPosition, Player>> = {};
      for (const position of positions) {
        const peers = squad.filter(p => p.position === position).sort((a, b) => b.rating - a.rating);
        weakest[position] = peers[peers.length - 1];
        // Surplus = anything past the starting XI for that position. Requiring
        // the unit to also exceed its full target headcount looked correct on
        // paper but almost never fired: most squads sit at 18-22 players, so a
        // club rarely carries a position group larger than its target.
        for (const candidate of peers.slice(STARTER_TARGETS[position])) {
          if (hasTag(candidate, 'loyal') || spent.has(candidate.uuid)) continue;
          surplus.push(candidate);
          valueByUuid.set(candidate.uuid, estimateTransferValue({
            player: candidate,
            sellerSquad: squad,
            sellerCash: world.teamFinances[teamId]?.cash,
          }));
        }
      }
      weakestByTeam.set(teamId, weakest);
      if (surplus.length > 0) surplusByTeam.set(teamId, surplus);
    }
    if (surplusByTeam.size < 2) continue;

    // Enumerate every viable pair once, then take one at random. Behaviourally
    // identical to a shuffled walk that stops at the first hit, but each
    // candidate pair is now visited exactly once.
    type SwapPair = { teamA: string; teamB: string; playerA: Player; playerB: Player };
    const pairs: SwapPair[] = [];
    const teamIds = [...surplusByTeam.keys()];
    for (const teamA of teamIds) {
      const weakestA = weakestByTeam.get(teamA) ?? {};
      for (const teamB of teamIds) {
        if (teamA === teamB) continue;
        const weakestB = weakestByTeam.get(teamB) ?? {};
        for (const playerA of surplusByTeam.get(teamA) ?? []) {
          const needB = params.needsByTeam[teamB]?.[playerA.position];
          const floorB = weakestB[playerA.position];
          if (!needB || !floorB) continue;
          if (needB.needScore < ELITE_SWAP_MIN_NEED || playerA.rating <= floorB.rating) continue;
          const valueA = valueByUuid.get(playerA.uuid) ?? 0;
          for (const playerB of surplusByTeam.get(teamB) ?? []) {
            if (playerB.position === playerA.position) continue;
            const needA = params.needsByTeam[teamA]?.[playerB.position];
            const floorA = weakestA[playerB.position];
            if (!needA || !floorA) continue;
            if (needA.needScore < ELITE_SWAP_MIN_NEED || playerB.rating <= floorA.rating) continue;
            const valueB = valueByUuid.get(playerB.uuid) ?? 0;
            if (Math.abs(valueA - valueB) > Math.max(valueA, valueB) * ELITE_SWAP_VALUE_TOLERANCE) continue;
            pairs.push({ teamA, teamB, playerA, playerB });
          }
        }
      }
    }
    if (pairs.length === 0) continue;

    const chosen = pairs[Math.min(pairs.length - 1, Math.floor(rng.next() * pairs.length))];
    const applied = applyTransferMove({
      squads,
      playerStats,
      player: chosen.playerA,
      fromTeamId: chosen.teamA,
      toTeamId: chosen.teamB,
      displacedPlayerId: chosen.playerB.uuid,
      displacedToTeamId: chosen.teamA,
    });
    if (!applied || !applied.displacedPlayer) continue;
    squads = applied.squads;
    playerStats = applied.playerStats;
    spent.add(chosen.playerA.uuid);
    spent.add(chosen.playerB.uuid);
    const teamAName = world.teamBases[chosen.teamA]?.name ?? chosen.teamA;
    const teamBName = world.teamBases[chosen.teamB]?.name ?? chosen.teamB;
    const outgoingName = applied.displacedPlayer.name ?? applied.displacedPlayer.number + '号';
    const incomingName = applied.movedPlayer.name ?? applied.movedPlayer.number + '号';
    // Both legs are filed. A swap moves two players in opposite directions,
    // so recording only the incoming one left the outgoing player sitting in
    // a squad that disagreed with their latest transfer record — which the
    // world validator reports as `transfer_latest_squad_mismatch`, and which
    // erased the move from that player's career line, the club story and the
    // transfer page. `swapPartnerId` points the two legs at each other so the
    // page can render them as the single deal they were.
    transfers.push(createTransferRecord({
      season: seasonNumber,
      windowIndex,
      player: applied.movedPlayer,
      fromTeamId: chosen.teamA,
      fromTeamName: teamAName,
      toTeamId: chosen.teamB,
      toTeamName: teamBName,
      type: 'transfer',
      reason: teamBName + '以' + outgoingName + '交换补强',
      swapPartnerId: applied.displacedPlayer.uuid,
    }));
    transfers.push(createTransferRecord({
      season: seasonNumber,
      windowIndex,
      player: applied.displacedPlayer,
      fromTeamId: chosen.teamB,
      fromTeamName: teamBName,
      toTeamId: chosen.teamA,
      toTeamName: teamAName,
      type: 'transfer',
      reason: teamAName + '以' + incomingName + '交换补强',
      swapPartnerId: applied.movedPlayer.uuid,
    }));
    params.needsByTeam[chosen.teamA] = assessSquadNeeds(squads[chosen.teamA]);
    params.needsByTeam[chosen.teamB] = assessSquadNeeds(squads[chosen.teamB]);
  }
  return { squads, playerStats, transfers };
}

export function processTransferWindow(
  world: GameWorld,
  rng: SeededRNG,
  options?: {
    favoriteTeamIds?: Set<string>;
    /**
     * Per-club squad-size target from `resolveSquadTargets`. When supplied, a club
     * already at or above its target does not take a free agent. Omitting it
     * leaves the lane exactly as it was.
     */
    squadTargets?: Record<string, number>;
  },
): {
  squads: Record<string, Player[]>;
  transfers: TransferRecord[];
  playerStats: Record<string, PlayerSeasonStats>;
  /**
   * Players released to the free agent pool and never re-signed — retired.
   *
   * `releasedFromTeamId` is the last club they played for. The replacement
   * youth goes back to that club, so this path stops leaking players out of
   * the universe (see the season-end call site for the measured numbers).
   */
  freeAgentRetirees: Array<{ uuid: string; name: string; teamId: string; teamName: string; releasedFromTeamId: string; position: PlayerPosition; peakRating: number; age: number; careerGoals: number; overflow: boolean }>;
  /** v17 — new persistent free agent pool state (after this window). */
  freeAgentPool: Player[];
  /** v20 — staged offers/targets for favorite teams (UI handles). */
  pendingOffers: import('../../types/transfer').IncomingOffer[];
  pendingTargets: import('../../types/transfer').OutgoingTarget[];
} {
  const favoriteSet = options?.favoriteTeamIds ?? new Set<string>();
  const squadTargets = options?.squadTargets;
  const pendingOffers: import('../../types/transfer').IncomingOffer[] = [];
  const pendingTargets: import('../../types/transfer').OutgoingTarget[] = [];
  const transfers: TransferRecord[] = [];
  let squads: Record<string, Player[]> = { ...world.squads };
  for (const tid of Object.keys(squads)) squads[tid] = [...squads[tid]];
  let playerStats = world.playerStats;
  const needsByTeam = Object.fromEntries(
    Object.entries(squads).map(([teamId, squad]) => [teamId, assessSquadNeeds(squad)]),
  );
  const coachStyleByTeam = Object.fromEntries(
    Object.entries(world.coachStates)
      .filter(([, state]) => state.currentTeamId)
      .map(([coachId, state]) => [state.currentTeamId!, world.coachBases[coachId]?.style]),
  );
  // League-relative cash rank, 0 = poorest … 1 = richest, recomputed from live
  // balances each window. This is the premium's purchasing-power input: it tracks
  // who is flush right now rather than who was rich a decade ago, and it does not
  // inflate just because every club in the league got richer at the same time.
  const cashRankByTeam: Record<string, number> = {};
  {
    const ranked = Object.keys(squads)
      .map(teamId => ({ teamId, cash: world.teamFinances[teamId]?.cash ?? 0 }))
      .sort((a, b) => a.cash - b.cash);
    const span = Math.max(1, ranked.length - 1);
    ranked.forEach((entry, index) => { cashRankByTeam[entry.teamId] = index / span; });
  }
  const plannedSpending: Record<string, number> = {};
  // Solvency floor instead of the old flat reserve, which kept only 3% of squad
  // value — about €15M for a rich club, i.e. no constraint at all. A club may
  // now spend down to two seasons of wages plus a share of squad value and never
  // past it. There is no bankruptcy mechanic, so this floor is the only thing
  // between a premium window and a club that cannot make payroll.
  const availableCash = (teamId: string): number => {
    const cash = world.teamFinances[teamId]?.cash;
    if (cash === undefined) return Number.POSITIVE_INFINITY;
    const squad = squads[teamId] ?? [];
    const squadValue = squad.reduce((sum, player) => sum + (player.marketValue ?? 0), 0);
    const level = (world.teamStates?.[teamId]?.leagueLevel ?? 1) as 1 | 2 | 3;
    const budget = spendableBudget({ cash, squadValue, level });
    return Math.max(0, budget - (plannedSpending[teamId] ?? 0));
  };

  const marketTiers = resolveMarketTiers(world, rng);
  const eliteTeamIds = marketTiers.buyerIds;
  if (eliteTeamIds.length === 0) {
    return { squads, transfers, playerStats: world.playerStats, freeAgentRetirees: [], freeAgentPool: world.freeAgentPool ?? [], pendingOffers: [], pendingTargets: [] };
  }

  const seasonNumber = world.seasonState.seasonNumber;
  const windowIndex = world.seasonState.currentWindowIndex;
  const marketHeat = rng.nextFloat(MARKET_HEAT_MIN, MARKET_HEAT_MAX);
  const candidates = buildCandidates(world, marketTiers.sellerIds, rng, marketTiers.coreProtectedTeamIds);
  // Shuffle so iteration order doesn't bias toward FW (which appear first
  // in the per-position concat). Different position/team gets a fair shot
  // each season; combined with the per-seller cap below this makes the
  // visible transfer mix feel random rather than always-same-team-selling.
  const shuffledCandidates = rng.shuffle([...candidates]);

  // ── Step 1: Poachings ────────────────────────────────────────
  type FreeAgent = { player: Player; releasedFromTeamId: string };
  const freeAgentPool: FreeAgent[] = [];
  const sellersNeedReplacement = new Set<string>();
  // Concentration caps — see constants comment block.
  const sellerPoachCount: Record<string, number> = {};
  const buyerPoachCount: Record<string, number> = {};

  for (const cand of shuffledCandidates) {
    // Per-seller cap: each non-elite team loses at most N stars per season.
    if ((sellerPoachCount[cand.teamId] ?? 0) >= MAX_POACHES_PER_SELLER) continue;
    const fromSquad = squads[cand.teamId];
    const candPlayer = fromSquad?.find(p => p.uuid === cand.playerUuid);
    if (hasTag(candPlayer, 'loyal')) continue;
    const incomingPlayer = candPlayer;
    if (!incomingPlayer || !fromSquad || (fromSquad.length >= 11 && fromSquad.length <= 18)) continue;
    const fromTeam = world.teamBases[cand.teamId];
    if (!fromTeam) continue;
    const askingValue = estimateTransferValue({
      player: incomingPlayer,
      sellerSquad: fromSquad,
      sellerCash: world.teamFinances[cand.teamId]?.cash,
      stats: world.playerStats[cand.playerUuid],
    });

    const buyerOptions = eliteTeamIds
      .filter((teamId) => !favoriteSet.has(teamId))
      .filter((teamId) => teamId !== cand.teamId && (buyerPoachCount[teamId] ?? 0) < MAX_POACHES_PER_BUYER)
      .map((teamId) => {
        const buyer = world.teamBases[teamId];
        const buyerSquad = squads[teamId];
        const released = buyerSquad ? pickTransferReleaseCandidate(buyerSquad, incomingPlayer, false) : undefined;
        if (!buyer || !buyerSquad || !released || released.rating >= incomingPlayer.rating) return null;
        const fit = scoreTransferFit({
          player: incomingPlayer,
          buyerSquad,
          buyer,
          seller: fromTeam,
          coachStyle: coachStyleByTeam[teamId],
          availableCash: availableCash(teamId),
          expectedFee: askingValue,
          needs: needsByTeam[teamId],
          doctrine: world.clubDoctrines?.[teamId],
        });
        const buyerValuation = estimateBuyerValuation({ askingValue, fit, player: incomingPlayer });
        const minimumPlausibleOffer = Math.min(askingValue, buyerValuation) * 0.86;
        if (fit.weight <= 0 || availableCash(teamId) < minimumPlausibleOffer) return null;
        // A club that values him below three quarters of the asking price is not
        // a bidder, it is a tourist. Without this a premium ceiling measured off
        // the asking price would drag reluctant clubs into auctions they lose.
        if (buyerValuation < askingValue * 0.75) return null;
        // Cash-rich clubs may bid well past valuation. The ceiling scales with how
        // many seasons of income they are hoarding and how badly they want him.
        const ceiling = premiumCeilingFor({
          cashRank: cashRankByTeam[teamId] ?? 0,
          needScore: fit.needScore,
          upgradeScore: fit.upgradeScore,
          playerRating: incomingPlayer.rating,
          sellerIsElite: cand.sellerIsElite,
        });
        return { teamId, buyer, buyerSquad, released, fit, buyerValuation, ceiling };
      })
      .filter((option): option is NonNullable<typeof option> => option !== null);
    if (buyerOptions.length === 0) continue;

    const strongestDemand = Math.max(...buyerOptions.map((option) => option.fit.needScore));
    // `mercenary` deliberately has no boost here. A +0.10 was tried and measured
    // at 1.06x the transfer rate against a 1.00x baseline — the poach lane is
    // gated by MAX_POACHES_PER_SELLER / _PER_BUYER long before activityChance
    // binds, so a personality term cannot move it. The tag's whole effect lives
    // in `scoreTransferFit`, where money decides WHICH club wins him.
    const personalityBoost = hasTag(incomingPlayer, 'ambitious') ? 0.12 : 0;
    // A leader is the last man out of a dressing room, so the whole lane is
    // damped for him rather than merely losing the ambitious bump.
    const activityChance = Math.min(0.72, (POACH_PROBABILITY * 0.55 + strongestDemand * 0.22 + personalityBoost) * marketHeat)
      * tagPoachMultiplier(incomingPlayer);
    if (rng.next() >= activityChance) continue;

    // Competitive bidding: every interested club prices the player against its
    // own budget and the highest bid wins. This is what turns "a club is rich"
    // into "two clubs fight over a player and the fee runs away" — the premium is
    // an emergent result of competition, not a scripted markup.
    const bids = buyerOptions.map((option) => ({
      ...option,
      // Ceiling is measured against the seller's asking price, not the buyer's
      // own valuation — otherwise a buyer who already rates him at 1.34x asking
      // turns a 3.0x cap into 4.0x and the stated limit stops meaning anything.
      bid: createPremiumOffer({
        maxWilling: askingValue * option.ceiling,
        availableCash: availableCash(option.teamId),
        rng,
      }),
    }));
    const topBid = Math.max(...bids.map((entry) => entry.bid));
    const contenders = bids.filter((entry) => entry.bid >= topBid - 0.05);
    const selectedBuyer = contenders.length === 1
      ? contenders[0]
      : weightedPick(contenders, (option) => option.fit.weight, rng);
    if (!selectedBuyer) continue;
    const buyerId = selectedBuyer.teamId;
    const released = selectedBuyer.released;
    const toTeam = selectedBuyer.buyer;
    const fee = selectedBuyer.bid;
    const premiumRatio = Math.round((fee / Math.max(1, askingValue)) * 100) / 100;

    // v20 — if seller is a favorite team, DON'T execute. Stage as an
    // IncomingOffer for the UI to resolve. (Free agent pool still gets
    // the released player ONLY when user accepts; deferred to apply step.)
    if (favoriteSet.has(cand.teamId)) {
      pendingOffers.push({
        id: `offer-${seasonNumber}-${cand.playerUuid}-${buyerId}`,
        playerId: incomingPlayer.uuid,
        playerName: incomingPlayer.name ?? `${incomingPlayer.number}号`,
        playerPosition: incomingPlayer.position,
        playerRating: incomingPlayer.rating,
        playerAge: incomingPlayer.age,
        marketValue: incomingPlayer.marketValue,
        buyerValuation: selectedBuyer.buyerValuation,
        needScore: selectedBuyer.fit.needScore,
        interestReason: selectedBuyer.fit.reason,
        ownerTeamId: cand.teamId,
        ownerTeamName: fromTeam?.name ?? cand.teamId,
        buyerId,
        buyerName: toTeam?.name ?? buyerId,
        fee,
        resolution: 'pending',
      });
      // Bump seller/buyer caps so we don't generate 10 offers for the same player
      sellerPoachCount[cand.teamId] = (sellerPoachCount[cand.teamId] ?? 0) + 1;
      buyerPoachCount[buyerId] = (buyerPoachCount[buyerId] ?? 0) + 1;
      plannedSpending[buyerId] = (plannedSpending[buyerId] ?? 0) + fee;
      continue;
    }

    const sellerAcceptance = sellerAcceptanceProbability({
      bid: fee,
      askingValue,
      sellerCash: world.teamFinances[cand.teamId]?.cash,
      keyPlayer: isKeySquadPlayer(fromSquad, incomingPlayer),
    });
    if (rng.next() >= sellerAcceptance) continue;

    const applied = applyTransferMove({
      squads,
      playerStats,
      player: incomingPlayer,
      fromTeamId: cand.teamId,
      toTeamId: buyerId,
      displacedPlayerId: released.uuid,
    });
    if (!applied || !applied.displacedPlayer) continue;
    squads = applied.squads;
    playerStats = applied.playerStats;

    transfers.push(createTransferRecord({
      season: seasonNumber,
      windowIndex,
      player: applied.movedPlayer,
      fromTeamId: cand.teamId,
      fromTeamName: fromTeam?.name ?? cand.teamId,
      toTeamId: buyerId,
      toTeamName: toTeam?.name ?? buyerId,
      type: 'transfer',
      fee: fee > 0 ? fee : undefined,
      premiumRatio,
      reason: cand.lane === 'blockbuster'
        ? `${fromTeam?.name ?? cand.teamId}套现主力`
        : cand.lane === 'potential'
          ? `上限${incomingPlayer.peakRating ?? incomingPlayer.rating}的潜力股`
          : `${cand.sortKey | 0}${cand.position === 'FW' ? '球' : cand.position === 'MF' ? '贡献' : '场'}身价飙升`,
    }));

    freeAgentPool.push({ player: applied.displacedPlayer, releasedFromTeamId: buyerId });
    sellersNeedReplacement.add(cand.teamId);
    sellerPoachCount[cand.teamId] = (sellerPoachCount[cand.teamId] ?? 0) + 1;
    buyerPoachCount[buyerId] = (buyerPoachCount[buyerId] ?? 0) + 1;
    plannedSpending[buyerId] = (plannedSpending[buyerId] ?? 0) + fee;
    needsByTeam[buyerId] = assessSquadNeeds(squads[buyerId]);
    needsByTeam[cand.teamId] = assessSquadNeeds(squads[cand.teamId]);
  }

  // ── Step 1.1: Elite-to-elite swaps ────────────────────────────
  const swapResult = attemptEliteSwaps({
    world,
    squads,
    playerStats,
    buyerIds: eliteTeamIds,
    rng,
    seasonNumber,
    windowIndex,
    needsByTeam,
  });
  squads = swapResult.squads;
  playerStats = swapResult.playerStats;
  transfers.push(...swapResult.transfers);

  // ── Step 1.5: Merge persistent pool into the in-flight pool ────
  // v17 — players released in previous seasons that no team picked up
  // stay in `world.freeAgentPool` until someone signs them. We tag them
  // with a sentinel `releasedFromTeamId` (last team they played for) so
  // free_agent records still have a `fromTeamId` for cash flow purposes.
  for (const carryOver of (world.freeAgentPool ?? [])) {
    // `carryOver.teamId` is the market sentinel for anyone released since the
    // teamId fix landed, so the releasing club has to come off the preserved
    // field — otherwise every signing fee would be booked to the market and
    // drain out of the universe. Saves written before that fix carry no such
    // field and still hold the old club on `teamId`, which is the value we
    // want in that case.
    freeAgentPool.push({
      player: carryOver,
      releasedFromTeamId: carryOver.releasedFromTeamId ?? carryOver.teamId,
    });
  }

  // ── Step 1.7: Generate outgoing targets for favorite teams ─────
  // Suggest 3 candidates per favorite team they could try to bid for.
  // Pulls from `candidates` (top stat-producers from non-elite teams)
  // who haven't already been poached this window. Skipped if favorite
  // is the candidate's current team (can't bid on own player).
  if (favoriteSet.size > 0) {
    const poachedUuids = new Set(pendingOffers.map(o => o.playerId).concat(transfers.map(t => t.playerId)));
    const targetedUuids = new Set<string>();
    for (const favId of favoriteSet) {
      const favTeam = world.teamBases[favId];
      if (!favTeam) continue;
      const candidateOptions = candidates
        .filter(c => c.teamId !== favId)
        .filter(c => !poachedUuids.has(c.playerUuid))
        .filter(c => !targetedUuids.has(c.playerUuid))
        .map((candidate) => {
          const sellerSquad = squads[candidate.teamId] ?? [];
          if (sellerSquad.length >= 11 && sellerSquad.length <= 18) return null;
          const player = sellerSquad.find((entry) => entry.uuid === candidate.playerUuid);
          const seller = world.teamBases[candidate.teamId];
          if (!player || !seller) return null;
          const askingValue = estimateTransferValue({
            player,
            sellerSquad,
            sellerCash: world.teamFinances[candidate.teamId]?.cash,
            stats: world.playerStats[player.uuid],
          });
          const fit = scoreTransferFit({
            player,
            buyerSquad: squads[favId] ?? [],
            buyer: favTeam,
            seller,
            coachStyle: coachStyleByTeam[favId],
            availableCash: availableCash(favId),
            expectedFee: askingValue,
            needs: needsByTeam[favId],
            doctrine: world.clubDoctrines?.[favId],
          });
          if (fit.weight <= 0 || availableCash(favId) < askingValue * 0.7) return null;
          return {
            candidate,
            player,
            askingValue,
            fit,
            buyerValuation: estimateBuyerValuation({ askingValue, fit, player }),
          };
        })
        .filter((option): option is NonNullable<typeof option> => option !== null);
      const candidatesForFav: typeof candidateOptions = [];
      while (candidateOptions.length > 0 && candidatesForFav.length < 4) {
        const selected = weightedPick(candidateOptions, option => option.fit.weight, rng);
        if (!selected) break;
        candidatesForFav.push(selected);
        candidateOptions.splice(candidateOptions.indexOf(selected), 1);
      }
      for (const option of candidatesForFav) {
        const c = option.candidate;
        const sellerSquad = squads[c.teamId] ?? [];
        const p = option.player ?? sellerSquad.find(pp => pp.uuid === c.playerUuid);
        if (!p) continue;
        pendingTargets.push({
          id: `target-${seasonNumber}-${p.uuid}-${favId}`,
          playerId: p.uuid,
          playerName: p.name ?? `${p.number}号`,
          playerPosition: p.position,
          playerRating: p.rating,
          playerAge: p.age,
          marketValue: p.marketValue,
          buyerValuation: option.buyerValuation,
          needScore: option.fit.needScore,
          interestReason: option.fit.reason,
          fromTeamId: c.teamId,
          fromTeamName: world.teamBases[c.teamId]?.name ?? c.teamId,
          toTeamId: favId,
          suggestedFee: option.askingValue,
          resolution: 'pending',
        });
        targetedUuids.add(c.playerUuid);
      }
    }
  }

  // ── Step 2: Distribute free agents ─────────────────────────────
  // Priority: sellers-needing-replacement first, then non-elite teams
  // by inverse league rank (weakest position first).
  const eliteSet = new Set(eliteTeamIds);
  const standingsLevels = [world.league1Standings, world.league2Standings, world.league3Standings];
  // Build inverse-rank order: highest rank (worst) first across all leagues
  const rankedNonElite: string[] = [];
  for (let lv = 0; lv < 3; lv++) {
    const arr = [...(standingsLevels[lv] ?? [])].reverse(); // worst first within league
    for (const s of arr) {
      if (!eliteSet.has(s.teamId)) rankedNonElite.push(s.teamId);
    }
  }
  const recipients: string[] = [
    ...Array.from(sellersNeedReplacement),
    ...rankedNonElite.filter(t => !sellersNeedReplacement.has(t)),
  ];

  for (const recipient of recipients) {
    if (freeAgentPool.length === 0) break;
    if (eliteSet.has(recipient)) continue; // elites don't sign freebies; they poach
    // v20 — favorite teams sign manually via /market UI; skip auto-assign
    if (favoriteSet.has(recipient)) continue;
    const recipientSquad = squads[recipient] ?? [];
    const recipientTeam = world.teamBases[recipient];
    if (!recipientTeam) continue;
    // Squad-size target gate. A free agent is the cheapest body a club can add and
    // this lane is purely ADDITIVE — it displaces nobody — so without the gate it is
    // a one-way ratchet against the top-up's release pass. Measured on seed
    // 877987150 over 300 seasons: the top-up listed 12 surplus players a season
    // (its flow cap, saturated for 180 straight seasons) while this loop signed 18
    // a season back out of the pool, and `armsRace` fell 2.9 points while the squad
    // mean moved 0.1. A club already carrying more players than it wants does not
    // add free ones.
    const target = squadTargets?.[recipient];
    if (target !== undefined && recipientSquad.length >= target) continue;
    const freeAgentOptions = freeAgentPool
      .map((freeAgent, index) => {
        const signingCost = estimateFreeAgentSigningCost(freeAgent.player);
        return {
          index,
          freeAgent,
          signingCost,
          fit: scoreTransferFit({
            player: freeAgent.player,
            buyerSquad: recipientSquad,
            buyer: recipientTeam,
            coachStyle: coachStyleByTeam[recipient],
            availableCash: availableCash(recipient),
            expectedFee: signingCost,
            needs: needsByTeam[recipient],
            requireUpgrade: false,
            doctrine: world.clubDoctrines?.[recipient],
          }),
        };
      })
      .filter(option => option.signingCost <= availableCash(recipient));
    const selectedFreeAgent = weightedPick(
      freeAgentOptions,
      option => option.fit.weight + option.fit.needScore * 1.5,
      rng,
    );
    if (!selectedFreeAgent) continue;
    const pickIdx = selectedFreeAgent.index;
    const { player, releasedFromTeamId } = freeAgentPool.splice(pickIdx, 1)[0];
    const applied = applyTransferMove({
      squads,
      playerStats,
      player,
      fromTeamId: FREE_MARKET_TEAM_ID,
      toTeamId: recipient,
    });
    if (!applied) continue;
    squads = applied.squads;
    playerStats = applied.playerStats;

    const releasedFromTeam = world.teamBases[releasedFromTeamId];
    transfers.push(createTransferRecord({
      season: seasonNumber,
      windowIndex,
      player: applied.movedPlayer,
      fromTeamId: releasedFromTeamId,
      fromTeamName: releasedFromTeam?.name ?? releasedFromTeamId,
      toTeamId: recipient,
      toTeamName: recipientTeam?.name ?? recipient,
      type: 'free_agent',
      fee: selectedFreeAgent.signingCost,
      reason: '自由转会签约',
    }));
    plannedSpending[recipient] = (plannedSpending[recipient] ?? 0) + selectedFreeAgent.signingCost;
    needsByTeam[recipient] = assessSquadNeeds(squads[recipient]);
  }

  // ── Step 2.5: Random churn — each non-elite team has a small chance
  // each season to release a fringe player into the persistent pool
  // (modeling contract decisions, dressing room dynamics, etc.). Keeps
  // the pool from sitting empty AND breaks the "every release gets
  // signed same-season" coupling user complained about.
  const RANDOM_RELEASE_CHANCE = 0.10;
  const MIN_SQUAD_AFTER_RELEASE = 18;
  for (const tid of Object.keys(squads)) {
    if (eliteTeamIds.includes(tid)) continue;
    const sq = squads[tid];
    if (!sq || sq.length < MIN_SQUAD_AFTER_RELEASE + 1) continue;
    if (rng.next() >= RANDOM_RELEASE_CHANCE) continue;
    // Release the lowest-rated player (fringe). Skip if they have a tag
    // that suggests loyalty — those would never voluntarily depart.
    const sortedByRating = [...sq].sort((a, b) => a.rating - b.rating);
    const candidate = sortedByRating.find(p => !hasTag(p, 'loyal'));
    if (!candidate) continue;
    const applied = applyTransferMove({
      squads,
      playerStats,
      player: candidate,
      fromTeamId: tid,
      toTeamId: FREE_MARKET_TEAM_ID,
    });
    if (!applied) continue;
    squads = applied.squads;
    playerStats = applied.playerStats;
    freeAgentPool.push({ player: applied.movedPlayer, releasedFromTeamId: tid });
    const teamName = world.teamBases[tid]?.name ?? tid;
    transfers.push(createTransferRecord({
      season: seasonNumber,
      windowIndex,
      player: applied.movedPlayer,
      fromTeamId: tid,
      fromTeamName: teamName,
      toTeamId: FREE_MARKET_TEAM_ID,
      toTeamName: '自由市场',
      type: 'free',
      reason: '合同到期未续约',
    }));
  }

  // ── Step 2.7: Wanderer tag — voluntary departure ────────────────
  //
  // v23 — a wanderer who asks out is SHOPPED, not dumped.
  //
  // The old version released him straight into the free-agent pool with no
  // buyer sought. Measured over 120 seasons / 304 departures: 42.4% were
  // re-signed in the same window, 19.4% the next season, 17.4% later, and
  // 20.7% were never signed at all. So 57.6% of departures cost the player at
  // least one season and a fifth cost him his career — while the selling club
  // received nothing for an asset it had developed.
  //
  // Now he asks out, the league is polled for a buyer, and he leaves ONLY if a
  // club actually signs him. No buyer means he stays and re-rolls next season.
  // A player nobody wants does not get to leave, which is both how contracts
  // work and what removes the wasted season entirely. Every departure is now a
  // real transfer with a fee, so the seller is paid as well.
  for (const tid of Object.keys(squads)) {
    const sq = squads[tid];
    if (!sq || sq.length < MIN_SQUAD_AFTER_RELEASE + 1) continue;
    const wanderers = sq.filter(player => hasTag(player, 'wanderer'));
    for (const w of wanderers) {
      if (rng.next() >= WANDERER_DEPARTURE_CHANCE) continue;
      if (squads[tid].length <= MIN_SQUAD_AFTER_RELEASE) break;

      const askingValue = estimateTransferValue({
        player: w,
        sellerSquad: squads[tid],
        sellerCash: world.teamFinances[tid]?.cash ?? 0,
        stats: playerStats[w.uuid],
      });
      const bid = Math.round(askingValue * WANDERER_BID_SHARE * 10) / 10;
      if (bid <= 0) continue;

      // Poll every other club. Squad need is the primary signal — a club that
      // has his position covered is not interested at any price — and the
      // budget check is the same solvency-floor cash the premium lane uses.
      const buyers = Object.keys(squads)
        .filter(otherId => otherId !== tid)
        .map(otherId => ({
          otherId,
          need: needsByTeam[otherId]?.[w.position]?.needScore ?? 0,
          cash: availableCash(otherId),
        }))
        .filter(option => option.need >= WANDERER_MIN_NEED && option.cash >= bid)
        .sort((a, b) => (b.need - a.need) || a.otherId.localeCompare(b.otherId));
      // No buyer: he stays. This is the branch that used to strand him.
      if (buyers.length === 0) continue;

      const buyerId = buyers[0].otherId;
      const applied = applyTransferMove({
        squads,
        playerStats,
        player: w,
        fromTeamId: tid,
        toTeamId: buyerId,
      });
      if (!applied) continue;
      squads = applied.squads;
      playerStats = applied.playerStats;
      plannedSpending[buyerId] = (plannedSpending[buyerId] ?? 0) + bid;
      transfers.push(createTransferRecord({
        season: seasonNumber,
        windowIndex,
        player: applied.movedPlayer,
        fromTeamId: tid,
        fromTeamName: world.teamBases[tid]?.name ?? tid,
        toTeamId: buyerId,
        toTeamName: world.teamBases[buyerId]?.name ?? buyerId,
        type: 'transfer',
        fee: bid,
        reason: '🎒 浪子自请离队，转会加盟',
      }));
    }
  }

  // ── Step 3: Leftover free agents stay in the persistent pool ────
  // v17 — unsold players persist across seasons (was: immediate retire).
  // Pool capped at FREE_AGENT_POOL_CAP — overflow retires the OLDEST so
  // we never balloon player count past control.
  const FREE_AGENT_POOL_CAP = 40;
  const FREE_AGENT_MAX_AGE = 36;
  const remainingPlayers = freeAgentPool.map(({ player }) => {
    const oldAge = player.age ?? 28;
    const age = oldAge + 1;
    const rating = typeof player.peakRating === 'number' && typeof player.peakAge === 'number'
      ? computeCurrentRating(player.peakRating, age, player.peakAge)
      : player.rating;
    // Re-anchor on present value, same as the squad revaluation path — a
    // player sitting in the pool is not exempt from the market correcting
    // itself, and the old age-ratio multiply had the same compounding flaw.
    const aged = { ...player, age, rating };
    const value = applyMarketInertia(player.marketValue, computePresentMarketValue(aged));
    return {
      ...aged,
      marketValue: Math.max(MARKET_VALUE_FLOOR, Math.min(MARKET_VALUE_CAP, Math.round(value * 10) / 10)),
    };
  });
  // Age-out retirees (anyone > FREE_AGENT_MAX_AGE — no team would sign)
  // `overflow` separates the two ways a pooled player leaves. Age-out is a club
  // having released a veteran to make room, and the caller puts a graduate back.
  // Overflow is the league holding more players than it can absorb, and the
  // caller must NOT put one back — see the season-end call site.
  const freeAgentRetirees: Array<{ uuid: string; name: string; teamId: string; teamName: string; releasedFromTeamId: string; position: PlayerPosition; peakRating: number; age: number; careerGoals: number; overflow: boolean }> = [];
  const stillInPool: Player[] = [];
  for (const player of remainingPlayers) {
    if ((player.age ?? 28) > FREE_AGENT_MAX_AGE) {
      const career = computePlayerCareerTotals(world, player.uuid);
      freeAgentRetirees.push({
        uuid: player.uuid,
        name: player.name ?? `${player.number}号`,
        teamId: player.teamId,
        // A pooled player's teamId is the market sentinel, so `teamBases` has no
        // entry for it. Naming the market explicitly is what stops this record
        // from reading as a retirement from the club that released them.
        teamName: FREE_MARKET_DISPLAY_NAME,
        releasedFromTeamId: player.releasedFromTeamId ?? player.teamId,
        position: player.position,
        peakRating: player.peakRating ?? player.rating,
        age: player.age ?? 28,
        careerGoals: career.goals,
        overflow: false,
      });
    } else {
      stillInPool.push(player);
    }
  }
  // Cap overflow — sort oldest first, drop excess into retirees
  stillInPool.sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
  while (stillInPool.length > FREE_AGENT_POOL_CAP) {
    const oldest = stillInPool.shift()!;
    const career = computePlayerCareerTotals(world, oldest.uuid);
    freeAgentRetirees.push({
      uuid: oldest.uuid,
      name: oldest.name ?? `${oldest.number}号`,
      teamId: oldest.teamId,
      teamName: FREE_MARKET_DISPLAY_NAME,
      releasedFromTeamId: oldest.releasedFromTeamId ?? oldest.teamId,
      position: oldest.position,
      peakRating: oldest.peakRating ?? oldest.rating,
      age: oldest.age ?? 28,
      careerGoals: career.goals,
      overflow: true,
    });
  }
  const newFreeAgentPool = stillInPool;

  // ── Step 4: Return the shared pipeline's synchronized stat ownership ──
  if (transfers.length === 0 && freeAgentRetirees.length === 0 && newFreeAgentPool.length === (world.freeAgentPool ?? []).length) {
    return { squads, transfers, playerStats: world.playerStats, freeAgentRetirees: [], freeAgentPool: newFreeAgentPool, pendingOffers, pendingTargets };
  }
  return { squads, transfers, playerStats, freeAgentRetirees, freeAgentPool: newFreeAgentPool, pendingOffers, pendingTargets };
}
