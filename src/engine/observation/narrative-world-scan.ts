import type { StandingEntry } from '../../types/league';
import type { MatchResult } from '../../types/match';
import type { Player, PlayerPosition, PlayerTeamSeasonStats } from '../../types/player';
import type { CalendarWindow } from '../../types/season';
import { getTeamCoachId } from '../coaches/coach-lookup';
import {
  computePlayerPerformance,
  computeSegmentedPlayerPerformance,
  type PlayerPerformanceResult,
} from '../players/player-performance';
import { getKnockoutRoundRank } from '../season/match-importance';
import type { GameWorld } from '../season/season-manager';
import {
  describeStoryline,
  getStorylineArcKey,
  type Storyline,
  type StorylineSignal,
} from '../season/storylines';
import { createNarrativeFingerprint } from './narrative-director';
import type { NarrativeCandidate, NarrativeFact, NarrativeSource } from './narrative-types';

export const WORLD_NARRATIVE_CAPS = {
  player: 8,
  coach: 4,
  transfer: 4,
  competition: 6,
  record: 2,
  total: 24,
} as const;

const POSITION_LABELS: Record<PlayerPosition, string> = {
  GK: '门将',
  DF: '后卫',
  MF: '中场',
  FW: '前锋',
};

const LEAGUE_LABELS: Record<1 | 2 | 3, string> = {
  1: '顶级联赛',
  2: '甲级联赛',
  3: '乙级联赛',
};

interface WorldNarrativeScanOptions {
  world: GameWorld;
  currentWindow: CalendarWindow;
  favoriteTeamIds: readonly string[];
  favoritePlayerIds: readonly string[];
}

export interface CompetitionLandscape {
  id: string;
  kind: 'title' | 'promotion' | 'relegation';
  label: string;
  detail: string;
  teamIds: string[];
  progress: number;
}

export interface SeasonNarrativeOverview {
  observedTeam?: {
    teamId: string;
    title: string;
    detail: string;
  };
  landscapes: CompetitionLandscape[];
  arcs: Array<{
    id: string;
    teamId: string;
    title: string;
    detail: string;
    phase: string;
  }>;
  watchedPlayers: Array<{
    playerId: string;
    title: string;
    detail: string;
  }>;
}

function fact(source: NarrativeSource, key: string, label: string, detail: string): NarrativeFact {
  return { source, key, label, detail };
}

function playerDestination(playerId: string) {
  return { key: `player:${playerId}`, label: '查看球员', to: `/player/${playerId}` };
}

function hasPlayerDetail(world: GameWorld, playerId: string): boolean {
  return Object.values(world.squads).some(squad => squad.some(player => player.uuid === playerId))
    || (world.retirementHistory ?? []).some(player => player.uuid === playerId);
}

function teamDestination(teamId: string) {
  return { key: `team:${teamId}`, label: '查看球队', to: `/team/${teamId}` };
}

function coachDestination(coachId: string) {
  return { key: `coach:${coachId}`, label: '查看教练', to: `/coach/${coachId}` };
}

function fixtureDestination(fixtureId: string) {
  return { key: `fixture:${fixtureId}`, label: '查看比赛', fixtureId };
}

function standingsForLevel(world: GameWorld, level: 1 | 2 | 3): StandingEntry[] {
  if (level === 1) return world.league1Standings;
  if (level === 2) return world.league2Standings;
  return world.league3Standings;
}

function allActivePlayers(world: GameWorld): Player[] {
  return Object.values(world.squads).flatMap(squad => squad ?? []);
}

function segmentsByPlayer(world: GameWorld): Map<string, PlayerTeamSeasonStats[]> {
  const out = new Map<string, PlayerTeamSeasonStats[]>();
  for (const segment of Object.values(world.playerStatSegments ?? {})) {
    const list = out.get(segment.playerId) ?? [];
    list.push(segment);
    out.set(segment.playerId, list);
  }
  for (const segments of out.values()) {
    segments.sort((a, b) => a.teamId.localeCompare(b.teamId));
  }
  return out;
}

function performanceFor(
  world: GameWorld,
  player: Player,
  byPlayer: Map<string, PlayerTeamSeasonStats[]>,
): PlayerPerformanceResult {
  const segments = byPlayer.get(player.uuid) ?? [];
  return segments.length > 0
    ? computeSegmentedPlayerPerformance(
        player.position,
        segments,
        world.seasonStartLevels,
        world.playerStats[player.uuid],
      )
    : computePlayerPerformance(
        player.position,
        world.playerStats[player.uuid],
        world.seasonStartLevels[player.teamId],
      );
}

function playerPerformanceDetail(
  player: Player,
  performance: PlayerPerformanceResult,
  world: GameWorld,
): string {
  const stats = world.playerStats[player.uuid];
  if (player.position === 'GK') {
    return `扑救率${Math.round(performance.metrics.savePercentage * 100)}% · ${(stats?.routineSaves ?? 0) + (stats?.saves ?? 0)}次扑救`;
  }
  if (player.position === 'DF') {
    return `${stats?.interceptions ?? 0}次拦截 · ${stats?.clearances ?? 0}次解围`;
  }
  if (player.position === 'MF') {
    return `${stats?.goals ?? 0}球 · ${stats?.assists ?? 0}助攻 · ${Math.max(0, (stats?.keyPasses ?? 0) - (stats?.assists ?? 0))}次额外创造`;
  }
  return `${stats?.goals ?? 0}球 · ${stats?.assists ?? 0}助攻 · ${Math.max(0, (stats?.bigChances ?? 0) - (stats?.goals ?? 0))}次额外机会`;
}

function playerSeasonArc(playerId: string, season: number): string {
  return `player:${playerId}:season:${season}`;
}

