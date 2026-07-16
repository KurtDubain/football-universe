import { GameWorld } from '../season/season-manager';
import { Player, PlayerSeasonStats, PlayerPosition } from '../../types/player';
import { TransferRecord } from '../../types/transfer';
import { SeededRNG } from '../match/rng';
import {
  applyTransferMove,
  createTransferRecord,
  FREE_MARKET_TEAM_ID,
  pickTransferReleaseCandidate,
} from './transfer-application';
import { ageMultiplier, computeInitialMarketValue } from '../economy/market-value';
import { computeCurrentRating } from '../players/development';
import { computePlayerCareerTotals } from '../players/career-totals';
import {
  assessSquadNeeds,
  createOpeningOffer,
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
const ELITE_OVERALL_THRESHOLD = 82;
const NON_ELITE_OVERALL_THRESHOLD = 80;  // candidates can be from teams below this
const FW_GOALS_MIN = 6;
const MF_CONTRIB_MIN = 6;                 // goals + assists
const DF_GK_APPEARANCES_MIN = 20;
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
  sortKey: number;
};

function buildCandidates(world: GameWorld): Candidate[] {
  const allCands: Candidate[] = [];
  for (const stat of Object.values(world.playerStats)) {
    const team = world.teamBases[stat.teamId];
    if (!team || team.overall >= NON_ELITE_OVERALL_THRESHOLD) continue;
    // Find the player object for rating + position
    const player = (world.squads[stat.teamId] ?? []).find(p => p.uuid === stat.playerId);
    if (!player) continue;
    const rating = player.rating;
    const pos = player.position;
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
    if (!passes) continue;
    allCands.push({ playerUuid: stat.playerId, teamId: stat.teamId, position: pos, rating, sortKey });
  }
  // Cap per position to keep poaching counts roughly consistent across seasons.
  // Sort by sortKey desc within position, take top N.
  const byPos: Record<PlayerPosition, Candidate[]> = { FW: [], MF: [], DF: [], GK: [] };
  for (const c of allCands) byPos[c.position].push(c);
  for (const pos of ['FW', 'MF', 'DF', 'GK'] as PlayerPosition[]) {
    byPos[pos].sort((a, b) => b.sortKey - a.sortKey);
    byPos[pos] = byPos[pos].slice(0, PER_POSITION_LIMIT[pos]);
  }
  return [...byPos.FW, ...byPos.MF, ...byPos.DF, ...byPos.GK];
}

