// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compressedStorage, __flushCompressedStorageForTests } from './compressed-storage';

beforeEach(() => {
  __flushCompressedStorageForTests();
  localStorage.clear();
});

describe('compressedStorage', () => {
  it('round-trip: setItem → getItem returns the same value (in-memory pending)', () => {
    const value = JSON.stringify({ a: 1, b: 'hello', nested: { x: [1, 2, 3] } });
    compressedStorage.setItem('test', value);
    // Immediate getItem reads the pending in-memory buffer (no flush yet).
    expect(compressedStorage.getItem('test')).toBe(value);
  });

  it('round-trip after flush: writes survive localStorage', () => {
    const value = JSON.stringify({ a: 1, b: 'hello' });
    compressedStorage.setItem('test', value);
    __flushCompressedStorageForTests();
    // Now the in-memory pending is cleared; getItem decompresses from localStorage.
    expect(compressedStorage.getItem('test')).toBe(value);
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
    __flushCompressedStorageForTests();
    const onDisk = localStorage.getItem('test');
    expect(onDisk).not.toBeNull();
    // At least 2× compression on a payload this redundant
    expect(onDisk!.length).toBeLessThan(payload.length / 2);
  });

  it('reads an uncompressed current JSON representation', () => {
    const plain = JSON.stringify({ current: true });
    localStorage.setItem('plain', plain);
    const read = compressedStorage.getItem('plain');
    expect(read).toBe(plain);
  });

  it('handles missing keys by returning null', () => {
    expect(compressedStorage.getItem('nope')).toBeNull();
  });

  it('removeItem removes the key (and cancels any pending write)', () => {
    compressedStorage.setItem('todelete', 'value');
    compressedStorage.removeItem('todelete');
    __flushCompressedStorageForTests();
    expect(localStorage.getItem('todelete')).toBeNull();
  });

  it('debounces rapid writes — only one compress lands per debounce window', () => {
    // Set the same key 5 times rapidly with different values.
    for (let i = 0; i < 5; i++) {
      compressedStorage.setItem('debounce', JSON.stringify({ count: i }));
    }
    // Before flush, localStorage has nothing yet (debounced).
    expect(localStorage.getItem('debounce')).toBeNull();
    // After flush, only the LAST value persists.
    __flushCompressedStorageForTests();
    const read = compressedStorage.getItem('debounce');
    expect(read).toBe(JSON.stringify({ count: 4 }));
  });

  it('flushes the newest pending write when the page is hidden', () => {
    compressedStorage.setItem('pagehide', JSON.stringify({ count: 1 }));
    compressedStorage.setItem('pagehide', JSON.stringify({ count: 2 }));

    window.dispatchEvent(new Event('pagehide'));

    expect(localStorage.getItem('pagehide')).not.toBeNull();
    expect(compressedStorage.getItem('pagehide')).toBe(JSON.stringify({ count: 2 }));
  });

  it('retains the newest pending save and emits an error when disk quota fails', () => {
    const value = JSON.stringify({ season: 42 });
    const onError = vi.fn();
    window.addEventListener('football-save-error', onError);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    compressedStorage.setItem('quota-save', value);
    __flushCompressedStorageForTests();

    expect(compressedStorage.getItem('quota-save')).toBe(value);
    expect(onError).toHaveBeenCalledOnce();
    setItem.mockRestore();
    __flushCompressedStorageForTests();
    expect(compressedStorage.getItem('quota-save')).toBe(value);
    window.removeEventListener('football-save-error', onError);
  });
});
