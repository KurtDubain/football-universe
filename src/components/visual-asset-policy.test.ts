import { describe, expect, it } from 'vitest';
import { shouldSuppressDecorativeArtwork } from './visual-asset-policy';

describe('shouldSuppressDecorativeArtwork', () => {
  it('keeps artwork on ordinary desktop and mobile devices', () => {
    expect(shouldSuppressDecorativeArtwork({
      hardwareConcurrency: 8,
      deviceMemory: 8,
    })).toBe(false);
    expect(shouldSuppressDecorativeArtwork({
      hardwareConcurrency: 4,
      deviceMemory: 4,
    })).toBe(false);
  });

  it('uses the live-text fallback for explicit data saving', () => {
    expect(shouldSuppressDecorativeArtwork({
      saveData: true,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    })).toBe(true);
  });

  it('uses the fallback only for extreme low-resource devices', () => {
    expect(shouldSuppressDecorativeArtwork({
      hardwareConcurrency: 1,
      deviceMemory: 4,
    })).toBe(true);
    expect(shouldSuppressDecorativeArtwork({
      hardwareConcurrency: 4,
      deviceMemory: 1,
    })).toBe(true);
  });
});
