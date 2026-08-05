import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import { buildLiveCommentary, shootoutEventLabel } from './live-commentary';

const base = {
  minute: 82,
  homeScore: 2,
  awayScore: 1,
  penaltyHomeScore: 0,
  penaltyAwayScore: 0,
  homeTeamId: 'home',
  homeTeamName: '主队',
  awayTeamName: '客队',
};

describe('live commentary', () => {
  it('uses the real event description and score context', () => {
    const event: MatchEvent = { minute: 82, type: 'goal', teamId: 'home', description: '九号低射破门' };
    expect(buildLiveCommentary({ ...base, event })).toBe('九号低射破门。主队在比赛末段取得关键领先。');
  });

  it('describes a shootout kick without presenting it as a match minute', () => {
    const event: MatchEvent = {
      minute: 127,
      type: 'penalty_miss',
      teamId: 'home',
      description: '九号点球被扑出！',
      shootout: { kickNumber: 7, round: 4, teamKickNumber: 4, suddenDeath: false, outcome: 'saved' },
    };
    expect(buildLiveCommentary({ ...base, event, penaltyHomeScore: 2, penaltyAwayScore: 3 }))
      .toContain('第4轮');
    expect(shootoutEventLabel(event)).toBe('点4');
  });
});
