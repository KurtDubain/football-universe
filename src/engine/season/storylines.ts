import type { StandingEntry } from '../../types/league';
import type { MatchResult } from '../../types/match';
import { analyzeDestinyDeviation, resolveMatchOutcome } from '../match/analysis';
import { getKnockoutRoundRank } from './match-importance';
import type { GameWorld, NewsItem } from './season-manager';

export type StorylineType =
  | 'dark_horse'
  | 'giant_crisis'
  | 'promoted_survival'
  | 'unbeaten_run'
  | 'cup_giant_killer';
export type StorylinePhase = '出现' | '发展' | '高潮' | '落幕';
export type StorylineOutcome = 'success' | 'failure';

export interface Storyline {
  id: string;
  type: StorylineType;
  teamId: string;
  seasonNumber: number;
  startedWindow: number;
  startedElapsedWindow: number;
  phase: StorylinePhase;
  evidence: string[];
  lastUpdatedWindow: number;
  lastUpdatedElapsedWindow: number;
  quietWindows: number;
  endedWindow?: number;
  outcome?: StorylineOutcome;
  conclusion?: string;
  /** Locks a cup story to one canonical competition without copying its results. */
  competitionName?: string;
}

export interface StorylineCooldown {
  key: string;
  untilElapsedWindow: number;
}

export interface StorylineSignal {
  teamId: string;
  type: StorylineType;
  phase: Exclude<StorylinePhase, '落幕'>;
  title: string;
  body: string;
  evidence: string[];
  nextWatch: string;
  priority: number;
  competitionName?: string;
}

export const MAX_ACTIVE_STORYLINES = 8;
export const MAX_STORYLINE_HISTORY = 60;
export const MAX_STORYLINE_COOLDOWNS = 64;
export const MAX_STORYLINES_PER_SEASON = 8;
export const STORYLINE_QUIET_WINDOWS = 2;
export const STORYLINE_COOLDOWN_WINDOWS = 6;
export const UNBEATEN_RUN_TRIGGER_LONG = 7;
export const UNBEATEN_RUN_TRIGGER_SHORT = 6;
export const STORYLINES_PER_TYPE_PER_SEASON: Record<StorylineType, number> = {
  dark_horse: 2,
  giant_crisis: 2,
  promoted_survival: 1,
  unbeaten_run: 2,
  cup_giant_killer: 1,
};

const PHASE_PRIORITY: Record<StorylinePhase, number> = {
  '出现': 0,
  '发展': 1,
  '高潮': 2,
  '落幕': 3,
};

const TYPE_LABEL: Record<StorylineType, string> = {
  dark_horse: '黑马崛起',
  giant_crisis: '豪门危机',
  promoted_survival: '升班马求生',
  unbeaten_run: '联赛不败征程',
  cup_giant_killer: '杯赛巨人杀手',
};

function standingsFor(world: GameWorld, level: 1 | 2 | 3): StandingEntry[] {
  if (level === 1) return world.league1Standings;
  if (level === 2) return world.league2Standings;
  return world.league3Standings;
}

