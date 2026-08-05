import type { Player, PlayerSeasonStats } from '../types/player';

export interface PlayerHeadlineMetric {
  label: string;
  value: number;
  color?: string;
  tooltip?: string;
}

export function getPositionHeadlineMetrics(
  position: Player['position'],
  stats?: PlayerSeasonStats,
): PlayerHeadlineMetric[] {
  const value = (key: keyof PlayerSeasonStats) => Number(stats?.[key] ?? 0);
  const scope = '当前赛季全赛事统计，点球大战不计入常规数据。';
  const shared = [{ label: '出场', value: value('appearances'), tooltip: scope }];

  if (position === 'FW') return [
    ...shared,
    { label: '进球', value: value('goals'), color: 'text-amber-400', tooltip: scope },
    { label: '助攻', value: value('assists'), color: 'text-blue-400', tooltip: scope },
    { label: '额外关键机会', value: Math.max(0, value('bigChances') - value('goals')), color: 'text-red-300', tooltip: `除进球外，由关键扑救或门线封堵拒绝的得分机会。${scope}` },
  ];
  if (position === 'MF') return [
    ...shared,
    { label: '助攻', value: value('assists'), color: 'text-blue-400', tooltip: scope },
    { label: '额外创造机会', value: Math.max(0, value('keyPasses') - value('assists')), color: 'text-emerald-300', tooltip: `除助攻外，为被关键防守拒绝的机会提供的最后一传。${scope}` },
    { label: '进球', value: value('goals'), color: 'text-amber-400', tooltip: scope },
  ];
  if (position === 'GK') return [
    ...shared,
    { label: '普通扑救', value: value('routineSaves'), color: 'text-blue-300', tooltip: `由对方射正减去进球、关键扑救和门线封堵后得到，并绑定实际在场门将。${scope}` },
    { label: '关键扑救', value: value('saves'), color: 'text-amber-300', tooltip: `拒绝高威胁得分机会的扑救，不与普通扑救重复。${scope}` },
    { label: '零封分钟', value: value('cleanSheetMinutes'), tooltip: `球队整场零失球时，该球员实际出场的分钟数。${scope}` },
  ];
  return [
    ...shared,
    { label: '拦截', value: value('interceptions'), color: 'text-emerald-300', tooltip: `由比赛进攻压力和实际出场阵容产生的拦截。${scope}` },
    { label: '解围', value: value('clearances'), color: 'text-blue-300', tooltip: `由对手射门、角球和控球压力产生的解围。${scope}` },
    { label: '门线封堵', value: value('keyBlocks'), color: 'text-blue-400', tooltip: `在门线上阻止原本会形成进球的关键封堵。${scope}` },
  ];
}
