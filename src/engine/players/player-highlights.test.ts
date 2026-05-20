import { describe, it, expect } from 'vitest';
import { detectPlayerHighlights } from './player-highlights';
import type { MatchResult, MatchEvent } from '../../types/match';

function mkResult(
  partial: Partial<MatchResult> & Pick<MatchResult, 'homeGoals' | 'awayGoals' | 'events'>,
): MatchResult {
  return {
    fixtureId: 'f1',
    homeTeamId: 'A',
    awayTeamId: 'B',
    extraTime: false,
    penalties: false,
    stats: {
      possession: [50, 50],
      shots: [10, 10],
      shotsOnTarget: [5, 5],
      corners: [4, 4],
      fouls: [10, 10],
      yellowCards: [0, 0],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '顶级联赛',
    roundLabel: 'R1',
    ...partial,
  };
}

function mkEvent(p: Partial<MatchEvent> & Pick<MatchEvent, 'type' | 'teamId' | 'playerId'>): MatchEvent {
  return {
    minute: 30,
    description: '',
    playerName: p.playerName ?? p.playerId,
    ...p,
  };
}

describe('detectPlayerHighlights', () => {
  it('returns empty array when no events qualify', () => {
    const result = mkResult({
      homeGoals: 1,
      awayGoals: 0,
      events: [
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'p-1', minute: 20 }),
      ],
    });
    expect(detectPlayerHighlights([result])).toEqual([]);
  });

  it('detects a hat-trick (3+ goals same player same match)', () => {
    const result = mkResult({
      homeGoals: 3,
      awayGoals: 0,
      events: [
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'p-1', playerName: '张伟', minute: 12 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'p-1', playerName: '张伟', minute: 45 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'p-1', playerName: '张伟', minute: 78 }),
      ],
    });
    const highlights = detectPlayerHighlights([result]);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].label).toBe('帽子戏法');
    expect(highlights[0].playerId).toBe('p-1');
    expect(highlights[0].playerName).toBe('张伟');
    expect(highlights[0].priority).toBe(10);
    expect(highlights[0].detail).toBe('3 球');
  });

  it('detects a late-drama winner (绝杀) — minute >= 85, margin 1', () => {
    const result = mkResult({
      homeGoals: 2,
      awayGoals: 1,
      events: [
        mkEvent({ type: 'goal', teamId: 'B', playerId: 'b-1', playerName: '李四', minute: 30 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-1', playerName: '王五', minute: 60 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-2', playerName: '赵六', minute: 89 }),
      ],
    });
    const highlights = detectPlayerHighlights([result]);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].label).toBe('绝杀');
    expect(highlights[0].playerId).toBe('a-2');
    expect(highlights[0].teamId).toBe('A');
  });

  it('does NOT mark 绝杀 when winning side margin > 1', () => {
    const result = mkResult({
      homeGoals: 3,
      awayGoals: 1,
      events: [
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-1', minute: 10 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-2', minute: 88 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-3', minute: 90 }),
        mkEvent({ type: 'goal', teamId: 'B', playerId: 'b-1', minute: 70 }),
      ],
    });
    expect(detectPlayerHighlights([result])).toEqual([]);
  });

  it('does NOT mark 绝杀 for the losing side late goal', () => {
    const result = mkResult({
      homeGoals: 2,
      awayGoals: 1,
      events: [
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-1', minute: 40 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-2', minute: 50 }),
        mkEvent({ type: 'goal', teamId: 'B', playerId: 'b-1', minute: 88 }),
      ],
    });
    expect(detectPlayerHighlights([result])).toEqual([]);
  });

  it('detects 多助攻王 (3+ assists)', () => {
    const result = mkResult({
      homeGoals: 4,
      awayGoals: 0,
      events: [
        mkEvent({ type: 'assist', teamId: 'A', playerId: 'a-mid', playerName: '中场', minute: 10 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-1', minute: 10 }),
        mkEvent({ type: 'assist', teamId: 'A', playerId: 'a-mid', playerName: '中场', minute: 40 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-2', minute: 40 }),
        mkEvent({ type: 'assist', teamId: 'A', playerId: 'a-mid', playerName: '中场', minute: 70 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'a-3', minute: 70 }),
      ],
    });
    const highlights = detectPlayerHighlights([result]);
    const assistKing = highlights.find(h => h.label === '多助攻王');
    expect(assistKing).toBeDefined();
    expect(assistKing!.playerId).toBe('a-mid');
    expect(assistKing!.detail).toBe('3 次助攻');
  });

  it('detects 门神 (4+ saves, team didn\'t lose)', () => {
    const result = mkResult({
      homeGoals: 0,
      awayGoals: 0,
      events: [
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', playerName: '门将', minute: 10 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', playerName: '门将', minute: 25 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', playerName: '门将', minute: 55 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', playerName: '门将', minute: 80 }),
      ],
    });
    const highlights = detectPlayerHighlights([result]);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].label).toBe('门神');
    expect(highlights[0].position).toBe('GK');
  });

  it('does NOT mark 门神 when GK\'s team lost', () => {
    const result = mkResult({
      homeGoals: 0,
      awayGoals: 3,
      events: [
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', minute: 10 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', minute: 25 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', minute: 55 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', minute: 80 }),
      ],
    });
    expect(detectPlayerHighlights([result])).toEqual([]);
  });

  it('prefers the highest-priority label when one player qualifies for several (hat-trick + late drama)', () => {
    // A player scores 3 goals including a 90' winner — should emit ONE
    // highlight only, the hat-trick (higher priority).
    const result = mkResult({
      homeGoals: 3,
      awayGoals: 2,
      events: [
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'star', playerName: '巨星', minute: 20 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'star', playerName: '巨星', minute: 50 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'star', playerName: '巨星', minute: 90 }),
        mkEvent({ type: 'goal', teamId: 'B', playerId: 'b-1', minute: 30 }),
        mkEvent({ type: 'goal', teamId: 'B', playerId: 'b-2', minute: 70 }),
      ],
    });
    const highlights = detectPlayerHighlights([result]);
    const starHighlights = highlights.filter(h => h.playerId === 'star');
    expect(starHighlights).toHaveLength(1);
    expect(starHighlights[0].label).toBe('帽子戏法');
  });

  it('sorts highlights by priority desc', () => {
    const hatTrickMatch = mkResult({
      fixtureId: 'f-ht',
      homeGoals: 3,
      awayGoals: 0,
      events: [
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'striker', playerName: '射手', minute: 20 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'striker', playerName: '射手', minute: 50 }),
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'striker', playerName: '射手', minute: 80 }),
      ],
    });
    const goalkeeperMatch = mkResult({
      fixtureId: 'f-gk',
      homeGoals: 0,
      awayGoals: 0,
      events: [
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', playerName: '门将', minute: 10 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', playerName: '门将', minute: 25 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', playerName: '门将', minute: 55 }),
        mkEvent({ type: 'save', teamId: 'A', playerId: 'gk-1', playerName: '门将', minute: 80 }),
      ],
    });
    const highlights = detectPlayerHighlights([goalkeeperMatch, hatTrickMatch]);
    expect(highlights[0].label).toBe('帽子戏法');
    expect(highlights[highlights.length - 1].label).toBe('门神');
  });

  it('skips shootout kicks (minute > 120) — they do not count toward goal totals', () => {
    const result = mkResult({
      homeGoals: 1,
      awayGoals: 1,
      penalties: true,
      penaltyHome: 4,
      penaltyAway: 2,
      events: [
        mkEvent({ type: 'goal', teamId: 'A', playerId: 'p-1', playerName: '射手', minute: 30 }),
        mkEvent({ type: 'penalty_goal', teamId: 'A', playerId: 'p-1', playerName: '射手', minute: 121 }),
        mkEvent({ type: 'penalty_goal', teamId: 'A', playerId: 'p-1', playerName: '射手', minute: 123 }),
        mkEvent({ type: 'penalty_goal', teamId: 'A', playerId: 'p-1', playerName: '射手', minute: 125 }),
        mkEvent({ type: 'goal', teamId: 'B', playerId: 'b-1', minute: 80 }),
      ],
    });
    // Only 1 regulation goal → no hat-trick.
    expect(detectPlayerHighlights([result])).toEqual([]);
  });

  it('counts regulation-time penalty_goal toward late drama', () => {
    // A late penalty (minute 90) decides a 1-0 game.
    const result = mkResult({
      homeGoals: 1,
      awayGoals: 0,
      events: [
        mkEvent({ type: 'penalty_goal', teamId: 'A', playerId: 'pk-taker', playerName: '主罚', minute: 90 }),
      ],
    });
    const highlights = detectPlayerHighlights([result]);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].label).toBe('绝杀');
    expect(highlights[0].playerId).toBe('pk-taker');
  });

  it('ignores events with no playerId (regulation own goals etc.)', () => {
    const result = mkResult({
      homeGoals: 1,
      awayGoals: 0,
      events: [
        mkEvent({ type: 'goal', teamId: 'A', playerId: '' as unknown as string, minute: 20 }),
        { minute: 30, type: 'goal', teamId: 'A', description: '乌龙球' },
      ],
    });
    expect(detectPlayerHighlights([result])).toEqual([]);
  });
});
