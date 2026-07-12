import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import type { StateStorage } from 'zustand/middleware';

/**
 * [D] — Compressed localStorage adapter for zustand persist.
 *
 * Wraps the standard localStorage with LZ-string compression. JSON game
 * state compresses 4-6× thanks to repeated key names + numeric IDs, so a
 * 1MB raw save becomes ~200KB on disk. This buys us comfortable headroom
 * under the 5MB localStorage quota for ~50-100 seasons of play.
 *
 * Auto-detects legacy uncompressed saves on read: any value that parses
 * as valid JSON is treated as v1 plaintext and rewritten compressed on
 * next save. No explicit migration step needed.
 *
 * compressToUTF16 / decompressFromUTF16 — chose UTF16 over Base64 because
 * UTF16 packs 15 bits per character (vs ~6 for Base64), giving ~2.5×
 * better compression. The downside is the bytes can't be inspected as
 * text in DevTools, but the trade-off is worth it for save size.
 *
 * ── PERFORMANCE: debounced writes ───────────────────────────────────
 *
 * Compressing a ~700KB JSON via LZ-string takes 50-80ms on a typical
 * machine. Zustand persist writes on every `set()` — so rapid-fire
 * advances (clicking 推进 repeatedly) used to stack 50-80ms compress
 * costs per click, causing visible micro-stutter between matches.
 *
 * Fix: queue writes with a 250ms trailing debounce. Rapid clicks
 * collapse into ONE compress+write. Final pending write is flushed
 * synchronously on `beforeunload` so tab-close never loses data.
 *
 * Also: tracks last-compressed value so identical re-saves (which
 * can happen during React re-renders) skip the compress step entirely.
 */

const WRITE_DEBOUNCE_MS = 250;

const writeQueue = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastCompressedValue: string | null = null;
let lastCompressedKey: string | null = null;
let lastCompressedOutput: string | null = null;

function flushWrites(): void {
  flushTimer = null;
  for (const [name, value] of [...writeQueue]) {
    let compressed: string;
    if (name === lastCompressedKey && value === lastCompressedValue && lastCompressedOutput != null) {
      compressed = lastCompressedOutput;
    } else {
      compressed = compressToUTF16(value);
      lastCompressedKey = name;
      lastCompressedValue = value;
      lastCompressedOutput = compressed;
    }
    try {
      localStorage.setItem(name, compressed);
      if (writeQueue.get(name) === value) writeQueue.delete(name);
    } catch (e) {
      // Quota exceeded or storage unavailable — surface to console so the
      // user/dev sees it rather than silently losing the save.
      console.error('[compressed-storage] write failed for', name, e);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('football-save-error', { detail: { name } }));
      }
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer != null) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushWrites, WRITE_DEBOUNCE_MS);
}

// Force a synchronous flush on tab unload so the latest state always
// makes it to disk. `pagehide` + `beforeunload` both register because
// browsers vary on which one fires reliably (mobile Safari prefers
// pagehide, desktop fires beforeunload first).
if (typeof window !== 'undefined') {
  const sync = () => {
    if (flushTimer != null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (writeQueue.size > 0) flushWrites();
  };
  window.addEventListener('beforeunload', sync);
  window.addEventListener('pagehide', sync);
  // Also flush when the tab becomes hidden (mobile background, alt-tab).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sync();
  });
}

export const compressedStorage: StateStorage = {
  getItem: (name: string): string | null => {
    // If a write is pending, prefer the in-memory copy — zustand may
    // re-hydrate before our debounced flush lands.
    const pending = writeQueue.get(name);
    if (pending != null) return pending;
    const raw = localStorage.getItem(name);
    if (raw == null) return null;
    // Auto-detect legacy uncompressed format: starts with '{' (JSON object).
    // Compressed strings never start with '{' — they're UTF16 binary data.
    if (raw.length > 0 && raw[0] === '{') {
      return raw;
    }
    try {
      const decompressed = decompressFromUTF16(raw);
      // decompressFromUTF16 returns "" or null on failure. Both are bad.
      if (!decompressed || decompressed.length === 0) {
        // Fall through to returning raw — caller's JSON.parse will throw
        // with a useful error rather than silently dropping the save.
        return raw;
      }
      return decompressed;
    } catch {
      return raw;
    }
  },
  setItem: (name: string, value: string): void => {
    writeQueue.set(name, value);
    scheduleFlush();
  },
  removeItem: (name: string): void => {
    writeQueue.delete(name);
    localStorage.removeItem(name);
  },
};

/**
 * Test helper — force the pending write to flush synchronously.
 * Not called in production code; exists so unit tests don't have to
 * wait WRITE_DEBOUNCE_MS for assertions.
 */
export function __flushCompressedStorageForTests(): void {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (writeQueue.size > 0) flushWrites();
}