export function expectedStoryPosition(teamCount: number, expectation: number): number {
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

function phaseFor(progress: number, climax: boolean): StorylineSignal['phase'] {
  if (climax || progress >= 0.72) return '高潮';
  if (progress >= 0.42) return '发展';
  return '出现';
}

function signalKey(teamId: string, type: StorylineType): string {
  return `${teamId}:${type}`;
}

export function getStorylineArcKey(
  teamId: string,
  type: StorylineType,
  competitionName?: string,
): string {
  const competitionScope = type === 'cup_giant_killer' && competitionName
    ? `:${encodeURIComponent(competitionName)}`
    : '';
  return `team:${teamId}:story:${type}${competitionScope}`;
}

function getTeamSituation(world: GameWorld, teamId: string) {
  const team = world.teamBases[teamId];
  const state = world.teamStates[teamId];
  if (!team || !state) return null;
  const preferred = standingsFor(world, state.leagueLevel);
  const standings = [preferred, world.league1Standings, world.league2Standings, world.league3Standings]
    .find(table => table.some(row => row.teamId === teamId));
  if (!standings) return null;
  const rowIndex = standings.findIndex(row => row.teamId === teamId);
  if (rowIndex < 0) return null;
  const row = standings[rowIndex];
  const rank = rowIndex + 1;
  const expected = expectedStoryPosition(standings.length, team.expectation);
  const relegationLine = standings.length - 3;
  const safetyGap = rank <= relegationLine
    ? row.points - (standings[relegationLine]?.points ?? row.points)
    : (standings[Math.max(0, relegationLine - 1)]?.points ?? row.points) - row.points;
  return { team, state, standings, row, rank, expected, relegationLine, safetyGap };
}

type TeamSituation = NonNullable<ReturnType<typeof getTeamSituation>>;

type TeamMatchOutcome = 'win' | 'draw' | 'loss';

interface CompletedTeamMatch {
  windowIndex: number;
  result: MatchResult;
  outcome: TeamMatchOutcome;
}

interface LeagueRunSummary {
  length: number;
  wins: number;
  draws: number;
}

interface CupCampaignSummary {
  competitionName: string;
  upsetWins: CompletedTeamMatch[];
  deepestStage: number;
  deepestRoundLabel: string;
  champion: boolean;
  eliminated: boolean;
}

function outcomeForTeam(result: MatchResult, teamId: string): TeamMatchOutcome {
  const outcome = resolveMatchOutcome(result);
  if (outcome === 'draw') return 'draw';
  const won = (outcome === 'home' && result.homeTeamId === teamId)
    || (outcome === 'away' && result.awayTeamId === teamId);
  return won ? 'win' : 'loss';
}

function completedTeamMatches(world: GameWorld, teamId: string): CompletedTeamMatch[] {
  return world.seasonState.calendar.flatMap((window, windowIndex) => {
    if (!window.completed) return [];
    return (window.results ?? [])
      .filter(result => result.homeTeamId === teamId || result.awayTeamId === teamId)
      .map(result => ({
        windowIndex,
        result,
        outcome: outcomeForTeam(result, teamId),
      }));
  }).sort((left, right) => left.windowIndex - right.windowIndex
    || left.result.fixtureId.localeCompare(right.result.fixtureId));
}

function summarizeLeagueRun(matches: CompletedTeamMatch[]): LeagueRunSummary {
  const run: CompletedTeamMatch[] = [];
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index];
    if (match.result.competitionType !== 'league') continue;
    if (match.outcome === 'loss') break;
    run.unshift(match);
  }
  return {
    length: run.length,
    wins: run.filter(match => match.outcome === 'win').length,
    draws: run.filter(match => match.outcome === 'draw').length,
  };
}

function longestLeagueRun(matches: CompletedTeamMatch[]): LeagueRunSummary {
  let current: CompletedTeamMatch[] = [];
  let longest: CompletedTeamMatch[] = [];
  for (const match of matches) {
    if (match.result.competitionType !== 'league') continue;
    if (match.outcome === 'loss') current = [];
    else current = [...current, match];
    if (current.length > longest.length) longest = current;
  }
  return {
    length: longest.length,
    wins: longest.filter(match => match.outcome === 'win').length,
    draws: longest.filter(match => match.outcome === 'draw').length,
  };
}

function unbeatenThresholds(totalLeagueGames: number): {
  trigger: number;
  development: number;
  climax: number;
} {
  return totalLeagueGames <= 16
    ? { trigger: UNBEATEN_RUN_TRIGGER_SHORT, development: 9, climax: 12 }
    : { trigger: UNBEATEN_RUN_TRIGGER_LONG, development: 10, climax: 14 };
}

