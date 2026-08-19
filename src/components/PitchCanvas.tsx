import { memo, useEffect, useRef, useMemo } from 'react';
import type { MatchdaySnapshot, MatchEvent } from '../types/match';
import type { CoachFormation, MatchApproach } from '../types/coach';
import { isSetPieceOrigin, playOriginForEvent } from '../engine/match/event-taxonomy';
import { clamp, lerp, seededRand } from './pitch-canvas/math';
import { generateSequence, type SequenceOptions } from './pitch-canvas/sequence';
import { actorsForEvent, findEventScene, sceneForEvent, type EventActors, type EventScene, type SceneOutcome, type ShotOutcome } from './pitch-canvas/event-scene';
import { activePitchPlayers, buildPitchRoster, type PitchRosterPlayer } from './pitch-canvas/lineup';
import { presentationAtmosphereForPhase } from './pitch-canvas/presentation';
import { broadcastCameraTarget, type BroadcastCameraMoment } from './pitch-canvas/camera';
import {
  createPitchGeometry,
  LOGICAL_PITCH_HEIGHT,
  LOGICAL_PITCH_WIDTH,
  PITCH_PADDING,
} from './pitch-canvas/geometry';
import {
  spawnGoalBurst, spawnTackleSparks, spawnGrassKick,
  updateAndCullParticles, renderParticles,
} from './pitch-canvas/particles';
import { buildTacticalAssignments, computeCarryTarget, computePostShotBallPosition, computeReceptionTouchOffset, getBaseSlot, computeBallPosition, resolvePhasePoints, separateActivePlayers, updatePlayerPositions, type TacticalAssignments } from './pitch-canvas/physics';
import {
  drawPitch, drawHalftime, drawPlayer, drawBall,
  drawGoalCelebration, drawShotOutcome, drawShotOutcomeLabel,
  applyCameraShake, applyWhiteFlash, cameraPointToScreen,
  GOAL_CELEB_MAX_FRAMES, FLASH_MAX_FRAMES, CAMERA_SHAKE_MAX_FRAMES, SHOT_OUTCOME_MAX_FRAMES,
  type BroadcastCameraState,
} from './pitch-canvas/renderer';
import {
  getTacticalFormationSlots,
  type MatchPresentationAtmosphere,
  type MatchPresentationCue,
  type Particle,
  type PassPhase,
  type PlayerState,
} from './pitch-canvas/types';
import {
  degradeRenderBudget,
  selectRenderBudget,
  shouldDegradeRenderBudget,
  type RenderBudget,
} from './pitch-canvas/render-budget';
import { mountPitchRuntime } from './pitch-canvas/runtime';
import type { PlaybackMode } from './match-live/playback-mode';

interface Props {
  minute: number;
  maxMinute: number;
  homeColor: string;
  awayColor: string;
  homeTeamId: string;
  flashEvent: MatchEvent | null;
  allEvents: MatchEvent[];
  homeMatchday?: MatchdaySnapshot;
  awayMatchday?: MatchdaySnapshot;
  finished: boolean;
  halftime: boolean;
  breakLabel?: { label: string; sublabel: string };
  active: boolean;
  playbackMode: PlaybackMode;
  shootout?: boolean;
  possession?: [number, number];
  featuredPlayerIds?: readonly string[];
  homeApproach?: MatchApproach;
  awayApproach?: MatchApproach;
  onPlaybackHoldChange?: (holding: boolean) => void;
  onPlaybackAvailabilityChange?: (available: boolean) => void;
  onPresentationCue?: (cue: MatchPresentationCue) => void;
  onPresentationAtmosphereChange?: (snapshot: MatchPresentationAtmosphere) => void;
}

interface PitchDebugState {
  coordinateSystem: string;
  minute: number;
  playbackMode: PlaybackMode;
  phase: 'passing' | 'holding' | 'shooting';
  attackingSide: 'home' | 'away';
  event: ({
    type: MatchEvent['type'];
    outcome: SceneOutcome;
    target: { x: number; y: number };
  } & EventActors) | null;
  atmosphere: MatchPresentationAtmosphere;
  ball: { x: number; y: number; elevation: number };
  camera: { focusX: number; focusY: number; zoom: number };
  ballHolderId: string | null;
  lastTouchPlayerId: string | null;
  playback: {
    holdingClock: boolean;
    sceneMinute: number | null;
    queuedScenes: number;
  };
  formations: {
    home: { formation: CoachFormation; approach: MatchApproach };
    away: { formation: CoachFormation; approach: MatchApproach };
  };
  action: {
    kind: PassPhase['kind'];
    setPiece?: PassPhase['setPiece'];
    restart?: PassPhase['restart'];
    pattern?: PassPhase['pattern'];
    stage?: PassPhase['stage'];
    passerIdx: number;
    receiverIdx: number;
    sourceOverride?: { x: number; y: number };
    targetOverride?: { x: number; y: number };
    progress: number;
  } | null;
  homeOnField: Array<{ id: string; number: number; slot: number; x: number; y: number; featured: boolean }>;
  awayOnField: Array<{ id: string; number: number; slot: number; x: number; y: number; featured: boolean }>;
  rendering: {
    active: boolean;
    pauseReason: 'none' | 'hidden' | 'covered' | 'paused' | 'break' | 'completed';
    quality: RenderBudget['quality'];
    dpr: number;
    particleCount: number;
    particleCap: number;
    renderedFrames: number;
    averageRenderMs: number;
    averageFrameIntervalMs: number;
    maxFrameIntervalMs: number;
    maxConsecutiveSlowFrames: number;
  };
}

type PitchDebugWindow = Window & {
  render_game_to_text?: () => string;
  advanceTime?: (milliseconds: number) => void;
};

function slotForPlayer(roster: PitchRosterPlayer[], playerId?: string): number | undefined {
  return playerId ? roster.find(player => player.playerId === playerId)?.slotIndex : undefined;
}

function nearestPlayerSlot(
  roster: PitchRosterPlayer[],
  playerPositions: PlayerState[],
  offset: number,
  x: number,
  y: number,
): number {
  const nearest = roster.reduce<PitchRosterPlayer | undefined>((best, player) => {
    if (!best) return player;
    const position = playerPositions[offset + player.slotIndex];
    const bestPosition = playerPositions[offset + best.slotIndex];
    return Math.hypot(position.x - x, position.y - y)
      < Math.hypot(bestPosition.x - x, bestPosition.y - y)
      ? player
      : best;
  }, undefined);
  return nearest?.slotIndex ?? 6;
}

function sequenceOptionsForScene(
  scene: EventScene,
  events: MatchEvent[],
  homeRoster: PitchRosterPlayer[],
  awayRoster: PitchRosterPlayer[],
  homePossessionShare: number,
  homeFormation: CoachFormation,
  awayFormation: CoachFormation,
  homeApproach: MatchApproach,
  awayApproach: MatchApproach,
  continuity?: { source: { x: number; y: number }; startingPlayerIdx: number; transition?: boolean },
): SequenceOptions {
  const actors = actorsForEvent(scene.event, events);
  const attackingRoster = scene.attackingHome ? homeRoster : awayRoster;
  const origin = playOriginForEvent(scene.event);
  const setPiece = isSetPieceOrigin(origin) ? origin : undefined;
  const eventActorSlot = slotForPlayer(attackingRoster, actors.attackerId);
  return {
    attackingHome: scene.attackingHome,
    forceShot: scene.outcome !== 'delivery',
    setPiece,
    setPieceSide: scene.event.setPiece?.side,
    setPieceDelivery: scene.event.setPiece?.delivery,
    shooterIdx: scene.outcome === 'delivery' ? undefined : eventActorSlot,
    creatorIdx: scene.outcome === 'delivery'
      ? eventActorSlot
      : slotForPlayer(attackingRoster, actors.creatorId),
    chanceStyle: origin === 'counter' ? 'through_ball' : undefined,
    ...(!setPiece && continuity ? {
      sourceOverride: continuity.source,
      startingPlayerIdx: continuity.startingPlayerIdx,
      transition: continuity.transition,
    } : {}),
    homePossessionShare,
    homeFormation,
    awayFormation,
    homeApproach,
    awayApproach,
  };
}

const FIXED_FRAME_MS = 1000 / 60;

