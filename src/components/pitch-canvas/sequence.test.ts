import { describe, expect, it } from 'vitest';
import { buildPassTarget, generateSequence, restartReleaseDelay } from './sequence';
import { passArc } from './sequence';
import { decayBallLiftCarry, LIFT_CARRY_FLOOR } from './physics';
import { getFormationSlots, getTacticalFormationSlots } from './types';
import { rigForMoment } from './projection';
import type { BroadcastCameraMoment } from './camera';

describe('pitch possession sequences', () => {
  it('creates deterministic, bounded receiving points rather than fixed formation coordinates', () => {
    const first = buildPassTarget(9, true, 0.82, false);
    const repeat = buildPassTarget(9, true, 0.82, false);

    expect(first).toEqual(repeat);
    expect(first.x).toBeGreaterThan(0.55);
    expect(first.x).toBeLessThanOrEqual(0.94);
    expect(first.y).toBeGreaterThanOrEqual(0.09);
    expect(first.y).toBeLessThanOrEqual(0.91);
  });

  it('mirrors forward movement for the away side', () => {
    const home = buildPassTarget(9, true, 0.6, true);
    const away = buildPassTarget(9, false, 0.6, true);

    expect(home.x).toBeGreaterThan(0.55);
    expect(away.x).toBeLessThan(0.45);
  });

  it('gives every open-play pass a concrete receiving run', () => {
    const sequence = generateSequence(20260808, { attackingHome: true });
    const passes = sequence.phases.filter(phase => phase.kind === 'pass');

    expect(passes.length).toBeGreaterThan(0);
    expect(passes.every(phase => phase.targetOverride !== undefined)).toBe(true);
  });

  it('uses coherent tactical episodes without inventing ordinary shots', () => {
    const patterns = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      const sequence = generateSequence(seed, { attackingHome: true });
      const episodePatterns = new Set(sequence.phases.map(phase => phase.pattern));
      sequence.phases.forEach(phase => phase.pattern && patterns.add(phase.pattern));

      expect(sequence.endsInShot).toBe(false);
      expect(sequence.phases.every(phase => phase.kind === 'pass')).toBe(true);
      expect(episodePatterns.size).toBe(1);
      expect(sequence.phases.every(phase => phase.stage !== undefined)).toBe(true);
    }

    expect(patterns).toEqual(new Set([
      'build_up',
      'wing_overload',
      'central_combination',
      'switch_play',
      'recycle',
    ]));
  });

  it('marks a turnover as a short counter while preserving the ball source', () => {
    const source = { x: 0.47, y: 0.24 };
    const sequence = generateSequence(91, {
      attackingHome: true,
      startingPlayerIdx: 6,
      sourceOverride: source,
      transition: true,
    });

    expect(sequence.phases[0]).toMatchObject({
      passerIdx: 6,
      pattern: 'counter',
      stage: 'transition',
      sourceOverride: source,
    });
    expect(sequence.phases.every(phase => phase.pattern === 'counter')).toBe(true);
  });

  it('gives structured restarts enough setup time without slowing second balls', () => {
    expect(restartReleaseDelay('kickoff')).toBeGreaterThan(restartReleaseDelay('goal_kick'));
    expect(restartReleaseDelay('goal_kick')).toBeGreaterThan(restartReleaseDelay('second_ball'));

    const restart = generateSequence(191, {
      attackingHome: false,
      startingPlayerIdx: 0,
      sourceOverride: { x: 0.92, y: 0.5 },
      restart: 'goal_kick',
    });
    expect(restart.phases[0]).toMatchObject({
      restart: 'goal_kick',
      releaseDelayFrames: 24,
      sourceOverride: { x: 0.92, y: 0.5 },
    });
  });

  it('stages an authoritative chance after a visible turnover before releasing the shot', () => {
    const source = { x: 0.44, y: 0.32 };
    const sequence = generateSequence(92, {
      attackingHome: false,
      forceShot: true,
      startingPlayerIdx: 6,
      creatorIdx: 8,
      shooterIdx: 9,
      sourceOverride: source,
      transition: true,
    });
    const passes = sequence.phases.filter(phase => phase.kind === 'pass');
    const shot = sequence.phases.at(-1)!;

    expect(passes[0]).toMatchObject({
      passerIdx: 6,
      pattern: 'counter',
      stage: 'transition',
      sourceOverride: source,
      releaseDelayFrames: 18,
    });
    expect(shot).toMatchObject({ kind: 'shot', pattern: 'counter', stage: 'finish', releaseDelayFrames: 14 });
    expect(shot.duration).toBeGreaterThanOrEqual(30);
    expect(shot.hold).toBeGreaterThanOrEqual(20);
  });

  it('gives directed chances distinct deterministic delivery shapes', () => {
    const common = {
      attackingHome: true,
      forceShot: true,
      startingPlayerIdx: 6,
      creatorIdx: 7,
      shooterIdx: 9,
      sourceOverride: { x: 0.5, y: 0.5 },
    } as const;
    const cross = generateSequence(118, { ...common, chanceStyle: 'cross' });
    const cutback = generateSequence(118, { ...common, chanceStyle: 'cutback' });
    const throughBall = generateSequence(118, { ...common, chanceStyle: 'through_ball' });

    expect(cross.phases[0].chanceStyle).toBe('cross');
    expect(cross.phases.at(-2)?.arc).toBeGreaterThan(0.6);
    expect(cutback.phases.at(-2)?.arc).toBeLessThan(0.07);
    expect(throughBall.phases.at(-2)?.targetOverride?.x).toBeGreaterThan(0.84);
    expect(cross.phases[0].targetOverride).not.toEqual(cutback.phases[0].targetOverride);
  });

  it('progresses toward goal unless the episode explicitly recycles possession', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const sequence = generateSequence(seed, { attackingHome: true });
      if (sequence.phases[0]?.pattern === 'recycle') continue;
      const targets = sequence.phases.map(phase => phase.targetOverride!.x);
      expect(targets.every((target, index) => index === 0 || target >= targets[index - 1] - 0.025)).toBe(true);
    }
  });

  it('uses the selected shape when choosing creators and finishers', () => {
    const formation = getFormationSlots('5-4-1');
    const sequence = generateSequence(20260812, {
      attackingHome: true,
      forceShot: true,
      homeFormation: '5-4-1',
      awayFormation: '4-3-3',
    });
    const shot = sequence.phases.at(-1)!;

    expect(formation).toHaveLength(11);
    expect(formation.filter(slot => slot.role === 'DF')).toHaveLength(5);
    expect(formation.filter(slot => slot.role === 'FW')).toHaveLength(1);
    expect(formation[shot.receiverIdx].role).toBe('FW');
    expect(sequence.phases.every(phase => phase.passerIdx >= 0 && phase.passerIdx < 11)).toBe(true);
  });

  it('turns the frozen approach into a bounded readable team posture', () => {
    const pressing = getTacticalFormationSlots('4-3-3', 'pressing');
    const lowBlock = getTacticalFormationSlots('4-3-3', 'low_block');
    const counter = getTacticalFormationSlots('5-4-1', 'counter');

    expect(pressing[6].x).toBeGreaterThan(lowBlock[6].x);
    expect(Math.abs(lowBlock[1].y - lowBlock[4].y)).toBeLessThan(
      Math.abs(pressing[1].y - pressing[4].y),
    );
    expect(counter.find(slot => slot.role === 'FW')!.x).toBeGreaterThan(
      getFormationSlots('5-4-1').find(slot => slot.role === 'FW')!.x,
    );
    expect([...pressing, ...lowBlock, ...counter].every(slot =>
      slot.x >= 0.05 && slot.x <= 0.62 && slot.y >= 0.07 && slot.y <= 0.93
    )).toBe(true);
  });

  it('uses the coach approach to weight possession routes without losing deterministic playback', () => {
    const counterPatterns: string[] = [];
    const controlPatterns: string[] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const counter = generateSequence(seed, {
        attackingHome: true,
        homeFormation: '4-4-2',
        homeApproach: 'counter',
      });
      const control = generateSequence(seed, {
        attackingHome: true,
        homeFormation: '4-4-2',
        homeApproach: 'control',
      });
      counterPatterns.push(counter.phases[0]?.pattern ?? '');
      controlPatterns.push(control.phases[0]?.pattern ?? '');
      expect(generateSequence(seed, {
        attackingHome: true,
        homeFormation: '4-4-2',
        homeApproach: 'counter',
      })).toEqual(counter);
    }

    expect(counterPatterns.filter(pattern => pattern === 'counter').length).toBeGreaterThan(45);
    expect(controlPatterns.filter(pattern => pattern === 'counter')).toHaveLength(0);
    expect(controlPatterns.filter(pattern => (
      pattern === 'build_up' || pattern === 'central_combination' || pattern === 'switch_play'
    )).length).toBeGreaterThan(70);
  });

  it('gives each formation several valid route variants and a distinct positional identity', () => {
    const formations = ['4-3-3', '4-2-3-1', '4-4-2', '5-4-1'] as const;
    const representativeRoutes = new Set<string>();

    for (const formation of formations) {
      const routes = new Set<string>();
      for (let seed = 1; seed <= 90; seed++) {
        const sequence = generateSequence(seed, {
          attackingHome: true,
          homeFormation: formation,
          homeApproach: 'balanced',
        });
        routes.add(sequence.phases.map(phase => `${phase.passerIdx}>${phase.receiverIdx}`).join('|'));
        expect(sequence.phases.every(phase => (
          phase.passerIdx >= 0 && phase.passerIdx < 11
          && phase.receiverIdx >= 0 && phase.receiverIdx < 11
          && phase.targetOverride !== undefined
          && phase.targetOverride.x >= 0.03 && phase.targetOverride.x <= 0.97
          && phase.targetOverride.y >= 0.05 && phase.targetOverride.y <= 0.95
        ))).toBe(true);
      }
      expect(routes.size).toBeGreaterThan(20);

      const representative = generateSequence(1, {
        attackingHome: true,
        homeFormation: formation,
        homeApproach: 'balanced',
      });
      representativeRoutes.add(representative.phases.map(phase => `${phase.passerIdx}>${phase.receiverIdx}`).join('|'));
    }

    expect(representativeRoutes.size).toBe(formations.length);
  });
});