export function processTransferWindow(
  world: GameWorld,
  rng: SeededRNG,
  options?: { favoriteTeamIds?: Set<string> },
): {
  squads: Record<string, Player[]>;
  transfers: TransferRecord[];
  playerStats: Record<string, PlayerSeasonStats>;
  /** Players released to the free agent pool and never re-signed — retired. */
  freeAgentRetirees: Array<{ uuid: string; name: string; teamId: string; teamName: string; position: PlayerPosition; peakRating: number; age: number; careerGoals: number }>;
  /** v17 — new persistent free agent pool state (after this window). */
  freeAgentPool: Player[];
  /** v20 — staged offers/targets for favorite teams (UI handles). */
  pendingOffers: import('../../types/transfer').IncomingOffer[];
  pendingTargets: import('../../types/transfer').OutgoingTarget[];
} {
  const favoriteSet = options?.favoriteTeamIds ?? new Set<string>();
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
  const financeReserveByTeam = Object.fromEntries(
    Object.entries(squads).map(([teamId, squad]) => {
      const cash = world.teamFinances[teamId]?.cash;
      if (cash === undefined || cash <= 0) return [teamId, 0];
      const squadValue = squad.reduce((sum, player) => sum + (player.marketValue ?? 0), 0);
      return [teamId, Math.min(cash * 0.25, Math.max(5, squadValue * 0.03))];
    }),
  );
  const plannedSpending: Record<string, number> = {};
  const availableCash = (teamId: string): number => {
    const cash = world.teamFinances[teamId]?.cash;
    return cash === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, cash - (financeReserveByTeam[teamId] ?? 0) - (plannedSpending[teamId] ?? 0));
  };

  const eliteTeamIds = Object.values(world.teamBases)
    .filter(t => t.overall >= ELITE_OVERALL_THRESHOLD)
    .map(t => t.id);
  if (eliteTeamIds.length === 0) {
    return { squads, transfers, playerStats: world.playerStats, freeAgentRetirees: [], freeAgentPool: world.freeAgentPool ?? [], pendingOffers: [], pendingTargets: [] };
  }

  const seasonNumber = world.seasonState.seasonNumber;
  const windowIndex = world.seasonState.currentWindowIndex;
  const candidates = buildCandidates(world);
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
    if (candPlayer?.tag === 'loyal') continue;
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
        });
        const buyerValuation = estimateBuyerValuation({ askingValue, fit, player: incomingPlayer });
        const minimumPlausibleOffer = Math.min(askingValue, buyerValuation) * 0.86;
        if (fit.weight <= 0 || availableCash(teamId) < minimumPlausibleOffer) return null;
        return { teamId, buyer, buyerSquad, released, fit, buyerValuation };
      })
      .filter((option): option is NonNullable<typeof option> => option !== null);
    if (buyerOptions.length === 0) continue;

    const strongestDemand = Math.max(...buyerOptions.map((option) => option.fit.needScore));
    const personalityBoost = incomingPlayer.tag === 'ambitious' ? 0.12 : 0;
    const activityChance = Math.min(0.65, POACH_PROBABILITY * 0.55 + strongestDemand * 0.22 + personalityBoost);
    if (rng.next() >= activityChance) continue;
    const selectedBuyer = weightedPick(buyerOptions, option => option.fit.weight, rng);
    if (!selectedBuyer) continue;
    const buyerId = selectedBuyer.teamId;
    const released = selectedBuyer.released;
    const toTeam = selectedBuyer.buyer;
    const fee = createOpeningOffer({
      askingValue,
      buyerValuation: selectedBuyer.buyerValuation,
      availableCash: availableCash(buyerId),
      rng,
    });

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
      reason: `${cand.sortKey | 0}${cand.position === 'FW' ? '球' : cand.position === 'MF' ? '贡献' : '场'}身价飙升`,
    }));

    freeAgentPool.push({ player: applied.displacedPlayer, releasedFromTeamId: buyerId });
    sellersNeedReplacement.add(cand.teamId);
    sellerPoachCount[cand.teamId] = (sellerPoachCount[cand.teamId] ?? 0) + 1;
    buyerPoachCount[buyerId] = (buyerPoachCount[buyerId] ?? 0) + 1;
    plannedSpending[buyerId] = (plannedSpending[buyerId] ?? 0) + fee;
    needsByTeam[buyerId] = assessSquadNeeds(squads[buyerId]);
    needsByTeam[cand.teamId] = assessSquadNeeds(squads[cand.teamId]);
  }

  // ── Step 1.5: Merge persistent pool into the in-flight pool ────
  // v17 — players released in previous seasons that no team picked up
  // stay in `world.freeAgentPool` until someone signs them. We tag them
  // with a sentinel `releasedFromTeamId` (last team they played for) so
  // free_agent records still have a `fromTeamId` for cash flow purposes.
  for (const carryOver of (world.freeAgentPool ?? [])) {
    freeAgentPool.push({ player: carryOver, releasedFromTeamId: carryOver.teamId });
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
    const candidate = sortedByRating.find(p => p.tag !== 'loyal');
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
  // v18 — players with 🎒 wanderer tag have an 8% per-season chance to
  // self-request transfer (released to pool, no buyer needed). Applies
  // to ALL teams including elites — a wanderer might leave 广州恒大 too.
  const WANDERER_RELEASE_CHANCE = 0.08;
  for (const tid of Object.keys(squads)) {
    const sq = squads[tid];
    if (!sq || sq.length < MIN_SQUAD_AFTER_RELEASE + 1) continue;
    const wanderers = sq.filter(p => p.tag === 'wanderer');
    for (const w of wanderers) {
      if (rng.next() >= WANDERER_RELEASE_CHANCE) continue;
      if (squads[tid].length <= MIN_SQUAD_AFTER_RELEASE) break;
      const applied = applyTransferMove({
        squads,
        playerStats,
        player: w,
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
        reason: '🎒 浪子情怀，自请离队',
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
    const value = (player.marketValue ?? computeInitialMarketValue(player))
      * (ageMultiplier(age) / ageMultiplier(oldAge));
    return {
      ...player,
      age,
      rating,
      marketValue: Math.max(0.2, Math.min(150, Math.round(value * 10) / 10)),
    };
  });
  // Age-out retirees (anyone > FREE_AGENT_MAX_AGE — no team would sign)
  const freeAgentRetirees: Array<{ uuid: string; name: string; teamId: string; teamName: string; position: PlayerPosition; peakRating: number; age: number; careerGoals: number }> = [];
  const stillInPool: Player[] = [];
  for (const player of remainingPlayers) {
    if ((player.age ?? 28) > FREE_AGENT_MAX_AGE) {
      const career = computePlayerCareerTotals(world, player.uuid);
      freeAgentRetirees.push({
        uuid: player.uuid,
        name: player.name ?? `${player.number}号`,
        teamId: player.teamId,
        teamName: world.teamBases[player.teamId]?.name ?? player.teamId,
        position: player.position,
        peakRating: player.peakRating ?? player.rating,
        age: player.age ?? 28,
        careerGoals: career.goals,
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
      teamName: world.teamBases[oldest.teamId]?.name ?? oldest.teamId,
      position: oldest.position,
      peakRating: oldest.peakRating ?? oldest.rating,
      age: oldest.age ?? 28,
      careerGoals: career.goals,
    });
  }
  const newFreeAgentPool = stillInPool;

  // ── Step 4: Return the shared pipeline's synchronized stat ownership ──
  if (transfers.length === 0 && freeAgentRetirees.length === 0 && newFreeAgentPool.length === (world.freeAgentPool ?? []).length) {
    return { squads, transfers, playerStats: world.playerStats, freeAgentRetirees: [], freeAgentPool: newFreeAgentPool, pendingOffers, pendingTargets };
  }
  return { squads, transfers, playerStats, freeAgentRetirees, freeAgentPool: newFreeAgentPool, pendingOffers, pendingTargets };
}
