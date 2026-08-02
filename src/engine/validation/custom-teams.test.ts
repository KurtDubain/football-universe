import { describe, expect, it } from 'vitest';
import { defaultTeams } from '../../config/teams';
import { parseCustomTeams } from './custom-teams';

describe('parseCustomTeams', () => {
  it('accepts a complete valid 32-team universe', () => {
    expect(parseCustomTeams(structuredClone(defaultTeams))).toHaveLength(32);
  });

  it('rejects duplicate ids and invalid fields', () => {
    const duplicate = structuredClone(defaultTeams);
    duplicate[1].id = duplicate[0].id;
    expect(() => parseCustomTeams(duplicate)).toThrow('球队 id 重复');

    const invalidRating = structuredClone(defaultTeams);
    invalidRating[0].overall = 120;
    expect(() => parseCustomTeams(invalidRating)).toThrow('overall 必须是 0-100');
  });

  it('rejects invalid league allocations', () => {
    const teams = structuredClone(defaultTeams);
    teams[0].initialLeagueLevel = 2;
    expect(() => parseCustomTeams(teams)).toThrow('联赛初始配额无效');
  });
});
