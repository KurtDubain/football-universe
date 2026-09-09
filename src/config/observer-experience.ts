import type { TeamBase } from '../types/team';

export const OBSERVER_SEED_CANDIDATES = Array.from(
  { length: 20 },
  (_, index) => 20260701 + index,
);

// Selected by scripts/audit-observer-seeds.ts from the candidates above. The
// audit balances six-window observation depth, narrative variety, meaningful
// choices, and restrained match drama across the three guided lenses.
export const RECOMMENDED_EXPERIENCE_SEED = 20260709;

export type ObserverLens = 'giant' | 'challenger' | 'underdog' | 'neutral';

export interface ObserverLensOption {
  id: ObserverLens;
  label: string;
  description: string;
  teamId: string | null;
}

export interface ObserverOpeningSignals {
  lens: Exclude<ObserverLens, 'neutral'>;
  importanceScore: number;
  meaningfulReasonCount: number;
  goals: number;
  margin: number;
  lateGoals: number;
  redCards: number;
  deniedGoals: number;
  upset: boolean;
}

export function scoreWorldMomentCadence(count: number): number {
  const bounded = Math.max(0, Math.floor(count));
  if (bounded === 0) return -2;
  if (bounded <= 3) return [0, 5, 9, 12][bounded];
  return 12 - (bounded - 3) * 5;
}

export function scoreObserverOpening(signals: ObserverOpeningSignals): number {
  const lensWeight = signals.lens === 'challenger' ? 1.35 : 1;
  const quality = signals.importanceScore * 1.5
    + Math.min(2, signals.meaningfulReasonCount) * 3
    + Math.min(3, signals.goals) * 2
    + (signals.margin <= 1 ? 12 : signals.margin === 2 ? 6 : 0)
    + signals.lateGoals * 3
    + signals.redCards * 3
    + signals.deniedGoals * 2
    + Number(signals.upset) * 5
    - Math.max(0, signals.margin - 1) * 5
    - Math.max(0, signals.goals - 5) * 3;
  return quality * lensWeight;
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
      description: '观察弱旅如何在顶级联赛生存、反击与逆袭',
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
