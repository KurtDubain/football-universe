import { MatchResult } from './match';

/**
 * Auto-collected memorable matches: blowouts, last-minute drama, finals,
 * upsets, multi-crown clinchers. Stored on GameWorld with a FIFO cap.
 */
export type MemorableType =
  | 'blowout'        // ≥4 goal differential
  | 'shootout'       // penalty shootout in finals
  | 'last_minute'    // 90+ min decider
  | 'upset'          // OVR diff ≥15, weak team wins
  | 'coronation'     // multi-crown clincher
  | 'goalfest';      // 6+ total goals

export interface MemorableMatchEntry {
  season: number;
  windowIndex: number;
  type: MemorableType;
  label: string; // human-readable e.g. "大屠杀", "绝杀"
  /** Stored result so we can replay in MatchLive */
  result: MatchResult;
}
