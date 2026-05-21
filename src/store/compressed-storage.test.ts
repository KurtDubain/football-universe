// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { compressedStorage } from './compressed-storage';

beforeEach(() => {
  localStorage.clear();
});

describe('compressedStorage', () => {
  it('round-trip: setItem → getItem returns the same value', () => {
    const value = JSON.stringify({ a: 1, b: 'hello', nested: { x: [1, 2, 3] } });
    compressedStorage.setItem('test', value);
    const read = compressedStorage.getItem('test');
    expect(read).toBe(value);
  });

  it('compressed bytes on disk are significantly smaller than plaintext', () => {
    // Build a payload that simulates a real-ish game state — lots of
    // repeated keys + numeric IDs (which LZ-string handles well).
    const payload = JSON.stringify({
      squads: Object.fromEntries(
        Array.from({ length: 20 }, (_, t) => [
          `team-${t}`,
          Array.from({ length: 25 }, (_, p) => ({
            uuid: `p-${t}-${p}`,
            teamId: `team-${t}`,
            name: 'Player Name',
            number: p + 1,
            position: 'FW',
            rating: 70 + p,
            peakRating: 80,
            peakAge: 27,
            goalScoring: 50,
            marketValue: 20,
            age: 25,
          })),
        ]),
      ),
    });

    compressedStorage.setItem('test', payload);
    const onDisk = localStorage.getItem('test');
    expect(onDisk).not.toBeNull();
    // At least 2× compression on a payload this redundant
    expect(onDisk!.length).toBeLessThan(payload.length / 2);
  });

  it('auto-detects legacy uncompressed plaintext on read', () => {
    const plain = JSON.stringify({ legacy: true });
    // Write directly via localStorage to simulate a v1 (uncompressed) save
    localStorage.setItem('legacy', plain);
    const read = compressedStorage.getItem('legacy');
    expect(read).toBe(plain);
  });

  it('handles missing keys by returning null', () => {
    expect(compressedStorage.getItem('nope')).toBeNull();
  });

  it('removeItem removes the key', () => {
    compressedStorage.setItem('todelete', 'value');
    compressedStorage.removeItem('todelete');
    expect(localStorage.getItem('todelete')).toBeNull();
  });
});