function detectUnbeatenRunSignal(
  world: GameWorld,
  teamId: string,
  knownSituation?: TeamSituation,
  knownMatches?: CompletedTeamMatch[],
): StorylineSignal | null {
  const situation = knownSituation ?? getTeamSituation(world, teamId);
  if (!situation) return null;
  const totalLeagueGames = Math.max(1, (situation.standings.length - 1) * 2);
  const thresholds = unbeatenThresholds(totalLeagueGames);
  const run = summarizeLeagueRun(knownMatches ?? completedTeamMatches(world, teamId));
  if (run.length < thresholds.trigger) return null;
  const phase = run.length >= thresholds.climax
    ? '高潮'
    : run.length >= thresholds.development
      ? '发展'
      : '出现';
  const nextThreshold = phase === '出现' ? thresholds.development : thresholds.climax;
  return {
    teamId,
    type: 'unbeaten_run',
    phase,
    title: `${situation.team.name}延续联赛不败`,
    body: `已经连续${run.length}场联赛未尝败绩，其中${run.wins}胜${run.draws}平。`,
    evidence: [
      `联赛连续${run.length}场不败`,
      `${run.wins}胜${run.draws}平`,
      `当前联赛第${situation.rank}`,
    ],
    nextWatch: phase === '高潮'
      ? '这段不败能把赛季带向哪里'
      : `再延续${Math.max(1, nextThreshold - run.length)}场将进入下一阶段`,
    priority: 32 + Math.min(18, run.length) * 2 + run.wins + PHASE_PRIORITY[phase] * 4,
  };
}

function isCupKnockoutResult(result: MatchResult): boolean {
  return result.competitionType === 'league_cup'
    || result.competitionType === 'super_cup'
    || result.competitionType === 'continental_cup';
}

