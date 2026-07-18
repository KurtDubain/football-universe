import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import type { TransferRecord } from '../types/transfer';
import { EmptyState, PageHeader, PageShell, Panel, SectionHeader, SegmentedControl, StatusBadge } from '../components/ui';

const posLabel: Record<string, string> = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };
const posColor: Record<string, string> = {
  GK: 'text-amber-400 bg-amber-900/30',
  DF: 'text-blue-400 bg-blue-900/30',
  MF: 'text-green-400 bg-green-900/30',
  FW: 'text-red-400 bg-red-900/30',
};

/**
 * Detect "swap-back" legs: a `free` record paired with a `transfer` record in
 * the same (season, windowIndex) window where the two records move opposite
 * directions between the same pair of teams. The free leg is then a swap, not
 * a release. Returns the set of record indices (within `all`) that should be
 * rendered as swaps.
 */
function detectSwapIndices(all: TransferRecord[]): Set<number> {
  const swaps = new Set<number>();
  // Bucket transfer-type records by (season|windowIndex|fromTeamId|toTeamId)
  // for O(1) lookup of an inverse match for each `free` record.
  const transferKey = new Map<string, number[]>();
  all.forEach((r, idx) => {
    if (r.type !== 'transfer') return;
    const k = `${r.season}|${r.windowIndex}|${r.fromTeamId}|${r.toTeamId}`;
    if (!transferKey.has(k)) transferKey.set(k, []);
    transferKey.get(k)!.push(idx);
  });
  all.forEach((r, idx) => {
    if (r.type !== 'free') return;
    // Look for a transfer with reversed teams in the same window
    const inverseKey = `${r.season}|${r.windowIndex}|${r.toTeamId}|${r.fromTeamId}`;
    const matches = transferKey.get(inverseKey);
    if (matches && matches.length > 0) {
      swaps.add(idx);
      // Also flag the matched transfer leg so it visually pairs as a swap.
      swaps.add(matches[0]);
    }
  });
  return swaps;
}

export default function Transfers() {
  const world = useGameStore((s) => s.world);
  const [filter, setFilter] = useState<'all' | 'major'>('all');

  const transferData = useMemo(() => {
    if (!world) return { bySeasons: [] as { season: number; records: TransferRecord[]; swapIndices: Set<number> }[], total: 0 };
    const all = world.transferHistory ?? [];
    // Compute swap indices on the FULL list so detection survives filtering.
    // We then re-index by record identity (we use original index pre-filter)
    // through a helper map keyed by (season|windowIndex|playerId|fromTeamId|toTeamId).
    const swapIdxAll = detectSwapIndices(all);
    const swapKey = new Set<string>();
    all.forEach((r, idx) => {
      if (swapIdxAll.has(idx)) {
        swapKey.add(`${r.season}|${r.windowIndex}|${r.playerId}|${r.fromTeamId}|${r.toTeamId}`);
      }
    });

    const filtered = filter === 'major' ? all.filter((t) => t.type === 'transfer') : all;
    const grouped = new Map<number, TransferRecord[]>();
    for (const t of filtered) {
      if (!grouped.has(t.season)) grouped.set(t.season, []);
      grouped.get(t.season)!.push(t);
    }
    const bySeasons = [...grouped.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([season, records]) => {
        const swapIndices = new Set<number>();
        records.forEach((r, i) => {
          const k = `${r.season}|${r.windowIndex}|${r.playerId}|${r.fromTeamId}|${r.toTeamId}`;
          if (swapKey.has(k)) swapIndices.add(i);
        });
        return { season, records, swapIndices };
      });
    return { bySeasons, total: filtered.length };
  }, [world, filter]);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  return (
    <PageShell width="standard" className="tabular-nums">
      <PageHeader
        title="转会窗口"
        meta={<StatusBadge>{transferData.total} 笔</StatusBadge>}
      />

      {/* Filter */}
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        ariaLabel="转会记录筛选"
        options={[
          { value: 'all', label: '全部' },
          { value: 'major', label: '强援转会' },
        ]}
      />

      {transferData.bySeasons.length === 0 ? (
        <EmptyState
          title="尚无转会记录"
          description="完成一个完整赛季后将自动生成转会窗口"
        />
      ) : (
        <div className="space-y-4">
          {transferData.bySeasons.map(({ season, records, swapIndices }) => (
            <Panel key={season} padded={false} className="overflow-hidden">
              <div className="px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/40">
                <SectionHeader
                  title={`第 ${season} 赛季`}
                  actions={<StatusBadge>{records.length} 笔</StatusBadge>}
                />
              </div>
              <div className="divide-y divide-slate-700/40">
                {records.map((t, i) => (
                  <TransferRow key={i} record={t} world={world} isSwap={swapIndices.has(i)} />
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </PageShell>
  );
}

function TransferRow({ record, world, isSwap }: { record: TransferRecord; world: NonNullable<ReturnType<typeof useGameStore.getState>['world']>; isSwap: boolean }) {
  const fromTeam = world.teamBases[record.fromTeamId];
  const toTeam = world.teamBases[record.toTeamId];
  const fromColor = fromTeam?.color ?? '#666';
  const toColor = toTeam?.color ?? '#666';
  // Swap legs (paired free + transfer between the same teams in one window)
  // render with a two-way arrow + amber accent so the user sees them as a
  // swap rather than a release / standalone purchase.
  const arrow = isSwap
    ? '↔'
    : record.type === 'transfer'
      ? '→'
      : record.type === 'loan'
        ? '⇄'
        : record.type === 'free_agent'
          ? '⤳'
          : '○';
  const arrowColor = isSwap
    ? 'text-amber-400'
    : record.type === 'transfer'
      ? 'text-emerald-400'
      : record.type === 'loan'
        ? 'text-amber-400'
        : record.type === 'free_agent'
          ? 'text-cyan-400'
          : 'text-slate-500';

  return (
    <div className="px-3 py-2 hover:bg-slate-700/20 transition-colors">
      <div className="flex items-center gap-2">
        {/* Position */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${posColor[record.position]}`}>
          {posLabel[record.position]}
        </span>

        {/* Player */}
        <Link to={`/player/${record.playerId}`} className="text-sm text-slate-100 font-medium hover:text-blue-300 truncate min-w-[60px]">
          {record.playerName}
        </Link>

        {/* From → To */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 text-xs">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: fromColor }} />
          <Link to={`/team/${record.fromTeamId}`} className="text-slate-400 hover:text-blue-300 whitespace-nowrap" title={record.fromTeamName}>
            {fromTeam?.shortName ?? record.fromTeamName}
          </Link>
          <span className={`${arrowColor} font-bold shrink-0`} title={isSwap ? '互换交易' : undefined}>{arrow}</span>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: toColor }} />
          <Link to={`/team/${record.toTeamId}`} className="text-slate-200 hover:text-blue-300 whitespace-nowrap font-medium" title={record.toTeamName}>
            {toTeam?.shortName ?? record.toTeamName}
          </Link>
        </div>

        {/* Fee */}
        {record.fee && (
          <span className="text-xs text-emerald-400 font-bold shrink-0">€{record.fee}M</span>
        )}
      </div>
      {record.reason && (
        <div className="text-[10px] text-slate-500 ml-12 mt-0.5 truncate">{record.reason}</div>
      )}
    </div>
  );
}
