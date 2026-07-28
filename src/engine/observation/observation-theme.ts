import type { StandingEntry } from '../../types/league';
import type { Player, PlayerSeasonStats } from '../../types/player';
import type { GameWorld } from '../season/season-manager';
import {
  describeStoryline,
  detectStorylineSignals,
  expectedStoryPosition,
} from '../season/storylines';

export type ObservationThemeType =
  | 'giant_defense'
  | 'dark_horse_challenge'
  | 'promotion_survival'
  | 'player_growth'
  | 'pure_observation';

export type ObservationThemePreference = 'auto' | 'disabled' | ObservationThemeType;

export interface ObservationTheme {
  type: ObservationThemeType;
  label: string;
  title: string;
  summary: string;
  evidence: string[];
  nextWatch: string;
  seasonPhase: '序章' | '开局' | '中段' | '冲刺' | '收官';
  played: number;
  totalMatches: number;
  progress: number;
  teamId?: string;
  playerId?: string;
}

export const OBSERVATION_THEME_OPTIONS: ReadonlyArray<{
  value: ObservationThemePreference;
  label: string;
}> = [
  { value: 'auto', label: '自动推荐' },
  { value: 'giant_defense', label: '豪门守成' },
  { value: 'dark_horse_challenge', label: '黑马挑战' },
  { value: 'promotion_survival', label: '升级 / 保级' },
  { value: 'player_growth', label: '球员成长' },
  { value: 'pure_observation', label: '纯观察' },
  { value: 'disabled', label: '关闭主题' },
];

const THEME_LABELS: Record<ObservationThemeType, string> = {
  giant_defense: '豪门守成',
  dark_horse_challenge: '黑马挑战',
  promotion_survival: '升级 / 保级',
  player_growth: '球员成长',
  pure_observation: '纯观察',
};

interface TeamSituation {
  teamId: string;
  standings: StandingEntry[];
  row: StandingEntry;
  rank: number;
  totalMatches: number;
}

function standingsForTeam(world: GameWorld, teamId: string): StandingEntry[] | null {
  return [
    world.league1Standings,
    world.league2Standings,
    world.league3Standings,
  ].find(standings => standings.some(row => row.teamId === teamId)) ?? null;
}

function teamSituation(world: GameWorld, teamId: string): TeamSituation | null {
  const standings = standingsForTeam(world, teamId);
  if (!standings) return null;
  const rank = standings.findIndex(row => row.teamId === teamId) + 1;
  const row = standings[rank - 1];
  if (!row) return null;
  return {
    teamId,
    standings,
    row,
    rank,
    totalMatches: Math.max(1, (standings.length - 1) * 2),
  };
}

function seasonProgress(
  played: number,
  totalMatches: number,
): Pick<ObservationTheme, 'seasonPhase' | 'played' | 'totalMatches' | 'progress'> {
  const progress = Math.max(0, Math.min(1, played / Math.max(1, totalMatches)));
  const seasonPhase = played === 0
    ? '序章'
    : progress < 0.25
      ? '开局'
      : progress < 0.6
        ? '中段'
        : progress < 0.85
          ? '冲刺'
          : '收官';
  return { seasonPhase, played, totalMatches, progress };
}

function nextFixtureText(world: GameWorld, teamId: string): string | null {
  const windows = world.seasonState.calendar.slice(world.seasonState.currentWindowIndex);
  for (const window of windows) {
    const fixture = window.fixtures.find(
      item => item.homeTeamId === teamId || item.awayTeamId === teamId,
    );
    if (!fixture) continue;
    const opponentId = fixture.homeTeamId === teamId ? fixture.awayTeamId : fixture.homeTeamId;
    const opponent = world.teamBases[opponentId]?.shortName ?? opponentId;
    const venue = fixture.isNeutralVenue ? '中立场' : fixture.homeTeamId === teamId ? '主场' : '客场';
    return `${window.label}，${venue}对阵${opponent}`;
  }
  return null;
}

function prospectForTeam(world: GameWorld, teamId: string): Player | null {
  const squad = world.squads[teamId] ?? [];
  const prospects = squad.filter(player => player.age <= 23);
  const pool = prospects.length > 0 ? prospects : squad;
  return [...pool].sort((a, b) => {
    const aScore = a.rating * 4 + Math.max(0, a.peakRating - a.rating) + Math.max(0, 24 - a.age);
    const bScore = b.rating * 4 + Math.max(0, b.peakRating - b.rating) + Math.max(0, 24 - b.age);
    return bScore - aScore || b.peakRating - a.peakRating || a.uuid.localeCompare(b.uuid);
  })[0] ?? null;
}

function statsEvidence(stats: PlayerSeasonStats | undefined): string {
  if (!stats || stats.appearances === 0) return '本季等待首次出场';
  return `${stats.appearances}场 ${stats.goals}球 ${stats.assists}助`;
}

