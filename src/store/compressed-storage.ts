import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import type { StateStorage } from 'zustand/middleware';
import type { CompressionWorkerRequest, CompressionWorkerResponse } from './compression-worker';
import { conservativeUTF16Bytes } from './save-budget';

/**
 * Debounced, compressed persistence for the game save.
 *
 * Runtime Zustand envelopes are queued as objects so JSON serialization and
 * LZ compression can both happen in a Worker. Plain string callers remain
 * supported for import/export and focused storage tests. The newest queued
 * revision always wins; stale Worker responses are ignored.
 */

const WRITE_DEBOUNCE_MS = 250;

interface PendingWrite {
  revision: number;
  payload: unknown;
  serialized: boolean;
}

const writeQueue = new Map<string, PendingWrite>();
const inFlight = new Map<string, number>();
const postMessageCosts = new Map<number, number>();
let nextRevision = 1;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let compressionWorker: Worker | null = null;
let workerUnavailable = false;

function serializePending(entry: PendingWrite): string {
  return entry.serialized ? String(entry.payload) : JSON.stringify(entry.payload);
}

function emitSaveError(name: string): void {
  console.error('[compressed-storage] write failed for', name);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('football-save-error', { detail: { name } }));
  }
}

function persistCompressed(name: string, entry: PendingWrite, compressed: string): void {
  try {
    localStorage.setItem(name, compressed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('football-save-size', {
        detail: { name, bytes: conservativeUTF16Bytes(compressed) },
      }));
    }
    if (writeQueue.get(name)?.revision === entry.revision) writeQueue.delete(name);
  } catch (error) {
    console.error('[compressed-storage] write failed for', name, error);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('football-save-error', { detail: { name } }));
    }
  }
}

function persistSynchronously(name: string, entry: PendingWrite): void {
  try {
    persistCompressed(name, entry, compressToUTF16(serializePending(entry)));
  } catch (error) {
    console.error('[compressed-storage] serialization failed for', name, error);
    emitSaveError(name);
  }
}

function flushWritesSynchronously(): void {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const [name, entry] of [...writeQueue]) {
    inFlight.delete(name);
    postMessageCosts.delete(entry.revision);
    persistSynchronously(name, entry);
  }
}

function disableWorker(): void {
  compressionWorker?.terminate();
  compressionWorker = null;
  workerUnavailable = true;
  inFlight.clear();
}

function handleWorkerMessage(event: MessageEvent<CompressionWorkerResponse>): void {
  const response = event.data;
  const postMessageMs = postMessageCosts.get(response.revision) ?? 0;
  postMessageCosts.delete(response.revision);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('football-save-performance', {
      detail: {
        revision: response.revision,
        postMessageMs,
        serializationMs: response.serializationMs ?? 0,
        compressionMs: response.compressionMs ?? 0,
      },
    }));
  }
  if (inFlight.get(response.name) === response.revision) inFlight.delete(response.name);

  const pending = writeQueue.get(response.name);
  if (!pending || pending.revision !== response.revision) return;

  if (response.error || response.compressed == null) {
    console.error('[compressed-storage] worker failed for', response.name, response.error);
    disableWorker();
    flushWritesSynchronously();
    return;
  }

  persistCompressed(response.name, pending, response.compressed);
}

function getCompressionWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') return null;
  if (compressionWorker) return compressionWorker;
  try {
    compressionWorker = new Worker(new URL('./compression-worker.ts', import.meta.url), { type: 'module' });
    compressionWorker.addEventListener('message', handleWorkerMessage);
    compressionWorker.addEventListener('error', (event) => {
      console.error('[compressed-storage] worker unavailable', event.error ?? event.message);
      disableWorker();
      flushWritesSynchronously();
    });
    return compressionWorker;
  } catch (error) {
    console.warn('[compressed-storage] falling back to main-thread compression', error);
    workerUnavailable = true;
    return null;
  }
}

function flushWrites(): void {
  flushTimer = null;
  const worker = getCompressionWorker();
  if (!worker) {
    flushWritesSynchronously();
    return;
  }

  for (const [name, entry] of writeQueue) {
    if (inFlight.get(name) === entry.revision) continue;
    const request: CompressionWorkerRequest = {
      name,
      revision: entry.revision,
      payload: entry.payload,
      serialized: entry.serialized,
    };
    try {
      inFlight.set(name, entry.revision);
      const postStart = performance.now();
      worker.postMessage(request);
      postMessageCosts.set(entry.revision, performance.now() - postStart);
    } catch (error) {
      console.warn('[compressed-storage] worker postMessage failed; using fallback', error);
      disableWorker();
      flushWritesSynchronously();
      return;
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer != null) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushWrites, WRITE_DEBOUNCE_MS);
}

function queueWrite(name: string, payload: unknown, serialized: boolean): void {
  writeQueue.set(name, { revision: nextRevision++, payload, serialized });
  scheduleFlush();
}

if (typeof window !== 'undefined') {
  const sync = () => {
    if (writeQueue.size > 0) flushWritesSynchronously();
  };
  window.addEventListener('beforeunload', sync);
  window.addEventListener('pagehide', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sync();
  });
}

export const compressedStorage: StateStorage = {
  getItem: (name): string | null => {
    const pending = writeQueue.get(name);
    if (pending) return serializePending(pending);

    const raw = localStorage.getItem(name);
    if (raw == null) return null;
    if (raw.length > 0 && raw[0] === '{') return raw;
    try {
      const decompressed = decompressFromUTF16(raw);
      return decompressed && decompressed.length > 0 ? decompressed : raw;
    } catch {
      return raw;
    }
  },
  setItem: (name, value): void => queueWrite(name, value, true),
  removeItem: (name): void => {
    const revision = writeQueue.get(name)?.revision ?? inFlight.get(name);
    writeQueue.delete(name);
    inFlight.delete(name);
    if (revision != null) postMessageCosts.delete(revision);
    localStorage.removeItem(name);
  },
};

/** Queue a JSON-compatible value without serializing it on the main thread. */
export function queueCompressedJSONValue(name: string, value: unknown): void {
  queueWrite(name, value, false);
}

/** Replace one save synchronously, cancelling any stale queued revision. */
export function replaceCompressedStorageItem(name: string, value: string): void {
  const revision = writeQueue.get(name)?.revision ?? inFlight.get(name);
  writeQueue.delete(name);
  inFlight.delete(name);
  if (revision != null) postMessageCosts.delete(revision);
  if (writeQueue.size === 0 && flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  localStorage.setItem(name, compressToUTF16(value));
}

/** Test helper: force the newest queued revisions to disk synchronously. */
export function __flushCompressedStorageForTests(): void {
  flushWritesSynchronously();
}

/** Test helper: reset Worker and queue state between isolated scenarios. */
export function __resetCompressedStorageForTests(): void {
  if (flushTimer != null) clearTimeout(flushTimer);
  flushTimer = null;
  compressionWorker?.terminate();
  compressionWorker = null;
  workerUnavailable = false;
  writeQueue.clear();
  inFlight.clear();
  postMessageCosts.clear();
  nextRevision = 1;
}
