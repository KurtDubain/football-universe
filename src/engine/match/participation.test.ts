import { describe, expect, it } from 'vitest';
import type { Player, PlayerPosition } from '../../types/player';
import type { MatchdaySelection } from '../players/injuries';
import { SeededRNG } from './rng';
import {
  buildMatchParticipation,
  applyDismissalsToSnapshot,
  createSubstitutionEvents,
  playersOnField,
  selectStartingEleven,
} from './participation';

function player(id: string, position: PlayerPosition, rating = 70): Player {
  return {
    uuid: id,
    teamId: 'A',
    name: id,
    number: Number(id.replace(/\D/g, '')) || 1,
    position,
    rating,
    goalScoring: 60,
    marketValue: 10,
    age: 25,
    peakRating: rating,
    peakAge: 27,
  };
}

function selection(players: Player[]): MatchdaySelection {
  return {
    players,
    emergencyFloor: players.length < 11,
    availableCount: players.length,
    unavailablePlayerIds: new Set(),
  };
}

const fullSquad = [
  player('p1', 'GK', 80),
  ...Array.from({ length: 5 }, (_, index) => player(`p${index + 2}`, 'DF', 79 - index)),
  ...Array.from({ length: 4 }, (_, index) => player(`p${index + 7}`, 'MF', 78 - index)),
  ...Array.from({ length: 4 }, (_, index) => player(`p${index + 11}`, 'FW', 77 - index)),
];

describe('match participation', () => {
  it('selects exactly eleven starters with a goalkeeper when one is available', () => {
    const starters = selectStartingEleven(fullSquad);
    expect(starters).toHaveLength(11);
    expect(starters.filter(entry => entry.position === 'GK')).toHaveLength(1);
  });

  it('keeps a goalkeeper-only bench unused and credits no false appearance', () => {
    const players = [...fullSquad.slice(0, 11), player('p20', 'GK', 50)];
    const participation = buildMatchParticipation(selection(players), 90, new SeededRNG(1))!;
    const unusedKeeper = participation.snapshot.players.find(entry => entry.playerId === 'p20')!;

    expect(participation.snapshot.substitutions).toHaveLength(0);
    expect(unusedKeeper.role).toBe('bench');
    expect(unusedKeeper.minutesPlayed).toBe(0);
    expect(unusedKeeper.enteredMinute).toBeNull();
  });

  it('creates one to three deterministic legal substitutions and preserves team minutes', () => {
    const first = buildMatchParticipation(selection(fullSquad), 90, new SeededRNG(2))!;
    const second = buildMatchParticipation(selection(fullSquad), 90, new SeededRNG(2))!;
    const substitutions = first.snapshot.substitutions ?? [];

    expect(first.snapshot).toEqual(second.snapshot);
    expect(substitutions).toHaveLength(3);
    expect(new Set(substitutions.map(entry => entry.playerInId)).size).toBe(substitutions.length);
    expect(new Set(substitutions.map(entry => entry.playerOutId)).size).toBe(substitutions.length);
    expect(first.snapshot.players[0]).toMatchObject({ playerNumber: 1, playerName: 'p1' });
    expect(first.snapshot.players.reduce((sum, entry) => sum + (entry.minutesPlayed ?? 0), 0)).toBe(11 * 90);
    expect(createSubstitutionEvents(first.snapshot, fullSquad, 'A')).toHaveLength(substitutions.length);
  });

  it('keeps extra-time participants on the field through minute 119 and totals 1320 minutes', () => {
    const participation = buildMatchParticipation(selection(fullSquad), 120, new SeededRNG(12))!;

    expect(participation.snapshot.durationMinutes).toBe(120);
    expect(playersOnField(fullSquad, participation.snapshot, 119)).toHaveLength(11);
    expect(participation.snapshot.players.reduce((sum, entry) => sum + (entry.minutesPlayed ?? 0), 0)).toBe(11 * 120);
  });

  it('uses every available player in an emergency short squad without inventing a goalkeeper', () => {
    const shortSquad = fullSquad.filter(entry => entry.position !== 'GK').slice(0, 8);
    const participation = buildMatchParticipation(selection(shortSquad), 90, new SeededRNG(4))!;

    expect(participation.starters).toHaveLength(8);
    expect(participation.bench).toHaveLength(0);
    expect(participation.snapshot.substitutions).toHaveLength(0);
    expect(playersOnField(shortSquad, participation.snapshot, 40)).toHaveLength(8);
  });

  it('stops a dismissed player minute total at the red-card minute', () => {
    const participation = buildMatchParticipation(selection(fullSquad), 90, new SeededRNG(5))!;
    const starter = participation.snapshot.players.find(entry =>
      entry.role === 'starter' && entry.exitedMinute === 90,
    )!;

    applyDismissalsToSnapshot(participation.snapshot, [{
      minute: 52,
      type: 'red_card',
      teamId: 'A',
      playerId: starter.playerId,
      description: '红牌',
    }], 'A');

    expect(starter.exitedMinute).toBe(52);
    expect(starter.minutesPlayed).toBe(52);
  });
});
