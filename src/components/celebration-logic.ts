import { isDerby, getDerbyName } from '../config/derbies';
import type { TeamBase } from '../types/team';

export type MatchTag = {
  label: string;
  color: string;
  glow?: boolean;
};

export function getMatchTags(
  competitionType: string,
  roundLabel: string,
  homeTeamId: string,
  awayTeamId: string,
  standings?: { teamId: string; played?: number }[] | null,
  leagueSize?: number,
  teamBases?: Record<string, TeamBase>,
): MatchTag[] {
  const tags: MatchTag[] = [];
  const rl = roundLabel.toLowerCase();

  if (isDerby(homeTeamId, awayTeamId, teamBases)) {
    tags.push({ label: getDerbyName(homeTeamId, awayTeamId, teamBases) ?? '德比战', color: 'bg-orange-600 text-white', glow: true });
  }
  if (rl.includes('final') || rl.includes('决赛') || roundLabel === 'Final') {
    tags.push({ label: '决赛', color: 'bg-amber-500 text-white', glow: true });
  } else if (rl.includes('sf') || rl.includes('四强')) {
    tags.push({ label: '四强', color: 'bg-purple-600 text-white' });
  } else if (rl.includes('qf') || rl.includes('八强')) {
    tags.push({ label: '八强', color: 'bg-blue-600 text-white' });
  }
  if (competitionType === 'relegation_playoff') {
    tags.push({ label: '保级战', color: 'bg-red-600 text-white', glow: true });
  }
  if (competitionType === 'league' && standings && leagueSize) {
    const homePos = standings.findIndex(s => s.teamId === homeTeamId) + 1;
    const awayPos = standings.findIndex(s => s.teamId === awayTeamId) + 1;
    if (homePos > 0 && awayPos > 0) {
      if (homePos <= 2 && awayPos <= 2 && (standings[0]?.played ?? 0) > 10) {
        tags.push({ label: '冠军战', color: 'bg-amber-600 text-white', glow: true });
      } else if (homePos >= leagueSize - 2 && awayPos >= leagueSize - 2) {
        tags.push({ label: '保级战', color: 'bg-red-600 text-white' });
      } else if ((homePos <= 3 && awayPos >= leagueSize - 2) || (awayPos <= 3 && homePos >= leagueSize - 2)) {
        tags.push({ label: '强弱对话', color: 'bg-slate-600 text-white' });
      }
    }
    const maxRounds = leagueSize >= 16 ? 30 : 14;
    const totalPlayed = standings[0]?.played ?? 0;
    if (totalPlayed >= maxRounds - 3 && totalPlayed > 5) {
      tags.push({ label: '收官之战', color: 'bg-emerald-700 text-white' });
    }
  }
  if ((competitionType === 'super_cup_group' || competitionType === 'world_cup_group') && rl.includes('6')) {
    tags.push({ label: '生死战', color: 'bg-red-500 text-white' });
  }
  return tags;
}

export function shouldCelebrate(
  windowType: string,
  _roundLabel: string,
  results: { competitionType: string; roundLabel: string }[],
): 'trophy' | 'confetti' | null {
  if (results.some(result => result.roundLabel === 'Final' || result.roundLabel === '决赛')) return 'trophy';
  if (windowType === 'season_end' || windowType === 'relegation_playoff') return 'confetti';
  return null;
}
