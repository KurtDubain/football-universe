import type { MatchEvent, MatchResult, MatchdaySnapshot } from '../../types/match';
import type { Player, PlayerPosition } from '../../types/player';

export type MatchImpactBand = 'decisive' | 'excellent' | 'steady' | 'quiet';

export interface MatchPlayerImpact {
  playerId: string;
  playerName: string;
  teamId: string;
  position: PlayerPosition | null;
  minutesPlayed: number;
  goals: number;
  assists: number;
  routineSaves: number;
  keySaves: number;
  goalLineBlocks: number;
  interceptions: number;
  clearances: number;
  yellowCards: number;
  redCards: number;
  goalsConcededWhileOnPitch: number;
  score: number;
  band: MatchImpactBand;
  summary: string;
}

export interface MatchImpactSource {
  events: MatchEvent[];
  defensiveContributions?: MatchResult['defensiveContributions'];
  homeTeamId?: string;
  awayTeamId?: string;
  homeGoals?: number;
  awayGoals?: number;
  etHomeGoals?: number;
  etAwayGoals?: number;
  homeMatchday?: MatchdaySnapshot;
  awayMatchday?: MatchdaySnapshot;
  winnerTeamId?: string | null;
}

type MutableImpact = Omit<MatchPlayerImpact, 'score' | 'band' | 'summary'>;

