import type { SeasonRecord } from '../../types/team';
import { getSeasonPlayerStatRows } from '../players/player-stat-selectors';
import type { GameWorld } from '../season/season-manager';
import { expectedStoryPosition } from '../season/storylines';
import { getObservationThemeLabel } from './observation-theme';
import type { ObserverSeasonTrajectory } from './season-trajectory';

export type ObservationThemeResultTone = 'positive' | 'neutral' | 'caution';

export interface ObservationThemeResult {
  label: string;
  verdict: string;
  tone: ObservationThemeResultTone;
  title: string;
  summary: string;
  evidence: string[];
  teamId: string;
  playerId?: string;
}

function expectedPosition(record: SeasonRecord, expectation: number): number {
  const teamCount = Math.max(2, Math.round(record.leaguePlayed / 2) + 1);
  return expectedStoryPosition(teamCount, expectation);
}

function giantResult(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory,
  record: SeasonRecord,
): ObservationThemeResult {
  const team = world.teamBases[trajectory.teamId];
  const expected = expectedPosition(record, team?.expectation ?? 3);
  const position = record.leaguePosition;
  const metExpectation = position <= expected;
  return {
    label: getObservationThemeLabel('giant_defense'),
    verdict: position === 1 ? '联赛夺冠' : metExpectation ? '守住预期' : '偏离预期',
    tone: position === 1 || metExpectation ? 'positive' : 'caution',
    title: `${team?.name ?? trajectory.teamId}的守成答案`,
    summary: position === 1
      ? `球队以第1名完成赛季，豪门守成最终落在一座联赛冠军上。`
      : metExpectation
        ? `球队最终排名第${position}，达到赛前第${expected}左右的预期。`
        : `球队最终排名第${position}，低于赛前第${expected}左右的预期${position - expected}位。`,
    evidence: [
      `最终第${position}名`,
      `${record.leaguePoints}分`,
      `${record.leagueWon}胜 ${record.leagueDrawn}平 ${record.leagueLost}负`,
    ],
    teamId: trajectory.teamId,
  };
}

function darkHorseResult(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory,
  record: SeasonRecord,
): ObservationThemeResult {
  const team = world.teamBases[trajectory.teamId];
  const expected = expectedPosition(record, team?.expectation ?? 3);
  const delta = expected - record.leaguePosition;
  return {
    label: getObservationThemeLabel('dark_horse_challenge'),
    verdict: delta >= 3 ? '挑战成功' : delta > 0 ? '突破预期' : delta === 0 ? '站稳预期' : '等待再起',
    tone: delta > 0 ? 'positive' : delta === 0 ? 'neutral' : 'caution',
    title: `${team?.name ?? trajectory.teamId}的挑战结论`,
    summary: delta > 0
      ? `球队最终排名第${record.leaguePosition}，比赛前第${expected}左右的预期高出${delta}位。`
      : delta === 0
        ? `球队最终排名第${record.leaguePosition}，与赛前预期基本一致。`
        : `球队最终排名第${record.leaguePosition}，这一次尚未突破第${expected}左右的赛前预期。`,
    evidence: [
      `预期约第${expected}`,
      `最终第${record.leaguePosition}名`,
      `${record.leaguePoints}分`,
    ],
    teamId: trajectory.teamId,
  };
}