function PitchCanvas(props: Props) {
  const {
    minute, maxMinute, homeColor, awayColor, homeTeamId, flashEvent, allEvents,
    homeMatchday, awayMatchday, halftime, breakLabel, finished, active, playbackMode, shootout = false,
    possession = [50, 50], featuredPlayerIds = [], homeApproach = 'balanced', awayApproach = 'balanced',
    onPlaybackHoldChange, onPlaybackAvailabilityChange, onPresentationCue, onPresentationAtmosphereChange,
  } = props;

  const homeFormation: CoachFormation = homeMatchday?.formation ?? '4-3-3';
  const awayFormation: CoachFormation = awayMatchday?.formation ?? '4-3-3';
  const formationLayouts = useMemo(() => ({
    home: getTacticalFormationSlots(homeFormation, homeApproach),
    away: getTacticalFormationSlots(awayFormation, awayApproach),
  }), [awayApproach, awayFormation, homeApproach, homeFormation]);
  const featuredPlayerIdSet = useMemo(() => new Set(featuredPlayerIds), [featuredPlayerIds]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const ballPos = useRef({ x: 0.5, y: 0.5 });
  const ballHistory = useRef<{ x: number; y: number }[]>([]);
  const postShotRestingBallRef = useRef<{ x: number; y: number } | null>(null);
  const cameraRef = useRef<BroadcastCameraState>({
    focusX: LOGICAL_PITCH_WIDTH / 2,
    focusY: LOGICAL_PITCH_HEIGHT / 2,
    zoom: 1,
  });
  const goalCelebFrame = useRef(0);
  const goalCelebColor = useRef('#facc15'); // team color of most recent goal — for ring tinting
  const goalCelebRightSide = useRef(true); // which goal mouth the celebration is anchored to
  const cameraShakeRef = useRef(0);
  const cameraShakeMax = useRef(35); // remember peak so attenuation is correct
  const flashWhiteRef = useRef(0);
  const shotOutcomeFrameRef = useRef(0);
  const shotOutcomeRef = useRef<Exclude<ShotOutcome, 'goal'>>('save');
  const shotOutcomeTargetRef = useRef({ x: 0, y: 0 });
  const shotOutcomeAttackingHomeRef = useRef(true);
  const shotOutcomeSeedRef = useRef(0);
  const shotOutcomeHeldRef = useRef(false);
  const particlesRef = useRef<Particle[]>([]);
  const pendingImpactSceneRef = useRef<EventScene | null>(null);
  const triggeredImpactKeyRef = useRef<string | null>(null);
  const emittedPresentationCueIdsRef = useRef(new Set<string>());
  const lastAtmosphereRef = useRef<MatchPresentationAtmosphere & { frame: number }>({
    danger: -1,
    attackingHome: true,
    inFlight: false,
    frame: -100,
  });
  const wakeRenderLoopRef = useRef<() => void>(() => undefined);

  // Per-player live positions (smoothed) — 22 players (11 home + 11 away)
  const playerPosRef = useRef<PlayerState[]>(
    Array.from({ length: 22 }, (_, i) => {
      const isHome = i < 11;
      const base = (isHome ? formationLayouts.home : formationLayouts.away)[i % 11];
      return {
        x: isHome ? base.x : 1 - base.x,
        y: base.y,
        vx: 0,
        vy: 0,
        sprintT: 0,
      };
    }),
  );

  // Sequence state
  const sequenceRef = useRef<PassPhase[]>([]);
  const phaseIdxRef = useRef(0);
  const phaseFrameRef = useRef(0);
  const phaseStateRef = useRef<'passing' | 'holding' | 'shooting'>('passing');
  const sequenceSeedRef = useRef(0);
  const activeSceneKeyRef = useRef<string | null>(null);
  const sequenceSceneRef = useRef<EventScene | null>(null);
  const queuedScenesRef = useRef<EventScene[]>([]);
  const ballSourceRef = useRef({ x: 0.5, y: 0.5 });
  const ballArcLiftRef = useRef(0);
  const interceptedRef = useRef(false);
  const tacticalAssignmentsRef = useRef<TacticalAssignments | null>(null);
  const tacticalAssignmentKeyRef = useRef('');
  const playbackHoldRef = useRef(false);
  const ballSpinRef = useRef(0);
  const debugStateRef = useRef<PitchDebugState>({
    coordinateSystem: 'normalized pitch: origin top-left, x right, y down',
    minute,
    playbackMode,
    phase: 'passing',
    attackingSide: 'home',
    event: null,
    atmosphere: { danger: 0, attackingHome: true, inFlight: false },
    ball: { x: 0.5, y: 0.5, elevation: 0 },
    camera: { focusX: 0.5, focusY: 0.5, zoom: 1 },
    ballHolderId: null,
    lastTouchPlayerId: null,
    playback: { holdingClock: false, sceneMinute: null, queuedScenes: 0 },
    formations: {
      home: { formation: homeFormation, approach: homeApproach },
      away: { formation: awayFormation, approach: awayApproach },
    },
    action: null,
    homeOnField: [],
    awayOnField: [],
    rendering: {
      active: true,
      pauseReason: 'none',
      quality: 'full',
      dpr: 1,
      particleCount: 0,
      particleCap: 350,
      renderedFrames: 0,
      averageRenderMs: 0,
      averageFrameIntervalMs: 0,
      maxFrameIntervalMs: 0,
      maxConsecutiveSlowFrames: 0,
    },
  });

  const eventScene = useMemo(() => {
    // Shootout kicks start after minute 120. Do not preload one while extra
    // time is still being rendered with the full outfield shape.
    const stageEvents = shootout
      ? allEvents
      : allEvents.filter(event => event.minute <= maxMinute);
    return findEventScene(stageEvents, minute, homeTeamId, flashEvent);
  }, [allEvents, flashEvent, homeTeamId, maxMinute, minute, shootout]);
  const homeRoster = useMemo(() => buildPitchRoster(homeMatchday), [homeMatchday]);
  const awayRoster = useMemo(() => buildPitchRoster(awayMatchday), [awayMatchday]);

  const targetShift = useMemo(() => {
    if (eventScene) return eventScene.attackingHome ? 0.055 : -0.055;
    return clamp((possession[0] - 50) / 50 * 0.025, -0.025, 0.025);
  }, [eventScene, possession]);

  const shiftRef = useRef(0);

  // Live snapshot of props for the long-running rAF loop to read from.
  // Avoids restarting the rAF chain on every minute / flashEvent change.
  const liveRef = useRef({
    minute, maxMinute, homeColor, awayColor, homeTeamId, allEvents, halftime, breakLabel, finished, active, targetShift,
    eventScene, homeRoster, awayRoster, playbackMode, shootout, possession,
    homeFormation, awayFormation, homeApproach, awayApproach, formationLayouts, featuredPlayerIdSet,
    onPlaybackHoldChange, onPlaybackAvailabilityChange, onPresentationCue, onPresentationAtmosphereChange,
  });
  useEffect(() => {
    liveRef.current = {
      minute, maxMinute, homeColor, awayColor, homeTeamId, allEvents, halftime, breakLabel, finished, active, targetShift,
      eventScene, homeRoster, awayRoster, playbackMode, shootout, possession,
      homeFormation, awayFormation, homeApproach, awayApproach, formationLayouts, featuredPlayerIdSet,
      onPlaybackHoldChange, onPlaybackAvailabilityChange, onPresentationCue, onPresentationAtmosphereChange,
    };
    wakeRenderLoopRef.current();
  }, [
    minute, maxMinute, homeColor, awayColor, homeTeamId, allEvents, halftime, breakLabel, finished, active,
    targetShift, eventScene, homeRoster, awayRoster, playbackMode, shootout, possession,
    homeFormation, awayFormation, homeApproach, awayApproach, formationLayouts, featuredPlayerIdSet,
    onPlaybackHoldChange, onPlaybackAvailabilityChange, onPresentationCue, onPresentationAtmosphereChange,
  ]);

  useEffect(() => () => {
    playbackHoldRef.current = false;
    onPlaybackHoldChange?.(false);
  }, [onPlaybackHoldChange]);

  useEffect(() => {
    const debugWindow = window as PitchDebugWindow;
    const renderState = () => JSON.stringify(debugStateRef.current);
    debugWindow.render_game_to_text = renderState;
    return () => {
      if (debugWindow.render_game_to_text === renderState) delete debugWindow.render_game_to_text;
    };
  }, []);

  // Queue the event impact. The rAF loop triggers it only when the directed
  // sequence's final shot reaches the goal, keeping ball and feedback aligned.
  useEffect(() => {
    if (!flashEvent) return;
    const eventIndex = allEvents.indexOf(flashEvent);
    const scene = sceneForEvent(flashEvent, homeTeamId, eventIndex >= 0 ? eventIndex : undefined);
    if (!scene || scene.outcome === 'delivery' || triggeredImpactKeyRef.current === scene.key) return;
    pendingImpactSceneRef.current = scene;
  }, [allEvents, flashEvent, homeTeamId]);

  // Main rAF loop — starts once on mount, reads from liveRef. No restarts.
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const canvas: HTMLCanvasElement = canvasElement;
    const ctx = canvas.getContext('2d')!;
    const W = LOGICAL_PITCH_WIDTH, H = LOGICAL_PITCH_HEIGHT;
    const P = PITCH_PADDING;
    const pitchGeometry = createPitchGeometry(W, H, P);
    const fw = pitchGeometry.fieldWidth, fh = pitchGeometry.fieldHeight;
    const pitchLayer = document.createElement('canvas');
    const pitchLayerContext = pitchLayer.getContext('2d')!;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    let renderBudget = selectRenderBudget({
      cssWidth: canvas.clientWidth || LOGICAL_PITCH_WIDTH,
      devicePixelRatio: window.devicePixelRatio || 1,
      reducedMotion,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory,
    });
    let currentDpr = 1;
    const renderDurations: number[] = [];
    const frameIntervals: number[] = [];
    let renderedFrames = 0;
    let consecutiveSlowFrames = 0;
    let maxConsecutiveSlowFrames = 0;
    let maxFrameIntervalMs = 0;

    const average = (values: number[]): number => values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length;

    function updateRenderingDebug(
      activeNow: boolean,
      pauseReason: PitchDebugState['rendering']['pauseReason'],
    ): void {
      debugStateRef.current.rendering = {
        active: activeNow,
        pauseReason,
        quality: renderBudget.quality,
        dpr: currentDpr,
        particleCount: particlesRef.current.length,
        particleCap: renderBudget.particleCap,
        renderedFrames,
        averageRenderMs: average(renderDurations),
        averageFrameIntervalMs: average(frameIntervals),
        maxFrameIntervalMs,
        maxConsecutiveSlowFrames,
      };
    }

    function resizeCanvas(): void {
      // clientWidth is layout-space width and is unaffected by the modal's
      // scale-in transform, so the initial backing buffer reaches full DPR.
      const cssWidth = canvas.clientWidth || LOGICAL_PITCH_WIDTH;
      const cssHeight = cssWidth * LOGICAL_PITCH_HEIGHT / LOGICAL_PITCH_WIDTH;
      const dpr = Math.min(window.devicePixelRatio || 1, renderBudget.dprCap);
      currentDpr = dpr;
      const nextWidth = Math.round(cssWidth * dpr);
      const nextHeight = Math.round(cssHeight * dpr);
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      if (pitchLayer.width !== nextWidth || pitchLayer.height !== nextHeight) {
        pitchLayer.width = nextWidth;
        pitchLayer.height = nextHeight;
        pitchLayerContext.setTransform(
          nextWidth / LOGICAL_PITCH_WIDTH,
          0,
          0,
          nextHeight / LOGICAL_PITCH_HEIGHT,
          0,
          0,
        );
        drawPitch(pitchLayerContext, W, H, P);
      }
      ctx.setTransform(
        dpr * cssWidth / LOGICAL_PITCH_WIDTH,
        0,
        0,
        dpr * cssHeight / LOGICAL_PITCH_HEIGHT,
        0,
        0,
      );
      updateRenderingDebug(debugStateRef.current.rendering.active, debugStateRef.current.rendering.pauseReason);
    }

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas.parentElement ?? canvas);

    function addParticles(spawned: Particle[]): void {
      const density = Math.min(1, renderBudget.particleCap / 350);
      const keep = Math.max(1, Math.round(spawned.length * density));
      if (keep >= spawned.length) {
        particlesRef.current.push(...spawned);
      } else {
        const stride = spawned.length / keep;
        for (let index = 0; index < keep; index++) {
          particlesRef.current.push(spawned[Math.floor(index * stride)]);
        }
      }
      if (particlesRef.current.length > renderBudget.particleCap) {
        particlesRef.current = particlesRef.current.slice(-renderBudget.particleCap);
      }
    }

    function emitPresentationCue(
      scene: EventScene,
      moment: MatchPresentationCue['moment'],
      detail: Pick<MatchPresentationCue, 'action' | 'outcome'> = {},
      phaseOrdinal = phaseIdxRef.current,
    ): void {
      const id = `${scene.key}:${moment}:${moment === 'contact' ? phaseOrdinal : 'scene'}`;
      if (emittedPresentationCueIdsRef.current.has(id)) return;
      emittedPresentationCueIdsRef.current.add(id);
      liveRef.current.onPresentationCue?.({
        id,
        moment,
        event: scene.event,
        attackingHome: scene.attackingHome,
        ...detail,
      });
    }

    function recordRenderDuration(duration: number): void {
      renderedFrames++;
      renderDurations.push(duration);
      if (renderDurations.length > 60) renderDurations.shift();
      updateRenderingDebug(true, 'none');
    }

    function recordFrameInterval(interval: number): void {
      frameIntervals.push(interval);
      if (frameIntervals.length > 60) frameIntervals.shift();
      maxFrameIntervalMs = Math.max(maxFrameIntervalMs, interval);
      consecutiveSlowFrames = interval > 33 ? consecutiveSlowFrames + 1 : 0;
      maxConsecutiveSlowFrames = Math.max(maxConsecutiveSlowFrames, consecutiveSlowFrames);
      if (renderBudget.quality === 'reduced' || renderBudget.quality === 'degraded') return;
      if (!shouldDegradeRenderBudget({
        renderedFrames,
        consecutiveSlowFrames,
        averageFrameIntervalMs: average(frameIntervals),
        averageRenderMs: average(renderDurations),
      })) return;
      renderBudget = degradeRenderBudget(renderBudget);
      particlesRef.current = particlesRef.current.slice(-renderBudget.particleCap);
      resizeCanvas();
    }

    function loadSequence(phases: PassPhase[], seed: number): void {
      sequenceSeedRef.current = seed;
      sequenceRef.current = phases;
      phaseIdxRef.current = 0;
      phaseFrameRef.current = 0;
      phaseStateRef.current = phases[0]?.kind === 'shot' ? 'shooting' : 'passing';
      interceptedRef.current = false;
      tacticalAssignmentKeyRef.current = '';
      tacticalAssignmentsRef.current = null;
      const firstPhase = phases[0];
      if (!firstPhase) return;
      const layout = firstPhase.attackingHome
        ? liveRef.current.formationLayouts.home
        : liveRef.current.formationLayouts.away;
      const { source } = resolvePhasePoints(firstPhase, shiftRef.current, P, fw, fh, layout);
      ballSourceRef.current = source;
      ballPos.current = { ...source };
      if ((firstPhase.setPiece || firstPhase.restart) && firstPhase.sourceOverride) {
        const takerOffset = firstPhase.attackingHome ? 0 : 11;
        const taker = playerPosRef.current[takerOffset + firstPhase.passerIdx];
        taker.x = firstPhase.sourceOverride.x;
        taker.y = firstPhase.sourceOverride.y;
        taker.vx = 0;
        taker.vy = 0;
      }
      if (firstPhase.setPiece === 'penalty') {
        const defendingHome = !firstPhase.attackingHome;
        const goalkeeper = playerPosRef.current[defendingHome ? 0 : 11];
        goalkeeper.x = defendingHome ? 0.03 : 0.97;
        goalkeeper.y = 0.5;
        goalkeeper.vx = 0;
        goalkeeper.vy = 0;
      }
    }

    function triggerShotImpact(scene: EventScene, currentHomeColor: string, currentAwayColor: string): void {
      if (scene.outcome === 'delivery') return;
      const targetX = P + scene.target.x * fw;
      const targetY = P + scene.target.y * fh;
      triggeredImpactKeyRef.current = scene.key;
      pendingImpactSceneRef.current = null;
      postShotRestingBallRef.current = null;
      shotOutcomeHeldRef.current = scene.outcome === 'save' && scene.event.type === 'save';
      emitPresentationCue(scene, 'outcome', { outcome: scene.outcome });

      if (scene.outcome === 'goal') {
        goalCelebFrame.current = GOAL_CELEB_MAX_FRAMES;
        const allowGoalImpulse = renderBudget.quality === 'full' && !reducedMotion;
        cameraShakeRef.current = allowGoalImpulse ? CAMERA_SHAKE_MAX_FRAMES : 0;
        cameraShakeMax.current = allowGoalImpulse ? CAMERA_SHAKE_MAX_FRAMES : 1;
        flashWhiteRef.current = FLASH_MAX_FRAMES;
        const goalColor = scene.attackingHome ? currentHomeColor : currentAwayColor;
        goalCelebColor.current = goalColor;
        goalCelebRightSide.current = scene.attackingHome;
        addParticles(spawnGoalBurst(targetX, targetY, goalColor, H - P, scene.seed));
        return;
      }

      shotOutcomeFrameRef.current = SHOT_OUTCOME_MAX_FRAMES;
      shotOutcomeRef.current = scene.outcome;
      shotOutcomeTargetRef.current = { x: targetX, y: targetY };
      shotOutcomeAttackingHomeRef.current = scene.attackingHome;
      shotOutcomeSeedRef.current = scene.seed;
      if (scene.outcome === 'save' || scene.outcome === 'block') {
        addParticles(spawnTackleSparks(targetX, targetY, scene.seed + 17));
      }
    }

    // Bootstrap sequence if empty
    if (sequenceRef.current.length === 0) {
      const initialLive = liveRef.current;
      const initialScene = initialLive.eventScene;
      const initialSeed = initialScene?.seed ?? initialLive.minute * 137 + frameRef.current;
      const homePossessionShare = initialLive.possession[0] / 100;
      const generated = generateSequence(initialSeed, initialScene
        ? sequenceOptionsForScene(
          initialScene,
          initialLive.allEvents,
          initialLive.homeRoster,
          initialLive.awayRoster,
          homePossessionShare,
          initialLive.homeFormation,
          initialLive.awayFormation,
          initialLive.homeApproach,
          initialLive.awayApproach,
        )
        : {
          homePossessionShare,
          homeFormation: initialLive.homeFormation,
          awayFormation: initialLive.awayFormation,
          homeApproach: initialLive.homeApproach,
          awayApproach: initialLive.awayApproach,
        });
      loadSequence(generated.phases, initialSeed);
      activeSceneKeyRef.current = initialScene?.key ?? null;
      sequenceSceneRef.current = initialScene;
    }

    function renderFrame() {
      const renderStarted = performance.now();
      frameRef.current++;
      const f = frameRef.current;
      // Read live props from ref (no closure capture → no rAF restart on prop change)
      const live = liveRef.current;
      const {
        minute, maxMinute, homeColor, awayColor, halftime, breakLabel: liveBreakLabel, targetShift,
        eventScene, homeRoster, awayRoster, playbackMode: livePlaybackMode, shootout: liveShootout,
        possession: livePossession, homeFormation: liveHomeFormation, awayFormation: liveAwayFormation,
        homeApproach: liveHomeApproach, awayApproach: liveAwayApproach,
        formationLayouts: liveFormationLayouts, featuredPlayerIdSet: liveFeaturedPlayerIds,
      } = live;
      const homePossessionShare = livePossession[0] / 100;

      const activeDirectedPhase = sequenceSceneRef.current
        ? sequenceRef.current[phaseIdxRef.current]
        : undefined;
      const resultPresentationBusy = shotOutcomeFrameRef.current > 30 || goalCelebFrame.current > 50;
      const shouldHoldPlayback = Boolean(
        live.active
        && sequenceSceneRef.current
        && minute >= sequenceSceneRef.current.event.minute
        && (activeDirectedPhase || resultPresentationBusy),
      );
      if (playbackHoldRef.current !== shouldHoldPlayback) {
        playbackHoldRef.current = shouldHoldPlayback;
        live.onPlaybackHoldChange?.(shouldHoldPlayback);
      }
      if (
        eventScene
        && (activeDirectedPhase || resultPresentationBusy)
        && sequenceSceneRef.current?.key !== eventScene.key
        && !queuedScenesRef.current.some(scene => scene.key === eventScene.key)
      ) {
        queuedScenesRef.current.push(eventScene);
        if (queuedScenesRef.current.length > 3) queuedScenesRef.current.shift();
      }
      const canStartScene = !activeDirectedPhase && !resultPresentationBusy;
      const queuedScene = canStartScene ? queuedScenesRef.current[0] : undefined;
      const sceneToStart = queuedScene ?? (canStartScene ? eventScene : undefined);
      if (sceneToStart && activeSceneKeyRef.current !== sceneToStart.key) {
        // A new attack replaces any lingering cue from the previous chance.
        shotOutcomeFrameRef.current = 0;
        goalCelebFrame.current = 0;
        flashWhiteRef.current = 0;
        postShotRestingBallRef.current = null;
        shotOutcomeHeldRef.current = false;
        const ballX = clamp((ballPos.current.x - P) / fw, 0.03, 0.97);
        const ballY = clamp((ballPos.current.y - P) / fh, 0.05, 0.95);
        const attackingRoster = activePitchPlayers(sceneToStart.attackingHome ? homeRoster : awayRoster, minute, maxMinute);
        const attackingOffset = sceneToStart.attackingHome ? 0 : 11;
        const previousPhase = sequenceRef.current[phaseIdxRef.current]
          ?? sequenceRef.current[sequenceRef.current.length - 1];
        const possessionTurnover = !isSetPieceOrigin(playOriginForEvent(sceneToStart.event))
          && previousPhase !== undefined
          && previousPhase.attackingHome !== sceneToStart.attackingHome;
        if (possessionTurnover) {
          addParticles(spawnTackleSparks(ballPos.current.x, ballPos.current.y, sceneToStart.seed + 31));
        }
        const continuity = {
          source: { x: ballX, y: ballY },
          startingPlayerIdx: nearestPlayerSlot(
            attackingRoster,
            playerPosRef.current,
            attackingOffset,
            ballX,
            ballY,
          ),
          transition: possessionTurnover,
        };
        const directed = generateSequence(
          sceneToStart.seed,
          sequenceOptionsForScene(
            sceneToStart,
            live.allEvents,
            homeRoster,
            awayRoster,
            homePossessionShare,
            liveHomeFormation,
            liveAwayFormation,
            liveHomeApproach,
            liveAwayApproach,
            continuity,
          ),
        );
        loadSequence(directed.phases, sceneToStart.seed);
        activeSceneKeyRef.current = sceneToStart.key;
        sequenceSceneRef.current = sceneToStart;
        if (
          sceneToStart.outcome !== 'delivery'
          && minute >= sceneToStart.event.minute
          && triggeredImpactKeyRef.current !== sceneToStart.key
        ) {
          pendingImpactSceneRef.current = sceneToStart;
        }
        if (queuedScenesRef.current[0]?.key === sceneToStart.key) queuedScenesRef.current.shift();
      } else if (!eventScene && !sequenceSceneRef.current) {
        activeSceneKeyRef.current = null;
      }

      const activeImpactScene = sequenceSceneRef.current
        && sequenceSceneRef.current.outcome !== 'delivery'
        && minute >= sequenceSceneRef.current.event.minute
        && triggeredImpactKeyRef.current !== sequenceSceneRef.current.key
        ? sequenceSceneRef.current
        : null;
      const livePhase = sequenceRef.current[phaseIdxRef.current];

      const cameraMoment: BroadcastCameraMoment = halftime
        ? 'wide'
        : shotOutcomeFrameRef.current > 0 || goalCelebFrame.current > 0
          ? 'outcome'
          : livePhase?.kind === 'shot'
            ? 'finish'
            : livePhase?.setPiece
              ? 'set_piece'
              : livePhase?.stage === 'create' || livePhase?.stage === 'finish'
                ? 'attack'
                : livePhase?.stage === 'build'
                  ? 'build'
                  : 'wide';
      const cameraTarget = broadcastCameraTarget({
        moment: cameraMoment,
        quality: renderBudget.quality,
        playbackMode: livePlaybackMode,
        reducedMotion,
        ballX: ballPos.current.x,
        ballY: ballPos.current.y,
        canvasWidth: W,
        canvasHeight: H,
        padding: P,
        fieldWidth: fw,
        fieldHeight: fh,
      });
      const deadZoneX = fw * (cameraMoment === 'wide' ? 0.1 : 0.045);
      const deadZoneY = fh * (cameraMoment === 'wide' ? 0.12 : 0.06);
      const focusDeltaX = cameraTarget.focusX - cameraRef.current.focusX;
      const focusDeltaY = cameraTarget.focusY - cameraRef.current.focusY;
      const desiredFocusX = Math.abs(focusDeltaX) > deadZoneX
        ? cameraTarget.focusX - Math.sign(focusDeltaX) * deadZoneX
        : cameraRef.current.focusX;
      const desiredFocusY = Math.abs(focusDeltaY) > deadZoneY
        ? cameraTarget.focusY - Math.sign(focusDeltaY) * deadZoneY
        : cameraRef.current.focusY;
      cameraRef.current.focusX = lerp(cameraRef.current.focusX, desiredFocusX, cameraTarget.settle * 0.72);
      cameraRef.current.focusY = lerp(cameraRef.current.focusY, desiredFocusY, cameraTarget.settle * 0.72);
      cameraRef.current.zoom = lerp(cameraRef.current.zoom, cameraTarget.zoom, cameraTarget.settle);

      // Broadcast camera and restrained impact shake share one transform so
      // the pitch never receives competing scale/translation operations.
      const cameraTransform = applyCameraShake(ctx, cameraShakeRef, cameraShakeMax, W, H, cameraRef.current);

      shiftRef.current = lerp(shiftRef.current, targetShift, 0.03);

      ctx.drawImage(pitchLayer, 0, 0, pitchLayer.width, pitchLayer.height, 0, 0, W, H);

      if (halftime) {
        drawHalftime(ctx, W, H, liveBreakLabel?.label, liveBreakLabel?.sublabel);
        ctx.restore();
        recordRenderDuration(performance.now() - renderStarted);
        return;
      }

      // ── Sequence advancement ──
      const phase = sequenceRef.current[phaseIdxRef.current];
      if (!phase && !resultPresentationBusy) {
        // Continue from the prior ball location. Event scenes use a football-
        // specific restart instead of teleporting into another formation slot.
        sequenceSeedRef.current += 1;
        const completedScene = sequenceSceneRef.current;
        let continuationOptions: SequenceOptions;
        if (completedScene) {
          const attackingSecondBall = (
            completedScene.outcome === 'block'
            || (completedScene.outcome === 'save' && completedScene.event.type === 'gk_save')
          ) && seededRand(completedScene.seed + 401) < (completedScene.outcome === 'block' ? 0.36 : 0.28);
          const retainedDelivery = completedScene.outcome === 'delivery'
            && completedScene.event.setPiece?.resolution === 'retained';
          const restartingHome = completedScene.outcome === 'delivery'
            ? retainedDelivery ? completedScene.attackingHome : !completedScene.attackingHome
            : attackingSecondBall
              ? completedScene.attackingHome
              : !completedScene.attackingHome;
          const restart = completedScene.outcome === 'goal'
            ? 'kickoff'
            : completedScene.outcome === 'miss'
              ? 'goal_kick'
              : completedScene.outcome === 'save' && completedScene.event.type === 'save'
                ? 'keeper_release'
                : attackingSecondBall
                  ? 'second_ball'
                  : 'clearance';
          const restartingRoster = restartingHome ? homeRoster : awayRoster;
          const activeRestartingRoster = activePitchPlayers(restartingRoster, minute, maxMinute);
          const actors = actorsForEvent(completedScene.event, live.allEvents);
          const preferredRestartSlot = completedScene.outcome === 'delivery'
            ? retainedDelivery
              ? slotForPlayer(restartingRoster, actors.attackerId)
              : undefined
            : completedScene.outcome === 'goal'
            ? 9
            : completedScene.outcome === 'miss'
              ? 0
              : attackingSecondBall
                ? slotForPlayer(restartingRoster, actors.attackerId)
                : slotForPlayer(restartingRoster, actors.defenderId) ?? 0;
          const restingBall = postShotRestingBallRef.current;
          const restartSource = completedScene.outcome === 'goal'
            ? { x: 0.5, y: 0.5 }
            : completedScene.outcome === 'miss'
              ? { x: restartingHome ? 0.08 : 0.92, y: 0.5 }
              : restingBall
                ? {
                  x: clamp((restingBall.x - P) / fw, 0.04, 0.96),
                  y: clamp((restingBall.y - P) / fh, 0.08, 0.92),
                }
              : {
                x: clamp(completedScene.target.x, 0.04, 0.96),
                y: clamp(completedScene.target.y, 0.08, 0.92),
              };
          const restartSlot = preferredRestartSlot !== undefined
            && activeRestartingRoster.some(player => player.slotIndex === preferredRestartSlot)
            ? preferredRestartSlot
            : nearestPlayerSlot(
              activeRestartingRoster,
              playerPosRef.current,
              restartingHome ? 0 : 11,
              restartSource.x,
              restartSource.y,
            );
          continuationOptions = {
            attackingHome: restartingHome,
            startingPlayerIdx: restartSlot,
            sourceOverride: restartSource,
            restart,
            homePossessionShare,
            homeFormation: liveHomeFormation,
            awayFormation: liveAwayFormation,
            homeApproach: liveHomeApproach,
            awayApproach: liveAwayApproach,
          };
          postShotRestingBallRef.current = null;
          shotOutcomeHeldRef.current = false;
        } else {
          const completedPhase = sequenceRef.current[sequenceRef.current.length - 1];
          const nextAttackingHome = completedPhase?.attackingHome ?? true;
          const nextRoster = activePitchPlayers(nextAttackingHome ? homeRoster : awayRoster, minute, maxMinute);
          const nextOffset = nextAttackingHome ? 0 : 11;
          const ballX = clamp((ballPos.current.x - P) / fw, 0.03, 0.97);
          const ballY = clamp((ballPos.current.y - P) / fh, 0.05, 0.95);
          continuationOptions = {
            attackingHome: nextAttackingHome,
            startingPlayerIdx: nearestPlayerSlot(nextRoster, playerPosRef.current, nextOffset, ballX, ballY),
            sourceOverride: { x: ballX, y: ballY },
            homePossessionShare,
            homeFormation: liveHomeFormation,
            awayFormation: liveAwayFormation,
            homeApproach: liveHomeApproach,
            awayApproach: liveAwayApproach,
          };
        }
          const gen = generateSequence(sequenceSeedRef.current, continuationOptions);
        loadSequence(gen.phases, sequenceSeedRef.current);
        sequenceSceneRef.current = null;
      } else if (phase) {
        phaseFrameRef.current++;
        if (phaseStateRef.current !== 'holding') {
          // Check for interception mid-pass
          let turnoverLoaded = false;
          if (phase.kind === 'pass' && phase.intercepted && phaseFrameRef.current >= phase.duration * 0.55 && !interceptedRef.current) {
            interceptedRef.current = true;
            addParticles(spawnTackleSparks(
              ballPos.current.x,
              ballPos.current.y,
              sequenceSeedRef.current * 31 + phaseIdxRef.current,
            ));
            const turnoverHome = !phase.attackingHome;
            const turnoverOffset = turnoverHome ? 0 : 11;
            const turnoverRoster = activePitchPlayers(turnoverHome ? homeRoster : awayRoster, minute, maxMinute)
              .filter(player => player.position !== 'GK');
            const ballNX = (ballPos.current.x - P) / fw;
            const ballNY = (ballPos.current.y - P) / fh;
            const interceptor = turnoverRoster.reduce<PitchRosterPlayer | undefined>((nearest, player) => {
              if (!nearest) return player;
              const playerPosition = playerPosRef.current[turnoverOffset + player.slotIndex];
              const nearestPosition = playerPosRef.current[turnoverOffset + nearest.slotIndex];
              return Math.hypot(playerPosition.x - ballNX, playerPosition.y - ballNY)
                < Math.hypot(nearestPosition.x - ballNX, nearestPosition.y - ballNY)
                ? player
                : nearest;
            }, undefined);
            sequenceSeedRef.current += 1;
            const turnover = generateSequence(sequenceSeedRef.current, {
              attackingHome: turnoverHome,
              startingPlayerIdx: interceptor?.slotIndex ?? 6,
              sourceOverride: { x: ballNX, y: ballNY },
              homePossessionShare,
              transition: true,
              homeFormation: liveHomeFormation,
              awayFormation: liveAwayFormation,
              homeApproach: liveHomeApproach,
              awayApproach: liveAwayApproach,
            });
            loadSequence(turnover.phases, sequenceSeedRef.current);
            sequenceSceneRef.current = null;
            activeSceneKeyRef.current = null;
            turnoverLoaded = true;
          }
          if (!turnoverLoaded && phaseFrameRef.current >= phase.duration) {
            phaseStateRef.current = 'holding';
            phaseFrameRef.current = 0;
            // Ball arrival = grass kick effect
            addParticles(spawnGrassKick(
              ballPos.current.x,
              ballPos.current.y,
              0,
              1,
              sequenceSeedRef.current * 37 + phaseIdxRef.current,
            ));
          }
        } else if (phaseStateRef.current === 'holding' && phaseFrameRef.current >= phase.hold) {
          const newPhase = sequenceRef.current[phaseIdxRef.current + 1];
          const scene = sequenceSceneRef.current;
          const waitingForEvent = newPhase?.kind === 'shot'
            && scene
            && minute <= scene.event.minute
            && pendingImpactSceneRef.current?.key !== scene.key;
          const waitingForDelivery = scene?.outcome === 'delivery'
            && minute < scene.event.minute;

          if (waitingForEvent || waitingForDelivery) {
            phaseFrameRef.current = phase.hold;
          } else {
            if (scene?.outcome === 'delivery' && !newPhase) {
              emitPresentationCue(scene, 'outcome', { outcome: 'delivery' });
            }
            phaseIdxRef.current++;
            phaseFrameRef.current = 0;
            if (newPhase) {
              phaseStateRef.current = newPhase.kind === 'shot' ? 'shooting' : 'passing';
              const newPhaseLayout = newPhase.attackingHome
                ? liveFormationLayouts.home
                : liveFormationLayouts.away;
              const resolved = resolvePhasePoints(newPhase, shiftRef.current, P, fw, fh, newPhaseLayout);
              const source = newPhase.sourceOverride ? resolved.source : { ...ballPos.current };
              if (!newPhase.sourceOverride) {
                newPhase.sourceOverride = {
                  x: clamp((source.x - P) / fw, 0.03, 0.97),
                  y: clamp((source.y - P) / fh, 0.05, 0.95),
                };
              }
              ballSourceRef.current = source;
              const destination = newPhase.targetOverride
                ?? getBaseSlot(newPhase.receiverIdx, newPhase.attackingHome, shiftRef.current, newPhaseLayout);
              const sourceNX = (source.x - P) / fw;
              const sourceNY = (source.y - P) / fh;
              // Grass kick on pass start
              addParticles(spawnGrassKick(
                source.x,
                source.y,
                destination.x - sourceNX,
                destination.y - sourceNY,
                sequenceSeedRef.current * 41 + phaseIdxRef.current,
              ));
            }
          }
        }
      }

      const currentPhase = sequenceRef.current[phaseIdxRef.current] ?? sequenceRef.current[sequenceRef.current.length - 1];
      const isAttHome = currentPhase.attackingHome;
      const attackingFormationLayout = isAttHome
        ? liveFormationLayouts.home
        : liveFormationLayouts.away;
      const receiverSlot = currentPhase.targetOverride
        ?? getBaseSlot(currentPhase.receiverIdx, isAttHome, shiftRef.current, attackingFormationLayout);

      const defaultShotTarget = {
        x: isAttHome ? 0.985 : 0.015,
        y: 0.43 + seededRand(sequenceSeedRef.current + 71) * 0.14,
      };
      const directedShotScene = sequenceSceneRef.current;
      const directedActors = directedShotScene
        ? actorsForEvent(directedShotScene.event, live.allEvents)
        : {};
      const shotTarget = currentPhase.kind === 'shot'
        ? directedShotScene?.target ?? defaultShotTarget
        : null;
      const baseBallTarget = shotTarget ?? receiverSlot;
      const receiverRole = attackingFormationLayout[currentPhase.receiverIdx]?.role;
      const maxCarry = receiverRole === 'GK' ? 0.006 : receiverRole === 'DF' ? 0.014 : receiverRole === 'MF' ? 0.022 : 0.026;
      const canCarry = phaseStateRef.current === 'holding'
        && currentPhase.kind === 'pass'
        && sequenceRef.current[phaseIdxRef.current + 1]?.kind !== 'shot';
      const ballTarget = canCarry
        ? computeCarryTarget(
          baseBallTarget,
          isAttHome,
          phaseFrameRef.current / Math.max(1, currentPhase.hold),
          maxCarry,
        )
        : baseBallTarget;
      const finalTargetX = P + ballTarget.x * fw;
      const finalTargetY = P + ballTarget.y * fh;
      const releaseDelayFrames = currentPhase.releaseDelayFrames ?? (currentPhase.kind === 'shot' ? 8 : 0);
      if (
        directedShotScene
        && currentPhase.setPiece
        && phaseIdxRef.current === 0
        && phaseFrameRef.current <= 1
      ) {
        emitPresentationCue(directedShotScene, 'setup');
      }
      const contactFrame = Math.max(1, releaseDelayFrames);
      if (
        directedShotScene
        && phaseStateRef.current !== 'holding'
        && phaseFrameRef.current === contactFrame
        && (currentPhase.kind === 'shot' || currentPhase.setPiece)
      ) {
        emitPresentationCue(
          directedShotScene,
          'contact',
          { action: currentPhase.kind === 'shot' ? 'shot' : 'delivery' },
        );
      }
      const phaseProgress = phaseStateRef.current === 'holding'
        ? 1
        : clamp(
          (phaseFrameRef.current - releaseDelayFrames) / Math.max(1, currentPhase.duration - releaseDelayFrames),
          0,
          1,
        );

      // Compute ball position
      const ballResult = computeBallPosition({
        passing: phaseStateRef.current !== 'holding',
        phaseFrame: phaseFrameRef.current,
        duration: currentPhase.duration,
        arc: currentPhase.arc,
        source: ballSourceRef.current,
        target: { x: finalTargetX, y: finalTargetY },
        frame: f,
        flightKind: currentPhase.kind,
        releaseDelayFrames,
        swerve: currentPhase.swerve,
      });
      let bx = ballResult.bx;
      let by = ballResult.by;
      const receptionFrames = Math.min(10, Math.max(1, currentPhase.hold));
      if (phaseStateRef.current === 'holding' && currentPhase.kind === 'pass'
        && phaseFrameRef.current <= receptionFrames) {
        const receptionOffset = computeReceptionTouchOffset(
          ballSourceRef.current,
          { x: finalTargetX, y: finalTargetY },
          phaseFrameRef.current / receptionFrames,
        );
        bx += receptionOffset.x;
        by += receptionOffset.y;
      }
      ballArcLiftRef.current = ballResult.arcLift;
      ballSpinRef.current += ballResult.spinDelta;

      ballPos.current.x = bx;
      ballPos.current.y = by;

      const pendingImpact = activeImpactScene
        ?? (pendingImpactSceneRef.current?.key === directedShotScene?.key
          ? pendingImpactSceneRef.current
          : null);
      if (
        currentPhase.kind === 'shot'
        && phaseStateRef.current === 'holding'
        && pendingImpact
        && directedShotScene?.key === pendingImpact.key
      ) {
        triggerShotImpact(pendingImpact, homeColor, awayColor);
      }

      let displayBx = bx;
      let displayBy = by;
      let displayArcLift = ballArcLiftRef.current;
      if (shotOutcomeFrameRef.current > 0) {
        const rebound = computePostShotBallPosition({
          outcome: shotOutcomeRef.current,
          target: shotOutcomeTargetRef.current,
          attackingHome: shotOutcomeAttackingHomeRef.current,
          progress: 1 - shotOutcomeFrameRef.current / SHOT_OUTCOME_MAX_FRAMES,
          seed: shotOutcomeSeedRef.current,
          held: shotOutcomeHeldRef.current,
        });
        displayBx = rebound.bx;
        displayBy = rebound.by;
        displayArcLift = rebound.arcLift;
        postShotRestingBallRef.current = { x: rebound.bx, y: rebound.by };
        ballSpinRef.current += rebound.spinDelta;
      }

      // Ball trail (motion blur)
      if (phaseStateRef.current !== 'holding' && f % 2 === 0) {
        ballHistory.current.push({ x: displayBx, y: displayBy - displayArcLift });
        if (ballHistory.current.length > 10) ballHistory.current.shift();
      } else if (shotOutcomeFrameRef.current > 0 && f % 3 === 0) {
        ballHistory.current.push({ x: displayBx, y: displayBy - displayArcLift });
        if (ballHistory.current.length > 10) ballHistory.current.shift();
      } else if (ballHistory.current.length > 0 && f % 3 === 0) {
        ballHistory.current.shift();
      }

      // ── Update player positions with tactical AI ──
      const ballHolderTeamSide: 'home' | 'away' = isAttHome ? 'home' : 'away';
      const ballHolderIdx = phaseStateRef.current === 'holding' ? currentPhase.receiverIdx : currentPhase.passerIdx;
      const ballHolderRoster = isAttHome ? homeRoster : awayRoster;
      const lastTouchPlayerId = ballHolderRoster.find(player => player.slotIndex === currentPhase.passerIdx)?.playerId ?? null;
      const ballHolderId = phaseStateRef.current === 'holding' && currentPhase.kind === 'pass'
        ? ballHolderRoster.find(player => player.slotIndex === ballHolderIdx)?.playerId ?? null
        : null;
      const activeHome = activePitchPlayers(homeRoster, minute, maxMinute);
      const activeAway = activePitchPlayers(awayRoster, minute, maxMinute);
      const activePlayerIndices = new Set([
        ...activeHome.map(player => player.slotIndex),
        ...activeAway.map(player => 11 + player.slotIndex),
      ]);

      // Normalize ball + override to 0-1 for AI calcs
      const ballNX = (bx - P) / fw;
      const ballNY = (by - P) / fh;
      const pressureTarget = currentPhase.kind === 'pass' && phaseStateRef.current === 'passing'
        ? receiverSlot
        : { x: ballNX, y: ballNY };
      const tacticalMoment = currentPhase.setPiece
        ? `set-piece:${phaseIdxRef.current}`
        : currentPhase.stage === 'create' || currentPhase.stage === 'finish'
          ? 'final-third'
          : currentPhase.stage === 'transition'
            ? 'transition'
            : 'possession';
      const atmosphere = presentationAtmosphereForPhase(
        currentPhase,
        clamp(ballNX, 0, 1),
        phaseStateRef.current !== 'holding',
      );
      const previousAtmosphere = lastAtmosphereRef.current;
      const atmosphereChanged = atmosphere.attackingHome !== previousAtmosphere.attackingHome
        || atmosphere.stage !== previousAtmosphere.stage
        || atmosphere.setPiece !== previousAtmosphere.setPiece
        || atmosphere.inFlight !== previousAtmosphere.inFlight
        || Math.abs(atmosphere.danger - previousAtmosphere.danger) >= 0.08;
      if (atmosphereChanged || f - previousAtmosphere.frame >= 12) {
        lastAtmosphereRef.current = { ...atmosphere, frame: f };
        live.onPresentationAtmosphereChange?.(atmosphere);
      }
      const assignmentKey = `${sequenceSeedRef.current}:${tacticalMoment}:${isAttHome ? 'H' : 'A'}:${activeHome.length}:${activeAway.length}`;
      if (tacticalAssignmentKeyRef.current !== assignmentKey) {
        tacticalAssignmentKeyRef.current = assignmentKey;
        tacticalAssignmentsRef.current = buildTacticalAssignments(
          playerPosRef.current,
          !isAttHome,
          pressureTarget.x,
          pressureTarget.y,
          activePlayerIndices,
          liveFormationLayouts,
        );
      }
      updatePlayerPositions(
        playerPosRef.current,
        ballNX, ballNY,
        ballHolderTeamSide,
        ballHolderIdx,
        currentPhase,
        phaseStateRef.current,
        shotTarget,
        shiftRef.current,
        (() => {
          if (!directedShotScene || (directedShotScene.outcome !== 'save' && directedShotScene.outcome !== 'block')) return undefined;
          const eventPlayerId = directedActors.defenderId;
          if (!eventPlayerId) return undefined;
          const defendingHome = directedShotScene.event.shootout
            ? directedShotScene.event.teamId !== live.homeTeamId
            : directedShotScene.event.teamId === live.homeTeamId;
          const roster = defendingHome ? homeRoster : awayRoster;
          const player = roster.find(entry => entry.playerId === eventPlayerId);
          if (!player) return undefined;
          return {
            playerIndex: player.slotIndex + (defendingHome ? 0 : 11),
            target: directedShotScene.target,
          };
        })(),
        activePlayerIndices,
        phaseProgress,
        tacticalAssignmentsRef.current ?? undefined,
        liveFormationLayouts,
      );
      const pinnedPlayerIndices = new Set<number>();
      const holderOffset = isAttHome ? 0 : 11;
      pinnedPlayerIndices.add(holderOffset + ballHolderIdx);
      const eventAttacker = (isAttHome ? homeRoster : awayRoster)
        .find(player => player.playerId === directedActors.attackerId);
      if (eventAttacker) pinnedPlayerIndices.add(holderOffset + eventAttacker.slotIndex);
      if (directedActors.defenderId) {
        const defendingHome = !isAttHome;
        const defendingRoster = defendingHome ? homeRoster : awayRoster;
        const eventDefender = defendingRoster.find(player => player.playerId === directedActors.defenderId);
        if (eventDefender) pinnedPlayerIndices.add((defendingHome ? 0 : 11) + eventDefender.slotIndex);
      }
      separateActivePlayers(playerPosRef.current, activePlayerIndices, pinnedPlayerIndices);
      const attackerActionProgress = currentPhase.kind === 'shot'
        ? clamp(phaseFrameRef.current / Math.max(1, currentPhase.duration), 0, 1)
        : phaseProgress;

      // ── Draw players ──
      const visiblePlayerIds = liveShootout && directedShotScene?.event.shootout
        ? new Set([
          directedShotScene.event.playerId,
          directedShotScene.event.shootout.goalkeeperId,
        ].filter((playerId): playerId is string => Boolean(playerId)))
        : null;
      const visibleHome = activeHome
        .filter(player => !visiblePlayerIds || visiblePlayerIds.size === 0 || visiblePlayerIds.has(player.playerId));
      const visibleAway = activeAway
        .filter(player => !visiblePlayerIds || visiblePlayerIds.size === 0 || visiblePlayerIds.has(player.playerId));
      const playerVisualScale = renderBudget.quality === 'full' ? 1.04
        : renderBudget.quality === 'reduced' ? 1.08
          : 1.16;
      const ballVisualScale = renderBudget.quality === 'full' ? 1.08 : 1.24;
      for (const player of visibleHome) {
        const hasBall = isAttHome && player.playerId === ballHolderId;
        const isEventPlayer = directedActors.attackerId === player.playerId || directedActors.defenderId === player.playerId;
        const highlighted = isEventPlayer || directedActors.creatorId === player.playerId;
        const isAttacker = directedActors.attackerId === player.playerId;
        const isDefender = directedActors.defenderId === player.playerId;
        const receivingTouch = hasBall && currentPhase.kind === 'pass'
          && phaseStateRef.current === 'holding' && phaseFrameRef.current <= receptionFrames;
        drawPlayer(
          ctx, playerPosRef.current[player.slotIndex], homeColor, player.playerNumber,
          hasBall, P, fw, fh, f, highlighted, isEventPlayer ? player.playerName : undefined,
          isAttacker
            ? { x: finalTargetX, y: finalTargetY }
            : isDefender
              ? { x: bx, y: by }
              : receivingTouch ? ballSourceRef.current : undefined,
          receivingTouch
            ? 'receive'
            : isAttacker && currentPhase.kind === 'shot'
            ? 'shot'
            : isDefender && (directedShotScene?.outcome === 'save' || directedShotScene?.outcome === 'block')
              ? directedShotScene.outcome === 'save' && directedShotScene.event.type === 'save'
                ? 'catch'
                : directedShotScene.outcome
              : undefined,
          receivingTouch
            ? phaseFrameRef.current / receptionFrames
            : isAttacker ? attackerActionProgress : phaseProgress,
          playerVisualScale,
          liveFeaturedPlayerIds.has(player.playerId),
        );
      }
      for (const player of visibleAway) {
        const hasBall = !isAttHome && player.playerId === ballHolderId;
        const isEventPlayer = directedActors.attackerId === player.playerId || directedActors.defenderId === player.playerId;
        const highlighted = isEventPlayer || directedActors.creatorId === player.playerId;
        const isAttacker = directedActors.attackerId === player.playerId;
        const isDefender = directedActors.defenderId === player.playerId;
        const receivingTouch = hasBall && currentPhase.kind === 'pass'
          && phaseStateRef.current === 'holding' && phaseFrameRef.current <= receptionFrames;
        drawPlayer(
          ctx, playerPosRef.current[11 + player.slotIndex], awayColor, player.playerNumber,
          hasBall, P, fw, fh, f, highlighted, isEventPlayer ? player.playerName : undefined,
          isAttacker
            ? { x: finalTargetX, y: finalTargetY }
            : isDefender
              ? { x: bx, y: by }
              : receivingTouch ? ballSourceRef.current : undefined,
          receivingTouch
            ? 'receive'
            : isAttacker && currentPhase.kind === 'shot'
            ? 'shot'
            : isDefender && (directedShotScene?.outcome === 'save' || directedShotScene?.outcome === 'block')
              ? directedShotScene.outcome === 'save' && directedShotScene.event.type === 'save'
                ? 'catch'
                : directedShotScene.outcome
              : undefined,
          receivingTouch
            ? phaseFrameRef.current / receptionFrames
            : isAttacker ? attackerActionProgress : phaseProgress,
          playerVisualScale,
          liveFeaturedPlayerIds.has(player.playerId),
        );
      }

      debugStateRef.current = {
        coordinateSystem: 'normalized pitch: origin top-left, x right, y down',
        minute,
        playbackMode: livePlaybackMode,
        phase: phaseStateRef.current,
        attackingSide: isAttHome ? 'home' : 'away',
        event: directedShotScene
          ? {
              type: directedShotScene.event.type,
              outcome: directedShotScene.outcome,
              target: directedShotScene.target,
              ...directedActors,
            }
          : null,
        atmosphere,
        ball: {
          x: (displayBx - P) / fw,
          y: (displayBy - P) / fh,
          elevation: displayArcLift,
        },
        camera: {
          focusX: cameraRef.current.focusX / W,
          focusY: cameraRef.current.focusY / H,
          zoom: cameraRef.current.zoom,
        },
        ballHolderId,
        lastTouchPlayerId,
        playback: {
          holdingClock: shouldHoldPlayback,
          sceneMinute: sequenceSceneRef.current?.event.minute ?? null,
          queuedScenes: queuedScenesRef.current.length,
        },
        formations: {
          home: { formation: liveHomeFormation, approach: liveHomeApproach },
          away: { formation: liveAwayFormation, approach: liveAwayApproach },
        },
        action: {
          kind: currentPhase.kind,
          setPiece: currentPhase.setPiece,
          restart: currentPhase.restart,
          pattern: currentPhase.pattern,
          stage: currentPhase.stage,
          passerIdx: currentPhase.passerIdx,
          receiverIdx: currentPhase.receiverIdx,
          sourceOverride: currentPhase.sourceOverride,
          targetOverride: currentPhase.targetOverride,
          progress: phaseProgress,
        },
        homeOnField: visibleHome.map(player => ({
          id: player.playerId,
          number: player.playerNumber,
          slot: player.slotIndex,
          x: playerPosRef.current[player.slotIndex].x,
          y: playerPosRef.current[player.slotIndex].y,
          featured: liveFeaturedPlayerIds.has(player.playerId),
        })),
        awayOnField: visibleAway.map(player => ({
          id: player.playerId,
          number: player.playerNumber,
          slot: player.slotIndex,
          x: playerPosRef.current[11 + player.slotIndex].x,
          y: playerPosRef.current[11 + player.slotIndex].y,
          featured: liveFeaturedPlayerIds.has(player.playerId),
        })),
        rendering: debugStateRef.current.rendering,
      };

      // ── Particles update + draw ──
      particlesRef.current = updateAndCullParticles(particlesRef.current, H, renderBudget.particleCap);
      renderParticles(ctx, particlesRef.current);

      // ── Ball trail ──
      const bHist = ballHistory.current;
      for (let i = 0; i < bHist.length - 1; i++) {
        const a = (i / bHist.length) * 0.35;
        const r = 1 + (i / bHist.length) * 1.8;
        ctx.beginPath(); ctx.arc(bHist[i].x, bHist[i].y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill();
      }

      // ── Goal celebration ring + net ripple (tinted with team color) ──
      if (goalCelebFrame.current > 0) {
        goalCelebFrame.current--;
        // Position ring at the goal mouth, not where the ball is now.
        // Use the snapshotted side from when the goal fired — `nearEvent` may
        // become undefined mid-celebration (window outlasts ±1min event lookup).
        const isRightGoal = goalCelebRightSide.current;
        const ringX = isRightGoal ? W - P - 4 : P + 4;
        const ringY = H / 2;
        const gH = pitchGeometry.goalMouthSpan;
        const gY = (H - gH) / 2;
        drawGoalCelebration(
          ctx, goalCelebFrame.current,
          ringX, ringY,
          goalCelebColor.current,
          gY, gH,
          isRightGoal,
          W, P,
          bx, by,
          f,
        );
      }

      let outcomeLabel: {
        remainingFrames: number;
        outcome: Exclude<ShotOutcome, 'goal'>;
        x: number;
        y: number;
      } | null = null;
      if (shotOutcomeFrameRef.current > 0) {
        const remainingFrames = shotOutcomeFrameRef.current;
        drawShotOutcome(
          ctx,
          remainingFrames,
          shotOutcomeRef.current,
          shotOutcomeTargetRef.current.x,
          shotOutcomeTargetRef.current.y,
          shotOutcomeAttackingHomeRef.current,
        );
        const screenTarget = cameraPointToScreen(
          shotOutcomeTargetRef.current.x,
          shotOutcomeTargetRef.current.y,
          W,
          H,
          cameraTransform,
        );
        outcomeLabel = {
          remainingFrames,
          outcome: shotOutcomeRef.current,
          x: screenTarget.x,
          y: screenTarget.y,
        };
        shotOutcomeFrameRef.current--;
      }

      drawBall(ctx, displayBx, displayBy, displayArcLift, ballSpinRef.current, ballVisualScale);

      ctx.restore();

      if (outcomeLabel) {
        drawShotOutcomeLabel(
          ctx,
          outcomeLabel.remainingFrames,
          outcomeLabel.outcome,
          outcomeLabel.x,
          outcomeLabel.y,
          W,
          H,
        );
      }

      // ── White flash on goal (drawn on top of everything, no shake) ──
      applyWhiteFlash(ctx, flashWhiteRef, W, H);
      recordRenderDuration(performance.now() - renderStarted);

    }

    const runtime = mountPitchRuntime({
      canvas,
      getFrameStepMs: () => renderBudget.frameStepMs,
      getPlaybackPauseReason: () => {
        if (liveRef.current.finished) return 'completed';
        if (liveRef.current.halftime) return 'break';
        if (!liveRef.current.active) return 'paused';
        return 'none';
      },
      renderFrame,
      recordFrameInterval,
      onPaused: reason => updateRenderingDebug(false, reason),
      onAvailabilityChange: available => {
        liveRef.current.onPlaybackAvailabilityChange?.(available);
      },
    });
    const debugWindow = window as PitchDebugWindow;
    const advanceTime = (milliseconds: number) => runtime.advanceTime(milliseconds, FIXED_FRAME_MS);
    debugWindow.advanceTime = advanceTime;
    wakeRenderLoopRef.current = runtime.wake;
    return () => {
      runtime.dispose();
      resizeObserver.disconnect();
      wakeRenderLoopRef.current = () => undefined;
      if (debugWindow.advanceTime === advanceTime) delete debugWindow.advanceTime;
    };
    // Empty deps — render loop runs once for the lifetime of the component.
    // All reactive props are read via liveRef.current inside render().
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={LOGICAL_PITCH_WIDTH}
      height={LOGICAL_PITCH_HEIGHT}
      data-testid="pitch-canvas"
      aria-label="比赛实时战术动画"
      className="w-full aspect-[65/43] rounded-md border border-emerald-900/30"
    />
  );
}

export default memo(PitchCanvas);
