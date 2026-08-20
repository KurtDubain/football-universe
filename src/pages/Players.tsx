import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { useUiSessionState } from '../app/ui-session-state';
import {
  getCareerTopAssistRows,
  getCareerTopScorerRows,
  getCurrentOverallRows,
  getCurrentCreatorRows,
  getCurrentDefenderRows,
  getCurrentDisciplineRows,
  getCurrentGoalkeeperRows,
  getCurrentTopAssistRows,
  getCurrentTopScorerRows,
  getCurrentPlayerStatRow,
  getPlayerRowPerformance,
  type PlayerStatRow,
} from '../engine/players/player-stat-selectors';
import type { PlayerPosition } from '../types/player';
import { PLAYER_STAT_SCOPE_TOOLTIPS } from '../engine/players/player-performance';
import { PageHeader, PageShell, Panel, SegmentedControl } from '../components/ui';
import { Icon } from '../components/Icon';
import {
  buildRecentPlayerForm,
  FAVORITE_PLAYER_LIMIT,
  selectStarObservations,
  type StarObservationEntry,
} from '../engine/players/star-presence';

type Tab = 'overall' | 'scorers' | 'assists' | 'careerScorers' | 'careerAssists' | 'creation' | 'defense' | 'keepers' | 'discipline';
type RankingGroup = 'season' | 'position' | 'career';
type StarView = 'world' | 'rising' | 'following';

const positionLabel: Record<PlayerPosition, string> = {
  GK: '门将',
  DF: '后卫',
  MF: '中场',
  FW: '前锋',
};

const positionColor: Record<PlayerPosition, string> = {
  GK: 'text-amber-400',
  DF: 'text-blue-400',
  MF: 'text-green-400',
  FW: 'text-red-400',
};

const rankBadge = (rank: number) => {
  if (rank === 1) return 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40';
  if (rank === 2) return 'bg-slate-400/20 text-slate-300 ring-1 ring-slate-400/40';
  if (rank === 3) return 'bg-amber-700/20 text-amber-500 ring-1 ring-amber-700/40';
  return 'text-slate-500';
};

