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
 */
export const compressedStorage: StateStorage = {
  getItem: (name: string): string | null => {
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
    const compressed = compressToUTF16(value);
    localStorage.setItem(name, compressed);
  },
  removeItem: (name: string): void => {
    localStorage.removeItem(name);
  },
};
