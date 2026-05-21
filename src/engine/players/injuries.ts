import { Player, Injury, InjurySeverity } from '../../types/player';
import { MatchResult } from '../../types/match';
import { SeededRNG } from '../match/rng';

/**
 * Phase G — injury / suspension engine.
 *
 * This module owns the per-match "did anybody get hurt or banned?" pass that
 * runs after each match window. It is intentionally:
 *
 *   - PURE: input world references are never mutated except via the explicit
 *     `apply*` helpers, which return new arrays + carry the patch back.
 *   - SEEDED: every roll goes through a SeededRNG passed in by the caller.
 *
 * Severity distribution (see {@link rollInjurySeverity}):
 *
 *   minor      60%   1-2 matches
 *   moderate   30%   3-5 matches
 *   major       9%   6-12 matches
 *   long_term   1%   15-25 matches
 *
 * Suspension rules (unified across league + cups, see comments on
 * {@link computeSuspensionFromCounters} and {@link applyDisciplineFromMatch}):
 *
 *   - cumulative yellow count reaches 5 → 1-match ban, counter resets
 *   - direct red card → 2-match ban
 *   - 2nd yellow same match (red coexists with ≥ 2 yellow events) → 1-match
 *   - cumulative red count reaches 2 (rare double-red) → another 1-match
 */

// ── Tunable constants ───────────────────────────────────────────

/**
 * Per-appearance probability that a player picks up an injury during the
 * match. ~2% means roughly one injury every two matches across a 14-man
 * matchday squad — about right for an arcade-tilt simulation.
 */
export const INJURY_ROLL_CHANCE = 0.02;

/** Cap on `injuryHistory` per player (FIFO, oldest evicted on overflow). */
export const INJURY_HISTORY_CAP = 10;

/**
 * Reasons keyed by severity. Picked uniformly via SeededRNG.pick. Major /
 * long_term keep the same pool (separation isn't worth the duplicated copy).
 */
const INJURY_REASONS: Record<InjurySeverity, string[]> = {
  minor: ['脚踝扭伤', '肌肉拉伤', '小腿不适', '挫伤', '轻微脑震荡'],
  moderate: ['膝伤', '股骨拉伤', '踝关节扭伤', '腰肌劳损', '大腿肌肉撕裂'],
  major: ['膝盖韧带损伤', '骨折', '韧带部分撕裂', '半月板损伤'],
  long_term: ['十字韧带断裂', '跟腱断裂', '严重骨折', '复杂半月板手术'],
};

// ── Severity sampling ──────────────────────────────────────────

/**
 * Sample an injury severity bucket from the canonical 60/30/9/1 distribution.
 * Exposed so the unit test can verify the empirical distribution.
 */
export function rollInjurySeverity(rng: SeededRNG): InjurySeverity {
  const r = rng.next();
  if (r < 0.60) return 'minor';
  if (r < 0.90) return 'moderate';
  if (r < 0.99) return 'major';
  return 'long_term';
}

/**
 * Sample a duration (in MATCH WINDOWS) for the given severity, using the
 * ranges agreed in the design doc. Inclusive on both ends.
 */
export function rollInjuryDuration(severity: InjurySeverity, rng: SeededRNG): number {
  switch (severity) {
    case 'minor': return rng.nextInt(1, 2);
    case 'moderate': return rng.nextInt(3, 5);
    case 'major': return rng.nextInt(6, 12);
    case 'long_term': return rng.nextInt(15, 25);
  }
}

/**
 * Build a fully-formed `Injury` record from a fresh roll. Caller decides
 * whether to ATTACH it to a player — this helper just produces the object.
 */
export function rollInjury(
  seasonNumber: number,
  globalWindowIdx: number,
  rng: SeededRNG,
): Injury {
  const severity = rollInjurySeverity(rng);
  const durationMatches = rollInjuryDuration(severity, rng);
  const reason = rng.pick(INJURY_REASONS[severity]);
  return {
    type: severity,
    startSeason: seasonNumber,
    startWindow: globalWindowIdx,
    durationMatches,
    reason,
  };
}

