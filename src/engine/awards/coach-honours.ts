import type { GameWorld } from '../season/season-manager';
import type { SeasonRecord } from '../../types/team';

/**
 * The two coaching honours a season can print.
 *
 * There is no coach award in the simulation: a coach is not a stat line, and
 * inventing one would mean inventing a metric the engine never produced. What
 * the season does record is where every club was expected to finish
 * (TeamBase.expectation, 1-5) and where it actually finished. These honours
 * read only that.
 *
 * The champion gets a card of its own because the overperformance baseline
 * excludes them by construction: an expectation-5 side maps to expected
 * position 0, so the best club in the league rates negative even when it wins
 * it. One card alone would be wrong in both directions.
 */
export type CoachHonourKind = 'champion_coach' | 'best_coach';

export interface CoachHonour {
  kind: CoachHonourKind;
  coachId: string;
  coachName: string;
  teamId: string;
  /** Final position in the top flight. */
  leaguePosition: number;
  /**
   * How many places the club beat its expectation by.
   *
   * Meaningful for best_coach; recorded for the champion too so the two cards
   * cannot disagree about the same baseline.
   */
  overperformance: number;
}

type LeagueOneRecord = SeasonRecord & { teamId: string };

/** Top-flight records for one season, already ordered by final position. */
export function leagueOneRecords(world: GameWorld, seasonNumber: number): LeagueOneRecord[] {
  const records: LeagueOneRecord[] = [];
  for (const [teamId, entries] of Object.entries(world.teamSeasonRecords)) {
    const record = entries.find(entry => entry.seasonNumber === seasonNumber);
    if (record && record.leagueLevel === 1) records.push({ ...record, teamId });
  }
  return records.sort((a, b) => a.leaguePosition - b.leaguePosition);
}

/**
 * Expected finishing position from the club's own pre-season expectation.
 *
 * The expectation runs 1-5, mapped across the size of the division, so a
 * top-seeded side expects to finish first and a bottom-seeded one expects to
 * finish last.
 */
export function expectedPositionFor(
  world: GameWorld,
  teamId: string,
  divisionSize: number,
): number {
  const expectation = world.teamBases[teamId]?.expectation ?? 3;
  return Math.round(divisionSize * (1 - (expectation - 1) / 4));
}

/**
 * 冠军教头 (the champion's coach) and 最佳教练 (the biggest overperformance
 * among the rest).
 *
 * Returns an empty list when the top flight has not produced a table, so a
 * ceremony can never print an honour the season did not earn.
 */
export function deriveCoachHonours(world: GameWorld, seasonNumber: number): CoachHonour[] {
  const records = leagueOneRecords(world, seasonNumber);
  if (records.length === 0) return [];

  const beat = (record: LeagueOneRecord) =>
    expectedPositionFor(world, record.teamId, records.length) - record.leaguePosition;
  const toHonour = (kind: CoachHonourKind, record: LeagueOneRecord): CoachHonour => ({
    kind,
    coachId: record.coachId,
    coachName: world.coachBases[record.coachId]?.name ?? '未知',
    teamId: record.teamId,
    leaguePosition: record.leaguePosition,
    overperformance: beat(record),
  });

  const champion = records[0];
  const honours: CoachHonour[] = [toHonour('champion_coach', champion)];

  const rest = records.filter(record => record.teamId !== champion.teamId);
  if (rest.length > 0) {
    const best = rest.reduce((a, b) => (beat(b) > beat(a) ? b : a));
    honours.push(toHonour('best_coach', best));
  }

  return honours;
}
