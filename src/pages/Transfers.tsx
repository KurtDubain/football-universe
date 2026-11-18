import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import type { TransferRecord } from '../types/transfer';
import { formatMoney } from '../engine/economy/finance';
import { POSITION_CHIP, POSITION_CHIP_BASE } from '../components/position-chip';
import { PageHeader, PageShell, Panel, SectionHeader, SegmentedControl, StatusBadge } from '../components/ui';
import TransferTeamLink from '../components/TransferTeamLink';
import { useUiSessionState } from '../app/ui-session-state';
import WorldProgressEmptyState from '../components/WorldProgressEmptyState';

const posLabel: Record<string, string> = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };

/**
 * Detect the two legs of a swap deal.
 *
 * A swap moves two players in opposite directions inside one window, so the
 * page has to render both legs as the single deal they were rather than as
 * two unrelated moves. Current records name their counterpart through
 * `swapPartnerId`, which is exact. The inverse-team heuristic below
 * is kept for records written before that field existed.
 *
 * Returns the set of record indices (within `all`) to render as swaps.
 */
function detectSwapIndices(all: TransferRecord[]): Set<number> {
  const swaps = new Set<number>();

  // Exact pairing. One record per player per window, so the first index wins.
  const byPlayerInWindow = new Map<string, number>();
  all.forEach((r, idx) => {
    const k = `${r.season}|${r.windowIndex}|${r.playerId}`;
    if (!byPlayerInWindow.has(k)) byPlayerInWindow.set(k, idx);
  });
  all.forEach((r, idx) => {
    if (!r.swapPartnerId) return;
    const partner = byPlayerInWindow.get(`${r.season}|${r.windowIndex}|${r.swapPartnerId}`);
    // A counterpart trimmed out of the bounded transfer history leaves this
    // leg unpaired, which renders as an ordinary move rather than a false swap.
    if (partner === undefined) return;
    swaps.add(idx);
    swaps.add(partner);
  });

  // Legacy fallback: a `free` record paired with a `transfer` record in the
  // same (season, windowIndex) window where the two move opposite directions
  // between the same pair of teams. The free leg is then a swap, not a release.
  const transferKey = new Map<string, number[]>();
  all.forEach((r, idx) => {
    if (r.type !== 'transfer') return;
    const k = `${r.season}|${r.windowIndex}|${r.fromTeamId}|${r.toTeamId}`;
    if (!transferKey.has(k)) transferKey.set(k, []);
    transferKey.get(k)!.push(idx);
  });
  all.forEach((r, idx) => {
    if (r.type !== 'free' || swaps.has(idx)) return;
    const inverseKey = `${r.season}|${r.windowIndex}|${r.toTeamId}|${r.fromTeamId}`;
    const matches = transferKey.get(inverseKey);
    // Skip a leg already claimed by the exact pairing above.
    const partner = matches?.find(m => !swaps.has(m));
    if (partner !== undefined) {
      swaps.add(idx);
      swaps.add(partner);
    }
  });
  return swaps;
}

export default function Transfers() {
  const world = useGameStore((s) => s.world);
  const [filter, setFilter] = useUiSessionState<'all' | 'major'>('ui.transfers.filter', 'all');

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
        // 组内按窗口排序：同一赛季的流动可能横跨多个窗口，不排序读者就分不出先后。
        // swapKey 按记录身份匹配，所以先排序再检测不会错配互换的两条腿。
        const ordered = [...records].sort((a, b) => a.windowIndex - b.windowIndex);
        const swapIndices = new Set<number>();
        ordered.forEach((r, i) => {
          const k = `${r.season}|${r.windowIndex}|${r.playerId}|${r.fromTeamId}|${r.toTeamId}`;
          if (swapKey.has(k)) swapIndices.add(i);
        });
        return { season, records: ordered, swapIndices };
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
        <WorldProgressEmptyState
          world={world}
          title="尚无转会记录"
          description="首个完整赛季结束后，转会窗口会自动归档每笔流动。"
          actionLabel="查看当前赛季"
          actionTo="/"
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
        <span className={`${POSITION_CHIP_BASE} ${POSITION_CHIP[record.position]} shrink-0 font-medium`}>
          {posLabel[record.position]}
        </span>

        {/* Window — 这笔流动发生在赛季的哪个窗口；此前整页没有任何时间字段 */}
        <span className="shrink-0 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-300">
          S{record.season}·窗口{record.windowIndex + 1}
        </span>

        {/* Player */}
        <Link to={`/player/${record.playerId}`} className="text-sm text-slate-100 font-medium hover:text-blue-300 truncate min-w-[60px]" title={record.playerName}>
          {record.playerName}
        </Link>

        {/* From → To */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 text-xs">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: fromColor }} />
          <TransferTeamLink
            teamId={record.fromTeamId}
            teamName={record.fromTeamName}
            shortName={fromTeam?.shortName}
            className="whitespace-nowrap text-slate-400 hover:text-blue-300"
          />
          <span className={`${arrowColor} font-bold shrink-0`} title={isSwap ? '互换交易' : undefined}>{arrow}</span>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: toColor }} />
          <TransferTeamLink
            teamId={record.toTeamId}
            teamName={record.toTeamName}
            shortName={toTeam?.shortName}
            className="whitespace-nowrap font-medium text-slate-200 hover:text-blue-300"
          />
        </div>

        {/* Fee */}
        {record.fee && (
          <span className="text-xs text-emerald-400 font-bold shrink-0">{formatMoney(record.fee)}</span>
        )}
      </div>
      {/* reason 是整行唯一的语义信息（为什么发生这笔流动），权重不该低于金额 */}
      {record.reason && (
        <div className="ml-12 mt-1 text-xs text-slate-300 truncate" title={record.reason}>{record.reason}</div>
      )}
    </div>
  );
}
