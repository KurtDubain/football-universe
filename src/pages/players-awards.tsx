import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel, SegmentedControl } from '../components/ui';
import { AWARD_META } from '../engine/awards/season-awards';
import type { GameWorld } from '../engine/season/season-manager';
import type { PlayerPosition } from '../types/player';
import {
  aggregateAwardLeaders,
  AWARD_SEASON_WINDOW_OPTIONS,
  AWARD_TYPE_FILTER_OPTIONS,
  describeAwardCounts,
  filterAwards,
  sortAwardRecords,
  type AwardFilters,
  type AwardSeasonWindow,
  type AwardTypeFilter,
  type AwardView,
} from './players-awards-model';

interface PlayersAwardsPanelProps {
  world: GameWorld;
  view: AwardView;
  onViewChange: (view: AwardView) => void;
  filters: AwardFilters;
  onFiltersChange: (filters: AwardFilters) => void;
}

const POSITION_LABELS: Record<PlayerPosition, string> = {
  GK: '门将',
  DF: '后卫',
  MF: '中场',
  FW: '前锋',
};

const POSITION_COLORS: Record<PlayerPosition, string> = {
  GK: 'text-amber-400',
  DF: 'text-blue-400',
  MF: 'text-green-400',
  FW: 'text-red-400',
};

const RECORD_PAGE_SIZE = 50;

const rankBadge = (rank: number) => {
  if (rank === 1) return 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40';
  if (rank === 2) return 'bg-slate-400/20 text-slate-300 ring-1 ring-slate-400/40';
  if (rank === 3) return 'bg-amber-700/20 text-amber-500 ring-1 ring-amber-700/40';
  return 'text-slate-500';
};

const selectClass =
  'min-h-9 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 focus:border-sky-600 focus:outline-none';

/**
 * 奖项 group of the player centre: a season-descending record feed and a
 * per-player win ranking, both driven by the same filtered award set.
 */
