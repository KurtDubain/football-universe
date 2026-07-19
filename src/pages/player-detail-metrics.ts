import type { Player, PlayerSeasonStats } from '../types/player';

export interface PlayerHeadlineMetric {
  label: string;
  value: number;
  color?: string;
}

export function getPositionHeadlineMetrics(
  position: Player['position'],
  stats?: PlayerSeasonStats,
): PlayerHeadlineMetric[] {
  const value = (key: keyof PlayerSeasonStats) => Number(stats?.[key] ?? 0);
  const shared = [{ label: '出场', value: value('appearances') }];

  if (position === 'FW') return [
    ...shared,
    { label: '进球', value: value('goals'), color: 'text-amber-400' },
    { label: '助攻', value: value('assists'), color: 'text-blue-400' },
    { label: '关键射门', value: value('bigChances'), color: 'text-red-300' },
  ];
  if (position === 'MF') return [
    ...shared,
    { label: '助攻', value: value('assists'), color: 'text-blue-400' },
    { label: '威胁传球', value: value('keyPasses'), color: 'text-emerald-300' },
    { label: '进球', value: value('goals'), color: 'text-amber-400' },
  ];
  if (position === 'GK') return [
    ...shared,
    { label: '零封', value: value('cleanSheets'), color: 'text-blue-300' },
    { label: '神扑', value: value('saves'), color: 'text-amber-300' },
    { label: '出场分钟', value: value('minutesPlayed') },
  ];
  return [
    ...shared,
    { label: '零封', value: value('cleanSheets'), color: 'text-blue-300' },
    { label: '关键封堵', value: value('keyBlocks'), color: 'text-blue-400' },
    { label: '出场分钟', value: value('minutesPlayed') },
  ];
}
