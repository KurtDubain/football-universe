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
 * - Swap: candidate moves to elite team; a random non-star player from that elite
 *   team moves down to fill the slot. Both players keep their numbers if available;
 *   otherwise we reassign the lowest unused number.
 * - Generates TransferRecord entries.
 *
 * Returns the new squads + transfer records. Does NOT mutate the world.
 */
export function processTransferWindow(
  world: GameWorld,
  rng: SeededRNG,
): {
  squads: Record<string, Player[]>;
  transfers: TransferRecord[];
} {
  const transfers: TransferRecord[] = [];
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
    return { squads, transfers };
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

    // Pick a random non-star player from the buyer team (lowest-rated outfield)
    // to swap down. Keep elite team's stars intact.
    const buyerOutfield = toSquad.filter((p) => p.position !== 'GK');
    if (buyerOutfield.length === 0) continue;
    buyerOutfield.sort((a, b) => a.rating - b.rating);
    const swapOut = buyerOutfield[0]; // weakest outfield player

    // Perform swap. Update teamId; reassign IDs to new "team-number" format.
    // Try to keep numbers; if conflict, reassign.
    const buyerNumbersUsed = new Set(toSquad.filter((p) => p.id !== swapOut.id).map((p) => p.number));
    const sellerNumbersUsed = new Set(fromSquad.filter((p) => p.id !== incomingPlayer.id).map((p) => p.number));

    function pickFreeNumber(used: Set<string | number>, preferred: number): number {
      if (!used.has(preferred)) return preferred;
      for (let n = 2; n <= 99; n++) {
        if (!used.has(n)) return n;
      }
      return preferred;
    }

    const incomingNumber = pickFreeNumber(buyerNumbersUsed as Set<number>, incomingPlayer.number);
    const outgoingNumber = pickFreeNumber(sellerNumbersUsed as Set<number>, swapOut.number);

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
      playerId: incomingPlayer.id,
      playerName: incomingPlayer.name ?? `${incomingPlayer.number}号`,
      playerNumber: incomingPlayer.number,
      position: incomingPlayer.position,
      fromTeamId: cand.teamId,
      fromTeamName: fromTeam?.name ?? cand.teamId,
      toTeamId: buyerId,
      toTeamName: toTeam?.name ?? buyerId,
      type: 'transfer',
      fee: fee > 0 ? fee : undefined,
      reason: `${cand.goals}球身价飙升`,
    });

    // Also record the reverse "loan-down" move so TeamDetail shows incoming weak-team transfer
    transfers.push({
      season: seasonNumber,
      windowIndex,
      playerId: swapOut.id,
      playerName: swapOut.name ?? `${swapOut.number}号`,
      playerNumber: swapOut.number,
      position: swapOut.position,
      fromTeamId: buyerId,
      fromTeamName: toTeam?.name ?? buyerId,
      toTeamId: cand.teamId,
      toTeamName: fromTeam?.name ?? cand.teamId,
      type: 'free',
      reason: '寻求出场时间',
    });
  }

  return { squads, transfers };
}
