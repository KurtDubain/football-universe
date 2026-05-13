import { GameWorld } from '../season/season-manager';
import { Player } from '../../types/player';
import { TransferRecord } from '../../types/transfer';
import { SeededRNG } from '../match/rng';

/**
 * End-of-season transfer window.
 *
 * Logic:
 * - Identify "transfer candidates" — top scorers from non-elite teams (overall < 80)
 *   who scored 6+ goals.
 * - For each candidate, ~30% chance an elite team (overall ≥ 82) poaches them.
 * - Swap: candidate moves to elite team; the WEAKEST player AT THE SAME POSITION
 *   from that elite team moves down to fill the slot. This preserves squad
 *   composition (3 GK / 7 DF / 7 MF / 5 FW) over many seasons.
 * - Returns an `idMap` of {oldId → newId} so callers can rewrite playerStats,
 *   playerAwardsHistory and transferHistory keys to follow the players.
 */
export function processTransferWindow(
  world: GameWorld,
  rng: SeededRNG,
): {
  squads: Record<string, Player[]>;
  transfers: TransferRecord[];
  idMap: Map<string, string>;
} {
  const transfers: TransferRecord[] = [];
  const idMap = new Map<string, string>();
  const squads: Record<string, Player[]> = { ...world.squads };
  // Make per-team mutable copies as we modify them
  for (const tid of Object.keys(squads)) {
    squads[tid] = [...squads[tid]];
  }

  // Identify elite teams (overall >= 82) — eligible buyers
  const eliteTeamIds = Object.values(world.teamBases)
    .filter((t) => t.overall >= 82)
    .map((t) => t.id);
  if (eliteTeamIds.length === 0) {
    return { squads, transfers, idMap };
  }

  // Identify transfer candidates: top scorers from non-elite teams
  type Candidate = { playerId: string; teamId: string; goals: number };
  const candidates: Candidate[] = [];
  for (const stat of Object.values(world.playerStats)) {
    const team = world.teamBases[stat.teamId];
    if (!team || team.overall >= 80) continue; // skip elite/strong
    if (stat.goals < 6) continue;
    candidates.push({ playerId: stat.playerId, teamId: stat.teamId, goals: stat.goals });
  }
  // Sort by goals desc, take top ~12 across leagues
  candidates.sort((a, b) => b.goals - a.goals);
  const shortlist = candidates.slice(0, 12);

  const seasonNumber = world.seasonState.seasonNumber;
  const windowIndex = world.seasonState.currentWindowIndex;

  for (const cand of shortlist) {
    // 30% chance to be poached
    if (rng.next() >= 0.30) continue;

    // Pick a random elite team that ISN'T the same team
    const buyers = eliteTeamIds.filter((tid) => tid !== cand.teamId);
    if (buyers.length === 0) continue;
    const buyerId = rng.pick(buyers);

    const fromSquad = squads[cand.teamId];
    const toSquad = squads[buyerId];
    if (!fromSquad || !toSquad) continue;

    const incomingPlayer = fromSquad.find((p) => p.id === cand.playerId);
    if (!incomingPlayer) continue;

    // Pick the weakest player AT THE SAME POSITION from the buyer team — this
    // preserves the formation composition (3GK/7DF/7MF/5FW) over many seasons.
    const sameRolePool = toSquad
      .filter((p) => p.position === incomingPlayer.position)
      .sort((a, b) => a.rating - b.rating);
    if (sameRolePool.length === 0) continue;
    const swapOut = sameRolePool[0]; // weakest at this position
    // Don't swap if the elite's "weakest" is already as good as / better than
    // the candidate — no realistic transfer there.
    if (swapOut.rating >= incomingPlayer.rating) continue;

    // Compute new shirt numbers (try to keep, otherwise pick lowest free)
    const buyerNumbersUsed = new Set(toSquad.filter((p) => p.id !== swapOut.id).map((p) => p.number));
    const sellerNumbersUsed = new Set(fromSquad.filter((p) => p.id !== incomingPlayer.id).map((p) => p.number));

    function pickFreeNumber(used: Set<number>, preferred: number): number {
      if (!used.has(preferred)) return preferred;
      for (let n = 2; n <= 99; n++) {
        if (!used.has(n)) return n;
      }
      return preferred;
    }

    const incomingNumber = pickFreeNumber(buyerNumbersUsed, incomingPlayer.number);
    const outgoingNumber = pickFreeNumber(sellerNumbersUsed, swapOut.number);

    const movedToElite: Player = {
      ...incomingPlayer,
      teamId: buyerId,
      number: incomingNumber,
      id: `${buyerId}-${incomingNumber}`,
    };
    const movedToWeak: Player = {
      ...swapOut,
      teamId: cand.teamId,
      number: outgoingNumber,
      id: `${cand.teamId}-${outgoingNumber}`,
    };

    // Track ID rewrites so callers can update playerStats / awards / etc.
    idMap.set(incomingPlayer.id, movedToElite.id);
    idMap.set(swapOut.id, movedToWeak.id);

    // Apply swap
    squads[cand.teamId] = fromSquad
      .filter((p) => p.id !== incomingPlayer.id)
      .concat(movedToWeak);
    squads[buyerId] = toSquad
      .filter((p) => p.id !== swapOut.id)
      .concat(movedToElite);

    const fromTeam = world.teamBases[cand.teamId];
    const toTeam = world.teamBases[buyerId];

    // Estimate fee from rating
    const fee = Math.round((incomingPlayer.rating - 60) * 1.2);

    transfers.push({
      season: seasonNumber,
      windowIndex,
      playerId: movedToElite.id, // NEW id — link will resolve to current location
      playerName: incomingPlayer.name ?? `${incomingPlayer.number}号`,
      playerNumber: incomingNumber,
      position: incomingPlayer.position,
      fromTeamId: cand.teamId,
      fromTeamName: fromTeam?.name ?? cand.teamId,
      toTeamId: buyerId,
      toTeamName: toTeam?.name ?? buyerId,
      type: 'transfer',
      fee: fee > 0 ? fee : undefined,
      reason: `${cand.goals}球身价飙升`,
    });

    // Reverse "loan-down" move so TeamDetail shows the swap
    transfers.push({
      season: seasonNumber,
      windowIndex,
      playerId: movedToWeak.id, // NEW id
      playerName: swapOut.name ?? `${swapOut.number}号`,
      playerNumber: outgoingNumber,
      position: swapOut.position,
      fromTeamId: buyerId,
      fromTeamName: toTeam?.name ?? buyerId,
      toTeamId: cand.teamId,
      toTeamName: fromTeam?.name ?? cand.teamId,
      type: 'free',
      reason: '寻求出场时间',
    });
  }

  return { squads, transfers, idMap };
}

