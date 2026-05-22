import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { predictMatch } from '../engine/match/prediction';
import type { MatchFixture, MatchResult } from '../types/match';
import type { GameWorld } from '../engine/season/season-manager';
import type { TeamBase } from '../types/team';
import type { PlayerSeasonStats } from '../types/player';
import MatchDetailModal from '../components/MatchDetailModal';
import SeasonReview from '../components/SeasonReview';
import Celebration, { getMatchTags, shouldCelebrate } from '../components/Celebration';
import ResultAnimation from '../components/ResultAnimation';
import MatchLive from '../components/MatchLive';
import TeamName from '../components/TeamName';
import { pickFocusMatches } from '../engine/season/match-importance';
import { generateStorylineCards } from '../engine/season/storyline-cards';
import { detectPlayerHighlights } from '../engine/players/player-highlights';
import { getTopScorerByTeam } from '../engine/players/stats';
import { buildTeamCoachMap, getTeamCoachId } from '../engine/coaches/coach-lookup';
import {
  getTeamName,
  getWindowTypeLabel,
  getWindowTypeColor,
  formatForm,
  getCoachName,
  getTierLabel,
} from '../utils/format';
import { formatMoney } from '../engine/economy/finance';

/**
 * Compact money formatter for chip display.
 * Drops decimals when |n| ≥ 10 and uses a `€` glyph.
 */
function formatMoneyChip(n: number): string {
  return formatMoney(n);
}

type TabKey = 'matchday' | 'results' | 'overview' | 'review';

const roundLabelCN: Record<string, string> = {
  R32: '第一轮', R16: '第二轮', QF: '八强', SF: '四强', Final: '决赛',
  'QF-L1': '八强首回合', 'QF-L2': '八强次回合',
  'SF-L1': '四强首回合', 'SF-L2': '四强次回合',
};
function cnLabel(label: string) { return roundLabelCN[label] ?? label; }

