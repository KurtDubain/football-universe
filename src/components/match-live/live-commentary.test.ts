import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import {
  buildLiveCommentary,
  buildLiveCommentaryHistory,
  shootoutEventLabel,
} from './live-commentary';
import { routineBeatLine } from './live-commentary';
import type { RoutineBeat } from './routine-timeline';

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
  it('does not repeat speculative dramatic suffixes from older saved events', () => {
    const event: MatchEvent = { minute: 89, type: 'goal', teamId: 'home', description: '低射破门 [绝杀！]' };
    const text = buildLiveCommentary({ ...base, event, homeScore: 3 });
    expect(text).not.toContain('绝杀');
    expect(text).toContain('优势扩大');
  });
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

  it('explains whether a noteworthy set piece was cleared or retained', () => {
    const corner: MatchEvent = {
      minute: 28,
      type: 'corner',
      teamId: 'home',
      description: '角球被顶出禁区',
      playOrigin: 'corner',
      setPiece: { side: 'left', delivery: 'near_post', resolution: 'retained' },
    };
    const freeKick: MatchEvent = {
      minute: 64,
      type: 'free_kick',
      teamId: 'away',
      description: '任意球传入禁区后被解围',
      playOrigin: 'crossed_free_kick',
      setPiece: { side: 'right', delivery: 'far_post', resolution: 'cleared' },
    };

    expect(buildLiveCommentary({ ...base, event: corner })).toContain('仍在前场组织');
    expect(buildLiveCommentary({ ...base, event: freeKick })).toContain('化解了这次定位球');
  });

  it('never narrates a phase with anything the simulation did not produce', () => {
    const text = buildLiveCommentary({ ...base, event: null, minute: 40, homeScore: 0, awayScore: 0 });
    expect(text).toBe('主队与客队战成 0:0。');
    expect(buildLiveCommentary({ ...base, event: null, minute: 40, homeScore: 3, awayScore: 1 }))
      .toBe('主队 3:1 领先客队。');
    // The old filler is gone for good: no claim about tempo, space or control.
    for (const minute of [10, 40, 70]) {
      const line = buildLiveCommentary({ ...base, event: null, minute });
      expect(line).not.toContain('空间');
      expect(line).not.toContain('节奏');
      expect(line).not.toContain('控制');
    }
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
      '主队与客队战成 0:0。',
      '主队 1:0 领先客队。',
      '客队远射稍稍偏出，客队错过了改写比分的机会。',
      '主队率先破门。主队取得领先。',
      '主队中场送出助攻',
    ]));
    expect(history[0].minute).toBe(30);
  });
});

const beatBase = {
  minute: 82,
  homeScore: 2,
  awayScore: 1,
  penaltyHomeScore: 0,
  penaltyAwayScore: 0,
  homeTeamId: 'home',
  homeTeamName: '主队',
  awayTeamName: '客队',
};

function beat(kind: RoutineBeat["kind"], teamId = 'home', minute = 31): RoutineBeat {
  return { id: `routine:${minute}:${kind}:${teamId}`, minute, kind, teamId };
}

describe('routine beat commentary', () => {
  it('says the beat instead of repeating the score', () => {
    const text = buildLiveCommentary({ ...beatBase, event: null, routineBeat: beat('foul') });
    expect(text).not.toContain('2:1');
    expect(text).toContain('主队');
    expect(text).toMatch(/犯规|鸣哨|吹停/);
  });

  it('names the side the beat belongs to', () => {
    expect(buildLiveCommentary({ ...beatBase, event: null, routineBeat: beat('corner', 'away') }))
      .toContain('客队');
    expect(buildLiveCommentary({ ...beatBase, event: null, routineBeat: beat('corner', 'home') }))
      .toContain('主队');
  });

  it('only claims what the stat it came from proves', () => {
    expect(buildLiveCommentary({ ...beatBase, event: null, routineBeat: beat('shot_off_target') }))
      .toMatch(/偏出|门框|目标/);
    expect(buildLiveCommentary({ ...beatBase, event: null, routineBeat: beat('save') }))
      .toMatch(/门将/);
    // An off-target shot may not be described as a goal, a save or a corner.
    const offTarget = buildLiveCommentary({ ...beatBase, event: null, routineBeat: beat('shot_off_target') });
    expect(offTarget).not.toMatch(/进球|破门|门将|角球/);
  });

  it('varies the phrasing but never the fact', () => {
    const lines = new Set<string>();
    for (let minute = 2; minute <= 80; minute++) {
      lines.add(routineBeatLine(beat('foul', 'home', minute), 'home', '主队', '客队'));
    }
    expect(lines.size).toBeGreaterThan(1);
    for (const line of lines) expect(line).toContain('主队');
  });

  it('keeps a beat stable across a replay', () => {
    const first = routineBeatLine(beat('corner'), 'home', '主队', '客队');
    const second = routineBeatLine(beat('corner'), 'home', '主队', '客队');
    expect(second).toBe(first);
  });

  it('still marks the structural minutes itself', () => {
    expect(buildLiveCommentary({ ...beatBase, event: null, minute: 46, routineBeat: beat('foul', 'home', 46) }))
      .toBe('下半场开始，比赛重新进入节奏。');
    expect(buildLiveCommentary({ ...beatBase, event: null, minute: 1, routineBeat: null }))
      .toBe('比赛开球，双方开始试探。');
  });

  it('falls back to the score when the minute carries no beat', () => {
    expect(buildLiveCommentary({ ...beatBase, event: null, routineBeat: null }))
      .toBe('主队 2:1 领先客队。');
  });

  it('logs revealed beats and holds back the rest', () => {
    const routineBeats = [beat('foul', 'home', 10), beat('corner', 'away', 40), beat('save', 'home', 70)];
    const history = buildLiveCommentaryHistory({
      events: [],
      routineBeats,
      currentMinute: 40,
      homeTeamId: 'home',
      homeTeamName: '主队',
      awayTeamName: '客队',
    });
    const logged = history.filter(entry => entry.id.startsWith('routine:'));
    expect(logged).toHaveLength(2);
    expect(logged.every(entry => entry.minute <= 40)).toBe(true);
    expect(logged[0].minute).toBe(40);
  });

  it('keeps the log unchanged when no beats are supplied', () => {
    const withoutBeats = buildLiveCommentaryHistory({
      events: [],
      currentMinute: 35,
      homeTeamId: 'home',
      homeTeamName: '主队',
      awayTeamName: '客队',
    });
    expect(withoutBeats.some(entry => entry.id.startsWith('routine:'))).toBe(false);
  });
});
