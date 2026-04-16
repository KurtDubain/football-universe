import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName } from '../utils/format';
import type { CupState, SuperCupState, WorldCupState, CupRound, SuperCupGroup, CupFixture } from '../types/cup';
import type { MatchFixture, MatchResult } from '../types/match';
import type { TeamBase, TeamState } from '../types/team';
import MatchDetailModal from '../components/MatchDetailModal';

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

function TeamTag({ teamId, ts }: { teamId: string; ts: Record<string, TeamState> }) {
  const lv = ts[teamId]?.leagueLevel;
  if (!lv) return null;
  const t = levelTag[lv];
  return t ? <span className={`text-[9px] px-1 py-0.5 rounded font-medium shrink-0 ${t.cls}`}>{t.text}</span> : null;
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
        '参赛: 综合实力前16的球队',
        '小组赛: 4组×4队，双循环6轮，全部16队晋级淘汰赛',
        '淘汰赛: 按小组排名配对 (第1 vs 第16)，单场定胜负',
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
//  Bracket — horizontal tree
// ══════════════════════════════════════════════════════════════

function BracketView({ rounds, tb, ts, onClick }: { rounds: CupRound[]; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  if (rounds.length === 0) return <p className="text-sm text-slate-500">淘汰赛尚未开始</p>;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 sm:gap-5 min-w-max items-start">
        {rounds.map((round) => {
          const n = round.fixtures.length;
          const cellGap = n <= 1 ? 0 : n <= 2 ? 40 : n <= 4 ? 16 : n <= 8 ? 6 : 3;

          return (
            <div key={round.roundNumber} className="flex flex-col">
              <div className="text-[10px] sm:text-xs font-semibold text-slate-400 text-center mb-2 px-2 py-0.5 bg-slate-800 rounded border border-slate-700/50 whitespace-nowrap self-center">
                {cnRound(round.roundName)}
                {round.completed && <span className="text-green-400 ml-1">&#10003;</span>}
              </div>
              <div className="flex flex-col justify-around flex-1" style={{ gap: `${cellGap}px` }}>
                {round.fixtures.map(fix => (
                  <BracketCell key={fix.id} fixture={fix} tb={tb} ts={ts} onClick={() => onClick(fix)} />
                ))}
                {round.fixtures.length === 0 && (
                  <div className="w-40 sm:w-48 h-[52px] rounded-lg border border-dashed border-slate-700/50 flex items-center justify-center">
                    <span className="text-[10px] text-slate-600">待定</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketCell({ fixture: f, tb, ts, onClick }: { fixture: CupFixture; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: () => void }) {
  const has = !!f.result;
  const hw = f.winnerId === f.homeTeamId;
  const aw = f.winnerId === f.awayTeamId;
  const ht = tb[f.homeTeamId];
  const at = tb[f.awayTeamId];

  return (
    <button
      onClick={onClick}
      className="w-40 sm:w-48 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors cursor-pointer text-left"
    >
      <div className={`flex items-center gap-1 px-2 py-1.5 text-xs ${hw ? 'bg-green-900/20' : ''} rounded-t-lg`}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ht?.color ?? '#555' }} />
        <TeamTag teamId={f.homeTeamId} ts={ts} />
        <span className={`flex-1 truncate ${hw ? 'text-green-400 font-bold' : 'text-slate-200'}`}>
          {ht ? getTeamName(f.homeTeamId, tb) : '待定'}
        </span>
        {has && <span className={`font-bold tabular-nums ${hw ? 'text-green-400' : 'text-slate-500'}`}>{f.result!.home}</span>}
      </div>
      <div className="border-t border-slate-700/60" />
      <div className={`flex items-center gap-1 px-2 py-1.5 text-xs ${aw ? 'bg-green-900/20' : ''} rounded-b-lg`}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: at?.color ?? '#555' }} />
        <TeamTag teamId={f.awayTeamId} ts={ts} />
        <span className={`flex-1 truncate ${aw ? 'text-green-400 font-bold' : 'text-slate-200'}`}>
          {at ? getTeamName(f.awayTeamId, tb) : '待定'}
        </span>
        {has && <span className={`font-bold tabular-nums ${aw ? 'text-green-400' : 'text-slate-500'}`}>{f.result!.away}</span>}
      </div>
      {has && (f.result!.penalties || f.result!.extraTime) && (
        <div className="text-center text-[9px] text-amber-400 pb-1">
          {f.result!.penalties ? `点球 ${f.result!.penHome}-${f.result!.penAway}` : '加时'}
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
                  <TeamTag teamId={e.teamId} ts={ts} />
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
                      <TeamTag teamId={fix.homeTeamId} ts={ts} />
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tb[fix.homeTeamId]?.color ?? '#666' }} />
                      <span className="text-slate-300 truncate">{getTeamName(fix.homeTeamId, tb)}</span>
                    </div>
                    <span className="px-2 text-slate-100 font-bold shrink-0">
                      {has ? `${fix.result!.home} - ${fix.result!.away}` : 'vs'}
                    </span>
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tb[fix.awayTeamId]?.color ?? '#666' }} />
                      <span className="text-slate-300 truncate">{getTeamName(fix.awayTeamId, tb)}</span>
                      <TeamTag teamId={fix.awayTeamId} ts={ts} />
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
