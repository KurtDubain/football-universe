import { describe, expect, it } from 'vitest';
import { generateSetPieceSequence, setPiecePlayerTarget } from './set-pieces';

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
      releaseDelayFrames: 70,
      sourceOverride: { x: 0.965, y: 0.055 },
    });
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
      releaseDelayFrames: 84,
    });
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
});
