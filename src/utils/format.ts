import type { WindowType } from '../types/season';

export function getTeamName(id: string, teamBases: Record<string, { name: string }>): string {
  return teamBases[id]?.name ?? id;
}

export function getTeamShortName(id: string, teamBases: Record<string, { shortName?: string }>): string {
  return teamBases[id]?.shortName ?? id;
}

export function getCoachName(id: string, coachBases: Record<string, { name: string }>): string {
  return coachBases[id]?.name ?? id;
}

export function formatForm(form: ('W' | 'D' | 'L')[]): { label: string; color: string }[] {
  return form.map((r) => {
    switch (r) {
      case 'W':
        return { label: 'W', color: 'bg-green-500' };
      case 'D':
        return { label: 'D', color: 'bg-blue-500' };
      case 'L':
        return { label: 'L', color: 'bg-red-500' };
    }
  });
}

export function getWindowTypeColor(type: WindowType): string {
  switch (type) {
    case 'league':
      return 'bg-emerald-600';
    case 'league_cup':
      return 'bg-amber-600';
    case 'super_cup':
    case 'super_cup_group':
      return 'bg-purple-600';
    case 'world_cup':
    case 'world_cup_group':
      return 'bg-sky-600';
    case 'relegation_playoff':
      return 'bg-red-600';
    case 'season_end':
      return 'bg-slate-600';
    case 'pre_season':
      return 'bg-slate-500';
    default:
      return 'bg-slate-600';
  }
}

export function getWindowTypeLabel(type: WindowType): string {
  switch (type) {
    case 'league':
      return '联赛';
    case 'league_cup':
      return '联赛杯';
    case 'super_cup':
      return '超级杯';
    case 'super_cup_group':
      return '超级杯小组赛';
    case 'world_cup':
      return '环球冠军杯';
    case 'world_cup_group':
      return '环球冠军杯小组赛';
    case 'relegation_playoff':
      return '保级附加赛';
    case 'season_end':
      return '赛季结算';
    case 'pre_season':
      return '赛季前';
    default:
      return type;
  }
}

export function getLeagueName(level: number): string {
  switch (level) {
    case 1:
      return '顶级联赛';
    case 2:
      return '甲级联赛';
    case 3:
      return '乙级联赛';
    default:
      return `${level}级联赛`;
  }
}

export function getTrophyLabel(type: string): string {
  switch (type) {
    case 'league1':
      return '顶级联赛冠军';
    case 'league2':
      return '甲级联赛冠军';
    case 'league3':
      return '乙级联赛冠军';
    case 'league_cup':
      return '联赛杯冠军';
    case 'super_cup':
      return '超级杯冠军';
    case 'world_cup':
      return '环球冠军杯冠军';
    default:
      return type;
  }
}

export function getCoachStyleLabel(style: string): string {
  switch (style) {
    case 'attacking':
      return '进攻型';
    case 'defensive':
      return '防守型';
    case 'balanced':
      return '均衡型';
    case 'possession':
      return '控球型';
    case 'counter':
      return '反击型';
    default:
      return style;
  }
}