// ── Discipline (yellow / red → suspension) ─────────────────────

/**
 * Per-match discipline summary for a single player. `yellows` is the count
 * of yellow_card events in the match for this player; `directRed` is true
 * iff the match has a red_card event for them whose origin is NOT a 2nd
 * yellow. `secondYellowRed` is the inferred "two yellows promoted to red"
 * case — detected by (yellows >= 2) regardless of whether a red event is
 * present.
 */
export interface PlayerDisciplineDelta {
  yellows: number;
  reds: number;
  /** Computed: counts a 2nd-yellow-red as a red. */
  directRed: boolean;
  secondYellowRed: boolean;
}

/**
 * Walk a match's events, build a per-player discipline delta keyed by
 * Player.uuid. Returns an empty map if the result has no card events.
 *
 * 2nd-yellow detection: events have only `yellow_card` and `red_card` types
 * — no separate "two-yellow-red" type. We infer: any player with both a
 * `red_card` event AND ≥ 2 yellow events in the SAME match got their red as
 * a 2nd-yellow. (This exactly matches `engine/match/events.ts`'s output:
 * red_card events fire either as a direct red or as the visible 2nd-yellow
 * red — both surface as `red_card`.)
 */
export function aggregateMatchDiscipline(
  result: MatchResult,
): Map<string, PlayerDisciplineDelta> {
  const out = new Map<string, PlayerDisciplineDelta>();
  for (const e of result.events) {
    if (e.type !== 'yellow_card' && e.type !== 'red_card') continue;
    if (!e.playerId) continue;
    let cur = out.get(e.playerId);
    if (!cur) {
      cur = { yellows: 0, reds: 0, directRed: false, secondYellowRed: false };
      out.set(e.playerId, cur);
    }
    if (e.type === 'yellow_card') cur.yellows++;
    else cur.reds++;
  }
  for (const cur of out.values()) {
    // 2nd-yellow inference: red coexists with ≥ 2 yellows → 2nd-yellow red.
    // Pure single-event red with 0 yellows → direct red.
    cur.secondYellowRed = cur.reds > 0 && cur.yellows >= 2;
    cur.directRed = cur.reds > 0 && !cur.secondYellowRed;
  }
  return out;
}

/**
 * Suspension trigger summary. The post-match pass calls this once per
 * (player, match-discipline-delta) pair, AFTER folding the delta into the
 * cumulative season counters.
 *
 * Returns `{ banWindows, resetYellow, resetRed }`:
 *   - banWindows ≥ 0: how many subsequent windows the player misses
 *   - resetYellow: zero out the yellow counter (after the 5-yellow gate)
 *   - resetRed: zero out the red counter (after the 2-red gate)
 *
 * Multiple gates can fire in a single match (rare); the helper sums the
 * resulting bans. Direct red and 2nd-yellow are mutually exclusive (see
 * inference in `aggregateMatchDiscipline`), but a 2-red-of-the-season player
 * who picks up a 5th yellow in the same match would trip BOTH the yellow
 * gate (1 game) and the red gate (1 game) — the unified pool is just a
 * count threshold, not a per-event flag.
 */
export interface SuspensionGate {
  banWindows: number;
  resetYellow: boolean;
  resetRed: boolean;
}

/**
 * Given the player's NEW (post-fold) yellow / red totals + per-match
 * delta, decide whether any suspension gate fires. Pure / stateless —
 * caller does the addition before invoking this.
 */
export function computeSuspensionFromCounters(
  newYellowTotal: number,
  newRedTotal: number,
  delta: PlayerDisciplineDelta,
): SuspensionGate {
  let banWindows = 0;
  let resetYellow = false;
  let resetRed = false;

  // Direct red → 2 game ban (covers both kinds of "this match")
  if (delta.directRed) {
    banWindows += 2;
  }
  // 2nd yellow same match → 1 game ban
  if (delta.secondYellowRed) {
    banWindows += 1;
  }
  // 5 yellows accrued → 1 game ban + reset
  if (newYellowTotal >= 5) {
    banWindows += 1;
    resetYellow = true;
  }
  // 2 reds accrued (across the season) → 1 game ban + reset
  if (newRedTotal >= 2) {
    banWindows += 1;
    resetRed = true;
  }

  return { banWindows, resetYellow, resetRed };
}

