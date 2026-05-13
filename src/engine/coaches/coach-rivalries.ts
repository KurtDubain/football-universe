import { GameWorld, MatchHistoryEntry } from '../season/season-manager';
import { buildTeamCoachMap } from './coach-lookup';

export interface CoachRivalry {
  opponentCoachId: string;
  opponentName: string;
  meetings: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** True if 5+ meetings AND |W-L| <= 2 — qualifies as a true rivalry. */
  isRival: boolean;
}

/**
 * Compute head-to-head record for a given coach against every other coach
 * they've faced across all archived matches.
 *
 * Sources:
 * - world.matchHistory entries with homeCoachId / awayCoachId set
 * - Plus current season's calendar matches where the current coachStates
 *   give a best-effort approximation (derived via buildTeamCoachMap, since
 *   teamStates no longer carries currentCoachId after the v6 → v7 refactor)
 *
 * Returns top N rivalries sorted by meetings desc.
 */
export function computeCoachRivalries(
  world: GameWorld,
  coachId: string,
  topN: number = 5,
): CoachRivalry[] {
  type Tally = { w: number; d: number; l: number; gf: number; ga: number; n: number };
  const tally = new Map<string, Tally>();

  function addEntry(theirCoachId: string, gf: number, ga: number) {
    if (theirCoachId === coachId) return; // skip self
    const t = tally.get(theirCoachId) ?? { w: 0, d: 0, l: 0, gf: 0, ga: 0, n: 0 };
    if (gf > ga) t.w++;
    else if (gf < ga) t.l++;
    else t.d++;
    t.gf += gf;
    t.ga += ga;
    t.n++;
    tally.set(theirCoachId, t);
  }

  function processEntry(e: MatchHistoryEntry) {
    if (!e.homeCoachId || !e.awayCoachId) return;
    if (e.homeCoachId === coachId) {
      addEntry(e.awayCoachId, e.homeGoals, e.awayGoals);
    } else if (e.awayCoachId === coachId) {
      addEntry(e.homeCoachId, e.awayGoals, e.homeGoals);
    }
  }

  for (const entry of world.matchHistory ?? []) {
    processEntry(entry);
  }

  // Also pick up current-season completed matches (using current coach assignments).
  // Build the teamId → coachId map once for the whole pass.
  if (world.seasonState?.calendar) {
    const currentSeason = world.seasonState.seasonNumber;
    const teamCoachMap = buildTeamCoachMap(world.coachStates);
    for (const w of world.seasonState.calendar) {
      if (!w.completed || !w.results) continue;
      for (const r of w.results) {
        const homeCoach = teamCoachMap.get(r.homeTeamId);
        const awayCoach = teamCoachMap.get(r.awayTeamId);
        if (!homeCoach || !awayCoach) continue;
        processEntry({
          season: currentSeason,
          homeId: r.homeTeamId,
          awayId: r.awayTeamId,
          homeGoals: r.homeGoals + (r.etHomeGoals ?? 0),
          awayGoals: r.awayGoals + (r.etAwayGoals ?? 0),
          comp: r.competitionName,
          homeCoachId: homeCoach,
          awayCoachId: awayCoach,
        });
      }
    }
  }

  const rivalries: CoachRivalry[] = [];
  for (const [oid, t] of tally) {
    const name = world.coachBases[oid]?.name ?? oid;
    rivalries.push({
      opponentCoachId: oid,
      opponentName: name,
      meetings: t.n,
      wins: t.w,
      draws: t.d,
      losses: t.l,
      goalsFor: t.gf,
      goalsAgainst: t.ga,
      isRival: t.n >= 5 && Math.abs(t.w - t.l) <= 2,
    });
  }

  rivalries.sort((a, b) => b.meetings - a.meetings || (b.wins - a.losses) - (a.wins - b.losses));
  return rivalries.slice(0, topN);
}
