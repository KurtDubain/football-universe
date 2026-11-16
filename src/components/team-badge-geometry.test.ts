import { describe, expect, it } from 'vitest';
import {
  BADGE_FRAME_PATHS,
  BADGE_PATTERN_SHAPES,
  BADGE_SYMBOL_PATHS,
  badgeShade,
  hashTeamId,
  teamBadgeParts,
} from './team-badge-geometry';

describe('teamBadgeParts', () => {
  it('gives one club the same crest every time', () => {
    expect(teamBadgeParts('datong', '大同')).toEqual(teamBadgeParts('datong', '大同'));
  });

  it('spreads a league across every frame, symbol and pattern', () => {
    const frames = new Set<string>();
    const symbols = new Set<number>();
    const patterns = new Set<number>();
    for (let index = 0; index < 400; index += 1) {
      const parts = teamBadgeParts(`club-${index}`, '队');
      frames.add(parts.frame);
      symbols.add(parts.symbolIndex);
      patterns.add(parts.patternIndex);
    }
    expect(frames.size).toBe(BADGE_FRAME_PATHS.length);
    expect(symbols.size).toBe(BADGE_SYMBOL_PATHS.length);
    expect(patterns.size).toBe(BADGE_PATTERN_SHAPES.length);
  });

  it('keeps every index inside its table', () => {
    for (let index = 0; index < 200; index += 1) {
      const parts = teamBadgeParts(`club-${index}`, '队');
      expect(BADGE_FRAME_PATHS[parts.frameIndex]).toBe(parts.frame);
      expect(parts.symbolIndex).toBeLessThan(BADGE_SYMBOL_PATHS.length);
      expect(parts.patternIndex).toBeLessThan(BADGE_PATTERN_SHAPES.length);
    }
  });

  it('falls back to the short name when a club has no id', () => {
    expect(teamBadgeParts(undefined, '恒大').seed).toBe(hashTeamId('恒大'));
  });

  it('takes at most two characters for the nameplate', () => {
    expect(teamBadgeParts('x', '广州恒大').label).toBe('广州');
    expect(teamBadgeParts('x', '大').label).toBe('大');
  });
});

describe('badgeShade', () => {
  it('blends toward black and white', () => {
    expect(badgeShade('#ffffff', -1)).toBe('rgb(0,0,0)');
    expect(badgeShade('#000000', 1)).toBe('rgb(255,255,255)');
    expect(badgeShade('#808080', 0)).toBe('rgb(128,128,128)');
  });

  it('falls back rather than throwing on a colour it cannot parse', () => {
    expect(badgeShade('rebeccapurple', -0.5)).toBe('#111820');
    expect(badgeShade('rebeccapurple', 0.5)).toBe('#dce5ec');
  });
});