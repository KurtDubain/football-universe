import { preset, namePools } from '../edition/preset';
const { MAINLAND_SURNAMES, MAINLAND_GIVEN, NORTH_GIVEN, WESTERN_SURNAMES, WESTERN_GIVEN, KOREAN_SURNAMES, KOREAN_GIVEN, JAPANESE_SURNAMES, JAPANESE_GIVEN } = namePools;

interface NamePool {
  surnames: string[];
  given: string[];
  /** Separator between surname and given. Western names use '·' so they read
   *  like "史密斯·本杰明"; Asian conventions concatenate with no separator. */
  separator: string;
}

function getRegionPool(region: string): NamePool {
  // Korean — Asian, no separator
  if (preset.peninsulaRegions.some(key => region.includes(key))) {
    return { surnames: KOREAN_SURNAMES, given: KOREAN_GIVEN, separator: '' };
  }
  // Eastern continent → Japanese (no separator)
  if (region.startsWith('东洲')) {
    return { surnames: JAPANESE_SURNAMES, given: JAPANESE_GIVEN, separator: '' };
  }
  // Southern continent → Western transliterated. All sub-regions of 南洲
  // (福建 / 广东 / 海南 / 台湾) share one pool. Middle dot separator.
  if (region.startsWith('南洲')) {
    return { surnames: WESTERN_SURNAMES, given: WESTERN_GIVEN, separator: '·' };
  }
  // Northeast (吉林) and northern variants → some northern flavor
  if (preset.northernRegions.some(key => region.includes(key))) {
    return { surnames: MAINLAND_SURNAMES, given: [...MAINLAND_GIVEN, ...NORTH_GIVEN], separator: '' };
  }
  // Mainland default
  return { surnames: MAINLAND_SURNAMES, given: MAINLAND_GIVEN, separator: '' };
}

/**
 * Generate a unique-within-team player name based on the team's region.
 * Caller passes a Set of already-used names to ensure uniqueness within the squad.
 */
export function pickPlayerName(
  region: string,
  used: Set<string>,
  rngPick: <T>(arr: T[]) => T,
): string {
  const pool = getRegionPool(region);
  // Try up to 30 attempts to get a unique name
  for (let i = 0; i < 30; i++) {
    const surname = rngPick(pool.surnames);
    const given = rngPick(pool.given);
    const name = `${surname}${pool.separator}${given}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Fallback: append a digit suffix
  const surname = rngPick(pool.surnames);
  const given = rngPick(pool.given);
  return `${surname}${pool.separator}${given}${used.size}`;
}
