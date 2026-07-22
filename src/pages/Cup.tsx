import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getTeamShortName, getTierLabel, getTierColor } from '../utils/format';
import type { CupState, SuperCupState, WorldCupState, ContinentalCupState, CupRound, SuperCupGroup, CupFixture } from '../types/cup';
import type { MatchFixture, MatchResult } from '../types/match';
import type { TeamBase, TeamState } from '../types/team';
import MatchDetailModal from '../components/MatchDetailModal';
import { isDerby, getDerbyName } from '../config/derbies';
import TeamBadge from '../components/TeamBadge';
import { CompetitionMark, TrophyMark, type CompetitionIdentityKey } from '../components/FootballIdentity';
import { EmptyState, PageHeader, PageShell } from '../components/ui';

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
  const region = tb?.[teamId]?.region?.split('+')[1];
  if (!lv && !tier) return null;
  const t = lv ? levelTag[lv] : null;
  return (
    <span className="flex gap-0.5 shrink-0">
      {t && <span className={`px-1 py-0.5 text-[11px] rounded font-medium ${t.cls}`}>{t.text}</span>}
      {tier && <span className={`px-1 py-0.5 text-[11px] rounded font-medium ${getTierColor(tier)}`}>{getTierLabel(tier)}</span>}
      {region && <span className="rounded bg-slate-700/50 px-1 py-0.5 text-[11px] text-slate-400">{region}</span>}
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

  const isContinental = type === 'mainland_cup' || type === 'southern_cup' || type === 'eastern_cup';

  const handleClick = (fix: CupFixture, compName: string) => {
    const ct: MatchFixture['competitionType'] =
      type === 'world_cup' ? 'world_cup'
      : type === 'super_cup' ? 'super_cup'
      : isContinental ? 'continental_cup'
      : 'league_cup';
    const mf: MatchFixture = {
      id: fix.id, homeTeamId: fix.homeTeamId, awayTeamId: fix.awayTeamId,
      competitionType: ct,
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
  const tb = world.teamBases;
  const ts = world.teamStates;

  const continentalCup = type === 'mainland_cup' ? world.continentalCups?.mainland_cup
    : type === 'southern_cup' ? world.continentalCups?.southern_cup
    : type === 'eastern_cup' ? world.continentalCups?.eastern_cup
    : null;

  return (
    <PageShell width="wide" className="tabular-nums">
      {type === 'league_cup' && <LeagueCupView cup={world.leagueCup} tb={tb} ts={ts} onClick={f => handleClick(f, '联赛杯')} />}
      {type === 'super_cup' && <SuperCupView cup={world.superCup} tb={tb} ts={ts} onClick={f => handleClick(f, '超级杯')} />}
      {type === 'world_cup' && (world.worldCup
        ? <WorldCupView cup={world.worldCup} tb={tb} ts={ts} onClick={f => handleClick(f, '环球冠军杯')} />
        : <InactiveCup type="world_cup" title="环球冠军杯" description="每四个赛季举行一次，本赛季处于赛事间歇期。" />
      )}
      {isContinental && (continentalCup
        ? <ContinentalCupView cup={continentalCup} tb={tb} ts={ts} onClick={f => handleClick(f, continentalCup.name)} />
        : <InactiveCup type={type as CompetitionIdentityKey} title={type === 'mainland_cup' ? '大陆杯' : type === 'southern_cup' ? '南洲杯' : '东洲杯'} description="洲际杯每四个赛季举行一次，本赛季处于赛事间歇期。" />
      )}
      <MatchDetailModal isOpen={!!selectedFixture} onClose={close} fixture={selectedFixture ?? undefined} result={selectedResult ?? undefined} world={world} />
    </PageShell>
  );
}

// ══════════════════════════════════════════════════════════════
//  League Cup
// ══════════════════════════════════════════════════════════════

function LeagueCupView({ cup, tb, ts, onClick }: { cup: CupState; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  return (
    <>
      <CupHeader type="league_cup" title={cup.name} description="32 队单场淘汰赛" winnerId={cup.completed ? cup.winnerId : undefined} tb={tb} />
      {/* Rules */}
      <RulesCard lines={[
        '参赛: 全部 32 支球队 (顶级16 + 甲级8 + 乙级8)',
        '赛制: 单场淘汰制，平局进入加时 + 点球',
        '轮次: 第一轮(32→16) → 第二轮(16→8) → 八强 → 四强 → 决赛',
      ]} />
      <BracketView rounds={cup.rounds} tb={tb} ts={ts} onClick={onClick} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  Continental Cup (大陆杯 / 南洲杯 / 东洲杯)
// ══════════════════════════════════════════════════════════════

function ContinentalCupView({ cup, tb, ts, onClick }: { cup: ContinentalCupState; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  const teamCount = cup.region === '大陆' ? 8 : 4;
  const identityType: CompetitionIdentityKey = cup.type;
  return (
    <>
      <CupHeader type={identityType} title={cup.name} description={`${cup.region}地区 · ${teamCount} 队 · 四年一届`} winnerId={cup.completed ? cup.winnerId : undefined} tb={tb} />
      <RulesCard lines={[
        `参赛: ${cup.region}地区俱乐部积分前 ${teamCount} 名`,
        '赛制: 单场淘汰制，平局进入加时 + 点球',
        cup.region === '大陆'
          ? '轮次: 八强 → 四强 → 决赛'
          : '轮次: 四强 → 决赛',
        '每四个赛季举办一次（S2、S6、S10…）',
      ]} />
      <BracketView rounds={cup.rounds} tb={tb} ts={ts} onClick={onClick} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  Super Cup
// ══════════════════════════════════════════════════════════════

function SuperCupView({ cup, tb, ts, onClick }: { cup: SuperCupState; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  return (
    <>
      <CupHeader type="super_cup" title="超级杯" description="16 队 · 小组赛与两回合淘汰赛" winnerId={cup.completed ? cup.winnerId : undefined} tb={tb} />
      <RulesCard lines={[
        '参赛: 16 支球队 — 顶级联赛前10 + 甲级前4 + 乙级前2',
        '小组赛: 4组×4队，双循环6轮，小组前2名晋级八强',
        '淘汰赛: 八强/四强为主客场两回合制，决赛单场定胜负',
        cup.awayGoalRule ? '规则: 客场进球规则生效' : '规则: 客场进球规则未启用',
      ]} />
      <h2 className="text-sm font-semibold text-slate-300">小组赛</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cup.groups.map(g => <GroupTable key={g.groupName} group={g} tb={tb} ts={ts} onClick={onClick} />)}
      </div>
      {cup.knockoutRounds.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-300 mt-1">淘汰赛</h2>
          <BracketView rounds={cup.knockoutRounds} tb={tb} ts={ts} onClick={onClick} />
        </>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  World Cup
// ══════════════════════════════════════════════════════════════

function WorldCupView({ cup, tb, ts, onClick }: { cup: WorldCupState; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  return (
    <>
      <CupHeader type="world_cup" title="环球冠军杯" description={`${cup.participantIds.length} 队 · 四年一届`} winnerId={cup.completed ? cup.winnerId : undefined} tb={tb} />
      <RulesCard lines={[
        '参赛: 全部32支球队',
        '抽签: 4档分组 (按实力排位)，每组2顶+1甲+1乙',
        '小组赛: 8组×4队，双循环6轮，每组前2名晋级16强',
        '淘汰赛: 16强→八强→四强→决赛，单场定胜负',
        '每4个赛季举办一次',
      ]} />
      <h2 className="text-sm font-semibold text-slate-300">小组赛</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cup.groups.map(g => <GroupTable key={g.groupName} group={g} tb={tb} ts={ts} onClick={onClick} />)}
      </div>
      {cup.knockoutRounds.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-300 mt-1">淘汰赛</h2>
          <BracketView rounds={cup.knockoutRounds} tb={tb} ts={ts} onClick={onClick} />
        </>
      )}
    </>
  );
}

function CupHeader({ type, title, description, winnerId, tb }: {
  type: CompetitionIdentityKey;
  title: string;
  description: string;
  winnerId?: string;
  tb: Record<string, TeamBase>;
}) {
  return (
    <PageHeader
      icon={<CompetitionMark type={type} size={54} title={`${title}徽记`} />}
      title={title}
      description={description}
      actions={winnerId ? <WinnerBadge teamId={winnerId} tb={tb} type={type} /> : undefined}
    />
  );
}

function InactiveCup({ type, title, description }: { type: CompetitionIdentityKey; title: string; description: string }) {
  return (
    <>
      <PageHeader icon={<CompetitionMark type={type} size={54} title={`${title}徽记`} />} title={title} description="周期赛事" />
      <EmptyState icon={<CompetitionMark type={type} size={44} />} title="本赛季未举办" description={description} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  Rules card
// ══════════════════════════════════════════════════════════════

function RulesCard({ lines }: { lines: string[] }) {
  return (
    <details className="competition-rules">
      <summary>赛事规则</summary>
      <div className="space-y-1 px-3 pb-3">
        {lines.map((line, i) => (
          <p key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
            <span className="text-slate-600 shrink-0">·</span>
            {line}
          </p>
        ))}
      </div>
    </details>
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

export function BracketView({ rounds, tb, ts, onClick }: { rounds: CupRound[]; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; onClick: (f: CupFixture) => void }) {
  if (rounds.length === 0) return <p className="text-sm text-slate-500">淘汰赛尚未开始</p>;

  const merged = buildMergedRounds(rounds);

  return (
    <MobileBracket
      key={merged.map(round => `${round.label}:${round.ties.length}:${round.completed}`).join('|')}
      merged={merged}
      tb={tb}
      ts={ts}
      onClick={onClick}
    />
  );
}

export function MobileBracket({ merged, tb, ts, onClick }: {
  merged: MergedRound[];
  tb: Record<string, TeamBase>;
  ts: Record<string, TeamState>;
  onClick: (f: CupFixture) => void;
}) {
  const defaultRound = merged.find(round => !round.completed)?.label ?? merged.at(-1)?.label ?? '';
  const [selectedLabel, setSelectedLabel] = useState(defaultRound);
  const selectedRound = merged.find(round => round.label === selectedLabel) ?? merged[0];

  return (
    <div className="pb-4">
      {merged.length > 1 && (
        <div role="tablist" aria-label="杯赛轮次" className="ui-cup-round-tabs">
          {merged.map(round => (
            <button
              key={round.label}
              type="button"
              role="tab"
              aria-selected={round.label === selectedRound.label}
              onClick={() => setSelectedLabel(round.label)}
              className={`min-h-11 px-3 rounded-md border text-xs whitespace-nowrap transition-colors cursor-pointer sm:min-h-9 ${
                round.label === selectedRound.label
                  ? 'border-[var(--action)] bg-[var(--action)] text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
            >
              {round.label}
              {round.completed && <span className="ml-1 text-green-300">✓</span>}
            </button>
          ))}
        </div>
      )}

      <div role="tabpanel" className="rounded-lg border border-slate-700/70 bg-slate-800/30 p-2 sm:p-3">
        <RoundHeader mr={selectedRound} />
        <div className={`grid gap-2 ${selectedRound.ties.length === 1 ? 'grid-cols-1 max-w-xl mx-auto' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
          {selectedRound.ties.map((tie, index) => (
            <TieCell
              key={index}
              tie={tie}
              mr={selectedRound}
              tb={tb}
              ts={ts}
              onClick={onClick}
              fluid
              compactName
            />
          ))}
          {selectedRound.ties.length === 0 && (
            <div className="col-span-full h-14 rounded-lg border border-dashed border-slate-700/50 flex items-center justify-center text-xs text-slate-600">
              待定
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RoundHeader({ mr }: { mr: MergedRound }) {
  return (
    <div className="mb-2 self-center whitespace-nowrap rounded border border-slate-700/50 bg-slate-800 px-2 py-1 text-center text-[11px] font-semibold text-slate-300 sm:text-xs">
      {mr.label}
      {mr.twoLegged && <span className="text-slate-600 ml-1">(两回合)</span>}
      {mr.completed && <span className="text-green-400 ml-1">✓</span>}
    </div>
  );
}

function TieCell({ tie, mr, tb, ts, onClick, fluid, compactName }: {
  tie: MergedTie;
  mr: MergedRound;
  tb: Record<string, TeamBase>;
  ts: Record<string, TeamState>;
  onClick: (f: CupFixture) => void;
  fluid?: boolean;
  compactName?: boolean;
}) {
  const t1 = tb[tie.team1Id];
  const t2 = tb[tie.team2Id];
  const w1 = tie.winnerId === tie.team1Id;
  const w2 = tie.winnerId === tie.team2Id;
  const hasResult = tie.agg1 !== undefined;
  const derbyName = isDerby(tie.team1Id, tie.team2Id, tb) ? getDerbyName(tie.team1Id, tie.team2Id, tb) : null;

  const clickTarget = (tie.leg2?.result ? tie.leg2 : tie.leg1) ?? tie.leg1;
  const cellW = fluid ? 'w-full min-w-0' : 'w-30 sm:w-40';

  return (
    <button
      onClick={() => clickTarget && onClick(clickTarget)}
      type="button"
      className={`${cellW} min-h-11 bg-slate-800 rounded-lg border hover:border-slate-500 transition-all cursor-pointer text-left ${
        derbyName ? 'border-orange-600/40' : 'border-slate-700'
      }`}
    >
      {derbyName && (
        <div className="rounded-t-lg bg-orange-900/20 py-0.5 text-center text-[11px] font-medium text-orange-300">{derbyName}</div>
      )}
      {/* Team 1 */}
      <div className={`flex items-center gap-1 px-2 py-1.5 text-xs ${w1 ? 'bg-green-900/20' : ''} rounded-t-lg`}>
        {t1 ? <TeamBadge teamId={tie.team1Id} shortName={t1.shortName} color={t1.color} size={18} /> : <span className="h-2 w-2 shrink-0 rounded-full bg-slate-600" />}
        <span className={compactName ? 'hidden sm:inline-flex' : 'inline-flex'}>
          <TeamTag teamId={tie.team1Id} ts={ts} tb={tb} />
        </span>
        <span className={`flex-1 truncate ${w1 ? 'text-green-400 font-bold' : 'text-slate-200'}`} title={t1?.name}>
          {t1 ? (compactName ? <><span className="sm:hidden">{getTeamShortName(tie.team1Id, tb)}</span><span className="cup-team-full-name hidden sm:inline" data-team-name={getTeamName(tie.team1Id, tb)} aria-label={getTeamName(tie.team1Id, tb)} /></> : getTeamName(tie.team1Id, tb)) : '待定'}
        </span>
        {hasResult && (
          <span className={`font-bold tabular-nums ${w1 ? 'text-green-400' : 'text-slate-500'}`}>{tie.agg1}</span>
        )}
      </div>

      <div className="border-t border-slate-700/60" />

      {/* Team 2 */}
      <div className={`flex items-center gap-1 px-2 py-1.5 text-xs ${w2 ? 'bg-green-900/20' : ''} ${mr.twoLegged ? '' : 'rounded-b-lg'}`}>
        {t2 ? <TeamBadge teamId={tie.team2Id} shortName={t2.shortName} color={t2.color} size={18} /> : <span className="h-2 w-2 shrink-0 rounded-full bg-slate-600" />}
        <span className={compactName ? 'hidden sm:inline-flex' : 'inline-flex'}>
          <TeamTag teamId={tie.team2Id} ts={ts} tb={tb} />
        </span>
        <span className={`flex-1 truncate ${w2 ? 'text-green-400 font-bold' : 'text-slate-200'}`} title={t2?.name}>
          {t2 ? (compactName ? <><span className="sm:hidden">{getTeamShortName(tie.team2Id, tb)}</span><span className="cup-team-full-name hidden sm:inline" data-team-name={getTeamName(tie.team2Id, tb)} aria-label={getTeamName(tie.team2Id, tb)} /></> : getTeamName(tie.team2Id, tb)) : '待定'}
        </span>
        {hasResult && (
          <span className={`font-bold tabular-nums ${w2 ? 'text-green-400' : 'text-slate-500'}`}>{tie.agg2}</span>
        )}
      </div>

      {/* Two-legged detail line */}
      {mr.twoLegged && (
        <div className="rounded-b-lg border-t border-slate-700/40 bg-slate-700/10 px-2 py-1 text-[11px] text-slate-500">
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
        <div className="pb-1 text-center text-[11px] text-amber-400">
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
    <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
      <div className="px-3 py-2 border-b border-slate-700 bg-slate-700/30">
        <h4 className="text-sm font-semibold text-slate-200">{group.groupName} 组</h4>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700 text-[11px] text-slate-500">
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
                  {tb[e.teamId] && <TeamBadge teamId={e.teamId} shortName={tb[e.teamId].shortName} color={tb[e.teamId].color} size={18} />}
                  <TeamTag teamId={e.teamId} ts={ts} tb={tb} />
                  <Link to={`/team/${e.teamId}`} className="text-slate-200 hover:text-blue-400 whitespace-nowrap" title={getTeamName(e.teamId, tb)}>{getTeamShortName(e.teamId, tb)}</Link>
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
      <div className="border-t border-slate-700/50 px-3 py-1.5 text-[11px] text-slate-500">
        前2名晋级 (绿色高亮)
      </div>
      {group.fixtures.length > 0 && (
        <div className="border-t border-slate-700">
          <button type="button" onClick={() => setShowFix(!showFix)} className="min-h-11 w-full px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/30 cursor-pointer transition-colors">
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
                      <span className="text-slate-300 whitespace-nowrap" title={getTeamName(fix.homeTeamId, tb)}>{getTeamShortName(fix.homeTeamId, tb)}</span>
                    </div>
                    <span className="px-2 text-slate-100 font-bold shrink-0">
                      {has ? `${fix.result!.home} - ${fix.result!.away}` : 'vs'}
                    </span>
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tb[fix.awayTeamId]?.color ?? '#666' }} />
                      <span className="text-slate-300 whitespace-nowrap" title={getTeamName(fix.awayTeamId, tb)}>{getTeamShortName(fix.awayTeamId, tb)}</span>
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
function WinnerBadge({ teamId, tb, type }: { teamId: string; tb: Record<string, TeamBase>; type: CompetitionIdentityKey }) {
  const team = tb[teamId];
  return (
    <Link to={`/team/${teamId}`} className="competition-champion" title={`冠军：${getTeamName(teamId, tb)}`}>
      <TrophyMark type={type} size={28} />
      {team && <TeamBadge teamId={teamId} shortName={team.shortName} color={team.color} size={28} />}
      <span><small>卫冕冠军</small><strong>{getTeamName(teamId, tb)}</strong></span>
    </Link>
  );
}
