import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getTierLabel, getTierColor } from '../utils/format';
import type { CupState, SuperCupState, WorldCupState, CupRound, SuperCupGroup, CupFixture } from '../types/cup';
import type { MatchFixture, MatchResult } from '../types/match';
import type { TeamBase, TeamState } from '../types/team';
import MatchDetailModal from '../components/MatchDetailModal';
import TeamName from '../components/TeamName';
import { isDerby, getDerbyName } from '../config/derbies';

const roundNameCN: Record<string, string> = {
  R32: '第一轮', R16: '第二轮', QF: '八强', SF: '四强', Final: '决赛',
  'QF-L1': '八强首回合', 'QF-L2': '八强次回合',
  'SF-L1': '四强首回合', 'SF-L2': '四强次回合',
};
function cnRound(name: string) { return roundNameCN[name] ?? name; }

const levelTag: Record<number, { text: string; cls: string }> = {
  1: { text: '顶', cls: 'bg-amber-900/40 text-amber-400' },
  2: { text: '甲', cls: 'bg-blue-900/40 text-blue-400' },
  3: { text: '乙', cls: 'bg-emerald-900/40 text-emerald-400' },
};

function TeamTag({ teamId, ts, tb }: { teamId: string; ts: Record<string, TeamState>; tb?: Record<string, TeamBase> }) {
  const lv = ts[teamId]?.leagueLevel;
  const tier = tb?.[teamId]?.tier;
  if (!lv && !tier) return null;
  const t = lv ? levelTag[lv] : null;
  return (
    <span className="flex gap-0.5 shrink-0">
      {t && <span className={`text-[8px] px-1 py-0 rounded font-medium ${t.cls}`}>{t.text}</span>}
      {tier && <span className={`text-[8px] px-1 py-0 rounded font-medium ${getTierColor(tier)}`}>{getTierLabel(tier)}</span>}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════
export default function Cup() {
  const { type } = useParams<{ type: string }>();
  const world = useGameStore((s) => s.world);
  const [selectedFixture, setSelectedFixture] = useState<MatchFixture | null>(null);
  const [selectedResult, setSelectedResult] = useState<MatchResult | null>(null);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const handleClick = (fix: CupFixture, compName: string) => {
    const mf: MatchFixture = {
      id: fix.id, homeTeamId: fix.homeTeamId, awayTeamId: fix.awayTeamId,
      competitionType: type === 'world_cup' ? 'world_cup' : type === 'super_cup' ? 'super_cup' : 'league_cup',
      competitionName: compName, roundLabel: fix.roundName,
    };
    setSelectedFixture(mf);
    if (fix.result) {
      for (const win of world.seasonState.calendar) {
        const full = win.results.find(r => r.fixtureId === fix.id);
        if (full) { setSelectedResult(full); return; }
      }
      setSelectedResult({
        fixtureId: fix.id, homeTeamId: fix.homeTeamId, awayTeamId: fix.awayTeamId,
        homeGoals: fix.result.home, awayGoals: fix.result.away,
        extraTime: fix.result.extraTime ?? false, penalties: fix.result.penalties ?? false,
        penaltyHome: fix.result.penHome, penaltyAway: fix.result.penAway,
        events: [], stats: { possession:[50,50], shots:[0,0], shotsOnTarget:[0,0], corners:[0,0], fouls:[0,0], yellowCards:[0,0], redCards:[0,0] },
        competitionType: mf.competitionType, competitionName: compName, roundLabel: fix.roundName,
      });
    } else { setSelectedResult(null); }
  };

  const close = () => { setSelectedFixture(null); setSelectedResult(null); };
  const tb = world.teamBases as Record<string, TeamBase>;
  const ts = world.teamStates;

  return (
    <>
      {type === 'league_cup' && <LeagueCupView cup={world.leagueCup} tb={tb} ts={ts} onClick={f => handleClick(f, '联赛杯')} />}
      {type === 'super_cup' && <SuperCupView cup={world.superCup} tb={tb} ts={ts} onClick={f => handleClick(f, '超级杯')} />}
      {type === 'world_cup' && (world.worldCup
        ? <WorldCupView cup={world.worldCup} tb={tb} ts={ts} onClick={f => handleClick(f, '环球冠军杯')} />
        : <div className="text-center py-12 text-slate-500">本赛季不是环球冠军杯年</div>
      )}
      <MatchDetailModal isOpen={!!selectedFixture} onClose={close} fixture={selectedFixture ?? undefined} result={selectedResult ?? undefined} world={world} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  League Cup
// ══════════════════════════════════════════════════════════════

function LeagueCupView({ cup, tb, ts, onClick }: { cup: CupState; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-bold text-slate-100">{cup.name}</h2>
        {cup.completed && cup.winnerId && <WinnerBadge name={getTeamName(cup.winnerId, tb)} color={tb[cup.winnerId]?.color} />}
      </div>
      {/* Rules */}
      <RulesCard lines={[
        '参赛: 全部 32 支球队 (顶级16 + 甲级8 + 乙级8)',
        '赛制: 单场淘汰制，平局进入加时 + 点球',
        '轮次: 第一轮(32→16) → 第二轮(16→8) → 八强 → 四强 → 决赛',
      ]} />
      <BracketView rounds={cup.rounds} tb={tb} ts={ts} onClick={onClick} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Super Cup
// ══════════════════════════════════════════════════════════════

function SuperCupView({ cup, tb, ts, onClick }: { cup: SuperCupState; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-bold text-slate-100">超级杯</h2>
        {cup.completed && cup.winnerId && <WinnerBadge name={getTeamName(cup.winnerId, tb)} color={tb[cup.winnerId]?.color} />}
      </div>
      <RulesCard lines={[
        '参赛: 16 支球队 — 顶级联赛前10 + 甲级前4 + 乙级前2',
        '小组赛: 4组×4队，双循环6轮，小组前2名晋级八强',
        '淘汰赛: 八强/四强为主客场两回合制，决赛单场定胜负',
        cup.awayGoalRule ? '规则: 客场进球规则生效' : '规则: 客场进球规则未启用',
      ]} />
      <h3 className="text-sm font-semibold text-slate-300">小组赛</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cup.groups.map(g => <GroupTable key={g.groupName} group={g} tb={tb} ts={ts} onClick={onClick} />)}
      </div>
      {cup.knockoutRounds.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-slate-300 mt-1">淘汰赛</h3>
          <BracketView rounds={cup.knockoutRounds} tb={tb} ts={ts} onClick={onClick} />
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  World Cup
// ══════════════════════════════════════════════════════════════

function WorldCupView({ cup, tb, ts, onClick }: { cup: WorldCupState; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-bold text-slate-100">环球冠军杯</h2>
        <span className="text-xs text-slate-500">{cup.participantIds.length}队</span>
        {cup.completed && cup.winnerId && <WinnerBadge name={getTeamName(cup.winnerId, tb)} color={tb[cup.winnerId]?.color} />}
      </div>
      <RulesCard lines={[
        '参赛: 全部32支球队',
        '抽签: 4档分组 (按实力排位)，每组2顶+1甲+1乙',
        '小组赛: 8组×4队，双循环6轮，每组前2名晋级16强',
        '淘汰赛: 16强→八强→四强→决赛，单场定胜负',
        '每4个赛季举办一次',
      ]} />
      <h3 className="text-sm font-semibold text-slate-300">小组赛</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cup.groups.map(g => <GroupTable key={g.groupName} group={g} tb={tb} ts={ts} onClick={onClick} />)}
      </div>
      {cup.knockoutRounds.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-slate-300 mt-1">淘汰赛</h3>
          <BracketView rounds={cup.knockoutRounds} tb={tb} ts={ts} onClick={onClick} />
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Rules card
// ══════════════════════════════════════════════════════════════

function RulesCard({ lines }: { lines: string[] }) {
  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">赛事规则</span>
      </div>
      <div className="space-y-0.5">
        {lines.map((line, i) => (
          <p key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
            <span className="text-slate-600 shrink-0">·</span>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Bracket — merges two-legged rounds into single columns
// ══════════════════════════════════════════════════════════════

interface MergedRound {
  label: string;
  twoLegged: boolean;
  completed: boolean;
  ties: MergedTie[];
}

interface MergedTie {
  leg1: CupFixture | null;
  leg2: CupFixture | null;
  // For two-legged: team1 = home in leg1, team2 = away in leg1
  team1Id: string;
  team2Id: string;
  winnerId?: string;
  agg1?: number; // team1 aggregate
  agg2?: number; // team2 aggregate
  awayGoals1?: number; // team1 away goals (scored in leg2)
  awayGoals2?: number; // team2 away goals (scored in leg1)
}

function buildMergedRounds(rounds: CupRound[]): MergedRound[] {
  const merged: MergedRound[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < rounds.length; i++) {
    if (processed.has(i)) continue;
    const r = rounds[i];
    const name = r.roundName;

    // Check if this is a first leg with a matching second leg
    if (name.endsWith('-L1')) {
      const baseName = name.replace('-L1', '');
      const l2Idx = rounds.findIndex((rr, j) => j > i && rr.roundName === `${baseName}-L2`);

      if (l2Idx !== -1) {
        const l2 = rounds[l2Idx];
        processed.add(i);
        processed.add(l2Idx);

        const ties: MergedTie[] = r.fixtures.map((leg1, fi) => {
          const leg2 = l2.fixtures[fi] ?? null;
          const team1Id = leg1.homeTeamId;
          const team2Id = leg1.awayTeamId;

          let agg1: number | undefined;
          let agg2: number | undefined;
          let awayGoals1: number | undefined;
          let awayGoals2: number | undefined;

          if (leg1.result && leg2?.result) {
            // team1: home in L1 + away in L2
            agg1 = leg1.result.home + leg2.result.away;
            // team2: away in L1 + home in L2
            agg2 = leg1.result.away + leg2.result.home;
            awayGoals1 = leg2.result.away; // team1 scored away in L2
            awayGoals2 = leg1.result.away; // team2 scored away in L1
          } else if (leg1.result) {
            // Only first leg played
            agg1 = leg1.result.home;
            agg2 = leg1.result.away;
          }

          return {
            leg1, leg2,
            team1Id, team2Id,
            winnerId: leg2?.winnerId ?? leg1.winnerId,
            agg1, agg2,
            awayGoals1, awayGoals2,
          };
        });

        merged.push({
          label: cnRound(baseName) || baseName,
          twoLegged: true,
          completed: r.completed && (l2?.completed ?? false),
          ties,
        });
        continue;
      }
    }

    // Single-leg round (Final, or league cup rounds)
    processed.add(i);
    merged.push({
      label: cnRound(name),
      twoLegged: false,
      completed: r.completed,
      ties: r.fixtures.map(f => ({
        leg1: f, leg2: null,
        team1Id: f.homeTeamId, team2Id: f.awayTeamId,
        winnerId: f.winnerId,
        agg1: f.result?.home, agg2: f.result?.away,
      })),
    });
  }

  return merged;
}

function BracketView({ rounds, tb, ts, onClick }: { rounds: CupRound[]; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  if (rounds.length === 0) return <p className="text-sm text-slate-500">淘汰赛尚未开始</p>;

  const merged = buildMergedRounds(rounds);

  // If we have enough rounds for a symmetric bracket (QF+SF+Final or R16+QF+SF+Final), render it
  // Otherwise fall back to linear layout
  const hasFinal = merged.some(r => r.label.includes('决赛'));
  const roundCount = merged.length;

  if (hasFinal && roundCount >= 3) {
    return <SymmetricBracket merged={merged} tb={tb} ts={ts} onClick={onClick} />;
  }

  // Linear fallback for simple brackets (e.g., early league cup rounds)
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 sm:gap-4 min-w-max items-start">
        {merged.map((mr, ri) => {
          const n = mr.ties.length;
          const cellGap = n <= 1 ? 0 : n <= 2 ? 32 : n <= 4 ? 12 : n <= 8 ? 4 : 2;
          return (
            <div key={ri} className="flex flex-col">
              <RoundHeader mr={mr} />
              <div className="flex flex-col justify-around flex-1" style={{ gap: `${cellGap}px` }}>
                {mr.ties.map((tie, ti) => (
                  <TieCell key={ti} tie={tie} mr={mr} tb={tb} ts={ts} onClick={onClick} />
                ))}
                <EmptySlot show={mr.ties.length === 0} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Symmetric bracket — left half flows right, right half flows left, final in center.
 * Layout: [...leftRounds] [Final] [...rightRounds(reversed)]
 */
function SymmetricBracket({ merged, tb, ts, onClick }: {
  merged: MergedRound[];
  tb: Record<string, TeamBase>;
  ts: Record<string, TeamState>;
  onClick: (f: CupFixture) => void;
}) {
  const finalIdx = merged.findIndex(r => r.label.includes('决赛'));
  const finalRound = merged[finalIdx];
  const preRounds = merged.slice(0, finalIdx); // e.g., [R16, QF, SF] or [QF-merged, SF-merged]

  // Split pre-final rounds into upper half and lower half
  // Upper = first half of each round's ties, Lower = second half
  const leftRounds = preRounds.map(r => ({
    ...r,
    ties: r.ties.slice(0, Math.ceil(r.ties.length / 2)),
  }));
  const rightRounds = preRounds.map(r => ({
    ...r,
    ties: r.ties.slice(Math.ceil(r.ties.length / 2)),
  }));

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex items-center min-w-max gap-1">
        {/* Left half — flows right toward center */}
        {leftRounds.map((mr, ri) => {
          const n = mr.ties.length;
          const cellGap = n <= 1 ? 0 : n <= 2 ? 24 : n <= 4 ? 8 : 2;
          return (
            <div key={`L${ri}`} className="flex flex-col">
              <RoundHeader mr={mr} />
              <div className="flex flex-col justify-around flex-1" style={{ gap: `${cellGap}px` }}>
                {mr.ties.map((tie, ti) => (
                  <TieCell key={ti} tie={tie} mr={mr} tb={tb} ts={ts} onClick={onClick} compact />
                ))}
                <EmptySlot show={mr.ties.length === 0} />
              </div>
            </div>
          );
        })}

        {/* Connector arrow left */}
        <div className="text-slate-700 px-0.5 text-xs self-center">›</div>

        {/* FINAL — center, highlighted */}
        <div className="flex flex-col items-center mx-1">
          <div className="text-xs font-bold text-amber-400 text-center mb-2 px-3 py-1 bg-amber-900/20 rounded-lg border border-amber-700/30">
            🏆 决赛
            {finalRound?.completed && <span className="text-green-400 ml-1">✓</span>}
          </div>
          {finalRound?.ties.map((tie, ti) => (
            <TieCell key={ti} tie={tie} mr={finalRound} tb={tb} ts={ts} onClick={onClick} highlight />
          ))}
          <EmptySlot show={!finalRound || finalRound.ties.length === 0} />
        </div>

        {/* Connector arrow right */}
        <div className="text-slate-700 px-0.5 text-xs self-center">‹</div>

        {/* Right half — flows left toward center (reversed order) */}
        {[...rightRounds].reverse().map((mr, ri) => {
          const n = mr.ties.length;
          const cellGap = n <= 1 ? 0 : n <= 2 ? 24 : n <= 4 ? 8 : 2;
          return (
            <div key={`R${ri}`} className="flex flex-col">
              <RoundHeader mr={mr} />
              <div className="flex flex-col justify-around flex-1" style={{ gap: `${cellGap}px` }}>
                {mr.ties.map((tie, ti) => (
                  <TieCell key={ti} tie={tie} mr={mr} tb={tb} ts={ts} onClick={onClick} compact />
                ))}
                <EmptySlot show={mr.ties.length === 0} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoundHeader({ mr }: { mr: MergedRound }) {
  return (
    <div className="text-[10px] sm:text-xs font-semibold text-slate-400 text-center mb-2 px-2 py-0.5 bg-slate-800 rounded border border-slate-700/50 whitespace-nowrap self-center">
      {mr.label}
      {mr.twoLegged && <span className="text-slate-600 ml-1">(两回合)</span>}
      {mr.completed && <span className="text-green-400 ml-1">✓</span>}
    </div>
  );
}

function EmptySlot({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="w-36 sm:w-40 h-[44px] rounded-lg border border-dashed border-slate-700/40 flex items-center justify-center">
      <span className="text-[10px] text-slate-600">待定</span>
    </div>
  );
}

function TieCell({ tie, mr, tb, ts, onClick, compact, highlight }: {
  tie: MergedTie;
  mr: MergedRound;
  tb: Record<string, TeamBase>;
  ts: Record<string, TeamState>;
  onClick: (f: CupFixture) => void;
  compact?: boolean;
  highlight?: boolean;
}) {
  const t1 = tb[tie.team1Id];
  const t2 = tb[tie.team2Id];
  const w1 = tie.winnerId === tie.team1Id;
  const w2 = tie.winnerId === tie.team2Id;
  const hasResult = tie.agg1 !== undefined;
  const derbyName = isDerby(tie.team1Id, tie.team2Id) ? getDerbyName(tie.team1Id, tie.team2Id) : null;

  const clickTarget = (tie.leg2?.result ? tie.leg2 : tie.leg1) ?? tie.leg1;
  const cellW = compact ? 'w-36 sm:w-40' : highlight ? 'w-44 sm:w-52' : 'w-40 sm:w-48';

  return (
    <button
      onClick={() => clickTarget && onClick(clickTarget)}
      className={`${cellW} bg-slate-800 rounded-lg border hover:border-slate-500 transition-all cursor-pointer text-left ${
        highlight ? 'border-amber-600/40 shadow-lg shadow-amber-900/10' : derbyName ? 'border-orange-600/40' : 'border-slate-700'
      }`}
    >
      {derbyName && (
        <div className="text-[8px] text-center py-0.5 bg-orange-900/20 text-orange-400 font-medium rounded-t-lg">{derbyName}</div>
      )}
      {/* Team 1 */}
      <div className={`flex items-center gap-1 px-2 py-1.5 text-xs ${w1 ? 'bg-green-900/20' : ''} rounded-t-lg`}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t1?.color ?? '#555' }} />
        <TeamTag teamId={tie.team1Id} ts={ts} tb={tb} />
        <span className={`flex-1 truncate ${w1 ? 'text-green-400 font-bold' : 'text-slate-200'}`}>
          {t1 ? getTeamName(tie.team1Id, tb) : '待定'}
        </span>
        {hasResult && (
          <span className={`font-bold tabular-nums ${w1 ? 'text-green-400' : 'text-slate-500'}`}>{tie.agg1}</span>
        )}
      </div>

      <div className="border-t border-slate-700/60" />

      {/* Team 2 */}
      <div className={`flex items-center gap-1 px-2 py-1.5 text-xs ${w2 ? 'bg-green-900/20' : ''} ${mr.twoLegged ? '' : 'rounded-b-lg'}`}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t2?.color ?? '#555' }} />
        <TeamTag teamId={tie.team2Id} ts={ts} tb={tb} />
        <span className={`flex-1 truncate ${w2 ? 'text-green-400 font-bold' : 'text-slate-200'}`}>
          {t2 ? getTeamName(tie.team2Id, tb) : '待定'}
        </span>
        {hasResult && (
          <span className={`font-bold tabular-nums ${w2 ? 'text-green-400' : 'text-slate-500'}`}>{tie.agg2}</span>
        )}
      </div>

      {/* Two-legged detail line */}
      {mr.twoLegged && (
        <div className="px-2 py-1 border-t border-slate-700/40 text-[9px] text-slate-500 rounded-b-lg bg-slate-700/10">
          {tie.leg1?.result && tie.leg2?.result ? (
            <span>
              首回合 {tie.leg1.result.home}-{tie.leg1.result.away}
              <span className="mx-1 text-slate-700">|</span>
              次回合 {tie.leg2.result.home}-{tie.leg2.result.away}
              {tie.agg1 === tie.agg2 && tie.awayGoals1 !== undefined && tie.awayGoals2 !== undefined && (
                <span className="ml-1 text-amber-500">
                  {tie.awayGoals1 !== tie.awayGoals2 ? '(客场进球)' : ''}
                </span>
              )}
              {tie.leg2.result.penalties && (
                <span className="ml-1 text-amber-400">点球 {tie.leg2.result.penHome}-{tie.leg2.result.penAway}</span>
              )}
            </span>
          ) : tie.leg1?.result ? (
            <span>
              首回合 {tie.leg1.result.home}-{tie.leg1.result.away}
              <span className="mx-1 text-slate-700">|</span>
              <span className="text-slate-600">次回合待赛</span>
            </span>
          ) : (
            <span className="text-slate-600">两回合待赛</span>
          )}
        </div>
      )}

      {/* Single-leg ET/Pen indicator */}
      {!mr.twoLegged && tie.leg1?.result && (tie.leg1.result.penalties || tie.leg1.result.extraTime) && (
        <div className="text-center text-[9px] text-amber-400 pb-1">
          {tie.leg1.result.penalties ? `点球 ${tie.leg1.result.penHome}-${tie.leg1.result.penAway}` : '加时'}
        </div>
      )}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════
//  Group table
// ══════════════════════════════════════════════════════════════

function GroupTable({ group, tb, ts, onClick }: { group: SuperCupGroup; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  const [showFix, setShowFix] = useState(false);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700 bg-slate-700/30">
        <h4 className="text-sm font-semibold text-slate-200">{group.groupName} 组</h4>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-slate-500 border-b border-slate-700">
            <th className="text-center px-1 py-1 w-5">#</th>
            <th className="text-left px-1 py-1">球队</th>
            <th className="hidden sm:table-cell text-center px-1 py-1">赛</th>
            <th className="hidden sm:table-cell text-center px-1 py-1">胜</th>
            <th className="hidden sm:table-cell text-center px-1 py-1">平</th>
            <th className="hidden sm:table-cell text-center px-1 py-1">负</th>
            <th className="text-center px-1 py-1">净胜</th>
            <th className="text-center px-1 py-1 font-semibold">分</th>
          </tr>
        </thead>
        <tbody>
          {group.standings.map((e, i) => (
            <tr key={e.teamId} className={`border-t border-slate-700/50 ${i < 2 ? 'bg-green-900/10' : ''}`}>
              <td className="text-center px-1 py-1.5 text-slate-500">{i + 1}</td>
              <td className="px-1 py-1.5">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tb[e.teamId]?.color ?? '#666' }} />
                  <TeamTag teamId={e.teamId} ts={ts} tb={tb} />
                  <Link to={`/team/${e.teamId}`} className="text-slate-200 hover:text-blue-400 truncate">{getTeamName(e.teamId, tb)}</Link>
                </div>
              </td>
              <td className="hidden sm:table-cell text-center px-1 py-1.5 text-slate-400">{e.played}</td>
              <td className="hidden sm:table-cell text-center px-1 py-1.5 text-slate-300">{e.won}</td>
              <td className="hidden sm:table-cell text-center px-1 py-1.5 text-slate-300">{e.drawn}</td>
              <td className="hidden sm:table-cell text-center px-1 py-1.5 text-slate-300">{e.lost}</td>
              <td className="text-center px-1 py-1.5 text-slate-300">{e.goalDifference > 0 ? `+${e.goalDifference}` : e.goalDifference}</td>
              <td className="text-center px-1 py-1.5 font-bold text-slate-100">{e.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Qualification line */}
      <div className="px-3 py-1 border-t border-slate-700/50 text-[9px] text-slate-600">
        前2名晋级 (绿色高亮)
      </div>
      {group.fixtures.length > 0 && (
        <div className="border-t border-slate-700">
          <button onClick={() => setShowFix(!showFix)} className="w-full px-3 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 cursor-pointer transition-colors">
            {showFix ? '收起赛程 ▲' : `查看赛程 (${group.fixtures.length}场) ▼`}
          </button>
          {showFix && (
            <div className="p-2 space-y-0.5 max-h-48 overflow-y-auto">
              {group.fixtures.map(fix => {
                const has = !!fix.result;
                return (
                  <button key={fix.id} onClick={() => onClick(fix)} className="w-full flex items-center text-xs py-1 px-2 rounded hover:bg-slate-700/40 cursor-pointer text-left">
                    <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
                      <TeamTag teamId={fix.homeTeamId} ts={ts} tb={tb} />
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tb[fix.homeTeamId]?.color ?? '#666' }} />
                      <span className="text-slate-300 truncate">{getTeamName(fix.homeTeamId, tb)}</span>
                    </div>
                    <span className="px-2 text-slate-100 font-bold shrink-0">
                      {has ? `${fix.result!.home} - ${fix.result!.away}` : 'vs'}
                    </span>
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tb[fix.awayTeamId]?.color ?? '#666' }} />
                      <span className="text-slate-300 truncate">{getTeamName(fix.awayTeamId, tb)}</span>
                      <TeamTag teamId={fix.awayTeamId} ts={ts} tb={tb} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
function WinnerBadge({ name, color }: { name: string; color?: string }) {
  return (
    <span className="text-sm px-3 py-1 rounded-full border font-semibold" style={{
      backgroundColor: (color ?? '#f59e0b') + '20',
      borderColor: (color ?? '#f59e0b') + '60',
      color: color ?? '#fbbf24',
    }}>
      冠军: {name}
    </span>
  );
}