export default function PlayersAwardsPanel({
  world,
  view,
  onViewChange,
  filters,
  onFiltersChange,
}: PlayersAwardsPanelProps) {
  const [showAllRecords, setShowAllRecords] = useState(false);

  const positions = useMemo(() => {
    const map = new Map<string, PlayerPosition>();
    for (const squad of Object.values(world.squads ?? {})) {
      for (const player of squad ?? []) map.set(player.uuid, player.position);
    }
    for (const retired of world.retirementHistory ?? []) {
      if (!map.has(retired.uuid)) map.set(retired.uuid, retired.position);
    }
    return map;
  }, [world.squads, world.retirementHistory]);

  const teams = useMemo(
    () => Object.values(world.teamBases ?? {})
      .map((team) => ({ id: team.id, name: team.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
    [world.teamBases],
  );

  const filtered = useMemo(
    () => filterAwards(
      world.playerAwardsHistory ?? [],
      filters,
      world.seasonState.seasonNumber,
    ),
    [world.playerAwardsHistory, world.seasonState.seasonNumber, filters],
  );

  const records = useMemo(() => sortAwardRecords(filtered), [filtered]);
  const leaders = useMemo(() => aggregateAwardLeaders(filtered, positions), [filtered, positions]);
  const visibleRecords = showAllRecords ? records : records.slice(0, RECORD_PAGE_SIZE);

  return (
    <section aria-labelledby="player-awards-heading" className="space-y-2">
      <div>
        <h2 id="player-awards-heading" className="text-sm font-semibold text-slate-100">奖项</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {view === 'records'
            ? `${records.length} 条获奖记录 · 档案仅保留最近 50 季`
            : `${leaders.length} 名球员获奖`}
        </p>
      </div>

      <SegmentedControl
        value={view}
        onChange={onViewChange}
        ariaLabel="奖项视图"
        options={[
          { value: 'records', label: '获奖记录' },
          { value: 'leaders', label: '得奖排行' },
        ]}
        stretch
      />

      <div className="flex flex-wrap gap-2">
        <select
          aria-label="奖项类型"
          value={filters.type}
          onChange={(event) => onFiltersChange({ ...filters, type: event.target.value as AwardTypeFilter })}
          className={selectClass}
        >
          {AWARD_TYPE_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          aria-label="赛季范围"
          value={filters.seasons}
          onChange={(event) => onFiltersChange({ ...filters, seasons: event.target.value as AwardSeasonWindow })}
          className={selectClass}
        >
          {AWARD_SEASON_WINDOW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          aria-label="球队"
          value={filters.teamId}
          onChange={(event) => onFiltersChange({ ...filters, teamId: event.target.value })}
          className={selectClass}
        >
          <option value="all">全部球队</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
      </div>

      <Panel padded={false} className="overflow-hidden">
        {view === 'records' ? (
          records.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">当前筛选条件下暂无获奖记录</div>
          ) : (
            <>
              {visibleRecords.map((award) => {
                const meta = AWARD_META[award.type];
                return (
                  <div
                    key={`${award.season}:${award.type}:${award.playerId}`}
                    className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2 border-t border-slate-700/45 px-3 py-2 first:border-t-0 sm:grid-cols-[3.25rem_minmax(0,1.1fr)_minmax(0,1fr)_auto]"
                  >
                    <span className="text-xs font-semibold tabular-nums text-slate-400">S{award.season}</span>
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-semibold ${meta.color}`}>
                        <span aria-hidden="true">{meta.emoji}</span> {meta.label}
                      </span>
                      <Link
                        to={`/player/${award.playerId}`}
                        className="block truncate text-xs text-slate-300 hover:text-blue-300"
                      >
                        {award.playerName}
                      </Link>
                    </span>
                    <span className="hidden min-w-0 truncate text-xs text-slate-400 sm:block">{award.teamName}</span>
                    <span className="hidden text-right text-xs tabular-nums text-slate-300 sm:block">
                      {award.statLabel}
                      {award.statValue ? ` · ${award.statValue}` : ''}
                    </span>
                  </div>
                );
              })}
              {records.length > RECORD_PAGE_SIZE && (
                <button
                  type="button"
                  onClick={() => setShowAllRecords((value) => !value)}
                  className="min-h-11 w-full border-t border-slate-700/50 px-3 text-sm font-medium text-blue-300 hover:bg-slate-800/70"
                >
                  {showAllRecords ? '收起' : `查看全部 ${records.length} 条`}
                </button>
              )}
            </>
          )
        ) : leaders.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">当前筛选条件下暂无获奖球员</div>
        ) : (
          leaders.map((leader, index) => {
            const position = leader.position;
            return (
              <div
                key={leader.playerId}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-700/45 px-3 py-2 first:border-t-0 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.1fr)_auto]"
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${rankBadge(index + 1)}`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {position && (
                      <span className={`shrink-0 text-xs font-semibold ${POSITION_COLORS[position]}`}>
                        {POSITION_LABELS[position]}
                      </span>
                    )}
                    <Link
                      to={`/player/${leader.playerId}`}
                      className="truncate text-sm font-semibold text-slate-100 hover:text-blue-300"
                    >
                      {leader.playerName}
                    </Link>
                  </span>
                  <span className="block truncate text-xs text-slate-500 sm:hidden">
                    {describeAwardCounts(leader.counts)}
                  </span>
                </span>
                <span className="hidden min-w-0 truncate text-xs text-slate-400 sm:block">
                  {describeAwardCounts(leader.counts)}
                </span>
                <span className="text-right">
                  <span className="block text-sm font-bold text-amber-300 tabular-nums">{leader.total}</span>
                  <span className="block max-w-28 truncate text-[11px] text-slate-500">{leader.teamName}</span>
                </span>
              </div>
            );
          })
        )}
      </Panel>
    </section>
  );
}