/**
 * Ball height is measured in units of a drawn player. The pitch is 520 logical
 * units for 105 m and a player is 1.82 m, so one player is 9.01 units and the
 * renderer lifts the ball by arc * 22.
 */
const PLAYER_UNITS = 1.82 / (105 / 520);
const MAX_LIFT = 22;
const playerHeights = (arc: number) => (arc * MAX_LIFT) / PLAYER_UNITS;

describe('pass height', () => {
  it('keeps a counter on the deck while a switch of play climbs', () => {
    // The whole point: at the same distance these are different passes. A
    // counter is threaded into space; a switch has to clear a midfield.
    for (const travel of [0.2, 0.3, 0.4, 0.45]) {
      const counter = playerHeights(passArc(travel, 'counter', 0.5));
      const switchPlay = playerHeights(passArc(travel, 'switch_play', 0.5));
      expect(counter).toBeLessThan(switchPlay);
    }
  });

  it('never lofts a counter, however far it goes', () => {
    for (let travel = 0.05; travel <= 0.7; travel += 0.01) {
      for (const roll of [0, 0.5, 1]) {
        expect(playerHeights(passArc(travel, 'counter', roll))).toBeLessThan(0.8);
      }
    }
  });

  it('still lets a long ball and a switch of play get up in the air', () => {
    expect(playerHeights(passArc(0.66, 'build_up', 1))).toBeGreaterThan(1.8);
    expect(playerHeights(passArc(0.36, 'switch_play', 1))).toBeGreaterThan(1.4);
  });

  it('leaves a short combination at ankle height', () => {
    for (const pattern of ['central_combination', 'recycle', 'counter'] as const) {
      expect(playerHeights(passArc(0.16, pattern, 1))).toBeLessThan(0.4);
    }
  });

  it('rises smoothly with distance instead of stepping at a threshold', () => {
    // The steepest the curve ever gets is about 16% more height per extra metre
    // of pass, which at that point is 0.38 m of peak. The rule this replaced
    // stepped from 0.12 to 0.55 arc — a 350% jump — at a fixed distance.
    for (const pattern of ['counter', 'switch_play', 'build_up', 'wing_overload'] as const) {
      let previous = passArc(0.05, pattern, 0.5);
      for (let travel = 0.06; travel <= 0.7; travel += 0.01) {
        const current = passArc(travel, pattern, 0.5);
        expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
        expect((current - previous) / previous).toBeLessThan(0.2);
        previous = current;
      }
    }
  });

  it('does not jump when a pass crosses the old 0.34 threshold', () => {
    // The reported bug: a pass that grew by a metre went from ankle height to
    // more than twice a player's height in a single frame.
    for (const pattern of ['counter', 'switch_play', 'build_up'] as const) {
      const below = passArc(0.335, pattern, 0.5);
      const above = passArc(0.345, pattern, 0.5);
      expect((above - below) / below).toBeLessThan(0.1);
    }
  });

  it('holds every pattern inside a believable ceiling', () => {
    // 95th-percentile travel for each pattern, measured over 11,314 generated
    // phases. Judging a switch of play at 70 m says nothing about the passes a
    // viewer actually sees, so each pattern is held to its own range.
    const usualTravel: Readonly<Record<string, number>> = {
      counter: 0.42, switch_play: 0.37, build_up: 0.68,
      wing_overload: 0.33, central_combination: 0.21, recycle: 0.3,
    };
    const patterns = ['counter', 'switch_play', 'build_up', 'wing_overload',
      'central_combination', 'recycle'] as const;
    for (const pattern of patterns) {
      // 2.6 players is 4.7 m, about as high as a struck long ball climbs.
      const realistic = playerHeights(passArc(usualTravel[pattern], pattern, 1));
      expect(realistic).toBeGreaterThan(0);
      expect(realistic).toBeLessThan(2.6);
      // Even a physically impossible full-pitch ball stays under 5.5 m.
      expect(playerHeights(passArc(1, pattern, 1))).toBeLessThan(3);
    }
  });

  it('treats an unknown pattern as a flat one', () => {
    expect(passArc(0.5, undefined, 0.5)).toBeLessThan(passArc(0.5, 'switch_play', 0.5));
  });
});

