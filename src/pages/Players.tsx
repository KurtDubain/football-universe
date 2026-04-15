import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTopScorers, getTopAssists } from '../engine/players/stats';
import type { Player, PlayerPosition, PlayerSeasonStats } from '../types/player';

type Tab = 'scorers' | 'assists' | 'discipline';

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

function findPlayer(
  squads: Record<string, Player[]>,
  playerId: string,
): Player | undefined {
  // Player id format: "teamId-number" — split at last '-'
  const lastDash = playerId.lastIndexOf('-');
  if (lastDash === -1) return undefined;
  const teamId = playerId.substring(0, lastDash);
  const number = parseInt(playerId.substring(lastDash + 1), 10);
  const squad = squads[teamId];
  if (!squad) return undefined;
  return squad.find((p) => p.number === number);
}

export default function Players() {
  const world = useGameStore((s) => s.world);
  const [tab, setTab] = useState<Tab>('scorers');

  const topScorers = useMemo(
    () => (world ? getTopScorers(world.playerStats, 20) : []),
    [world],
  );
  const topAssists = useMemo(
    () => (world ? getTopAssists(world.playerStats, 20) : []),
    [world],
  );
  const topDiscipline = useMemo(() => {
    if (!world) return [];
    return Object.values(world.playerStats)
      .filter((s) => s.yellowCards + s.redCards > 0)
      .sort(
        (a, b) =>
          b.yellowCards + b.redCards - (a.yellowCards + a.redCards) ||
          b.redCards - a.redCards,
      )
      .slice(0, 20);
  }, [world]);

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const seasonNumber = world.seasonState.seasonNumber;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'scorers', label: '射手榜' },
    { key: 'assists', label: '助攻榜' },
    { key: 'discipline', label: '纪律' },
  ];

  const renderRow = (
    stat: PlayerSeasonStats,
    index: number,
    mode: Tab,
  ) => {
    const player = findPlayer(world.squads, stat.playerId);
    const teamBase = world.teamBases[stat.teamId];
    const rank = index + 1;

    return (
      <tr
        key={stat.playerId}
        className="border-t border-slate-700/40 hover:bg-slate-700/20 transition-colors"
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
        <td className="px-2 py-2 text-center text-sm text-slate-300 font-mono">
          {player ? `${player.number}号` : '-'}
        </td>

        {/* Team */}
        <td className="px-2 py-2">
          {teamBase ? (
            <Link
              to={`/team/${stat.teamId}`}
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
            <span className="text-sm text-slate-500">{stat.teamId}</span>
          )}
        </td>

        {/* Position */}
        <td className="px-2 py-2 text-center hidden sm:table-cell">
          {player ? (
            <span className={`text-xs font-medium ${positionColor[player.position]}`}>
              {positionLabel[player.position]}
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
              {stat.appearances}
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
              {stat.appearances}
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
        : topDiscipline;

  return (
    <div className="max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-100">
          球员中心
        </h2>
        <span className="text-xs text-slate-500">
          第 {seasonNumber} 赛季
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700/60">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer ${
              tab === t.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-700">
                <th className="px-2 sm:px-3 py-2.5 text-center w-10">#</th>
                <th className="px-2 py-2.5 text-center">号码</th>
                <th className="px-2 py-2.5 text-left">球队</th>
                <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                  位置
                </th>
                {tab === 'discipline' ? (
                  <>
                    <th className="px-2 py-2.5 text-center">黄牌</th>
                    <th className="px-2 py-2.5 text-center">红牌</th>
                    <th className="px-2 py-2.5 text-center hidden sm:table-cell">
                      出场
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
                      出场
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {currentData.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-sm text-slate-500"
                  >
                    暂无数据
                  </td>
                </tr>
              ) : (
                currentData.map((stat, i) => renderRow(stat, i, tab))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
