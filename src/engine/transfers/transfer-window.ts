import { GameWorld } from '../season/season-manager';
import { Player, PlayerSeasonStats } from '../../types/player';
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
 *
 * Because each Player carries a stable `uuid` that survives the swap, the
 * existing playerStats / playerAwardsHistory / transferHistory keys (all of
 * which hold uuid values) continue to resolve correctly. There is no
 * post-process ID rewrite — that's the whole point of the uuid refactor.
 *
 * The only field on PlayerSeasonStats that needs touching is `teamId`: the
 * just-poached scorer's stats now belong to a different team. We rebuild a
 * fresh record (with refreshed teamIds) so the immediate season-end
 * top-scorer / award news attributes them to the new club. If no transfers
 * fire we return the input record unchanged so the caller can preserve
 * reference equality.
 */
export function processTransferWindow(
  world: GameWorld,
  rng: SeededRNG,
): {
  squads: Record<string, Player[]>;
  transfers: TransferRecord[];
  playerStats: Record<string, PlayerSeasonStats>;
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
    return { squads, transfers, playerStats: world.playerStats };
  }

  // Identify transfer candidates: top scorers from non-elite teams
  type Candidate = { playerUuid: string; teamId: string; goals: number };
  const candidates: Candidate[] = [];
  for (const stat of Object.values(world.playerStats)) {
    const team = world.teamBases[stat.teamId];
    if (!team || team.overall >= 80) continue; // skip elite/strong
    if (stat.goals < 6) continue;
    candidates.push({ playerUuid: stat.playerId, teamId: stat.teamId, goals: stat.goals });
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

    const incomingPlayer = fromSquad.find((p) => p.uuid === cand.playerUuid);
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

    // Compute new shirt numbers (try to keep, otherwise pick lowest free).
    // We compare by uuid because the player objects are about to swap teams.
    const buyerNumbersUsed = new Set(toSquad.filter((p) => p.uuid !== swapOut.uuid).map((p) => p.number));
    const sellerNumbersUsed = new Set(fromSquad.filter((p) => p.uuid !== incomingPlayer.uuid).map((p) => p.number));

    function pickFreeNumber(used: Set<number>, preferred: number): number {
      if (!used.has(preferred)) return preferred;
      for (let n = 2; n <= 99; n++) {
        if (!used.has(n)) return n;
      }
      return preferred;
    }

    const incomingNumber = pickFreeNumber(buyerNumbersUsed, incomingPlayer.number);
    const outgoingNumber = pickFreeNumber(sellerNumbersUsed, swapOut.number);

    // Build NEW Player objects — only teamId + number change, uuid is
    // preserved. We don't mutate the original objects so any other reference
    // holders (in case immutability matters elsewhere) keep their snapshot.
    const movedToElite: Player = {
      ...incomingPlayer,
      teamId: buyerId,
      number: incomingNumber,
    };
    const movedToWeak: Player = {
      ...swapOut,
      teamId: cand.teamId,
      number: outgoingNumber,
    };

    // Apply swap (replace the old object with the new one in each squad).
    squads[cand.teamId] = fromSquad
      .filter((p) => p.uuid !== incomingPlayer.uuid)
      .concat(movedToWeak);
    squads[buyerId] = toSquad
      .filter((p) => p.uuid !== swapOut.uuid)
      .concat(movedToElite);

    const fromTeam = world.teamBases[cand.teamId];
    const toTeam = world.teamBases[buyerId];

    // Estimate fee from rating
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
      reason: `${cand.goals}球身价飙升`,
    });

    // Reverse "loan-down" move so TeamDetail shows the swap
    transfers.push({
      season: seasonNumber,
      windowIndex,
      playerId: swapOut.uuid,
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

  // No transfers — preserve referential equality so React/zustand selectors
  // that subscribed on `world.playerStats` don't re-render unnecessarily.
  if (transfers.length === 0) {
    return { squads, transfers, playerStats: world.playerStats };
  }

  // Refresh stat.teamId for any uuid whose owning team changed. The keys
  // (uuids) themselves never change — that's the whole guarantee of the
  // uuid refactor.
  const uuidToTeam = new Map<string, string>();
  for (const [tid, sq] of Object.entries(squads)) {
    for (const p of sq) uuidToTeam.set(p.uuid, tid);
  }
  const updatedStats: Record<string, PlayerSeasonStats> = {};
  for (const [uuid, stat] of Object.entries(world.playerStats)) {
    const newTeam = uuidToTeam.get(uuid);
    if (newTeam && newTeam !== stat.teamId) {
      updatedStats[uuid] = { ...stat, teamId: newTeam };
    } else {
      updatedStats[uuid] = stat;
    }
  }

  return { squads, transfers, playerStats: updatedStats };
}