function playerPerformanceFingerprint(
  player: Player,
  performance: PlayerPerformanceResult,
  world: GameWorld,
): readonly unknown[] {
  const stats = world.playerStats[player.uuid];
  const positionOutput = player.position === 'GK'
    ? [
        Math.floor(((stats?.routineSaves ?? 0) + (stats?.saves ?? 0)) / 5),
        Math.floor(performance.metrics.savePercentage * 20),
      ]
    : player.position === 'DF'
      ? [Math.floor((stats?.interceptions ?? 0) / 10), Math.floor((stats?.clearances ?? 0) / 10), stats?.keyBlocks ?? 0]
      : player.position === 'MF'
        ? [stats?.goals ?? 0, stats?.assists ?? 0, Math.floor(Math.max(0, (stats?.keyPasses ?? 0) - (stats?.assists ?? 0)) / 3)]
        : [stats?.goals ?? 0, stats?.assists ?? 0, Math.floor(Math.max(0, (stats?.bigChances ?? 0) - (stats?.goals ?? 0)) / 3)];
  return [
    Math.floor(performance.seasonScore / 2),
    Math.floor(performance.metrics.minutes / 270),
    ...positionOutput,
  ];
}

function playerCandidates(options: WorldNarrativeScanOptions): NarrativeCandidate[] {
  const { world } = options;
  const season = world.seasonState.seasonNumber;
  const elapsed = world.totalElapsedWindows ?? 0;
  const followed = new Set(options.favoritePlayerIds);
  const players = allActivePlayers(world);
  const playerById = new Map(players.map(player => [player.uuid, player]));
  const segments = segmentsByPlayer(world);
  const performances = players.map(player => ({
    player,
    performance: performanceFor(world, player, segments),
  }));
  const rankable = performances.filter(entry =>
    entry.performance.eligible
    && entry.performance.metrics.minutes >= 360
    && Number.isFinite(entry.performance.seasonScore),
  );
  const leaders = (['GK', 'DF', 'MF', 'FW'] as PlayerPosition[])
    .map(position => rankable
      .filter(entry => entry.player.position === position)
      .sort((a, b) => b.performance.seasonScore - a.performance.seasonScore
        || b.performance.metrics.minutes - a.performance.metrics.minutes
        || a.player.uuid.localeCompare(b.player.uuid))[0])
    .filter((entry): entry is typeof rankable[number] => Boolean(entry));

  const candidates: NarrativeCandidate[] = leaders.map(({ player, performance }) => {
    const team = world.teamBases[player.teamId];
    const detail = playerPerformanceDetail(player, performance, world);
    return {
      id: `player-leader:${season}:${player.position}:${player.uuid}`,
      arcKey: playerSeasonArc(player.uuid, season),
      eventKey: `S${season}:leader:${player.position}`,
      source: 'player_story',
      subjectType: 'player',
      subjectIds: [player.uuid, player.teamId],
      seasonNumber: season,
      seasonPhase: options.currentWindow.label,
      title: `${POSITION_LABELS[player.position]}标杆 · ${player.name}`,
      summary: `${team?.name ?? player.teamId}的${player.name}以本季表现进入同位置领跑者行列。`,
      evidence: [
        fact('player_story', `player:${player.uuid}:score`, '赛季表现', `综合评分${performance.seasonScore.toFixed(1)} · ${detail}`),
        fact('player_story', `player:${player.uuid}:minutes`, '样本', `${performance.metrics.appearances}场 · ${performance.metrics.minutes}分钟 · 可信度${Math.round(performance.confidence * 100)}%`),
      ],
      nextWatch: '观察这份效率能否在更多出场时间中延续',
      destinations: [playerDestination(player.uuid), teamDestination(player.teamId)],
      visualKind: 'legacy',
      fingerprint: createNarrativeFingerprint([
        season,
        player.uuid,
        ...playerPerformanceFingerprint(player, performance, world),
      ]),
      changedAt: elapsed,
      weights: {
        importance: 68 + Math.max(0, performance.seasonScore - 70) * 0.6,
        relevance: followed.has(player.uuid) ? 72 : 20,
        continuity: 42,
        historical: performance.seasonScore >= 85 ? 58 : 25,
      },
    };
  });

  const rising = rankable
    .filter(entry => entry.player.age <= 22)
    .filter(entry => entry.performance.seasonScore >= 70 && entry.performance.confidence >= 0.25)
    .sort((a, b) => b.performance.seasonScore - a.performance.seasonScore
      || a.player.age - b.player.age
      || a.player.uuid.localeCompare(b.player.uuid))
    .slice(0, 2);
  for (const { player, performance } of rising) {
    candidates.push({
      id: `player-breakout:${season}:${player.uuid}`,
      arcKey: playerSeasonArc(player.uuid, season),
      eventKey: `S${season}:breakout:${player.uuid}`,
      source: 'player_story',
      subjectType: 'player',
      subjectIds: [player.uuid, player.teamId],
      seasonNumber: season,
      seasonPhase: 'U23新星',
      title: `新星抬头 · ${player.name}`,
      summary: `${player.age}岁的${player.name}已经用真实出场和表现进入本季新星视野。`,
      evidence: [fact(
        'player_story',
        `player:${player.uuid}:breakout`,
        '成长证据',
        `${performance.metrics.minutes}分钟 · 赛季评分${performance.seasonScore.toFixed(1)} · ${playerPerformanceDetail(player, performance, world)}`,
      )],
      nextWatch: '观察他能否保持出场份额并跨过低样本阶段',
      destinations: [playerDestination(player.uuid), teamDestination(player.teamId)],
      visualKind: 'rise',
      fingerprint: createNarrativeFingerprint([
        season,
        player.uuid,
        ...playerPerformanceFingerprint(player, performance, world),
      ]),
      changedAt: elapsed,
      weights: { importance: 76, relevance: followed.has(player.uuid) ? 80 : 24, continuity: 55, historical: 35 },
    });
  }

  const veteran = rankable
    .filter(entry => entry.player.age >= 31 && entry.performance.seasonScore >= 76)
    .map(entry => {
      const previous = [...(world.playerStatsHistory[entry.player.uuid] ?? [])]
        .filter(row => row.season < season && row.seasonScore !== undefined)
        .sort((a, b) => b.season - a.season)[0];
      return { ...entry, previous };
    })
    .filter(entry => entry.previous?.seasonScore !== undefined
      && entry.performance.seasonScore - entry.previous.seasonScore >= 6)
    .sort((a, b) => (b.performance.seasonScore - (b.previous?.seasonScore ?? 0))
      - (a.performance.seasonScore - (a.previous?.seasonScore ?? 0))
      || a.player.uuid.localeCompare(b.player.uuid))[0];
  if (veteran) {
    const delta = veteran.performance.seasonScore - (veteran.previous?.seasonScore ?? 0);
    candidates.push({
      id: `player-resurgence:${season}:${veteran.player.uuid}`,
      arcKey: playerSeasonArc(veteran.player.uuid, season),
      eventKey: `S${season}:resurgence:${veteran.player.uuid}`,
      source: 'player_story',
      subjectType: 'player',
      subjectIds: [veteran.player.uuid, veteran.player.teamId],
      seasonNumber: season,
      seasonPhase: '老将回升',
      title: `老将回潮 · ${veteran.player.name}`,
      summary: `${veteran.player.age}岁的${veteran.player.name}把赛季表现较上一份完整档案提升了${delta.toFixed(1)}分。`,
      evidence: [fact('player_story', `player:${veteran.player.uuid}:resurgence`, '赛季对照', `S${veteran.previous!.season} ${veteran.previous!.seasonScore!.toFixed(1)} → S${season} ${veteran.performance.seasonScore.toFixed(1)}`)],
      nextWatch: '观察这次回升能否持续到赛季收官',
      destinations: [playerDestination(veteran.player.uuid)],
      visualKind: 'rise',
      fingerprint: createNarrativeFingerprint([
        season,
        veteran.player.uuid,
        Math.floor((veteran.previous?.seasonScore ?? 0) / 2),
        ...playerPerformanceFingerprint(veteran.player, veteran.performance, world),
      ]),
      changedAt: elapsed,
      weights: { importance: 78, relevance: followed.has(veteran.player.uuid) ? 82 : 22, continuity: 62, historical: 38 },
    });
  }

  const contributionStreaks = new Map<string, number>();
  const unresolvedStreaks = new Set(players
    .filter(player => (world.playerStats[player.uuid]?.appearances ?? 0) > 0)
    .map(player => player.uuid));
  for (let windowIndex = world.seasonState.calendar.length - 1; windowIndex >= 0; windowIndex--) {
    const window = world.seasonState.calendar[windowIndex];
    if (!window.completed) continue;
    for (let resultIndex = (window.results?.length ?? 0) - 1; resultIndex >= 0; resultIndex--) {
      const result = window.results[resultIndex];
      const contributed = new Set(result.events
        .filter(event => event.minute <= 120 && (event.type === 'goal' || event.type === 'assist'))
        .map(event => event.playerId)
        .filter((id): id is string => Boolean(id)));
      const participants = [...(result.homeMatchday?.players ?? []), ...(result.awayMatchday?.players ?? [])]
        .filter(player => (player.minutesPlayed ?? 0) > 0)
        .map(player => player.playerId);
      for (const playerId of participants) {
        if (!unresolvedStreaks.has(playerId)) continue;
        if (contributed.has(playerId)) {
          contributionStreaks.set(playerId, (contributionStreaks.get(playerId) ?? 0) + 1);
        } else {
          unresolvedStreaks.delete(playerId);
        }
      }
    }
    if (unresolvedStreaks.size === 0) break;
  }
  const streaks = [...contributionStreaks.entries()]
    .map(([playerId, length]) => ({ playerId, length }))
    .filter(entry => entry.length >= 3 && playerById.has(entry.playerId))
    .sort((a, b) => b.length - a.length || a.playerId.localeCompare(b.playerId))
    .slice(0, 2);
  for (const streak of streaks) {
    const player = playerById.get(streak.playerId)!;
    candidates.push({
      id: `player-streak:${season}:${player.uuid}`,
      arcKey: playerSeasonArc(player.uuid, season),
      eventKey: `S${season}:contribution-streak:${player.uuid}:${streak.length}`,
      source: 'player_story',
      subjectType: 'player',
      subjectIds: [player.uuid, player.teamId],
      seasonNumber: season,
      seasonPhase: '连续贡献',
      title: `${player.name}连续${streak.length}场制造进球`,
      summary: '连续场次均来自真实出场阵容与常规时间、加时赛的进球或助攻事件。',
      evidence: [fact('player_story', `player:${player.uuid}:streak:${streak.length}`, '连续贡献', `${streak.length}场连续进球或助攻`)],
      nextWatch: '下一次实际出场将决定这段连续表现能否延续',
      destinations: [playerDestination(player.uuid)],
      visualKind: 'rise',
      fingerprint: createNarrativeFingerprint([season, player.uuid, streak.length]),
      changedAt: elapsed,
      weights: { importance: Math.min(90, 68 + streak.length * 4), relevance: followed.has(player.uuid) ? 86 : 20, continuity: 70, historical: 25 },
    });
  }

  const injuries = players.map(player => {
    const injury = [...(player.injuryHistory ?? [])]
      .filter(item => item.startSeason === season)
      .sort((a, b) => b.startWindow - a.startWindow)[0];
    return { player, injury };
  }).filter(entry => entry.injury
    && entry.injury.durationMatches >= 6
    && (entry.player.injuredUntilWindow ?? 0) > elapsed)
    .sort((a, b) => b.injury!.durationMatches - a.injury!.durationMatches
      || a.player.uuid.localeCompare(b.player.uuid))
    .slice(0, 2);
  for (const { player, injury } of injuries) {
    candidates.push({
      id: `player-injury:${season}:${player.uuid}:${injury!.startWindow}`,
      arcKey: `player:${player.uuid}:availability`,
      eventKey: `S${season}:injury:${player.uuid}:${injury!.startWindow}`,
      source: 'player_story',
      subjectType: 'player',
      subjectIds: [player.uuid, player.teamId],
      seasonNumber: season,
      seasonPhase: '伤停观察',
      title: `${player.name}遭遇${injury!.reason}`,
      summary: `${POSITION_LABELS[player.position]}${player.name}预计缺席${injury!.durationMatches}个比赛窗口，球队阵容将真实反映这段不可用期。`,
      evidence: [fact('player_story', `player:${player.uuid}:injury`, '伤停档案', `${injury!.type} · ${injury!.reason} · ${injury!.durationMatches}个比赛窗口`)],
      nextWatch: `最早在全局窗口${player.injuredUntilWindow}恢复可选`,
      destinations: [playerDestination(player.uuid), teamDestination(player.teamId)],
      visualKind: 'fall',
      fingerprint: createNarrativeFingerprint([season, player.uuid, injury]),
      changedAt: Math.max(0, injury!.startWindow),
      weights: { importance: Math.min(92, 65 + injury!.durationMatches * 2), relevance: followed.has(player.uuid) ? 92 : 18, continuity: 72, historical: injury!.type === 'long_term' ? 65 : 25 },
    });
  }

  const retained = candidates.slice(0, leaders.length);
  for (const candidate of candidates) {
    if (retained.includes(candidate)) continue;
    retained.push(candidate);
    if (retained.length >= WORLD_NARRATIVE_CAPS.player) break;
  }
  return retained.slice(0, WORLD_NARRATIVE_CAPS.player);
}