export default function Dashboard() {
  const navigate = useNavigate();
  const world = useGameStore((s) => s.world);
  const lastResults = useGameStore((s) => s.lastResults);
  const lastNews = useGameStore((s) => s.lastNews);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const isAdvancing = useGameStore((s) => s.isAdvancing);
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const advanceTick = useGameStore((s) => s.advanceTick);

  const [activeTab, setActiveTab] = useState<TabKey>('matchday');
  const prevAdvanceTick = useRef(advanceTick);

  // Modal state
  const [selectedFixture, setSelectedFixture] = useState<MatchFixture | null>(null);
  const [selectedResult, setSelectedResult] = useState<MatchResult | null>(null);
  const [celebrationType, setCelebrationType] = useState<'trophy' | 'confetti' | null>(null);
  const [liveResult, setLiveResult] = useState<MatchResult | null>(null);
  const starredFixtureIds = useGameStore((s) => s.starredFixtureIds);
  const clearStarredFixtures = useGameStore((s) => s.clearStarredFixtures);

  // Auto-switch to results tab + trigger live/celebration after each advance
  // (advanceTick bumps in store on every successful advance — robust across
  //  any number of advances, unlike length-based heuristics).
  useEffect(() => {
    if (advanceTick === prevAdvanceTick.current) return;
    prevAdvanceTick.current = advanceTick;
    if (lastResults.length === 0) return;

    // Priority 1: starred fixture in this batch → auto-live the first one
    const starredHit = starredFixtureIds.length > 0
      ? lastResults.find((r) => starredFixtureIds.includes(r.fixtureId))
      : undefined;
    // Priority 2: cup final
    const finalResult = lastResults.find(r =>
      r.roundLabel === 'Final' || r.roundLabel === '决赛'
    );
    if (starredHit) {
      setLiveResult(starredHit);
      // Clear starred (one-shot per advance)
      clearStarredFixtures();
    } else if (finalResult) {
      setLiveResult(finalResult);
    } else {
      setActiveTab('results');
    }

    // Check celebration
    const prevWindow = world?.seasonState.calendar[world.seasonState.currentWindowIndex - 1];
    if (prevWindow) {
      const celeb = shouldCelebrate(prevWindow.type, prevWindow.label, lastResults);
      if (celeb && !finalResult && !starredHit) setCelebrationType(celeb);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceTick]);

  // v20 — auto-redirect to /market when transfer window opens
  useEffect(() => {
    if (world?.transferWindow?.status === 'open' && window.location.pathname !== '/market') {
      navigate('/market');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world?.transferWindow?.status]);

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

  // Wrap advanceWindow so clicking advance dismisses any blocking overlay
  // first. MatchLive (z-[200] full-viewport) intercepts clicks otherwise,
  // and a user spamming the button mid-celebration would expect it to skip.
  // Celebration is pointer-events-none so it doesn't actually block — but we
  // clear it too for visual coherence on the next tick.
  const handleAdvanceClick = () => {
    if (liveResult) setLiveResult(null);
    if (celebrationType) setCelebrationType(null);
    advanceWindow();
  };

  // Check if we have a completed season to review
  const lastCompletedSeason = world.honorHistory.length > 0
    ? world.honorHistory[world.honorHistory.length - 1].seasonNumber
    : null;
  const hasSeasonReview = lastCompletedSeason !== null;

  // teamId → coachId map for the current coach assignments. Used by the
  // favorite-team cards (top of dashboard) and any per-fixture lookups
  // further down. Memoised so the whole render does N=1 walks instead of
  // recomputing on every team card.
  const teamCoachMap = useMemo(
    () => buildTeamCoachMap(world.coachStates),
    [world.coachStates],
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'matchday', label: '比赛日' },
    { key: 'results', label: '战报' },
    { key: 'overview', label: '总览' },
    ...(hasSeasonReview ? [{ key: 'review' as TabKey, label: `S${lastCompletedSeason}回顾` }] : []),
  ];

  return (
    <div className="max-w-6xl flex flex-col h-full">
      {/* ═══════ Compact Top Bar ═══════ */}
      <div className="sticky top-0 z-[210] bg-slate-900/95 backdrop-blur-sm flex items-center justify-between gap-2 pb-3 border-b border-slate-700/50 flex-wrap">
        {/* Left: season + progress */}
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="font-semibold text-slate-200">
            第{world.seasonState.seasonNumber}赛季
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-xs text-slate-400">{completedWindows}/{calendarLen}</span>
          <span className="text-slate-500">·</span>
          <span className="text-xs text-amber-400 font-medium">{world.coins ?? 1000} 金币</span>
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
          onClick={handleAdvanceClick}
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

      {/* ═══════ Favorite Team Cards (up to 3) ═══════ */}
      {favoriteTeamIds.length > 0 && (() => {
        // Surface any negative-cash favorites as a Phase H alert banner.
        const broke = favoriteTeamIds.filter(tid => (world.teamFinances?.[tid]?.cash ?? 0) < 0);
        if (broke.length === 0) return null;
        return (
          <div className="bg-red-950/40 border border-red-800/50 text-red-200 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
            <span className="text-red-300">⚠</span>
            <div className="min-w-0">
              <div className="font-semibold mb-0.5">财政告急</div>
              <div className="text-[11px] text-red-300/90">
                {broke.map((tid, i) => {
                  const t = world.teamBases[tid];
                  const cash = world.teamFinances?.[tid]?.cash ?? 0;
                  return (
                    <span key={tid}>
                      {i > 0 && '、'}
                      <Link to={`/team/${tid}`} className="text-red-200 hover:text-white underline-offset-2 hover:underline">
                        {t?.name ?? tid}
                      </Link> ({formatMoney(cash)})
                    </span>
                  );
                })}
                {' '}—— 赛季结束时将以 200% 高溢价被迫甩卖 €30M+ 球员（若有顶级买家），现金可恢复正值。
              </div>
            </div>
          </div>
        );
      })()}
      {favoriteTeamIds.length > 0 && (
        <div className="space-y-1.5 mt-1">
          {favoriteTeamIds.map((tid) => {
            const fav = world.teamBases[tid];
            const favState = world.teamStates[tid];
            if (!fav || !favState) return null;
            const standings = favState.leagueLevel === 1 ? world.league1Standings : favState.leagueLevel === 2 ? world.league2Standings : world.league3Standings;
            const posEntry = standings.find(s => s.teamId === tid);
            const pos = posEntry ? standings.indexOf(posEntry) + 1 : '-';
            const pts = posEntry?.points ?? 0;
            const coachName = (() => {
              const cid = teamCoachMap.get(tid);
              return cid ? getCoachName(cid, world.coachBases) : '无';
            })();
            const nextFixture = currentWindow?.fixtures.find(f => f.homeTeamId === tid || f.awayTeamId === tid);
            const opponentId = nextFixture ? (nextFixture.homeTeamId === tid ? nextFixture.awayTeamId : nextFixture.homeTeamId) : null;
            const cash = world.teamFinances?.[tid]?.cash ?? 0;
            const cashTone = cash < 0 ? 'text-red-300' : cash < 10 ? 'text-amber-300' : 'text-emerald-300';

            return (
              <div key={tid} className="flex items-center gap-3 bg-slate-800/60 rounded-lg border border-slate-700/40 px-3 py-2">
                <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: fav.color }}>{fav.shortName?.charAt(0)}</span>
                <div className="flex items-center gap-3 flex-1 min-w-0 overflow-x-auto text-xs">
                  <Link to={`/team/${tid}`} className="font-semibold text-slate-200 hover:text-blue-400 shrink-0">{fav.name}</Link>
                  <span className="text-slate-500 shrink-0">#{pos} · {pts}分 · OVR {fav.overall}</span>
                  <span className={`shrink-0 ${cashTone}`} title="球队现金 (Phase H 经济)">
                    💰{formatMoneyChip(cash)}
                  </span>
                  <span className="text-slate-600 shrink-0">{coachName}</span>
                  <div className="flex gap-0.5 shrink-0">
                    {formatForm(favState.recentForm.slice(-5)).map((f, i) => (
                      <span key={i} className={`w-4 h-4 rounded text-[11px] sm:text-[9px] font-bold text-white flex items-center justify-center ${f.color}`}>{f.label}</span>
                    ))}
                  </div>
                  {opponentId && (
                    <span className="text-slate-500 shrink-0">
                      下场: vs <span className="text-slate-300">{getTeamName(opponentId, world.teamBases)}</span>
                      {nextFixture?.homeTeamId === tid ? ' (主)' : ' (客)'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════ Storyline cards for favorites ═══════ */}
      {favoriteTeamIds.length > 0 && (() => {
        const cards = generateStorylineCards(world, favoriteTeamIds);
        if (cards.length === 0) return null;
        return (
          <div className="space-y-1.5 mt-1">
            {cards.map((c, i) => (
              <div
                key={`${c.teamId}-${c.type}-${i}`}
                className="bg-gradient-to-r from-purple-900/15 via-slate-800/80 to-slate-800/40 rounded-lg border border-purple-700/30 px-3 py-2"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-base">{c.emoji}</span>
                  <span className="text-xs font-semibold text-purple-300">{c.title}</span>
                </div>
                <p className="text-[11px] text-slate-400 ml-7">{c.body}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ═══════ Transfer rumors (v18) — favorite teams' involvement ═══════ */}
      {favoriteTeamIds.length > 0 && (() => {
        const favSet = new Set(favoriteTeamIds);
        const rumors = (world.transferRumors ?? []).filter(r =>
          favSet.has(r.fromTeamId) || favSet.has(r.eliteTeamId)
        );
        if (rumors.length === 0) return null;
        return (
          <div className="space-y-1.5 mt-1">
            {rumors.slice(-6).reverse().map((r) => {
              const intensityColor = r.intensity === 'high' ? 'border-rose-700/50 bg-rose-900/15'
                : r.intensity === 'medium' ? 'border-amber-700/50 bg-amber-900/15'
                : 'border-slate-700/60 bg-slate-800/50';
              const intensityText = r.intensity === 'high' ? '紧锣密鼓' : r.intensity === 'medium' ? '深入接触' : '初步关注';
              return (
                <div key={r.id} className={`rounded-lg border px-3 py-2 ${intensityColor}`}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-base shrink-0">📢</span>
                    <Link to={`/team/${r.eliteTeamId}`} className="font-semibold text-slate-200 hover:text-blue-400">
                      {r.eliteTeamName}
                    </Link>
                    <span className="text-slate-500">{intensityText}</span>
                    <Link to={`/player/${r.candidateUuid}`} className="text-slate-100 font-medium hover:text-blue-400 truncate">
                      {r.candidateName}
                    </Link>
                    <span className="text-[10px] text-slate-500">({r.candidatePosition})</span>
                    <span className="text-[10px] text-slate-500 ml-auto shrink-0">
                      来自 <Link to={`/team/${r.fromTeamId}`} className="text-slate-400 hover:text-blue-400">{r.fromTeamName}</Link>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ═══════ Tab Bar ═══════ */}
      <div className="flex gap-2 border-b border-slate-700/50 mt-1 overflow-x-auto">
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
            lastResults={lastResults}
            onFixtureClick={handleFixtureClick}
          />
        )}

        {activeTab === 'results' && (
          <ResultsTab
            world={world}
            lastResults={lastResults}
            lastNews={lastNews}
            onResultClick={handleResultClick}
            onLiveView={(r) => setLiveResult(r)}
          />
        )}

        {activeTab === 'overview' && <OverviewTab world={world} />}

        {activeTab === 'review' && lastCompletedSeason && (
          <SeasonReview world={world} seasonNumber={lastCompletedSeason} />
        )}
      </div>

      {/* ═══════ Live Match View ═══════ */}
      {liveResult && (
        <MatchLive
          result={liveResult}
          teamBases={world.teamBases}
          onClose={() => {
            setLiveResult(null);
            setActiveTab('results');
            setCelebrationType('trophy');
          }}
        />
      )}

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
  lastResults,
  onFixtureClick,
}: {
  world: GameWorld;
  currentWindow: ReturnType<ReturnType<typeof useGameStore.getState>['getCurrentWindow']>;
  lastResults: MatchResult[];
  onFixtureClick: (f: MatchFixture) => void;
}) {
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const starredFixtureIds = useGameStore((s) => s.starredFixtureIds);
  const toggleStarFixture = useGameStore((s) => s.toggleStarFixture);

  // Player highlights from the last batch of results — capped at 3.
  // Position is refined from `world.squads` when possible (the helper only
  // infers from event mix, but we have the real player record here).
  // Hooks live BEFORE the early returns so the call order stays stable.
  const playerHighlights = useMemo(() => {
    const detected = detectPlayerHighlights(lastResults);
    return detected.slice(0, 3).map(h => {
      // Refine position from the actual squad record (if the player still
      // resolves — they will, since lastResults is the latest batch).
      const squadPlayer = world.squads[h.teamId]?.find(p => p.uuid === h.playerId);
      return {
        ...h,
        position: squadPlayer?.position ?? h.position,
      };
    });
  }, [lastResults, world.squads]);

  // Per-team top scorer map — recomputed only when playerStats changes.
  // Used by the FixtureCard "射手 X N球" lines on each side.
  const teamTopScorers = useMemo(
    () => getTopScorerByTeam(world.playerStats),
    [world.playerStats],
  );

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

  // Compute focus matches (top 1-2)
  const focusMatches = pickFocusMatches(currentWindow.fixtures, world, favoriteTeamIds, 2);
  const focusFixtureIds = new Set(focusMatches.map((f) => f.fixture.id));

  // Group fixtures by competition (excluding ones already shown in focus banner)
  const groups: { label: string; color: string; fixtures: MatchFixture[] }[] = [];
  const groupMap = new Map<string, MatchFixture[]>();

  for (const f of currentWindow.fixtures) {
    if (focusFixtureIds.has(f.id)) continue; // already rendered in focus banner above
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
      {/* Focus matches banner */}
      {focusMatches.length > 0 && (
        <div className="bg-gradient-to-r from-amber-900/15 via-slate-800 to-slate-800 rounded-xl border border-amber-700/30 p-3">
          <h3 className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1.5">
            <span>🔥</span><span>本轮焦点战</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {focusMatches.map(({ fixture, importance }) => {
              const ht = world.teamBases[fixture.homeTeamId];
              const at = world.teamBases[fixture.awayTeamId];
              if (!ht || !at) return null;
              const isStarred = starredFixtureIds.includes(fixture.id);
              return (
                <div
                  key={fixture.id}
                  className="bg-slate-900/40 rounded-lg border border-amber-800/30 p-2 hover:border-amber-600/60 transition-colors cursor-pointer"
                  onClick={() => onFixtureClick(fixture)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1 flex-1 min-w-0 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ht.color }} />
                      <span className="font-semibold text-slate-100 truncate">{ht.shortName}</span>
                      <span className="text-slate-500 mx-0.5">vs</span>
                      <span className="font-semibold text-slate-100 truncate">{at.shortName}</span>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: at.color }} />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStarFixture(fixture.id); }}
                      className={`text-base shrink-0 ml-1 transition-colors cursor-pointer ${isStarred ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'}`}
                      title={isStarred ? '已加星 (推进时自动直播)' : '加星 — 推进时自动直播'}
                    >
                      {isStarred ? '★' : '☆'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {importance.reasons.slice(0, 3).map((r, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300">{r}</span>
                    ))}
                    <span className="text-[9px] text-slate-600 ml-auto">{fixture.competitionName} · {fixture.roundLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Player highlights from the previous batch of results */}
      {playerHighlights.length > 0 && (
        <div className="bg-gradient-to-r from-purple-900/15 via-slate-800 to-slate-800 rounded-xl border border-purple-700/30 p-3">
          <h3 className="text-xs font-bold text-purple-300 mb-2 flex items-center gap-1.5">
            <span>🌟</span><span>本轮焦点球员</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {playerHighlights.map((h) => {
              const team = world.teamBases[h.teamId];
              const opponentName = getTeamName(h.opponentTeamId, world.teamBases);
              return (
                <Link
                  key={`${h.playerId}-${h.fixtureId}-${h.label}`}
                  to={`/player/${h.playerId}`}
                  className="block bg-slate-900/40 rounded-lg border border-purple-800/30 p-2 hover:border-purple-500/60 transition-colors"
                >
                  <div className={`text-[11px] font-semibold mb-1 flex items-center gap-1 ${h.color}`}>
                    <span>{h.emoji}</span>
                    <span>{h.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: team?.color ?? '#64748b' }}
                    />
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {h.playerName}
                    </span>
                    {h.position && (
                      <span className="text-[9px] text-slate-500 shrink-0">({h.position})</span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">
                    {h.detail} · vs {opponentName}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5 stagger-children">
            {fixtures.map((fixture) => (
              <FixtureCard
                key={fixture.id}
                fixture={fixture}
                world={world}
                teamTopScorers={teamTopScorers}
                onClick={() => onFixtureClick(fixture)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Betting panel */}
      <BettingPanel world={world} fixtures={currentWindow.fixtures} />
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
      const homeCoachId = getTeamCoachId(world.coachStates, f.homeTeamId);
      const coach = homeCoachId ? world.coachBases[homeCoachId] : null;
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
  onLiveView,
}: {
  world: GameWorld;
  lastResults: MatchResult[];
  lastNews: { id: string; type: string; title: string; description: string }[];
  onResultClick: (r: MatchResult) => void;
  onLiveView: (r: MatchResult) => void;
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
        teamBases={world.teamBases}
        onComplete={() => setAnimComplete(true)}
        onResultClick={onResultClick}
        onLiveView={onLiveView}
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
  const topScorer = Object.values(world.playerStats).reduce<PlayerSeasonStats | null>(
    (best, s) => (s.goals > (best?.goals ?? 0) ? s : best), null
  );
  let topScorerText = '暂无';
  if (topScorer && topScorer.goals > 0) {
    // playerId is now a uuid; resolve through squads to get the shirt number.
    const tsPlayer = world.squads[topScorer.teamId]?.find(p => p.uuid === topScorer.playerId);
    const num = tsPlayer?.number ?? '';
    topScorerText = `${getTeamName(topScorer.teamId, world.teamBases)} ${num}号 (${topScorer.goals}球)`;
  }

  // Coach changes count
  const coachChanges = world.coachChangesThisSeason.length;

  return (
    <div className="space-y-4">
      {/* Season stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
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

      {/* Season buffs */}
      {(world.seasonBuffs ?? []).length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700/50 p-3">
          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">赛季剧情</h4>
          <div className="flex flex-wrap gap-2">
            {(world.seasonBuffs ?? []).map(buff => {
              const isPositive = buff.effects.some(e => e.delta > 0);
              return (
                <div key={`${buff.teamId}-${buff.type}`} className={`text-xs px-2.5 py-1 rounded-lg border ${isPositive ? 'bg-emerald-900/20 border-emerald-700/30 text-emerald-400' : 'bg-red-900/20 border-red-700/30 text-red-400'}`}>
                  <span className="font-medium">{getTeamName(buff.teamId, world.teamBases)}</span>
                  <span className="ml-1.5 opacity-75">{buff.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Season prediction — show at season start if not yet predicted */}
      {pct < 15 && !world.prediction && (() => {
        const l1Teams = Object.values(world.teamStates).filter(s => s.leagueLevel === 1).map(s => s.id);
        return (
          <PredictionPanel l1Teams={l1Teams} teamBases={world.teamBases} seasonNumber={world.seasonState.seasonNumber} />
        );
      })()}

      {/* Prediction result — settled */}
      {world.prediction?.settled && pct < 10 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700/50 p-3">
          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">上赛季竞猜结果</h4>
          <div className="flex gap-3 text-xs">
            <span>冠军预测: {getTeamName(world.prediction.champion, world.teamBases)} {world.prediction.correctCount !== undefined && world.prediction.correctCount > 0 ? '✅' : '❌'}</span>
            <span>降级预测: {getTeamName(world.prediction.relegated, world.teamBases)} {world.prediction.correctCount !== undefined && world.prediction.correctCount >= 2 ? '✅' : '❌'}</span>
          </div>
        </div>
      )}

      {/* God's Hand */}
      {!(world.godHandUsed ?? false) && (
        <GodHandPanel teamBases={world.teamBases} />
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
          <div className="bg-gradient-to-r from-blue-900/20 to-slate-800 rounded-lg border border-blue-800/30 p-3 sm:p-4">
            <h3 className="text-xs font-semibold text-blue-300 mb-2">赛季前瞻 — 第{world.seasonState.seasonNumber}赛季</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-500">夺冠热门</span>
                <div className="mt-1 space-y-0.5">
                  {favorites.map((f, i) => (
                    <div key={f.id} className="flex items-center gap-1 text-slate-300">
                      <span className="text-amber-400">{i + 1}.</span>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: world.teamBases[f.id]?.color ?? '#666' }} />
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
                            <span key={fi} className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[11px] sm:text-[9px] font-bold text-white ${f.color}`}>{f.label}</span>
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
  teamTopScorers,
  onClick,
}: {
  fixture: MatchFixture;
  world: GameWorld;
  teamTopScorers: Record<string, PlayerSeasonStats>;
  onClick: () => void;
}) {
  const starredFixtureIds = useGameStore((s) => s.starredFixtureIds);
  const toggleStarFixture = useGameStore((s) => s.toggleStarFixture);
  const isStarred = starredFixtureIds.includes(fixture.id);

  const homeTeam = world.teamBases[fixture.homeTeamId];
  const awayTeam = world.teamBases[fixture.awayTeamId];
  const homeState = world.teamStates[fixture.homeTeamId];
  const awayState = world.teamStates[fixture.awayTeamId];

  if (!homeTeam || !awayTeam || !homeState || !awayState) return null;

  const homeCoachId = getTeamCoachId(world.coachStates, fixture.homeTeamId);
  const awayCoachId = getTeamCoachId(world.coachStates, fixture.awayTeamId);
  const homeCoach = homeCoachId ? world.coachBases[homeCoachId] ?? null : null;
  const awayCoach = awayCoachId ? world.coachBases[awayCoachId] ?? null : null;

  const pred = predictMatch(homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach);

  // Get match tags
  const standings = homeState.leagueLevel === 1 ? world.league1Standings : homeState.leagueLevel === 2 ? world.league2Standings : world.league3Standings;
  const tags = getMatchTags(fixture.competitionType, fixture.roundLabel, fixture.homeTeamId, fixture.awayTeamId, standings, standings.length, world.teamBases);

  const hasGlow = tags.some(t => t.glow);

  return (
    <div
      onClick={onClick}
      className={`bg-slate-800 rounded-lg border p-2 hover:border-slate-500 hover:bg-slate-800/80 transition-all cursor-pointer group hover-lift relative ${
        hasGlow ? 'border-amber-600/50 animate-glow-pulse' : 'border-slate-700'
      }`}
      style={hasGlow ? { color: '#f59e0b' } : undefined}
    >
      {/* Star button — top-right corner */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleStarFixture(fixture.id); }}
        className={`absolute top-1 right-1 text-xs transition-colors cursor-pointer ${isStarred ? 'text-amber-400' : 'text-slate-700 hover:text-amber-400 opacity-0 group-hover:opacity-100'}`}
        title={isStarred ? '已加星' : '加星 — 推进时自动直播'}
      >
        {isStarred ? '★' : '☆'}
      </button>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex gap-1 mb-1 pr-5">
          {tags.map((t, i) => (
            <span key={i} className={`text-[10px] sm:text-[8px] px-1 py-0.5 rounded font-semibold ${t.color}`}>{t.label}</span>
          ))}
        </div>
      )}

      <div className="flex items-center mb-1.5">
        {/* Home */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <TeamName teamId={fixture.homeTeamId} teamBases={world.teamBases} showTier link={false} className="text-xs font-semibold text-slate-100 group-hover:text-blue-400" />
            <span className="text-[11px] sm:text-[9px] text-slate-500">{homeTeam.overall}</span>
          </div>
        </div>
        <span className="text-[10px] font-bold text-slate-600 px-1.5 shrink-0">VS</span>
        {/* Away */}
        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center gap-1 justify-end">
            <span className="text-[11px] sm:text-[9px] text-slate-500">{awayTeam.overall}</span>
            <TeamName teamId={fixture.awayTeamId} teamBases={world.teamBases} showTier link={false} className="text-xs font-semibold text-slate-100 group-hover:text-blue-400" />
          </div>
        </div>
      </div>

      {/* Per-side top scorer line — only shown when the team has any goals
          attributed in the current season. Resolved through the precomputed
          `teamTopScorers` map so we don't walk playerStats per card. */}
      {(() => {
        const homeScorer = teamTopScorers[fixture.homeTeamId];
        const awayScorer = teamTopScorers[fixture.awayTeamId];
        if (!homeScorer && !awayScorer) return null;
        const homePlayer = homeScorer
          ? world.squads[fixture.homeTeamId]?.find(p => p.uuid === homeScorer.playerId)
          : null;
        const awayPlayer = awayScorer
          ? world.squads[fixture.awayTeamId]?.find(p => p.uuid === awayScorer.playerId)
          : null;
        return (
          <div className="flex items-center justify-between text-[9px] text-slate-500 mb-1 gap-1">
            <span className="truncate flex-1 min-w-0">
              {homePlayer && homeScorer ? `射手 ${homePlayer.name} ${homeScorer.goals}球` : ''}
            </span>
            <span className="truncate flex-1 min-w-0 text-right">
              {awayPlayer && awayScorer ? `射手 ${awayPlayer.name} ${awayScorer.goals}球` : ''}
            </span>
          </div>
        );
      })()}

      {/* Mini probability bar */}
      <div className="flex h-0.5 rounded-full overflow-hidden bg-slate-700">
        <div className="bg-green-500" style={{ width: `${pred.homeWinPct}%` }} />
        <div className="bg-slate-400" style={{ width: `${pred.drawPct}%` }} />
        <div className="bg-red-500" style={{ width: `${pred.awayWinPct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] sm:text-[9px] mt-0.5 text-slate-500">
        <span className="text-green-400">{pred.homeWinPct}%</span>
        <span className="truncate px-1">{pred.verdict}</span>
        <span className="text-red-400">{pred.awayWinPct}%</span>
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
    retirement: '#fcd34d',
  };
  return colors[type] ?? '#64748b';
}

function PredictionPanel({ l1Teams, teamBases, seasonNumber }: { l1Teams: string[]; teamBases: Record<string, TeamBase>; seasonNumber: number }) {
  const setPrediction = useGameStore(s => s.setPrediction);
  const [champion, setChampion] = useState('');
  const [relegated, setRelegated] = useState('');

  return (
    <div className="bg-gradient-to-r from-amber-900/20 to-slate-800 rounded-lg border border-amber-700/30 p-3">
      <h4 className="text-xs font-semibold text-amber-300 mb-2">赛季竞猜 — 第{seasonNumber}赛季</h4>
      <p className="text-[10px] text-slate-500 mb-2">预测本赛季的顶级联赛冠军和降级队</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={champion} onChange={e => setChampion(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 cursor-pointer">
          <option value="">选择冠军</option>
          {l1Teams.map(id => <option key={id} value={id}>{teamBases[id]?.name ?? id}</option>)}
        </select>
        <select value={relegated} onChange={e => setRelegated(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 cursor-pointer">
          <option value="">选择降级队</option>
          {l1Teams.map(id => <option key={id} value={id}>{teamBases[id]?.name ?? id}</option>)}
        </select>
        <button onClick={() => { if (champion && relegated) setPrediction(champion, relegated); }}
          disabled={!champion || !relegated}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs rounded cursor-pointer transition-colors">
          确认预测
        </button>
      </div>
    </div>
  );
}

function GodHandPanel({ teamBases }: { teamBases: Record<string, TeamBase> }) {
  const useGodHand = useGameStore(s => s.useGodHand);
  const [show, setShow] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [type, setType] = useState<'boost' | 'nerf'>('boost');

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        className="w-full bg-slate-800 hover:bg-slate-700 border border-dashed border-slate-600 rounded-lg p-2 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer">
        上帝之手 — 本赛季可使用1次
      </button>
    );
  }

  const teamIds = Object.keys(teamBases);
  return (
    <div className="bg-slate-800 rounded-lg border border-purple-700/30 p-3">
      <h4 className="text-xs font-semibold text-purple-300 mb-2">上帝之手</h4>
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={teamId} onChange={e => setTeamId(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 cursor-pointer">
          <option value="">选择球队</option>
          {teamIds.map(id => <option key={id} value={id}>{teamBases[id]?.name ?? id}</option>)}
        </select>
        <div className="flex gap-1">
          <button onClick={() => setType('boost')}
            className={`px-3 py-1.5 text-xs rounded cursor-pointer ${type === 'boost' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
            祝福
          </button>
          <button onClick={() => setType('nerf')}
            className={`px-3 py-1.5 text-xs rounded cursor-pointer ${type === 'nerf' ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
            诅咒
          </button>
        </div>
        <button onClick={() => { if (teamId) { useGodHand(teamId, type); setShow(false); } }}
          disabled={!teamId}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs rounded cursor-pointer transition-colors">
          施法
        </button>
        <button onClick={() => setShow(false)}
          className="px-3 py-1.5 bg-slate-700 text-slate-400 text-xs rounded cursor-pointer hover:bg-slate-600">
          取消
        </button>
      </div>
    </div>
  );
}

function BettingPanel({ world, fixtures }: { world: GameWorld; fixtures: MatchFixture[] }) {
  const placeBet = useGameStore(s => s.placeBet);
  const [expanded, setExpanded] = useState(false);
  const coins = world.coins ?? 1000;
  const existingBets = world.bets ?? [];

  if (fixtures.length === 0) return null;

  const calcOdds = (homeId: string, awayId: string): { home: number; draw: number; away: number } => {
    const hOvr = world.teamBases[homeId]?.overall ?? 50;
    const aOvr = world.teamBases[awayId]?.overall ?? 50;
    const diff = hOvr - aOvr;
    const homeProb = 0.45 + diff * 0.008;
    const drawProb = 0.25;
    const awayProb = 1 - homeProb - drawProb;
    return {
      home: Math.max(1.1, +(1 / Math.max(0.05, homeProb)).toFixed(2)),
      draw: Math.max(1.5, +(1 / Math.max(0.05, drawProb)).toFixed(2)),
      away: Math.max(1.1, +(1 / Math.max(0.05, awayProb)).toFixed(2)),
    };
  };

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)}
        className="w-full bg-slate-800 hover:bg-slate-700 border border-dashed border-amber-700/30 rounded-lg p-2 text-xs text-amber-400/60 hover:text-amber-400 transition-colors cursor-pointer">
        竞猜下注 — {coins} 金币可用 {existingBets.length > 0 ? `· 已下${existingBets.length}注` : ''}
      </button>
    );
  }

  const leagueFixtures = fixtures.filter(f => f.competitionType === 'league').slice(0, 4);
  const betFixtures = leagueFixtures.length > 0 ? leagueFixtures : fixtures.slice(0, 4);

  return (
    <div className="bg-slate-800 rounded-xl border border-amber-700/30 p-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-amber-400">竞猜下注</h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-amber-300 font-medium">{coins} 金币</span>
          <button onClick={() => setExpanded(false)} className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">收起</button>
        </div>
      </div>
      <div className="space-y-2">
        {betFixtures.map(f => {
          const odds = calcOdds(f.homeTeamId, f.awayTeamId);
          const existing = existingBets.find(b => b.fixtureId === f.id);
          const homeName = world.teamBases[f.homeTeamId]?.shortName ?? '主';
          const awayName = world.teamBases[f.awayTeamId]?.shortName ?? '客';
          return (
            <div key={f.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate text-slate-300">{homeName} vs {awayName}</span>
              {existing ? (
                <span className="text-[10px] text-amber-400">已押 {existing.outcome === 'home' ? '主胜' : existing.outcome === 'away' ? '客胜' : '平局'} {existing.amount}币 @{existing.odds}</span>
              ) : (
                <div className="flex gap-1">
                  {(['home', 'draw', 'away'] as const).map(outcome => (
                    <button key={outcome} onClick={() => placeBet(f.id, outcome, 50, odds[outcome])}
                      disabled={coins < 50}
                      className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-slate-300 rounded text-[10px] cursor-pointer transition-colors">
                      {outcome === 'home' ? '主' : outcome === 'away' ? '客' : '平'} {odds[outcome]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] sm:text-[9px] text-slate-600 mt-2">每注50金币 · 赔率基于OVR差距 · 推进后自动结算</p>
    </div>
  );
}
