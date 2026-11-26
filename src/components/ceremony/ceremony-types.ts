// What a ceremony is, and how long it is allowed to be.
//
// Five moments in a football year carry more weight than a result card can
// hold: a season opening, a season closing, a cup final decided, and the two
// ends of a World Cup. Each one gets a page of the annual it deserves.
//
// The language is print, not particles. A page turns, a stamp lands, four
// colour plates slide into register. Nothing glows, nothing explodes, and
// nothing here is allowed to carry information the simulation did not produce.

export type CeremonyKind =
  | 'season_opening'
  | 'season_closing'
  | 'cup_stamp'
  | 'world_cup_opening'
  | 'world_cup_closing';

/**
 * How long each ceremony runs, in milliseconds.
 *
 * One ladder, in the order the moments matter: a stamp is a beat, a page turn
 * is a breath, a World Cup is the only thing in the product allowed to take
 * three and a half seconds.
 */
export const CEREMONY_DURATION: Readonly<Record<CeremonyKind, number>> = {
  cup_stamp: 1400,
  season_opening: 2200,
  season_closing: 2800,
  world_cup_opening: 3600,
  world_cup_closing: 3600,
};

/**
 * Whether the viewer can stay on the ceremony instead of watching it pass.
 *
 * A cup stamp is a punctuation mark and must not cost a click. The other four
 * are pages of the annual: they wait to be turned.
 */
export const CEREMONY_HOLDS: Readonly<Record<CeremonyKind, boolean>> = {
  cup_stamp: false,
  season_opening: true,
  season_closing: true,
  world_cup_opening: true,
  world_cup_closing: true,
};

export interface CeremonyTeam {
  teamId: string;
  name: string;
  shortName: string;
  color: string;
}

/**
 * One line of an honours list: what was won, who won it, and the fact that
 * decided it.
 *
 * The detail is always something the simulation already recorded — a goal
 * count, a final position, a scoreline. A ceremony never explains an honour
 * with a number the engine did not produce.
 */
export interface CeremonyHonour {
  label: string;
  name: string;
  /** The deciding fact, already formatted. */
  detail: string;
  /** The club the honour belongs to, for its colour plate. */
  team: CeremonyTeam | null;
}

export interface SeasonOpeningCeremony {
  kind: 'season_opening';
  seasonNumber: number;
  /** The shape of the season in three typeset lines. */
  lines: string[];
  /** Competitions whose draws were made in this window. */
  draws: string[];
}

export interface SeasonClosingCeremony {
  kind: 'season_closing';
  seasonNumber: number;
  champion: CeremonyTeam | null;
  /** Top of the final table, already ordered, with the points that placed it. */
  podium: Array<{ team: CeremonyTeam; points: number }>;
  summary: string;
  /** The season's individual player awards, in the order they are printed. */
  playerHonours: CeremonyHonour[];
  /** 冠军教头 and 最佳教练. */
  coachHonours: CeremonyHonour[];
}

export interface CupStampCeremony {
  kind: 'cup_stamp';
  competitionName: string;
  roundLabel: string;
  champion: CeremonyTeam;
  runnerUp: CeremonyTeam | null;
  /** Already formatted, e.g. "2-1" or "1-1 · 点球 4-3". */
  score: string;
  /** The player who decided the final, or null when the final says nothing. */
  finalMvp: CeremonyHonour | null;
  /** The competition's leading scorer across every round. */
  topScorer: CeremonyHonour | null;
}

export interface WorldCupOpeningCeremony {
  kind: 'world_cup_opening';
  edition: number;
  host: CeremonyTeam | null;
  entrants: CeremonyTeam[];
}

export interface WorldCupClosingCeremony {
  kind: 'world_cup_closing';
  edition: number;
  champion: CeremonyTeam;
  finalScore: string;
  /** Golden boot, ballon d or, best coach — already ordered. */
  honours: Array<{ label: string; name: string }>;
}

export type CeremonyRequest =
  | SeasonOpeningCeremony
  | SeasonClosingCeremony
  | CupStampCeremony
  | WorldCupOpeningCeremony
  | WorldCupClosingCeremony;

/**
 * A stable identity for one ceremony, so it cannot fire twice.
 *
 * Every request is derived from world state at render time, which means the
 * component that asks for it re-renders freely. The key is what stops a
 * season opening from replaying on every unrelated state change.
 */
export function ceremonyKey(request: CeremonyRequest): string {
  switch (request.kind) {
    case 'season_opening':
    case 'season_closing':
      return request.kind + ':' + request.seasonNumber;
    case 'world_cup_opening':
    case 'world_cup_closing':
      return request.kind + ':' + request.edition;
    case 'cup_stamp':
      return request.kind + ':' + request.competitionName + ':' + request.roundLabel
        + ':' + request.champion.teamId;
  }
}
