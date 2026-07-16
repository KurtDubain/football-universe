// @vitest-environment jsdom
import { compressToUTF16 } from 'lz-string';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import {
  compressedStorage,
  __flushCompressedStorageForTests,
  __resetCompressedStorageForTests,
  queueCompressedJSONValue,
} from './compressed-storage';
import type { CompressionWorkerRequest, CompressionWorkerResponse } from './compression-worker';

class FakeCompressionWorker {
  static latest: FakeCompressionWorker | null = null;
  readonly requests: CompressionWorkerRequest[] = [];
  private messageListener: ((event: MessageEvent<CompressionWorkerResponse>) => void) | null = null;
  private errorListener: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    FakeCompressionWorker.latest = this;
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.messageListener = listener as (event: MessageEvent<CompressionWorkerResponse>) => void;
    } else if (type === 'error') {
      this.errorListener = listener as (event: ErrorEvent) => void;
    }
  }

  postMessage(request: CompressionWorkerRequest): void {
    this.requests.push(request);
  }

  respond(index: number): void {
    const request = this.requests[index];
    const text = request.serialized ? String(request.payload) : JSON.stringify(request.payload);
    this.messageListener?.({
      data: {
        name: request.name,
        revision: request.revision,
        compressed: compressToUTF16(text),
      },
    } as MessageEvent<CompressionWorkerResponse>);
  }

  fail(): void {
    this.errorListener?.({ message: 'worker failed' } as ErrorEvent);
  }

  terminate(): void {}
}

function readJSON(name: string): unknown {
  return JSON.parse(compressedStorage.getItem(name) as string);
}

beforeEach(() => {
  __resetCompressedStorageForTests();
  __flushCompressedStorageForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetCompressedStorageForTests();
  FakeCompressionWorker.latest = null;
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

  it('reports conservative on-disk bytes after a successful write', () => {
    const onSize = vi.fn();
    window.addEventListener('football-save-size', onSize);
    compressedStorage.setItem('size-event', JSON.stringify({ season: 20 }));
    __flushCompressedStorageForTests();

    const onDisk = localStorage.getItem('size-event')!;
    expect(onSize).toHaveBeenCalledWith(expect.objectContaining({
      detail: { name: 'size-event', bytes: onDisk.length * 2 },
    }));
    window.removeEventListener('football-save-size', onSize);
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

  it('serializes objects in the worker and ignores stale revision responses', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeCompressionWorker);

    queueCompressedJSONValue('worker-save', { season: 1 });
    vi.advanceTimersByTime(250);
    const worker = FakeCompressionWorker.latest!;
    expect(worker.requests).toHaveLength(1);
    expect(localStorage.getItem('worker-save')).toBeNull();

    queueCompressedJSONValue('worker-save', { season: 2 });
    vi.advanceTimersByTime(250);
    expect(worker.requests).toHaveLength(2);

    worker.respond(0);
    expect(localStorage.getItem('worker-save')).toBeNull();

    worker.respond(1);
    expect(readJSON('worker-save')).toEqual({ season: 2 });
  });

  it('falls back synchronously to the newest value when the worker fails', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeCompressionWorker);

    queueCompressedJSONValue('worker-fallback', { season: 9 });
    vi.advanceTimersByTime(250);
    FakeCompressionWorker.latest!.fail();

    expect(readJSON('worker-fallback')).toEqual({ season: 9 });
    expect(localStorage.getItem('worker-fallback')).not.toBeNull();
  });

  it('pagehide commits an in-flight revision and rejects its later worker response', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeCompressionWorker);

    queueCompressedJSONValue('pagehide-worker', { season: 12 });
    vi.advanceTimersByTime(250);
    const worker = FakeCompressionWorker.latest!;
    window.dispatchEvent(new Event('pagehide'));
    expect(readJSON('pagehide-worker')).toEqual({ season: 12 });

    worker.respond(0);
    expect(readJSON('pagehide-worker')).toEqual({ season: 12 });
  });

  it('visibility hide synchronously commits the newest pending revision', () => {
    queueCompressedJSONValue('visibility-save', { season: 14 });
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(readJSON('visibility-save')).toEqual({ season: 14 });
    expect(localStorage.getItem('visibility-save')).not.toBeNull();
    visibilityState.mockRestore();
  });
});