describe('carried ball height', () => {
  it('settles a ball cut out at the top of its arc instead of dropping it', () => {
    let carry = 20;
    const drawn: number[] = [];
    for (let frame = 0; frame < 60 && carry > 0; frame++) {
      const step = decayBallLiftCarry(carry);
      drawn.push(step.applied);
      carry = step.remaining;
    }
    expect(drawn[0]).toBe(20);
    expect(drawn.length).toBeGreaterThan(8);
    expect(drawn.length).toBeLessThan(40);
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeLessThan(drawn[i - 1]);
    expect(carry).toBe(0);
  });

  it('leaves a ball that was already on the grass alone', () => {
    expect(decayBallLiftCarry(0)).toEqual({ applied: 0, remaining: 0 });
    expect(decayBallLiftCarry(LIFT_CARRY_FLOOR)).toEqual({ applied: 0, remaining: 0 });
    expect(decayBallLiftCarry(-5)).toEqual({ applied: 0, remaining: 0 });
    expect(decayBallLiftCarry(Number.NaN)).toEqual({ applied: 0, remaining: 0 });
  });
});

describe('camera cuts inside a possession', () => {
  it('never cuts between two ordinary passes', () => {
    // The regression this locks down. `build` used to resolve to the high
    // camera and `attack` to the main one, keyed on the stage of the pass
    // currently in flight. Every possession runs build -> progress -> create,
    // so every possession cut once at the same point: measured over 3,000
    // generated sequences, 3,000 produced exactly one cut and every one of
    // them was tactical -> sideline. Open play now holds the main camera, so
    // the only cuts left are the ones a director would actually make.
    let ordinaryCuts = 0;
    let possessions = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const sequence = generateSequence(seed, { attackingHome: seed % 2 === 0 });
      possessions++;
      let previous: { rig: string; directed: boolean } | null = null;
      for (const phase of sequence.phases) {
        const directed = phase.kind === 'shot' || Boolean(phase.setPiece);
        const moment: BroadcastCameraMoment = phase.kind === 'shot'
          ? 'finish'
          : phase.setPiece
            ? 'set_piece'
            : phase.stage === 'create' || phase.stage === 'finish'
              ? 'attack'
              : 'build';
        const ballLength = Math.min(1, Math.max(0, phase.targetOverride?.x ?? 0.5));
        const rig = rigForMoment(moment, phase.attackingHome, ballLength).id;
        if (previous !== null && previous.rig !== rig && !directed && !previous.directed) {
          ordinaryCuts++;
        }
        previous = { rig, directed };
      }
    }
    expect(possessions).toBe(600);
    expect(ordinaryCuts).toBe(0);
  });
});
describe('directed attack length', () => {
  const attack = (seed: number) => generateSequence(seed, {
    attackingHome: seed % 2 === 0,
    forceShot: true,
    startingPlayerIdx: 2 + (seed % 8),
    sourceOverride: { x: 0.12 + (seed % 40) / 100, y: 0.2 + (seed % 55) / 100 },
  });

  it('builds a goalscoring move from eight passes or more', () => {
    // The regression this locks down. The directed route used to be three
    // players — the man on the ball, the creator, the shooter — so every goal
    // in the broadcast arrived after two passes and about a second of
    // football, and the attack had nothing to hold the clock for.
    const counts: number[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      const sequence = attack(seed);
      const passes = sequence.phases.filter(phase => phase.kind === 'pass');
      counts.push(passes.length);
      expect(passes.some(pass => pass.passerIdx === pass.receiverIdx)).toBe(false);
      expect(sequence.phases[sequence.phases.length - 1].kind).toBe('shot');
    }
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(8);
    expect(counts.reduce((sum, count) => sum + count, 0) / counts.length)
      .toBeGreaterThanOrEqual(8.5);
  });

  it('keeps every pass of the move on the pitch and finishes in the final third', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const attackingHome = seed % 2 === 0;
      const sequence = attack(seed);
      const passes = sequence.phases.filter(phase => phase.kind === 'pass');

      for (const pass of passes) {
        const target = pass.targetOverride;
        expect(target).toBeDefined();
        expect(target!.x).toBeGreaterThanOrEqual(0.03);
        expect(target!.x).toBeLessThanOrEqual(0.97);
        expect(target!.y).toBeGreaterThanOrEqual(0.05);
        expect(target!.y).toBeLessThanOrEqual(0.95);
      }

      // The last pass is the one the shooter finishes, so it has to arrive
      // somewhere a shot could actually be taken from.
      const last = passes[passes.length - 1].targetOverride!;
      const progress = attackingHome ? last.x : 1 - last.x;
      expect(progress).toBeGreaterThanOrEqual(0.78);
    }
  });

  it('never cuts the camera between two passes of the same attack', () => {
    // An attack is now ten passes long instead of two, so the question the
    // open-play test asks is worth asking here too: the whole move is one
    // passage of football and it belongs to one camera.
    let cuts = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const sequence = attack(seed);
      let previous: string | null = null;
      for (const pass of sequence.phases.filter(phase => phase.kind === 'pass')) {
        const moment: BroadcastCameraMoment = pass.stage === 'create' || pass.stage === 'finish'
          ? 'attack'
          : 'build';
        const ballLength = Math.min(1, Math.max(0, pass.targetOverride?.x ?? 0.5));
        const rig = rigForMoment(moment, pass.attackingHome, ballLength).id;
        if (previous !== null && previous !== rig) cuts++;
        previous = rig;
      }
    }
    expect(cuts).toBe(0);
  });
});