function promotionResult(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory,
  record: SeasonRecord,
): ObservationThemeResult {
  const teamName = world.teamBases[trajectory.teamId]?.name ?? trajectory.teamId;
  const wasTopFlight = trajectory.leagueLevel === 1;
  const verdict = record.promoted
    ? '成功升级'
    : record.relegated
      ? '遗憾降级'
      : wasTopFlight
        ? '完成保级'
        : record.leaguePosition <= 3
          ? '接近升级'
          : '留在原级别';
  const tone: ObservationThemeResultTone = record.promoted || (wasTopFlight && !record.relegated)
    ? 'positive'
    : record.relegated
      ? 'caution'
      : 'neutral';
  const summary = record.promoted
    ? `球队以第${record.leaguePosition}名结束第${trajectory.leagueLevel}级联赛，并获得升级资格。`
    : record.relegated
      ? `球队最终排名第${record.leaguePosition}，赛季以降级告终。`
      : wasTopFlight
        ? `球队最终排名第${record.leaguePosition}，守住了顶级联赛席位。`
        : `球队最终排名第${record.leaguePosition}，新赛季仍将从原级别继续出发。`;
  return {
    label: getObservationThemeLabel('promotion_survival'),
    verdict,
    tone,
    title: `${teamName}的升降级答案`,
    summary,
    evidence: [
      `第${trajectory.leagueLevel}级联赛`,
      `最终第${record.leaguePosition}名`,
      `${record.leaguePoints}分`,
    ],
    teamId: trajectory.teamId,
  };
}

function playerGrowthResult(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory,
): ObservationThemeResult {
  const playerId = trajectory.theme?.playerId;
  const player = playerId
    ? getSeasonPlayerStatRows(world, trajectory.seasonNumber)
      .find(row => row.playerId === playerId)
    : undefined;
  const playerName = player?.identity.playerName ?? '所观察的年轻球员';
  const appearances = player?.appearances ?? 0;
  const verdict = appearances >= 10 ? '成为轮换核心' : appearances > 0 ? '留下赛季足迹' : '等待机会';
  const tone: ObservationThemeResultTone = appearances > 0 ? 'positive' : 'neutral';
  const contribution = player?.identity.position === 'GK'
    ? `${player.routineSaves ?? 0}次普通扑救 · ${player.saves}次关键扑救`
    : player?.identity.position === 'DF'
      ? `${player.interceptions ?? 0}次拦截 · ${player.clearances ?? 0}次解围`
      : `${player?.goals ?? 0}球 · ${player?.assists ?? 0}助攻`;
  return {
    label: getObservationThemeLabel('player_growth'),
    verdict,
    tone,
    title: `${playerName}的成长赛季`,
    summary: player
      ? `${playerName}在本赛季出场${appearances}次，所有结论均来自冻结的赛季球员记录。`
      : '该主题保留了球员引用，但当前历史上限内已没有可核对的赛季数据。',
    evidence: player
      ? [
          `${appearances}次出场`,
          contribution,
          player.identity.rating ? `赛季评分 ${player.identity.rating}` : '评分未记录',
        ]
      : ['球员记录已超出当前历史保留范围'],
    teamId: trajectory.teamId,
    ...(playerId ? { playerId } : {}),
  };
}

function pureObservationResult(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory,
  record: SeasonRecord,
): ObservationThemeResult {
  const storyCount = (world.storylineHistory ?? [])
    .filter(storyline => storyline.seasonNumber === trajectory.seasonNumber)
    .length;
  const teamName = world.teamBases[trajectory.teamId]?.name ?? trajectory.teamId;
  return {
    label: getObservationThemeLabel('pure_observation'),
    verdict: '世界继续演化',
    tone: 'neutral',
    title: `第${trajectory.seasonNumber}赛季观察结论`,
    summary: `本季留下${storyCount}条故事结局；主要观察球队${teamName}最终排名第${record.leaguePosition}。`,
    evidence: [
      `${storyCount}条故事落幕`,
      `${teamName}第${record.leaguePosition}名`,
      `${record.leaguePoints}分`,
    ],
    teamId: trajectory.teamId,
  };
}

export function describeObservationThemeResult(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory,
  record: SeasonRecord,
): ObservationThemeResult | null {
  const type = trajectory.theme?.type;
  if (!type) return null;
  if (type === 'giant_defense') return giantResult(world, trajectory, record);
  if (type === 'dark_horse_challenge') return darkHorseResult(world, trajectory, record);
  if (type === 'promotion_survival') return promotionResult(world, trajectory, record);
  if (type === 'player_growth') return playerGrowthResult(world, trajectory);
  return pureObservationResult(world, trajectory, record);
}
