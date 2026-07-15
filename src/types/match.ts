export type CompetitionType = 'league' | 'league_cup' | 'super_cup' | 'super_cup_group' | 'world_cup' | 'world_cup_group' | 'continental_cup' | 'relegation_playoff';

export interface MatchFixture {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  competitionType: CompetitionType;
  competitionName: string;
  roundLabel: string;
  leg?: 1 | 2; // for two-legged ties
  firstLegResult?: { home: number; away: number }; // for second legs
  /**
   * v23 — set true for matches played at a neutral venue (cup FINALS).
   * When true: no home advantage applied in the simulator, UI hides
   * the (主)/(客) suffix and renders a "中立场" badge instead. The
   * `homeTeamId` / `awayTeamId` fields are still used for stats and
   * event attribution; "home" is just a label, not a venue.
   */
  isNeutralVenue?: boolean;
}

export interface MatchEvent {
  minute: number;
  type:
    | 'goal'
    | 'assist'
    | 'yellow_card'
    | 'red_card'
    | 'save'
    | 'miss'
    /** Penalty shootout goal only. Regular/ET penalties use `goal`. */
    | 'penalty_goal'
    /** Penalty shootout miss only. Regular/ET penalty misses use `miss`. */
    | 'penalty_miss'
    /** Team scoreline event only; never credits a normal player goal. */
    | 'own_goal'
    /** v22 — would-be goal denied by the goalkeeper. */
    | 'gk_save'
    /** v22 — would-be goal blocked on the line by a defender. */
    | 'df_block'
    /** One player leaves and another enters at this minute. */
    | 'substitution';
  teamId: string;
  /** Holds a Player.uuid value (stable across transfers). */
  playerId?: string;
  playerNumber?: number;
  playerName?: string; // assigned player name for display
  description: string;
  /**
   * v22 — for `gk_save` / `df_block` events only. Points to the would-be
   * scorer (and would-be assister, if the original goal had one) so the
   * stats pipeline can credit `bigChances` to the attacker and `keyPasses`
   * to the creator without affecting `goals` / `assists` counts.
   */
  deniedScorerId?: string;
  deniedAssisterId?: string;
  /** Substitution-only references. `playerId` is intentionally omitted. */
  playerInId?: string;
  playerOutId?: string;
  playerInName?: string;
  playerOutName?: string;
}

export interface MatchStats {
  possession: [number, number]; // home%, away%
  shots: [number, number];
  shotsOnTarget: [number, number];
  corners: [number, number];
  fouls: [number, number];
  yellowCards: [number, number];
  redCards: [number, number];
}

export interface MatchResult {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  extraTime: boolean;
  etHomeGoals?: number;
  etAwayGoals?: number;
  penalties: boolean;
  penaltyHome?: number;
  penaltyAway?: number;
  events: MatchEvent[];
  stats: MatchStats;
  competitionType: CompetitionType;
  competitionName: string;
  roundLabel: string;
  motm?: string; // man of the match description
  /** Exact squad selected by the simulator; optional for legacy saves. */
  homeMatchday?: MatchdaySnapshot;
  awayMatchday?: MatchdaySnapshot;
  /** v23 — true if the match was at a neutral venue (cup finals). */
  isNeutralVenue?: boolean;
}

export interface MatchdaySnapshot {
  players: Array<{
    playerId: string;
    position: 'GK' | 'DF' | 'MF' | 'FW';
    role?: 'starter' | 'bench';
    /** 0 for starters, substitution minute for used substitutes, null when unused. */
    enteredMinute?: number | null;
    /** Substitution/dismissal minute for players who leave, otherwise match duration. */
    exitedMinute?: number | null;
    minutesPlayed?: number;
  }>;
  substitutions?: Array<{
    minute: number;
    playerInId: string;
    playerOutId: string;
  }>;
  durationMinutes?: 90 | 120;
  emergencyFloor: boolean;
  availableCount: number;
}
