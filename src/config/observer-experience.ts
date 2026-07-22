import type { TeamBase } from '../types/team';

export const OBSERVER_SEED_CANDIDATES = Array.from(
  { length: 20 },
  (_, index) => 20260701 + index,
);

// Selected by scripts/audit-observer-seeds.ts from the candidates above.
export const RECOMMENDED_EXPERIENCE_SEED = 20260718;

export type ObserverLens = 'giant' | 'challenger' | 'underdog' | 'neutral';

export interface ObserverLensOption {
  id: ObserverLens;
  label: string;
  description: string;
  teamId: string | null;
}

function byOverallThenReputation(a: TeamBase, b: TeamBase): number {
  return b.overall - a.overall || b.reputation - a.reputation || a.id.localeCompare(b.id);
}

export function getObserverLensOptions(teams: TeamBase[]): ObserverLensOption[] {
  const giant = teams
    .filter(team => team.initialLeagueLevel === 1 && team.tier === 'elite')
    .sort(byOverallThenReputation)[0];
  const challenger = teams
    .filter(team => team.initialLeagueLevel === 1 && team.tier !== 'elite')
    .sort((a, b) => a.expectation - b.expectation || byOverallThenReputation(a, b))[0];
  const underdog = teams
    .filter(team => team.initialLeagueLevel === 3)
    .sort(byOverallThenReputation)[0];

  return [
    {
      id: 'giant',
      label: '豪门守成',
      description: '观察冠军压力与王朝延续',
      teamId: giant?.id ?? null,
    },
    {
      id: 'challenger',
      label: '挑战者',
      description: '观察中游球队冲击既有秩序',
      teamId: challenger?.id ?? null,
    },
    {
      id: 'underdog',
      label: '草根长征',
      description: '从低级别联赛见证漫长上升',
      teamId: underdog?.id ?? null,
    },
    {
      id: 'neutral',
      label: '纯观察',
      description: '不绑定球队，只看世界自然演化',
      teamId: null,
    },
  ];
}
