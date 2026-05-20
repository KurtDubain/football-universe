import type { MatchResult, MatchEvent } from '../../types/match';

/**
 * A noteworthy per-player moment from a single matchday's results. Pure-data
 * shape — the UI layer is responsible for picking team colours, names, and
 * the player-detail link.
 *
 * Higher `priority` wins when we have to trim the list. Ties broken by event
 * count (the more events the player produced, the bigger the story), then by
 * insertion order as a stable fallback.
 */
export interface PlayerHighlight {
  /** Player uuid — links straight into /player/:uuid. */
  playerId: string;
  /** Pre-resolved name from the event payload (we never look up squads here). */
  playerName: string;
  teamId: string;
  /** Opponent team id, for the "vs X" line in the card. */
  opponentTeamId: string;
  /** GK / DF / MF / FW — best-effort, inferred from the event mix. */
  position: 'GK' | 'DF' | 'MF' | 'FW' | null;
  /** Headline label, e.g. "帽子戏法". */
  label: string;
  /** Emoji shown before the label. */
  emoji: string;
  /** Tailwind text-color class for the headline strip. */
  color: string;
  /** Short detail line, e.g. "3 球 · vs 山东泰山" — UI may override the
   *  "vs X" portion if it wants to substitute the team name. */
  detail: string;
  /** Sort weight — higher = more prominent. */
  priority: number;
  /** Sort tiebreaker — events the player produced in that match. */
  eventCount: number;
  /** Source fixture, for callers who want to jump to the match detail. */
  fixtureId: string;
}

/** Internal: tracks all events a player produced in one match. */
interface PlayerMatchAggregate {
  playerId: string;
  playerName: string;
  teamId: string;
  goals: number;
  assists: number;
  saves: number;
  /** Latest scoring minute (used for late-drama detection). */
  latestGoalMinute: number;
  /** Total events — used as a tiebreaker. */
  totalEvents: number;
}

function aggregateByPlayer(events: MatchEvent[]): Map<string, PlayerMatchAggregate> {
  const agg = new Map<string, PlayerMatchAggregate>();
  for (const ev of events) {
    if (!ev.playerId || !ev.playerName) continue;
    // Skip shootout kicks — they decide ties but shouldn't count toward
    // hat-tricks / late-drama. Mirrors the rule in updatePlayerStatsFromResults.
    if (ev.minute > 120) continue;
    let entry = agg.get(ev.playerId);
    if (!entry) {
      entry = {
        playerId: ev.playerId,
        playerName: ev.playerName,
        teamId: ev.teamId,
        goals: 0,
        assists: 0,
        saves: 0,
        latestGoalMinute: 0,
        totalEvents: 0,
      };
      agg.set(ev.playerId, entry);
    }
    entry.totalEvents++;
    switch (ev.type) {
      case 'goal':
      case 'penalty_goal':
        entry.goals++;
        if (ev.minute > entry.latestGoalMinute) entry.latestGoalMinute = ev.minute;
        break;
      case 'assist':
        entry.assists++;
        break;
      case 'save':
        entry.saves++;
        break;
    }
  }
  return agg;
}

/**
 * Detect highlight-worthy per-player moments from a batch of match results.
 *
 * Detection rules (in priority order):
 *   - 帽子戏法 (10): same player scored 3+ goals in one match
 *   - 绝杀     (8):  player scored at minute >= 85 in a 1-goal-margin match
 *                    (winner's side only)
 *   - 多助攻王 (6):  player provided 3+ assists in one match
 *   - 门神     (5):  GK with 4+ saves in a match where their team didn't lose
 *
 * A single player can hit multiple categories from the same match — we emit
 * the highest-priority one only (avoids "帽子戏法 + 绝杀" doubling up). Across
 * matches each highlight stands on its own.
 *
 * The result is sorted by priority desc then eventCount desc; callers usually
 * slice the top N.
 */
