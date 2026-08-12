import { lazy, Suspense, useState, useEffect, useRef, useMemo, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSwipe } from '../utils/use-swipe';
import { useGameStore } from '../store/game-store';
import { predictMatch } from '../engine/match/prediction';
import { Icon } from '../components/Icon';
import type { MatchFixture, MatchResult } from '../types/match';
import type { GameWorld, NewsItem } from '../engine/season/season-manager';
import type { TeamBase } from '../types/team';
import type { PlayerSeasonStats } from '../types/player';
import MatchDetailModal from '../components/MatchDetailModal';
import SeasonReview from '../components/SeasonReview';
import Celebration from '../components/Celebration';
import { getMatchTags, shouldCelebrate } from '../components/celebration-logic';
import ResultAnimation from '../components/ResultAnimation';
import MatchLive from '../components/MatchLive';
import TeamName from '../components/TeamName';
import { pickFocusMatches } from '../engine/season/match-importance';
import { getFixtureStorylineLabel } from '../engine/season/storylines';
import { detectPlayerHighlights } from '../engine/players/player-highlights';
import { getTopScorerByTeamFromSegments } from '../engine/players/stats';
import { buildTeamCoachMap, getTeamCoachId } from '../engine/coaches/coach-lookup';
import {
  getTeamName,
  getTeamShortName,
  formatForm,
  getCoachName,
  getWindowTypeLabel,
} from '../utils/format';
import { formatMoney } from '../engine/economy/finance';
import { curateNewsFeed, getNewsTier } from '../engine/season/news-feed';
import TeamBadge from '../components/TeamBadge';
import ObservationThemePanel from '../components/ObservationThemePanel';
import { describeDashboardAction } from '../engine/observation/dashboard-action';
import { SegmentedControl } from '../components/ui';
import { WorldMomentFeature } from '../components/WorldMomentFeature';
import { worldMomentKindForNews } from '../components/world-moment';
import { playUiFeedback } from '../feedback/game-feedback';
import { buildObservationTheme } from '../engine/observation/observation-theme';
import { buildMatchdayNarrativeDigest } from '../engine/observation/narrative-sources';
import NarrativeDigest from '../components/NarrativeDigest';
import SeasonNarrativeOverview from '../components/SeasonNarrativeOverview';

const ObservationPanel = lazy(() => import('../components/ObservationPanel'));
const ObservationSettlementSummary = lazy(() => import('../components/ObservationSettlementSummary'));
const WorldResponseSummary = lazy(() => import('../components/WorldResponseSummary'));

/**
 * Compact money formatter for chip display.
 * Drops decimals when |n| ≥ 10 and uses a `€` glyph.
 */
function formatMoneyChip(n: number): string {
  return formatMoney(n);
}

type TabKey = 'matchday' | 'results' | 'overview' | 'review';

export default function Dashboard() {
  const world = useGameStore((s) => s.world);

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }
  return <DashboardContent world={world} />;
}