/**
 * Rewrite playerId references throughout the world after a transfer window.
 * Mutates: playerStats keys, playerAwardsHistory[*].playerId, transferHistory[*].playerId.
 *
 * Returns the new playerStats record (callers should reassign).
 * Other arrays are mutated in place but a new world spread is recommended.
 */
export function applyTransferIdMap(
  world: GameWorld,
  idMap: Map<string, string>,
): {
  playerStats: typeof world.playerStats;
  playerAwardsHistory: typeof world.playerAwardsHistory;
  transferHistory: typeof world.transferHistory;
} {
  if (idMap.size === 0) {
    return {
      playerStats: world.playerStats,
      playerAwardsHistory: world.playerAwardsHistory,
      transferHistory: world.transferHistory,
    };
  }

  // Rewrite playerStats keys. Build a fresh record so React/zustand reactivity fires.
  const newStats: typeof world.playerStats = {};
  for (const [pid, stat] of Object.entries(world.playerStats)) {
    const newId = idMap.get(pid) ?? pid;
    newStats[newId] = { ...stat, playerId: newId };
  }

  // Rewrite awards
  const newAwards = (world.playerAwardsHistory ?? []).map((a) =>
    idMap.has(a.playerId) ? { ...a, playerId: idMap.get(a.playerId)! } : a,
  );

  // Rewrite transferHistory (entries created BEFORE this window may reference old IDs)
  const newTransfers = (world.transferHistory ?? []).map((t) =>
    idMap.has(t.playerId) ? { ...t, playerId: idMap.get(t.playerId)! } : t,
  );

  return {
    playerStats: newStats,
    playerAwardsHistory: newAwards,
    transferHistory: newTransfers,
  };
}

