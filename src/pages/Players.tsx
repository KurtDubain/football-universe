import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import {
  getCareerTopAssistRows,
  getCareerTopScorerRows,
  getCurrentCreatorRows,
  getCurrentDefenderRows,
  getCurrentDisciplineRows,
  getCurrentGoalkeeperRows,
  getCurrentTopAssistRows,
  getCurrentTopScorerRows,
  type PlayerStatRow,
} from '../engine/players/player-stat-selectors';
import type { PlayerPosition } from '../types/player';
import { PageHeader, PageShell, Panel, SegmentedControl } from '../components/ui';

type Tab = 'scorers' | 'assists' | 'careerScorers' | 'careerAssists' | 'creation' | 'defense' | 'keepers' | 'discipline';

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
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('scorers');

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

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const seasonNumber = world.seasonState.seasonNumber;
  const hasCompletedMatches = world.seasonState.calendar.some((window) => window.completed);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'scorers', label: '射手榜' },
    { key: 'assists', label: '助攻榜' },
    { key: 'careerScorers', label: '生涯射手' },
    { key: 'careerAssists', label: '生涯助攻' },
    { key: 'creation', label: '创造力' },
    { key: 'defense', label: '防守榜' },
    { key: 'keepers', label: '门将榜' },
    { key: 'discipline', label: '纪律' },
  ];

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
              <span className="text-sm text-slate-300 group-hover:text-blue-300 truncate">
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
        {mode === 'discipline' ? (
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
              <span className="text-sm text-blue-300 font-semibold">{stat.cleanSheets}</span>
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-300">{stat.keyBlocks}</td>
            <td className="px-2 py-2 text-center text-sm text-slate-400 hidden sm:table-cell">
              {stat.appearances}/{stat.starts ?? 0}
            </td>
          </>
        ) : mode === 'keepers' ? (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-sm text-amber-300 font-semibold">{stat.cleanSheets}</span>
            </td>
            <td className="px-2 py-2 text-center text-sm text-slate-300">{stat.saves}</td>
            <td className="px-2 py-2 text-center text-sm text-slate-400 hidden sm:table-cell">
              {stat.appearances}/{stat.starts ?? 0}
            </td>
          </>
        ) : mode === 'creation' ? (
          <>
            <td className="px-2 py-2 text-center">
              <span className="text-sm text-emerald-300 font-semibold">{stat.keyPasses}</span>
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
    tab === 'scorers'
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

      {/* Tab bar */}
      <SegmentedControl
        value={tab}
        onChange={setTab}
        ariaLabel="球员榜单"
        options={tabs.map(t => ({ value: t.key, label: t.label }))}
        stretch
        scrollable
      />

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
                {tab === 'discipline' ? (
                  <>
                    <th className="px-2 py-2.5 text-center">黄牌</th>
                    <th className="px-2 py-2.5 text-center">红牌</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                      出场/首发
                    </th>
                  </>
                ) : tab === 'defense' ? (
                  <>
                    <th className="px-2 py-2.5 text-center" title="仅统计实际登场且球队整场（含加时）零失球的门将与后卫">零封</th>
                    <th className="px-2 py-2.5 text-center">关键封堵</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                      出场/首发
                    </th>
                  </>
                ) : tab === 'keepers' ? (
                  <>
                    <th className="px-2 py-2.5 text-center" title="仅统计实际登场且球队整场（含加时）零失球的门将与后卫">零封</th>
                    <th className="px-2 py-2.5 text-center">神扑</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                      出场/首发
                    </th>
                  </>
                ) : tab === 'creation' ? (
                  <>
                    <th className="px-2 py-2.5 text-center">威胁传球</th>
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
                        ? '本赛季尚无符合该榜单的数据'
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
