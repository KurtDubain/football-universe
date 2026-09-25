import { describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../season/season-manager';
import { buildSeasonEditorial } from './season-editorial';
import { buildAdvanceWorldResponse } from './world-response';

describe('completed season editing', () => {
  it('preserves the champion change and consecutive award ahead of routine closure news', () => {
    const world = initializeGameWorld(20260709);
    const [champion, other] = Object.keys(world.teamBases);
    const player = world.squads[champion][0];
    world.seasonState.seasonNumber = 3;
    world.honorHistory = [{ seasonNumber: 2, league1Champion: champion, league2Champion: '', league3Champion: '',
      leagueCupWinner: champion, superCupWinner: other, promoted: [{ teamId: other, from: 2, to: 1 }], relegated: [], coachChanges: [] }];
    world.teamSeasonRecords[champion] = [{ seasonNumber: 1, leagueLevel: 1, leaguePosition: 12,
      leaguePlayed: 30, leagueWon: 5, leagueDrawn: 5, leagueLost: 20, leagueGF: 30, leagueGA: 50, leaguePoints: 20,
      coachId: '', promoted: false, relegated: false }];
    world.playerAwardsHistory = [1, 2].map(season => ({ season, type: 'mvp', playerId: player.uuid,
      playerName: player.name, playerNumber: player.number, teamId: champion, teamName: world.teamBases[champion].name,
      statValue: 83, statLabel: '综合83' }));
    const items = buildSeasonEditorial(world, 2, [other]);
    expect(items).toHaveLength(3);
    expect(items[0].title).toContain('上季第12名');
    expect(items[0].summary).toContain('联赛杯');
    expect(items[1].title).toContain('蝉联金球');
    expect(items[1].destinations?.[0].to).toContain('#awards-S2');
    const response = buildAdvanceWorldResponse('skip_season', [{ seasonNumber: 2, windowIndex: 45,
      windowLabel: '赛季末', results: [], observationSettlements: [], news: [{ id: 'ordinary', type: 'storyline',
        title: '普通故事回落', description: '普通故事结束', importance: 'major', seasonNumber: 2, windowIndex: 45,
        subject: { teamIds: [other] } }] }], world, [other], other);
    expect(response?.narrative?.feature?.title).toContain('冠军');
    expect(response?.narrative?.signals.some(row => row.title.includes('蝉联金球'))).toBe(true);
    world.honorHistory[0].worldCupWinner = other;
    expect(buildSeasonEditorial(world, 2)[2].title).toContain('升级');
    expect(buildSeasonEditorial(world, 2, [other])[2].title).toContain('升级');
    world.teamSeasonRecords[champion] = [];
    expect(buildSeasonEditorial(world, 2)[0].title).not.toMatch(/上季|首次/);
    expect(buildSeasonEditorial(world, 9)).toEqual([]);
  });

  it('counts a three-season reign and does not bridge missing seasons', () => {
    const world = initializeGameWorld(7);
    const champion = Object.keys(world.teamBases)[0];
    const row = { league1Champion: champion, league2Champion: '', league3Champion: '', leagueCupWinner: '', superCupWinner: '', promoted: [], relegated: [], coachChanges: [] };
    world.honorHistory = [2, 3, 4].map(seasonNumber => ({ ...row, seasonNumber }));
    expect(buildSeasonEditorial(world, 4)[0].title).toContain('连续3季');
    expect(buildSeasonEditorial(world, 4)[0].title).toContain('现存记录中');
    world.honorHistory = world.honorHistory.filter(item => item.seasonNumber !== 3);
    expect(buildSeasonEditorial(world, 4)[0].title).not.toContain('连续');
  });

  it('prefers followed movement, then top-flight movement, then evidenced cup progress', () => {
    const world = initializeGameWorld(8);
    const [champion, lower, top, cup] = Object.keys(world.teamBases).sort();
    world.honorHistory = [{ seasonNumber: 2, league1Champion: champion, league2Champion: '', league3Champion: '',
      leagueCupWinner: champion, superCupWinner: cup, promoted: [{ teamId: lower, from: 3, to: 2 }, { teamId: top, from: 2, to: 1 }], relegated: [], coachChanges: [] }];
    const record = { leagueLevel: 2 as const, leaguePosition: 3, leaguePlayed: 10, leagueWon: 5, leagueDrawn: 2,
      leagueLost: 3, leagueGF: 10, leagueGA: 8, leaguePoints: 17, coachId: '', promoted: false, relegated: false };
    world.teamSeasonRecords[cup] = [{ ...record, seasonNumber: 1, cupResult: '八强' }, { ...record, seasonNumber: 2, cupResult: '亚军' }];
    expect(buildSeasonEditorial(world, 2, [lower]).at(-1)?.subjectIds).toEqual([lower]);
    expect(buildSeasonEditorial(world, 2).at(-1)?.subjectIds).toEqual([top]);
    world.honorHistory[0].promoted.pop();
    expect(buildSeasonEditorial(world, 2).at(-1)?.title).toContain('更进一步');
    world.teamSeasonRecords[cup] = [];
    expect(buildSeasonEditorial(world, 2).at(-1)?.subjectIds).toEqual([lower]);
    world.honorHistory[0].promoted = [];
    expect(buildSeasonEditorial(world, 2).at(-1)?.title).not.toContain('突破');
    expect(buildSeasonEditorial(world, 2).filter(item => item.subjectIds.includes(champion))).toHaveLength(1);
  });
});
