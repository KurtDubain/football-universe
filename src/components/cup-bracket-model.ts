import type { CupFixture, CupRound } from '../types/cup';

const roundNameCN: Record<string, string> = {
  R32: '32强',
  R16: '16强',
  QF: '八强',
  SF: '半决赛',
  Final: '决赛',
  'QF-L1': '八强首回合',
  'QF-L2': '八强次回合',
  'SF-L1': '半决赛首回合',
  'SF-L2': '半决赛次回合',
};

export interface MergedRound {
  key: string;
  label: string;
  twoLegged: boolean;
  completed: boolean;
  synthetic?: boolean;
  ties: MergedTie[];
}

export interface MergedTie {
  leg1: CupFixture | null;
  leg2: CupFixture | null;
  team1Id: string;
  team2Id: string;
  winnerId?: string;
  agg1?: number;
  agg2?: number;
  awayGoals1?: number;
  awayGoals2?: number;
}

function cnRound(name: string): string {
  return roundNameCN[name] ?? name;
}

function emptyTie(): MergedTie {
  return { leg1: null, leg2: null, team1Id: '', team2Id: '' };
}

function labelForTieCount(tieCount: number): string {
  if (tieCount >= 16) return '32强';
  if (tieCount === 8) return '16强';
  if (tieCount === 4) return '八强';
  if (tieCount === 2) return '半决赛';
  return '决赛';
}

export function buildMergedRounds(rounds: CupRound[]): MergedRound[] {
  const merged: MergedRound[] = [];
  const processed = new Set<number>();

  for (let index = 0; index < rounds.length; index++) {
    if (processed.has(index)) continue;
    const round = rounds[index];
    const name = round.roundName;

    if (name.endsWith('-L1')) {
      const baseName = name.replace('-L1', '');
      const secondLegIndex = rounds.findIndex(
        (candidate, candidateIndex) => candidateIndex > index && candidate.roundName === `${baseName}-L2`,
      );
      const secondLegRound = secondLegIndex >= 0 ? rounds[secondLegIndex] : undefined;
      processed.add(index);
      if (secondLegIndex >= 0) processed.add(secondLegIndex);

      const ties = round.fixtures.map(leg1 => {
        const leg2 = secondLegRound?.fixtures.find(candidate => (
          candidate.homeTeamId === leg1.awayTeamId && candidate.awayTeamId === leg1.homeTeamId
        )) ?? null;
        let agg1: number | undefined;
        let agg2: number | undefined;
        let awayGoals1: number | undefined;
        let awayGoals2: number | undefined;

        if (leg1.result && leg2?.result) {
          agg1 = leg1.result.home + leg2.result.away;
          agg2 = leg1.result.away + leg2.result.home;
          awayGoals1 = leg2.result.away;
          awayGoals2 = leg1.result.away;
        } else if (leg1.result) {
          agg1 = leg1.result.home;
          agg2 = leg1.result.away;
        }

        return {
          leg1,
          leg2,
          team1Id: leg1.homeTeamId,
          team2Id: leg1.awayTeamId,
          winnerId: leg2?.winnerId,
          agg1,
          agg2,
          awayGoals1,
          awayGoals2,
        };
      });

      merged.push({
        key: baseName,
        label: cnRound(baseName),
        twoLegged: true,
        completed: round.completed && Boolean(secondLegRound?.completed),
        ties,
      });
      continue;
    }

    processed.add(index);
    merged.push({
      key: name,
      label: cnRound(name),
      twoLegged: false,
      completed: round.completed,
      ties: round.fixtures.map(fixture => ({
        leg1: fixture,
        leg2: null,
        team1Id: fixture.homeTeamId,
        team2Id: fixture.awayTeamId,
        winnerId: fixture.winnerId,
        agg1: fixture.result?.home,
        agg2: fixture.result?.away,
      })),
    });
  }

  return merged;
}

export function buildDisplayRounds(merged: MergedRound[]): MergedRound[] {
  const display = merged.map(round => ({ ...round, ties: [...round.ties] }));
  let nextTieCount = display.at(-1)?.ties.length ?? 0;

  while (nextTieCount > 1) {
    nextTieCount = Math.ceil(nextTieCount / 2);
    const label = labelForTieCount(nextTieCount);
    display.push({
      key: `future-${nextTieCount}`,
      label,
      twoLegged: false,
      completed: false,
      synthetic: true,
      ties: Array.from({ length: nextTieCount }, emptyTie),
    });
  }

  return display;
}
