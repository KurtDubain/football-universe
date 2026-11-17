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

  it('keeps every kind of save inside the goal mouth', () => {
    // A save is a ball that was going in. Anything outside 0.446-0.554 is a
    // shot the keeper could not have reached, so the drawn dive would have to
    // invent a save the simulation never produced.
    const routine = sceneForEvent(event('save', 'HOME'), 'HOME');
    const key = sceneForEvent(event('gk_save', 'HOME'), 'HOME');
    const penalty = sceneForEvent(
      { ...event('penalty_miss', 'HOME'), shootout: { kickNumber: 1, round: 1, teamKickNumber: 1, suddenDeath: false, outcome: 'saved', goalkeeperId: 'AWAY-1' } },
      'HOME',
    );

    for (const scene of [routine, key, penalty]) {
      expect(scene?.outcome).toBe('save');
      expect(scene?.target.y).toBeGreaterThanOrEqual(0.446);
      expect(scene?.target.y).toBeLessThanOrEqual(0.554);
    }
  });

  it('maps structured corner and free-kick events to delivery scenes', () => {
    const corner: MatchEvent = {
      ...event('corner', 'HOME'),
      playOrigin: 'corner',
      setPiece: { side: 'left', delivery: 'near_post', resolution: 'cleared' },
    };
    const freeKick: MatchEvent = {
      ...event('free_kick', 'AWAY'),
      playOrigin: 'crossed_free_kick',
      setPiece: { side: 'right', delivery: 'far_post', resolution: 'retained' },
    };

    expect(sceneForEvent(corner, 'HOME')).toMatchObject({ attackingHome: true, outcome: 'delivery' });
    expect(sceneForEvent(freeKick, 'HOME')).toMatchObject({ attackingHome: false, outcome: 'delivery' });
  });

  it('selects the shot scene on its own minute and keeps its target deterministic', () => {
    const events = [event('yellow_card', 'HOME', 39), event('goal', 'AWAY', 40)];
    const first = findEventScene(events, 40, 'HOME');
    const second = findEventScene(events, 40, 'HOME');

    expect(first?.event.type).toBe('goal');
    expect(first).toEqual(second);
    expect(first?.target.x).toBeLessThan(0.05);
  });

  it('never hands back a scene the clock has not reached', () => {
    // The dead air this removes: a scene prepared early ran out of phases and
    // then sat on its hold frame until the clock caught up, which is the
    // `minute < eventMinute` branch of the wait gate. If no scene can ever be
    // returned for a minute before its own event, that branch is unreachable.
    const events = [
      event('goal', 'AWAY', 40),
      event('corner', 'HOME', 41),
      event('yellow_card', 'HOME', 42),
      event('gk_save', 'AWAY', 43),
    ];
    for (let minute = 30; minute <= 45; minute++) {
      const scene = findEventScene(events, minute, 'HOME');
      if (scene) expect(minute).toBeGreaterThanOrEqual(scene.event.minute);
    }
  });

  it('prepares shot and set-piece scenes on the event minute and never before', () => {
    const goal = event('goal', 'AWAY', 40);
    const corner = event('corner', 'HOME', 55);

    // Preparing a scene early meant the move played out, ran out of phases
    // and then sat on its hold frame until the clock caught up. The clock
    // stops at the event minute anyway, so that is the only minute a scene
    // is allowed to start on.
    expect(findEventScene([goal], 40, 'HOME')?.event).toBe(goal);
    expect(findEventScene([goal], 39, 'HOME')).toBeNull();
    expect(findEventScene([goal], 35, 'HOME')).toBeNull();
    expect(findEventScene([corner], 55, 'HOME')?.event).toBe(corner);
    expect(findEventScene([corner], 50, 'HOME')).toBeNull();
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
    const passes = sequence.phases.filter(phase => phase.kind === 'pass');
    const lastPass = passes[passes.length - 1];
    const shot = sequence.phases[sequence.phases.length - 1];

    // The build-up is presentation; the two passes that make the chance are
    // the ones the simulation named, and they stay exactly where they were.
    expect(sequence.endsInShot).toBe(true);
    expect(passes.length).toBeGreaterThanOrEqual(8);
    expect(lastPass).toMatchObject({ passerIdx: 7, receiverIdx: 10, kind: 'pass' });
    expect(shot).toMatchObject({ passerIdx: 10, receiverIdx: 10, kind: 'shot' });
    expect(shot.duration).toBeGreaterThanOrEqual(18);
    expect(Math.abs(shot.swerve ?? 0)).toBeLessThanOrEqual(0.45);
    expect(lastPass.targetOverride?.x).toBeGreaterThanOrEqual(0.8);
    expect(shot.sourceOverride).toEqual(lastPass.targetOverride);
  });

  it('keeps the authoritative shooter when the attack starts at the shooter', () => {
    const sequence = generateSequence(42, {
      attackingHome: true,
      forceShot: true,
      startingPlayerIdx: 9,
      creatorIdx: 6,
      shooterIdx: 9,
      sourceOverride: { x: 0.78, y: 0.5 },
    });
    const passes = sequence.phases.filter(phase => phase.kind === 'pass');

    // The shooter is on the ball at both ends of the move. The build-up in
    // between has to route around him without him ever passing to himself.
    expect(passes[0].passerIdx).toBe(9);
    expect(passes[passes.length - 1]).toMatchObject({ passerIdx: 6, receiverIdx: 9 });
    expect(passes.some(pass => pass.passerIdx === pass.receiverIdx)).toBe(false);
    expect(sequence.phases.at(-1)).toMatchObject({ kind: 'shot', passerIdx: 9 });
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

describe('beat scenes', () => {
  it('gives cards and substitutions a scene with no ball path', () => {
    for (const [type, beat] of [
      ['yellow_card', 'yellow_card'],
      ['red_card', 'red_card'],
      ['substitution', 'substitution'],
    ] as const) {
      const scene = sceneForEvent(event(type, 'AWAY'), 'HOME');
      expect(scene).not.toBeNull();
      expect(scene?.outcome).toBe('beat');
      expect(scene?.beat).toBe(beat);
      // The team named by the event owns the touchline, not the attack.
      expect(scene?.attackingHome).toBe(false);
      // A touchline, never a goal mouth.
      expect(scene?.target.y).toBeLessThan(0.12);
      expect(scene?.target.x).toBeGreaterThanOrEqual(0.3);
      expect(scene?.target.x).toBeLessThanOrEqual(0.7);
    }
  });

  it('leaves events that are neither a shot, a set piece nor a beat alone', () => {
    expect(sceneForEvent(event('assist', 'HOME'), 'HOME')).toBeNull();
  });

  it('never lets a substitution displace a shot on the same minute', () => {
    const events = [
      event('substitution', 'HOME', 30),
      event('goal', 'AWAY', 30),
    ];
    const scene = findEventScene(events, 30, 'HOME');
    expect(scene?.outcome).toBe('goal');
  });

  it('ranks a red card above a yellow above a substitution', () => {
    const events = [
      event('substitution', 'HOME', 30),
      event('yellow_card', 'AWAY', 30),
      event('red_card', 'HOME', 30),
    ];
    expect(findEventScene(events, 30, 'HOME')?.beat).toBe('red_card');

    const withoutRed = events.filter(item => item.type !== 'red_card');
    expect(findEventScene(withoutRed, 30, 'HOME')?.beat).toBe('yellow_card');

    const onlySub = events.filter(item => item.type === 'substitution');
    expect(findEventScene(onlySub, 30, 'HOME')?.beat).toBe('substitution');
  });

  it('keeps a card when the next shot is far enough away to fit both', () => {
    const events = [
      event('red_card', 'HOME', 30),
      event('goal', 'AWAY', 34),
    ];
    const scene = findEventScene(events, 30, 'HOME');
    expect(scene?.outcome).toBe('beat');
    expect(scene?.beat).toBe('red_card');
  });

  it('lets a shot own a minute it shares with a card', () => {
    const events = [
      event('red_card', 'HOME', 30),
      event('goal', 'AWAY', 30),
    ];
    expect(findEventScene(events, 30, 'HOME')?.outcome).toBe('goal');
  });

  it('plays a card on its own minute when the shot is a minute later', () => {
    // The window is one minute now, so a card no longer has to step aside
    // for a goal it cannot see: each gets the minute it belongs to.
    const events = [
      event('red_card', 'HOME', 30),
      event('goal', 'AWAY', 31),
    ];
    expect(findEventScene(events, 30, 'HOME')?.beat).toBe('red_card');
    expect(findEventScene(events, 31, 'HOME')?.outcome).toBe('goal');
  });

  it('ignores beats on any other minute', () => {
    const events = [event('yellow_card', 'HOME', 40)];
    expect(findEventScene(events, 30, 'HOME')).toBeNull();
    expect(findEventScene(events, 40, 'HOME')?.beat).toBe('yellow_card');
  });
});
