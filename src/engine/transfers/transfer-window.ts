import { GameWorld } from '../season/season-manager';
import { Player, PlayerSeasonStats, PlayerPosition } from '../../types/player';
import { TransferRecord } from '../../types/transfer';
import { SeededRNG } from '../match/rng';

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
 *    Each recipient signs at most 1 free agent that fits their squad
 *    gap. Signing fee €5M (low — these are released/unattached).
 *    Released-from elite team gets the €5M as compensation.
 *
 * 4. Leftover free agents are retired (added to retirementHistory with
 *    reason "未获自由市场报价"). Avoids player count inflation per the
 *    "球员太多" feedback.
 *
 * Cash conservation: poach fee is buyer→seller. Free agent fee is
 * recipient→released-from. No universe drain.
 *
 * UUIDs survive the swap — playerStats, transferHistory, etc. all
 * continue to resolve correctly.
 */

const POACH_PROBABILITY = 0.30;
const ELITE_OVERALL_THRESHOLD = 82;
const NON_ELITE_OVERALL_THRESHOLD = 80;  // candidates can be from teams below this
const FREE_AGENT_SIGNING_FEE = 5;        // €M, charged to recipient
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

function pickFreeNumber(used: Set<number>, preferred: number): number {
  if (!used.has(preferred)) return preferred;
  for (let n = 2; n <= 99; n++) {
    if (!used.has(n)) return n;
  }
  return preferred;
}

/** Position with the FEWEST players at-or-above some rating threshold.
 *  Used to decide which free agent best fills a squad gap. */
function findWeakestPosition(squad: Player[]): PlayerPosition {
  const POS_TARGET: Record<PlayerPosition, number> = { GK: 3, DF: 7, MF: 7, FW: 5 };
  let worst: PlayerPosition = 'FW';
  let worstDiff = -Infinity;
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as PlayerPosition[]) {
    const have = squad.filter(p => p.position === pos).length;
    const diff = POS_TARGET[pos] - have;
    if (diff > worstDiff) {
      worstDiff = diff;
      worst = pos;
    }
  }
  return worst;
}