function pointsForTeam(result: MatchResult, teamId: string): number {
  const home = result.homeGoals + (result.etHomeGoals ?? 0);
  const away = result.awayGoals + (result.etAwayGoals ?? 0);
  if (home === away) return 1;
  return (home > away) === (result.homeTeamId === teamId) ? 3 : 0;
}

export interface CoachTurnaroundSample {
  changeWindowIndex: number;
  beforePoints: number;
  afterPoints: number;
  beforePpg: number;
  afterPpg: number;
}

export function getCoachTurnaroundSample(
  world: GameWorld,
  teamId: string,
  coachId: string,
): CoachTurnaroundSample | null {
  const changeNews = [...world.newsLog].reverse().find(news =>
    news.seasonNumber === world.seasonState.seasonNumber
    && news.type === 'coach_hired'
    && news.subject?.teamIds?.includes(teamId)
    && news.subject?.coachIds?.includes(coachId),
  );
  if (!changeNews) return null;
  const teamMatches = world.seasonState.calendar.flatMap((window, windowIndex) =>
    window.completed
      ? (window.results ?? [])
        .filter(result => result.homeTeamId === teamId || result.awayTeamId === teamId)
        .map(result => ({ result, windowIndex }))
      : [],
  );
  const before = teamMatches.filter(match => match.windowIndex < changeNews.windowIndex).slice(-3);
  const after = teamMatches.filter(match => match.windowIndex > changeNews.windowIndex).slice(0, 3);
  if (before.length < 3 || after.length < 3) return null;
  const beforePoints = before.reduce((sum, match) => sum + pointsForTeam(match.result, teamId), 0);
  const afterPoints = after.reduce((sum, match) => sum + pointsForTeam(match.result, teamId), 0);
  const beforePpg = beforePoints / before.length;
  const afterPpg = afterPoints / after.length;
  if (afterPpg - beforePpg < 1) return null;
  return {
    changeWindowIndex: changeNews.windowIndex,
    beforePoints,
    afterPoints,
    beforePpg,
    afterPpg,
  };
}

