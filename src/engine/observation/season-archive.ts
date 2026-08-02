import type { GameWorld } from '../season/season-manager';
import type { SeasonRecord } from '../../types/team';
import { getSeasonPlayerStatRows, type PlayerStatRow } from '../players/player-stat-selectors';
import type { ObserverSeasonTrajectory } from './season-trajectory';

export type ObserverImpressionTone = 'emerald' | 'sky' | 'amber' | 'slate';

export interface ObserverImpression {
  label: string;
  detail: string;
  tone: ObserverImpressionTone;
  sampleState: 'none' | 'forming' | 'rated';
}

export interface SeasonObservationArchive {
  seasonNumber: number;
  teamId: string;
  finalFate: {
    label: string;
    detail: string;
    tone: 'positive' | 'neutral' | 'caution';
    expectedPosition: number;
    positionDelta: number;
  };
  cupPaths: Array<{ label: string; result: string }>;
  impression: ObserverImpression;
  judgment: {
    total: number;
    correct: number;
    accuracy: number | null;
    currentStreak: number;
    bestStreak: number;
  };
  representative?: PlayerStatRow;
  nextWatch: string;
}

export function describeObserverImpression(
  judgment: ObserverSeasonTrajectory['judgment'],
): ObserverImpression {
  const total = judgment?.total ?? 0;
  if (total === 0) {
    return {
      label: '纯粹见证者',
      detail: '没有留下赛前判断，只记录这个世界如何自行演化。',
      tone: 'slate',
      sampleState: 'none',
    };
  }
  if (total < 5) {
    return {
      label: '记录形成中',
      detail: `已留下${total}次判断，样本积累中，暂不评价观察准确度。`,
      tone: 'sky',
      sampleState: 'forming',
    };
  }
  const accuracy = (judgment?.correct ?? 0) / total;
  if (accuracy >= 0.75) {
    return {
      label: '洞察潮向',
      detail: `${total}次判断形成了清晰样本，你多次捕捉到了比赛的真实走向。`,
      tone: 'emerald',
      sampleState: 'rated',
    };
  }
  if (accuracy >= 0.55) {
    return {
      label: '稳定观察',
      detail: `${total}次判断已形成有效样本，你对这个赛季保持了稳定感知。`,
      tone: 'sky',
      sampleState: 'rated',
    };
  }
  return {
    label: '仍在校准',
    detail: `${total}次判断留下了完整轨迹，意外结果也成为这段历史的一部分。`,
    tone: 'amber',
    sampleState: 'rated',
  };
}

function finalFate(
  trajectory: ObserverSeasonTrajectory,
  record: SeasonRecord,
): SeasonObservationArchive['finalFate'] {
  const expected = trajectory.expectedPosition ?? record.leaguePosition;
  const positionDelta = expected - record.leaguePosition;
  const expectation = positionDelta > 0
    ? `高于赛前预期${positionDelta}位`
    : positionDelta < 0
      ? `低于赛前预期${Math.abs(positionDelta)}位`
      : '与赛前预期一致';
  if (record.relegated) {
    return {
      label: '遗憾降级',
      detail: `联赛第${record.leaguePosition}名，${record.leaguePoints}分，${expectation}。`,
      tone: 'caution',
      expectedPosition: expected,
      positionDelta,
    };
  }
  if (record.promoted) {
    return {
      label: '成功升级',
      detail: `联赛第${record.leaguePosition}名，${record.leaguePoints}分，${expectation}。`,
      tone: 'positive',
      expectedPosition: expected,
      positionDelta,
    };
  }
  if (record.leaguePosition === 1) {
    return {
      label: '联赛夺冠',
      detail: `${record.leaguePoints}分登顶，${expectation}。`,
      tone: 'positive',
      expectedPosition: expected,
      positionDelta,
    };
  }
  return {
    label: positionDelta >= 3 ? '突破预期' : positionDelta <= -3 ? '未及预期' : '稳定收官',
    detail: `联赛第${record.leaguePosition}名，${record.leaguePoints}分，${expectation}。`,
    tone: positionDelta >= 3 ? 'positive' : positionDelta <= -3 ? 'caution' : 'neutral',
    expectedPosition: expected,
    positionDelta,
  };
}

function nextWatch(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory,
  record: SeasonRecord,
  representative?: PlayerStatRow,
): string {
  const teamName = world.teamBases[trajectory.teamId]?.shortName ?? trajectory.teamId;
  if (record.relegated) return `${teamName}降入新级别后，能否立即回应这次失落？`;
  if (record.promoted) return `${teamName}来到更高舞台后，能否把升级势头延续下去？`;
  if (record.leaguePosition === 1) return `${teamName}已经登顶，下赛季还能否守住王座？`;
  if (representative && representative.appearances >= 10) {
    return `${representative.identity.playerName}能否把本季的关键作用延续到下一年？`;
  }
  if ((trajectory.expectedPosition ?? record.leaguePosition) > record.leaguePosition) {
    return `${teamName}已经突破预期，这会是一季闪光还是新时代的开端？`;
  }
  return `${teamName}会沿着本季轨道继续前进，还是迎来一次新的偏离？`;
}

export function buildSeasonObservationArchive(
  world: GameWorld,
  trajectory: ObserverSeasonTrajectory,
  record: SeasonRecord,
): SeasonObservationArchive {
  const rows = getSeasonPlayerStatRows(world, trajectory.seasonNumber)
    .filter(row => row.teamId === trajectory.teamId);
  const representative = trajectory.representativePlayerId
    ? rows.find(row => row.playerId === trajectory.representativePlayerId)
    : undefined;
  const judgment = trajectory.judgment;
  const total = judgment?.total ?? 0;
  const cupPaths = [
    ['联赛杯', record.cupResult],
    ['超级杯', record.superCupResult],
    ['洲际杯', record.continentalCupResult],
    ['环球冠军杯', record.worldCupResult],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1] && entry[1] !== '未参加'))
    .map(([label, result]) => ({ label, result }));

  return {
    seasonNumber: trajectory.seasonNumber,
    teamId: trajectory.teamId,
    finalFate: finalFate(trajectory, record),
    cupPaths,
    impression: describeObserverImpression(judgment),
    judgment: {
      total,
      correct: judgment?.correct ?? 0,
      accuracy: total > 0 ? (judgment?.correct ?? 0) / total : null,
      currentStreak: judgment?.currentStreak ?? 0,
      bestStreak: judgment?.bestStreak ?? 0,
    },
    representative,
    nextWatch: nextWatch(world, trajectory, record, representative),
  };
}