export function recommendObservationTheme(
  world: GameWorld,
  primaryTeamId: string | null,
): ObservationThemeType {
  if (!primaryTeamId) return 'pure_observation';
  const team = world.teamBases[primaryTeamId];
  const state = world.teamStates[primaryTeamId];
  if (!team || !state) return 'pure_observation';

  const previous = world.teamSeasonRecords[primaryTeamId]?.at(-1);
  if (previous?.seasonNumber === world.seasonState.seasonNumber - 1 && previous.promoted) {
    return 'promotion_survival';
  }
  if (team.tier === 'elite' || team.expectation >= 4) return 'giant_defense';
  if (team.tier === 'underdog' || team.expectation <= 2) return 'promotion_survival';
  const prospect = prospectForTeam(world, primaryTeamId);
  if (prospect && prospect.peakRating - prospect.rating >= 5) {
    return 'player_growth';
  }
  return 'dark_horse_challenge';
}

function giantTheme(world: GameWorld, situation: TeamSituation): ObservationTheme {
  const team = world.teamBases[situation.teamId];
  const expected = expectedStoryPosition(situation.standings.length, team.expectation);
  const leader = situation.standings[0];
  const gap = Math.max(0, leader.points - situation.row.points);
  return {
    type: 'giant_defense',
    label: THEME_LABELS.giant_defense,
    title: `${team.name}能否守住上位区`,
    summary: situation.rank <= expected
      ? `当前排名达到赛前第${expected}左右的预期，接下来要观察优势能否延续。`
      : `当前落后赛前第${expected}左右的预期${situation.rank - expected}位，赛季正在出现偏差。`,
    evidence: [
      `联赛第${situation.rank}/${situation.standings.length}`,
      `${situation.row.played}场 ${situation.row.points}分`,
      situation.rank === 1 ? '当前领跑' : `距榜首${gap}分`,
    ],
    nextWatch: nextFixtureText(world, situation.teamId) ?? '等待下一项正式赛程',
    teamId: situation.teamId,
    ...seasonProgress(situation.row.played, situation.totalMatches),
  };
}

function darkHorseTheme(world: GameWorld, situation: TeamSituation): ObservationTheme {
  const team = world.teamBases[situation.teamId];
  const expected = expectedStoryPosition(situation.standings.length, team.expectation);
  const delta = expected - situation.rank;
  return {
    type: 'dark_horse_challenge',
    label: THEME_LABELS.dark_horse_challenge,
    title: `${team.name}挑战既有秩序`,
    summary: delta > 0
      ? `目前比赛前第${expected}左右的预期高出${delta}位，黑马轮廓正在形成。`
      : delta === 0
        ? `目前与赛前第${expected}左右的预期一致，突破仍需要新的关键结果。`
        : `目前比赛前预期低${Math.abs(delta)}位，挑战尚未真正启动。`,
    evidence: [
      `预期约第${expected}`,
      `当前第${situation.rank}/${situation.standings.length}`,
      `${situation.row.played}场 ${situation.row.points}分`,
    ],
    nextWatch: nextFixtureText(world, situation.teamId) ?? '等待下一项正式赛程',
    teamId: situation.teamId,
    ...seasonProgress(situation.row.played, situation.totalMatches),
  };
}

function promotionSurvivalTheme(world: GameWorld, situation: TeamSituation): ObservationTheme {
  const team = world.teamBases[situation.teamId];
  const level = world.teamStates[situation.teamId]?.leagueLevel ?? 1;
  if (level === 1) {
    const firstRelegationIndex = Math.max(0, situation.standings.length - 3);
    const firstRelegation = situation.standings[firstRelegationIndex];
    const lastSafe = situation.standings[Math.max(0, firstRelegationIndex - 1)];
    const safe = situation.rank <= firstRelegationIndex;
    const gap = safe
      ? Math.max(0, situation.row.points - (firstRelegation?.points ?? situation.row.points))
      : Math.max(0, (lastSafe?.points ?? situation.row.points) - situation.row.points);
    return {
      type: 'promotion_survival',
      label: THEME_LABELS.promotion_survival,
      title: `${team.name}的顶级联赛生存线`,
      summary: safe ? `球队目前位于安全区，领先降级线${gap}分。` : `球队目前处于降级区，距离安全线${gap}分。`,
      evidence: [
        `联赛第${situation.rank}/${situation.standings.length}`,
        safe ? `高出降级线${gap}分` : `距安全线${gap}分`,
        `${situation.row.played}场 ${situation.row.points}分`,
      ],
      nextWatch: nextFixtureText(world, situation.teamId) ?? '等待下一项正式赛程',
      teamId: situation.teamId,
      ...seasonProgress(situation.row.played, situation.totalMatches),
    };
  }

  const promotionLine = situation.standings[Math.min(1, situation.standings.length - 1)];
  const inPromotionPlaces = situation.rank <= 2;
  const gap = inPromotionPlaces
    ? Math.max(0, situation.row.points - (situation.standings[2]?.points ?? situation.row.points))
    : Math.max(0, (promotionLine?.points ?? situation.row.points) - situation.row.points);
  return {
    type: 'promotion_survival',
    label: THEME_LABELS.promotion_survival,
    title: `${team.name}的升级路线`,
    summary: inPromotionPlaces ? `球队目前处于直升区，领先区外${gap}分。` : `球队目前距离直升区${gap}分。`,
    evidence: [
      `第${level}级联赛第${situation.rank}`,
      inPromotionPlaces ? `直升区内${gap}分` : `距直升区${gap}分`,
      `${situation.row.played}场 ${situation.row.points}分`,
    ],
    nextWatch: nextFixtureText(world, situation.teamId) ?? '等待下一项正式赛程',
    teamId: situation.teamId,
    ...seasonProgress(situation.row.played, situation.totalMatches),
  };
}