// ── Squad selection (matchday filter) ──────────────────────────

/**
 * Pick the matchday squad (top 14 by rating). Skips players whose
 * `injuredUntilWindow` or `suspendedUntilWindow` extends past the current
 * global window index.
 *
 * Emergency floor: if filtering leaves fewer than 11 available players, the
 * helper returns the unfiltered top-14 anyway — we can't field a team
 * otherwise. (Suspended players DO play in this case, since the alternative
 * is the engine refusing to simulate the match.)
 *
 * `currentWindowIdx` is the GLOBAL counter (`world.totalElapsedWindows`),
 * NOT the per-season `seasonState.currentWindowIndex`.
 */
export function pickMatchday(
  squad: Player[] | undefined,
  currentWindowIdx: number,
): Player[] | undefined {
  if (!squad) return squad;
  if (squad.length <= 14) return squad;

  const isAvailable = (p: Player): boolean => {
    const inj = p.injuredUntilWindow ?? 0;
    const sus = p.suspendedUntilWindow ?? 0;
    return inj <= currentWindowIdx && sus <= currentWindowIdx;
  };

  const available = squad.filter(isAvailable);

  if (available.length < 11) {
    // Emergency floor: too many unavailable to field 11 — relax restrictions.
    return [...squad].sort((a, b) => b.rating - a.rating).slice(0, 14);
  }
  return available.sort((a, b) => b.rating - a.rating).slice(0, 14);
}

/**
 * Append an Injury to a player's injuryHistory, capped at INJURY_HISTORY_CAP.
 * Returns a NEW array — the caller assigns it back to the player.
 */
export function appendInjuryHistory(
  history: Injury[] | undefined,
  next: Injury,
): Injury[] {
  const merged = history ? [...history, next] : [next];
  if (merged.length > INJURY_HISTORY_CAP) {
    return merged.slice(-INJURY_HISTORY_CAP);
  }
  return merged;
}

/**
 * Decide whether a player has an active long-term injury. Used by retirement
 * to tilt the chance + by market value to apply a long-injury haircut.
 */
export function hasActiveLongTermInjury(
  player: Player,
  currentWindowIdx: number,
): boolean {
  const until = player.injuredUntilWindow ?? 0;
  if (until <= currentWindowIdx) return false;
  const last = player.injuryHistory?.[player.injuryHistory.length - 1];
  return !!last && (last.type === 'major' || last.type === 'long_term');
}

// ── Season transition reset ───────────────────────────────────

/**
 * Off-season cleanup. Called from `initializeNewSeason` AFTER the new
 * window counter is established (this helper doesn't move it).
 *
 * Behaviour per player on every squad:
 *   - clear `suspendedUntilWindow` (ALL bans wiped on offseason)
 *   - if the most recent injury (`injuryHistory.at(-1)`) had duration <= 30
 *     matches → clear `injuredUntilWindow`. Long-term (15-25) injuries by
 *     duration end up retained when `durationMatches` > 30 — but our
 *     long_term distribution is 15-25, so in practice everything resets
 *     UNLESS the active injury is a `long_term` AND the until-window still
 *     exceeds the new global counter. We use TYPE rather than duration as
 *     the source of truth: only `long_term` carries over.
 *
 * Mutates squads in place. Doesn't change identity of the squad arrays.
 */
export function resetDisciplineForNewSeason(
  squads: Record<string, Player[]>,
  currentWindowIdx: number,
): void {
  for (const players of Object.values(squads)) {
    if (!Array.isArray(players)) continue;
    for (const p of players) {
      if (p.suspendedUntilWindow !== undefined) {
        p.suspendedUntilWindow = 0;
      }
      const last = p.injuryHistory?.[p.injuryHistory.length - 1];
      const isLongTerm = last?.type === 'long_term';
      const stillActive = (p.injuredUntilWindow ?? 0) > currentWindowIdx;
      if (!isLongTerm || !stillActive) {
        if (p.injuredUntilWindow !== undefined) {
          p.injuredUntilWindow = 0;
        }
      }
    }
  }
}