export default function Players() {
  const world = useGameStore((s) => s.world);
  const favoritePlayerIds = useGameStore((s) => s.favoritePlayerIds);
  const toggleFavoritePlayer = useGameStore((s) => s.toggleFavoritePlayer);
  const navigate = useNavigate();
  const [tab, setTab] = useUiSessionState<Tab>('ui.players.tab', 'overall');
  const [rankingGroup, setRankingGroup] = useUiSessionState<RankingGroup>('ui.players.ranking-group', 'season');
  const [starView, setStarView] = useUiSessionState<StarView>('ui.players.star-view', 'world');
  const [showAllFocus, setShowAllFocus] = useState(false);

  const topOverall = useMemo(
    () => (world ? getCurrentOverallRows(world, 30) : []),
    [world],
  );

  const topScorers = useMemo(
    () => (world ? getCurrentTopScorerRows(world, 20) : []),
    [world],
  );
  const topAssists = useMemo(
    () => (world ? getCurrentTopAssistRows(world, 20) : []),
    [world],
  );
  const careerScorers = useMemo(
    () => (world ? getCareerTopScorerRows(world, 20) : []),
    [world],
  );
  const careerAssists = useMemo(
    () => (world ? getCareerTopAssistRows(world, 20) : []),
    [world],
  );
  const topDiscipline = useMemo(() => {
    return world ? getCurrentDisciplineRows(world, 20) : [];
  }, [world]);
  const topCreators = useMemo(
    () => (world ? getCurrentCreatorRows(world, 20) : []),
    [world],
  );
  const topDefenders = useMemo(
    () => (world ? getCurrentDefenderRows(world, 20) : []),
    [world],
  );
  const topKeepers = useMemo(
    () => (world ? getCurrentGoalkeeperRows(world, 20) : []),
    [world],
  );

  const activePlayers = useMemo(
    () => Object.values(world?.squads ?? {}).flat(),
    [world?.squads],
  );
  const activePlayerMap = useMemo(
    () => new Map(activePlayers.map(player => [player.uuid, player])),
    [activePlayers],
  );
  const recentForms = useMemo(() => {
    if (!world) return new Map();
    const results = world.seasonState.calendar
      .filter(window => window.completed)
      .flatMap(window => window.results ?? []);
    return buildRecentPlayerForm(results, activePlayerMap);
  }, [world, activePlayerMap]);
  const starObservations = useMemo(() => {
    if (!world) return { worldFocus: [], risingStars: [] };
    return selectStarObservations(activePlayers, {
      playerStats: world.playerStats,
      playerStatSegments: world.playerStatSegments,
      seasonStartLevels: world.seasonStartLevels,
    }, recentForms);
  }, [world, activePlayers, recentForms]);

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const seasonNumber = world.seasonState.seasonNumber;
  const hasCompletedMatches = world.seasonState.calendar.some((window) => window.completed);

  const tabsByGroup: Record<RankingGroup, { key: Tab; label: string }[]> = {
    season: [
      { key: 'overall', label: '综合榜' },
      { key: 'scorers', label: '射手榜' },
      { key: 'assists', label: '助攻榜' },
      { key: 'discipline', label: '纪律' },
    ],
    position: [
      { key: 'creation', label: '创造力' },
      { key: 'defense', label: '防守榜' },
      { key: 'keepers', label: '门将榜' },
    ],
    career: [
      { key: 'careerScorers', label: '生涯射手' },
      { key: 'careerAssists', label: '生涯助攻' },
    ],
  };
  const tabs = tabsByGroup[rankingGroup];

  const followedActive = favoritePlayerIds
    .map(playerId => activePlayerMap.get(playerId))
    .filter((player): player is NonNullable<typeof player> => Boolean(player));
  const followedRetired = favoritePlayerIds
    .map(playerId => world.retirementHistory.find(player => player.uuid === playerId))
    .filter((player): player is NonNullable<typeof player> => Boolean(player));
  const selectedStarEntries = starView === 'world'
    ? starObservations.worldFocus
    : starView === 'rising'
      ? starObservations.risingStars
      : [];
  const visibleStarEntries = starView === 'world' && !showAllFocus
    ? selectedStarEntries.slice(0, 10)
    : selectedStarEntries;

  const renderStarEntry = (entry: StarObservationEntry) => {
    const { player } = entry;
    const team = world.teamBases[player.teamId];
    const followed = favoritePlayerIds.includes(player.uuid);
    const followLimitReached = !followed && favoritePlayerIds.length >= FAVORITE_PLAYER_LIMIT;
    const unavailableLabel = (player.injuredUntilWindow ?? 0) > world.totalElapsedWindows
      ? '伤停中'
      : (player.suspendedUntilWindow ?? 0) > world.totalElapsedWindows
        ? '停赛中'
        : null;
    const reasonLabel = entry.reason === 'defensive_anchor' ? '防线核心'
      : entry.reason === 'creator' ? '创造核心'
        : entry.reason === 'finisher' ? '终结核心'
          : entry.reason === 'form' ? '状态焦点'
            : '能力焦点';
    return (
      <div key={player.uuid} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-700/45 px-3 py-2 first:border-t-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.7fr)_auto]">
        <Link to={`/player/${player.uuid}`} className="min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">
          <span className="flex min-w-0 items-center gap-2">
            <span className={`text-xs font-semibold ${positionColor[player.position]}`}>{player.position}</span>
            <span className="truncate text-sm font-semibold text-slate-100">{player.name}</span>
            <span className="shrink-0 text-xs font-bold text-amber-300">{player.rating}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {team?.shortName ?? player.teamId} · {player.age}岁 · {reasonLabel}{unavailableLabel ? ` · ${unavailableLabel}` : ''}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-500 sm:hidden">
            {unavailableLabel ? `${unavailableLabel} · ` : ''}
            {entry.seasonScore != null ? `本季 ${entry.seasonScore.toFixed(1)} · ` : ''}
            {entry.recentForm?.summaries[0] ?? '近期暂无出场'}
          </span>
        </Link>
        <div className="hidden min-w-0 sm:block">
          <span className="block text-xs text-slate-300">
            {entry.seasonScore != null ? `赛季 ${entry.seasonScore.toFixed(1)}` : '赛季待观察'}
          </span>
          <span className="block truncate text-[11px] text-slate-500">
            {entry.recentForm?.summaries[0] ?? '近期暂无出场'}
          </span>
        </div>
        <button
          type="button"
          data-ui-feedback={followed ? 'toggle_off' : 'toggle_on'}
          onClick={() => toggleFavoritePlayer(player.uuid)}
          disabled={followLimitReached}
          aria-label={followed ? `取消关注 ${player.name}` : `关注 ${player.name}`}
          title={followLimitReached ? `最多关注 ${FAVORITE_PLAYER_LIMIT} 名球员` : followed ? '取消关注' : '关注球员'}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-md border transition-colors ${followed ? 'border-amber-500/50 bg-amber-500/12 text-amber-300' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-200'} disabled:cursor-not-allowed disabled:opacity-35`}
        >
          <Icon name="star" size={17} />
        </button>
      </div>
    );
  };

  const renderRow = (
    stat: PlayerStatRow,
    index: number,
    mode: Tab,
  ) => {
    const identity = stat.identity;
    const teamBase = world.teamBases[identity.teamId];
    const rank = index + 1;
    const playerNumber = identity.playerNumber;
    const playerName = identity.playerName;
    const position = identity.position;
    const performance = position ? getPlayerRowPerformance(world, stat) : null;
    const sourceLabel =
      identity.source === 'retired' ? '退役'
      : identity.source === 'history' ? '历史'
      : identity.source === 'stat' ? '档案'
      : null;
    const hasDetailPage = identity.source !== 'history' && identity.source !== 'stat';

    return (
      <tr
        key={stat.playerId}
        data-testid={hasDetailPage ? 'player-directory-row' : undefined}
        tabIndex={hasDetailPage ? 0 : undefined}
        aria-label={hasDetailPage ? `查看球员 ${playerName ?? stat.playerId}` : undefined}
        onClick={hasDetailPage ? () => navigate(`/player/${stat.playerId}`) : undefined}
        onKeyDown={hasDetailPage ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigate(`/player/${stat.playerId}`);
          }
        } : undefined}
        className={`border-t border-slate-700/40 hover:bg-slate-700/20 transition-colors ${hasDetailPage ? 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)]' : ''}`}
      >
        {/* Rank */}
        <td className="px-2 sm:px-3 py-2 text-center">
          <span
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${rankBadge(rank)}`}
          >
            {rank}
          </span>
        </td>

        {/* Number */}
        <td className="px-2 py-2 text-center text-sm text-slate-300 font-mono hidden sm:table-cell">
          {playerNumber !== undefined ? `${playerNumber}号` : '-'}
        </td>

        {/* Name */}
        <td className="px-2 py-2">
          {playerName ? (
            <>
              <span className={`block text-sm ${hasDetailPage ? 'text-slate-200' : 'text-slate-300'}`}>{playerName}</span>
              {sourceLabel && (
                <span className="mt-0.5 inline-block rounded bg-slate-700/60 px-1 py-0.5 text-[11px] text-slate-500">
                  {sourceLabel}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-slate-500">-</span>
          )}
        </td>

        {/* Team */}
        <td className="px-2 py-2">
          {teamBase ? (
            <Link
              to={`/team/${stat.teamId}`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className="flex items-center gap-1.5 hover:text-blue-300 transition-colors group"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: teamBase.color }}
              />
              <span className="text-sm text-slate-300 group-hover:text-blue-300 truncate" title={teamBase.name}>
                {teamBase.shortName}
              </span>
            </Link>
          ) : (
            <span className="text-sm text-slate-500">{identity.teamName}</span>
          )}
        </td>

        {/* Position */}
        <td className="px-2 py-2 text-center hidden sm:table-cell">
          {position ? (
            <span className={`text-xs font-medium ${positionColor[position]}`}>
              {positionLabel[position]}
            </span>
          ) : (
            <span className="text-xs text-slate-500">-</span>
          )}
        </td>

        {/* Stats columns depend on mode */}
        {mode === 'overall' ? (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-base text-amber-300 font-black">{performance?.seasonScore.toFixed(1)}</span>
              <span className="block text-[10px] text-slate-500">
                {performance?.grade} · {performance?.confidenceLabel === 'high' ? '高可信' : performance?.confidenceLabel === 'medium' ? '中可信' : '低可信'}
              </span>
            </td>
            <td className="px-2 py-2 text-center text-xs text-slate-300">
              {(performance?.positionQuality ?? 0).toFixed(0)} / {(performance?.availabilityScore ?? 0).toFixed(0)}
            </td>
            <td className="px-2 py-2 text-center text-xs text-slate-400 hidden sm:table-cell">
              <span className="block">{stat.appearances}/{performance?.metrics.teamMatchesAllCompetitions ?? stat.appearances} · {performance?.metrics.minutes ?? 0}分</span>
              <span className="block text-[10px] text-slate-500">{world.seasonStartLevels?.[stat.teamId] ?? 1}级联赛</span>
            </td>
          </>
        ) : mode === 'discipline' ? (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-sm text-yellow-400 font-semibold">
                {stat.yellowCards}
              </span>
            </td>
            <td className="px-2 py-2 text-center">
              <span
                className={`text-sm font-semibold ${stat.redCards > 0 ? 'text-red-400' : 'text-slate-500'}`}
              >
                {stat.redCards}
              </span>
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-400 hidden sm:table-cell">
              {stat.appearances}/{stat.starts ?? 0}
            </td>
          </>
        ) : mode === 'defense' ? (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-sm text-blue-300 font-semibold">{performance?.positionQuality.toFixed(1)}</span>
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-300">{stat.interceptions ?? 0}/{stat.clearances ?? 0}</td>
            <td className="px-2 py-2 text-center text-sm text-slate-400 hidden sm:table-cell">
              {stat.keyBlocks}/{performance?.metrics.goalsConcededPer90.toFixed(2)}
            </td>
          </>
        ) : mode === 'keepers' ? (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-sm text-amber-300 font-semibold">{performance?.positionQuality.toFixed(1)}</span>
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-300">{stat.routineSaves ?? 0}/{stat.saves}</td>
            <td className="px-2 py-2 text-center text-sm text-slate-400 hidden sm:table-cell">
              {((performance?.metrics.savePercentage ?? 0) * 100).toFixed(1)}%/{performance?.metrics.goalsConcededPer90.toFixed(2)}
            </td>
          </>
        ) : mode === 'creation' ? (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-sm text-emerald-300 font-semibold">{Math.max(0, stat.keyPasses - stat.assists)}</span>
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-300">{stat.assists}</td>
            <td className="px-2 py-2 text-center text-sm text-slate-400 hidden sm:table-cell">
              {stat.goals + stat.assists}
            </td>
          </>
        ) : mode === 'careerScorers' || mode === 'careerAssists' ? (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-sm text-slate-100 font-bold">
                {mode === 'careerScorers' ? stat.goals : stat.assists}
              </span>
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-400">
              {mode === 'careerScorers' ? stat.assists : stat.goals}
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-400 hidden sm:table-cell">
              {stat.appearances}/{stat.starts ?? 0}
            </td>
          </>
        ) : (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-sm text-slate-100 font-bold">
                {mode === 'scorers' ? stat.goals : stat.assists}
              </span>
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-400">
              {mode === 'scorers' ? stat.assists : stat.goals}
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-400 hidden sm:table-cell">
              {stat.appearances}/{stat.starts ?? 0}
            </td>
          </>
        )}
      </tr>
    );
  };

  const currentData =
    tab === 'overall'
      ? topOverall
      : tab === 'scorers'
      ? topScorers
      : tab === 'assists'
        ? topAssists
        : tab === 'careerScorers'
          ? careerScorers
          : tab === 'careerAssists'
            ? careerAssists
            : tab === 'creation'
              ? topCreators
              : tab === 'defense'
                ? topDefenders
                : tab === 'keepers'
                  ? topKeepers
                  : topDiscipline;

  return (
    <PageShell width="standard" className="tabular-nums">
      <PageHeader
        title="球员中心"
        meta={tab === 'careerScorers' || tab === 'careerAssists'
          ? '生涯总计'
          : `第 ${seasonNumber} 赛季 · 当前赛季全赛事总计`}
      />

      <section aria-labelledby="star-observation-heading" className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="star-observation-heading" className="text-sm font-semibold text-slate-100">球星观察</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {starView === 'world'
                ? `${starObservations.worldFocus.length} 名世界焦点`
                : starView === 'rising'
                  ? `${starObservations.risingStars.length} 名 U23 新星`
                  : `${favoritePlayerIds.length}/${FAVORITE_PLAYER_LIMIT} 名关注`}
            </p>
          </div>
        </div>
        <SegmentedControl
          value={starView}
          onChange={setStarView}
          ariaLabel="球星观察范围"
          options={[
            { value: 'world', label: '世界焦点' },
            { value: 'rising', label: 'U23 新星' },
            { value: 'following', label: '我的关注' },
          ]}
          stretch
        />
        <Panel padded={false} className="overflow-hidden">
          {starView !== 'following' ? (
            visibleStarEntries.length > 0 ? visibleStarEntries.map(renderStarEntry) : (
              <div className="px-4 py-8 text-center text-sm text-slate-500">当前暂无符合资格的球员</div>
            )
          ) : followedActive.length > 0 || followedRetired.length > 0 ? (
            <>
              {followedActive.map(player => {
                const entry = [...starObservations.worldFocus, ...starObservations.risingStars]
                  .find(candidate => candidate.player.uuid === player.uuid) ?? (() => {
                    const row = getCurrentPlayerStatRow(world, player.uuid);
                    const performance = row ? getPlayerRowPerformance(world, row) : null;
                    return {
                      player,
                      seasonScore: performance?.eligible ? performance.seasonScore : null,
                      confidence: performance?.confidence ?? 0,
                      recentForm: recentForms.get(player.uuid) ?? null,
                      reason: player.position === 'GK' || player.position === 'DF' ? 'defensive_anchor' as const : 'ability' as const,
                      priority: 0,
                    };
                  })();
                return renderStarEntry(entry);
              })}
              {followedRetired.map(player => (
                <div key={player.uuid} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-700/45 px-3 py-2 first:border-t-0">
                  <Link to={`/player/${player.uuid}`} className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-300">{player.name}</span>
                    <span className="text-xs text-slate-500">已退役 · S{player.seasonRetired} · 巅峰 {player.peakRating}</span>
                  </Link>
                  <button type="button" data-ui-feedback="toggle_off" onClick={() => toggleFavoritePlayer(player.uuid)} aria-label={`取消关注 ${player.name}`} className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-amber-500/50 bg-amber-500/12 text-amber-300">
                    <Icon name="star" size={17} />
                  </button>
                </div>
              ))}
            </>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-500">尚未关注球员</div>
          )}
          {starView === 'world' && starObservations.worldFocus.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAllFocus(value => !value)}
              className="min-h-11 w-full border-t border-slate-700/50 px-3 text-sm font-medium text-blue-300 hover:bg-slate-800/70"
            >
              {showAllFocus ? '收起' : `查看全部 ${starObservations.worldFocus.length} 人`}
            </button>
          )}
        </Panel>
      </section>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <SegmentedControl
          value={rankingGroup}
          onChange={(group) => {
            setRankingGroup(group);
            setTab(tabsByGroup[group][0].key);
          }}
          ariaLabel="榜单分组"
          options={[
            { value: 'season', label: '本季' },
            { value: 'position', label: '位置' },
            { value: 'career', label: '生涯' },
          ]}
          stretch
        />
      <SegmentedControl
        value={tab}
        onChange={setTab}
        ariaLabel="球员榜单"
        options={tabs.map(t => ({ value: t.key, label: t.label }))}
        stretch
        scrollable
      />
      </div>

      {/* Table */}
      <Panel padded={false} className="overflow-hidden tabular-nums">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-700">
                <th className="px-1 sm:px-2 py-2 text-center w-10">#</th>
                <th className="px-2 py-2.5 text-center hidden sm:table-cell">号码</th>
                <th className="px-2 py-2.5 text-left">球员</th>
                <th className="px-2 py-2.5 text-left">球队</th>
                <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                  位置
                </th>
                {tab === 'overall' ? (
                  <>
                    <th className="px-2 py-2.5 text-center" title={PLAYER_STAT_SCOPE_TOOLTIPS.leagueContext}>综合评分</th>
                    <th className="px-2 py-2.5 text-center" title="固定位置标尺得分 / 当前赛季全赛事出勤可靠性">表现/出勤</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">出场/分钟 · 级别</th>
                  </>
                ) : tab === 'discipline' ? (
                  <>
                    <th className="px-2 py-2.5 text-center">黄牌</th>
                    <th className="px-2 py-2.5 text-center">红牌</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                      出场/首发
                    </th>
                  </>
                ) : tab === 'defense' ? (
                  <>
                    <th className="px-2 py-2.5 text-center" title={PLAYER_STAT_SCOPE_TOOLTIPS.leagueContext}>评分</th>
                    <th className="px-2 py-2.5 text-center" title="当前赛季全赛事拦截/解围">拦截/解围</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell" title="门线封堵/在场失球每90分钟">门线/失球90</th>
                  </>
                ) : tab === 'keepers' ? (
                  <>
                    <th className="px-2 py-2.5 text-center" title={PLAYER_STAT_SCOPE_TOOLTIPS.leagueContext}>评分</th>
                    <th className="px-2 py-2.5 text-center" title="普通扑救/关键扑救，两者不重复">扑救 普/关键</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell" title="扑救率/在场失球每90分钟">扑救率/失球90</th>
                  </>
                ) : tab === 'creation' ? (
                  <>
                    <th className="px-2 py-2.5 text-center" title="keyPasses 减去 assists，避免重复计算助攻">额外创造</th>
                    <th className="px-2 py-2.5 text-center">助攻</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                      传射
                    </th>
                  </>
                ) : tab === 'careerScorers' || tab === 'careerAssists' ? (
                  <>
                    <th className="px-2 py-2.5 text-center">
                      {tab === 'careerScorers' ? '生涯进球' : '生涯助攻'}
                    </th>
                    <th className="px-2 py-2.5 text-center">
                      {tab === 'careerScorers' ? '生涯助攻' : '生涯进球'}
                    </th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                      生涯出场/首发
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-2.5 text-center">
                      {tab === 'scorers' ? '进球' : '助攻'}
                    </th>
                    <th className="px-2 py-2.5 text-center">
                      {tab === 'scorers' ? '助攻' : '进球'}
                    </th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                      出场/首发
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {currentData.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-10 text-center text-sm text-slate-500"
                  >
                    {tab === 'careerScorers' || tab === 'careerAssists'
                      ? '暂无生涯数据'
                      : hasCompletedMatches
                        ? tab === 'defense' || tab === 'keepers'
                          ? '暂无具备实际出场分钟的球员'
                          : '本赛季尚无符合该榜单的数据'
                        : '赛季尚未开始，完成首场比赛后生成当前赛季数据'}
                  </td>
                </tr>
              ) : (
                currentData.map((stat, i) => renderRow(stat, i, tab))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </PageShell>
  );
}