function DashboardContent({ world }: { world: GameWorld }) {
  const navigate = useNavigate();
  const location = useLocation();
  const lastResults = useGameStore((s) => s.lastResults);
  const lastNews = useGameStore((s) => s.lastNews);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const favoriteTeamId = useGameStore((s) => s.favoriteTeamId);
  const advanceTick = useGameStore((s) => s.advanceTick);
  const lastWorldResponse = useGameStore((s) => s.lastWorldResponse);

  const [activeTab, setActiveTab] = useState<TabKey>(() => (
    (location.state as { showLatestResults?: boolean } | null)?.showLatestResults ? 'results' : 'matchday'
  ));
  const [tabDirection, setTabDirection] = useState<'forward' | 'backward'>('forward');
  const prevAdvanceTick = useRef(advanceTick);
  const tabContentRef = useRef<HTMLDivElement>(null);
  const tabScrollPositions = useRef<Record<TabKey, number>>({ matchday: 0, results: 0, overview: 0, review: 0 });

  // Modal state
  const [selectedFixture, setSelectedFixture] = useState<MatchFixture | null>(null);
  const [selectedResult, setSelectedResult] = useState<MatchResult | null>(null);
  const [celebrationType, setCelebrationType] = useState<'trophy' | 'confetti' | null>(null);
  const [pendingLiveCelebration, setPendingLiveCelebration] = useState<'trophy' | 'confetti' | null>(null);
  const [liveResult, setLiveResult] = useState<MatchResult | null>(null);
  const [liveFeatured, setLiveFeatured] = useState(false);
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
    const prevWindow = world?.seasonState.calendar[world.seasonState.currentWindowIndex - 1];
    const nextCelebration = prevWindow
      ? shouldCelebrate(prevWindow.type, prevWindow.label, lastResults)
      : null;
    if (starredHit) {
      setLiveFeatured(true);
      setLiveResult(starredHit);
      setPendingLiveCelebration(nextCelebration);
      // Clear starred (one-shot per advance)
      clearStarredFixtures();
    } else if (finalResult) {
      setLiveFeatured(true);
      setLiveResult(finalResult);
      setPendingLiveCelebration(nextCelebration);
    } else {
      setTabDirection('forward');
      setActiveTab('results');
      setPendingLiveCelebration(null);
      if (nextCelebration) setCelebrationType(nextCelebration);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceTick]);

  // v20 — auto-redirect to /market when transfer window opens
  useEffect(() => {
    if (
      world?.transferWindow?.status === 'open'
      && window.location.pathname !== '/market'
      && !lastWorldResponse
    ) {
      navigate('/market');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world?.transferWindow?.status, lastWorldResponse?.id]);

  const currentWindow = getCurrentWindow();

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

  // teamId → coachId map for the current coach assignments. Used by the
  // favorite-team cards (top of dashboard) and any per-fixture lookups
  // further down. Memoised so the whole render does N=1 walks instead of
  // recomputing on every team card.
  const teamCoachMap = useMemo(
    () => buildTeamCoachMap(world.coachStates),
    [world],
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'matchday', label: '比赛日' },
    { key: 'results', label: '战报' },
    { key: 'overview', label: '总览' },
    ...(hasSeasonReview ? [{ key: 'review' as TabKey, label: `S${lastCompletedSeason}档案` }] : []),
  ];

  const selectTab = (nextTab: TabKey) => {
    if (nextTab === activeTab) return;
    tabScrollPositions.current[activeTab] = tabContentRef.current?.scrollTop ?? 0;
    const currentIndex = tabs.findIndex(tab => tab.key === activeTab);
    const nextIndex = tabs.findIndex(tab => tab.key === nextTab);
    setTabDirection(nextIndex >= currentIndex ? 'forward' : 'backward');
    setActiveTab(nextTab);
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (tabContentRef.current) {
        tabContentRef.current.scrollTop = tabScrollPositions.current[activeTab] ?? 0;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab]);

  // Mobile swipe — left/right between tabs
  const tabSwipeRef = useSwipe<HTMLDivElement>({
    ignoreVertical: true,
    onSwipeLeft: () => {
      const idx = tabs.findIndex(t => t.key === activeTab);
      if (idx >= 0 && idx < tabs.length - 1) selectTab(tabs[idx + 1].key);
    },
    onSwipeRight: () => {
      const idx = tabs.findIndex(t => t.key === activeTab);
      if (idx > 0) selectTab(tabs[idx - 1].key);
    },
  });

  return (
    <div data-testid="dashboard" className="dashboard-shell max-w-6xl flex flex-col h-full tabular-nums">
      <DashboardMasthead world={world} currentWindow={currentWindow} favoriteTeamId={favoriteTeamId} />

      {/* ═══════ Favorite Team Cards (up to 3) ═══════ */}
      {favoriteTeamIds.length > 0 && (() => {
        // Surface any negative-cash favorites as a Phase H alert banner.
        const broke = favoriteTeamIds.filter(tid => (world.teamFinances?.[tid]?.cash ?? 0) < 0);
        if (broke.length === 0) return null;
        return (
          <div className="bg-red-950/40 border border-red-800/50 text-red-200 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
            <span className="text-red-300"><Icon name="warning" size={14} /></span>
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
        <section data-testid="favorite-team-summaries" className="observer-club-strip mt-2" aria-label="关注球队">
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

            const isPrimary = tid === favoriteTeamId;
            return (
              <article
                key={tid}
                data-primary={isPrimary}
                className="observer-club-summary px-3 py-2"
                style={{ '--club-color': fav.color ?? '#7f9184' } as CSSProperties}
              >
                {/* Row 1 — identity + standings + form. Single line on sm+, wraps on mobile. */}
                <div className="flex items-center gap-2 sm:gap-3 text-xs">
                  <TeamBadge teamId={tid} shortName={fav.shortName} color={fav.color} size={28} />
                  <Link
                    to={`/team/${tid}`}
                    className="min-w-0 font-semibold text-[var(--text-primary)] hover:text-white"
                    title={fav.name}
                  >
                    <span className="sm:hidden">{fav.shortName}</span>
                    <span className="hidden sm:inline">{fav.name}</span>
                  </Link>
                  {isPrimary && <span className="observer-primary-label shrink-0 px-1.5 py-0.5 text-[11px] font-semibold">主要观察</span>}
                  <span className="text-[var(--text-muted)] shrink-0">#{pos} · {pts}分 · OVR {fav.overall}</span>
                  <div className="flex gap-0.5 shrink-0 ml-auto">
                    {formatForm(favState.recentForm.slice(-5)).map((f, i) => (
                      <span key={i} className={`w-4 h-4 rounded text-[11px] font-bold text-white flex items-center justify-center ${f.color}`}>{f.label}</span>
                    ))}
                  </div>
                </div>
                {/* Row 2 — cash / coach / next fixture. Always visible (no horizontal scroll). */}
                <div className={`${isPrimary ? 'flex' : 'hidden sm:flex'} items-center gap-2 sm:gap-3 mt-1.5 text-[11px] sm:text-xs flex-wrap pl-8`}>
                  <span className={`inline-flex items-center gap-0.5 ${cashTone}`} title="球队现金 (Phase H 经济)">
                    <Icon name="money" size={12} /> {formatMoneyChip(cash)}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400 truncate inline-flex items-center gap-0.5" title={`主帅 ${coachName}`}>
                    <Icon name="tie" size={12} /> {coachName}
                  </span>
                  {opponentId && (
                    <>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400">
                        下场 vs <span className="text-slate-200">{getTeamName(opponentId, world.teamBases)}</span>
                        {nextFixture?.isNeutralVenue ? (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-amber-400"><Icon name="stadium" size={11} /> 中立</span>
                        ) : (
                          <span className="text-slate-500">{nextFixture?.homeTeamId === tid ? ' (主)' : ' (客)'}</span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* ═══════ Tab Bar ═══════ */}
      <SegmentedControl
        value={activeTab}
        onChange={selectTab}
        ariaLabel="主页视图"
        scrollable
        className="dashboard-tabs mt-2 w-full"
        options={tabs.map(tab => ({
          value: tab.key,
          label: (
            <>
              {tab.label}
              {tab.key === 'results' && lastResults.length > 0 && (
                <span className="ml-1 text-[11px] opacity-75">({lastResults.length})</span>
              )}
            </>
          ),
        }))}
      />

      {/* ═══════ Tab Content (swipe left/right to switch tabs on mobile) ═══════ */}
      <div
        ref={(node) => {
          tabSwipeRef.current = node;
          tabContentRef.current = node;
        }}
        data-tab-direction={tabDirection}
        onScroll={event => { tabScrollPositions.current[activeTab] = event.currentTarget.scrollTop; }}
        className="dashboard-tab-content flex-1 overflow-auto pt-4 pb-2 touch-pan-y"
        key={activeTab}
      >
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
            key={`results-${advanceTick}`}
            world={world}
            lastResults={lastResults}
            lastNews={lastNews}
            onResultClick={handleResultClick}
            onLiveView={(r) => {
              setPendingLiveCelebration(null);
              setLiveFeatured(false);
              setLiveResult(r);
            }}
            onSeasonReview={() => selectTab('review')}
          />
        )}

        {activeTab === 'overview' && <OverviewTab world={world} />}

        {activeTab === 'review' && lastCompletedSeason && (
          <>
            <TransferWindowEntry world={world} />
            <SeasonReview world={world} seasonNumber={lastCompletedSeason} />
          </>
        )}
      </div>

      {/* ═══════ Live Match View ═══════ */}
      {liveResult && (
        <MatchLive
          result={liveResult}
          teamBases={world.teamBases}
          featured={liveFeatured}
          onClose={() => {
            setLiveResult(null);
            setLiveFeatured(false);
            setTabDirection('forward');
            setActiveTab('results');
            if (pendingLiveCelebration) setCelebrationType(pendingLiveCelebration);
            setPendingLiveCelebration(null);
          }}
        />
      )}

      {/* ═══════ Celebration ═══════ */}
      {celebrationType && (
        <Celebration
          key={`${advanceTick}-${celebrationType}`}
          active
          type={celebrationType}
          duration={celebrationType === 'trophy' ? 5000 : 3500}
        />
      )}

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

function DashboardMasthead({
  world,
  currentWindow,
  favoriteTeamId,
}: {
  world: GameWorld;
  currentWindow: ReturnType<ReturnType<typeof useGameStore.getState>['getCurrentWindow']>;
  favoriteTeamId: string | null;
}) {
  const completedWindows = world.seasonState.calendar.filter(window => window.completed).length;
  const totalWindows = world.seasonState.calendar.length;
  const currentNumber = currentWindow
    ? Math.min(world.seasonState.currentWindowIndex + 1, totalWindows)
    : totalWindows;
  const primaryTeam = favoriteTeamId ? world.teamBases[favoriteTeamId] : null;
  const progress = totalWindows > 0 ? (completedWindows / totalWindows) * 100 : 0;

  return (
    <section className="season-masthead" aria-labelledby="season-desk-title">
      <div className="season-masthead-index" aria-label={`第 ${world.seasonState.seasonNumber} 赛季`}>
        <span>SEASON</span>
        <strong>{String(world.seasonState.seasonNumber).padStart(2, '0')}</strong>
      </div>
      <div className="season-masthead-copy min-w-0">
        <div className="ui-eyebrow text-[10px] text-[var(--competition-gold)]">
          OBSERVATION DESK · {currentWindow ? getWindowTypeLabel(currentWindow.type) : 'SEASON FILED'}
        </div>
        <h1 id="season-desk-title" className="mt-1 text-base font-bold text-[var(--text-primary)] sm:text-lg">
          第 {world.seasonState.seasonNumber} 赛季观察台
        </h1>
        <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]" title={currentWindow?.label}>
          {currentWindow?.label ?? '本赛季全部窗口已完成'}
        </p>
      </div>
      <div className="season-masthead-status">
        {primaryTeam ? (
          <Link to={`/team/${primaryTeam.id}`} className="season-primary-club" title={`主要观察：${primaryTeam.name}`}>
            <TeamBadge teamId={primaryTeam.id} shortName={primaryTeam.shortName} color={primaryTeam.color} size={28} />
            <span>
              <small>主要观察</small>
              <strong>{primaryTeam.shortName}</strong>
            </span>
          </Link>
        ) : (
          <div className="season-primary-club" data-neutral="true">
            <Icon name="eye" size={18} />
            <span><small>观察视角</small><strong>全局</strong></span>
          </div>
        )}
        <div className="season-window-counter">
          <span>窗口</span>
          <strong>{currentNumber}<small>/{totalWindows}</small></strong>
        </div>
      </div>
      <div className="season-progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </section>
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
  const favoriteTeamId = useGameStore((s) => s.favoriteTeamId);
  const starredFixtureIds = useGameStore((s) => s.starredFixtureIds);
  const toggleStarFixture = useGameStore((s) => s.toggleStarFixture);
  const observationThemePreference = useGameStore((s) => s.observationThemePreference);
  const setObservationThemePreference = useGameStore((s) => s.setObservationThemePreference);
  const favoritePlayerIds = useGameStore((s) => s.favoritePlayerIds);
  const narrativeMemory = useGameStore((s) => s.narrativeMemory);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const isAdvancing = useGameStore((s) => s.isAdvancing);

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

  // Per-team top scorer map — recomputed when club segments or fallback totals change.
  // Used by the FixtureCard "射手 X N球" lines on each side.
  const teamTopScorers = useMemo(
    () => getTopScorerByTeamFromSegments(world.playerStatSegments, world.playerStats),
    [world.playerStatSegments, world.playerStats],
  );

  // Advancing first toggles `isAdvancing` so feedback can paint before the
  // simulation starts. Keep the bounded world scan out of that feedback-only
  // render; none of its inputs change until a new world is committed.
  const matchdayNarrative = useMemo(() => {
    if (!currentWindow) return null;
    const focusMatches = pickFocusMatches(
      currentWindow.fixtures,
      world,
      favoriteTeamIds,
      2,
      favoriteTeamId,
    );
    const observationTheme = buildObservationTheme(
      world,
      favoriteTeamId,
      observationThemePreference,
    );
    return {
      focusMatches,
      digest: buildMatchdayNarrativeDigest({
        world,
        currentWindow,
        observationTheme,
        focusMatches,
        playerHighlights,
        favoriteTeamIds,
        favoritePlayerIds,
        primaryFavoriteTeamId: favoriteTeamId,
        memory: narrativeMemory,
      }),
    };
  }, [
    currentWindow,
    favoritePlayerIds,
    favoriteTeamId,
    favoriteTeamIds,
    narrativeMemory,
    observationThemePreference,
    playerHighlights,
    world,
  ]);

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

  // `currentWindow` guarantees a derived narrative payload above.
  const { focusMatches, digest: narrativeDigest } = matchdayNarrative!;
  const focusFixtureIds = new Set(focusMatches.map((f) => f.fixture.id));
  const observationRelationFixtureIds = new Set(narrativeDigest.observationRelationFixtureIds);
  const pulseRelationFixtureIds = new Set([
    ...(narrativeDigest.feature?.fixtureIds ?? []),
    ...narrativeDigest.signals.flatMap(item => item.fixtureIds ?? []),
  ]);
  const actionPresentation = describeDashboardAction({
    phase: 'matchday',
    hasPendingJudgment: Boolean(world.pendingObservationJudgment),
    hasStarredFocus: focusMatches.some(entry => starredFixtureIds.includes(entry.fixture.id)),
    isAdvancing,
  });

  // Group fixtures by competition (excluding ones already shown in focus banner)
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

  const primaryTeam = favoriteTeamId ? world.teamBases[favoriteTeamId] : null;
  const openNarrativeFixture = (fixtureId: string) => {
    const fixture = world.seasonState.calendar
      .flatMap(window => window.fixtures)
      .find(item => item.id === fixtureId);
    if (fixture) onFixtureClick(fixture);
  };

  return (
    <div className="space-y-5">
      <section data-testid="observation-runway" className="observation-runway">
        <div className="flex min-h-11 items-center gap-2 border-b border-slate-700/60 px-3 py-2">
          <Icon name="eye" size={16} className="shrink-0 text-emerald-400" />
          <span className="shrink-0 text-xs font-bold text-slate-100">本轮观察</span>
          {primaryTeam && (
            <>
              <span className="text-slate-700">|</span>
              <TeamBadge
                teamId={primaryTeam.id}
                shortName={primaryTeam.shortName}
                color={primaryTeam.color}
                size={22}
              />
              <Link
                to={`/team/${primaryTeam.id}`}
                className="min-w-0 truncate text-xs font-semibold text-blue-300 hover:text-blue-200"
                title={primaryTeam.name}
              >
                {primaryTeam.shortName}
              </Link>
            </>
          )}
          <span className="ml-auto min-w-0 truncate text-right text-[11px] text-slate-500" title={currentWindow.label}>
            {currentWindow.label}
          </span>
        </div>

        <ObservationThemePanel
          world={world}
          primaryTeamId={favoriteTeamId}
          preference={observationThemePreference}
          onPreferenceChange={setObservationThemePreference}
          embedded
        />

        {/* Focus matches stay inside the same observation flow. */}
        {focusMatches.length > 0 && (
          <section data-testid="focus-matches" className="border-t border-amber-700/35 px-3 py-2 sm:py-2.5">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-400">
              <Icon name="fire" size={16} accent="#f97316" /><span>本轮焦点战</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {focusMatches.map(({ fixture, importance }, focusIndex) => {
                const ht = world.teamBases[fixture.homeTeamId];
                const at = world.teamBases[fixture.awayTeamId];
                if (!ht || !at) return null;
                const isStarred = starredFixtureIds.includes(fixture.id);
                const storylineLabel = getFixtureStorylineLabel(
                  world,
                  fixture.homeTeamId,
                  fixture.awayTeamId,
                );
                const relationLabel = observationRelationFixtureIds.has(fixture.id)
                  ? '与观察主题同线'
                  : pulseRelationFixtureIds.has(fixture.id)
                    ? '与世界脉搏同线'
                    : null;
                const observedTeamId = favoriteTeamId
                  && (fixture.homeTeamId === favoriteTeamId || fixture.awayTeamId === favoriteTeamId)
                  ? favoriteTeamId
                  : null;
                const observedScorer = observedTeamId ? teamTopScorers[observedTeamId] : undefined;
                const observedSquad = observedTeamId ? world.squads[observedTeamId] ?? [] : [];
                const keyPlayer = observedScorer
                  ? observedSquad.find(player => player.uuid === observedScorer.playerId)
                  : observedSquad.reduce<(typeof observedSquad)[number] | null>(
                      (best, player) => !best || player.rating > best.rating ? player : best,
                      null,
                    );
                const keyPlayerLabel = keyPlayer
                  ? observedScorer && observedScorer.goals > 0
                    ? `${keyPlayer.name} ${observedScorer.goals}球`
                    : `${keyPlayer.name} 评分${keyPlayer.rating}`
                  : null;
                const displayReasons = relationLabel
                  ? importance.reasons.filter(reason => !reason.includes('观察球队出战'))
                  : importance.reasons;
                const reasonLimit = Math.max(
                  0,
                  (storylineLabel || relationLabel ? 2 : 3) - (keyPlayerLabel ? 1 : 0),
                );
                return (
                  <div
                    key={fixture.id}
                    data-fixture-id={fixture.id}
                    data-secondary={focusIndex > 0 ? 'true' : 'false'}
                    className="matchday-focus-fixture"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        playUiFeedback(isStarred ? 'toggle_off' : 'toggle_on');
                        toggleStarFixture(fixture.id);
                      }}
                      data-testid="focus-watch-toggle"
                      aria-label={isStarred ? '取消锁定焦点观战' : '锁定本场并在推进后无剧透观战'}
                      aria-pressed={isStarred}
                      className={`focus-watch-toggle press-scale inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center border transition-[color,background-color,border-color,box-shadow] ${isStarred ? 'border-amber-400/60 bg-amber-400/12 text-amber-300 shadow-[0_0_0_3px_rgba(251,191,36,0.08)]' : 'border-transparent bg-black/20 text-slate-500 hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200'}`}
                      title={isStarred ? '已锁定无剧透观战' : '推进后直接进入无剧透直播'}
                    >
                      <Icon name={isStarred ? 'lock' : 'eye'} size={18} />
                    </button>
                    <button
                      type="button"
                      className="focus-fixture-open min-w-0 text-left"
                      onClick={() => onFixtureClick(fixture)}
                      aria-label={`查看 ${ht.name} 对 ${at.name} 的赛前信息`}
                    >
                      <div className="focus-fixture-main mb-1 flex items-center justify-between">
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                        <TeamBadge teamId={fixture.homeTeamId} shortName={ht.shortName} color={ht.color} size={26} />
                        <span className="truncate font-semibold text-slate-100" title={ht.name}>{ht.shortName}</span>
                        <span className="mx-0.5 text-slate-500">vs</span>
                        <span className="truncate font-semibold text-slate-100" title={at.name}>{at.shortName}</span>
                        <TeamBadge teamId={fixture.awayTeamId} shortName={at.shortName} color={at.color} size={26} />
                      </div>
                    </div>
                    <div className="focus-fixture-details flex flex-wrap gap-1">
                      {relationLabel ? (
                        <span className="rounded bg-emerald-900/35 px-1.5 py-0.5 text-[11px] text-emerald-200">
                          {relationLabel}
                        </span>
                      ) : storylineLabel ? (
                        <span className="rounded bg-emerald-900/35 px-1.5 py-0.5 text-[11px] text-emerald-200">
                          {storylineLabel}
                        </span>
                      ) : null}
                      {keyPlayerLabel && (
                        <span className="rounded bg-sky-900/35 px-1.5 py-0.5 text-[11px] text-sky-200">
                          关键球员 {keyPlayerLabel}
                        </span>
                      )}
                      {displayReasons.slice(0, reasonLimit).map((r, i) => (
                        <span key={i} className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[11px] text-amber-200">{r}</span>
                      ))}
                      <span className="ml-auto text-[11px] text-slate-500">{fixture.competitionName} · {fixture.roundLabel}</span>
                    </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="border-t border-slate-700/60 px-3 py-2.5">
          <Suspense fallback={<div aria-hidden className="h-11 w-full rounded border border-slate-700 bg-slate-900/50" />}>
            <ObservationPanel
              world={world}
              fixtures={focusMatches.length > 0 ? focusMatches.map(entry => entry.fixture) : currentWindow.fixtures.slice(0, 2)}
              embedded
              advanceAction={{
                isAdvancing,
                label: actionPresentation.label,
                ariaLabel: actionPresentation.ariaLabel,
                stageLabel: getWindowTypeLabel(currentWindow.type),
                onAdvance: () => void advanceWindow(),
              }}
            />
          </Suspense>
        </div>
      </section>

      <NarrativeDigest
        digest={narrativeDigest}
        windowLabel={currentWindow.label}
        onFixtureClick={openNarrativeFixture}
      />

      {/* Grouped fixtures */}
      {sorted.map(([groupName, fixtures]) => (
        <div key={groupName}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-1 h-5 rounded-full ${groupColors[groupName] ? groupColors[groupName].replace('border-', 'bg-') : 'bg-purple-500'}`} />
            <h3 className="text-sm font-semibold text-slate-200">{groupName}</h3>
            <span className="text-[11px] text-slate-500">{fixtures.length}场</span>
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
    </div>
  );
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
  onSeasonReview,
}: {
  world: GameWorld;
  lastResults: MatchResult[];
  lastNews: NewsItem[];
  onResultClick: (r: MatchResult) => void;
  onLiveView: (r: MatchResult) => void;
  onSeasonReview: () => void;
}) {
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const lastObservationSettlements = useGameStore((s) => s.lastObservationSettlements);
  const lastWorldResponse = useGameStore((s) => s.lastWorldResponse);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const isAdvancing = useGameStore((s) => s.isAdvancing);
  const currentWindow = useGameStore((s) => s.getCurrentWindow)();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const handleAdvance = () => {
    playUiFeedback('advance');
    void advanceWindow().then(advanced => {
      if (!advanced) playUiFeedback('reject');
    });
  };
  const favoriteTeamNames = favoriteTeamIds
    .flatMap(teamId => {
      const team = world.teamBases[teamId];
      return team ? [team.name, team.shortName] : [];
    })
    .filter(Boolean);
  const displayedFixtureIds = useMemo(
    () => new Set([
      ...lastResults.map(result => result.fixtureId),
      ...(lastWorldResponse?.featuredResults.map(item => item.result.fixtureId) ?? []),
    ]),
    [lastResults, lastWorldResponse],
  );
  const curatedNews = curateNewsFeed(
    lastNews.length > 0 ? lastNews : world.newsLog,
    { favoriteTeamNames, excludedFixtureIds: displayedFixtureIds, limit: 8 },
  );
  const headlineMoment = lastWorldResponse
    ? undefined
    : curatedNews.find(news => (
      getNewsTier(news, favoriteTeamNames) === 'headline'
      && worldMomentKindForNews(news) !== null
    ));
  const resultsAction = describeDashboardAction({ phase: 'results', isAdvancing });

  if (!lastWorldResponse && lastResults.length === 0 && curatedNews.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-500">暂无比赛结果，请先推进模拟</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {lastWorldResponse ? (
        <Suspense fallback={<div className="h-32 border-y border-slate-700/60" aria-hidden />}>
          <WorldResponseSummary
            response={lastWorldResponse}
            world={world}
            onResultClick={onResultClick}
            onSeasonReview={onSeasonReview}
          />
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <ObservationSettlementSummary
            settlements={lastObservationSettlements}
            record={world.observationRecord}
            teamBases={world.teamBases}
          />
        </Suspense>
      )}

      {currentWindow && (
        <div
          data-testid="results-next-action"
          className="flex min-h-11 items-center gap-3 border-y border-slate-700/60 bg-slate-900/30 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-slate-400">下一窗口</div>
            <div className="truncate text-xs text-slate-500" title={currentWindow.label}>{currentWindow.label}</div>
          </div>
          <button
            type="button"
            data-testid="dashboard-advance"
            aria-label={resultsAction.ariaLabel}
            aria-busy={isAdvancing}
            disabled={isAdvancing}
            onClick={handleAdvance}
            className="ui-action-feedback flex min-h-11 shrink-0 items-center justify-center gap-2 rounded bg-[var(--action)] px-3 text-white transition-colors hover:bg-[var(--action-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-raised)] disabled:text-[var(--text-disabled)]"
          >
            <Icon name="play" size={16} />
            <span className="text-xs font-semibold">{resultsAction.label}</span>
          </button>
        </div>
      )}

      {lastWorldResponse && (
        <button
          type="button"
          data-testid="toggle-full-report"
          onClick={() => setDetailsOpen(value => !value)}
          className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-blue-300 hover:text-blue-200"
        >
          <Icon name={detailsOpen ? 'arrow-up' : 'arrow-down'} size={15} />
          {detailsOpen
            ? '收起完整战报'
            : lastWorldResponse.advancedWindows > 1
              ? '查看最近一轮完整战报'
              : '查看完整战报与新闻'}
        </button>
      )}

      {(!lastWorldResponse || detailsOpen) && (
        <div data-testid="full-report" className="space-y-4">
          {lastResults.length > 0 ? (
            <ResultAnimation
              results={lastResults}
              teamBases={world.teamBases}
              priorityTeamIds={favoriteTeamIds}
              onComplete={() => undefined}
              onResultClick={onResultClick}
              onLiveView={onLiveView}
            />
          ) : (
            <p className="text-xs text-slate-400">
              {world.totalElapsedWindows === 0
                ? '宇宙刚刚建立，本赛季的开幕动态如下。'
                : '本次推进完成了赛季结算，重点动态如下。'}
            </p>
          )}

          {(lastNews.length > 0 || world.newsLog.length > 0) && (
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2">
                <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
                新闻动态
              </h3>
              {headlineMoment && (
                <div className="mb-2.5">
                  <WorldMomentFeature news={headlineMoment} />
                </div>
              )}
              <div className="space-y-1.5">
                {curatedNews.filter(news => news.id !== headlineMoment?.id).map(
                  (news) => (
                    <div
                      key={news.id}
                      data-fixture-id={news.fixtureId}
                      className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700"
                      style={{
                        borderLeftWidth: '3px',
                        borderLeftColor: getNewsBorderColor(news.type),
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-sm text-slate-200">{news.title}</p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {getNewsTier(news, favoriteTeamNames) === 'headline' ? '头条' : getNewsTier(news, favoriteTeamNames) === 'notable' ? '重点' : '简讯'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{news.description}</p>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Tab: 总览
// ══════════════════════════════════════════════════════════════════════

function OverviewTab({ world }: { world: GameWorld }) {
  const favoriteTeamId = useGameStore((state) => state.favoriteTeamId);
  const favoritePlayerIds = useGameStore((state) => state.favoritePlayerIds);
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
  const worldCupEdition = world.worldCupEditions?.find(
    edition => edition.seasonNumber === world.seasonState.seasonNumber,
  );

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
      {(wcStatus || worldCupEdition) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-sky-800/30 bg-sky-900/15 px-3 py-2">
          <span className="text-xs text-sky-400 font-medium">环球冠军杯</span>
          <span className="text-xs text-sky-300">{wcStatus ?? '东道主已揭晓'}</span>
          {worldCupEdition && <span className="text-xs text-emerald-300">主办: {getTeamName(worldCupEdition.hostTeamId, world.teamBases)}</span>}
          {world.worldCup?.winnerId && <span className="text-xs text-amber-400">冠军: {getTeamName(world.worldCup.winnerId, world.teamBases)}</span>}
        </div>
      )}

      <SeasonNarrativeOverview
        world={world}
        primaryTeamId={favoriteTeamId}
        favoritePlayerIds={favoritePlayerIds}
      />

      {/* Season buffs */}
      {(world.seasonBuffs ?? []).length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700/50 p-3">
          <h4 className="mb-2 text-[11px] font-semibold text-slate-500">赛季剧情</h4>
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
      {world.predictionHistory?.at(-1) && pct < 10 && (() => {
        const previousPrediction = world.predictionHistory!.at(-1)!;
        return (
        <div className="bg-slate-800 rounded-lg border border-slate-700/50 p-3">
          <h4 className="mb-2 text-[11px] font-semibold text-slate-500">上赛季观察预测</h4>
          <div className="flex gap-3 text-xs">
            <span>冠军预测: {getTeamName(previousPrediction.champion, world.teamBases)} {previousPrediction.championCorrect ? '✅' : '❌'}</span>
            <span>降级预测: {getTeamName(previousPrediction.relegated, world.teamBases)} {previousPrediction.relegatedCorrect ? '✅' : '❌'}</span>
          </div>
        </div>
        );
      })()}

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
                  {worldCupEdition && <div className="mt-1 text-slate-400">东道主：{getTeamName(worldCupEdition.hostTeamId, world.teamBases)}</div>}
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
              <Link to={`/league/${level}`} className="text-[11px] text-slate-500 hover:text-blue-400">全部 &rarr;</Link>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] text-slate-500">
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
                          <Link to={`/team/${entry.teamId}`} className="text-slate-200 hover:text-blue-400 whitespace-nowrap" title={getTeamName(entry.teamId, world.teamBases)}>{getTeamShortName(entry.teamId, world.teamBases)}</Link>
                        </div>
                      </td>
                      <td className="text-center px-1 py-1.5 font-semibold text-slate-200">{entry.points}</td>
                      <td className="text-center px-1 py-1.5">
                        <div className="flex gap-0.5 justify-center">
                          {formatForm(entry.form.slice(-3)).map((f, fi) => (
                            <span key={fi} className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[11px] font-bold text-white ${f.color}`}>{f.label}</span>
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
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-200 mt-0.5 truncate" title={value}>{value}</div>
      <div className="truncate text-[11px] text-slate-500" title={sub}>{sub}</div>
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

  const pred = predictMatch(homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach, {
    fixture,
    homeSquad: world.squads[fixture.homeTeamId],
    awaySquad: world.squads[fixture.awayTeamId],
    globalWindowIdx: world.totalElapsedWindows,
  });

  // Get match tags
  const standings = homeState.leagueLevel === 1 ? world.league1Standings : homeState.leagueLevel === 2 ? world.league2Standings : world.league3Standings;
  const tags = getMatchTags(fixture.competitionType, fixture.roundLabel, fixture.homeTeamId, fixture.awayTeamId, standings, standings.length, world.teamBases);

  const hasGlow = tags.some(t => t.glow);

  return (
    <div
      data-fixture-id={fixture.id}
      className={`fixture-sheet border transition-all group relative ${
        hasGlow ? 'border-amber-600/50 animate-glow-pulse' : 'border-slate-700'
      }`}
      style={hasGlow ? { color: '#f59e0b' } : undefined}
    >
      {/* Spoiler-free watch button — top-right corner */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          playUiFeedback(isStarred ? 'toggle_off' : 'toggle_on');
          toggleStarFixture(fixture.id);
        }}
        aria-label={isStarred ? '取消锁定焦点观战' : '锁定本场并在推进后无剧透观战'}
        aria-pressed={isStarred}
        className={`press-scale absolute right-1 top-1 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border transition-[color,background-color,border-color,opacity,box-shadow] ${isStarred ? 'border-amber-400/55 bg-amber-400/10 text-amber-300 shadow-[0_0_0_3px_rgba(251,191,36,0.07)]' : 'border-transparent bg-slate-950/20 text-slate-500 hover:border-slate-600 hover:bg-slate-900/75 hover:text-slate-200 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100'}`}
        title={isStarred ? '已锁定无剧透观战' : '推进后无剧透观战'}
      >
        <Icon name={isStarred ? 'lock' : 'eye'} size={18} />
      </button>

      <button
        type="button"
        onClick={onClick}
        className="fixture-sheet-open block w-full p-2 pr-3 text-left"
        aria-label={`查看 ${homeTeam.name} 对 ${awayTeam.name} 的赛前信息`}
      >

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex gap-1 mb-1 pr-10">
          {tags.map((t, i) => (
            <span key={i} className={`px-1 py-0.5 text-[11px] rounded font-semibold ${t.color}`}>{t.label}</span>
          ))}
        </div>
      )}

      <div className="flex items-center mb-1.5">
        {/* Home */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <TeamName teamId={fixture.homeTeamId} teamBases={world.teamBases} badgeSize={20} link={false} compact className="text-xs font-semibold text-slate-100 group-hover:text-blue-400" />
            <span className="text-[11px] text-slate-500">{homeTeam.overall}</span>
          </div>
        </div>
        <span className="shrink-0 px-1.5 text-[11px] font-bold text-slate-500">VS</span>
        {/* Away */}
        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center gap-1 justify-end">
            <span className="text-[11px] text-slate-500">{awayTeam.overall}</span>
            <TeamName teamId={fixture.awayTeamId} teamBases={world.teamBases} badgeSize={20} link={false} compact className="text-xs font-semibold text-slate-100 group-hover:text-blue-400" />
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
          ? Object.values(world.squads).flatMap((squad) => squad).find(p => p.uuid === homeScorer.playerId)
          : null;
        const awayPlayer = awayScorer
          ? Object.values(world.squads).flatMap((squad) => squad).find(p => p.uuid === awayScorer.playerId)
          : null;
        return (
          <div className="mb-1 flex items-center justify-between gap-1 text-[11px] text-slate-500">
            <span className="truncate flex-1 min-w-0" title={homePlayer && homeScorer ? `射手 ${homePlayer.name} ${homeScorer.goals}球` : undefined}>
              {homePlayer && homeScorer ? `射手 ${homePlayer.name} ${homeScorer.goals}球` : ''}
            </span>
            <span className="truncate flex-1 min-w-0 text-right" title={awayPlayer && awayScorer ? `射手 ${awayPlayer.name} ${awayScorer.goals}球` : undefined}>
              {awayPlayer && awayScorer ? `射手 ${awayPlayer.name} ${awayScorer.goals}球` : ''}
            </span>
          </div>
        );
      })()}

      {/* Mini probability bar */}
      <div className="flex h-1 overflow-hidden rounded-full bg-slate-700">
        <div className="bg-green-500" style={{ width: `${pred.homeWinPct}%` }} />
        <div className="bg-slate-400" style={{ width: `${pred.drawPct}%` }} />
        <div className="bg-red-500" style={{ width: `${pred.awayWinPct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span className="text-green-400">{pred.homeWinPct}%</span>
        <span className="truncate px-1" title={pred.verdict}>{pred.verdict}</span>
        <span className="text-red-400">{pred.awayWinPct}%</span>
      </div>
      </button>
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
    intervention: '#d8b4fe',
    storyline: '#34d399',
  };
  return colors[type] ?? '#64748b';
}

function PredictionPanel({ l1Teams, teamBases, seasonNumber }: { l1Teams: string[]; teamBases: Record<string, TeamBase>; seasonNumber: number }) {
  const setPrediction = useGameStore(s => s.setPrediction);
  const [champion, setChampion] = useState('');
  const [relegated, setRelegated] = useState('');

  return (
    <div className="bg-gradient-to-r from-amber-900/20 to-slate-800 rounded-lg border border-amber-700/30 p-3">
      <h4 className="text-xs font-semibold text-amber-300 mb-2">赛季观察预测 — 第{seasonNumber}赛季</h4>
      <p className="mb-2 text-[11px] text-slate-500">预测本赛季的顶级联赛冠军和降级队</p>
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
        <button onClick={() => {
          if (champion && relegated) {
            setPrediction(champion, relegated);
            playUiFeedback('confirm');
          }
        }}
          disabled={!champion || !relegated}
          className="press-scale px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs rounded cursor-pointer transition-colors">
          确认预测
        </button>
      </div>
    </div>
  );
}

function GodHandPanel({ teamBases }: { teamBases: Record<string, TeamBase> }) {
  const applyGodHand = useGameStore(s => s.useGodHand);
  const [show, setShow] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [type, setType] = useState<'boost' | 'nerf'>('boost');

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-purple-800/40 bg-slate-800 p-2 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 cursor-pointer">
        <Icon name="sparkle" size={14} />
        命运实验 · 本赛季可选 1 次
      </button>
    );
  }

  const teamIds = Object.keys(teamBases);
  return (
    <div className="rounded-lg border border-purple-700/30 bg-slate-800 p-3" data-testid="god-hand-panel">
      <div className="mb-3">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-purple-300">
          <Icon name="sparkle" size={14} />
          命运实验
        </h4>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          这是可选的永久干预，会改变球队基础能力并记录在宇宙历史；自然比赛仍由当前种子继续演化。
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={teamId} onChange={e => setTeamId(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 cursor-pointer">
          <option value="">选择球队</option>
          {teamIds.map(id => <option key={id} value={id}>{teamBases[id]?.name ?? id}</option>)}
        </select>
        <div className="flex gap-1">
          <button onClick={() => { if (type !== 'boost') playUiFeedback('selection'); setType('boost'); }}
            className={`px-3 py-1.5 text-xs rounded cursor-pointer ${type === 'boost' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
            祝福
          </button>
          <button onClick={() => { if (type !== 'nerf') playUiFeedback('selection'); setType('nerf'); }}
            className={`px-3 py-1.5 text-xs rounded cursor-pointer ${type === 'nerf' ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
            厄运
          </button>
        </div>
        <button onClick={() => {
          if (teamId) {
            applyGodHand(teamId, type);
            playUiFeedback('intervention');
            setShow(false);
          }
        }}
          disabled={!teamId}
          className="press-scale px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs rounded cursor-pointer transition-colors">
          确认干预
        </button>
        <button onClick={() => setShow(false)}
          className="px-3 py-1.5 bg-slate-700 text-slate-400 text-xs rounded cursor-pointer hover:bg-slate-600">
          取消
        </button>
      </div>
    </div>
  );
}

/**
 * v23 — Non-blocking transfer window entry. Shows ONLY in the season
 * review tab when there's an unhandled favorite-team transfer window.
 * "处理" navigates to /market for manual review; "全自动" closes with
 * auto-resolve. If user just clicks "推进" without ever opening this,
 * the safety net in season-manager.ts auto-resolves on the next window
 * advance (one news item is emitted to make that visible).
 */
function TransferWindowEntry({ world }: { world: GameWorld }) {
  const navigate = useNavigate();
  const closeTransferWindow = useGameStore(s => s.closeTransferWindow);
  if (!world.transferWindow || world.transferWindow.status !== 'open') return null;
  const tw = world.transferWindow;
  const pendingOffers = tw.incomingOffers.filter(o => o.resolution === 'pending').length;
  const pendingTargets = tw.outgoingTargets.filter(t => t.resolution === 'pending').length;
  const totalPending = pendingOffers + pendingTargets;
  return (
    <div className="bg-gradient-to-br from-amber-900/30 to-slate-800/60 rounded-xl border border-amber-700/50 p-4 mb-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="text-2xl shrink-0 text-amber-400"><Icon name="stadium" size={28} /></div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-300">第{tw.season}赛季转会窗口</div>
          <div className="text-xs text-slate-400 mt-1">
            {totalPending > 0
              ? <>共 <span className="text-amber-300 font-bold">{totalPending}</span> 项待处理:
                  <span className="text-slate-300 ml-1">{pendingOffers} 项报价</span>、
                  <span className="text-slate-300">{pendingTargets} 项目标</span></>
              : '所有决策已完成,点击「完成」收尾'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">不处理也没关系，下次推进时会按默认策略自动结算。</div>
        </div>
        <div className="flex gap-2 ml-auto shrink-0">
          <button
            onClick={() => navigate('/market')}
            className="px-3 py-2 min-h-[36px] bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium rounded cursor-pointer inline-flex items-center gap-1"
          >
            <Icon name="cart" size={14} /> 处理
          </button>
          <button
            onClick={() => closeTransferWindow(true)}
            className="px-3 py-2 min-h-[36px] bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded cursor-pointer inline-flex items-center gap-1"
          >
            <Icon name="bolt" size={14} /> 全自动
          </button>
        </div>
      </div>
    </div>
  );
}