export function detectPlayerHighlights(lastResults: MatchResult[]): PlayerHighlight[] {
  const out: PlayerHighlight[] = [];

  for (const result of lastResults) {
    const aggregates = aggregateByPlayer(result.events);
    const margin = Math.abs(result.homeGoals - result.awayGoals);
    const winnerTeamId =
      result.homeGoals > result.awayGoals
        ? result.homeTeamId
        : result.awayGoals > result.homeGoals
          ? result.awayTeamId
          : null;

    // Per-match: dedupe so the same player only emits the best label.
    const claimed = new Set<string>();

    // 1) Hat-trick — highest priority.
    for (const a of aggregates.values()) {
      if (a.goals < 3) continue;
      if (claimed.has(a.playerId)) continue;
      claimed.add(a.playerId);
      const opponentTeamId = a.teamId === result.homeTeamId ? result.awayTeamId : result.homeTeamId;
      out.push({
        playerId: a.playerId,
        playerName: a.playerName,
        teamId: a.teamId,
        opponentTeamId,
        position: 'FW',
        label: '帽子戏法',
        emoji: '🎩',
        color: 'text-amber-300',
        detail: `${a.goals} 球`,
        priority: 10,
        eventCount: a.totalEvents,
        fixtureId: result.fixtureId,
      });
    }

    // 2) Late-drama winner (绝杀) — 1-goal-margin match, scored at minute >= 85
    //    by a player on the winning side. We pick the latest scorer to avoid
    //    crediting someone who scored at 12'.
    if (winnerTeamId && margin === 1) {
      let lateHero: PlayerMatchAggregate | null = null;
      for (const a of aggregates.values()) {
        if (a.teamId !== winnerTeamId) continue;
        if (a.goals < 1) continue;
        if (a.latestGoalMinute < 85) continue;
        if (claimed.has(a.playerId)) continue;
        if (!lateHero || a.latestGoalMinute > lateHero.latestGoalMinute) lateHero = a;
      }
      if (lateHero) {
        claimed.add(lateHero.playerId);
        const opponentTeamId = lateHero.teamId === result.homeTeamId ? result.awayTeamId : result.homeTeamId;
        out.push({
          playerId: lateHero.playerId,
          playerName: lateHero.playerName,
          teamId: lateHero.teamId,
          opponentTeamId,
          position: lateHero.goals >= 1 ? 'FW' : null,
          label: '绝杀',
          emoji: '⚡',
          color: 'text-red-300',
          detail: `${lateHero.latestGoalMinute}′ 绝杀进球`,
          priority: 8,
          eventCount: lateHero.totalEvents,
          fixtureId: result.fixtureId,
        });
      }
    }

    // 3) Multi-assist king (多助攻王) — 3+ assists.
    for (const a of aggregates.values()) {
      if (a.assists < 3) continue;
      if (claimed.has(a.playerId)) continue;
      claimed.add(a.playerId);
      const opponentTeamId = a.teamId === result.homeTeamId ? result.awayTeamId : result.homeTeamId;
      out.push({
        playerId: a.playerId,
        playerName: a.playerName,
        teamId: a.teamId,
        opponentTeamId,
        position: 'MF',
        label: '多助攻王',
        emoji: '🎯',
        color: 'text-blue-300',
        detail: `${a.assists} 次助攻`,
        priority: 6,
        eventCount: a.totalEvents,
        fixtureId: result.fixtureId,
      });
    }

    // 4) Goalkeeper hero (门神) — GK with 4+ saves whose team didn't lose.
    //    The "didn't lose" check uses the regulation outcome — for cup ties
    //    that went to penalties this still rewards the keeper who kept things
    //    level (lossless = either draw or win at full time).
    for (const a of aggregates.values()) {
      if (a.saves < 4) continue;
      if (claimed.has(a.playerId)) continue;
      const lostFullTime = winnerTeamId !== null && winnerTeamId !== a.teamId;
      if (lostFullTime) continue;
      claimed.add(a.playerId);
      const opponentTeamId = a.teamId === result.homeTeamId ? result.awayTeamId : result.homeTeamId;
      out.push({
        playerId: a.playerId,
        playerName: a.playerName,
        teamId: a.teamId,
        opponentTeamId,
        position: 'GK',
        label: '门神',
        emoji: '🧤',
        color: 'text-emerald-300',
        detail: `${a.saves} 次扑救`,
        priority: 5,
        eventCount: a.totalEvents,
        fixtureId: result.fixtureId,
      });
    }
  }

  out.sort((a, b) =>
    b.priority - a.priority ||
    b.eventCount - a.eventCount ||
    a.playerName.localeCompare(b.playerName),
  );
  return out;
}
