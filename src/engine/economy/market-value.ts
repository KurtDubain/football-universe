import { Player } from '../../types/player';
import { PlayerSeasonStats } from '../../types/player';

/**
 * Compute initial market value from rating + position + age.
 * Returns value in millions (€).
 *
 * Star players (rating 90+) → €60-100M
 * Top tier (rating 80-89) → €25-60M
 * Solid (rating 70-79) → €8-25M
 * Average (rating 60-69) → €2-8M
 * Lower (rating <60) → €0.5-3M
 *
 * Position multipliers: FW 1.2x, MF 1.0x, DF 0.9x, GK 0.8x
 * Age curve: peak 25-29, declines after 30, premium for under-23 youth
 */
export function computeInitialMarketValue(player: Player): number {
  const r = player.rating;
  let base: number;
  if (r >= 90) base = 60 + (r - 90) * 4; // 90→60, 99→96
  else if (r >= 80) base = 25 + (r - 80) * 3.5;
  else if (r >= 70) base = 8 + (r - 70) * 1.7;
  else if (r >= 60) base = 2 + (r - 60) * 0.6;
  else base = 0.5 + Math.max(0, r - 40) * 0.13;

  // Position multiplier
  const posMul = player.position === 'FW' ? 1.2 : player.position === 'MF' ? 1.0 : player.position === 'DF' ? 0.9 : 0.8;

  // Age multiplier
  const ageMul = ageMultiplier(player.age ?? 25);

  return Math.max(0.3, Math.round(base * posMul * ageMul * 10) / 10);
}

function ageMultiplier(age: number): number {
  if (age <= 19) return 1.15; // wonderkid
  if (age <= 22) return 1.10; // young
  if (age <= 25) return 1.05; // rising
  if (age <= 29) return 1.0;  // peak
  if (age <= 32) return 0.85; // veteran
  if (age <= 35) return 0.6;
  return 0.35;
}

/**
 * Annual revaluation at season-end based on stats and team success.
 * Mutates the players array in place — call from season-end.
 */
export function applyAnnualRevaluation(
  squads: Record<string, Player[]>,
  playerStats: Record<string, PlayerSeasonStats>,
  promotedTeamIds: Set<string>,
  championTeamId: string | null,
): void {
  for (const [teamId, players] of Object.entries(squads)) {
    const isPromoted = promotedTeamIds.has(teamId);
    const isChampion = teamId === championTeamId;
    for (const p of players) {
      // Age each player
      const newAge = (p.age ?? 25) + 1;
      p.age = newAge;

      const stats = playerStats[p.uuid];
      let newValue = p.marketValue ?? computeInitialMarketValue(p);

      // Performance bonus
      if (stats) {
        const goals = stats.goals ?? 0;
        const assists = stats.assists ?? 0;
        const involvement = goals * 1.0 + assists * 0.5;
        if (involvement >= 25) newValue *= 1.40;
        else if (involvement >= 15) newValue *= 1.25;
        else if (involvement >= 8) newValue *= 1.10;
        else if (stats.appearances < 5) newValue *= 0.85; // benched
      }

      // Promoted-team boost
      if (isPromoted) newValue *= 1.30;
      // Champion boost
      if (isChampion) newValue *= 1.15;

      // Apply age curve change
      const oldAgeMul = ageMultiplier(newAge - 1);
      const newAgeMul = ageMultiplier(newAge);
      newValue *= newAgeMul / oldAgeMul;

      // Cap and floor
      p.marketValue = Math.max(0.2, Math.min(150, Math.round(newValue * 10) / 10));
    }
  }
}

/** Format value in millions: €85M or €1.5M */
export function formatMarketValue(value: number): string {
  if (value >= 10) return `€${Math.round(value)}M`;
  return `€${value.toFixed(1)}M`;
}

/** Sum a team's squad market value. */
export function getTeamSquadValue(players: Player[]): number {
  return players.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
}
