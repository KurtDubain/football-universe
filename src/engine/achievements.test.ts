import { describe, expect, it } from 'vitest';
import { checkAchievements } from './achievements';

describe('continental achievements', () => {
  it('counts a continental title toward same-season multi-crown achievements', () => {
    const record = {
      leaguePlayed: 30,
      leagueWon: 20,
      leagueLost: 4,
      leaguePoints: 66,
      leaguePosition: 1,
      promoted: false,
      continentalCupResult: '冠军',
    };

    const achievements = checkAchievements('team', '测试队', 2, record, [record], []);
    expect(achievements.some(entry => entry.id.startsWith('double_crown-team-'))).toBe(true);
  });
});
