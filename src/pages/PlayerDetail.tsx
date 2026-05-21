import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { formatMarketValue } from '../engine/economy/market-value';
import { TAG_META } from '../engine/players/tags';
import { computePlayerRivals } from '../engine/players/player-rivalries';
import type { Player, PlayerRetirement, PlayerSeasonStats, PlayerTag } from '../types/player';

const TAG_HINT: Record<PlayerTag, string> = {
  loyal:     '忠诚 — 永不被豪门挖角',
  ambitious: '野心家 — 被挖角概率 ×1.5',
  iron:      '铁人 — 受伤几率 ÷3',
  glass:     '玻璃人 — 受伤几率 ×2，市值打 7 折',
};

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

  // Recent match highlights — only regulation/ET goals; shootout kicks excluded
  const highlights = useMemo(() => {
    const hl: { window: string; minute: number; desc: string }[] = [];
    for (const w of world.seasonState.calendar) {
      if (!w.completed || !w.results) continue;
      for (const r of w.results) {
        for (const e of r.events) {
          if (e.playerId === uuid && e.type === 'goal' && e.minute <= 120) {
            hl.push({ window: w.label, minute: e.minute, desc: e.description });
          }
        }
      }
    }
    return hl.slice(-8);
  }, [world.seasonState.calendar, uuid]);

  // Key match metrics — excludes shootout kicks; lateGoals uses RUNNING score
  // at goal time (not final score) so 89' goal in 3-1 game isn't counted, and
  // shootout 121+ kicks don't masquerade as last-minute drama.
  const keyMetrics = useMemo(() => {
    let finalGoals = 0;
    let lateGoals = 0;
    let hatTricks = 0;
    for (const w of world.seasonState.calendar) {
      if (!w.completed || !w.results) continue;
      for (const r of w.results) {
        // Only count regulation + extra time goals — skip shootout penalty_goal
        const myGoals = r.events.filter(
          e => e.playerId === uuid && e.type === 'goal' && e.minute <= 120,
        );
        if (myGoals.length === 0) continue;
        // Hat trick (3+ goals in single match)
        if (myGoals.length >= 3) hatTricks++;
        // Final goals (in cup finals)
        const isFinal = (r.competitionType === 'super_cup' || r.competitionType === 'world_cup' || r.competitionType === 'league_cup')
          && (r.roundLabel === 'Final' || r.roundLabel.includes('决赛'));
        if (isFinal) finalGoals += myGoals.length;
        // Late drama: walk events chronologically, track running score, check
        // diff AT THE GOAL TIME (not at final whistle)
        const myGoalMinutes = new Set(myGoals.filter(g => g.minute >= 85 && g.minute <= 90).map(g => g.minute));
        if (myGoalMinutes.size === 0) continue;
        let runHome = 0, runAway = 0;
        const sortedEvents = [...r.events]
          .filter(e => (e.type === 'goal' || e.type === 'own_goal') && e.minute <= 120)
          .sort((a, b) => a.minute - b.minute);
        for (const e of sortedEvents) {
          const isHomeGoal = e.teamId === r.homeTeamId;
          if (isHomeGoal) runHome++; else runAway++;
          if (e.playerId === uuid && myGoalMinutes.has(e.minute)) {
            // At THIS moment, diff should be ≤ 1 to count as late drama
            if (Math.abs(runHome - runAway) <= 1) lateGoals++;
          }
        }
      }
    }
    return { finalGoals, lateGoals, hatTricks };
  }, [world.seasonState.calendar, uuid]);

  if (!player || !team || !teamId) {
    // The uuid isn't on any active squad. Before falling back to the
    // generic "未找到" dead-end, check the retirement archive — old links
    // to retired players should land on a graceful "已退役" view that
    // points the user toward the legends page.
    const retired = world.retirementHistory?.find((r) => r.uuid === uuid);
    if (retired) {
      return <RetiredPlayerView retired={retired} world={world} stats={stats} />;
    }
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
              {player.tag && TAG_META[player.tag] && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${TAG_META[player.tag].color}`}
                  title={TAG_HINT[player.tag]}
                >
                  {TAG_META[player.tag].icon} {TAG_META[player.tag].label}
                </span>
              )}
              <span className="text-xs text-slate-500">能力 {player.rating}</span>
              {player.age !== undefined && (
                <span className="text-xs text-slate-500">{player.age}岁</span>
              )}
              {team.region && (
                <span className="text-xs text-slate-500" title="出身地区(由初始球队决定)">📍{team.region.split('+')[0]}</span>
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
          {typeof player.peakRating === 'number' && player.peakRating > player.rating && (
            <AttrBar
              label={`巅峰能力 (${player.peakAge ?? '?'}岁)`}
              value={player.peakRating}
              max={99}
              color="bg-amber-500"
            />
          )}
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

      {/* Awards (career) */}
      <AwardsSection world={world} playerUuid={uuid!} />

      {/* Positional rivals — same league, same position, top N by rating */}
      <RivalsSection world={world} playerUuid={uuid!} />

      {/* Transfer history (career) */}
      <TransferHistorySection world={world} playerUuid={uuid!} />

      {/* Phase G — Injury record */}
      <InjurySection player={player} currentWindowIdx={world.totalElapsedWindows ?? 0} />
    </div>
  );
}

const AWARD_META: Record<string, { label: string; icon: string; color: string }> = {
  mvp:           { label: '金球奖',  icon: '🏆', color: 'bg-amber-900/40 text-amber-300 border-amber-700/40' },
  golden_boot:   { label: '金靴奖',  icon: '👟', color: 'bg-orange-900/40 text-orange-300 border-orange-700/40' },
  best_defender: { label: '最佳后卫', icon: '🛡️', color: 'bg-blue-900/40 text-blue-300 border-blue-700/40' },
  young_player:  { label: '最佳新星', icon: '⭐', color: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' },
};

/** Career awards collected by this player (uuid). */
function AwardsSection({ world, playerUuid }: { world: ReturnType<typeof useGameStore.getState>['world']; playerUuid: string }) {
  if (!world) return null;
  const awards = (world.playerAwardsHistory ?? []).filter(a => a.playerId === playerUuid);
  if (awards.length === 0) return null;
  // Newest first
  const sorted = [...awards].sort((a, b) => b.season - a.season);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        🏅 个人荣誉 ({awards.length})
      </h3>
      <div className="space-y-1.5">
        {sorted.map((a, i) => {
          const meta = AWARD_META[a.type] ?? { label: a.type, icon: '🏅', color: 'bg-slate-700/60 text-slate-300 border-slate-600/40' };
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 w-10 shrink-0">S{a.season}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.color} font-semibold`}>
                {meta.icon} {meta.label}
              </span>
              <span className="text-slate-400 flex-1 truncate">{a.statLabel}</span>
              <span className="text-[10px] text-slate-500 truncate max-w-[100px]">于 {a.teamName}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Positional rivals — same league, same position, top peers by rating. */
function RivalsSection({ world, playerUuid }: { world: ReturnType<typeof useGameStore.getState>['world']; playerUuid: string }) {
  if (!world) return null;
  const rivals = computePlayerRivals(world, playerUuid, 3);
  if (rivals.length === 0) return null;
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          ⚔️ 位置之争
        </h3>
        <span className="text-[10px] text-slate-500">同位置同级别强敌</span>
      </div>
      <div className="space-y-1.5">
        {rivals.map((r) => (
          <Link
            key={r.playerUuid}
            to={`/player/${r.playerUuid}`}
            className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-slate-700/40 transition-colors"
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.teamColor }} />
            <span className="text-slate-200 font-medium truncate">{r.playerName}</span>
            <span className="text-[10px] text-slate-500 truncate max-w-[100px]">@ {r.teamName}</span>
            {r.isDerbyRival && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/40 font-semibold">
                德比
              </span>
            )}
            {r.awardCount > 0 && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
                🏅×{r.awardCount}
              </span>
            )}
            <span className="text-slate-300 font-bold tabular-nums ml-auto">{r.playerRating}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Career transfer chain for this player (uuid). */
function TransferHistorySection({ world, playerUuid }: { world: ReturnType<typeof useGameStore.getState>['world']; playerUuid: string }) {  if (!world) return null;
  const transfers = (world.transferHistory ?? []).filter(t => t.playerId === playerUuid);
  if (transfers.length === 0) return null;
  // Oldest first (career progression)
  const sorted = [...transfers].sort((a, b) => a.season - b.season || a.windowIndex - b.windowIndex);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        🔄 转会履历 ({transfers.length})
      </h3>
      <div className="space-y-1.5">
        {sorted.map((t, i) => {
          const typeChip =
            t.type === 'transfer'   ? { text: '转会',     cls: 'bg-blue-900/40 text-blue-300 border-blue-700/40' } :
            t.type === 'free_agent' ? { text: '自由身',   cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' } :
            t.type === 'loan'       ? { text: '租借',     cls: 'bg-purple-900/40 text-purple-300 border-purple-700/40' } :
                                      { text: '自由转会', cls: 'bg-slate-700/60 text-slate-300 border-slate-600/40' };
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 w-10 shrink-0">S{t.season}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${typeChip.cls}`}>
                {typeChip.text}
              </span>
              <Link to={`/team/${t.fromTeamId}`} className="text-slate-300 hover:text-blue-300 truncate max-w-[100px]">
                {t.fromTeamName}
              </Link>
              <span className="text-slate-500">→</span>
              <Link to={`/team/${t.toTeamId}`} className="text-slate-300 hover:text-blue-300 truncate max-w-[100px]">
                {t.toTeamName}
              </Link>
              {t.fee && (
                <span className="text-[10px] text-emerald-400 font-semibold ml-auto">€{t.fee}M</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Injury history section ─────────────────────────────────

const severityLabel: Record<string, string> = {
  minor: '轻伤', moderate: '中等', major: '重伤', long_term: '长期',
};
const severityColor: Record<string, string> = {
  minor: 'text-slate-400 bg-slate-700/40',
  moderate: 'text-amber-400 bg-amber-900/40',
  major: 'text-orange-400 bg-orange-900/40',
  long_term: 'text-red-400 bg-red-900/40',
};

/**
 * Phase G — career injury log. Renders most-recent-first. Hidden when the
 * player has no injuryHistory entries.
 *
 * The header carries a live badge for "currently injured / suspended" so the
 * user can tell at a glance whether the player is available for the next
 * match (the squad-roster red dot tells the same story from the team view).
 */
function InjurySection({
  player,
  currentWindowIdx,
}: {
  player: Player;
  currentWindowIdx: number;
}) {
  const history = player.injuryHistory ?? [];
  const isInjured = (player.injuredUntilWindow ?? 0) > currentWindowIdx;
  const isSuspended = (player.suspendedUntilWindow ?? 0) > currentWindowIdx;
  if (history.length === 0 && !isInjured && !isSuspended) return null;
  const sorted = [...history].sort((a, b) => b.startWindow - a.startWindow);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">🩹 伤病记录</h3>
        <div className="flex gap-1.5">
          {isInjured && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-700/40">
              当前伤停 (剩{Math.max(0, (player.injuredUntilWindow ?? 0) - currentWindowIdx)}场)
            </span>
          )}
          {isSuspended && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-700/40">
              当前停赛 (剩{Math.max(0, (player.suspendedUntilWindow ?? 0) - currentWindowIdx)}场)
            </span>
          )}
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="text-[11px] text-slate-500">暂无历史伤病记录</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((inj, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 w-14 shrink-0">S{inj.startSeason} W{inj.startWindow}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${severityColor[inj.type] ?? ''}`}>
                {severityLabel[inj.type] ?? inj.type}
              </span>
              <span className="text-slate-300 flex-1 truncate">{inj.reason}</span>
              <span className="text-[10px] text-slate-500 shrink-0">{inj.durationMatches}场</span>
            </div>
          ))}
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

/**
 * Fallback view rendered when a uuid resolves to no active squad slot but
 * does appear in `world.retirementHistory`. Old bookmarks / award links to
 * a player who has since hung up their boots stay non-broken — they land
 * here with an "已退役" badge and a pointer at the hall-of-fame page where
 * the full archive lives.
 *
 * Career stats come from `world.playerStats` because the retirement engine
 * intentionally preserves the stats record even after the player leaves
 * `world.squads` (see comment on `PlayerRetirement` in types/player.ts).
 */
function RetiredPlayerView({
  retired,
  world,
  stats,
}: {
  retired: PlayerRetirement;
  world: ReturnType<typeof useGameStore.getState>['world'];
  stats: PlayerSeasonStats | undefined;
}) {
  const team = world?.teamBases[retired.teamId];
  const careerGoals = retired.careerGoals ?? stats?.goals ?? 0;
  const trophyCount = retired.careerTrophies?.length ?? 0;
  return (
    <div className="max-w-2xl space-y-5">
      <div className="bg-gradient-to-br from-slate-800 to-slate-800/60 rounded-xl border border-slate-700/60 p-5">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40 font-medium">
            🏛️ 已退役
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400">
            {posLabel[retired.position] ?? retired.position}
          </span>
          <Link
            to="/legends"
            className="text-[10px] text-blue-400 hover:text-blue-300 ml-auto"
          >
            查看名人堂条目 →
          </Link>
        </div>
        <h2 className="text-xl font-bold text-slate-100">{retired.name}</h2>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-slate-400">
          <span>前</span>
          {team ? (
            <Link
              to={`/team/${retired.teamId}`}
              className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: team.color }} />
              {team.name}
            </Link>
          ) : (
            <span>{retired.teamName}</span>
          )}
          <span className="text-slate-500">退役 S{retired.seasonRetired} · {retired.age}岁 · 巅峰 {retired.peakRating}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatBox label="生涯进球" value={careerGoals} color="text-amber-400" />
        <StatBox label="巅峰能力" value={retired.peakRating} color="text-amber-300" />
        <StatBox label="冠军" value={trophyCount} color={trophyCount > 0 ? 'text-emerald-300' : undefined} />
      </div>

      {/* Awards + transfer history for retired players too */}
      <AwardsSection world={world} playerUuid={retired.uuid} />
      <TransferHistorySection world={world} playerUuid={retired.uuid} />

      <p className="text-[11px] text-slate-500 text-center">
        本页面为退役球员的精简档案。完整档案与生涯轨迹请查看
        <Link to="/legends" className="text-blue-400 hover:text-blue-300 mx-1">传奇名人堂</Link>。
      </p>
    </div>
  );
}
