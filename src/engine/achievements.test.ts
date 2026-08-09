import { describe, expect, it } from 'vitest';
import { checkAchievements } from './achievements';

type AchievementRecord = Parameters<typeof checkAchievements>[3];

function record(overrides: Partial<AchievementRecord> = {}): AchievementRecord {
  return {
    leagueLevel: 1,
    leaguePlayed: 30,
    leagueWon: 15,
    leagueDrawn: 6,
    leagueLost: 9,
    leaguePoints: 51,
    leagueGF: 45,
    leagueGA: 35,
    leaguePosition: 5,
    promoted: false,
    relegated: false,
    ...overrides,
  };
}

describe('achievement semantics', () => {
  it('counts a continental title toward same-season multi-crown achievements', () => {
    const current = record({
      leagueWon: 20,
      leagueLost: 4,
      leaguePoints: 66,
      leaguePosition: 1,
      continentalCupResult: '冠军',
    });

    const achievements = checkAchievements('team', '测试队', 2, current, [current], []);
    expect(achievements.some(entry => entry.id.startsWith('double_crown-team-'))).toBe(true);
  });

  it('awards top-flight promotion only for a real level-two to level-one step after a lower-league path', () => {
    const promotedToLevelTwo = record({ leagueLevel: 3, leaguePosition: 1, promoted: true });
    const firstAchievements = checkAchievements(
      'team',
      '测试队',
      1,
      promotedToLevelTwo,
      [promotedToLevelTwo],
      [],
    );
    expect(firstAchievements.some(entry => entry.id.startsWith('underdog_promo_to_top-'))).toBe(false);

    const promotedToTop = record({ leagueLevel: 2, leaguePosition: 1, promoted: true });
    const secondAchievements = checkAchievements(
      'team',
      '测试队',
      2,
      promotedToTop,
      [promotedToLevelTwo, promotedToTop],
      firstAchievements,
    );
    expect(secondAchievements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'underdog_promo_to_top-team-S2',
        description: '测试队从低级别征程中升入顶级联赛',
      }),
    ]));
  });

  it('does not repeat cumulative milestone achievements in later seasons', () => {
    const fiveCupWins = Array.from({ length: 5 }, () => record({ cupResult: '冠军' }));
    const existing = [{
      id: 'cup_dynasty-team-S5',
      title: '杯赛之王',
      description: '测试队5+次捧起联赛杯，杯赛专家',
      seasonNumber: 5,
      teamId: 'team',
    }];
    const current = record();

    const achievements = checkAchievements(
      'team',
      '测试队',
      6,
      current,
      [...fiveCupWins, current],
      existing,
    );
    expect(achievements.some(entry => entry.id.startsWith('cup_dynasty-'))).toBe(false);
  });

  it('uses schedule-normalized rates for scoring and defensive achievements', () => {
    const shortSchedule = record({
      leagueLevel: 3,
      leaguePlayed: 14,
      leagueWon: 9,
      leagueDrawn: 3,
      leagueLost: 2,
      leaguePoints: 30,
      leagueGF: 28,
      leagueGA: 7,
    });
    const longSchedule = record({ leaguePlayed: 30, leagueGF: 59, leagueGA: 16 });

    const shortAchievements = checkAchievements('short', '短赛季队', 1, shortSchedule, [shortSchedule], []);
    const longAchievements = checkAchievements('long', '长赛季队', 1, longSchedule, [longSchedule], []);

    expect(shortAchievements.some(entry => entry.id.startsWith('goal_machine-'))).toBe(true);
    expect(shortAchievements.some(entry => entry.id.startsWith('iron_wall-'))).toBe(true);
    expect(longAchievements.some(entry => entry.id.startsWith('goal_machine-'))).toBe(false);
    expect(longAchievements.some(entry => entry.id.startsWith('iron_wall-'))).toBe(false);
  });

  it('does not mistake consecutive lower-league titles for a top-flight dynasty', () => {
    const records = [
      record({ leagueLevel: 3, leaguePosition: 1, promoted: true }),
      record({ leagueLevel: 2, leaguePosition: 1, promoted: true }),
    ];

    const achievements = checkAchievements('team', '测试队', 2, records[1], records, []);
    expect(achievements.some(entry => entry.id.startsWith('back_to_back-'))).toBe(false);
  });
});