function coachCandidates(options: WorldNarrativeScanOptions): NarrativeCandidate[] {
  const { world } = options;
  const season = world.seasonState.seasonNumber;
  const elapsed = world.totalElapsedWindows ?? 0;
  const favoriteTeams = new Set(options.favoriteTeamIds);
  const candidates: NarrativeCandidate[] = [];
  const changes = [...world.coachChangesThisSeason]
    .sort((a, b) => a.teamId.localeCompare(b.teamId) || a.newCoachId.localeCompare(b.newCoachId))
    .slice(-3)
    .reverse();
  for (const change of changes) {
    const team = world.teamBases[change.teamId];
    const oldCoach = world.coachBases[change.oldCoachId];
    const newCoach = world.coachBases[change.newCoachId];
    if (!team || !newCoach) continue;
    candidates.push({
      id: `coach-change:${season}:${change.teamId}:${change.newCoachId}`,
      arcKey: `team:${change.teamId}:coach-cycle`,
      eventKey: `S${season}:coach-change:${change.teamId}:${change.newCoachId}`,
      source: 'coach_story',
      subjectType: 'coach',
      subjectIds: [change.teamId, change.oldCoachId, change.newCoachId],
      seasonNumber: season,
      seasonPhase: '教练更替',
      title: `${team.shortName}进入${newCoach.name}时代`,
      summary: `${oldCoach?.name ?? '前任主帅'}离任，${newCoach.name}因“${change.reason}”接手球队。`,
      evidence: [fact('coach_story', `coach:${change.teamId}:${change.newCoachId}`, '官方变更', `${oldCoach?.name ?? change.oldCoachId} → ${newCoach.name}`)],
      nextWatch: '新帅至少完成三场比赛后，才能判断是否形成可信转折',
      destinations: [coachDestination(change.newCoachId), teamDestination(change.teamId)],
      visualKind: 'rise',
      fingerprint: createNarrativeFingerprint([season, change]),
      changedAt: elapsed,
      weights: { importance: 80, relevance: favoriteTeams.has(change.teamId) ? 72 : 22, continuity: 76, historical: 35 },
    });

    const turnaround = getCoachTurnaroundSample(world, change.teamId, change.newCoachId);
    if (!turnaround) continue;
    candidates.push({
      id: `coach-turnaround:${season}:${change.teamId}:${change.newCoachId}`,
      arcKey: `team:${change.teamId}:coach-cycle`,
      eventKey: `S${season}:coach-turnaround:${change.teamId}:${change.newCoachId}`,
      source: 'coach_story',
      subjectType: 'coach',
      subjectIds: [change.teamId, change.newCoachId],
      seasonNumber: season,
      seasonPhase: '新帅反弹',
      title: `${newCoach.name}带来第一段回应`,
      summary: `${team.name}换帅后前三场场均积分由${turnaround.beforePpg.toFixed(2)}升至${turnaround.afterPpg.toFixed(2)}，样本仍小但变化已经可核对。`,
      evidence: [fact('coach_story', `coach:${change.newCoachId}:turnaround`, '前后三场', `${turnaround.beforePoints}分 → ${turnaround.afterPoints}分`)],
      nextWatch: '继续观察六场以上样本，确认反弹是否成为稳定趋势',
      destinations: [coachDestination(change.newCoachId), teamDestination(change.teamId)],
      visualKind: 'rise',
      fingerprint: createNarrativeFingerprint([season, change.teamId, change.newCoachId, turnaround]),
      changedAt: elapsed,
      weights: { importance: 86, relevance: favoriteTeams.has(change.teamId) ? 80 : 26, continuity: 84, historical: 40 },
    });
  }

  const pressure = Object.values(world.teamStates)
    .filter(state => state.coachPressure >= 65)
    .sort((a, b) => b.coachPressure - a.coachPressure || a.id.localeCompare(b.id))
    .slice(0, 2);
  for (const state of pressure) {
    const coachId = getTeamCoachId(world.coachStates, state.id);
    const team = world.teamBases[state.id];
    const coach = coachId ? world.coachBases[coachId] : undefined;
    if (!team || !coachId || !coach) continue;
    candidates.push({
      id: `coach-pressure:${season}:${state.id}:${coachId}`,
      arcKey: `team:${state.id}:coach-pressure`,
      eventKey: `S${season}:coach-pressure:${state.id}:${state.coachPressure}`,
      source: 'coach_story',
      subjectType: 'coach',
      subjectIds: [state.id, coachId],
      seasonNumber: season,
      seasonPhase: '帅位压力',
      title: `${coach.name}的帅位进入高压区`,
      summary: `${team.name}当前教练压力${state.coachPressure}，这是一项真实状态值，不预言必然下课。`,
      evidence: [fact('coach_story', `coach:${coachId}:pressure`, '当前压力', `${state.coachPressure}/100 · 近况${state.recentForm.join('') || '暂无'}`)],
      nextWatch: '下一场结果和球队预期将共同改变压力',
      destinations: [coachDestination(coachId), teamDestination(state.id)],
      visualKind: 'fall',
      fingerprint: createNarrativeFingerprint([season, state.id, coachId, state.coachPressure, state.recentForm]),
      changedAt: elapsed,
      weights: { importance: 70 + (state.coachPressure - 65) * 0.7, relevance: favoriteTeams.has(state.id) ? 80 : 18, continuity: 72, historical: 18 },
    });
  }
  return candidates
    .sort((a, b) => b.weights.importance - a.weights.importance || a.id.localeCompare(b.id))
    .slice(0, WORLD_NARRATIVE_CAPS.coach);
}

