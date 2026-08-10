import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getTeamShortName } from '../utils/format';
import type { CupState, SuperCupState, WorldCupState, WorldCupEdition, ContinentalCupState, SuperCupGroup, CupFixture } from '../types/cup';
import type { MatchFixture, MatchResult } from '../types/match';
import type { TeamBase, TeamState } from '../types/team';
import MatchDetailModal from '../components/MatchDetailModal';
import TeamBadge from '../components/TeamBadge';
import { CompetitionMark, TrophyMark, type CompetitionIdentityKey } from '../components/FootballIdentity';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { applyVenuePolicy } from '../engine/competitions/venue-policy';
import worldCupArtwork from '../assets/visual/match-opener-world-v1.webp';
import WorldCupMusicControl from '../components/WorldCupMusicControl';
import { BracketView, CupTeamTag as TeamTag } from '../components/CupBracket';

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
    const mf: MatchFixture = applyVenuePolicy({
      id: fix.id, homeTeamId: fix.homeTeamId, awayTeamId: fix.awayTeamId,
      competitionType: ct,
      competitionName: compName, roundLabel: fix.roundName,
      ...(fix.tournamentHostTeamId ? { tournamentHostTeamId: fix.tournamentHostTeamId } : {}),
    });
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
        isNeutralVenue: mf.isNeutralVenue,
        ...(mf.tournamentHostTeamId ? { tournamentHostTeamId: mf.tournamentHostTeamId } : {}),
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
        ? <WorldCupView cup={world.worldCup} editions={world.worldCupEditions ?? []} seasonNumber={world.seasonState.seasonNumber} tb={tb} ts={ts} musicEnabled={!selectedFixture} onClick={f => handleClick(f, '环球冠军杯')} />
        : <WorldCupInactive editions={world.worldCupEditions ?? []} seasonNumber={world.seasonState.seasonNumber} musicEnabled={!selectedFixture} tb={tb} />
      )}
      {isContinental && (continentalCup
        ? <ContinentalCupView cup={continentalCup} tb={tb} ts={ts} onClick={f => handleClick(f, continentalCup.name)} />
        : <InactiveCup type={type as CompetitionIdentityKey} title={type === 'mainland_cup' ? '大陆杯' : type === 'southern_cup' ? '南洲杯' : '东洲杯'} description="洲际杯从第5赛季起每六个赛季举行一次，本赛季处于赛事间歇期。" />
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
        '赛制: 中立场单回合淘汰，平局进入加时 + 点球',
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
  const teamCount = cup.participantIds.length;
  const isLegacySelectiveFormat = cup.region === '大陆' ? teamCount === 8 : teamCount === 4;
  const identityType: CompetitionIdentityKey = cup.type;
  return (
    <>
      <CupHeader type={identityType} title={cup.name} description={`${cup.region}地区 · ${teamCount} 队 · 六年一届`} winnerId={cup.completed ? cup.winnerId : undefined} tb={tb} />
      <RulesCard lines={[
        isLegacySelectiveFormat
          ? `参赛: ${cup.region}地区旧赛制积分入围的 ${teamCount} 队（本届结束后启用全员赛制）`
          : `参赛: ${cup.region}全部 ${teamCount} 支球队，俱乐部积分仅用于分档和同分排序`,
        '小组赛: 4队单循环3轮，全部为中立场',
        cup.groups.length >= 4
          ? '晋级: 各组前2进入单回合八强、四强与决赛'
          : cup.groups.length === 2
            ? '晋级: 各组前2进入单回合四强与决赛'
            : '晋级: 小组前2进入单回合决赛',
        '淘汰赛: 中立场，平局进入加时 + 点球',
        '第5赛季起每六个赛季举办一次（S5、S11、S17…）',
      ]} />
      <h2 className="text-sm font-semibold text-slate-300">小组赛</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cup.groups.map(g => <GroupTable key={g.groupName} group={g} tb={tb} ts={ts} onClick={onClick} />)}
      </div>
      {cup.rounds.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-300 mt-1">淘汰赛</h2>
          <BracketView rounds={cup.rounds} tb={tb} ts={ts} onClick={onClick} />
        </>
      )}
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

function WorldCupView({ cup, editions, seasonNumber, tb, ts, musicEnabled, onClick }: { cup: WorldCupState; editions: WorldCupEdition[]; seasonNumber: number; tb: Record<string, TeamBase>; ts: Record<string, TeamState>; musicEnabled: boolean; onClick: (f: CupFixture) => void }) {
  const edition = editions.find(item => item.seasonNumber === seasonNumber);
  return (
    <>
      <CupHeader type="world_cup" title="环球冠军杯" description={`${cup.participantIds.length} 队 · 四年一届`} winnerId={cup.completed ? cup.winnerId : undefined} tb={tb} />
      {cup.hostTeamId && (
        <WorldCupHostFeature
          hostTeamId={cup.hostTeamId}
          seasonNumber={edition?.seasonNumber}
          hostResult={edition?.hostResult}
          tb={tb}
          active
          musicEnabled={musicEnabled}
          musicScene={cup.completed ? 'world_cup_champion' : 'world_cup'}
          statusLabel={cup.completed ? '本届已结束' : cup.groupStageCompleted ? '淘汰赛进行中' : '小组赛进行中'}
        />
      )}
      <RulesCard lines={[
        '参赛: 全部32支球队',
        '抽签: 4档分组 (按实力排位)，每组2顶+1甲+1乙',
        '小组赛: 8组×4队，中立场单循环3轮，每组前2名晋级16强',
        '淘汰赛: 16强→八强→四强→决赛，中立场单回合',
        '东道主: 全部球队均可主办；东道主比赛获得4%赛会氛围加成，但不叠加普通主场优势',
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
      <WorldCupEditionHistory editions={editions} tb={tb} />
    </>
  );
}

function WorldCupInactive({ editions, seasonNumber, musicEnabled, tb }: {
  editions: WorldCupEdition[];
  seasonNumber: number;
  musicEnabled: boolean;
  tb: Record<string, TeamBase>;
}) {
  const current = editions.find(edition => edition.seasonNumber === seasonNumber);
  const latest = current ?? editions.at(-1);
  return (
    <>
      <PageHeader icon={<CompetitionMark type="world_cup" size={54} title="环球冠军杯徽记" />} title="环球冠军杯" description="四年一届的世界舞台" />
      {latest && (
        <WorldCupHostFeature
          hostTeamId={latest.hostTeamId}
          seasonNumber={latest.seasonNumber}
          hostResult={latest.hostResult}
          tb={tb}
          active={Boolean(current)}
          musicEnabled={Boolean(current) && musicEnabled}
          statusLabel={current ? '等待开幕' : undefined}
        />
      )}
      <EmptyState
        icon={<CompetitionMark type="world_cup" size={44} />}
        title={current ? '本届赛事尚未开幕' : '本赛季未举办'}
        description={current
          ? '东道主已经揭晓，联赛赛季结束后将进入3轮小组赛和单场淘汰赛。'
          : '环球冠军杯每四个赛季举行一次；主办地会在世界杯赛季开始时揭晓。'}
      />
      <WorldCupEditionHistory editions={editions} tb={tb} />
    </>
  );
}

function WorldCupHostFeature({ hostTeamId, seasonNumber, hostResult, tb, active, musicEnabled, musicScene = 'world_cup', statusLabel }: {
  hostTeamId: string;
  seasonNumber?: number;
  hostResult?: string;
  tb: Record<string, TeamBase>;
  active: boolean;
  musicEnabled: boolean;
  musicScene?: 'world_cup' | 'world_cup_champion';
  statusLabel?: string;
}) {
  const host = tb[hostTeamId];
  if (!host) return null;
  return (
    <section className="relative min-h-48 overflow-hidden rounded-lg border border-emerald-700/45 bg-slate-950" data-testid="world-cup-host-feature">
      <img src={worldCupArtwork} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
      <div className="absolute inset-0 bg-slate-950/55" />
      <div className="relative flex min-h-48 flex-col justify-end gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-emerald-300">第 {seasonNumber ?? '-'} 赛季 · 世界杯东道主</div>
          <Link to={`/team/${hostTeamId}`} className="mt-3 flex min-w-0 items-center gap-3 hover:text-emerald-300">
            <TeamBadge teamId={host.id} shortName={host.shortName} color={host.color} size={58} />
            <span className="min-w-0">
              <span className="block text-2xl font-bold text-white sm:text-3xl">{host.name}</span>
              <span className="mt-1 block text-xs text-slate-300">{host.region.replace('+', ' · ')}</span>
            </span>
          </Link>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          {active && <WorldCupMusicControl scene={musicScene} enabled={musicEnabled} />}
          <div className="flex flex-wrap gap-2 text-xs sm:justify-end">
            <span className="rounded border border-emerald-500/45 bg-emerald-950/75 px-2.5 py-1.5 font-semibold text-emerald-200">赛会氛围 +4%</span>
            <span className="rounded border border-slate-500/45 bg-slate-950/75 px-2.5 py-1.5 text-slate-200">常规主场优势关闭</span>
            {hostResult && <span className="rounded border border-amber-500/45 bg-amber-950/75 px-2.5 py-1.5 text-amber-200">东道主成绩：{hostResult}</span>}
            {!hostResult && statusLabel && <span className="rounded border border-sky-500/45 bg-sky-950/75 px-2.5 py-1.5 text-sky-200">{statusLabel}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function WorldCupEditionHistory({ editions, tb }: { editions: WorldCupEdition[]; tb: Record<string, TeamBase> }) {
  if (editions.length === 0) return null;
  return (
    <section aria-labelledby="world-cup-edition-history-title">
      <h2 id="world-cup-edition-history-title" className="mb-2 text-sm font-semibold text-slate-300">历届主办与冠军</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="bg-slate-800/80 text-slate-500">
            <tr><th className="px-3 py-2 text-left">赛季</th><th className="px-3 py-2 text-left">东道主</th><th className="px-3 py-2 text-left">东道主成绩</th><th className="px-3 py-2 text-left">冠军</th><th className="px-3 py-2 text-left">亚军</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900/45">
            {[...editions].reverse().slice(0, 8).map(edition => (
              <tr key={edition.seasonNumber}>
                <td className="px-3 py-2 font-semibold text-slate-300">S{edition.seasonNumber}</td>
                <td className="px-3 py-2"><Link to={`/team/${edition.hostTeamId}`} className="text-emerald-300 hover:text-emerald-200">{getTeamShortName(edition.hostTeamId, tb)}</Link></td>
                <td className="px-3 py-2 text-slate-400">{edition.hostResult ?? '待开幕'}</td>
                <td className="px-3 py-2 text-amber-300">{edition.winnerId ? getTeamShortName(edition.winnerId, tb) : '—'}</td>
                <td className="px-3 py-2 text-slate-400">{edition.runnerUpId ? getTeamShortName(edition.runnerUpId, tb) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
                  <button
                    key={fix.id}
                    type="button"
                    data-fixture-id={fix.id}
                    onClick={() => onClick(fix)}
                    className="flex w-full cursor-pointer items-center rounded px-2 py-1 text-left text-xs hover:bg-slate-700/40"
                  >
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
