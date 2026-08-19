import { useEffect, useLayoutEffect, useRef, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MatchResult } from '../types/match';
import type { TeamBase } from '../types/team';
import PitchCanvas from './PitchCanvas';
import { Icon } from './Icon';
import { PLAYBACK_MODE_OPTIONS } from './match-live/playback-mode';
import { playGameFeedback, unlockGameAudio } from '../feedback/game-feedback';
import {
  createMatchSoundscape,
  isPresentationSequencedSoundEvent,
  type MatchSoundscape,
} from '../feedback/match-soundscape';
import type {
  MatchPresentationAtmosphere,
  MatchPresentationCue,
} from '../types/match-presentation';
import {
  setFeedbackPreferences,
  useFeedbackPreferences,
} from '../feedback/preferences';
import liveScoreboardArtwork from '../assets/visual/live-scoreboard-v1.webp';
import { DecorativeImage } from './DecorativeImage';
import TeamBadge from './TeamBadge';
import {
  buildLiveCommentary,
  buildLiveCommentaryHistory,
  shootoutEventLabel,
} from './match-live/live-commentary';
import LiveCommentaryFeed from './match-live/LiveCommentaryFeed';
import ShootoutTracker from './match-live/ShootoutTracker';
import { useMatchPlaybackController } from './match-live/use-match-playback-controller';
import {
  matchOpenerArtworkForCompetition,
  matchOpenerKindForCompetition,
  matchOpenerLabel,
} from './match-live/match-opener-artwork';
import { holdTournamentMusic } from '../feedback/tournament-music-session';
import {
  APPROACH_LABELS,
  TACTICS_REASON_LABELS,
} from '../engine/coaches/tactics';
import {
  describeFeaturedMatchup,
  FEATURED_PLAYER_REASON_LABELS,
  PLAYER_IMPACT_UNIT_LABELS,
} from '../engine/players/star-presence';
import { computeMatchPlayerImpacts } from '../engine/players/match-player-impact';

interface Props {
  result: MatchResult;
  teamBases: Record<string, TeamBase>;
  onClose: () => void;
  /** Opens with a spoiler-free broadcast slate before revealing the 0-0 clock. */
  featured?: boolean;
}

function playbackKey(result: MatchResult): string {
  const eventKey = result.events.map((event, index) =>
    `${index}:${event.minute}:${event.type}:${event.teamId}:${event.playerId ?? ''}`,
  ).join(',');
  return `${result.fixtureId}:${result.homeGoals}:${result.awayGoals}:${result.etHomeGoals ?? 0}:${result.etAwayGoals ?? 0}:${eventKey}`;
}

export default function MatchLive(props: Props) {
  return <MatchLiveSession key={`${playbackKey(props.result)}:${props.featured ? 'featured' : 'standard'}`} {...props} />;
}

