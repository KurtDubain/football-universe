import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { formatMarketValue } from '../engine/economy/market-value';
import { TAG_META } from '../engine/players/tags';
import { Icon, IconName } from '../components/Icon';
import { computePlayerRivals } from '../engine/players/player-rivalries';
import { computePlayerCareerTotals } from '../engine/players/career-totals';
import {
  getCurrentPlayerClubStatRows,
  getCurrentPlayerStatRows,
  getPlayerClubStatRow,
  type PlayerStatRow,
} from '../engine/players/player-stat-selectors';
import type { Player, PlayerRetirement, PlayerSeasonStats, PlayerTag } from '../types/player';

const TAG_HINT: Record<PlayerTag, string> = {
  loyal:        '忠诚 — 永不被豪门挖角',
  ambitious:    '野心家 — 被挖角概率 ×1.5',
  iron:         '铁人 — 受伤几率 ÷3',
  glass:        '玻璃人 — 受伤几率 ×2，市值打 7 折',
  clutch:       '大心脏 — 在杯赛决赛 / 德比战中进球倾向 ×1.3',
  late_bloomer: '大器晚成 — 巅峰年龄 28-32（默认 24-29）',
  wanderer:     '浪子 — 每赛季 8% 概率自请离队进自由市场',
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
    const allSamePos = getCurrentPlayerStatRows(world)
      .filter(row => row.identity.position === player.position);
    const score = (s: typeof allSamePos[number]) => {
      if (player.position === 'FW') return s.goals * 2 + s.assists + s.bigChances * 0.3;
      if (player.position === 'MF') return s.assists * 2 + s.goals + s.keyPasses * 0.4;
      if (player.position === 'GK') return s.cleanSheets * 2 + s.saves * 0.5 + s.appearances * 0.1;
      return s.cleanSheets * 2 + s.keyBlocks * 0.8 + s.appearances * 0.1;
    };
    const sorted = [...allSamePos].sort((a, b) => {
      return score(b) - score(a);
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

  const clubStats = useMemo(
    () => (teamId ? getPlayerClubStatRow(world, uuid, teamId) : undefined),
    [world, uuid, teamId],
  );

  const currentTeamClubRows = useMemo(
    () => (teamId ? getCurrentPlayerClubStatRows(world, teamId) : []),
    [world, teamId],
  );

  const currentSeasonClubSplits = useMemo(() => {
    const rows = getCurrentPlayerClubStatRows(world)
      .filter((row) => row.playerId === uuid)
      .filter((row) =>
        row.appearances > 0
        || row.goals > 0
        || row.assists > 0
        || row.cleanSheets > 0
        || row.saves > 0
        || row.keyBlocks > 0
        || row.bigChances > 0
        || row.keyPasses > 0
      );

    if (teamId && rows.some((row) => row.teamId !== teamId) && !rows.some((row) => row.teamId === teamId)) {
      rows.push(getPlayerClubStatRow(world, uuid, teamId));
    }

    return rows.sort((a, b) =>
      (b.teamId === teamId ? 1 : 0) - (a.teamId === teamId ? 1 : 0)
      || b.appearances - a.appearances
      || b.goals - a.goals
      || a.identity.teamName.localeCompare(b.identity.teamName),
    );
  }, [world, uuid, teamId]);

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

  // Team contribution: denominator and numerator use club-specific segments,
  // so transferred-player totals do not leak into the current club's share.
  const clubGoals = clubStats?.goals ?? 0;
  const teamTotalGoals = currentTeamClubRows.reduce((sum, row) => sum + row.goals, 0);
  const contribution = teamTotalGoals > 0 ? Math.round((clubGoals / teamTotalGoals) * 100) : 0;
  const hasCompletedMatches = world.seasonState.calendar.some((window) => window.completed);

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

      {/* Current-season player-wide totals across all competitions. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">当前赛季数据</h3>
          <span className="text-[10px] text-slate-500">全赛事 · 球员总计</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox label="出场" value={appearances} />
          <StatBox label="进球" value={goals} color="text-amber-400" />
          <StatBox label="助攻" value={assists} color="text-blue-400" />
          <StatBox label="黄牌" value={stats?.yellowCards ?? 0} color="text-yellow-400" />
        </div>
        {!hasCompletedMatches && (
          <p className="text-[11px] text-slate-500 text-center">
            赛季尚未开始，完成首场比赛后生成当前赛季统计。
          </p>
        )}
      </div>

      {/* Efficiency & current-club contribution */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">效率与球队贡献</h3>
          <span className="text-[10px] text-slate-500">效率为赛季总计 · 占比仅计当前俱乐部</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3 text-center">
            <div className="text-lg font-bold text-slate-100">{goalsPerApp}</div>
            <div className="text-[10px] text-slate-500">赛季场均进球</div>
          </div>
          <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3 text-center">
            <div className="text-lg font-bold text-slate-100">{assistsPerApp}</div>
            <div className="text-[10px] text-slate-500">赛季场均助攻</div>
          </div>
          <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3 text-center">
            <div className={`text-lg font-bold ${contribution >= 30 ? 'text-amber-400' : 'text-slate-100'}`}>{contribution}%</div>
            <div className="text-[10px] text-slate-500">效力本队进球占比</div>
          </div>
        </div>
      </div>

      {currentSeasonClubSplits.length > 1 && (
        <CurrentSeasonClubSplitSection rows={currentSeasonClubSplits} />
      )}

      {/* Key Match Metrics */}
      {(keyMetrics.finalGoals > 0 || keyMetrics.lateGoals > 0 || keyMetrics.hatTricks > 0) && (
        <div className="bg-gradient-to-r from-amber-900/15 to-slate-800 rounded-xl border border-amber-700/30 p-3">
          <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">关键先生</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="flex justify-center text-amber-300"><Icon name="target" size={24} accent="#f59e0b" /></div>
              <div className="text-base font-bold text-amber-300">{keyMetrics.finalGoals}</div>
              <div className="text-[10px] text-slate-500">决赛进球</div>
            </div>
            <div className="text-center">
              <div className="flex justify-center text-amber-300"><Icon name="bolt" size={24} accent="#fbbf24" /></div>
              <div className="text-base font-bold text-amber-300">{keyMetrics.lateGoals}</div>
              <div className="text-[10px] text-slate-500">绝杀进球</div>
            </div>
            <div className="text-center">
              <div className="flex justify-center text-amber-300"><Icon name="tophat" size={24} accent="#fbbf24" /></div>
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
                <span className="text-amber-400 inline-flex"><Icon name="ball" size={12} /></span>
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

      {/* Position-specific performance card (v19) */}
      <PositionPerformanceCard player={player} stats={stats} world={world} />

      {/* Per-season career history table (v19) */}
      <CareerHistorySection world={world} playerUuid={uuid!} />

      {/* Positional rivals — same league, same position, top N by rating */}
      <RivalsSection world={world} playerUuid={uuid!} />

      {/* Transfer history (career) */}
      <TransferHistorySection world={world} playerUuid={uuid!} />

      {/* Phase G — Injury record */}
      <InjurySection player={player} currentWindowIdx={world.totalElapsedWindows ?? 0} />
    </div>
  );
}

function CurrentSeasonClubSplitSection({ rows }: { rows: PlayerStatRow[] }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider inline-flex items-center gap-1">
          <Icon name="chart" size={13} /> 本赛季球队拆分
        </h3>
        <span className="text-[10px] text-slate-500">效力期间贡献</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700/40">
              <th className="text-left py-1">球队</th>
              <th className="text-right py-1">出场</th>
              <th className="text-right py-1">进球</th>
              <th className="text-right py-1">助攻</th>
              <th className="text-right py-1">防守</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.teamId} className="border-b border-slate-700/20 hover:bg-slate-700/20">
                <td className="py-1 pr-2">
                  <Link to={`/team/${row.teamId}`} className="inline-flex items-center gap-1.5 text-slate-300 hover:text-blue-300 max-w-[160px]">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: row.identity.teamColor ?? '#64748b' }}
                    />
                    <span className="truncate">{row.identity.teamName}</span>
                  </Link>
                </td>
                <td className="py-1 text-right text-slate-300 tabular-nums">{row.appearances}</td>
                <td className="py-1 text-right text-amber-300 tabular-nums">{row.goals}</td>
                <td className="py-1 text-right text-blue-300 tabular-nums">{row.assists}</td>
                <td className="py-1 text-right text-slate-400 tabular-nums">
                  {row.identity.position === 'GK'
                    ? `${row.cleanSheets}零封/${row.saves}神扑`
                    : row.identity.position === 'DF'
                    ? `${row.cleanSheets}零封/${row.keyBlocks}关键封堵`
                    : `${row.bigChances}关键射门/${row.keyPasses}威胁传球`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const AWARD_META: Record<string, { label: string; icon: IconName; accent: string; color: string }> = {
  mvp:           { label: '金球奖',  icon: 'trophy',     accent: '#fbbf24', color: 'bg-amber-900/40 text-amber-300 border-amber-700/40' },
  golden_boot:   { label: '金靴奖',  icon: 'boot',       accent: '#fb923c', color: 'bg-orange-900/40 text-orange-300 border-orange-700/40' },
  best_defender: { label: '最佳后卫', icon: 'shield',     accent: '#3b82f6', color: 'bg-blue-900/40 text-blue-300 border-blue-700/40' },
  young_player:  { label: '最佳新星', icon: 'sparkle',    accent: '#34d399', color: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' },
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
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 inline-flex items-center gap-1">
        <Icon name="medal" size={14} accent="#fbbf24" /> 个人荣誉 ({awards.length})
      </h3>
      <div className="space-y-1.5">
        {sorted.map((a, i) => {
          const meta = AWARD_META[a.type] ?? { label: a.type, icon: 'medal' as IconName, accent: '#fbbf24', color: 'bg-slate-700/60 text-slate-300 border-slate-600/40' };
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 w-10 shrink-0">S{a.season}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.color} font-semibold inline-flex items-center gap-1`}>
                <Icon name={meta.icon} size={11} accent={meta.accent} /> {meta.label}
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

// ── v19 — Position-specific performance metric ────────────────────
//
// Each position has a different "shining" KPI:
//   FW: 0.7 × goals/match + 0.3 × bigChances/match  → rewards
//       finishing + threat. Elite ~0.4 goals + 0.6 bigChances per game.
//   MF: 0.7 × (goals+assists)/match + 0.3 × keyPasses/match → rewards
//       finishing + creativity. Elite ~0.6 G+A + 0.5 keyPass per game.
//   DF: 0.5 × cleanSheetRate + 0.3 × (keyBlocks/match × 80) + 0.2 ×
//       teamDefense → individual blocks dominate, team context modulates.
//   GK: 0.5 × cleanSheetRate + 0.5 × (saves/match × 50) → elite GK with
//       35% clean rate + 0.5 saves/match = 100 score.
// v22: every position now uses an INDIVIDUAL counter (bigChances /
// keyPasses / keyBlocks / saves) sourced from the deny pipeline, so two
// players on the same team can finally diverge on these metrics.
function computePositionScore(
  player: Player,
  stats: PlayerSeasonStats | undefined,
  world: NonNullable<ReturnType<typeof useGameStore.getState>['world']>,
): {
  score: number;
  rating: string;
  perGame?: number;
  label: string;
  /** v21/v22 — extra context line (e.g. "12 场零封 / 28 出场 · 0.3 神扑/场"). */
  detail?: string;
} {
  const apps = stats?.appearances ?? 0;
  const goals = stats?.goals ?? 0;
  const assists = stats?.assists ?? 0;
  if (apps === 0) return { score: 0, rating: '—', label: '本赛季未出场' };

  if (player.position === 'FW') {
    const bigChances = stats?.bigChances ?? goals;
    const goalRate = goals / apps;
    const chanceRate = bigChances / apps;
    const score = Math.min(100, (goalRate * 0.7 + chanceRate * 0.3) * 200);
    const detail = `进球 ${goals} · 关键射门 ${bigChances} (${chanceRate.toFixed(2)}/场)`;
    return { score, rating: scoreToGrade(score), perGame: goalRate, label: '场均进球', detail };
  }
  if (player.position === 'MF') {
    const keyPasses = stats?.keyPasses ?? assists;
    const gaRate = (goals + assists) / apps;
    const keyRate = keyPasses / apps;
    const score = Math.min(100, (gaRate * 0.7 + keyRate * 0.3) * 200);
    const detail = `传射 ${goals + assists} (${goals}进/${assists}助) · 威胁传球 ${keyPasses}`;
    return { score, rating: scoreToGrade(score), perGame: gaRate, label: '场均传射贡献', detail };
  }
  // DF / GK — the team context deliberately uses league standings only.
  // Individual stats remain current-season totals across all competitions;
  // the UI labels this mixed scope explicitly. GK score has no team context.
  let teamGC = 0;
  let teamMatches = 0;
  for (const st of [world.league1Standings, world.league2Standings, world.league3Standings]) {
    const row = (st ?? []).find(s => s.teamId === player.teamId);
    if (row && row.played > 0) {
      teamGC = row.goalsAgainst;
      teamMatches = row.played;
      break;
    }
  }
  const cleanSheets = stats?.cleanSheets ?? 0;
  const cleanRate = cleanSheets / apps; // 0..1
  const gcPerGame = teamMatches > 0 ? teamGC / teamMatches : 2;
  const teamDefenseScore = Math.max(0, 100 - gcPerGame * 25); // 0..100, team context
  if (player.position === 'GK') {
    const saves = stats?.saves ?? 0;
    const savesPerGame = saves / apps;
    // 50% clean rate weight (35% rate = 100) + 50% saves weight (0.5/match = 100)
    const score = Math.min(100, cleanRate * 285 * 0.5 + savesPerGame * 100 * 0.5);
    const detail = `零封 ${cleanSheets}/${apps} (${(cleanRate * 100).toFixed(0)}%) · 神扑 ${saves} (${savesPerGame.toFixed(2)}/场)`;
    return { score, rating: scoreToGrade(score), perGame: cleanRate, label: '门将综合', detail };
  }
  // DF
  const keyBlocks = stats?.keyBlocks ?? 0;
  const blocksPerGame = keyBlocks / apps;
  // 50% clean rate (40% = 100 score) + 30% blocks (0.2/match = ~80) + 20% team
  const score = Math.min(100,
    cleanRate * 250 * 0.5
    + Math.min(100, blocksPerGame * 400) * 0.3
    + teamDefenseScore * 0.2,
  );
  const detail = `全赛事零封 ${cleanSheets}/${apps} (${(cleanRate * 100).toFixed(0)}%) · 关键封堵 ${keyBlocks} (${blocksPerGame.toFixed(2)}/场) · 球队联赛失球 ${gcPerGame.toFixed(2)}/场`;
  return { score, rating: scoreToGrade(score), perGame: cleanRate, label: '后卫综合', detail };
}

function scoreToGrade(score: number): string {
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function PositionPerformanceCard({
  player,
  stats,
  world,
}: {
  player: Player;
  stats: PlayerSeasonStats | undefined;
  world: NonNullable<ReturnType<typeof useGameStore.getState>['world']>;
}) {
  const result = computePositionScore(player, stats, world);
  if (result.score === 0 && result.label === '本赛季未出场') return null;
  const barColor = result.score >= 70 ? 'bg-emerald-500'
    : result.score >= 50 ? 'bg-amber-500'
    : result.score >= 30 ? 'bg-orange-500'
    : 'bg-red-500';
  const gradeColor = result.score >= 70 ? 'text-emerald-300'
    : result.score >= 50 ? 'text-amber-300'
    : result.score >= 30 ? 'text-orange-300'
    : 'text-red-300';
  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-800/70 rounded-xl border border-slate-700/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider inline-flex items-center gap-1">
          <Icon name="chart" size={13} /> 位置表现 ({posLabel[player.position] ?? player.position})
        </h3>
        <span className={`text-2xl font-black ${gradeColor}`}>{result.rating}</span>
      </div>
      <div className="text-[11px] text-slate-500 mb-1">
        {result.label}
        {result.perGame !== undefined ? ` ${player.position === 'GK' || player.position === 'DF' ? (result.perGame * 100).toFixed(0) + '%' : result.perGame.toFixed(2)}` : ''}
      </div>
      {player.position === 'DF' && (
        <div className="text-[10px] text-slate-500 mb-1">评分口径: 个人全赛事数据 + 球队联赛防守背景</div>
      )}
      {result.detail && (
        <div className="text-[10px] text-slate-400 mb-2">{result.detail}</div>
      )}
      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, result.score)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1">
        <span>{result.score.toFixed(0)}/100</span>
        <span>{positionScoreHint(player.position)}</span>
      </div>
    </div>
  );
}

function positionScoreHint(pos: string): string {
  if (pos === 'FW') return '0.5球/场 = 100分';
  if (pos === 'MF') return '0.5传射/场 = 100分';
  if (pos === 'GK') return '35%零封 + 0.5神扑/场';
  return '40%零封 + 0.2关键封堵/场 + 联赛球队防守';
}

/** Per-season career history table (v19). */
function CareerHistorySection({ world, playerUuid }: { world: ReturnType<typeof useGameStore.getState>['world']; playerUuid: string }) {
  if (!world) return null;
  const history = (world.playerStatsHistory ?? {})[playerUuid] ?? [];
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => b.season - a.season);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 inline-flex items-center gap-1">
        <Icon name="trend-up" size={13} /> 生涯赛季数据 ({history.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700/40">
              <th className="text-left py-1">赛季</th>
              <th className="text-left py-1">球队</th>
              <th className="text-right py-1">联赛</th>
              <th className="text-right py-1">出场</th>
              <th className="text-right py-1">进球</th>
              <th className="text-right py-1">助攻</th>
              <th className="text-right py-1">黄</th>
              <th className="text-right py-1">进/失</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => {
              const teamName = h.teamShortName ?? world.teamBases[h.teamId]?.shortName ?? h.teamName ?? h.teamId;
              const gcRate = h.teamMatches > 0 ? (h.teamGoalsConceded / h.teamMatches).toFixed(2) : '—';
              const rank = h.teamLeagueLevel && h.teamLeaguePosition
                ? `${h.teamLeagueLevel}级#${h.teamLeaguePosition}`
                : '—';
              const teamLine = h.teamGoalsFor !== undefined && h.teamGoalsAgainst !== undefined
                ? `${h.teamGoalsFor}/${h.teamGoalsAgainst} · ${gcRate}`
                : gcRate;
              return (
                <tr key={h.season + '-' + h.teamId} className="border-b border-slate-700/20 hover:bg-slate-700/20">
                  <td className="py-1 text-slate-400">S{h.season}</td>
                  <td className="py-1 text-slate-300 truncate max-w-[80px]">{teamName}</td>
                  <td className="py-1 text-right text-slate-400 tabular-nums">{rank}</td>
                  <td className="py-1 text-right text-slate-300 tabular-nums">{h.appearances}</td>
                  <td className="py-1 text-right text-amber-300 tabular-nums">{h.goals}</td>
                  <td className="py-1 text-right text-blue-300 tabular-nums">{h.assists}</td>
                  <td className="py-1 text-right text-slate-500 tabular-nums">{h.yellowCards}</td>
                  <td className="py-1 text-right text-slate-400 tabular-nums">{teamLine}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider inline-flex items-center gap-1">
          <Icon name="target" size={13} /> 位置之争
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
              <span className="text-[10px] px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40 inline-flex items-center gap-0.5">
                <Icon name="medal" size={10} accent="#fbbf24" />×{r.awardCount}
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
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 inline-flex items-center gap-1">
        <Icon name="refresh" size={13} /> 转会履历 ({transfers.length})
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
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider inline-flex items-center gap-1"><Icon name="bandage" size={13} accent="#fca5a5" /> 伤病记录</h3>
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
 * Career stats come from finished-season history plus the preserved current
 * stats row, so retired players are not reduced to their final-season totals.
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
  const careerTotals = world ? computePlayerCareerTotals(world, retired.uuid) : null;
  const careerGoals = Math.max(retired.careerGoals ?? 0, careerTotals?.goals ?? stats?.goals ?? 0);
  const trophyCount = retired.careerTrophies?.length ?? 0;
  return (
    <div className="max-w-2xl space-y-5">
      <div className="bg-gradient-to-br from-slate-800 to-slate-800/60 rounded-xl border border-slate-700/60 p-5">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40 font-medium inline-flex items-center gap-1">
            <Icon name="building" size={11} /> 已退役
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="生涯出场" value={careerTotals?.appearances ?? stats?.appearances ?? 0} />
        <StatBox label="生涯进球" value={careerGoals} color="text-amber-400" />
        <StatBox label="生涯助攻" value={careerTotals?.assists ?? stats?.assists ?? 0} color="text-blue-300" />
        <StatBox label="冠军" value={trophyCount} color={trophyCount > 0 ? 'text-emerald-300' : undefined} />
      </div>

      {/* Awards + transfer history for retired players too */}
      <AwardsSection world={world} playerUuid={retired.uuid} />
      <CareerHistorySection world={world} playerUuid={retired.uuid} />
      <TransferHistorySection world={world} playerUuid={retired.uuid} />

      <p className="text-[11px] text-slate-500 text-center">
        本页面为退役球员的精简档案。完整档案与生涯轨迹请查看
        <Link to="/legends" className="text-blue-400 hover:text-blue-300 mx-1">传奇名人堂</Link>。
      </p>
    </div>
  );
}
