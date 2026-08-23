import { isDerby, getDerbyName } from '../config/derbies';
import type { TeamBase } from '../types/team';
import {
  getKnockoutRoundRank,
  isGroupStageClosingRound,
} from '../engine/competitions/stage-semantics';
import type { CelebrationType } from './celebration-types';

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
  const knockoutRound = getKnockoutRoundRank(roundLabel);

  if (isDerby(homeTeamId, awayTeamId, teamBases)) {
    tags.push({ label: getDerbyName(homeTeamId, awayTeamId, teamBases) ?? '德比战', color: 'bg-orange-600 text-white', glow: true });
  }
  if (knockoutRound === 4) {
    tags.push({ label: '决赛', color: 'bg-amber-500 text-white', glow: true });
  } else if (knockoutRound === 3) {
    tags.push({ label: '四强', color: 'bg-purple-600 text-white' });
  } else if (knockoutRound === 2) {
    tags.push({ label: '八强', color: 'bg-blue-600 text-white' });
  } else if (knockoutRound === 1) {
    tags.push({ label: '16强', color: 'bg-sky-700 text-white' });
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
  if (isGroupStageClosingRound(competitionType, roundLabel)) {
    tags.push({ label: '小组收官', color: 'bg-red-600 text-white' });
  }
  return tags;
}

export function shouldCelebrate(
  windowType: string,
  roundLabel: string,
  results: { competitionType: string; roundLabel: string }[],
): CelebrationType | null {
  if (results.some(result => getKnockoutRoundRank(result.roundLabel) === 4)) return 'trophy';
  if (windowType === 'season_end') return 'fireworks';
  if (windowType === 'relegation_playoff') return 'confetti';
  if (isGroupStageClosingRound(windowType, roundLabel)) {
    return 'streamers';
  }

  const windowRoundRank = getKnockoutRoundRank(roundLabel);
  const isKnockoutStage = (windowRoundRank > 0 && windowRoundRank < 4)
    || results.some(result => {
      const rank = getKnockoutRoundRank(result.roundLabel);
      return rank > 0 && rank < 4;
    });
  const isCupWindow = windowType === 'league_cup'
    || windowType === 'super_cup'
    || windowType === 'continental_cup'
    || windowType === 'world_cup';
  if (isCupWindow && isKnockoutStage) return 'streamers';

  return null;
}
