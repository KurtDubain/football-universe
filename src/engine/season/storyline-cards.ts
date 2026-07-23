import type { StandingEntry } from '../../types/league';
import type { GameWorld } from './season-manager';

export type StorylineCardType = 'dark_horse' | 'giant_crisis' | 'promoted_survival';
export type StorylineCardPhase = '出现' | '发展' | '高潮';

export interface StorylineCard {
  teamId: string;
  scope: 'focus' | 'world';
  type: StorylineCardType;
  phase: StorylineCardPhase;
  title: string;
  body: string;
  evidence: string[];
  nextWatch: string;
  priority: number;
}

function standingsFor(world: GameWorld, level: 1 | 2 | 3): StandingEntry[] {
  if (level === 1) return world.league1Standings;
  if (level === 2) return world.league2Standings;
  return world.league3Standings;
}

function expectedPosition(teamCount: number, expectation: number): number {
  return Math.max(1, Math.min(
    teamCount,
    Math.round(teamCount * (1 - (expectation - 1) / 4)),
  ));
}

function recentFormEvidence(form: Array<'W' | 'D' | 'L'>): string | null {
  if (form.length === 0) return null;
  const wins = form.filter(result => result === 'W').length;
  const draws = form.filter(result => result === 'D').length;
  const losses = form.filter(result => result === 'L').length;
  return `近${form.length}场 ${wins}胜${draws}平${losses}负`;
}

function phaseFor(progress: number, climax: boolean): StorylineCardPhase {
  if (climax || progress >= 0.72) return '高潮';
  if (progress >= 0.42) return '发展';
  return '出现';
}

function detectTeamCards(world: GameWorld, teamId: string): StorylineCard[] {
  const team = world.teamBases[teamId];
  const state = world.teamStates[teamId];
  if (!team || !state) return [];
  const standings = standingsFor(world, state.leagueLevel);
  const rowIndex = standings.findIndex(row => row.teamId === teamId);
  if (rowIndex < 0) return [];
  const row = standings[rowIndex];
  if (row.played < 4) return [];

  const rank = rowIndex + 1;
  const totalGames = Math.max(1, (standings.length - 1) * 2);
  const progress = row.played / totalGames;
  const expected = expectedPosition(standings.length, team.expectation);
  const rankDelta = expected - rank;
  const form = recentFormEvidence(state.recentForm);
  const baseEvidence = [
    `联赛第${rank}/${standings.length}`,
    `${row.played}轮 ${row.points}分`,
    form,
  ].filter((item): item is string => Boolean(item));
  const cards: StorylineCard[] = [];

  if (team.expectation <= 3 && rank <= Math.max(3, Math.ceil(standings.length / 4)) && rankDelta >= 3) {
    cards.push({
      teamId,
      scope: 'world',
      type: 'dark_horse',
      phase: phaseFor(progress, progress >= 0.65 && rank <= 2),
      title: `${team.name}成为黑马`,
      body: `赛前位置预期约为第${expected}，目前已来到第${rank}，排名提升${rankDelta}位。`,
      evidence: [`预期约第${expected}`, ...baseEvidence].slice(0, 3),
      nextWatch:
        rank === 1
          ? '能否守住榜首'
          : standings[0].points === row.points
            ? '与榜首同分'
            : `与榜首还差${standings[0].points - row.points}分`,
      priority: 30 + rankDelta * 2 + Math.round(progress * 8) - rank,
    });
  }

  const crisisDelta = rank - expected;
  if (
    team.expectation >= 4
    && crisisDelta >= 3
    && (rank > standings.length / 2 || state.coachPressure >= 55)
  ) {
    cards.push({
      teamId,
      scope: 'world',
      type: 'giant_crisis',
      phase: phaseFor(progress, state.coachPressure >= 75 || progress >= 0.68),
      title: `${team.name}偏离赛季预期`,
      body: `赛前位置预期约为第${expected}，目前仅列第${rank}；这是排名偏差，不预设任何场外原因。`,
      evidence: [`预期约第${expected}`, `联赛第${rank}/${standings.length}`, `教练压力 ${state.coachPressure}`],
      nextWatch: state.coachPressure >= 70 ? '下一轮能否止住压力上升' : '能否追回预期排名',
      priority: 28 + crisisDelta * 2 + Math.floor(state.coachPressure / 15),
    });
  }

  const previousRecord = world.teamSeasonRecords[teamId]?.at(-1);
  const isPromotedSide = previousRecord?.seasonNumber === world.seasonState.seasonNumber - 1
    && previousRecord.promoted;
  if (isPromotedSide) {
    const relegationLine = standings.length - 3;
    const safetyGap = rank <= relegationLine
      ? row.points - (standings[relegationLine]?.points ?? 0)
      : (standings[Math.max(0, relegationLine - 1)]?.points ?? row.points) - row.points;
    cards.push({
      teamId,
      scope: 'world',
      type: 'promoted_survival',
      phase: phaseFor(progress, progress >= 0.7 || Math.abs(safetyGap) <= 3),
      title: `${team.name}的升级首季`,
      body: rank <= relegationLine
        ? `升入第${state.leagueLevel}级联赛后，目前排名第${rank}，仍在降级区之外。`
        : `升入第${state.leagueLevel}级联赛后，目前排名第${rank}，正在争取脱离降级区。`,
      evidence: ['上赛季升级', ...baseEvidence].slice(0, 3),
      nextWatch: rank <= relegationLine ? `领先降级线${Math.max(0, safetyGap)}分` : `距离安全区${Math.max(0, safetyGap)}分`,
      priority: 26 + Math.round(progress * 10) + (Math.abs(safetyGap) <= 3 ? 5 : 0),
    });
  }

  return cards;
}

/**
 * Keep the Dashboard quiet: at most one story for the primary observed team
 * and one separate world story. Every sentence is derived from current
 * standings, preseason expectation, coach pressure, or promotion history.
 */
export function generateStorylineCards(
  world: GameWorld,
  favoriteTeamIds: string[],
): StorylineCard[] {
  const primaryId = favoriteTeamIds[0];
  const focused = primaryId
    ? detectTeamCards(world, primaryId).sort((a, b) => b.priority - a.priority)[0]
    : undefined;
  const global = Object.keys(world.teamBases)
    .filter(teamId => teamId !== primaryId)
    .flatMap(teamId => detectTeamCards(world, teamId))
    .sort((a, b) => b.priority - a.priority || a.teamId.localeCompare(b.teamId))[0];

  return [
    ...(focused ? [{ ...focused, scope: 'focus' as const }] : []),
    ...(global ? [global] : []),
  ];
}
