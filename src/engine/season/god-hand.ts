import type { TeamBase } from '../../types/team';
import type { GameWorld, GodHandIntervention, NewsItem } from './season-manager';

export const GOD_HAND_HISTORY_LIMIT = 100;

type MutableTeamField = 'attack' | 'midfield' | 'stability' | 'depth';

const EFFECTS: Record<GodHandIntervention['type'], Partial<Record<MutableTeamField, number>>> = {
  boost: { attack: 5, midfield: 3, stability: 4 },
  nerf: { attack: -4, stability: -5, depth: -4 },
};

function clampTeamValue(value: number): number {
  return Math.max(30, Math.min(99, value));
}

export function applyGodHandIntervention(
  world: GameWorld,
  teamId: string,
  type: GodHandIntervention['type'],
): GameWorld {
  const source = world.teamBases[teamId];
  if (!source || world.godHandUsed) return world;

  const team: TeamBase = { ...source };
  const effects: GodHandIntervention['effects'] = [];
  for (const [field, delta] of Object.entries(EFFECTS[type]) as Array<[MutableTeamField, number]>) {
    const before = team[field];
    const after = clampTeamValue(before + delta);
    team[field] = after;
    effects.push({ field, before, after });
  }

  const season = world.seasonState.seasonNumber;
  const windowIndex = world.seasonState.currentWindowIndex;
  const intervention: GodHandIntervention = {
    id: `god-hand-S${season}-W${windowIndex}-${teamId}`,
    season,
    windowIndex,
    teamId,
    type,
    effects,
  };
  const newsItem: NewsItem = {
    id: intervention.id,
    seasonNumber: season,
    windowIndex,
    type: 'intervention',
    importance: 'major',
    title: type === 'boost' ? `命运被改写：${team.name} 获得祝福` : `命运被改写：${team.name} 遭遇厄运`,
    description: type === 'boost'
      ? `观察者干预了这个宇宙，${team.name}的进攻、中场与稳定性获得永久提升。`
      : `观察者干预了这个宇宙，${team.name}的进攻、稳定性与阵容深度遭到永久削弱。`,
  };

  return {
    ...world,
    teamBases: { ...world.teamBases, [teamId]: team },
    godHandUsed: true,
    godHandHistory: [...(world.godHandHistory ?? []), intervention].slice(-GOD_HAND_HISTORY_LIMIT),
    newsLog: [...world.newsLog, newsItem],
  };
}

