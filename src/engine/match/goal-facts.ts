import type { MatchEvent, MatchResult } from '../../types/match';

/** Scoring events use the beneficiary team, including own goals (not the offender's club). */
export function goalFacts(result: Pick<MatchResult, 'events' | 'homeTeamId' | 'awayTeamId' | 'homeGoals' | 'awayGoals' | 'etHomeGoals' | 'etAwayGoals'>) {
  let home = 0;
  let away = 0;
  let homeTrailed = false;
  let awayTrailed = false;
  const rows = result.events.filter(event => (event.type === 'goal' || event.type === 'own_goal') && event.minute <= 120)
    .slice().sort((a, b) => a.minute - b.minute).map(event => {
      const isHome = event.teamId === result.homeTeamId;
      const before = isHome ? home - away : away - home;
      const hadTrailed = isHome ? homeTrailed : awayTrailed;
      if (isHome) home++; else away++;
      homeTrailed ||= home < away;
      awayTrailed ||= away < home;
      return { event, home, away, before, equalizer: before === -1, turnaround: before === 0 && hadTrailed };
    });
  const finalHome = result.homeGoals + (result.etHomeGoals ?? 0);
  const finalAway = result.awayGoals + (result.etAwayGoals ?? 0);
  const complete = home === finalHome && away === finalAway;
  return rows.map((row, index) => {
    const isHome = row.event.teamId === result.homeTeamId;
    const late = row.event.minute >= (row.event.minute > 90 ? 115 : 85);
    const leadSurvived = rows.slice(index).every(next => isHome ? next.home > next.away : next.away > next.home);
    return { ...row,
      lateWinner: complete && late && row.before === 0 && leadSurvived && (isHome ? finalHome > finalAway : finalAway > finalHome),
      lateEqualizer: complete && late && row.equalizer && finalHome === finalAway && index === rows.length - 1,
    };
  });
}

export function factForGoal(result: Parameters<typeof goalFacts>[0], event: MatchEvent) {
  return goalFacts(result).find(row => row.event === event);
}
