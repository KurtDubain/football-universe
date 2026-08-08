import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import { actorsForEvent, findEventScene, sceneForEvent } from './event-scene';
import { generateSequence } from './sequence';

function event(type: MatchEvent['type'], teamId: string, minute = 30): MatchEvent {
  return { type, teamId, minute, description: type };
}

describe('event-directed pitch scenes', () => {
  it('uses the scoring team as attacker for goals and misses', () => {
    expect(sceneForEvent(event('goal', 'HOME'), 'HOME')?.attackingHome).toBe(true);
    expect(sceneForEvent(event('miss', 'AWAY'), 'HOME')?.attackingHome).toBe(false);
  });

  it('uses the opposite team as attacker for goalkeeper saves and blocks', () => {
    expect(sceneForEvent(event('gk_save', 'HOME'), 'HOME')?.attackingHome).toBe(false);
    expect(sceneForEvent(event('df_block', 'AWAY'), 'HOME')?.attackingHome).toBe(true);
  });

  it('selects an upcoming shot scene and keeps its target deterministic', () => {
    const events = [event('yellow_card', 'HOME', 39), event('goal', 'AWAY', 40)];
    const first = findEventScene(events, 38, 'HOME');
    const second = findEventScene(events, 38, 'HOME');

    expect(first?.event.type).toBe('goal');
    expect(first).toEqual(second);
    expect(first?.target.x).toBeLessThan(0.05);
  });

  it('generates a forced attacking sequence that ends in a shot', () => {
    const sequence = generateSequence(42, { attackingHome: false, forceShot: true });

    expect(sequence.endsInShot).toBe(true);
    expect(sequence.phases.every(phase => phase.attackingHome === false)).toBe(true);
    expect(sequence.phases.at(-1)?.kind).toBe('shot');
  });

  it('uses the authoritative creator and shooter slots for a directed chance', () => {
    const sequence = generateSequence(42, {
      attackingHome: true,
      forceShot: true,
      creatorIdx: 7,
      shooterIdx: 10,
    });

    expect(sequence.phases[0]).toMatchObject({ passerIdx: 7, receiverIdx: 10, kind: 'pass' });
    expect(sequence.phases.at(-1)).toMatchObject({ passerIdx: 10, receiverIdx: 10, kind: 'shot' });
    expect(sequence.phases[0].duration).toBeGreaterThanOrEqual(18);
    expect(sequence.phases.at(-1)?.duration).toBeGreaterThanOrEqual(18);
    expect(Math.abs(sequence.phases.at(-1)?.swerve ?? 0)).toBeLessThanOrEqual(0.45);
    expect(sequence.phases[0].targetOverride?.x).toBeGreaterThanOrEqual(0.8);
    expect(sequence.phases.at(-1)?.sourceOverride).toEqual(sequence.phases[0].targetOverride);
  });

  it('starts turnover possession with the interceptor at the interception point', () => {
    const sequence = generateSequence(77, {
      attackingHome: false,
      startingPlayerIdx: 3,
      sourceOverride: { x: 0.48, y: 0.22 },
    });

    expect(sequence.phases[0].attackingHome).toBe(false);
    expect(sequence.phases[0].passerIdx).toBe(3);
    expect(sequence.phases[0].sourceOverride).toEqual({ x: 0.48, y: 0.22 });
  });

  it('lets misses cross the goal line and keeps repeated events distinct', () => {
    const firstEvent = event('miss', 'HOME', 62);
    const secondEvent = event('miss', 'HOME', 62);
    const first = sceneForEvent(firstEvent, 'HOME', 0);
    const second = sceneForEvent(secondEvent, 'HOME', 1);

    expect(first?.target.x).toBeGreaterThan(1);
    expect(first?.key).not.toBe(second?.key);
  });

  it('uses a single-shot penalty sequence from the spot', () => {
    const sequence = generateSequence(42, {
      attackingHome: true,
      forceShot: true,
      setPiece: 'penalty',
      shooterIdx: 6,
    });

    expect(sequence.phases).toHaveLength(1);
    expect(sequence.phases[0].kind).toBe('shot');
    expect(sequence.phases[0].passerIdx).toBe(6);
    expect(sequence.phases[0].sourceOverride).toEqual({ x: 0.88, y: 0.5 });
  });

  it('renders a saved shootout kick as a goalkeeper save rather than a generic miss', () => {
    const saved: MatchEvent = {
      ...event('penalty_miss', 'HOME', 121),
      playerId: 'home-taker',
      shootout: {
        kickNumber: 1,
        round: 1,
        teamKickNumber: 1,
        suddenDeath: false,
        outcome: 'saved',
        goalkeeperId: 'away-keeper',
      },
    };

    expect(sceneForEvent(saved, 'HOME')?.attackingHome).toBe(true);
    expect(sceneForEvent(saved, 'HOME')?.outcome).toBe('save');
  });

  it('resolves the real shooter, creator and defender from authoritative event ids', () => {
    const goal: MatchEvent = {
      ...event('goal', 'HOME', 44),
      playerId: 'scorer',
    };
    const assist: MatchEvent = {
      ...event('assist', 'HOME', 44),
      playerId: 'creator',
    };
    expect(actorsForEvent(goal, [goal, assist])).toEqual({
      attackerId: 'scorer',
      creatorId: 'creator',
      defenderId: undefined,
    });

    const denied: MatchEvent = {
      ...event('df_block', 'AWAY', 62),
      playerId: 'defender',
      deniedScorerId: 'shooter',
      deniedAssisterId: 'provider',
    };
    expect(actorsForEvent(denied, [denied])).toEqual({
      attackerId: 'shooter',
      creatorId: 'provider',
      defenderId: 'defender',
    });
  });

  it('does not borrow an assist from a later same-minute event', () => {
    const goal: MatchEvent = { ...event('goal', 'HOME', 44), playerId: 'first-scorer' };
    const intervening: MatchEvent = { ...event('yellow_card', 'AWAY', 44), playerId: 'booked-player' };
    const laterAssist: MatchEvent = { ...event('assist', 'HOME', 44), playerId: 'later-creator' };

    expect(actorsForEvent(goal, [goal, intervening, laterAssist]).creatorId).toBeUndefined();
  });
});