export function processTransferWindow(
  world: GameWorld,
  rng: SeededRNG,
): {
  squads: Record<string, Player[]>;
  transfers: TransferRecord[];
  playerStats: Record<string, PlayerSeasonStats>;
  /** Players released to the free agent pool and never re-signed — retired. */
  freeAgentRetirees: Array<{ uuid: string; name: string; teamId: string; teamName: string; position: PlayerPosition; peakRating: number; age: number; careerGoals: number }>;
} {
  const transfers: TransferRecord[] = [];
  const squads: Record<string, Player[]> = { ...world.squads };
  for (const tid of Object.keys(squads)) squads[tid] = [...squads[tid]];

  const eliteTeamIds = Object.values(world.teamBases)
    .filter(t => t.overall >= ELITE_OVERALL_THRESHOLD)
    .map(t => t.id);
  if (eliteTeamIds.length === 0) {
    return { squads, transfers, playerStats: world.playerStats, freeAgentRetirees: [] };
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
    if (rng.next() >= POACH_PROBABILITY) continue;
    // Eligible buyers: elite teams that aren't the seller AND haven't hit
    // their buyer cap yet. Without this cap one elite can hoard 4+ stars
    // in a season.
    const buyers = eliteTeamIds.filter(tid =>
      tid !== cand.teamId
      && (buyerPoachCount[tid] ?? 0) < MAX_POACHES_PER_BUYER,
    );
    if (buyers.length === 0) continue;
    const buyerId = rng.pick(buyers);

    const fromSquad = squads[cand.teamId];
    const toSquad = squads[buyerId];
    if (!fromSquad || !toSquad) continue;

    const incomingPlayer = fromSquad.find(p => p.uuid === cand.playerUuid);
    if (!incomingPlayer) continue;

    const sameRolePool = toSquad
      .filter(p => p.position === incomingPlayer.position)
      .sort((a, b) => a.rating - b.rating);
    if (sameRolePool.length === 0) continue;
    const released = sameRolePool[0];
    if (released.rating >= incomingPlayer.rating) continue;

    const buyerNumbersUsed = new Set(toSquad.filter(p => p.uuid !== released.uuid).map(p => p.number));
    const incomingNumber = pickFreeNumber(buyerNumbersUsed, incomingPlayer.number);

    const movedToElite: Player = { ...incomingPlayer, teamId: buyerId, number: incomingNumber };
    // Released stays as-is for now — buyer's number for the released player
    // doesn't matter because they're leaving the squad.

    squads[cand.teamId] = fromSquad.filter(p => p.uuid !== incomingPlayer.uuid);
    squads[buyerId] = toSquad.filter(p => p.uuid !== released.uuid).concat(movedToElite);

    const fromTeam = world.teamBases[cand.teamId];
    const toTeam = world.teamBases[buyerId];
    const fee = Math.round((incomingPlayer.rating - 60) * 1.2);

    transfers.push({
      season: seasonNumber,
      windowIndex,
      playerId: incomingPlayer.uuid,
      playerName: incomingPlayer.name ?? `${incomingPlayer.number}号`,
      playerNumber: incomingNumber,
      position: incomingPlayer.position,
      fromTeamId: cand.teamId,
      fromTeamName: fromTeam?.name ?? cand.teamId,
      toTeamId: buyerId,
      toTeamName: toTeam?.name ?? buyerId,
      type: 'transfer',
      fee: fee > 0 ? fee : undefined,
      reason: `${cand.sortKey | 0}${cand.position === 'FW' ? '球' : cand.position === 'MF' ? '贡献' : '场'}身价飙升`,
    });

    freeAgentPool.push({ player: released, releasedFromTeamId: buyerId });
    sellersNeedReplacement.add(cand.teamId);
    sellerPoachCount[cand.teamId] = (sellerPoachCount[cand.teamId] ?? 0) + 1;
    buyerPoachCount[buyerId] = (buyerPoachCount[buyerId] ?? 0) + 1;
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
    const recipientSquad = squads[recipient] ?? [];
    const gap = findWeakestPosition(recipientSquad);
    // Prefer free agent at the gap position; otherwise take whoever
    let pickIdx = freeAgentPool.findIndex(fa => fa.player.position === gap);
    if (pickIdx < 0) pickIdx = 0;
    const { player, releasedFromTeamId } = freeAgentPool.splice(pickIdx, 1)[0];
    const usedNums = new Set(recipientSquad.map(p => p.number));
    const newNumber = pickFreeNumber(usedNums, player.number);
    squads[recipient] = [...recipientSquad, { ...player, teamId: recipient, number: newNumber }];

    const releasedFromTeam = world.teamBases[releasedFromTeamId];
    const recipientTeam = world.teamBases[recipient];
    transfers.push({
      season: seasonNumber,
      windowIndex,
      playerId: player.uuid,
      playerName: player.name ?? `${player.number}号`,
      playerNumber: newNumber,
      position: player.position,
      fromTeamId: releasedFromTeamId,
      fromTeamName: releasedFromTeam?.name ?? releasedFromTeamId,
      toTeamId: recipient,
      toTeamName: recipientTeam?.name ?? recipient,
      type: 'free_agent',
      fee: FREE_AGENT_SIGNING_FEE,
      reason: '自由转会签约',
    });
  }

  // ── Step 3: Leftover free agents → retire ──────────────────────
  const freeAgentRetirees: Array<{ uuid: string; name: string; teamId: string; teamName: string; position: PlayerPosition; peakRating: number; age: number; careerGoals: number }> = [];
  for (const { player, releasedFromTeamId } of freeAgentPool) {
    const releasedFromTeam = world.teamBases[releasedFromTeamId];
    const stat = world.playerStats[player.uuid];
    freeAgentRetirees.push({
      uuid: player.uuid,
      name: player.name ?? `${player.number}号`,
      teamId: releasedFromTeamId,
      teamName: releasedFromTeam?.name ?? releasedFromTeamId,
      position: player.position,
      peakRating: player.peakRating ?? player.rating,
      age: player.age ?? 28,
      careerGoals: stat?.goals ?? 0,
    });
  }

  // ── Step 4: Refresh playerStats teamId for moved players ─────
  // Always rebuild to a fresh object IF anything happened (transfers OR
  // retirees), so the caller sees a new reference and can detect change.
  if (transfers.length === 0 && freeAgentRetirees.length === 0) {
    return { squads, transfers, playerStats: world.playerStats, freeAgentRetirees: [] };
  }
  const uuidToTeam = new Map<string, string>();
  for (const [tid, sq] of Object.entries(squads)) {
    for (const p of sq) uuidToTeam.set(p.uuid, tid);
  }
  const updatedStats: Record<string, PlayerSeasonStats> = {};
  for (const [uuid, stat] of Object.entries(world.playerStats)) {
    const newTeam = uuidToTeam.get(uuid);
    if (newTeam && newTeam !== stat.teamId) {
      updatedStats[uuid] = { ...stat, teamId: newTeam };
    } else if (!newTeam) {
      // Player vanished (retired free agent) — drop their stats
      continue;
    } else {
      updatedStats[uuid] = stat;
    }
  }

  return { squads, transfers, playerStats: updatedStats, freeAgentRetirees };
}
