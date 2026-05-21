import { GameWorld } from '../season/season-manager';
import { Player, PlayerPosition } from '../../types/player';
import { isDerby } from '../../config/derbies';

export interface PlayerRival {
  playerUuid: string;
  playerName: string;
  playerRating: number;
  teamId: string;
  teamName: string;
  teamColor: string;
  /** Same position as the subject — DF/FW/MF/GK match. */
  position: PlayerPosition;
  /** True if rival's team is a derby/historical-rival of the subject's team. */
  isDerbyRival: boolean;
  /** Career awards count (golden boot / mvp / etc.) — narrative weight. */
  awardCount: number;
}

/**
 * Compute "positional rivals" for a player: other players at the same
 * position with the highest current rating, scoped to teams in roughly
 * the same competitive tier (same league level if possible, otherwise
 * the whole universe). Marks derby rivals + counts career awards so the
 * UI can highlight headline matchups.
 *
 * Notes:
 * - We don't have per-player match-level data in matchHistory (it's
 *   team-aggregated), so we can't compute true "minutes-against-each-other"
 *   rivalries. Instead this returns "peers worth watching" — players the
 *   subject is competing with for league/award honors.
 * - For retired-player views, looks up via retirementHistory; rivals are
 *   computed against the snapshot of who's currently active.
 */
export function computePlayerRivals(
  world: GameWorld,
  playerUuid: string,
  topN: number = 3,
): PlayerRival[] {
  // Find the subject player + their team
  let subject: { player: Player; teamId: string } | null = null;
  for (const [teamId, squad] of Object.entries(world.squads)) {
    const p = squad.find(pl => pl.uuid === playerUuid);
    if (p) { subject = { player: p, teamId }; break; }
  }
  if (!subject) return []; // retired or unknown — no rivals
  const subjectTeamState = world.teamStates[subject.teamId];
  const subjectLevel = subjectTeamState?.leagueLevel;

  // Award count helper
  const awardsByPlayer = new Map<string, number>();
  for (const a of (world.playerAwardsHistory ?? [])) {
    awardsByPlayer.set(a.playerId, (awardsByPlayer.get(a.playerId) ?? 0) + 1);
  }

  // Collect candidates from all squads (other teams, same position).
  // Prefer same league level if the subject has one; fall back to all.
  const candidates: PlayerRival[] = [];
  for (const [teamId, squad] of Object.entries(world.squads)) {
    if (teamId === subject.teamId) continue;
    const teamState = world.teamStates[teamId];
    const base = world.teamBases[teamId];
    if (!base) continue;
    // Scope: same league level (preferred). If subject's level unknown, take all.
    if (subjectLevel !== undefined && teamState?.leagueLevel !== subjectLevel) continue;
    for (const p of squad) {
      if (p.position !== subject.player.position) continue;
      candidates.push({
        playerUuid: p.uuid,
        playerName: p.name ?? `${p.number}号`,
        playerRating: p.rating,
        teamId,
        teamName: base.name,
        teamColor: base.color,
        position: p.position,
        isDerbyRival: isDerby(subject.teamId, teamId, world.teamBases),
        awardCount: awardsByPlayer.get(p.uuid) ?? 0,
      });
    }
  }

  // Score: rating × 10 + awardCount × 5 + derby bonus 3
  candidates.sort((a, b) => {
    const sA = a.playerRating * 10 + a.awardCount * 5 + (a.isDerbyRival ? 3 : 0);
    const sB = b.playerRating * 10 + b.awardCount * 5 + (b.isDerbyRival ? 3 : 0);
    return sB - sA;
  });

  return candidates.slice(0, topN);
}
