import type { Player } from '../../types/player';
import { computePlayerPerformance, computeSegmentedPlayerPerformance } from '../players/player-performance';
import { buildSeasonHistoryLabels } from '../history/season-history-summary';
import type { GameWorld } from '../season/season-manager';
import { describeStoryline } from '../season/storylines';
import { getCoachTurnaroundSample } from './narrative-world-scan';

export type NarrativeThreadTone = 'stage' | 'rise' | 'fall' | 'transfer' | 'neutral';

export interface NarrativeThreadEntry {
  id: string;
  season: number;
  order: number;
  title: string;
  detail: string;
  tone: NarrativeThreadTone;
  to?: string;
  summaryOnly?: boolean;
}

export interface NarrativeThread {
  id: string;
  title: string;
  summary: string;
  entries: NarrativeThreadEntry[];
}

export const MAX_NARRATIVE_THREAD_ENTRIES = 5;

const STORY_LABELS = {
  dark_horse: '黑马崛起',
  giant_crisis: '豪门危机',
  promoted_survival: '升班马求生',
  unbeaten_run: '联赛不败征程',
  cup_giant_killer: '杯赛巨人杀手',
} as const;

const AWARD_LABELS = {
  mvp: '赛季金球',
  golden_boot: '金靴',
  best_defender: '最佳后卫',
  best_goalkeeper: '最佳门将',
  young_player: '最佳新星',
} as const;

const TROPHY_LABELS = {
  league1: '顶级联赛',
  league2: '甲级联赛',
  league3: '乙级联赛',
  league_cup: '联赛杯',
  super_cup: '超级杯',
  world_cup: '环球冠军杯',
  mainland_cup: '大陆杯',
  southern_cup: '南洲杯',
  eastern_cup: '东洲杯',
} as const;

function activePlayer(world: GameWorld, playerId: string): Player | null {
  for (const squad of Object.values(world.squads)) {
    const player = squad.find(item => item.uuid === playerId);
    if (player) return player;
  }
  return null;
}