function transferCandidates(options: WorldNarrativeScanOptions): NarrativeCandidate[] {
  const { world } = options;
  const season = world.seasonState.seasonNumber;
  const elapsed = world.totalElapsedWindows ?? 0;
  const favoriteTeams = new Set(options.favoriteTeamIds);
  const players = allActivePlayers(world);
  const playerById = new Map(players.map(player => [player.uuid, player]));
  const performances = segmentsByPlayer(world);
  const latestTransferSeason = Math.max(0, ...(world.transferHistory ?? []).map(record => record.season));
  if (latestTransferSeason < season - 1) return [];
  const major = (world.transferHistory ?? [])
    .filter(record => record.season === latestTransferSeason)
    .filter(record => (record.fee ?? 0) >= 30 || (playerById.get(record.playerId)?.rating ?? 0) >= 82)
    .sort((a, b) => (b.fee ?? 0) - (a.fee ?? 0)
      || (playerById.get(b.playerId)?.rating ?? 0) - (playerById.get(a.playerId)?.rating ?? 0)
      || a.playerId.localeCompare(b.playerId))
    .slice(0, 3);
  const candidates: NarrativeCandidate[] = major.map(record => ({
    id: `transfer-complete:${record.season}:${record.windowIndex}:${record.playerId}:${record.toTeamId}`,
    arcKey: `transfer:${record.playerId}:${record.toTeamId}`,
    eventKey: `S${record.season}:transfer:${record.windowIndex}:${record.playerId}:${record.toTeamId}`,
    source: 'transfer',
    subjectType: 'player',
    subjectIds: [record.playerId, record.fromTeamId, record.toTeamId],
    seasonNumber: record.season,
    seasonPhase: '转会落定',
    title: `${record.playerName}加盟${record.toTeamName}`,
    summary: `${record.fromTeamName} → ${record.toTeamName}${record.fee ? ` · €${record.fee}M` : ''}，这笔移动已写入正式转会档案。`,
    evidence: [fact('transfer', `transfer:${record.playerId}:${record.toTeamId}`, record.reason, `${record.position} · ${record.type}${record.fee ? ` · €${record.fee}M` : ''}`)],
    nextWatch: '观察球员在新球队的实际出场与赛季表现',
    destinations: [playerDestination(record.playerId), teamDestination(record.fromTeamId), teamDestination(record.toTeamId)],
    visualKind: 'transfer',
    fingerprint: createNarrativeFingerprint([record]),
    changedAt: elapsed,
    weights: {
      importance: Math.min(92, 62 + (record.fee ?? 0) * 0.35 + Math.max(0, (playerById.get(record.playerId)?.rating ?? 75) - 75)),
      relevance: favoriteTeams.has(record.fromTeamId) || favoriteTeams.has(record.toTeamId) ? 74 : 18,
      continuity: 58,
      historical: (record.fee ?? 0) >= 60 ? 55 : 25,
    },
  }));

  for (const record of major) {
    const player = playerById.get(record.playerId);
    if (!player || player.teamId !== record.toTeamId) continue;
    const destinationSegments = (performances.get(player.uuid) ?? [])
      .filter(segment => segment.teamId === record.toTeamId);
    const current = destinationSegments.length > 0
      ? computeSegmentedPlayerPerformance(
          player.position,
          destinationSegments,
          world.seasonStartLevels,
          world.playerStats[player.uuid],
        )
      : performanceFor(world, player, performances);
    const previous = [...(world.playerStatsHistory[player.uuid] ?? [])]
      .filter(row => row.season < season && row.seasonScore !== undefined)
      .sort((a, b) => b.season - a.season)[0];
    if (!previous?.seasonScore || current.metrics.minutes < 450 || current.seasonScore < 75 || current.seasonScore - previous.seasonScore < 6) continue;
    candidates.push({
      id: `transfer-resurgence:${season}:${player.uuid}:${record.toTeamId}`,
      arcKey: `transfer:${record.playerId}:${record.toTeamId}`,
      eventKey: `S${season}:transfer-resurgence:${player.uuid}:${record.toTeamId}`,
      source: 'transfer',
      subjectType: 'player',
      subjectIds: [player.uuid, record.toTeamId],
      seasonNumber: season,
      seasonPhase: '转会后回应',
      title: `${player.name}在新环境中回升`,
      summary: `加盟${record.toTeamName}后，${player.name}的赛季评分达到${current.seasonScore.toFixed(1)}，高于上一份完整赛季档案。`,
      evidence: [fact('transfer', `transfer:${player.uuid}:resurgence`, '赛季对照', `S${previous.season} ${previous.seasonScore.toFixed(1)} → S${season} ${current.seasonScore.toFixed(1)} · ${current.metrics.minutes}分钟`)],
      nextWatch: '观察回升能否在更大样本中保持',
      destinations: [playerDestination(player.uuid), teamDestination(record.toTeamId)],
      visualKind: 'rise',
      fingerprint: createNarrativeFingerprint([season, player.uuid, previous.seasonScore, current.seasonScore, current.metrics.minutes]),
      changedAt: elapsed,
      weights: { importance: 82, relevance: favoriteTeams.has(record.toTeamId) ? 82 : 22, continuity: 76, historical: 38 },
    });
  }
  return candidates
    .sort((a, b) => b.weights.importance - a.weights.importance || a.id.localeCompare(b.id))
    .slice(0, WORLD_NARRATIVE_CAPS.transfer);
}