function playerGrowthTheme(world: GameWorld, situation: TeamSituation): ObservationTheme {
  const team = world.teamBases[situation.teamId];
  const player = prospectForTeam(world, situation.teamId);
  if (!player) return darkHorseTheme(world, situation);
  const stats = world.playerStats[player.uuid];
  return {
    type: 'player_growth',
    label: THEME_LABELS.player_growth,
    title: `观察${player.name}的成长赛季`,
    summary: `${player.age}岁的${player.position}当前评分${player.rating}，潜力上限${player.peakRating}；主题只追踪真实出场与赛季数据。`,
    evidence: [
      `${team.shortName} · ${player.position}`,
      `评分 ${player.rating}/${player.peakRating}`,
      statsEvidence(stats),
    ],
    nextWatch: stats?.appearances
      ? `下一次出场能否继续增加贡献`
      : `等待本赛季首次出场`,
    teamId: situation.teamId,
    playerId: player.uuid,
    ...seasonProgress(situation.row.played, situation.totalMatches),
  };
}

function pureObservationTheme(world: GameWorld): ObservationTheme {
  const activeSignals = (world.activeStorylines ?? [])
    .map(storyline => describeStoryline(world, storyline))
    .filter((signal): signal is NonNullable<typeof signal> => Boolean(signal));
  const signal = [...activeSignals, ...detectStorylineSignals(world)]
    .sort((a, b) => b.priority - a.priority || a.teamId.localeCompare(b.teamId))[0];
  const table = world.league1Standings;
  const played = Math.max(0, ...table.map(row => row.played));
  const totalMatches = Math.max(1, (table.length - 1) * 2);
  if (signal) {
    return {
      type: 'pure_observation',
      label: THEME_LABELS.pure_observation,
      title: signal.title,
      summary: signal.body,
      evidence: signal.evidence,
      nextWatch: signal.nextWatch,
      teamId: signal.teamId,
      ...seasonProgress(played, totalMatches),
    };
  }

  const leader = table[0];
  const runnerUp = table[1];
  const leaderName = leader ? world.teamBases[leader.teamId]?.name ?? leader.teamId : '顶级联赛';
  const gap = leader && runnerUp ? Math.max(0, leader.points - runnerUp.points) : 0;
  return {
    type: 'pure_observation',
    label: THEME_LABELS.pure_observation,
    title: played === 0 ? '等待世界建立第一条线索' : `${leaderName}暂居世界中心`,
    summary: played === 0
      ? '首轮之后，积分榜、球员贡献与故事信号会自然形成观察方向。'
      : `顶级联赛已经进行${played}轮，榜首与次席相差${gap}分。`,
    evidence: played === 0
      ? ['尚未开赛', '不绑定单一球队', '结果由统一模拟产生']
      : [`顶级联赛第${played}轮`, `榜首 ${leader?.points ?? 0}分`, `领先次席${gap}分`],
    nextWatch: played === 0 ? '观察第一轮后出现的真实变化' : '观察榜首与正在升级的世界故事',
    teamId: leader?.teamId,
    ...seasonProgress(played, totalMatches),
  };
}

export function buildObservationTheme(
  world: GameWorld,
  primaryTeamId: string | null,
  preference: ObservationThemePreference,
): ObservationTheme | null {
  if (preference === 'disabled') return null;
  const type = preference === 'auto'
    ? recommendObservationTheme(world, primaryTeamId)
    : preference;
  if (type === 'pure_observation' || !primaryTeamId) return pureObservationTheme(world);

  const situation = teamSituation(world, primaryTeamId);
  if (!situation) return pureObservationTheme(world);
  if (type === 'giant_defense') return giantTheme(world, situation);
  if (type === 'dark_horse_challenge') return darkHorseTheme(world, situation);
  if (type === 'promotion_survival') return promotionSurvivalTheme(world, situation);
  return playerGrowthTheme(world, situation);
}
