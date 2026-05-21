import { PlayerTag } from '../../types/player';

/**
 * v17 — assign a personality tag to a player based on a deterministic
 * hash of their uuid. ~30% of players get a tag; 70% get none.
 *
 * Distribution (per spec):
 *   10% loyal      — never poached
 *   10% ambitious  — 1.5× poach probability
 *    5% iron       — 1/3 injury rate
 *    5% glass      — 2× injury rate, 0.7× market value
 *   70% (none)     — default behavior
 *
 * Why uuid-hash (vs RNG): tags are immutable destiny. Using a uuid hash
 * makes the assignment deterministic and reproducible — a migration
 * applied to the same save yields identical tag assignments, which
 * matters for save consistency across reloads.
 */
export function rollTagForUuid(uuid: string): PlayerTag | undefined {
  // FNV-1a hash on uuid → uniform 0-99
  let h = 2166136261;
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const bucket = h % 100;
  // 0-9: loyal, 10-19: ambitious, 20-24: iron, 25-29: glass, 30-99: none
  if (bucket < 10) return 'loyal';
  if (bucket < 20) return 'ambitious';
  if (bucket < 25) return 'iron';
  if (bucket < 30) return 'glass';
  return undefined;
}

/** Display label + color class for a tag. Used by PlayerDetail. */
export const TAG_META: Record<PlayerTag, { label: string; icon: string; color: string }> = {
  loyal:     { label: '忠诚',   icon: '🛡️', color: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40' },
  ambitious: { label: '野心家', icon: '🚀', color: 'bg-orange-900/40 text-orange-300 border-orange-700/40' },
  iron:      { label: '铁人',   icon: '💪', color: 'bg-slate-700/60 text-slate-300 border-slate-600/40' },
  glass:     { label: '玻璃人', icon: '🩹', color: 'bg-red-900/40 text-red-300 border-red-700/40' },
};
