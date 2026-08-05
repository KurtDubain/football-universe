import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import {
  buildLiveCommentary,
  buildLiveCommentaryHistory,
  shootoutEventLabel,
} from './live-commentary';

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

  it('retains phase narration and every revealed event in newest-first order', () => {
    const events: MatchEvent[] = [
      { minute: 12, type: 'miss', teamId: 'away', description: '客队远射稍稍偏出' },
      { minute: 18, type: 'goal', teamId: 'home', description: '主队率先破门' },
      { minute: 18, type: 'assist', teamId: 'home', description: '主队中场送出助攻' },
    ];
    const history = buildLiveCommentaryHistory({
      events,
      currentMinute: 35,
      homeTeamId: 'home',
      homeTeamName: '主队',
      awayTeamName: '客队',
    });

    expect(history).toHaveLength(6);
    expect(history.map(entry => entry.text)).toEqual(expect.arrayContaining([
      '比赛开球，双方开始试探。',
      '双方正在争夺中场控制，进攻仍在寻找空间。',
      '比赛节奏逐渐稳定，下一次推进可能形成机会。',
      '客队远射稍稍偏出，客队错过了改写比分的机会。',
      '主队率先破门。主队取得领先。',
      '主队中场送出助攻',
    ]));
    expect(history[0].minute).toBe(30);
  });
});
