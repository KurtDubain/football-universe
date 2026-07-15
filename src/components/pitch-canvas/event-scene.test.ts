import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import { findEventScene, sceneForEvent } from './event-scene';
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
});