function cupCampaigns(
  world: GameWorld,
  teamId: string,
  knownMatches?: CompletedTeamMatch[],
): CupCampaignSummary[] {
  const grouped = new Map<string, CompletedTeamMatch[]>();
  for (const match of knownMatches ?? completedTeamMatches(world, teamId)) {
    if (!isCupKnockoutResult(match.result)) continue;
    const matches = grouped.get(match.result.competitionName) ?? [];
    matches.push(match);
    grouped.set(match.result.competitionName, matches);
  }

  return [...grouped.entries()].map(([competitionName, matches]) => {
    const upsetWins = matches.filter(match => (
      match.outcome === 'win' && analyzeDestinyDeviation(match.result).isUpset
    ));
    const deepest = [...matches].sort((left, right) => (
      getKnockoutRoundRank(right.result.roundLabel) - getKnockoutRoundRank(left.result.roundLabel)
      || right.windowIndex - left.windowIndex
      || left.result.fixtureId.localeCompare(right.result.fixtureId)
    ))[0];
    const latest = matches.at(-1);
    const hasFutureFixture = world.seasonState.calendar
      .slice(world.seasonState.currentWindowIndex)
      .some(window => window.fixtures.some(fixture => (
        fixture.competitionName === competitionName
        && (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
      )));
    const deepestStage = deepest ? getKnockoutRoundRank(deepest.result.roundLabel) : 0;
    const champion = Boolean(
      latest
      && latest.outcome === 'win'
      && getKnockoutRoundRank(latest.result.roundLabel) === 4,
    );
    return {
      competitionName,
      upsetWins,
      deepestStage,
      deepestRoundLabel: deepest?.result.roundLabel ?? '淘汰赛',
      champion,
      eliminated: Boolean(latest && latest.outcome === 'loss' && !hasFutureFixture),
    };
  });
}

function cupCampaignScore(campaign: CupCampaignSummary): number {
  const bestProbability = Math.min(
    100,
    ...campaign.upsetWins.map(match => analyzeDestinyDeviation(match.result).actualProbability),
  );
  return campaign.upsetWins.length * 20
    + campaign.deepestStage * 12
    + Number(campaign.champion) * 30
    + Math.max(0, 30 - bestProbability);
}

function probabilityLabel(probability: number): string {
  return probability <= 0 ? '低于1%' : `约${probability}%`;
}

function detectCupGiantKillerSignal(
  world: GameWorld,
  teamId: string,
  competitionName?: string,
  knownSituation?: TeamSituation,
  knownMatches?: CompletedTeamMatch[],
): StorylineSignal | null {
  const situation = knownSituation ?? getTeamSituation(world, teamId);
  if (!situation) return null;
  const campaign = cupCampaigns(world, teamId, knownMatches)
    .filter(item => competitionName === undefined || item.competitionName === competitionName)
    .filter(item => {
      const hasHighStageUpset = item.upsetWins.some(match => (
        getKnockoutRoundRank(match.result.roundLabel) >= 3
      ));
      return !item.eliminated && (item.upsetWins.length >= 2 || hasHighStageUpset);
    })
    .sort((left, right) => cupCampaignScore(right) - cupCampaignScore(left)
      || left.competitionName.localeCompare(right.competitionName))[0];
  if (!campaign) return null;

  const bestUpset = [...campaign.upsetWins].sort((left, right) => (
    analyzeDestinyDeviation(left.result).actualProbability
      - analyzeDestinyDeviation(right.result).actualProbability
    || left.windowIndex - right.windowIndex
    || left.result.fixtureId.localeCompare(right.result.fixtureId)
  ))[0];
  const phase = campaign.champion
    ? '高潮'
    : campaign.deepestStage >= 3 || campaign.upsetWins.length >= 3
      ? '发展'
      : '出现';
  const nextFixture = world.seasonState.calendar
    .slice(world.seasonState.currentWindowIndex)
    .flatMap(window => window.fixtures)
    .find(fixture => fixture.competitionName === campaign.competitionName
      && (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId));
  return {
    teamId,
    type: 'cup_giant_killer',
    phase,
    title: `${situation.team.name}成为杯赛巨人杀手`,
    body: `在${campaign.competitionName}已经赢下${campaign.upsetWins.length}场明确冷门，最深推进至${campaign.deepestRoundLabel}。`,
    evidence: [
      `${campaign.competitionName} · ${campaign.upsetWins.length}场冷门胜利`,
      `最深阶段 ${campaign.deepestRoundLabel}`,
      bestUpset
        ? `最意外一战赛前胜出概率${probabilityLabel(
          analyzeDestinyDeviation(bestUpset.result).actualProbability,
        )}`
        : null,
    ].filter((item): item is string => Boolean(item)),
    nextWatch: campaign.champion
      ? '这段巨人杀手征程已经捧杯，等待写入赛季档案'
      : nextFixture
        ? `下一站：${nextFixture.roundLabel}`
        : '这段杯赛征程还能走多远',
    priority: 38 + campaign.upsetWins.length * 8 + campaign.deepestStage * 6
      + Number(campaign.champion) * 12,
    competitionName: campaign.competitionName,
  };
}

export function detectTeamStorylineSignals(world: GameWorld, teamId: string): StorylineSignal[] {
  const situation = getTeamSituation(world, teamId);
  if (!situation || situation.row.played < 4) return [];
  const { team, state, standings, row, rank, expected, relegationLine, safetyGap } = situation;
  const totalGames = Math.max(1, (standings.length - 1) * 2);
  const progress = row.played / totalGames;
  const rankDelta = expected - rank;
  const form = recentFormEvidence(state.recentForm);
  const baseEvidence = [
    `联赛第${rank}/${standings.length}`,
    `${row.played}轮 ${row.points}分`,
    form,
  ].filter((item): item is string => Boolean(item));
  const signals: StorylineSignal[] = [];

  if (team.expectation <= 3 && rank <= Math.max(3, Math.ceil(standings.length / 4)) && rankDelta >= 3) {
    signals.push({
      teamId,
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
    signals.push({
      teamId,
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
    signals.push({
      teamId,
      type: 'promoted_survival',
      phase: phaseFor(progress, progress >= 0.7 || Math.abs(safetyGap) <= 3),
      title: `${team.name}的升级首季`,
      body: rank <= relegationLine
        ? `升入第${state.leagueLevel}级联赛后，目前排名第${rank}，仍在降级区之外。`
        : `升入第${state.leagueLevel}级联赛后，目前排名第${rank}，正在争取脱离降级区。`,
      evidence: ['上赛季升级', ...baseEvidence].slice(0, 3),
      nextWatch: rank <= relegationLine
        ? `领先降级线${Math.max(0, safetyGap)}分`
        : `距离安全区${Math.max(0, safetyGap)}分`,
      priority: 26 + Math.round(progress * 10) + (Math.abs(safetyGap) <= 3 ? 5 : 0),
    });
  }

  const matches = completedTeamMatches(world, teamId);
  const unbeatenRun = detectUnbeatenRunSignal(world, teamId, situation, matches);
  if (unbeatenRun) signals.push(unbeatenRun);

  const cupGiantKiller = detectCupGiantKillerSignal(world, teamId, undefined, situation, matches);
  if (cupGiantKiller) signals.push(cupGiantKiller);

  return signals;
}

export function detectStorylineSignals(world: GameWorld): StorylineSignal[] {
  return Object.keys(world.teamBases)
    .flatMap(teamId => detectTeamStorylineSignals(world, teamId))
    .sort((a, b) => b.priority - a.priority
      || a.teamId.localeCompare(b.teamId)
      || a.type.localeCompare(b.type));
}

export function describeStoryline(world: GameWorld, storyline: Storyline): StorylineSignal | null {
  const detected = storyline.type === 'cup_giant_killer'
    ? detectCupGiantKillerSignal(world, storyline.teamId, storyline.competitionName)
    : detectTeamStorylineSignals(world, storyline.teamId)
      .find(signal => signal.type === storyline.type);
  if (detected) return { ...detected, phase: storyline.phase === '落幕' ? '高潮' : storyline.phase };

  const situation = getTeamSituation(world, storyline.teamId);
  if (!situation) return null;
  const { team, state, standings, row, rank, expected, relegationLine, safetyGap } = situation;
  let title: string;
  let body: string;
  let nextWatch: string;
  if (storyline.type === 'dark_horse') {
    title = `${team.name}的黑马征程`;
    body = `目前排名第${rank}，故事进入观察期；赛前位置预期约为第${expected}。`;
    nextWatch = '能否重新扩大预期优势';
  } else if (storyline.type === 'giant_crisis') {
    title = `${team.name}的赛季危机`;
    body = `目前排名第${rank}，赛前位置预期约为第${expected}，危机是否解除仍需继续观察。`;
    nextWatch = '能否连续两个窗口回到正常区间';
  } else if (storyline.type === 'promoted_survival') {
    title = `${team.name}的升级首季`;
    body = `目前排名第${rank}，${rank <= relegationLine ? '仍在降级区之外' : '仍处于降级区'}。`;
    nextWatch = rank <= relegationLine
      ? `领先降级线${Math.max(0, safetyGap)}分`
      : `距离安全区${Math.max(0, safetyGap)}分`;
  } else if (storyline.type === 'unbeaten_run') {
    title = `${team.name}的不败征程`;
    body = '最近一场联赛已经改变了这段走势，故事正在等待正式收束。';
    nextWatch = '这段不败最终会定格在多少场';
  } else {
    title = `${team.name}的杯赛巨人杀手征程`;
    body = `${storyline.competitionName ?? '杯赛'}征程已经来到转折点，故事正在等待正式收束。`;
    nextWatch = '这段杯赛征程最终会停在哪里';
  }
  return {
    teamId: storyline.teamId,
    type: storyline.type,
    phase: storyline.phase === '落幕' ? '高潮' : storyline.phase,
    title,
    body,
    evidence: [
      `联赛第${rank}/${standings.length}`,
      `${row.played}轮 ${row.points}分`,
      storyline.type === 'giant_crisis' ? `教练压力 ${state.coachPressure}` : storyline.evidence[0],
    ].filter((item): item is string => Boolean(item)).slice(0, 3),
    nextWatch,
    priority: 20 + PHASE_PRIORITY[storyline.phase] * 5,
    competitionName: storyline.competitionName,
  };
}

function progressedPhase(current: StorylinePhase, next: StorylinePhase): StorylinePhase {
  return PHASE_PRIORITY[next] > PHASE_PRIORITY[current] ? next : current;
}

function concludeStoryline(
  world: GameWorld,
  storyline: Storyline,
  finalSeason: boolean,
): Storyline {
  const situation = getTeamSituation(world, storyline.teamId);
  if (!situation) {
    return {
      ...storyline,
      phase: '落幕',
      outcome: 'failure',
      conclusion: '球队已不在当前赛事结构中，故事停止追踪。',
      endedWindow: world.seasonState.currentWindowIndex,
      lastUpdatedWindow: world.seasonState.currentWindowIndex,
      lastUpdatedElapsedWindow: world.totalElapsedWindows ?? 0,
    };
  }
  const { rank, expected, standings, relegationLine } = situation;
  let outcome: StorylineOutcome;
  let conclusion: string;

  if (storyline.type === 'unbeaten_run') {
    const longest = longestLeagueRun(completedTeamMatches(world, storyline.teamId));
    const thresholds = unbeatenThresholds(Math.max(1, (standings.length - 1) * 2));
    outcome = longest.length >= thresholds.development ? 'success' : 'failure';
    conclusion = longest.length > 0
      ? `${finalSeason ? '本赛季' : '这段'}联赛不败最终定格在${longest.length}场（${longest.wins}胜${longest.draws}平）${outcome === 'success' ? '，成为赛季的重要走势。' : '。'}`
      : '当前赛程中已无法重建这段不败走势，故事停止追踪。';
  } else if (storyline.type === 'cup_giant_killer') {
    const campaign = cupCampaigns(world, storyline.teamId)
      .find(item => item.competitionName === storyline.competitionName)
      ?? cupCampaigns(world, storyline.teamId)
        .sort((left, right) => cupCampaignScore(right) - cupCampaignScore(left))[0];
    outcome = campaign && (
      campaign.champion || campaign.upsetWins.length >= 3 || campaign.deepestStage >= 3
    ) ? 'success' : 'failure';
    conclusion = campaign
      ? campaign.champion
        ? `在${campaign.competitionName}赢下${campaign.upsetWins.length}场明确冷门并最终夺冠，巨人杀手征程得到兑现。`
        : `在${campaign.competitionName}赢下${campaign.upsetWins.length}场明确冷门，征程推进至${campaign.deepestRoundLabel}${campaign.eliminated ? '后止步。' : '并在赛季末写入档案。'}`
      : `${storyline.competitionName ?? '杯赛'}的巨人杀手征程已结束，详细赛果无法继续重建。`;
  } else if (storyline.type === 'dark_horse') {
    outcome = finalSeason
      && rank <= Math.max(4, Math.ceil(standings.length / 4))
      && expected - rank >= 2
      ? 'success'
      : 'failure';
    conclusion = outcome === 'success'
      ? `最终排名第${rank}，比赛季前位置预期高${Math.max(0, expected - rank)}位，黑马赛季得到兑现。`
      : `${finalSeason ? '最终' : '当前'}排名第${rank}，已不再满足黑马追踪条件。`;
  } else if (storyline.type === 'giant_crisis') {
    outcome = finalSeason
      ? (rank <= expected + 1 ? 'success' : 'failure')
      : 'success';
    conclusion = outcome === 'success'
      ? finalSeason
        ? `最终排名第${rank}，与赛季前位置预期的偏差缩小到${Math.max(0, rank - expected)}位。`
        : `当前排名第${rank}，连续两个观察窗口未再达到危机标准。`
      : `最终排名第${rank}，仍低于赛季前约第${expected}的预期。`;
  } else {
    outcome = rank <= relegationLine ? 'success' : 'failure';
    conclusion = outcome === 'success'
      ? `升级首季最终排名第${rank}，成功留在当前级别。`
      : `升级首季最终排名第${rank}，未能留在当前级别。`;
  }

  return {
    ...storyline,
    phase: '落幕',
    evidence: storyline.type === 'unbeaten_run' || storyline.type === 'cup_giant_killer'
      ? storyline.evidence
      : describeStoryline(world, storyline)?.evidence ?? storyline.evidence,
    lastUpdatedWindow: world.seasonState.currentWindowIndex,
    lastUpdatedElapsedWindow: world.totalElapsedWindows ?? 0,
    endedWindow: world.seasonState.currentWindowIndex,
    outcome,
    conclusion,
  };
}

function storylineNews(
  world: GameWorld,
  storyline: Storyline,
  event: 'start' | 'phase' | 'end',
): NewsItem {
  const teamName = world.teamBases[storyline.teamId]?.name ?? storyline.teamId;
  const label = TYPE_LABEL[storyline.type];
  const phase = event === 'end' ? '落幕' : storyline.phase;
  return {
    id: `story-${storyline.id}-${phase}-${storyline.lastUpdatedElapsedWindow}`,
    seasonNumber: storyline.seasonNumber,
    windowIndex: world.seasonState.currentWindowIndex,
    type: 'storyline',
    importance: phase === '高潮' || phase === '落幕' ? 'major' : 'normal',
    subject: {
      arcKey: getStorylineArcKey(
        storyline.teamId,
        storyline.type,
        storyline.competitionName,
      ),
      eventKey: `${storyline.id}:${phase}:${storyline.lastUpdatedElapsedWindow}`,
      teamIds: [storyline.teamId],
      visualKind: storyline.type === 'giant_crisis' ? 'fall' : 'rise',
    },
    title: event === 'start'
      ? `故事出现：${teamName} · ${label}`
      : event === 'end'
        ? `故事落幕：${teamName} · ${label}`
        : `故事升级：${teamName}进入${phase}`,
    description: event === 'end'
      ? storyline.conclusion ?? storyline.evidence.join(' · ')
      : storyline.evidence.join(' · '),
  };
}

function isStorylineInterrupted(world: GameWorld, storyline: Storyline): boolean {
  if (storyline.type === 'unbeaten_run') {
    const latestLeagueMatch = completedTeamMatches(world, storyline.teamId)
      .filter(match => match.result.competitionType === 'league')
      .at(-1);
    return latestLeagueMatch?.outcome === 'loss';
  }
  if (storyline.type === 'cup_giant_killer') {
    const campaign = cupCampaigns(world, storyline.teamId)
      .find(item => item.competitionName === storyline.competitionName);
    return campaign?.eliminated ?? false;
  }
  return false;
}

export function advanceStorylines(
  world: GameWorld,
  options: { finalizeSeason?: boolean } = {},
): { world: GameWorld; news: NewsItem[] } {
  const finalizeSeason = options.finalizeSeason ?? false;
  const seasonNumber = world.seasonState.seasonNumber;
  const windowIndex = world.seasonState.currentWindowIndex;
  const elapsedWindow = world.totalElapsedWindows ?? 0;
  const signals = detectStorylineSignals(world);
  const signalMap = new Map(signals.map(signal => [signalKey(signal.teamId, signal.type), signal]));
  const history = [...(world.storylineHistory ?? [])];
  const cooldowns = [...(world.storylineCooldowns ?? [])]
    .filter(cooldown => cooldown.untilElapsedWindow > elapsedWindow);
  const active: Storyline[] = [];
  const news: NewsItem[] = [];

  const finish = (storyline: Storyline) => {
    const concluded = concludeStoryline(world, storyline, finalizeSeason);
    history.push(concluded);
    cooldowns.push({
      key: signalKey(concluded.teamId, concluded.type),
      untilElapsedWindow: elapsedWindow + STORYLINE_COOLDOWN_WINDOWS,
    });
    news.push(storylineNews(world, concluded, 'end'));
  };

  for (const storyline of (world.activeStorylines ?? []).slice(0, MAX_ACTIVE_STORYLINES)) {
    if (finalizeSeason || storyline.seasonNumber !== seasonNumber) {
      finish(storyline);
      continue;
    }
    const key = signalKey(storyline.teamId, storyline.type);
    const signal = storyline.type === 'cup_giant_killer'
      ? detectCupGiantKillerSignal(world, storyline.teamId, storyline.competitionName)
      : signalMap.get(key);
    if (!signal) {
      if (isStorylineInterrupted(world, storyline)) {
        finish(storyline);
        continue;
      }
      const quietWindows = storyline.quietWindows + 1;
      if (quietWindows >= STORYLINE_QUIET_WINDOWS) finish({ ...storyline, quietWindows });
      else active.push({ ...storyline, quietWindows });
      continue;
    }

    signalMap.delete(key);
    const phase = progressedPhase(storyline.phase, signal.phase);
    const updated: Storyline = {
      ...storyline,
      phase,
      evidence: signal.evidence,
      lastUpdatedWindow: windowIndex,
      lastUpdatedElapsedWindow: elapsedWindow,
      quietWindows: 0,
      competitionName: storyline.competitionName ?? signal.competitionName,
    };
    active.push(updated);
    if (phase !== storyline.phase) news.push(storylineNews(world, updated, 'phase'));
  }

  if (!finalizeSeason) {
    const activeKeys = new Set(active.map(storyline => signalKey(storyline.teamId, storyline.type)));
    const usedThisSeason = new Set(history
      .filter(storyline => storyline.seasonNumber === seasonNumber)
      .map(storyline => signalKey(storyline.teamId, storyline.type)));
    const coolingKeys = new Set(cooldowns.map(cooldown => cooldown.key));
    const storylinesThisSeason = [
      ...active.filter(storyline => storyline.seasonNumber === seasonNumber),
      ...history.filter(storyline => storyline.seasonNumber === seasonNumber),
    ];
    const typeCounts = new Map<StorylineType, number>();
    for (const storyline of storylinesThisSeason) {
      typeCounts.set(storyline.type, (typeCounts.get(storyline.type) ?? 0) + 1);
    }
    let seasonStoryCount = active.filter(storyline => storyline.seasonNumber === seasonNumber).length
      + history.filter(storyline => storyline.seasonNumber === seasonNumber).length;
    for (const signal of signals) {
      if (active.length >= MAX_ACTIVE_STORYLINES || seasonStoryCount >= MAX_STORYLINES_PER_SEASON) break;
      const key = signalKey(signal.teamId, signal.type);
      if (activeKeys.has(key) || usedThisSeason.has(key) || coolingKeys.has(key)) continue;
      if ((typeCounts.get(signal.type) ?? 0) >= STORYLINES_PER_TYPE_PER_SEASON[signal.type]) continue;
      const storyline: Storyline = {
        id: `S${seasonNumber}-${signal.type}-${signal.teamId}-${elapsedWindow}`,
        type: signal.type,
        teamId: signal.teamId,
        seasonNumber,
        startedWindow: windowIndex,
        startedElapsedWindow: elapsedWindow,
        phase: signal.phase,
        evidence: signal.evidence,
        lastUpdatedWindow: windowIndex,
        lastUpdatedElapsedWindow: elapsedWindow,
        quietWindows: 0,
        competitionName: signal.competitionName,
      };
      active.push(storyline);
      activeKeys.add(key);
      seasonStoryCount++;
      typeCounts.set(signal.type, (typeCounts.get(signal.type) ?? 0) + 1);
      news.push(storylineNews(world, storyline, 'start'));
    }
  }

  const nextWorld: GameWorld = {
    ...world,
    activeStorylines: active.slice(0, MAX_ACTIVE_STORYLINES),
    storylineHistory: history.slice(-MAX_STORYLINE_HISTORY),
    storylineCooldowns: cooldowns.slice(-MAX_STORYLINE_COOLDOWNS),
    newsLog: [...world.newsLog, ...news],
  };
  return { world: nextWorld, news };
}

export function getFixtureStorylineLabel(
  world: GameWorld,
  homeTeamId: string,
  awayTeamId: string,
): string | null {
  const storyline = (world.activeStorylines ?? [])
    .filter(item => item.teamId === homeTeamId || item.teamId === awayTeamId)
    .sort((a, b) => PHASE_PRIORITY[b.phase] - PHASE_PRIORITY[a.phase])[0];
  if (!storyline) return null;
  const teamName = world.teamBases[storyline.teamId]?.shortName ?? '';
  if (storyline.type === 'dark_horse') return `${teamName}黑马试金石`;
  if (storyline.type === 'giant_crisis') return `${teamName}危机转折战`;
  if (storyline.type === 'promoted_survival') return `${teamName}保级关键战`;
  if (storyline.type === 'unbeaten_run') return `${teamName}不败延续战`;
  return `${teamName}巨人杀手征程`;
}
