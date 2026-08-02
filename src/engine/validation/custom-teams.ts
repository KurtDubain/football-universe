import type { TeamBase, TeamTier } from '../../types/team';

const TEAM_TIERS = new Set<TeamTier>(['elite', 'strong', 'mid', 'lower', 'underdog']);
const RATING_FIELDS = ['overall', 'attack', 'midfield', 'defense', 'stability', 'depth', 'reputation'] as const;
const EXPECTED_LEAGUE_COUNTS = new Map<number, number>([[1, 16], [2, 8], [3, 8]]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(team: Record<string, unknown>, key: string, index: number, maxLength: number): string {
  const value = team[key];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`第 ${index + 1} 支球队的 ${key} 字段无效`);
  }
  return value;
}

function requireIntegerInRange(
  team: Record<string, unknown>,
  key: string,
  index: number,
  min: number,
  max: number,
): number {
  const value = team[key];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`第 ${index + 1} 支球队的 ${key} 必须是 ${min}-${max} 的整数`);
  }
  return value as number;
}

export function parseCustomTeams(value: unknown): TeamBase[] {
  if (!Array.isArray(value) || value.length !== 32) {
    throw new Error('球队文件必须包含正好 32 支球队');
  }

  const ids = new Set<string>();
  const leagueCounts = new Map<number, number>();
  const teams = value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`第 ${index + 1} 支球队不是有效对象`);

    const id = requireText(candidate, 'id', index, 48);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`第 ${index + 1} 支球队的 id 只能包含字母、数字、下划线和连字符`);
    }
    if (ids.has(id)) throw new Error(`球队 id 重复：${id}`);
    ids.add(id);

    requireText(candidate, 'name', index, 40);
    requireText(candidate, 'shortName', index, 12);
    requireText(candidate, 'region', index, 60);
    const color = requireText(candidate, 'color', index, 9);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error(`第 ${index + 1} 支球队的 color 必须是六位十六进制颜色`);
    }
    if (typeof candidate.tier !== 'string' || !TEAM_TIERS.has(candidate.tier as TeamTier)) {
      throw new Error(`第 ${index + 1} 支球队的 tier 无效`);
    }
    for (const field of RATING_FIELDS) requireIntegerInRange(candidate, field, index, 0, 100);
    const level = requireIntegerInRange(candidate, 'initialLeagueLevel', index, 1, 3);
    requireIntegerInRange(candidate, 'expectation', index, 1, 5);
    leagueCounts.set(level, (leagueCounts.get(level) ?? 0) + 1);

    return candidate as unknown as TeamBase;
  });

  for (const [level, expected] of EXPECTED_LEAGUE_COUNTS) {
    const actual = leagueCounts.get(level) ?? 0;
    if (actual !== expected) {
      throw new Error(`联赛初始配额无效：L${level} 需要 ${expected} 支，当前 ${actual} 支`);
    }
  }

  return teams;
}
