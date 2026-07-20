import type { MatchdaySnapshot, MatchEvent } from '../../types/match';
import type { Player, PlayerPosition } from '../../types/player';
import type { MatchdaySelection } from '../players/injuries';
import { SeededRNG } from './rng';

const STARTER_SHAPE: Record<PlayerPosition, number> = {
  GK: 1,
  DF: 4,
  MF: 3,
  FW: 3,
};

export const MAX_NORMAL_SUBSTITUTIONS = 3;

function byRatingThenId(a: Player, b: Player): number {
  return b.rating - a.rating || a.uuid.localeCompare(b.uuid);
}

export function selectStartingEleven(players: Player[], unavailablePlayerIds: Set<string> = new Set()): Player[] {
  const selected: Player[] = [];
  const selectedIds = new Set<string>();
  const sorted = [...players].sort((a, b) => {
    const availability = Number(unavailablePlayerIds.has(a.uuid)) - Number(unavailablePlayerIds.has(b.uuid));
    return availability || byRatingThenId(a, b);
  });

  for (const position of ['GK', 'DF', 'MF', 'FW'] as const) {
    const candidates = sorted.filter(player => player.position === position);
    for (const player of candidates.slice(0, STARTER_SHAPE[position])) {
      selected.push(player);
      selectedIds.add(player.uuid);
    }
  }

  for (const player of sorted) {
    if (selected.length >= Math.min(11, players.length)) break;
    if (selectedIds.has(player.uuid)) continue;
    selected.push(player);
    selectedIds.add(player.uuid);
  }
  return selected;
}

export interface MatchParticipation {
  snapshot: MatchdaySnapshot;
  starters: Player[];
  bench: Player[];
}

export function buildMatchParticipation(
  selection: MatchdaySelection | undefined,
  durationMinutes: 90 | 120,
  rng: SeededRNG,
): MatchParticipation | undefined {
  if (!selection) return undefined;
  const starters = selectStartingEleven(selection.players, selection.unavailablePlayerIds);
  const starterIds = new Set(starters.map(player => player.uuid));
  const bench = selection.players.filter(player => !starterIds.has(player.uuid)).sort(byRatingThenId);
  const activeOutIds = new Set<string>();
  const substitutions: NonNullable<MatchdaySnapshot['substitutions']> = [];
  const usableBench = bench
    .filter(player => player.position !== 'GK')
    .slice(0, MAX_NORMAL_SUBSTITUTIONS);
  const substitutionCount = usableBench.length > 0
    ? rng.nextInt(1, usableBench.length)
    : 0;
  const minuteBands: Array<[number, number]> = [[56, 64], [66, 74], [76, 84]];

  for (const [index, incoming] of usableBench.slice(0, substitutionCount).entries()) {
    const samePosition = starters
      .filter(player => player.position === incoming.position && !activeOutIds.has(player.uuid))
      .sort((a, b) => a.rating - b.rating || a.uuid.localeCompare(b.uuid));
    const fallback = starters
      .filter(player => player.position !== 'GK' && !activeOutIds.has(player.uuid))
      .sort((a, b) => a.rating - b.rating || a.uuid.localeCompare(b.uuid));
    const outgoing = samePosition[0] ?? fallback[0];
    if (!outgoing) continue;
    activeOutIds.add(outgoing.uuid);
    const [min, max] = minuteBands[index];
    substitutions.push({
      minute: Math.min(durationMinutes - 1, rng.nextInt(min, max)),
      playerInId: incoming.uuid,
      playerOutId: outgoing.uuid,
    });
  }
  substitutions.sort((a, b) => a.minute - b.minute || a.playerInId.localeCompare(b.playerInId));

  const substitutionIn = new Map(substitutions.map(sub => [sub.playerInId, sub]));
  const substitutionOut = new Map(substitutions.map(sub => [sub.playerOutId, sub]));
  const players: MatchdaySnapshot['players'] = selection.players.map(player => {
    const isStarter = starterIds.has(player.uuid);
    const subIn = substitutionIn.get(player.uuid);
    const subOut = substitutionOut.get(player.uuid);
    const enteredMinute = isStarter ? 0 : subIn?.minute ?? null;
    const exitedMinute = isStarter ? subOut?.minute ?? durationMinutes : subIn ? durationMinutes : null;
    return {
      playerId: player.uuid,
      playerNumber: player.number,
      playerName: player.name,
      position: player.position,
      role: isStarter ? 'starter' : 'bench',
      enteredMinute,
      exitedMinute,
      minutesPlayed: enteredMinute == null || exitedMinute == null
        ? 0
        : Math.max(0, exitedMinute - enteredMinute),
    };
  });

  return {
    starters,
    bench,
    snapshot: {
      players,
      substitutions,
      durationMinutes,
      emergencyFloor: selection.emergencyFloor,
      availableCount: selection.availableCount,
    },
  };
}

export function playersOnField(
  squad: Player[] | undefined,
  snapshot: MatchdaySnapshot | undefined,
  minute: number,
): Player[] {
  if (!snapshot) return squad ?? [];
  const byId = new Map((squad ?? []).map(player => [player.uuid, player]));
  return snapshot.players
    .filter(player => player.enteredMinute != null
      && player.exitedMinute != null
      && player.enteredMinute <= minute
      && player.exitedMinute > minute)
    .map(player => byId.get(player.playerId))
    .filter((player): player is Player => Boolean(player));
}

export function participatingSnapshotPlayers(snapshot: MatchdaySnapshot | undefined) {
  return snapshot?.players.filter(player => (player.minutesPlayed ?? 0) > 0) ?? [];
}

export function createSubstitutionEvents(
  snapshot: MatchdaySnapshot | undefined,
  squad: Player[] | undefined,
  teamId: string,
): MatchEvent[] {
  if (!snapshot) return [];
  const byId = new Map((squad ?? []).map(player => [player.uuid, player]));
  return (snapshot.substitutions ?? []).map(substitution => {
    const playerIn = byId.get(substitution.playerInId);
    const playerOut = byId.get(substitution.playerOutId);
    return {
      minute: substitution.minute,
      type: 'substitution' as const,
      teamId,
      playerInId: substitution.playerInId,
      playerOutId: substitution.playerOutId,
      playerInName: playerIn?.name,
      playerOutName: playerOut?.name,
      description: `${playerIn?.name ?? substitution.playerInId} 换下 ${playerOut?.name ?? substitution.playerOutId}`,
    };
  });
}

export function applyDismissalsToSnapshot(
  snapshot: MatchdaySnapshot | undefined,
  events: MatchEvent[],
  teamId: string,
): void {
  if (!snapshot) return;
  const duration = snapshot.durationMinutes ?? 90;
  for (const event of events) {
    if (event.type !== 'red_card' || event.teamId !== teamId || !event.playerId) continue;
    const entry = snapshot.players.find(player => player.playerId === event.playerId);
    if (!entry || entry.enteredMinute == null || entry.exitedMinute == null) continue;
    const dismissalMinute = Math.min(duration, event.minute);
    if (dismissalMinute < entry.enteredMinute || dismissalMinute >= entry.exitedMinute) continue;
    entry.exitedMinute = dismissalMinute;
    entry.minutesPlayed = Math.max(0, dismissalMinute - entry.enteredMinute);
  }
}
