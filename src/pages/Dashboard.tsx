import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { predictMatch } from '../engine/match/prediction';
import type { MatchFixture, MatchResult } from '../types/match';
import type { GameWorld } from '../engine/season/season-manager';
import MatchDetailModal from '../components/MatchDetailModal';
import SeasonReview from '../components/SeasonReview';
import Celebration, { getMatchTags, shouldCelebrate } from '../components/Celebration';
import ResultAnimation from '../components/ResultAnimation';
import {
  getTeamName,
  getWindowTypeLabel,
  getWindowTypeColor,
  formatForm,
  getCoachName,
  getTierLabel,
} from '../utils/format';

type TabKey = 'matchday' | 'results' | 'overview' | 'review';

const roundLabelCN: Record<string, string> = {
  R32: '第一轮', R16: '第二轮', QF: '八强', SF: '四强', Final: '决赛',
  'QF-L1': '八强首回合', 'QF-L2': '八强次回合',
  'SF-L1': '四强首回合', 'SF-L2': '四强次回合',
};
function cnLabel(label: string) { return roundLabelCN[label] ?? label; }

export default function Dashboard() {
  const world = useGameStore((s) => s.world);
  const lastResults = useGameStore((s) => s.lastResults);
  const lastNews = useGameStore((s) => s.lastNews);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const isAdvancing = useGameStore((s) => s.isAdvancing);

  const [activeTab, setActiveTab] = useState<TabKey>('matchday');
  const prevResultsLen = useRef(0);

  // Modal state
  const [selectedFixture, setSelectedFixture] = useState<MatchFixture | null>(null);
  const [selectedResult, setSelectedResult] = useState<MatchResult | null>(null);
  const [celebrationType, setCelebrationType] = useState<'trophy' | 'confetti' | null>(null);

  // Auto-switch to results tab + trigger celebration after advancing
  useEffect(() => {
    if (lastResults.length > 0 && prevResultsLen.current === 0) {
      setActiveTab('results');
      // Check if we should celebrate
      const prevWindow = world?.seasonState.calendar[world.seasonState.currentWindowIndex - 1];
      if (prevWindow) {
        const celeb = shouldCelebrate(prevWindow.type, prevWindow.label, lastResults);
        if (celeb) setCelebrationType(celeb);
      }
    }
    prevResultsLen.current = lastResults.length;
  }, [lastResults.length]);

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const currentWindow = getCurrentWindow();
  const calendarLen = world.seasonState.calendar.length;
  const completedWindows = world.seasonState.calendar.filter((w) => w.completed).length;

  // Find the matching fixture for a result
  const findFixtureForResult = (result: MatchResult): MatchFixture => {
    for (const win of world.seasonState.calendar) {
      const f = win.fixtures.find((fx) => fx.id === result.fixtureId);
      if (f) return f;
    }
    return {
      id: result.fixtureId,
      homeTeamId: result.homeTeamId,
      awayTeamId: result.awayTeamId,
      competitionType: result.competitionType,
      competitionName: result.competitionName,
      roundLabel: result.roundLabel,
    };
  };

  const handleFixtureClick = (fixture: MatchFixture) => {
    setSelectedFixture(fixture);
    setSelectedResult(null);
  };

  const handleResultClick = (result: MatchResult) => {
    const fixture = findFixtureForResult(result);
    setSelectedFixture(fixture);
    setSelectedResult(result);
  };

  const closeModal = () => {
    setSelectedFixture(null);
    setSelectedResult(null);
  };

  // Check if we have a completed season to review
  const lastCompletedSeason = world.honorHistory.length > 0
    ? world.honorHistory[world.honorHistory.length - 1].seasonNumber
    : null;
  const hasSeasonReview = lastCompletedSeason !== null;

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'matchday', label: '比赛日' },
    { key: 'results', label: '战报' },
    { key: 'overview', label: '总览' },
    ...(hasSeasonReview ? [{ key: 'review' as TabKey, label: `S${lastCompletedSeason}回顾` }] : []),
  ];

  return (
    <div className="max-w-6xl flex flex-col h-full">
      {/* ═══════ Compact Top Bar ═══════ */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-700/50 flex-wrap">
        {/* Left: season + progress */}
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="font-semibold text-slate-200">
            第{world.seasonState.seasonNumber}赛季
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-xs text-slate-400">{completedWindows}/{calendarLen}</span>
        </div>

        {/* Center: current window badge */}
        {currentWindow && (
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium text-white shrink-0 ${getWindowTypeColor(currentWindow.type)}`}
            >
              {getWindowTypeLabel(currentWindow.type)}
            </span>
            <span className="text-xs text-slate-400 truncate">{currentWindow.label}</span>
          </div>
        )}

        {/* Right: advance button */}
        <button
          onClick={advanceWindow}
          disabled={isAdvancing || !currentWindow}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors cursor-pointer shrink-0"
        >
          {isAdvancing
            ? '模拟中...'
            : currentWindow
              ? `开始模拟 (${currentWindow.fixtures.length}场)`
              : '赛季已结束'}
        </button>
      </div>

      {/* ═══════ Tab Bar ═══════ */}
      <div className="flex gap-4 border-b border-slate-700/50 mt-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-2 text-sm font-medium transition-colors cursor-pointer relative ${
              activeTab === tab.key
                ? 'text-blue-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.label}
            {tab.key === 'results' && lastResults.length > 0 && (
              <span className="ml-1 text-[10px] text-slate-500">({lastResults.length})</span>
            )}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* ═══════ Tab Content ═══════ */}
      <div className="flex-1 overflow-auto pt-4 pb-2 animate-tab-enter" key={activeTab}>
        {activeTab === 'matchday' && (
          <MatchdayTab
            world={world}
            currentWindow={currentWindow}
            onFixtureClick={handleFixtureClick}
          />
        )}

        {activeTab === 'results' && (
          <ResultsTab
            world={world}
            lastResults={lastResults}
            lastNews={lastNews}
            onResultClick={handleResultClick}
          />
        )}

        {activeTab === 'overview' && <OverviewTab world={world} />}

        {activeTab === 'review' && lastCompletedSeason && (
          <SeasonReview world={world} seasonNumber={lastCompletedSeason} />
        )}
      </div>

      {/* ═══════ Celebration ═══════ */}
      <Celebration
        active={celebrationType !== null}
        type={celebrationType ?? 'confetti'}
        duration={celebrationType === 'trophy' ? 5000 : 3500}
      />

      {/* ═══════ Match Detail Modal ═══════ */}
      <MatchDetailModal
        isOpen={selectedFixture !== null}
        onClose={closeModal}
        fixture={selectedFixture ?? undefined}
        result={selectedResult ?? undefined}
        world={world}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Tab: 比赛日
// ══════════════════════════════════════════════════════════════════════

function MatchdayTab({
  world,
  currentWindow,
  onFixtureClick,
}: {
  world: GameWorld;
  currentWindow: ReturnType<ReturnType<typeof useGameStore.getState>['getCurrentWindow']>;
  onFixtureClick: (f: MatchFixture) => void;
}) {
  if (!currentWindow) {
    return (
      <div className="text-center py-12">
        <p className="text-lg font-semibold text-slate-300">赛季已结束</p>
        <p className="text-sm text-slate-500 mt-1">所有赛事已完成，请查看总览或历史荣誉页面</p>
      </div>
    );
  }

  if (currentWindow.fixtures.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-500">本阶段无比赛安排</p>
      </div>
    );
  }

  // Group fixtures by competition
  const groups: { label: string; color: string; fixtures: MatchFixture[] }[] = [];
  const groupMap = new Map<string, MatchFixture[]>();

  for (const f of currentWindow.fixtures) {
    const key = f.competitionName || f.competitionType;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(f);
  }

  // Ordered: 顶级 → 甲级 → 乙级 → others
  const order = ['顶级联赛', '甲级联赛', '乙级联赛'];
  const sorted = [...groupMap.entries()].sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const groupColors: Record<string, string> = {
    '顶级联赛': 'border-amber-500',
    '甲级联赛': 'border-blue-500',
    '乙级联赛': 'border-emerald-500',
  };

  // Generate context tips for the whole window
  const windowTips = generateWindowTips(world, currentWindow.fixtures);

  return (
    <div className="space-y-5">
      {/* Context tips banner */}
      {windowTips.length > 0 && (
        <div className="space-y-1.5">
          {windowTips.map((tip, i) => (
            <div key={i} className={`px-3 py-2 rounded-lg text-xs border ${tip.style}`}>
              <span className="font-medium">{tip.tag}</span>
              <span className="mx-1.5 text-slate-600">|</span>
              <span>{tip.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Grouped fixtures */}
      {sorted.map(([groupName, fixtures]) => (
        <div key={groupName}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-1 h-5 rounded-full ${groupColors[groupName] ? groupColors[groupName].replace('border-', 'bg-') : 'bg-purple-500'}`} />
            <h3 className="text-sm font-semibold text-slate-200">{groupName}</h3>
            <span className="text-[10px] text-slate-500">{fixtures.length}场</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 stagger-children">
            {fixtures.map((fixture) => (
              <FixtureCard
                key={fixture.id}
                fixture={fixture}
                world={world}
                onClick={() => onFixtureClick(fixture)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Generate contextual tips based on the match context
function generateWindowTips(
  world: GameWorld,
  fixtures: MatchFixture[],
): { tag: string; text: string; style: string }[] {
  const tips: { tag: string; text: string; style: string }[] = [];
  const seen = new Set<string>();

  for (const f of fixtures) {
    const ht = world.teamBases[f.homeTeamId];
    const at = world.teamBases[f.awayTeamId];
    if (!ht || !at) continue;

    const hs = world.teamStates[f.homeTeamId];
    const as_ = world.teamStates[f.awayTeamId];

    // Title clash: both teams are elite/strong
    if ((ht.tier === 'elite' || ht.tier === 'strong') && (at.tier === 'elite' || at.tier === 'strong')) {
      const key = `clash-${f.id}`;
      if (!seen.has(key)) {
        tips.push({
          tag: '强强对话',
          text: `${ht.name} vs ${at.name} — ${getTierLabel(ht.tier)}对决${getTierLabel(at.tier)}`,
          style: 'bg-amber-900/20 border-amber-700/40 text-amber-300',
        });
        seen.add(key);
      }
    }

    // Upset potential: big overall gap
    const gap = Math.abs(ht.overall - at.overall);
    if (gap >= 15) {
      const strong = ht.overall > at.overall ? ht : at;
      const weak = ht.overall > at.overall ? at : ht;
      const key = `upset-${f.id}`;
      if (!seen.has(key)) {
        tips.push({
          tag: '爆冷预警',
          text: `${weak.name}(${getTierLabel(weak.tier)}) 挑战 ${strong.name}(${getTierLabel(strong.tier)})，实力差距${gap}`,
          style: 'bg-purple-900/20 border-purple-700/40 text-purple-300',
        });
        seen.add(key);
      }
    }

    // Relegation battle: both teams in bottom 3 of their league
    if (hs && as_ && f.competitionType === 'league') {
      const standings = hs.leagueLevel === 1 ? world.league1Standings :
                        hs.leagueLevel === 2 ? world.league2Standings : world.league3Standings;
      const homePos = standings.findIndex(s => s.teamId === f.homeTeamId) + 1;
      const awayPos = standings.findIndex(s => s.teamId === f.awayTeamId) + 1;
      const total = standings.length;

      if (homePos > 0 && awayPos > 0) {
        if (homePos >= total - 2 && awayPos >= total - 2 && total > 4) {
          const key = `releg-${f.id}`;
          if (!seen.has(key)) {
            tips.push({
              tag: '保级生死战',
              text: `${ht.name}(第${homePos}名) vs ${at.name}(第${awayPos}名) — 败者形势危急`,
              style: 'bg-red-900/20 border-red-700/40 text-red-300',
            });
            seen.add(key);
          }
        }

        // Title race: both top 3
        if (homePos <= 3 && awayPos <= 3 && standings[0]?.played > 5) {
          const key = `title-${f.id}`;
          if (!seen.has(key)) {
            tips.push({
              tag: '争冠焦点',
              text: `${ht.name}(第${homePos}名) vs ${at.name}(第${awayPos}名) — 冠军争夺直接对话`,
              style: 'bg-amber-900/20 border-amber-700/40 text-amber-200',
            });
            seen.add(key);
          }
        }
      }
    }

    // Coach under pressure
    if (hs && hs.coachPressure > 55) {
      const coach = hs.currentCoachId ? world.coachBases[hs.currentCoachId] : null;
      const key = `pressure-${f.homeTeamId}`;
      if (!seen.has(key) && coach) {
        tips.push({
          tag: '下课危机',
          text: `${ht.name}主帅${coach.name}压力值${hs.coachPressure}，再输恐被解雇`,
          style: 'bg-red-900/15 border-red-700/30 text-red-400',
        });
        seen.add(key);
      }
    }
  }

  // Limit to top 4 most important tips
  return tips.slice(0, 4);
}

// ══════════════════════════════════════════════════════════════════════
//  Tab: 战报
// ══════════════════════════════════════════════════════════════════════

function ResultsTab({
  world,
  lastResults,
  lastNews,
  onResultClick,
}: {
  world: GameWorld;
  lastResults: MatchResult[];
  lastNews: { id: string; type: string; title: string; description: string }[];
  onResultClick: (r: MatchResult) => void;
}) {
  const [animComplete, setAnimComplete] = useState(false);

  if (lastResults.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-500">暂无比赛结果，请先推进模拟</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Animated result reveal */}
      <ResultAnimation
        results={lastResults}
        teamBases={world.teamBases as Record<string, any>}
        onComplete={() => setAnimComplete(true)}
        onResultClick={onResultClick}
      />

      {/* News feed */}
      {(lastNews.length > 0 || world.newsLog.length > 0) && (
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2">
            <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
            新闻动态
          </h3>
          <div className="space-y-1.5">
            {(lastNews.length > 0 ? lastNews : world.newsLog.slice(-8).reverse()).map(
              (news) => (
                <div
                  key={news.id}
                  className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700"
                  style={{
                    borderLeftWidth: '3px',
                    borderLeftColor: getNewsBorderColor(news.type),
                  }}
                >
                  <p className="text-sm text-slate-200">{news.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{news.description}</p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Tab: 总览
// ══════════════════════════════════════════════════════════════════════

function OverviewTab({ world }: { world: GameWorld }) {
  const leagues = [
    { standings: world.league1Standings, name: '顶级联赛', level: 1 },
    { standings: world.league2Standings, name: '甲级联赛', level: 2 },
    { standings: world.league3Standings, name: '乙级联赛', level: 3 },
  ] as const;

  // Season progress
  const completedW = world.seasonState.calendar.filter(w => w.completed).length;
  const totalW = world.seasonState.calendar.length;
  const pct = totalW > 0 ? Math.round((completedW / totalW) * 100) : 0;

  // Cup progress
  const lcRound = world.leagueCup.completed ? '已结束' : `第${world.leagueCup.currentRound}轮`;
  const scStatus = world.superCup.completed ? '已结束' : world.superCup.groupStageCompleted ? '淘汰赛' : '小组赛';
  const wcStatus = world.worldCup ? (world.worldCup.completed ? '已结束' : world.worldCup.groupStageCompleted ? '淘汰赛' : '小组赛') : null;

  // Top scorer
  const topScorer = Object.values(world.playerStats).reduce(
    (best, s) => (s.goals > (best?.goals ?? 0) ? s : best), null as any
  );
  let topScorerText = '暂无';
  if (topScorer && topScorer.goals > 0) {
    const parts = topScorer.playerId.split('-');
    const num = parts[parts.length - 1];
    topScorerText = `${getTeamName(topScorer.teamId, world.teamBases)} ${num}号 (${topScorer.goals}球)`;
  }

  // Coach changes count
  const coachChanges = world.coachChangesThisSeason.length;

  return (
    <div className="space-y-4">
      {/* Season stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatMini label="赛季进度" value={`${pct}%`} sub={`${completedW}/${totalW}`} />
        <StatMini label="联赛杯" value={lcRound} sub={world.leagueCup.winnerId ? `冠军: ${getTeamName(world.leagueCup.winnerId, world.teamBases)}` : '进行中'} />
        <StatMini label="超级杯" value={scStatus} sub={world.superCup.winnerId ? `冠军: ${getTeamName(world.superCup.winnerId, world.teamBases)}` : '进行中'} />
        <StatMini label="射手王" value={topScorerText} sub={coachChanges > 0 ? `${coachChanges}次换帅` : '暂无换帅'} />
      </div>

      {/* World cup if applicable */}
      {wcStatus && (
        <div className="bg-sky-900/15 rounded-lg border border-sky-800/30 px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-sky-400 font-medium">环球冠军杯</span>
          <span className="text-xs text-sky-300">{wcStatus}</span>
          {world.worldCup?.winnerId && <span className="text-xs text-amber-400">冠军: {getTeamName(world.worldCup.winnerId, world.teamBases)}</span>}
        </div>
      )}

      {/* Season preview — show at start of season (first few windows) */}
      {pct < 10 && world.honorHistory.length > 0 && (() => {
        const lastHonor = world.honorHistory[world.honorHistory.length - 1];
        const newPromoted = lastHonor.promoted.map(p => getTeamName(p.teamId, world.teamBases));
        const newRelegated = lastHonor.relegated.map(r => getTeamName(r.teamId, world.teamBases));
        // Top 3 favorites by overall
        const l1Teams = Object.values(world.teamStates).filter(s => s.leagueLevel === 1);
        const favorites = l1Teams.map(s => ({ id: s.id, ovr: world.teamBases[s.id]?.overall ?? 0 })).sort((a, b) => b.ovr - a.ovr).slice(0, 3);

        return (
          <div className="bg-gradient-to-r from-blue-900/20 to-slate-800 rounded-xl border border-blue-800/30 p-3 sm:p-4">
            <h3 className="text-xs font-semibold text-blue-300 mb-2">赛季前瞻 — 第{world.seasonState.seasonNumber}赛季</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-500">夺冠热门</span>
                <div className="mt-1 space-y-0.5">
                  {favorites.map((f, i) => (
                    <div key={f.id} className="flex items-center gap-1 text-slate-300">
                      <span className="text-amber-400">{i + 1}.</span>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: (world.teamBases[f.id] as any)?.color ?? '#666' }} />
                      {getTeamName(f.id, world.teamBases)}
                      <span className="text-slate-500 ml-auto">{f.ovr}</span>
                    </div>
                  ))}
                </div>
              </div>
              {newPromoted.length > 0 && (
                <div>
                  <span className="text-slate-500">新升级球队</span>
                  <div className="mt-1 space-y-0.5 text-green-400">
                    {newPromoted.map(n => <div key={n}>{n}</div>)}
                  </div>
                </div>
              )}
              {newRelegated.length > 0 && (
                <div>
                  <span className="text-slate-500">降级球队</span>
                  <div className="mt-1 space-y-0.5 text-red-400">
                    {newRelegated.map(n => <div key={n}>{n}</div>)}
                  </div>
                </div>
              )}
              {world.seasonState.isWorldCupYear && (
                <div>
                  <span className="text-sky-400 font-semibold">本赛季为环球冠军杯年</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* League standings */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {leagues.map(({ standings, name, level }) => (
          <div key={level} className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
              <Link to={`/league/${level}`} className="text-sm font-semibold text-slate-200 hover:text-blue-400 transition-colors">{name}</Link>
              <Link to={`/league/${level}`} className="text-[10px] text-slate-500 hover:text-blue-400">全部 &rarr;</Link>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-500">
                  <th className="text-left px-2 py-1 w-5">#</th>
                  <th className="text-left px-1 py-1">球队</th>
                  <th className="text-center px-1 py-1 w-7">分</th>
                  <th className="text-center px-1 py-1 w-16">近况</th>
                </tr>
              </thead>
              <tbody>
                {standings.slice(0, 5).map((entry, i) => {
                  const teamBase = world.teamBases[entry.teamId];
                  return (
                    <tr key={entry.teamId} className="border-t border-slate-700/50 hover:bg-slate-700/30">
                      <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                      <td className="px-1 py-1.5">
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: teamBase?.color ?? '#64748b' }} />
                          <Link to={`/team/${entry.teamId}`} className="text-slate-200 hover:text-blue-400 truncate">{getTeamName(entry.teamId, world.teamBases)}</Link>
                        </div>
                      </td>
                      <td className="text-center px-1 py-1.5 font-semibold text-slate-200">{entry.points}</td>
                      <td className="text-center px-1 py-1.5">
                        <div className="flex gap-0.5 justify-center">
                          {formatForm(entry.form.slice(-3)).map((f, fi) => (
                            <span key={fi} className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[9px] font-bold text-white ${f.color}`}>{f.label}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatMini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-200 mt-0.5 truncate">{value}</div>
      <div className="text-[10px] text-slate-500 truncate">{sub}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Sub-components
// ══════════════════════════════════════════════════════════════════════

function FixtureCard({
  fixture,
  world,
  onClick,
}: {
  fixture: MatchFixture;
  world: GameWorld;
  onClick: () => void;
}) {
  const homeTeam = world.teamBases[fixture.homeTeamId];
  const awayTeam = world.teamBases[fixture.awayTeamId];
  const homeState = world.teamStates[fixture.homeTeamId];
  const awayState = world.teamStates[fixture.awayTeamId];

  if (!homeTeam || !awayTeam || !homeState || !awayState) return null;

  const homeCoach = homeState.currentCoachId
    ? world.coachBases[homeState.currentCoachId] ?? null
    : null;
  const awayCoach = awayState.currentCoachId
    ? world.coachBases[awayState.currentCoachId] ?? null
    : null;

  const pred = predictMatch(homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach);

  // Get match tags
  const standings = homeState.leagueLevel === 1 ? world.league1Standings : homeState.leagueLevel === 2 ? world.league2Standings : world.league3Standings;
  const tags = getMatchTags(fixture.competitionType, fixture.roundLabel, fixture.homeTeamId, fixture.awayTeamId, standings, standings.length);

  const hasGlow = tags.some(t => t.glow);

  return (
    <div
      onClick={onClick}
      className={`bg-slate-800 rounded-lg border p-2 hover:border-slate-500 hover:bg-slate-800/80 transition-all cursor-pointer group hover-lift ${
        hasGlow ? 'border-amber-600/50 animate-glow-pulse' : 'border-slate-700'
      }`}
      style={hasGlow ? { color: '#f59e0b' } : undefined}
    >
      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex gap-1 mb-1">
          {tags.map((t, i) => (
            <span key={i} className={`text-[8px] px-1 py-0.5 rounded font-semibold ${t.color}`}>{t.label}</span>
          ))}
        </div>
      )}

      <div className="flex items-center mb-1.5">
        {/* Home */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: homeTeam.color }} />
            <span className="text-xs font-semibold text-slate-100 truncate group-hover:text-blue-400">{homeTeam.name}</span>
            <span className="text-[9px] text-slate-500">{homeTeam.overall}</span>
          </div>
        </div>
        <span className="text-[10px] font-bold text-slate-600 px-1.5 shrink-0">VS</span>
        {/* Away */}
        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center gap-1 justify-end">
            <span className="text-[9px] text-slate-500">{awayTeam.overall}</span>
            <span className="text-xs font-semibold text-slate-100 truncate group-hover:text-blue-400">{awayTeam.name}</span>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: awayTeam.color }} />
          </div>
        </div>
      </div>

      {/* Mini probability bar */}
      <div className="flex h-0.5 rounded-full overflow-hidden bg-slate-700">
        <div className="bg-green-500" style={{ width: `${pred.homeWinPct}%` }} />
        <div className="bg-slate-400" style={{ width: `${pred.drawPct}%` }} />
        <div className="bg-red-500" style={{ width: `${pred.awayWinPct}%` }} />
      </div>
      <div className="flex justify-between text-[9px] mt-0.5 text-slate-500">
        <span className="text-green-400">{pred.homeWinPct}%</span>
        <span className="truncate px-1">{pred.verdict}</span>
        <span className="text-red-400">{pred.awayWinPct}%</span>
      </div>
    </div>
  );
}

function ResultCard({
  result,
  world,
  onClick,
}: {
  result: MatchResult;
  world: GameWorld;
  onClick: () => void;
}) {
  const homeTeam = world.teamBases[result.homeTeamId];
  const awayTeam = world.teamBases[result.awayTeamId];
  const homeWon = result.homeGoals + (result.etHomeGoals ?? 0) > result.awayGoals + (result.etAwayGoals ?? 0);
  const awayWon = result.awayGoals + (result.etAwayGoals ?? 0) > result.homeGoals + (result.etHomeGoals ?? 0);

  const homeState = world.teamStates[result.homeTeamId];
  const rStandings = homeState?.leagueLevel === 1 ? world.league1Standings : homeState?.leagueLevel === 2 ? world.league2Standings : world.league3Standings;
  const tags = getMatchTags(result.competitionType, result.roundLabel, result.homeTeamId, result.awayTeamId, rStandings, rStandings.length);
  const isFinal = tags.some(t => t.label === '决赛');

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-3 hover:border-slate-500 transition-all cursor-pointer group animate-slide-up ${
        isFinal ? 'bg-gradient-to-r from-amber-900/20 via-slate-800 to-amber-900/20 border-amber-600/40' : 'bg-slate-800 border-slate-700'
      }`}
    >
      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex gap-1 mb-1.5">
          {tags.map((t, i) => (
            <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${t.color}`}>{t.label}</span>
          ))}
          {isFinal && <span className="text-[9px] text-amber-400 animate-sparkle">✦</span>}
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* Home */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: homeTeam?.color ?? '#64748b' }}
          />
          <span
            className={`text-sm truncate group-hover:text-blue-400 transition-colors ${
              homeWon ? 'text-green-400 font-bold' : 'text-slate-200'
            }`}
          >
            {getTeamName(result.homeTeamId, world.teamBases)}
          </span>
        </div>

        {/* Score */}
        <div className="flex items-center gap-1 px-2 shrink-0">
          <span
            className={`text-lg font-bold ${
              homeWon ? 'text-green-400' : awayWon ? 'text-red-400' : 'text-slate-300'
            }`}
          >
            {result.homeGoals}
          </span>
          <span className="text-slate-600 text-xs">:</span>
          <span
            className={`text-lg font-bold ${
              awayWon ? 'text-green-400' : homeWon ? 'text-red-400' : 'text-slate-300'
            }`}
          >
            {result.awayGoals}
          </span>
          {result.extraTime && (
            <span className="text-[10px] text-amber-400 ml-0.5">
              {result.penalties
                ? `P${result.penaltyHome}-${result.penaltyAway}`
                : '加时'}
            </span>
          )}
        </div>

        {/* Away */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          <span
            className={`text-sm truncate text-right group-hover:text-blue-400 transition-colors ${
              awayWon ? 'text-green-400 font-bold' : 'text-slate-200'
            }`}
          >
            {getTeamName(result.awayTeamId, world.teamBases)}
          </span>
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: awayTeam?.color ?? '#64748b' }}
          />
        </div>
      </div>

      {/* Competition label */}
      <div className="text-[10px] text-slate-500 mt-1.5 text-center">
        {result.competitionName} · {cnLabel(result.roundLabel)}
      </div>
    </div>
  );
}

function getNewsBorderColor(type: string): string {
  const colors: Record<string, string> = {
    match_result: '#059669',
    coach_fired: '#dc2626',
    coach_hired: '#2563eb',
    promotion: '#22c55e',
    relegation: '#ef4444',
    trophy: '#f59e0b',
    upset: '#a855f7',
    streak: '#0ea5e9',
  };
  return colors[type] ?? '#64748b';
}