export function buildCompetitionLandscapes(world: GameWorld): CompetitionLandscape[] {
  const landscapes: CompetitionLandscape[] = [];
  for (const level of [1, 2, 3] as const) {
    const table = standingsForLevel(world, level);
    if (table.length < 4) continue;
    const played = table[0]?.played ?? 0;
    const total = Math.max(1, (table.length - 1) * 2);
    const progress = Math.min(1, played / total);
    if (played >= 4) {
      const leaders = table.slice(0, 3);
      const gap = leaders[0].points - leaders.at(-1)!.points;
      if (gap <= (progress >= 0.7 ? 6 : 4)) {
        landscapes.push({
          id: `league-${level}-title`,
          kind: 'title',
          label: `${LEAGUE_LABELS[level]}争冠`,
          detail: `${leaders.map((row, index) => `${index + 1}.${world.teamBases[row.teamId]?.shortName ?? row.teamId} ${row.points}分`).join(' · ')}，前三相差${gap}分。`,
          teamIds: leaders.map(row => row.teamId),
          progress,
        });
      }
    }
    if (progress < 0.55) continue;
    if (level > 1) {
      const promoted = table.slice(0, 3);
      const gap = Math.abs(promoted[1].points - promoted[2].points);
      if (gap <= 4) {
        landscapes.push({
          id: `league-${level}-promotion`,
          kind: 'promotion',
          label: `${LEAGUE_LABELS[level]}升级线`,
          detail: `第2名${world.teamBases[promoted[1].teamId]?.shortName ?? promoted[1].teamId}与第3名${world.teamBases[promoted[2].teamId]?.shortName ?? promoted[2].teamId}相差${gap}分。`,
          teamIds: [promoted[1].teamId, promoted[2].teamId],
          progress,
        });
      }
    }
    if (level < 3) {
      const safeIndex = table.length - 3;
      const safe = table[safeIndex];
      const danger = table[safeIndex + 1];
      const gap = Math.abs(safe.points - danger.points);
      if (gap <= 4) {
        landscapes.push({
          id: `league-${level}-relegation`,
          kind: 'relegation',
          label: `${LEAGUE_LABELS[level]}保级线`,
          detail: `${world.teamBases[safe.teamId]?.shortName ?? safe.teamId}与${world.teamBases[danger.teamId]?.shortName ?? danger.teamId}在安全线两侧，相差${gap}分。`,
          teamIds: [safe.teamId, danger.teamId],
          progress,
        });
      }
    }
  }
  const priority = { title: 3, promotion: 2, relegation: 2 } as const;
  return landscapes
    .sort((a, b) => b.progress - a.progress || priority[b.kind] - priority[a.kind] || a.id.localeCompare(b.id))
    .slice(0, 6);
}