function roundOne(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function impactBand(score: number): MatchImpactBand {
  if (score >= 5) return 'decisive';
  if (score >= 3.5) return 'excellent';
  if (score >= 2) return 'steady';
  return 'quiet';
}

function summaryFor(impact: MutableImpact): string {
  const parts: string[] = [];
  if (impact.goals) parts.push(`${impact.goals}球`);
  if (impact.assists) parts.push(`${impact.assists}助攻`);
  if (impact.keySaves) parts.push(`${impact.keySaves}次关键扑救`);
  if (impact.routineSaves) parts.push(`${impact.routineSaves}次扑救`);
  if (impact.goalLineBlocks) parts.push(`${impact.goalLineBlocks}次门线封堵`);
  if (impact.interceptions) parts.push(`${impact.interceptions}次拦截`);
  if (impact.clearances) parts.push(`${impact.clearances}次解围`);
  if (impact.redCards) parts.push('红牌离场');
  else if (impact.yellowCards) parts.push(`${impact.yellowCards}张黄牌`);
  return parts.slice(0, 3).join(' · ') || '本场受到限制';
}

function scoreImpact(impact: MutableImpact, winnerTeamId: string | null | undefined): number {
  let score = impact.goals * 3.2
    + impact.assists * 2.2
    + impact.keySaves * 2.5
    + impact.goalLineBlocks * 2.4
    + Math.min(5, impact.routineSaves) * 0.45
    + Math.min(6, impact.interceptions) * 0.18
    + Math.min(8, impact.clearances) * 0.1
    - impact.yellowCards * 0.6
    - impact.redCards * 2.2;

  if ((impact.position === 'GK' || impact.position === 'DF') && impact.minutesPlayed >= 60) {
    if (impact.goalsConcededWhileOnPitch === 0) score += 0.8;
    else score -= impact.goalsConcededWhileOnPitch * (impact.position === 'GK' ? 0.35 : 0.12);
  }
  if (winnerTeamId && impact.teamId === winnerTeamId && score > 0) score *= 1.06;
  return roundOne(score);
}

function isOnPitch(entry: MatchdaySnapshot['players'][number], minute: number, duration: number): boolean {
  const normalizedMinute = Math.min(minute, duration - 1);
  return entry.enteredMinute != null
    && entry.exitedMinute != null
    && entry.enteredMinute <= normalizedMinute
    && entry.exitedMinute > normalizedMinute;
}

function inferPosition(event: MatchEvent): PlayerPosition | null {
  if (event.type === 'gk_save') return 'GK';
  if (event.type === 'df_block') return 'DF';
  return null;
}

export function computeMatchPlayerImpacts(
  source: MatchImpactSource,
  players?: Map<string, Player>,
): MatchPlayerImpact[] {
  const impacts = new Map<string, MutableImpact>();
  const snapshots = [source.homeMatchday, source.awayMatchday].filter(
    (snapshot): snapshot is MatchdaySnapshot => Boolean(snapshot),
  );
  const snapshotEntryById = new Map<string, MatchdaySnapshot['players'][number]>();
  for (const snapshot of snapshots) {
    for (const entry of snapshot.players) snapshotEntryById.set(entry.playerId, entry);
  }

  const ensure = (
    playerId: string,
    teamId: string,
    playerName?: string,
    position?: PlayerPosition | null,
  ): MutableImpact => {
    const existing = impacts.get(playerId);
    if (existing) return existing;
    const player = players?.get(playerId);
    const snapshot = snapshotEntryById.get(playerId);
    const entry: MutableImpact = {
      playerId,
      playerName: playerName ?? player?.name ?? snapshot?.playerName ?? playerId,
      teamId,
      position: position ?? player?.position ?? snapshot?.position ?? null,
      minutesPlayed: snapshot?.minutesPlayed ?? 90,
      goals: 0,
      assists: 0,
      routineSaves: 0,
      keySaves: 0,
      goalLineBlocks: 0,
      interceptions: 0,
      clearances: 0,
      yellowCards: 0,
      redCards: 0,
      goalsConcededWhileOnPitch: 0,
    };
    impacts.set(playerId, entry);
    return entry;
  };

  for (const snapshot of snapshots) {
    for (const entry of snapshot.players) {
      if ((entry.minutesPlayed ?? 0) <= 0) continue;
      const teamId = snapshot === source.homeMatchday ? source.homeTeamId : source.awayTeamId;
      if (!teamId) continue;
      ensure(entry.playerId, teamId, entry.playerName, entry.position);
    }
  }

  for (const event of source.events) {
    if (event.minute > 120 || !event.playerId) continue;
    const impact = ensure(event.playerId, event.teamId, event.playerName, inferPosition(event));
    if (event.type === 'goal') impact.goals++;
    else if (event.type === 'assist') impact.assists++;
    else if (event.type === 'gk_save') impact.keySaves++;
    else if (event.type === 'df_block') impact.goalLineBlocks++;
    else if (event.type === 'yellow_card') impact.yellowCards++;
    else if (event.type === 'red_card') impact.redCards++;
  }

  for (const contribution of Object.values(source.defensiveContributions ?? {})) {
    const impact = ensure(contribution.playerId, contribution.teamId);
    impact.routineSaves += Math.max(0, contribution.routineSaves ?? 0);
    impact.interceptions += Math.max(0, contribution.interceptions);
    impact.clearances += Math.max(0, contribution.clearances);
  }

  const goalEvents = source.events.filter(event => event.type === 'goal' && event.minute <= 120);
  for (const goal of goalEvents) {
    const concedingTeamId = goal.teamId === source.homeTeamId
      ? source.awayTeamId
      : goal.teamId === source.awayTeamId
        ? source.homeTeamId
        : undefined;
    if (!concedingTeamId) continue;
    const snapshot = concedingTeamId === source.homeTeamId ? source.homeMatchday : source.awayMatchday;
    const duration = snapshot?.durationMinutes ?? 90;
    for (const impact of impacts.values()) {
      if (impact.teamId !== concedingTeamId) continue;
      const entry = snapshotEntryById.get(impact.playerId);
      if (!entry || isOnPitch(entry, goal.minute, duration)) impact.goalsConcededWhileOnPitch++;
    }
  }

  return [...impacts.values()]
    .map(impact => {
      const score = scoreImpact(impact, source.winnerTeamId);
      return {
        ...impact,
        score,
        band: impactBand(score),
        summary: summaryFor(impact),
      };
    })
    .sort((left, right) => right.score - left.score || left.playerId.localeCompare(right.playerId));
}

export function selectMatchMotm(
  source: MatchImpactSource,
  players?: Map<string, Player>,
): MatchResult['motm'] {
  const best = computeMatchPlayerImpacts(source, players)[0];
  if (!best || best.score < 2.6) return undefined;
  return {
    playerId: best.playerId,
    playerName: best.playerName,
    teamId: best.teamId,
  };
}
