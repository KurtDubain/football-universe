import { describe, expect, it } from 'vitest';
import type { MatchdaySnapshot } from '../../types/match';
import { activePitchPlayers, buildPitchRoster } from './lineup';

function fullSnapshot(): MatchdaySnapshot {
  const positions = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'] as const;
  const players: MatchdaySnapshot['players'] = positions.map((position, index) => ({
    playerId: `p${index + 1}`,
    playerNumber: index + 1,
    playerName: `球员${index + 1}`,
    position,
    role: 'starter',
    enteredMinute: 0,
    exitedMinute: index === 1 ? 52 : index === 8 ? 60 : 90,
    minutesPlayed: index === 1 ? 52 : index === 8 ? 60 : 90,
  }));
  players.push({
    playerId: 'p12',
    playerNumber: 19,
    playerName: '替补球员',
    position: 'FW',
    role: 'bench',
    enteredMinute: 60,
    exitedMinute: 90,
    minutesPlayed: 30,
  });
  return {
    players,
    substitutions: [{ minute: 60, playerInId: 'p12', playerOutId: 'p9' }],
    durationMinutes: 90,
    emergencyFloor: false,
    availableCount: 12,
  };
}

describe('pitch lineup projection', () => {
  it('uses real shirt numbers and keeps substitutions in the outgoing slot', () => {
    const roster = buildPitchRoster(fullSnapshot());
    const outgoing = roster.find(player => player.playerId === 'p9');
    const incoming = roster.find(player => player.playerId === 'p12');

    expect(incoming?.playerNumber).toBe(19);
    expect(incoming?.slotIndex).toBe(outgoing?.slotIndex);
  });

  it('removes dismissed players and switches substitutes at their exact minute', () => {
    const roster = buildPitchRoster(fullSnapshot());

    expect(activePitchPlayers(roster, 40)).toHaveLength(11);
    expect(activePitchPlayers(roster, 55).map(player => player.playerId)).not.toContain('p2');
    expect(activePitchPlayers(roster, 59).map(player => player.playerId)).toContain('p9');
    expect(activePitchPlayers(roster, 60).map(player => player.playerId)).toContain('p12');
    expect(activePitchPlayers(roster, 90)).toHaveLength(10);
  });

  it('falls back to a complete visible formation when no snapshot is available', () => {
    expect(activePitchPlayers(buildPitchRoster(), 90)).toHaveLength(11);
  });
});
