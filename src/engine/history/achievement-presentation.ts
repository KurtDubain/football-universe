import type { Achievement } from '../achievements';

export interface AchievementPresentationSingle {
  kind: 'single';
  key: string;
  achievementType: string;
  seasonNumber: number;
  achievement: Achievement;
  teamId?: string;
  followed: boolean;
  rarity: number;
}

export interface AchievementPresentationGroup {
  kind: 'group';
  key: string;
  achievementType: string;
  seasonNumber: number;
  title: string;
  entries: { achievement: Achievement; teamId?: string }[];
  teamIds: string[];
  followed: false;
  rarity: number;
}

export type AchievementPresentationItem =
  | AchievementPresentationSingle
  | AchievementPresentationGroup;

const ACHIEVEMENT_RARITY: Record<string, number> = {
  legend_team: 100,
  five_peat: 98,
  quadruple: 96,
  rookie_champion: 94,
  comeback: 92,
  no_wins: 90,
  three_peat: 88,
  unbeaten: 86,
  cup_dynasty: 84,
  promotion_streak: 82,
  triple_crown: 80,
  avalanche: 76,
  massacre: 74,
  collector_3: 72,
  back_to_back: 70,
  double_crown: 68,
  first_world_cup: 66,
  underdog_promo_to_top: 64,
  dominant: 58,
  centurion: 56,
  goal_machine: 54,
  iron_wall: 52,
  first_league_title: 50,
  first_cup: 48,
  first_super_cup: 46,
  survivor_5: 44,
  almost_perfect: 34,
  rock_bottom: 32,
  first_promotion: 24,
  first_relegation: 22,
};

function stripSeasonSuffix(id: string, seasonNumber: number): string {
  const suffix = `-S${seasonNumber}`;
  return id.endsWith(suffix) ? id.slice(0, -suffix.length) : id;
}

function resolveAchievementIdentity(
  achievement: Achievement,
  knownTeamIds: readonly string[],
): { achievementType: string; teamId?: string } {
  const withoutSeason = stripSeasonSuffix(achievement.id, achievement.seasonNumber);
  const candidates = achievement.teamId
    ? [achievement.teamId]
    : [...knownTeamIds].sort((a, b) => b.length - a.length || a.localeCompare(b));

  for (const teamId of candidates) {
    const teamSuffix = `-${teamId}`;
    if (withoutSeason.endsWith(teamSuffix)) {
      return {
        achievementType: withoutSeason.slice(0, -teamSuffix.length) || achievement.id,
        teamId,
      };
    }
  }

  return {
    achievementType: withoutSeason,
    teamId: achievement.teamId,
  };
}

function getRarity(achievementType: string): number {
  return ACHIEVEMENT_RARITY[achievementType] ?? 40;
}

function itemTier(item: AchievementPresentationItem): number {
  if (item.followed) return 0;
  return item.rarity >= 64 ? 1 : 2;
}

function compareItems(a: AchievementPresentationItem, b: AchievementPresentationItem): number {
  return itemTier(a) - itemTier(b)
    || b.rarity - a.rarity
    || b.seasonNumber - a.seasonNumber
    || a.achievementType.localeCompare(b.achievementType)
    || a.key.localeCompare(b.key);
}

export function buildAchievementPresentation(
  achievements: readonly Achievement[],
  followedTeamIds: readonly string[],
  knownTeamIds: readonly string[],
): AchievementPresentationItem[] {
  const followed = new Set(followedTeamIds);
  const singles: AchievementPresentationSingle[] = [];
  const globalGroups = new Map<string, AchievementPresentationSingle[]>();

  for (const achievement of achievements) {
    const identity = resolveAchievementIdentity(achievement, knownTeamIds);
    const item: AchievementPresentationSingle = {
      kind: 'single',
      key: `achievement:${achievement.id}`,
      achievementType: identity.achievementType,
      seasonNumber: achievement.seasonNumber,
      achievement,
      teamId: identity.teamId,
      followed: !!identity.teamId && followed.has(identity.teamId),
      rarity: getRarity(identity.achievementType),
    };

    if (item.followed) {
      singles.push(item);
      continue;
    }

    const groupKey = `${item.seasonNumber}:${item.achievementType}`;
    const group = globalGroups.get(groupKey) ?? [];
    group.push(item);
    globalGroups.set(groupKey, group);
  }

  for (const group of globalGroups.values()) {
    group.sort((a, b) => a.achievement.id.localeCompare(b.achievement.id));
    if (group.length === 1) {
      singles.push(group[0]);
    }
  }

  const groupedKeys = new Set(
    [...globalGroups.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key]) => key),
  );
  const items: AchievementPresentationItem[] = singles
    .filter(item => !groupedKeys.has(`${item.seasonNumber}:${item.achievementType}`))
    .map(item => item);

  for (const [groupKey, group] of globalGroups) {
    if (group.length < 2) continue;
    const first = group[0];
    items.push({
      kind: 'group',
      key: `achievement-group:${groupKey}`,
      achievementType: first.achievementType,
      seasonNumber: first.seasonNumber,
      title: first.achievement.title,
      entries: group.map(item => ({ achievement: item.achievement, teamId: item.teamId })),
      teamIds: [...new Set(group.map(item => item.teamId).filter((teamId): teamId is string => !!teamId))],
      followed: false,
      rarity: first.rarity,
    });
  }

  return items.sort(compareItems);
}
