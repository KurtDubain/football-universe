import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchResult } from '../../types/match';
import { analyzeDestinyDeviation, extractMatchTurningPoints, isUpsetResult, resolveMatchOutcome } from './analysis';

function event(partial: Partial<MatchEvent> & Pick<MatchEvent, 'type' | 'teamId' | 'minute'>): MatchEvent {
  return { description: partial.type, ...partial };
}

function result(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    fixtureId: 'fixture', homeTeamId: 'home', awayTeamId: 'away',
    homeGoals: 1, awayGoals: 0, extraTime: false, penalties: false,
    events: [],
    stats: {
      possession: [50, 50], shots: [8, 8], shotsOnTarget: [3, 3], corners: [2, 2],
      fouls: [8, 8], yellowCards: [1, 1], redCards: [0, 0],
    },
    competitionType: 'league', competitionName: '测试联赛', roundLabel: 'R1',
    prediction: {
      homeWinPct: 60, drawPct: 25, awayWinPct: 15,
      homeExpectedGoals: 1.7, awayExpectedGoals: 0.8,
    },
    ...overrides,
  };
}

describe('match destiny deviation', () => {
  it('classifies common, minor, upset, and major-upset outcomes from one forecast metric', () => {
    expect(analyzeDestinyDeviation(result()).tier).toBe('normal');
    expect(analyzeDestinyDeviation(result({ homeGoals: 1, awayGoals: 1 })).tier).toBe('minor');
    expect(analyzeDestinyDeviation(result({ homeGoals: 0, awayGoals: 1 })).tier).toBe('upset');
    expect(analyzeDestinyDeviation(result({
      homeGoals: 0,
      awayGoals: 1,
      prediction: { homeWinPct: 70, drawPct: 20, awayWinPct: 10, homeExpectedGoals: 2, awayExpectedGoals: 0.6 },
    })).tier).toBe('major_upset');
  });

  it('does not call a draw an upset and splits the draw branch for knockout resolution', () => {
    expect(isUpsetResult(result({ homeGoals: 1, awayGoals: 1 }))).toBe(false);
    const shootout = result({
      homeGoals: 0, awayGoals: 0, extraTime: true, etHomeGoals: 0, etAwayGoals: 0,
      penalties: true, penaltyHome: 3, penaltyAway: 4,
      prediction: { homeWinPct: 60, drawPct: 30, awayWinPct: 10, homeExpectedGoals: 1.5, awayExpectedGoals: 0.7 },
    });
    expect(resolveMatchOutcome(shootout)).toBe('away');
    expect(analyzeDestinyDeviation(shootout)).toMatchObject({ actualProbability: 25, tier: 'minor', isUpset: false });
  });

  it('describes low-probability draws as surprises while reserving upsets for underdog wins', () => {
    const draw = analyzeDestinyDeviation(result({
      homeGoals: 1,
      awayGoals: 1,
      prediction: {
        homeWinPct: 48,
        drawPct: 24,
        awayWinPct: 28,
        homeExpectedGoals: 1.4,
        awayExpectedGoals: 1.1,
      },
    }));
    const underdogWin = analyzeDestinyDeviation(result({
      homeGoals: 0,
      awayGoals: 1,
      prediction: {
        homeWinPct: 55,
        drawPct: 25,
        awayWinPct: 20,
        homeExpectedGoals: 1.6,
        awayExpectedGoals: 0.8,
      },
    }));
    const majorDraw = analyzeDestinyDeviation(result({
      homeGoals: 2,
      awayGoals: 2,
      prediction: {
        homeWinPct: 66,
        drawPct: 14,
        awayWinPct: 20,
        homeExpectedGoals: 1.9,
        awayExpectedGoals: 0.8,
      },
    }));
    const majorUnderdogWin = analyzeDestinyDeviation(result({
      homeGoals: 0,
      awayGoals: 1,
      prediction: {
        homeWinPct: 66,
        drawPct: 24,
        awayWinPct: 10,
        homeExpectedGoals: 1.9,
        awayExpectedGoals: 0.6,
      },
    }));

    expect(draw).toMatchObject({ tier: 'upset', label: '明显意外', isUpset: false });
    expect(`${draw.label}${draw.summary}`).not.toContain('爆冷');
    expect(underdogWin).toMatchObject({ tier: 'upset', label: '明显爆冷', isUpset: true });
    expect(underdogWin.summary).toContain('明显爆冷');
    expect(majorDraw).toMatchObject({ tier: 'major_upset', label: '重大意外', isUpset: false });
    expect(`${majorDraw.label}${majorDraw.summary}`).not.toContain('爆冷');
    expect(majorUnderdogWin).toMatchObject({ tier: 'major_upset', label: '重大爆冷', isUpset: true });
  });
});