// ── Post-match orchestration ──────────────────────────────────

/**
 * Result of the full post-match injury / suspension pass. The post-match
 * processor wires `news` into the news log. `injuriesApplied` and
 * `suspensionsApplied` are exposed for diagnostics + UI hooks.
 */
export interface PostMatchInjuryResult {
  injuriesApplied: { playerId: string; injury: Injury; teamId: string }[];
  suspensionsApplied: { playerId: string; banWindows: number; teamId: string }[];
  news: import('../season/season-manager').NewsItem[];
}

/**
 * Drive injury rolls and suspension folding for one match window.
 *
 * Mutates Players inside `squads` in place — sets `injuredUntilWindow`,
 * `suspendedUntilWindow`, pushes onto `injuryHistory`, and increments
 * `playerStats[uuid].yellowCards / redCards`. The ROLLS / FOLD logic uses
 * the passed RNG (so it's deterministic against the seeded post-match pass).
 *
 * Returns the news items + diagnostics. News is generated only for
 * "newsworthy" cases — peakRating ≥ 75 OR favorite-team players (caller
 * passes `favoriteTeamIds`).
 *
 * `globalWindowIdx` = `world.totalElapsedWindows` for the just-played window
 * (already incremented by the orchestrator before calling here).
 */
export function processInjuriesAndSuspensions(args: {
  results: MatchResult[];
  squads: Record<string, Player[]>;
  playerStats: Record<string, import('../../types/player').PlayerSeasonStats>;
  teamBases: Record<string, import('../../types/team').TeamBase>;
  seasonNumber: number;
  globalWindowIdx: number;
  windowIndex: number;
  rng: SeededRNG;
  favoriteTeamIds?: string[];
}): PostMatchInjuryResult {
  const {
    results, squads, playerStats, teamBases,
    seasonNumber, globalWindowIdx, windowIndex, rng, favoriteTeamIds,
  } = args;
  const injuriesApplied: PostMatchInjuryResult['injuriesApplied'] = [];
  const suspensionsApplied: PostMatchInjuryResult['suspensionsApplied'] = [];
  const news: import('../season/season-manager').NewsItem[] = [];
  const favSet = new Set(favoriteTeamIds ?? []);

  // Build a uuid → (player, teamId) lookup once across squads — cheaper than
  // walking Object.entries(squads) per event.
  const playerLookup = new Map<string, { player: Player; teamId: string }>();
  for (const [teamId, sq] of Object.entries(squads)) {
    if (!Array.isArray(sq)) continue;
    for (const p of sq) playerLookup.set(p.uuid, { player: p, teamId });
  }

  // ── 1. Discipline (yellow / red → suspension) ───────────────
  // Folds per-match deltas into the cumulative season counters
  // (playerStats.yellowCards / redCards). When a gate trips, we set
  // suspendedUntilWindow on the player AND reset the relevant counter.
  for (const result of results) {
    const isFinal = result.roundLabel === 'Final' || result.roundLabel.includes('决赛');
    const disc = aggregateMatchDiscipline(result);
    for (const [uuid, delta] of disc) {
      const found = playerLookup.get(uuid);
      if (!found) continue;
      const { player, teamId } = found;
      const stat = playerStats[uuid];
      if (!stat) continue;

      // Fold the per-match delta into season counters (these are PRE-reset
      // values — we'll reset below if a gate trips).
      const newYellow = (stat.yellowCards ?? 0) + delta.yellows;
      const newRed = (stat.redCards ?? 0) + delta.reds;

      const gate = computeSuspensionFromCounters(newYellow, newRed, delta);
      if (gate.banWindows > 0) {
        const cur = player.suspendedUntilWindow ?? 0;
        const newUntil = Math.max(cur, globalWindowIdx + 1 + gate.banWindows);
        player.suspendedUntilWindow = newUntil;
        suspensionsApplied.push({ playerId: uuid, banWindows: gate.banWindows, teamId });

        // News for direct red in finals / for favorite-team players
        if (delta.directRed && (isFinal || favSet.has(teamId) || (player.peakRating ?? 0) >= 75)) {
          const teamName = teamBases[teamId]?.name ?? teamId;
          news.push({
            id: `injury-S${seasonNumber}-W${windowIndex}-red-${uuid}`,
            seasonNumber,
            windowIndex,
            type: 'injury',
            title: isFinal
              ? `怒发冲冠! ${player.name} 决赛红牌罚下`
              : `${player.name} 红牌罚下，停赛 ${gate.banWindows} 场`,
            description: isFinal
              ? `${teamName} ${player.name} 决赛中被直接红牌罚下，留下千古遗憾。`
              : `${teamName} ${player.name} 被直接红牌罚下，将停赛 ${gate.banWindows} 场。`,
          });
        }
      }

      // Persist the new counters (with gate-driven resets)
      playerStats[uuid] = {
        ...stat,
        yellowCards: gate.resetYellow ? 0 : newYellow,
        redCards: gate.resetRed ? 0 : newRed,
      };
    }
  }

  // ── 2. Injuries — roll for each player who appeared ─────────
  // We re-run the matchday filter with `globalWindowIdx` so the players who
  // actually took the field are who we roll for. (NOT `pickMatchday` from
  // helpers — that's the helper used at simulation time. We recompute here
  // because squads may have shifted in the same window's earlier processing,
  // though in practice no transfer/retire happens mid-window.)
  for (const result of results) {
    const homeSquad = squads[result.homeTeamId];
    const awaySquad = squads[result.awayTeamId];
    const homeMatchday = pickMatchday(homeSquad, globalWindowIdx);
    const awayMatchday = pickMatchday(awaySquad, globalWindowIdx);

    const rollFor = (md: Player[] | undefined, teamId: string): void => {
      if (!md) return;
      for (const p of md) {
        // Skip currently-injured players — they can't get re-injured this match.
        if ((p.injuredUntilWindow ?? 0) > globalWindowIdx) continue;
        // v17 — personality tag scales injury probability:
        //   iron  → ÷3 (rarely injured)
        //   glass → ×2 (injury-prone)
        let chance = INJURY_ROLL_CHANCE;
        if (p.tag === 'iron')  chance /= 3;
        if (p.tag === 'glass') chance *= 2;
        if (rng.next() >= chance) continue;

        const injury = rollInjury(seasonNumber, globalWindowIdx, rng);
        p.injuredUntilWindow = globalWindowIdx + 1 + injury.durationMatches;
        p.injuryHistory = appendInjuryHistory(p.injuryHistory, injury);
        injuriesApplied.push({ playerId: p.uuid, injury, teamId });

        // News only for major / long_term, OR favorite-team / high-peak.
        const teamName = teamBases[teamId]?.name ?? teamId;
        const isMajorish = injury.type === 'major' || injury.type === 'long_term';
        const isFav = favSet.has(teamId);
        const isStar = (p.peakRating ?? 0) >= 75;
        if (isMajorish && (isFav || isStar)) {
          news.push({
            id: `injury-S${seasonNumber}-W${windowIndex}-${p.uuid}`,
            seasonNumber,
            windowIndex,
            type: 'injury',
            title: injury.type === 'long_term'
              ? `重磅伤情! ${p.name}（${teamName}）${injury.reason}缺席 ${injury.durationMatches} 场`
              : `${p.name}（${teamName}）${injury.reason}伤缺 ${injury.durationMatches} 场`,
            description: injury.type === 'long_term'
              ? `${teamName} 头号球员 ${p.name} 因${injury.reason}至少缺席 ${injury.durationMatches} 场，本赛季冲冠之路雪上加霜。`
              : `${teamName} ${p.name} 在比赛中受伤，预计休战 ${injury.durationMatches} 场。`,
          });
        }
      }
    };

    rollFor(homeMatchday, result.homeTeamId);
    rollFor(awayMatchday, result.awayTeamId);
  }

  return { injuriesApplied, suspensionsApplied, news };
}
