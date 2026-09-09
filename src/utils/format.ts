import type { CalendarWindow, WindowType } from '../types/season';
import type { StandingEntry } from '../types/league';
import type { TeamTier } from '../types/team';

export interface SeasonWindowDisplay {
  completedWindows: number;
  totalWindows: number;
  currentWindowNumber: number | null;
}

export function getSeasonWindowDisplay(
  calendar: readonly CalendarWindow[],
  currentWindowIndex: number,
): SeasonWindowDisplay {
  const totalWindows = calendar.length;
  const completedWindows = calendar.filter(window => window.completed).length;
  const currentWindow = calendar[currentWindowIndex];
  return {
    completedWindows,
    totalWindows,
    currentWindowNumber: currentWindow
      ? Math.min(Math.max(1, currentWindowIndex + 1), totalWindows)
      : null,
  };
}

export function getStandingRank(
  standings: readonly StandingEntry[],
  teamId: string,
): number | null {
  const index = standings.findIndex(entry => entry.teamId === teamId);
  const row = index >= 0 ? standings[index] : null;
  if (!row || row.played === 0) return null;
  return index + 1;
}

export function getStandingPositionLabel(
  standings: readonly StandingEntry[],
  teamId: string,
): string {
  const rank = getStandingRank(standings, teamId);
  return rank === null ? '排名未形成' : `#${rank}`;
}

export function getTeamName(id: string, teamBases: Record<string, { name: string }>): string {
  return teamBases[id]?.name ?? id;
}

export function getTeamShortName(id: string, teamBases: Record<string, { shortName?: string }>): string {
  return teamBases[id]?.shortName ?? id;
}

export function getCoachName(id: string, coachBases: Record<string, { name: string }>): string {
  return coachBases[id]?.name ?? id;
}

export function formatChineseList(items: readonly string[], conjunction = '和'): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]}${conjunction}${items[1]}`;
  return `${items.slice(0, -1).join('、')}${conjunction}${items.at(-1)}`;
}

export function cnRoundLabel(name: string): string {
  const map: Record<string, string> = {
    R32: '32强',
    R16: '16强',
    QF: '八强',
    SF: '四强',
    Final: '决赛',
    'Round of 16': '16强',
    'Quarter-final': '八强',
    'Semi-final': '四强',
  };
  if (map[name]) return map[name];
  const numberedRound = /^Round\s+(\d+)$/i.exec(name.trim());
  if (numberedRound) return `第${numberedRound[1]}轮`;
  const hyphenToken = name.split('-')[0];
  if (map[hyphenToken]) return map[hyphenToken];
  const token = Object.keys(map).find(key => name.startsWith(`${key} `));
  return token ? `${map[token]}${name.slice(token.length)}` : name;
}

export function formatForm(form: ('W' | 'D' | 'L')[]): { label: string; color: string }[] {
  return form.map((r) => {
    switch (r) {
      case 'W': return { label: '胜', color: 'bg-green-500' };
      case 'D': return { label: '平', color: 'bg-slate-500' };
      case 'L': return { label: '负', color: 'bg-red-500' };
    }
  });
}

export function getWindowTypeColor(type: WindowType): string {
  switch (type) {
    case 'league': return 'bg-emerald-600';
    case 'league_cup': return 'bg-amber-600';
    case 'super_cup':
    case 'super_cup_group': return 'bg-purple-600';
    case 'world_cup':
    case 'world_cup_group': return 'bg-sky-600';
    case 'continental_cup': return 'bg-orange-600';
    case 'relegation_playoff': return 'bg-red-600';
    case 'season_end': return 'bg-slate-600';
    case 'pre_season': return 'bg-slate-500';
    default: return 'bg-slate-600';
  }
}

export function getWindowTypeLabel(type: WindowType): string {
  switch (type) {
    case 'league': return '联赛';
    case 'league_cup': return '联赛杯';
    case 'super_cup': return '超级杯';
    case 'super_cup_group': return '超级杯小组赛';
    case 'world_cup': return '环球冠军杯';
    case 'world_cup_group': return '环球冠军杯小组赛';
    case 'continental_cup': return '洲际杯';
    case 'relegation_playoff': return '保级附加赛';
    case 'season_end': return '赛季结算';
    case 'pre_season': return '赛季前';
    default: return type;
  }
}

export function getLeagueName(level: number): string {
  switch (level) {
    case 1: return '顶级联赛';
    case 2: return '甲级联赛';
    case 3: return '乙级联赛';
    default: return `${level}级联赛`;
  }
}

export function getTrophyLabel(type: string): string {
  switch (type) {
    case 'league1': return '顶级联赛冠军';
    case 'league2': return '甲级联赛冠军';
    case 'league3': return '乙级联赛冠军';
    case 'league_cup': return '联赛杯冠军';
    case 'super_cup': return '超级杯冠军';
    case 'world_cup': return '环球冠军杯冠军';
    case 'mainland_cup': return '大陆杯冠军';
    case 'southern_cup': return '南洲杯冠军';
    case 'eastern_cup': return '东洲杯冠军';
    default: return type;
  }
}

export function getCoachStyleLabel(style: string): string {
  switch (style) {
    case 'attacking': return '进攻型';
    case 'defensive': return '防守型';
    case 'balanced': return '均衡型';
    case 'possession': return '控球型';
    case 'counter': return '反击型';
    default: return style;
  }
}

export function getTierLabel(tier: TeamTier): string {
  switch (tier) {
    case 'elite': return '豪门';
    case 'strong': return '劲旅';
    case 'mid': return '中游';
    case 'lower': return '平民';
    case 'underdog': return '草根';
  }
}

export function getTierColor(tier: TeamTier): string {
  switch (tier) {
    case 'elite': return 'text-amber-400 bg-amber-900/30';
    case 'strong': return 'text-blue-400 bg-blue-900/30';
    case 'mid': return 'text-slate-300 bg-slate-700/50';
    case 'lower': return 'text-emerald-400 bg-emerald-900/30';
    case 'underdog': return 'text-slate-400 bg-slate-700/30';
  }
}
