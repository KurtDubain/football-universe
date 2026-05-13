import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { formatMarketValue } from '../engine/economy/market-value';
import type { Player } from '../types/player';

const posLabel: Record<string, string> = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };
const posColor: Record<string, string> = { GK: 'bg-amber-900/40 text-amber-400', DF: 'bg-blue-900/40 text-blue-400', MF: 'bg-green-900/40 text-green-400', FW: 'bg-red-900/40 text-red-400' };

/**
 * Walk every squad to find a player by uuid. Returns the player and their
 * current team id (which may differ from any historical association — the
 * uuid is stable but teamId is not).
 */
function findPlayerByUuid(
  squads: Record<string, Player[]>,
  uuid: string,
): { player: Player; teamId: string } | null {
  for (const [teamId, squad] of Object.entries(squads)) {
    const player = squad.find((p) => p.uuid === uuid);
    if (player) return { player, teamId };
  }
  return null;
}

export default function PlayerDetail() {
  // The route param is named `id` for legacy URL compatibility, but the
  // value is now a Player.uuid. Old `${teamId}-${number}` URLs from
  // bookmarks before v8 will return "未找到" — that's expected.
  const { id: uuid } = useParams<{ id: string }>();
  const world = useGameStore((s) => s.world);

  if (!world || !uuid) return <div className="text-slate-400">正在加载...</div>;

  const found = findPlayerByUuid(world.squads, uuid);
  const player = found?.player;
  const teamId = found?.teamId;
  const team = teamId ? world.teamBases[teamId] : undefined;
  const stats = world.playerStats[uuid];

  // Position ranking among all players of same position. We must call hooks
  // unconditionally — guard with optional chaining inside instead of an
  // early return above the hooks.
  const posRanking = useMemo(() => {
    if (!player) return { rank: 0, total: 0 };
    const allSamePos = Object.values(world.playerStats).filter(s => {
      const pId = s.playerId;
      for (const sq of Object.values(world.squads)) {
        const p = sq.find(pp => pp.uuid === pId);
        if (p && p.position === player.position) return true;
      }
      return false;
    });
    const sorted = [...allSamePos].sort((a, b) => {
      if (player.position === 'FW' || player.position === 'MF') return (b.goals * 2 + b.assists) - (a.goals * 2 + a.assists);
      return b.appearances - a.appearances;
    });
    const rank = sorted.findIndex(s => s.playerId === uuid) + 1;
    return { rank, total: sorted.length };
  }, [world.playerStats, world.squads, player, uuid]);

  // Recent match highlights (goals scored by this player from calendar)
  const highlights = useMemo(() => {
    const hl: { window: string; minute: number; desc: string }[] = [];
    for (const w of world.seasonState.calendar) {
      if (!w.completed || !w.results) continue;
      for (const r of w.results) {
        for (const e of r.events) {
          if (e.playerId === uuid && (e.type === 'goal' || e.type === 'penalty_goal')) {
            hl.push({ window: w.label, minute: e.minute, desc: e.description });
          }
        }
      }
    }
    return hl.slice(-8);
  }, [world.seasonState.calendar, uuid]);

  // Key match metrics (computed from calendar events)
  const keyMetrics = useMemo(() => {
    let finalGoals = 0;
    let lateGoals = 0;
    let hatTricks = 0;
    for (const w of world.seasonState.calendar) {
      if (!w.completed || !w.results) continue;
      for (const r of w.results) {
        const myGoals = r.events.filter(e => e.playerId === uuid && (e.type === 'goal' || e.type === 'penalty_goal'));
        if (myGoals.length === 0) continue;
        // Hat trick (3+ goals in single match)
        if (myGoals.length >= 3) hatTricks++;
        // Final goals (in cup finals)
        const isFinal = (r.competitionType === 'super_cup' || r.competitionType === 'world_cup' || r.competitionType === 'league_cup')
          && (r.roundLabel === 'Final' || r.roundLabel.includes('决赛'));
        if (isFinal) finalGoals += myGoals.length;
        // Late drama goals (>=85 min in close match: diff <= 1 at the time)
        const totalH = r.homeGoals + (r.etHomeGoals ?? 0);
        const totalA = r.awayGoals + (r.etAwayGoals ?? 0);
        const isClose = Math.abs(totalH - totalA) <= 1;
        if (isClose) {
          for (const g of myGoals) {
            if (g.minute >= 85) lateGoals++;
          }
        }
      }
    }
    return { finalGoals, lateGoals, hatTricks };
  }, [world.seasonState.calendar, uuid]);

  if (!player || !team || !teamId) {
    return <div className="text-slate-400">未找到球员: {uuid}</div>;
  }

  // Efficiency
  const appearances = stats?.appearances ?? 0;
  const goals = stats?.goals ?? 0;
  const assists = stats?.assists ?? 0;
  const goalsPerApp = appearances > 0 ? (goals / appearances).toFixed(2) : '0';
  const assistsPerApp = appearances > 0 ? (assists / appearances).toFixed(2) : '0';

  // Team contribution
  const teamTotalGoals = Object.values(world.playerStats).filter(s => s.teamId === teamId).reduce((sum, s) => sum + s.goals, 0);
  const contribution = teamTotalGoals > 0 ? Math.round((goals / teamTotalGoals) * 100) : 0;

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-black text-white shrink-0" style={{ backgroundColor: team.color }}>
            {player.number}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-100">{player.name ?? `${player.number}号球员`}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Link to={`/team/${teamId}`} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: team.color }} />
                {team.name}
              </Link>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 font-mono">#{player.number}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${posColor[player.position] ?? ''}`}>
                {posLabel[player.position] ?? player.position}
              </span>
              <span className="text-xs text-slate-500">能力 {player.rating}</span>
              {player.age !== undefined && (
                <span className="text-xs text-slate-500">{player.age}岁</span>
              )}
              {player.marketValue !== undefined && player.marketValue > 0 && (
                <span className="text-xs text-emerald-400 font-semibold">市值 {formatMarketValue(player.marketValue)}</span>
              )}
              {posRanking.rank > 0 && (
                <span className="text-[10px] text-slate-500">同位置第{posRanking.rank}/{posRanking.total}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="出场" value={appearances} />
        <StatBox label="进球" value={goals} color="text-amber-400" />
        <StatBox label="助攻" value={assists} color="text-blue-400" />
        <StatBox label="黄牌" value={stats?.yellowCards ?? 0} color="text-yellow-400" />
      </div>

      {/* Efficiency & Contribution */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3 text-center">
          <div className="text-lg font-bold text-slate-100">{goalsPerApp}</div>
          <div className="text-[10px] text-slate-500">场均进球</div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3 text-center">
          <div className="text-lg font-bold text-slate-100">{assistsPerApp}</div>
          <div className="text-[10px] text-slate-500">场均助攻</div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3 text-center">
          <div className={`text-lg font-bold ${contribution >= 30 ? 'text-amber-400' : 'text-slate-100'}`}>{contribution}%</div>
          <div className="text-[10px] text-slate-500">球队进球占比</div>
        </div>
      </div>

      {/* Key Match Metrics */}
      {(keyMetrics.finalGoals > 0 || keyMetrics.lateGoals > 0 || keyMetrics.hatTricks > 0) && (
        <div className="bg-gradient-to-r from-amber-900/15 to-slate-800 rounded-xl border border-amber-700/30 p-3">
          <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">关键先生</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-2xl">🎯</div>
              <div className="text-base font-bold text-amber-300">{keyMetrics.finalGoals}</div>
              <div className="text-[10px] text-slate-500">决赛进球</div>
            </div>
            <div className="text-center">
              <div className="text-2xl">⚡</div>
              <div className="text-base font-bold text-amber-300">{keyMetrics.lateGoals}</div>
              <div className="text-[10px] text-slate-500">绝杀进球</div>
            </div>
            <div className="text-center">
              <div className="text-2xl">🎩</div>
              <div className="text-base font-bold text-amber-300">{keyMetrics.hatTricks}</div>
              <div className="text-[10px] text-slate-500">帽子戏法</div>
            </div>
          </div>
        </div>
      )}

      {/* Attributes */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">球员属性</h3>
        <div className="space-y-2">
          <AttrBar label="综合能力" value={player.rating} max={99} />
          <AttrBar label="进球倾向" value={player.goalScoring} max={100} color="bg-amber-500" />
        </div>
      </div>

      {/* Goal Highlights */}
      {highlights.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">本赛季进球记录</h3>
          <div className="space-y-1.5">
            {highlights.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-amber-400">⚽</span>
                <span className="text-slate-500 w-8 shrink-0">{h.minute}'</span>
                <span className="text-slate-300 flex-1 truncate">{h.desc}</span>
                <span className="text-[10px] text-slate-600 shrink-0 truncate max-w-[100px]">{h.window}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Red cards */}
      {(stats?.redCards ?? 0) > 0 && (
        <div className="bg-red-900/15 rounded-xl border border-red-800/30 p-3 text-center">
          <span className="text-sm text-red-400 font-semibold">红牌: {stats!.redCards}</span>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3 text-center">
      <div className={`text-2xl font-bold ${color ?? 'text-slate-100'}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function AttrBar({ label, value, max, color }: { label: string; value: number; max: number; color?: string }) {
  const pct = (value / max) * 100;
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-200 font-semibold">{value}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color ?? 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