describe('match turning points', () => {
  it('records an ordinary equalizer from the authoritative scoring timeline', () => {
    const points = extractMatchTurningPoints(result({
      homeGoals: 1,
      awayGoals: 1,
      events: [
        event({ type: 'goal', teamId: 'home', minute: 57, playerName: '甲' }),
        event({ type: 'goal', teamId: 'away', minute: 63, playerName: '乙' }),
      ],
    }));

    expect(points).toEqual([expect.objectContaining({
      type: 'equalizer', minute: 63, teamId: 'away', title: "63' 扳平",
    })]);
  });

  it('keeps the most important turnaround and equalizer in a 2-2 draw without duplicates', () => {
    const points = extractMatchTurningPoints(result({
      homeGoals: 2,
      awayGoals: 2,
      events: [
        event({ type: 'goal', teamId: 'home', minute: 14 }),
        event({ type: 'goal', teamId: 'away', minute: 31 }),
        event({ type: 'goal', teamId: 'away', minute: 54 }),
        event({ type: 'goal', teamId: 'home', minute: 76 }),
      ],
    }));

    expect(points.map(point => point.type)).toEqual(['turnaround', 'equalizer']);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ minute: 54, teamId: 'away' });
    expect(points[1]).toMatchObject({ minute: 76, teamId: 'home' });
  });

  it('extracts a real late winner and comeback without using generated match stats', () => {
    const points = extractMatchTurningPoints(result({
      homeGoals: 1,
      awayGoals: 2,
      events: [
        event({ type: 'goal', teamId: 'home', minute: 12, playerName: '甲' }),
        event({ type: 'goal', teamId: 'away', minute: 71, playerName: '乙' }),
        event({ type: 'goal', teamId: 'away', minute: 89, playerName: '丙' }),
      ],
    }));
    expect(points.map(point => point.type)).toEqual(['late_winner', 'comeback']);
    expect(points[0]).toMatchObject({ minute: 89, teamId: 'away' });
  });

  it('reports late equalizers, red cards, and shootouts from persisted events', () => {
    const drawPoints = extractMatchTurningPoints(result({
      homeGoals: 1,
      awayGoals: 1,
      events: [
        event({ type: 'goal', teamId: 'home', minute: 20 }),
        event({ type: 'red_card', teamId: 'home', minute: 63, playerName: '甲' }),
        event({ type: 'goal', teamId: 'away', minute: 90, playerName: '乙' }),
      ],
    }));
    expect(drawPoints.map(point => point.type)).toEqual(['late_equalizer', 'red_card']);

    const shootoutPoints = extractMatchTurningPoints(result({
      homeGoals: 0, awayGoals: 0, extraTime: true, etHomeGoals: 0, etAwayGoals: 0,
      penalties: true, penaltyHome: 5, penaltyAway: 4,
    }));
    expect(shootoutPoints).toHaveLength(1);
    expect(shootoutPoints[0].type).toBe('shootout');

    const extraTimePoints = extractMatchTurningPoints(result({
      homeGoals: 1, awayGoals: 1, extraTime: true, etHomeGoals: 1, etAwayGoals: 0,
    }));
    expect(extraTimePoints).toEqual([expect.objectContaining({ type: 'extra_time' })]);
  });

  it('keeps the final late lead change and describes own goals without crediting the offender', () => {
    const points = extractMatchTurningPoints(result({
      homeGoals: 2,
      awayGoals: 1,
      events: [
        event({ type: 'goal', teamId: 'home', minute: 89, playerName: '甲' }),
        event({ type: 'goal', teamId: 'away', minute: 90, playerName: '乙' }),
        event({ type: 'own_goal', teamId: 'away', minute: 90, playerName: '丙' }),
      ],
    }));
    expect(points[0]).toMatchObject({ type: 'late_winner', minute: 90, teamId: 'home' });
    expect(points[0].detail).toContain('乌龙球');
    expect(points[0].detail).not.toContain('打入');
  });

  it('returns no invented explanation when detailed events are absent or archived', () => {
    expect(extractMatchTurningPoints(result())).toEqual([]);
    expect(extractMatchTurningPoints(result({ detailsArchived: true }))).toEqual([]);
  });
});