function selectEntries(entries: NarrativeThreadEntry[]): NarrativeThreadEntry[] {
  const seen = new Set<string>();
  return entries
    .sort((a, b) => b.order - a.order || a.id.localeCompare(b.id))
    .filter(entry => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .slice(0, MAX_NARRATIVE_THREAD_ENTRIES);
}

export function buildTeamNarrativeThread(world: GameWorld, teamId: string): NarrativeThread | null {
  const team = world.teamBases[teamId];
  if (!team) return null;
  const entries: NarrativeThreadEntry[] = [];

  for (const story of (world.activeStorylines ?? []).filter(item => item.teamId === teamId)) {
    const signal = describeStoryline(world, story);
    if (!signal) continue;
    entries.push({
      id: `active-story:${story.id}`,
      season: story.seasonNumber,
      order: story.seasonNumber * 10_000 + story.lastUpdatedWindow,
      title: `${signal.title} · ${signal.phase}`,
      detail: signal.body,
      tone: story.type === 'giant_crisis' ? 'fall' : story.phase === '高潮' ? 'stage' : 'rise',
      to: `/team/${teamId}`,
    });
  }
  for (const story of (world.storylineHistory ?? [])
    .filter(item => item.teamId === teamId && item.phase === '落幕')
    .slice(-3)) {
    entries.push({
      id: `resolved-story:${story.id}`,
      season: story.seasonNumber,
      order: story.seasonNumber * 10_000 + (story.endedWindow ?? story.lastUpdatedWindow),
      title: `${STORY_LABELS[story.type]} · ${story.outcome === 'success' ? '成章' : '定格'}`,
      detail: story.conclusion ?? story.evidence.join(' · '),
      tone: story.outcome === 'success' ? 'stage' : story.type === 'giant_crisis' ? 'fall' : 'neutral',
      summaryOnly: true,
    });
  }

  const latestHonor = [...world.honorHistory].sort((a, b) => b.seasonNumber - a.seasonNumber)[0];
  if (latestHonor) {
    for (const label of buildSeasonHistoryLabels(world, latestHonor.seasonNumber)
      .filter(item => item.teamId === teamId)) {
      entries.push({
        id: `history-label:${label.id}`,
        season: latestHonor.seasonNumber,
        order: latestHonor.seasonNumber * 10_000 + 9_999,
        title: label.title,
        detail: label.detail,
        tone: label.type === 'dynasty' ? 'stage' : label.type === 'promotion_run' ? 'rise' : 'fall',
        to: '/history',
        summaryOnly: true,
      });
    }
  }

  const trophies = [...(world.teamTrophies[teamId] ?? [])]
    .sort((a, b) => b.seasonNumber - a.seasonNumber || a.type.localeCompare(b.type));
  if (trophies.length > 0) {
    const latest = trophies[0];
    entries.push({
      id: `team-trophies:${teamId}:${latest.seasonNumber}:${latest.type}`,
      season: latest.seasonNumber,
      order: latest.seasonNumber * 10_000 + 9_997,
      title: `奖杯档案 · 队史${trophies.length}冠`,
      detail: `最近一冠为S${latest.seasonNumber}${TROPHY_LABELS[latest.type]}，完整归属仍以奖杯柜和赛季档案为准。`,
      tone: 'stage',
      to: '/history',
      summaryOnly: true,
    });
  }

  const latestRecord = [...(world.teamSeasonRecords[teamId] ?? [])]
    .sort((a, b) => b.seasonNumber - a.seasonNumber)[0];
  if (latestRecord && (latestRecord.promoted || latestRecord.relegated || latestRecord.leaguePosition === 1)) {
    const outcome = latestRecord.leaguePosition === 1
      ? '联赛夺冠'
      : latestRecord.promoted
        ? '完成升级'
        : '遭遇降级';
    entries.push({
      id: `season-record:${teamId}:${latestRecord.seasonNumber}`,
      season: latestRecord.seasonNumber,
      order: latestRecord.seasonNumber * 10_000 + 9_998,
      title: `S${latestRecord.seasonNumber} ${outcome}`,
      detail: `${latestRecord.leagueLevel}级联赛第${latestRecord.leaguePosition}名 · ${latestRecord.leaguePoints}分。`,
      tone: latestRecord.relegated ? 'fall' : latestRecord.leaguePosition === 1 ? 'stage' : 'rise',
      to: '/history',
      summaryOnly: true,
    });
  }

  const selected = selectEntries(entries);
  if (selected.length === 0) return null;
  const activeCount = selected.filter(entry => entry.id.startsWith('active-story:')).length;
  return {
    id: `team-thread:${teamId}`,
    title: '球队故事线',
    summary: activeCount > 0
      ? `${activeCount}条故事仍在推进，历史节点来自赛季档案。`
      : `${team.name}当前没有持续故事，最近结局仍保留在档案中。`,
    entries: selected,
  };
}

export function buildPlayerNarrativeThread(world: GameWorld, playerId: string): NarrativeThread | null {
  const player = activePlayer(world, playerId);
  const retired = (world.retirementHistory ?? []).find(item => item.uuid === playerId);
  if (!player && !retired) return null;
  const season = world.seasonState.seasonNumber;
  const name = player?.name ?? retired!.name;
  const entries: NarrativeThreadEntry[] = [];

  if (player) {
    const segments = Object.values(world.playerStatSegments ?? {}).filter(segment => segment.playerId === playerId);
    const performance = segments.length > 0
      ? computeSegmentedPlayerPerformance(player.position, segments, world.seasonStartLevels, world.playerStats[playerId])
      : computePlayerPerformance(player.position, world.playerStats[playerId], world.seasonStartLevels[player.teamId]);
    if (performance.metrics.minutes > 0) {
      entries.push({
        id: `current-performance:${season}:${playerId}`,
        season,
        order: season * 10_000 + world.seasonState.currentWindowIndex,
        title: `本季表现 ${performance.seasonScore.toFixed(1)}`,
        detail: `${performance.metrics.appearances}场 · ${performance.metrics.minutes}分钟 · 出勤${performance.availabilityScore.toFixed(0)} · 可信度${Math.round(performance.confidence * 100)}%。`,
        tone: performance.seasonScore >= 75 ? 'rise' : performance.seasonScore < 55 ? 'fall' : 'neutral',
      });
    }
    const injury = [...(player.injuryHistory ?? [])].sort((a, b) => b.startWindow - a.startWindow)[0];
    if (injury) {
      const active = (player.injuredUntilWindow ?? 0) > (world.totalElapsedWindows ?? 0);
      entries.push({
        id: `injury:${playerId}:${injury.startWindow}`,
        season: injury.startSeason,
        order: injury.startSeason * 10_000 + injury.startWindow,
        title: active ? `当前伤停 · ${injury.reason}` : `伤病档案 · ${injury.reason}`,
        detail: `${injury.type} · 缺席${injury.durationMatches}个比赛窗口${active ? ` · 至全局窗口${player.injuredUntilWindow}` : ''}。`,
        tone: active ? 'fall' : 'neutral',
        summaryOnly: !active,
      });
    }
  }

  const bestSeason = [...(world.playerStatsHistory[playerId] ?? [])]
    .filter(row => row.seasonScore !== undefined)
    .sort((a, b) => (b.seasonScore ?? 0) - (a.seasonScore ?? 0) || b.season - a.season)[0];
  if (bestSeason) {
    entries.push({
      id: `best-season:${playerId}:${bestSeason.season}`,
      season: bestSeason.season,
      order: bestSeason.season * 10_000 + 9_995,
      title: `最佳赛季 · ${bestSeason.seasonScore!.toFixed(1)}`,
      detail: `${bestSeason.teamName ?? bestSeason.teamId} · ${bestSeason.appearances}场 · ${bestSeason.goals}球 · ${bestSeason.assists}助攻。`,
      tone: 'stage',
      summaryOnly: true,
    });
  }
  for (const award of (world.playerAwardsHistory ?? [])
    .filter(item => item.playerId === playerId)
    .sort((a, b) => b.season - a.season)
    .slice(0, 2)) {
    entries.push({
      id: `award:${playerId}:${award.season}:${award.type}`,
      season: award.season,
      order: award.season * 10_000 + 9_999,
      title: `个人荣誉 · ${award.statLabel}`,
      detail: `${award.teamName}时期获得${AWARD_LABELS[award.type]}。`,
      tone: 'stage',
      to: '/history',
      summaryOnly: true,
    });
  }
  for (const transfer of (world.transferHistory ?? [])
    .filter(item => item.playerId === playerId)
    .sort((a, b) => b.season - a.season || b.windowIndex - a.windowIndex)
    .slice(0, 2)) {
    entries.push({
      id: `transfer:${playerId}:${transfer.season}:${transfer.windowIndex}:${transfer.toTeamId}`,
      season: transfer.season,
      order: transfer.season * 10_000 + transfer.windowIndex,
      title: `转至${transfer.toTeamName}`,
      detail: `${transfer.fromTeamName} → ${transfer.toTeamName}${transfer.fee ? ` · €${transfer.fee}M` : ''} · ${transfer.reason}。`,
      tone: 'transfer',
      to: `/team/${transfer.toTeamId}`,
      summaryOnly: true,
    });
  }
  if (retired) {
    entries.push({
      id: `retirement:${playerId}:${retired.seasonRetired}`,
      season: retired.seasonRetired,
      order: retired.seasonRetired * 10_000 + 9_999,
      title: `S${retired.seasonRetired} 退役`,
      detail: `${retired.age}岁结束生涯 · ${retired.careerGoals}粒生涯进球 · 最后效力${retired.teamName}。`,
      tone: 'neutral',
      to: '/legends',
      summaryOnly: true,
    });
  }

  const selected = selectEntries(entries);
  if (selected.length === 0) return null;
  return {
    id: `player-thread:${playerId}`,
    title: '球员档案线',
    summary: player ? `${name}的当前表现与生涯关键节点。` : `${name}的退役档案与可追溯生涯节点。`,
    entries: selected,
  };
}

export function buildCoachNarrativeThread(world: GameWorld, coachId: string): NarrativeThread | null {
  const coach = world.coachBases[coachId];
  const state = world.coachStates[coachId];
  if (!coach || !state) return null;
  const season = world.seasonState.seasonNumber;
  const entries: NarrativeThreadEntry[] = [];
  const teamId = state.currentTeamId;
  if (teamId) {
    const team = world.teamBases[teamId];
    const pressure = world.teamStates[teamId]?.coachPressure ?? 0;
    entries.push({
      id: `current-role:${coachId}:${teamId}:${season}`,
      season,
      order: season * 10_000 + world.seasonState.currentWindowIndex,
      title: `现任${team?.shortName ?? teamId}主帅`,
      detail: `教练压力${pressure}/100 · 合同${state.contractEnd ? `至S${state.contractEnd}` : '未记录固定终点'}。`,
      tone: pressure >= 65 ? 'fall' : pressure <= 25 ? 'rise' : 'neutral',
      to: `/team/${teamId}`,
    });
    const turnaround = getCoachTurnaroundSample(world, teamId, coachId);
    if (turnaround) {
      entries.push({
        id: `turnaround:${coachId}:${teamId}:${season}`,
        season,
        order: season * 10_000 + turnaround.changeWindowIndex + 1,
        title: '换帅后的第一段回应',
        detail: `上任前3场${turnaround.beforePoints}分，上任后3场${turnaround.afterPoints}分；这是已完成比赛样本，不代表长期走势。`,
        tone: 'rise',
        to: `/team/${teamId}`,
      });
    }
  }
  for (const entry of [...(world.coachCareers[coachId] ?? [])].reverse().slice(0, 3)) {
    entries.push({
      id: `career:${coachId}:${entry.teamId}:${entry.fromSeason}:${entry.toSeason ?? 'current'}`,
      season: entry.toSeason ?? season,
      order: (entry.toSeason ?? season) * 10_000 + (entry.toSeason === null ? world.seasonState.currentWindowIndex : 9_990),
      title: `${entry.teamName} · S${entry.fromSeason}${entry.toSeason ? `-S${entry.toSeason}` : '至今'}`,
      detail: `${entry.fired ? '以解雇结束任期' : entry.toSeason ? '完成这段任期' : '仍在执教'}${entry.trophies.length > 0 ? ` · 收获${entry.trophies.length}座奖杯` : ''}。`,
      tone: entry.fired ? 'fall' : entry.trophies.length > 0 ? 'stage' : 'neutral',
      to: `/team/${entry.teamId}`,
      summaryOnly: entry.toSeason !== null,
    });
  }
  const trophies = [...(world.coachTrophies[coachId] ?? [])]
    .sort((a, b) => b.seasonNumber - a.seasonNumber);
  if (trophies.length > 0) {
    const latest = trophies[0];
    entries.push({
      id: `coach-trophies:${coachId}:${latest.seasonNumber}`,
      season: latest.seasonNumber,
      order: latest.seasonNumber * 10_000 + 9_999,
      title: `奖杯档案 · 生涯${trophies.length}冠`,
      detail: `最近一冠记录于S${latest.seasonNumber}，全部奖杯仍可在教练详情中核对。`,
      tone: 'stage',
      summaryOnly: true,
    });
  }
  const retired = (world.coachRetirementHistory ?? []).find(item => item.id === coachId);
  if (retired) {
    entries.push({
      id: `coach-retirement:${coachId}:${retired.seasonRetired}`,
      season: retired.seasonRetired,
      order: retired.seasonRetired * 10_000 + 9_999,
      title: `S${retired.seasonRetired} 告别教练席`,
      detail: `${retired.age}岁退役 · 执教${retired.totalSeasons}季 · ${retired.trophies.length}座奖杯。`,
      tone: 'neutral',
      to: '/legends',
      summaryOnly: true,
    });
  }

  const selected = selectEntries(entries);
  if (selected.length === 0) return null;
  return {
    id: `coach-thread:${coachId}`,
    title: '教练生涯线',
    summary: state.retired
      ? `${coach.name}的完整任期与荣誉摘要。`
      : `${coach.name}当前处境与最近执教节点。`,
    entries: selected,
  };
}