function competitionCandidates(options: WorldNarrativeScanOptions): NarrativeCandidate[] {
  const { world, currentWindow } = options;
  const season = world.seasonState.seasonNumber;
  const elapsed = world.totalElapsedWindows ?? 0;
  const favoriteTeams = new Set(options.favoriteTeamIds);
  const candidates: NarrativeCandidate[] = buildCompetitionLandscapes(world).map(landscape => ({
    id: `competition:${season}:${landscape.id}`,
    arcKey: `competition:${landscape.id}:${season}`,
    eventKey: `S${season}:${landscape.id}:${Math.round(landscape.progress * 100)}`,
    source: 'competition',
    subjectType: 'competition',
    subjectIds: landscape.teamIds,
    seasonNumber: season,
    seasonPhase: `${Math.round(landscape.progress * 100)}%`,
    title: landscape.label,
    summary: landscape.detail,
    evidence: [fact('competition', `competition:${landscape.id}`, '积分格局', landscape.detail)],
    nextWatch: landscape.kind === 'title' ? '关注领跑集团的直接对话' : '关注分界线两侧球队的下一轮结果',
    destinations: landscape.teamIds.slice(0, 3).map(teamDestination),
    visualKind: landscape.progress >= 0.8 ? 'stage' : undefined,
    fingerprint: createNarrativeFingerprint([season, landscape.id, landscape.detail]),
    changedAt: elapsed,
    weights: {
      importance: 62 + landscape.progress * 24,
      relevance: landscape.teamIds.some(id => favoriteTeams.has(id)) ? 70 : 14,
      continuity: 72,
      historical: landscape.progress >= 0.85 ? 55 : 18,
    },
  }));

  for (const fixture of currentWindow.fixtures) {
    const roundRank = getKnockoutRoundRank(fixture.roundLabel);
    const isFinal = roundRank >= 4;
    const isGlobalStage = fixture.competitionType === 'world_cup' || fixture.competitionType === 'continental_cup';
    if (!isFinal && !isGlobalStage) continue;
    const home = world.teamBases[fixture.homeTeamId];
    const away = world.teamBases[fixture.awayTeamId];
    candidates.push({
      id: `competition-fixture:${fixture.id}`,
      arcKey: isFinal
        ? `competition:${fixture.competitionType}:final:${season}`
        : `competition:${fixture.competitionType}:${fixture.roundLabel}:${season}`,
      eventKey: fixture.id,
      source: 'competition',
      subjectType: 'competition',
      subjectIds: [fixture.homeTeamId, fixture.awayTeamId],
      fixtureIds: [fixture.id],
      seasonNumber: season,
      seasonPhase: fixture.roundLabel,
      title: isFinal ? `${fixture.competitionName}决赛` : `${fixture.competitionName}进入${fixture.roundLabel}`,
      summary: `${home?.name ?? fixture.homeTeamId}对阵${away?.name ?? fixture.awayTeamId}${fixture.isNeutralVenue ? '，比赛在中立场进行。' : '。'}`,
      evidence: [fact('competition', `competition:${fixture.id}:stage`, '赛事节点', `${fixture.competitionName} · ${fixture.roundLabel}${fixture.isNeutralVenue ? ' · 中立场' : ''}`)],
      nextWatch: isFinal ? '冠军将在这场比赛后产生' : '观察谁能继续留在洲际舞台',
      destinations: [fixtureDestination(fixture.id)],
      visualKind: 'stage',
      fingerprint: createNarrativeFingerprint([fixture.id, fixture.roundLabel, fixture.isNeutralVenue]),
      changedAt: elapsed,
      weights: {
        importance: isFinal ? 96 : 80,
        relevance: favoriteTeams.has(fixture.homeTeamId) || favoriteTeams.has(fixture.awayTeamId) ? 78 : 20,
        continuity: 68,
        historical: isFinal ? 95 : 55,
      },
    });
  }
  return candidates
    .sort((a, b) => b.weights.importance - a.weights.importance || a.id.localeCompare(b.id))
    .slice(0, WORLD_NARRATIVE_CAPS.competition);
}

