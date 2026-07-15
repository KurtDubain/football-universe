import type { MatchdaySnapshot } from '../../types/match';
import { BASE_FORMATION, type Role } from './types';

export interface PitchRosterPlayer {
  playerId: string;
  playerName?: string;
  playerNumber: number;
  position: Role;
  slotIndex: number;
  enteredMinute: number;
  exitedMinute: number;
}

const ROLE_SLOTS = BASE_FORMATION.reduce<Record<Role, number[]>>((slots, entry, index) => {
  slots[entry.role].push(index);
  return slots;
}, { GK: [], DF: [], MF: [], FW: [] });

function fallbackRoster(): PitchRosterPlayer[] {
  return BASE_FORMATION.map((entry, slotIndex) => ({
    playerId: `slot-${slotIndex}`,
    playerNumber: slotIndex + 1,
    position: entry.role,
    slotIndex,
    enteredMinute: 0,
    exitedMinute: Number.POSITIVE_INFINITY,
  }));
}

export function buildPitchRoster(snapshot?: MatchdaySnapshot): PitchRosterPlayer[] {
  if (!snapshot) return fallbackRoster();

  const slotByPlayer = new Map<string, number>();
  const occupiedStarterSlots = new Set<number>();
  const starters = snapshot.players.filter(player => player.enteredMinute === 0);

  for (const starter of starters) {
    const roleSlot = ROLE_SLOTS[starter.position].find(slot => !occupiedStarterSlots.has(slot));
    const fallbackSlot = BASE_FORMATION.findIndex((_, slot) => !occupiedStarterSlots.has(slot));
    const slot = roleSlot ?? fallbackSlot;
    if (slot < 0) continue;
    occupiedStarterSlots.add(slot);
    slotByPlayer.set(starter.playerId, slot);
  }

  for (const substitution of snapshot.substitutions ?? []) {
    const outgoingSlot = slotByPlayer.get(substitution.playerOutId);
    if (outgoingSlot !== undefined) slotByPlayer.set(substitution.playerInId, outgoingSlot);
  }

  for (const player of snapshot.players) {
    if (player.enteredMinute == null || slotByPlayer.has(player.playerId)) continue;
    const roleSlot = ROLE_SLOTS[player.position][0];
    if (roleSlot !== undefined) slotByPlayer.set(player.playerId, roleSlot);
  }

  return snapshot.players.flatMap((player) => {
    const slotIndex = slotByPlayer.get(player.playerId);
    if (slotIndex === undefined || player.enteredMinute == null || player.exitedMinute == null) return [];
    return [{
      playerId: player.playerId,
      playerName: player.playerName,
      playerNumber: player.playerNumber ?? slotIndex + 1,
      position: player.position,
      slotIndex,
      enteredMinute: player.enteredMinute,
      exitedMinute: player.exitedMinute,
    }];
  });
}

export function activePitchPlayers(
  roster: PitchRosterPlayer[],
  minute: number,
  durationMinutes = 90,
): PitchRosterPlayer[] {
  const observedMinute = Math.min(minute, Math.max(0, durationMinutes - 0.001));
  return roster.filter(player =>
    player.enteredMinute <= observedMinute && player.exitedMinute > observedMinute,
  );
}