function MatchLiveSession({ result, teamBases, onClose, featured = false }: Props) {
  const [locallyMuted, setLocallyMuted] = useState(false);
  const feedbackPreferences = useFeedbackPreferences();
  const prestigeOpener = featured || result.roundLabel === 'Final' || result.roundLabel === '决赛';
  const openerFinal = result.roundLabel === 'Final' || result.roundLabel === '决赛';
  const openerKind = matchOpenerKindForCompetition(result.competitionType);
  const openerArtwork = matchOpenerArtworkForCompetition(result.competitionType);
  const [showOpener, setShowOpener] = useState(prestigeOpener);
  const {
    playback,
    allEvents,
    shownEvents,
    pendingPresentationEvent,
    maxMinute: maxMin,
    timelineMax,
    pageVisible,
    reducedMotion,
    finished,
    paused,
    halftime,
    extraTimeBreak,
    shootoutBreak,
    isBreak,
    inShootout,
    stageLabel,
    setPresentationHolding,
    setPitchAvailable,
    commitPresentationCue,
    setMode,
    togglePause,
    skip,
  } = useMatchPlaybackController({ result, openerVisible: showOpener });
  const soundscapeRef = useRef<MatchSoundscape | null>(null);
  const previousPhaseRef = useRef(playback.phase);
  const [matchMusicHoldOwner] = useState(() => `match-live-${result.fixtureId}`);

  const ht = teamBases[result.homeTeamId];
  const at = teamBases[result.awayTeamId];
  const shootoutEvents = shownEvents.filter(event => event.type === 'penalty_goal' || event.type === 'penalty_miss');
  const featuredPlayers = useMemo(() => result.featuredPlayers ?? [], [result.featuredPlayers]);
  const featuredPlayerIds = useMemo(
    () => featuredPlayers.map(player => player.playerId),
    [featuredPlayers],
  );
  const featuredMatchup = useMemo(
    () => describeFeaturedMatchup(featuredPlayers, result.homeTeamId, result.awayTeamId),
    [featuredPlayers, result.awayTeamId, result.homeTeamId],
  );
  const matchImpactsByPlayer = useMemo(() => {
    const totalHome = result.homeGoals + (result.etHomeGoals ?? 0);
    const totalAway = result.awayGoals + (result.etAwayGoals ?? 0);
    const winnerTeamId = totalHome > totalAway
      ? result.homeTeamId
      : totalAway > totalHome
        ? result.awayTeamId
        : null;
    return new Map(computeMatchPlayerImpacts({ ...result, winnerTeamId })
      .map(impact => [impact.playerId, impact]));
  }, [result]);

  useEffect(() => {
    if (!showOpener) return;
    const timer = window.setTimeout(
      () => setShowOpener(false),
      reducedMotion ? 650 : 2200,
    );
    return () => window.clearTimeout(timer);
  }, [reducedMotion, showOpener]);

  useLayoutEffect(
    () => holdTournamentMusic(matchMusicHoldOwner),
    [matchMusicHoldOwner],
  );

  useEffect(() => {
    const soundscape = createMatchSoundscape({
      result,
      featured: prestigeOpener,
      muted: !feedbackPreferences.soundEnabled || locallyMuted,
      profile: feedbackPreferences.soundProfile,
      effectsVolume: feedbackPreferences.effectsVolume,
    });
    soundscapeRef.current = soundscape;
    if (feedbackPreferences.soundEnabled && !locallyMuted) soundscape.start();
    return () => {
      soundscape.stop();
      if (soundscapeRef.current === soundscape) soundscapeRef.current = null;
    };
    // Each MatchLiveSession is keyed by result and presentation, so this owns
    // exactly one soundscape lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    soundscapeRef.current?.setMuted(!feedbackPreferences.soundEnabled || locallyMuted || !pageVisible);
  }, [feedbackPreferences.soundEnabled, locallyMuted, pageVisible]);

  useEffect(() => {
    soundscapeRef.current?.setProfile(feedbackPreferences.soundProfile);
  }, [feedbackPreferences.soundProfile]);

  useEffect(() => {
    soundscapeRef.current?.setLevels(feedbackPreferences.effectsVolume);
  }, [feedbackPreferences.effectsVolume]);

  useEffect(() => {
    soundscapeRef.current?.update({
      minute: playback.minute,
      maxMinute: timelineMax,
      homeScore: playback.homeScore,
      awayScore: playback.awayScore,
      inShootout,
      paused: playback.phase !== 'playing' || showOpener,
    });
  }, [
    inShootout,
    playback.awayScore,
    playback.homeScore,
    playback.minute,
    playback.phase,
    showOpener,
    timelineMax,
  ]);

  const handlePresentationCue = useCallback((cue: MatchPresentationCue) => {
    commitPresentationCue(cue);
    if (!feedbackPreferences.soundEnabled || locallyMuted || !pageVisible || showOpener) return;
    const soundscape = soundscapeRef.current;
    soundscape?.playPresentation(cue);
  }, [
    commitPresentationCue,
    feedbackPreferences.soundEnabled,
    locallyMuted,
    pageVisible,
    showOpener,
  ]);

  const handlePresentationAtmosphere = useCallback((snapshot: MatchPresentationAtmosphere) => {
    soundscapeRef.current?.updatePresentation(snapshot);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!feedbackPreferences.soundEnabled || locallyMuted || !playback.flashEvent) return;
    const soundscape = soundscapeRef.current;
    if (isPresentationSequencedSoundEvent(playback.flashEvent)) {
      const isGoal = playback.flashEvent.type === 'goal'
        || playback.flashEvent.type === 'own_goal'
        || playback.flashEvent.type === 'penalty_goal';
      if (isGoal && !soundscape?.started) playGameFeedback('goal');
      return;
    }
    soundscape?.playEvent(playback.flashEvent);
  }, [
    feedbackPreferences.soundEnabled,
    locallyMuted,
    playback.flashEvent,
    playback.flashVersion,
  ]);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = playback.phase;
    if (previous === playback.phase || !feedbackPreferences.soundEnabled || locallyMuted) return;
    if (playback.phase === 'halftime') soundscapeRef.current?.playStage('halftime');
    else if (playback.phase === 'extra_time_break') soundscapeRef.current?.playStage('extra_time');
    else if (playback.phase === 'shootout_break') soundscapeRef.current?.playStage('shootout');
    else if (playback.phase === 'finished') soundscapeRef.current?.playStage('fulltime');
  }, [feedbackPreferences.soundEnabled, locallyMuted, playback.phase]);

  const commentaryEntries = useMemo(() => buildLiveCommentaryHistory({
    events: shownEvents,
    currentMinute: playback.minute,
    homeTeamId: result.homeTeamId,
    homeTeamName: ht?.name ?? '主队',
    awayTeamName: at?.name ?? '客队',
  }), [at?.name, ht?.name, playback.minute, result.homeTeamId, shownEvents]);

  // Commentary text for current state
  const commentary = useMemo(() => {
    if (finished) return `比赛结束，最终比分 ${playback.homeScore}:${playback.awayScore}${result.penalties ? `，点球 ${playback.penaltyHomeScore}:${playback.penaltyAwayScore}` : ''}。`;
    if (halftime) return `中场休息，比分 ${playback.homeScore}:${playback.awayScore}。`;
    if (extraTimeBreak) return '九十分钟未分胜负，双方准备进入加时赛。';
    if (shootoutBreak) return '加时赛仍未分胜负，点球大战即将开始。';
    return buildLiveCommentary({
      event: playback.flashEvent,
      minute: playback.minute,
      homeScore: playback.homeScore,
      awayScore: playback.awayScore,
      penaltyHomeScore: playback.penaltyHomeScore,
      penaltyAwayScore: playback.penaltyAwayScore,
      homeTeamId: result.homeTeamId,
      homeTeamName: ht?.name ?? '主队',
      awayTeamName: at?.name ?? '客队',
    });
  }, [
    at?.name,
    extraTimeBreak,
    finished,
    halftime,
    ht?.name,
    playback.awayScore,
    playback.flashEvent,
    playback.homeScore,
    playback.minute,
    playback.penaltyAwayScore,
    playback.penaltyHomeScore,
    result.homeTeamId,
    result.penalties,
    shootoutBreak,
  ]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="比赛直播回放"
      data-fixture-id={result.fixtureId}
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[500] flex items-center justify-center p-3"
    >
      <div className={`match-live-shell relative flex max-h-[calc(100dvh-24px)] w-full max-w-5xl flex-col overflow-hidden bg-slate-900 shadow-2xl animate-scale-in motion-reduce:animate-none border ${
        playback.goalFlash ? 'border-green-500/50' : 'border-slate-800'
      } transition-colors duration-500`}>

        {showOpener && (
          <div
            data-testid="key-match-opener"
            data-opener-kind={openerKind}
            className="broadcast-opener absolute inset-0 z-30 flex min-h-0 flex-col justify-end overflow-hidden bg-slate-950"
          >
            <DecorativeImage
              src={openerArtwork}
              eager
              width={1440}
              height={630}
              testId="key-match-opener-art"
              className="broadcast-opener-art absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.1),rgba(2,6,23,0.42)_50%,rgba(2,6,23,0.96))]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setShowOpener(false)}
              aria-label="跳过转播开场"
              title="跳过转播开场"
              className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/15 bg-black/40 text-slate-200 hover:bg-black/65"
            >
              <Icon name="x" size={18} />
            </button>
            <div className="relative px-5 pb-8 pt-20 sm:px-10 sm:pb-10">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-breathe motion-reduce:animate-none" />
                {matchOpenerLabel(result.competitionType, openerFinal)}
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-8">
                <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                  <div className="min-w-0">
                    <div className="truncate text-xl font-black text-white sm:text-3xl" title={ht?.name ?? '主队'}>
                      <span className="sm:hidden">{ht?.shortName ?? ht?.name ?? '主队'}</span>
                      <span className="hidden sm:inline">{ht?.name ?? '主队'}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {result.tournamentHostTeamId === result.homeTeamId ? '东道主 · 中立场' : result.isNeutralVenue ? '中立场' : '主队'}
                    </div>
                  </div>
                  {ht && <TeamBadge teamId={ht.id} shortName={ht.shortName} color={ht.color} size={34} />}
                </div>
                <div className="text-sm font-black text-slate-500 sm:text-lg">VS</div>
                <div className="flex min-w-0 items-center gap-2">
                  {at && <TeamBadge teamId={at.id} shortName={at.shortName} color={at.color} size={34} />}
                  <div className="min-w-0">
                    <div className="truncate text-xl font-black text-white sm:text-3xl" title={at?.name ?? '客队'}>
                      <span className="sm:hidden">{at?.shortName ?? at?.name ?? '客队'}</span>
                      <span className="hidden sm:inline">{at?.name ?? '客队'}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {result.tournamentHostTeamId === result.awayTeamId ? '东道主 · 中立场' : result.isNeutralVenue ? '中立场' : '客队'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 text-center text-xs text-slate-300">{result.competitionName} · {result.roundLabel}</div>
            </div>
          </div>
        )}

        <div
          data-testid="live-scroll-region"
          aria-hidden={showOpener || undefined}
          inert={showOpener || undefined}
          className="min-h-0 overflow-y-auto overscroll-y-contain"
        >

        {/* Header bar */}
        <div className="broadcast-ribbon bg-slate-800/80 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${finished ? 'bg-red-500' : 'bg-green-500 animate-breathe'}`} />
            <span className="truncate text-[11px] text-slate-400">{result.competitionName} · {result.roundLabel}</span>
          </div>
          <span data-testid="live-minute" className={`text-[10px] px-2 py-0.5 rounded-full ${finished ? 'bg-red-900/40 text-red-400' : 'bg-green-900/40 text-green-400'}`}>
            {finished
              ? '全场结束'
              : inShootout
                ? shootoutEventLabel(shootoutEvents.at(-1) ?? { minute: 121, type: 'penalty_miss', teamId: result.homeTeamId, description: '' })
                : `${playback.minute}'`}
          </span>
        </div>

        {/* Scoreboard with team colors */}
        <div className="live-scoreboard broadcast-scoreboard relative overflow-hidden"
          style={{ background: `linear-gradient(90deg, ${ht?.color ?? '#333'}18 0%, #0f172a 40%, #0f172a 60%, ${at?.color ?? '#333'}18 100%)` }}
        >
          <DecorativeImage
            src={liveScoreboardArtwork}
            testId="live-scoreboard-art"
            className="absolute inset-0 h-full w-full object-cover opacity-55"
          />
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{ background: `linear-gradient(90deg, ${ht?.color ?? '#333'}2e 0%, transparent 38%, transparent 62%, ${at?.color ?? '#333'}2e 100%)` }}
          />
          {/* Goal flash overlay */}
          {playback.goalFlash && (
            <div className="absolute inset-0 animate-fade-in" style={{
              background: playback.goalFlash === 'home'
                ? `radial-gradient(circle at 25% 50%, ${ht?.color ?? '#22c55e'}30, transparent 70%)`
                : `radial-gradient(circle at 75% 50%, ${at?.color ?? '#22c55e'}30, transparent 70%)`,
            }} />
          )}

          <div className="relative flex items-center justify-center gap-2 px-4 pb-8 pt-5">
            {/* Home */}
            <div className="flex-1 text-right">
              <div className="flex items-center gap-2 justify-end">
                <span className="min-w-0 truncate text-sm font-bold text-slate-100 sm:text-lg" title={ht?.name ?? '主队'}>
                  <span className="sm:hidden">{ht?.shortName ?? ht?.name ?? '主队'}</span>
                  <span className="hidden sm:inline">{ht?.name ?? '主队'}</span>
                </span>
                {ht && <TeamBadge teamId={ht.id} shortName={ht.shortName} color={ht.color} size={26} />}
              </div>
            </div>

            {/* Score */}
            <div className="flex items-center gap-3 px-4 min-w-[90px] justify-center">
              <span aria-label="主队比分" className={`broadcast-score-type text-4xl sm:text-5xl font-black tabular-nums transition-all duration-300 ${
                playback.homeScore > playback.awayScore ? 'text-green-400' : 'text-white'
              } ${playback.goalFlash === 'home' ? 'animate-score-pop scale-110' : ''}`}>
                {playback.homeScore}
              </span>
              <span className="text-2xl text-slate-700 font-light">-</span>
              <span aria-label="客队比分" className={`broadcast-score-type text-4xl sm:text-5xl font-black tabular-nums transition-all duration-300 ${
                playback.awayScore > playback.homeScore ? 'text-green-400' : 'text-white'
              } ${playback.goalFlash === 'away' ? 'animate-score-pop scale-110' : ''}`}>
                {playback.awayScore}
              </span>
            </div>

            {/* Away */}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {at && <TeamBadge teamId={at.id} shortName={at.shortName} color={at.color} size={26} />}
                <span className="min-w-0 truncate text-sm font-bold text-slate-100 sm:text-lg" title={at?.name ?? '客队'}>
                  <span className="sm:hidden">{at?.shortName ?? at?.name ?? '客队'}</span>
                  <span className="hidden sm:inline">{at?.name ?? '客队'}</span>
                </span>
              </div>
            </div>
          </div>
          <div
            data-testid="live-stage"
            className="broadcast-stage-label absolute bottom-1 left-1/2 -translate-x-1/2 rounded-sm border border-white/10 bg-black/45 px-2 py-0.5 text-[10px] font-semibold tracking-normal text-slate-300"
          >
            {stageLabel}{paused ? ' · 已暂停' : ''}
          </div>
        </div>

        {(result.homeTactics || result.awayTactics) && (
          <div
            data-testid="live-tactics-strip"
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-y border-slate-800/70 bg-slate-950/55 px-3 py-2"
          >
            <div
              className="min-w-0 text-right"
              title={result.homeTactics
                ? `${TACTICS_REASON_LABELS[result.homeTactics.reason]} · ${result.homeTactics.tags.join(' · ')}`
                : '旧比赛未保存战术快照'}
            >
              <div className="truncate text-xs font-bold text-slate-200">
                {result.homeTactics?.formation ?? '阵型未记录'}
              </div>
              <div className="truncate text-[9px] text-emerald-300/75">
                {result.homeTactics ? APPROACH_LABELS[result.homeTactics.approach] : '历史比赛'}
              </div>
            </div>
            <div className="border-x border-slate-700/70 px-2 text-center text-[8px] font-semibold text-slate-500">
              战术部署
            </div>
            <div
              className="min-w-0"
              title={result.awayTactics
                ? `${TACTICS_REASON_LABELS[result.awayTactics.reason]} · ${result.awayTactics.tags.join(' · ')}`
                : '旧比赛未保存战术快照'}
            >
              <div className="truncate text-xs font-bold text-slate-200">
                {result.awayTactics?.formation ?? '阵型未记录'}
              </div>
              <div className="truncate text-[9px] text-emerald-300/75">
                {result.awayTactics ? APPROACH_LABELS[result.awayTactics.approach] : '历史比赛'}
              </div>
            </div>
          </div>
        )}

        {featuredPlayers.length > 0 && (
          <div
            data-testid="live-featured-players"
            className="flex min-w-0 items-center gap-3 overflow-x-auto border-b border-amber-400/10 bg-amber-300/[0.025] px-3 py-1.5 text-[9px] scrollbar-thin"
          >
            <span className="shrink-0 font-bold text-amber-300">
              {featuredMatchup ?? '焦点球员'}
            </span>
            <span className="h-3 w-px shrink-0 bg-slate-700" aria-hidden="true" />
            {featuredPlayers.map((player, index) => (
              <span
                key={player.playerId}
                className="shrink-0 text-slate-300"
                title={`${FEATURED_PLAYER_REASON_LABELS[player.reason]} · 赛前边际影响 ${player.marginalUnitImpact >= 0 ? '+' : ''}${player.marginalUnitImpact.toFixed(1)} ${PLAYER_IMPACT_UNIT_LABELS[player.impactUnit]}`}
              >
                <span className="text-amber-300/80">{index + 1}</span> {player.playerName}
                <span className="ml-1 text-slate-600">{player.position}</span>
              </span>
            ))}
          </div>
        )}

        <div className="lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
          <div className="min-w-0">
            {inShootout && (
              <ShootoutTracker
                events={shootoutEvents}
                homeTeamId={result.homeTeamId}
                homeName={ht?.name ?? '主队'}
                awayName={at?.name ?? '客队'}
                homeColor={ht?.color ?? '#ef4444'}
                awayColor={at?.color ?? '#3b82f6'}
                homeScore={playback.penaltyHomeScore}
                awayScore={playback.penaltyAwayScore}
                nextEvent={allEvents[playback.consumedEventCount]}
              />
            )}

            <div className="px-3 py-2 lg:px-4 lg:py-3">
              <PitchCanvas
                minute={playback.minute}
                maxMinute={maxMin}
                homeColor={ht?.color ?? '#ef4444'}
                awayColor={at?.color ?? '#3b82f6'}
                homeTeamId={result.homeTeamId}
                flashEvent={pendingPresentationEvent}
                allEvents={allEvents}
                homeMatchday={result.homeMatchday}
                awayMatchday={result.awayMatchday}
                finished={finished}
                halftime={isBreak}
                breakLabel={shootoutBreak
                  ? { label: '点球大战', sublabel: 'PENALTY SHOOTOUT' }
                  : extraTimeBreak
                    ? { label: '加时赛', sublabel: 'EXTRA TIME' }
                    : { label: '中场休息', sublabel: 'HALF TIME' }}
                active={playback.phase === 'playing' && pageVisible && !showOpener}
                playbackMode={playback.mode}
                shootout={inShootout}
                possession={result.stats.possession}
                featuredPlayerIds={featuredPlayerIds}
                homeApproach={result.homeTactics?.approach}
                awayApproach={result.awayTactics?.approach}
                onPlaybackHoldChange={setPresentationHolding}
                onPlaybackAvailabilityChange={setPitchAvailable}
                onPresentationCue={handlePresentationCue}
                onPresentationAtmosphereChange={handlePresentationAtmosphere}
              />
            </div>

            {!inShootout && (
              <div className="px-4 pb-3 pt-1">
                <div className="relative h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300 motion-reduce:transition-none"
                    style={{ width: `${(Math.min(playback.minute, maxMin) / maxMin) * 100}%` }}
                  />
                  <div className="absolute inset-y-0 w-px bg-slate-600" style={{ left: `${(45 / maxMin) * 100}%` }} />
                  {maxMin > 90 && <div className="absolute inset-y-0 w-px bg-slate-600" style={{ left: `${(90 / maxMin) * 100}%` }} />}
                  {shownEvents.filter(e => e.type === 'goal' || e.type === 'own_goal').map((e, i) => (
                    <div key={`${e.minute}:${e.type}:${i}`} className="absolute top-0 h-full w-1 rounded-full bg-amber-400" style={{ left: `${(e.minute / maxMin) * 100}%` }} />
                  ))}
                </div>
                <div className="mt-0.5 flex justify-between text-[9px] text-slate-600">
                  <span>0'</span><span>45'</span><span>{maxMin}'</span>
                </div>
              </div>
            )}
          </div>

          <LiveCommentaryFeed
            currentCommentary={commentary}
            entries={commentaryEntries}
            homeTeamId={result.homeTeamId}
            homeColor={ht?.color}
            awayColor={at?.color}
          />
        </div>

        {/* Final results */}
        {finished && (
          <div className="space-y-2 px-4 pb-3 text-center animate-slide-up">
            {result.extraTime && <span className="text-[10px] text-amber-400 block">加时赛 {result.etHomeGoals ?? 0} - {result.etAwayGoals ?? 0}</span>}
            {result.penalties && <span className="text-[10px] text-amber-400 block">点球大战 {result.penaltyHome} - {result.penaltyAway}</span>}
            {featuredPlayers.length > 0 && (
              <div data-testid="live-featured-review" className="border-t border-slate-800/70 pt-2 text-left">
                <div className="mb-1.5 text-[9px] font-semibold text-slate-500">焦点球员赛后观察</div>
                <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
                  {featuredPlayers.map(player => {
                    const impact = matchImpactsByPlayer.get(player.playerId);
                    return (
                      <div key={player.playerId} className="flex min-w-0 items-baseline justify-between gap-2 text-[10px]">
                        <span className="shrink-0 font-semibold text-slate-300">{player.playerName}</span>
                        <span className="min-w-0 truncate text-right text-slate-500" title={impact?.summary}>
                          {impact?.summary ?? '未形成关键事件'} · 赛前边际
                          {' '}{player.marginalUnitImpact >= 0 ? '+' : ''}{player.marginalUnitImpact.toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        {/* Controls */}
        <div
          data-testid="live-controls"
          aria-hidden={showOpener || undefined}
          inert={showOpener || undefined}
          className="grid shrink-0 grid-cols-1 gap-2 border-t border-slate-800/60 bg-slate-900 px-4 py-2.5 min-[480px]:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="flex min-w-0 gap-1">
            <div
              role="group"
              aria-label="播放模式"
              className="flex overflow-hidden rounded-md border border-slate-700 bg-slate-800"
            >
              {PLAYBACK_MODE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={playback.mode === option.value}
                  data-testid={`playback-mode-${option.value}`}
                  onClick={() => setMode(option.value)}
                  className={`min-h-11 min-w-11 cursor-pointer px-2.5 py-1 text-[10px] transition-colors sm:min-h-9 ${
                    playback.mode === option.value
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button onClick={togglePause} disabled={isBreak}
              className="min-h-11 min-w-11 rounded-md bg-slate-800 px-2.5 py-1 text-[10px] text-slate-400 hover:bg-slate-700 cursor-pointer disabled:cursor-default disabled:opacity-60 sm:min-h-9"
            >{isBreak ? '休息' : paused ? '继续' : '暂停'}</button>
            <button
              type="button"
              data-testid="live-sound-toggle"
              aria-label={!feedbackPreferences.soundEnabled
                ? '开启全局声音'
                : locallyMuted ? '开启本场声音' : '关闭本场声音'}
              aria-pressed={feedbackPreferences.soundEnabled && !locallyMuted}
              onClick={() => {
                if (!feedbackPreferences.soundEnabled) {
                  setFeedbackPreferences({ soundEnabled: true });
                  setLocallyMuted(false);
                  unlockGameAudio();
                  soundscapeRef.current?.start();
                  soundscapeRef.current?.setMuted(false);
                  return;
                }
                setLocallyMuted(value => !value);
              }}
              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700 sm:min-h-9"
            >
              <Icon
                name={feedbackPreferences.soundEnabled && !locallyMuted ? 'volume' : 'volume-off'}
                size={14}
              />
              <span>{!feedbackPreferences.soundEnabled ? '全局静音' : locallyMuted ? '本场静音' : '声音'}</span>
            </button>
          </div>
          <div className="flex justify-end gap-2">
            {!finished && <button onClick={skip} className="min-h-11 px-3 py-1 text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer">跳过 →</button>}
            <button onClick={onClose} className="min-w-11 min-h-11 px-3 py-1 text-[10px] bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-md cursor-pointer">
              {finished ? '关闭' : '退出'}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
