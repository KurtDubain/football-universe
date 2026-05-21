import { PlayerTag } from '../../types/player';

/**
 * v17+ — assign a personality tag to a player based on a deterministic
 * hash of their uuid. ~45% of players get a tag; 55% get none.
 *
 * Distribution:
 *   10% loyal         — never poached
 *   10% ambitious     — 1.5× poach probability
 *    5% iron          — 1/3 injury rate
 *    5% glass         — 2× injury rate, 0.7× market value
 *    6% clutch        — +30% goal weight in finals + derbies
 *    4% late_bloomer  — peakAge 28-32 (vs default 24-29)
 *    5% wanderer      — 8%/season chance to self-release to pool
 *   55% (none)        — default behavior
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
  // 0-9: loyal, 10-19: ambitious, 20-24: iron, 25-29: glass,
  // 30-35: clutch, 36-39: late_bloomer, 40-44: wanderer, 45-99: none
  if (bucket < 10) return 'loyal';
  if (bucket < 20) return 'ambitious';
  if (bucket < 25) return 'iron';
  if (bucket < 30) return 'glass';
  if (bucket < 36) return 'clutch';
  if (bucket < 40) return 'late_bloomer';
  if (bucket < 45) return 'wanderer';
  return undefined;
}

/** Display label + color class for a tag. Used by PlayerDetail. */
export const TAG_META: Record<PlayerTag, { label: string; icon: string; color: string }> = {
  loyal:        { label: '忠诚',     icon: '🛡️', color: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40' },
  ambitious:    { label: '野心家',   icon: '🚀', color: 'bg-orange-900/40 text-orange-300 border-orange-700/40' },
  iron:         { label: '铁人',     icon: '💪', color: 'bg-slate-700/60 text-slate-300 border-slate-600/40' },
  glass:        { label: '玻璃人',   icon: '🩹', color: 'bg-red-900/40 text-red-300 border-red-700/40' },
  clutch:       { label: '大心脏',   icon: '❤️‍🔥', color: 'bg-rose-900/40 text-rose-300 border-rose-700/40' },
  late_bloomer: { label: '大器晚成', icon: '🌾', color: 'bg-amber-900/40 text-amber-300 border-amber-700/40' },
  wanderer:     { label: '浪子',     icon: '🎒', color: 'bg-violet-900/40 text-violet-300 border-violet-700/40' },
};
