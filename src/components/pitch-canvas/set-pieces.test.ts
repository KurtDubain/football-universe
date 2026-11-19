import { describe, expect, it } from 'vitest';
import {
  SET_PIECE_STAGE_RADIUS,
  generateSetPieceSequence,
  setPiecePlayerTarget,
  stageSetPieceActor,
} from './set-pieces';

describe('set-piece presentation sequences', () => {
  it('builds a corner setup, aerial delivery, and authoritative shot', () => {
    const result = generateSetPieceSequence(17, {
      attackingHome: true,
      setPiece: 'corner',
      side: 'left',
      delivery: 'near_post',
      forceShot: true,
      creatorIdx: 7,
      shooterIdx: 9,
    });

    expect(result.endsInShot).toBe(true);
    expect(result.phases).toHaveLength(2);
    expect(result.phases[0]).toMatchObject({
      kind: 'pass',
      setPiece: 'corner',
      passerIdx: 7,
      receiverIdx: 9,
      releaseDelayFrames: 160,
      sourceOverride: { x: 0.965, y: 0.055 },
    });
    // The setup window is added to the delay and to the duration together, so
    // the delivery itself still takes the 32 frames it always took.
    expect(result.phases[0].duration - result.phases[0].releaseDelayFrames!).toBe(32);
    expect(result.phases[0].arc).toBeGreaterThan(0.8);
    expect(result.phases[1].kind).toBe('shot');
    expect(result.phases[1].sourceOverride).toEqual(result.phases[0].targetOverride);
  });

  it('builds a patient direct free kick without inventing a score outcome', () => {
    const result = generateSetPieceSequence(31, {
      attackingHome: false,
      setPiece: 'direct_free_kick',
      forceShot: false,
      creatorIdx: 6,
    });

    expect(result.endsInShot).toBe(false);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toMatchObject({
      kind: 'pass',
      setPiece: 'direct_free_kick',
      passerIdx: 6,
      releaseDelayFrames: 174,
    });
    expect(result.phases[0].duration - result.phases[0].releaseDelayFrames!).toBe(20);
  });

  it('places a defending wall between a direct free kick and goal', () => {
    const phase = generateSetPieceSequence(41, {
      attackingHome: true,
      setPiece: 'direct_free_kick',
      forceShot: true,
      shooterIdx: 9,
    }).phases[0];
    const wall = [1, 2, 3, 4].map(slot => setPiecePlayerTarget(11 + slot, false, 'DF', phase)!);

    expect(wall.every(target => target.x > phase.sourceOverride!.x)).toBe(true);
    expect(new Set(wall.map(target => target.y)).size).toBe(4);
  });

  it('stages a distant actor just outside their mark, already moving toward it', () => {
    const staged = stageSetPieceActor({ x: 0.2, y: 0.5 }, { x: 0.9, y: 0.5 }, 0.001);

    expect(Math.hypot(staged.x - 0.9, staged.y - 0.5)).toBeCloseTo(SET_PIECE_STAGE_RADIUS, 6);
    expect(staged.vx).toBeCloseTo(0.001, 6);
    expect(staged.vy).toBeCloseTo(0, 6);
  });

  it('leaves an actor who is already close exactly where they are', () => {
    const staged = stageSetPieceActor({ x: 0.895, y: 0.5 }, { x: 0.9, y: 0.5 }, 0.001);

    expect(staged.x).toBe(0.895);
    expect(staged.y).toBe(0.5);
    expect(staged.vx).toBeGreaterThan(0);
  });

  it('never leaves a staged actor further from their mark than the radius', () => {
    const mark = { x: 0.965, y: 0.055 };
    const origins = [
      { x: 0.05, y: 0.95 },
      { x: 0.5, y: 0.5 },
      { x: 1.2, y: -0.3 },
      { x: 0.965, y: 0.055 },
      { x: 0.97, y: 0.05 },
    ];

    for (const origin of origins) {
      const staged = stageSetPieceActor(origin, mark, 0.001);
      const distance = Math.hypot(staged.x - mark.x, staged.y - mark.y);
      expect(distance).toBeLessThanOrEqual(SET_PIECE_STAGE_RADIUS + 1e-9);
      expect(staged.x).toBeGreaterThanOrEqual(0.03);
      expect(staged.x).toBeLessThanOrEqual(0.97);
      expect(staged.y).toBeGreaterThanOrEqual(0.05);
      expect(staged.y).toBeLessThanOrEqual(0.95);
    }
  });
});