function recordCandidates(options: WorldNarrativeScanOptions): NarrativeCandidate[] {
  const { world } = options;
  const season = world.seasonState.seasonNumber;
  const historical = Object.entries(world.playerStatsHistory).flatMap(([playerId, rows]) =>
    rows.filter(row => row.season < season).map(row => ({ playerId, row })),
  );
  const record = historical
    .filter(entry => entry.row.goals > 0)
    .sort((a, b) => b.row.goals - a.row.goals
      || a.row.season - b.row.season
      || a.playerId.localeCompare(b.playerId))[0];
  if (!record) return [];
  const challenger = Object.values(world.playerStats)
    .filter(stats => stats.goals >= 5 && stats.goals < record.row.goals)
    .filter(stats => record.row.goals - stats.goals <= 3 || stats.goals / record.row.goals >= 0.8)
    .sort((a, b) => b.goals - a.goals || a.playerId.localeCompare(b.playerId))[0];
  if (!challenger) return [];
  const player = allActivePlayers(world).find(item => item.uuid === challenger.playerId);
  if (!player) return [];
  const holder = record.row.playerName ?? record.playerId;
  const candidate: NarrativeCandidate = {
    id: `record:season-goals:${season}:${player.uuid}`,
    arcKey: `record:retained-season-goals:${season}`,
    eventKey: `S${season}:record-goals:${player.uuid}:${challenger.goals}`,
    source: 'record',
    subjectType: 'player',
    subjectIds: [player.uuid, player.teamId, record.playerId],
    seasonNumber: season,
    seasonPhase: '纪录追逐',
    title: `${player.name}接近存档赛季进球纪录`,
    summary: `${player.name}已有${challenger.goals}球，距离已保留档案纪录${record.row.goals}球还差${record.row.goals - challenger.goals}球。`,
    evidence: [fact('record', `record:goals:${record.row.season}:${record.playerId}`, '可核对目标', `S${record.row.season} · ${holder} · ${record.row.goals}球`)],
    nextWatch: '纪录只在真实进球写入球员统计后更新',
    destinations: [
      playerDestination(player.uuid),
      ...(record.playerId !== player.uuid && hasPlayerDetail(world, record.playerId)
        ? [playerDestination(record.playerId)]
        : []),
    ],
    visualKind: 'legacy',
    fingerprint: createNarrativeFingerprint([season, player.uuid, challenger.goals, record.row.season, record.playerId, record.row.goals]),
    changedAt: world.totalElapsedWindows ?? 0,
    weights: { importance: 82, relevance: options.favoritePlayerIds.includes(player.uuid) ? 88 : 20, continuity: 76, historical: 68 },
  };
  return [candidate].slice(0, WORLD_NARRATIVE_CAPS.record);
}

export function buildWorldNarrativeCandidates(options: WorldNarrativeScanOptions): NarrativeCandidate[] {
  return [
    ...playerCandidates(options),
    ...coachCandidates(options),
    ...transferCandidates(options),
    ...competitionCandidates(options),
    ...recordCandidates(options),
  ].slice(0, WORLD_NARRATIVE_CAPS.total);
}

export function buildSeasonNarrativeOverview(
  world: GameWorld,
  primaryTeamId: string | null,
  favoritePlayerIds: readonly string[],
): SeasonNarrativeOverview {
  const observedState = primaryTeamId ? world.teamStates[primaryTeamId] : undefined;
  const observedTable = observedState ? standingsForLevel(world, observedState.leagueLevel) : [];
  const observedRow = primaryTeamId ? observedTable.find(row => row.teamId === primaryTeamId) : undefined;
  const observedRank = observedRow ? observedTable.findIndex(row => row.teamId === primaryTeamId) + 1 : 0;
  const expectedRank = primaryTeamId
    ? Math.max(1, Math.min(observedTable.length, Math.round(observedTable.length * (1 - ((world.teamBases[primaryTeamId]?.expectation ?? 3) - 1) / 4))))
    : 0;
  const observedTeam = primaryTeamId && observedRow ? {
    teamId: primaryTeamId,
    title: `${world.teamBases[primaryTeamId]?.shortName ?? primaryTeamId}当前第${observedRank}`,
    detail: `${observedRow.played}场${observedRow.points}分，赛前期望约第${expectedRank}，目前${observedRank < expectedRank ? `高出${expectedRank - observedRank}位` : observedRank > expectedRank ? `低于${observedRank - expectedRank}位` : '与预期一致'}。`,
  } : undefined;

  const activeArcs: Array<{ story: Storyline; signal: StorylineSignal }> = (world.activeStorylines ?? [])
    .map(story => ({ story, signal: describeStoryline(world, story) }))
    .filter((entry): entry is { story: Storyline; signal: StorylineSignal } => Boolean(entry.signal));
  const arcs = activeArcs
    .sort((a, b) => b.signal.priority - a.signal.priority || a.story.id.localeCompare(b.story.id))
    .slice(0, 3)
    .map(({ story, signal }) => ({
      id: getStorylineArcKey(story.teamId, story.type, story.competitionName),
      teamId: story.teamId,
      title: signal.title,
      detail: signal.body,
      phase: signal.phase,
    }));

  const players = allActivePlayers(world);
  const playerById = new Map(players.map(player => [player.uuid, player]));
  const segments = segmentsByPlayer(world);
  const watchedPlayers = favoritePlayerIds.flatMap(playerId => {
    const player = playerById.get(playerId);
    if (!player) return [];
    const performance = performanceFor(world, player, segments);
    const activeInjury = (player.injuredUntilWindow ?? 0) > (world.totalElapsedWindows ?? 0);
    const latestTransfer = [...(world.transferHistory ?? [])]
      .filter(record => record.playerId === playerId)
      .sort((a, b) => b.season - a.season || b.windowIndex - a.windowIndex)[0];
    const recentTransfer = latestTransfer && latestTransfer.season >= world.seasonState.seasonNumber - 1;
    if (!activeInjury && performance.metrics.minutes < 360 && !recentTransfer) return [];
    const detail = activeInjury
      ? `当前伤停至全局窗口${player.injuredUntilWindow}，本季因伤缺席${performance.metrics.injuryAbsenceMatches}场。`
      : recentTransfer
        ? `近期从${latestTransfer.fromTeamName}转至${latestTransfer.toTeamName}，本季${performance.metrics.minutes}分钟。`
        : `赛季评分${performance.seasonScore.toFixed(1)} · ${playerPerformanceDetail(player, performance, world)}。`;
    return [{ playerId, title: player.name, detail }];
  }).slice(0, 4);

  return {
    observedTeam,
    landscapes: buildCompetitionLandscapes(world).slice(0, 4),
    arcs,
    watchedPlayers,
  };
}
