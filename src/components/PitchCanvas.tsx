import { useEffect, useRef, useMemo } from 'react';
import type { MatchdaySnapshot, MatchEvent } from '../types/match';
import { lerp, seededRand } from './pitch-canvas/math';
import { generateSequence } from './pitch-canvas/sequence';
import { findEventScene, sceneForEvent, type EventScene, type ShotOutcome } from './pitch-canvas/event-scene';
import { activePitchPlayers, buildPitchRoster } from './pitch-canvas/lineup';
import {
  spawnGoalBurst, spawnTackleSparks, spawnGrassKick,
  updateAndCullParticles, renderParticles,
} from './pitch-canvas/particles';
import { getBaseSlot, computeBallPosition, resolvePhasePoints, updatePlayerPositions } from './pitch-canvas/physics';
import {
  drawPitch, drawHalftime, drawPlayer, drawBall,
  drawGoalCelebration, drawShotOutcome, applyCameraShake, applyWhiteFlash,
  GOAL_CELEB_MAX_FRAMES, FLASH_MAX_FRAMES, CAMERA_SHAKE_MAX_FRAMES, SHOT_OUTCOME_MAX_FRAMES,
} from './pitch-canvas/renderer';
import { BASE_FORMATION, type Particle, type PassPhase, type PlayerState } from './pitch-canvas/types';

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
}

interface PitchDebugState {
  coordinateSystem: string;
  minute: number;
  phase: 'passing' | 'holding' | 'shooting';
  attackingSide: 'home' | 'away';
  event: { type: MatchEvent['type']; outcome: ShotOutcome } | null;
  ball: { x: number; y: number };
  homeOnField: Array<{ id: string; number: number; slot: number }>;
  awayOnField: Array<{ id: string; number: number; slot: number }>;
}

type PitchDebugWindow = Window & {
  render_game_to_text?: () => string;
  advanceTime?: (milliseconds: number) => void;
};

const LOGICAL_WIDTH = 520;
const LOGICAL_HEIGHT = 280;
const FIXED_FRAME_MS = 1000 / 60;

export default function PitchCanvas(props: Props) {
  const {
    minute, maxMinute, homeColor, awayColor, homeTeamId, flashEvent, allEvents,
    homeMatchday, awayMatchday, halftime,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const ballPos = useRef({ x: 0.5, y: 0.5 });
  const ballHistory = useRef<{ x: number; y: number }[]>([]);
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
  const particlesRef = useRef<Particle[]>([]);
  const pendingImpactSceneRef = useRef<EventScene | null>(null);
  const triggeredImpactKeyRef = useRef<string | null>(null);

  // Per-player live positions (smoothed) — 22 players (11 home + 11 away)
  const playerPosRef = useRef<PlayerState[]>(
    Array.from({ length: 22 }, (_, i) => {
      const base = BASE_FORMATION[i % 11];
      const isHome = i < 11;
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
  const ballSourceRef = useRef({ x: 0.5, y: 0.5 });
  const ballArcLiftRef = useRef(0);
  const interceptedRef = useRef(false);
  const ballSpinRef = useRef(0);
  const debugStateRef = useRef<PitchDebugState>({
    coordinateSystem: 'normalized pitch: origin top-left, x right, y down',
    minute,
    phase: 'passing',
    attackingSide: 'home',
    event: null,
    ball: { x: 0.5, y: 0.5 },
    homeOnField: [],
    awayOnField: [],
  });

  const eventScene = useMemo(
    () => findEventScene(allEvents, minute, homeTeamId, flashEvent),
    [allEvents, minute, homeTeamId, flashEvent],
  );
  const homeRoster = useMemo(() => buildPitchRoster(homeMatchday), [homeMatchday]);
  const awayRoster = useMemo(() => buildPitchRoster(awayMatchday), [awayMatchday]);

  const targetShift = useMemo(() => {
    if (eventScene) return eventScene.attackingHome ? 0.07 : -0.07;
    return seededRand(minute * 31) > 0.45 ? 0.04 : -0.04;
  }, [eventScene, minute]);

  const shiftRef = useRef(0);

  // Live snapshot of props for the long-running rAF loop to read from.
  // Avoids restarting the rAF chain on every minute / flashEvent change.
  const liveRef = useRef({
    minute, maxMinute, homeColor, awayColor, homeTeamId, allEvents, halftime, targetShift,
    eventScene, homeRoster, awayRoster,
  });
  useEffect(() => {
    liveRef.current = {
      minute, maxMinute, homeColor, awayColor, homeTeamId, allEvents, halftime, targetShift,
      eventScene, homeRoster, awayRoster,
    };
  });

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
    if (!scene || triggeredImpactKeyRef.current === scene.key) return;
    pendingImpactSceneRef.current = scene;
  }, [allEvents, flashEvent, homeTeamId]);

  // Main rAF loop — starts once on mount, reads from liveRef. No restarts.
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const canvas: HTMLCanvasElement = canvasElement;
    const ctx = canvas.getContext('2d')!;
    const W = LOGICAL_WIDTH, H = LOGICAL_HEIGHT;
    const P = 10;
    const fw = W - P * 2, fh = H - P * 2;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resizeCanvas(): void {
      // clientWidth is layout-space width and is unaffected by the modal's
      // scale-in transform, so the initial backing buffer reaches full DPR.
      const cssWidth = canvas.clientWidth || LOGICAL_WIDTH;
      const cssHeight = cssWidth * LOGICAL_HEIGHT / LOGICAL_WIDTH;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const nextWidth = Math.round(cssWidth * dpr);
      const nextHeight = Math.round(cssHeight * dpr);
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      ctx.setTransform(
        dpr * cssWidth / LOGICAL_WIDTH,
        0,
        0,
        dpr * cssHeight / LOGICAL_HEIGHT,
        0,
        0,
      );
    }

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    function loadSequence(phases: PassPhase[], seed: number): void {
      sequenceSeedRef.current = seed;
      sequenceRef.current = phases;
      phaseIdxRef.current = 0;
      phaseFrameRef.current = 0;
      phaseStateRef.current = phases[0]?.kind === 'shot' ? 'shooting' : 'passing';
      interceptedRef.current = false;
      const firstPhase = phases[0];
      if (!firstPhase) return;
      const { source } = resolvePhasePoints(firstPhase, shiftRef.current, P, fw, fh);
      ballSourceRef.current = source;
      ballPos.current = { ...source };
    }

    function triggerShotImpact(scene: EventScene, currentHomeColor: string, currentAwayColor: string): void {
      const targetX = P + scene.target.x * fw;
      const targetY = P + scene.target.y * fh;
      triggeredImpactKeyRef.current = scene.key;
      pendingImpactSceneRef.current = null;

      if (scene.outcome === 'goal') {
        goalCelebFrame.current = GOAL_CELEB_MAX_FRAMES;
        cameraShakeRef.current = CAMERA_SHAKE_MAX_FRAMES;
        cameraShakeMax.current = CAMERA_SHAKE_MAX_FRAMES;
        flashWhiteRef.current = FLASH_MAX_FRAMES;
        const goalColor = scene.attackingHome ? currentHomeColor : currentAwayColor;
        goalCelebColor.current = goalColor;
        goalCelebRightSide.current = scene.attackingHome;
        particlesRef.current.push(...spawnGoalBurst(targetX, targetY, goalColor, H - P));
        return;
      }

      shotOutcomeFrameRef.current = SHOT_OUTCOME_MAX_FRAMES;
      shotOutcomeRef.current = scene.outcome;
      shotOutcomeTargetRef.current = { x: targetX, y: targetY };
      shotOutcomeAttackingHomeRef.current = scene.attackingHome;
      if (scene.outcome === 'save' || scene.outcome === 'block') {
        particlesRef.current.push(...spawnTackleSparks(targetX, targetY));
        cameraShakeRef.current = scene.outcome === 'block' ? 12 : 8;
        cameraShakeMax.current = cameraShakeRef.current;
      }
    }

    // Bootstrap sequence if empty
    if (sequenceRef.current.length === 0) {
      const initialScene = liveRef.current.eventScene;
      const initialSeed = initialScene?.seed ?? liveRef.current.minute * 137 + frameRef.current;
      const generated = generateSequence(initialSeed, initialScene
        ? {
          attackingHome: initialScene.attackingHome,
          forceShot: true,
          setPiece: initialScene.event.type === 'penalty_goal' || initialScene.event.type === 'penalty_miss' ? 'penalty' : undefined,
        }
        : undefined);
      loadSequence(generated.phases, initialSeed);
      activeSceneKeyRef.current = initialScene?.key ?? null;
      sequenceSceneRef.current = initialScene;
    }

    function renderFrame() {
      frameRef.current++;
      const f = frameRef.current;
      // Read live props from ref (no closure capture → no rAF restart on prop change)
      const live = liveRef.current;
      const {
        minute, maxMinute, homeColor, awayColor, halftime, targetShift,
        eventScene, homeRoster, awayRoster,
      } = live;

      if (eventScene && activeSceneKeyRef.current !== eventScene.key) {
        // A new attack replaces any lingering cue from the previous chance.
        shotOutcomeFrameRef.current = 0;
        goalCelebFrame.current = 0;
        flashWhiteRef.current = 0;
        const directed = generateSequence(eventScene.seed, {
          attackingHome: eventScene.attackingHome,
          forceShot: true,
          setPiece: eventScene.event.type === 'penalty_goal' || eventScene.event.type === 'penalty_miss' ? 'penalty' : undefined,
        });
        loadSequence(directed.phases, eventScene.seed);
        activeSceneKeyRef.current = eventScene.key;
        sequenceSceneRef.current = eventScene;
      } else if (!eventScene) {
        activeSceneKeyRef.current = null;
      }

      const queuedImpact = pendingImpactSceneRef.current;
      const livePhase = sequenceRef.current[phaseIdxRef.current];
      if (queuedImpact && sequenceSceneRef.current?.key === queuedImpact.key && livePhase?.kind !== 'shot') {
        const shotIndex = sequenceRef.current.findIndex(phase => phase.kind === 'shot');
        if (shotIndex >= 0) {
          phaseIdxRef.current = shotIndex;
          phaseFrameRef.current = 0;
          phaseStateRef.current = 'shooting';
          ballSourceRef.current = { ...ballPos.current };
        }
      }

      // Camera shake — saves ctx, translates, clears. Caller must restore() at end of frame.
      applyCameraShake(ctx, cameraShakeRef, cameraShakeMax, W, H);

      shiftRef.current = lerp(shiftRef.current, targetShift, 0.03);

      drawPitch(ctx, W, H, P, fw, fh);

      if (halftime) {
        drawHalftime(ctx, W, H);
        ctx.restore();
        return;
      }

      // ── Sequence advancement ──
      const phase = sequenceRef.current[phaseIdxRef.current];
      if (!phase) {
        // Generate new sequence — possibly switching possession
        sequenceSeedRef.current += 1;
        const gen = generateSequence(sequenceSeedRef.current);
        loadSequence(gen.phases, sequenceSeedRef.current);
        sequenceSceneRef.current = null;
      } else {
        phaseFrameRef.current++;
        if (phaseStateRef.current !== 'holding') {
          // Check for interception mid-pass
          if (phase.kind === 'pass' && phase.intercepted && phaseFrameRef.current >= phase.duration * 0.55 && !interceptedRef.current) {
            interceptedRef.current = true;
            particlesRef.current.push(...spawnTackleSparks(ballPos.current.x, ballPos.current.y));
            cameraShakeRef.current = Math.max(cameraShakeRef.current, 8);
            // Keep `cameraShakeMax` in sync so the attenuated sine still has
            // proper amplitude — otherwise a tackle right after a goal
            // (max=28) would barely register due to exp(-2.13) decay.
            cameraShakeMax.current = Math.max(cameraShakeMax.current, cameraShakeRef.current);
            // Truncate sequence and trigger possession swap on next gen
            sequenceRef.current = sequenceRef.current.slice(0, phaseIdxRef.current + 1);
          }
          if (phaseFrameRef.current >= phase.duration) {
            phaseStateRef.current = 'holding';
            phaseFrameRef.current = 0;
            // Ball arrival = grass kick effect
            particlesRef.current.push(...spawnGrassKick(ballPos.current.x, ballPos.current.y, 0, 1));
          }
        } else if (phaseStateRef.current === 'holding' && phaseFrameRef.current >= phase.hold) {
          const newPhase = sequenceRef.current[phaseIdxRef.current + 1];
          const scene = sequenceSceneRef.current;
          const waitingForEvent = newPhase?.kind === 'shot'
            && scene
            && minute <= scene.event.minute
            && pendingImpactSceneRef.current?.key !== scene.key;
          const holdingEventResult = phase.kind === 'shot' && eventScene;

          if (waitingForEvent || holdingEventResult) {
            phaseFrameRef.current = phase.hold;
          } else {
            phaseIdxRef.current++;
            phaseFrameRef.current = 0;
            if (newPhase) {
              phaseStateRef.current = newPhase.kind === 'shot' ? 'shooting' : 'passing';
              const { source, dx, dy } = resolvePhasePoints(newPhase, shiftRef.current, P, fw, fh);
              ballSourceRef.current = source;
              // Grass kick on pass start
              particlesRef.current.push(...spawnGrassKick(source.x, source.y, dx, dy));
            }
          }
        }
      }

      const currentPhase = sequenceRef.current[phaseIdxRef.current] ?? sequenceRef.current[sequenceRef.current.length - 1];
      const isAttHome = currentPhase.attackingHome;
      const receiverSlot = getBaseSlot(currentPhase.receiverIdx, isAttHome, shiftRef.current);
      const targetX = P + receiverSlot.x * fw;
      const targetY = P + receiverSlot.y * fh;

      const defaultShotTarget = {
        x: isAttHome ? 0.985 : 0.015,
        y: 0.43 + seededRand(sequenceSeedRef.current + 71) * 0.14,
      };
      const directedShotScene = eventScene ?? sequenceSceneRef.current;
      const shotTarget = currentPhase.kind === 'shot'
        ? directedShotScene?.target ?? defaultShotTarget
        : null;
      const finalTargetX = shotTarget ? P + shotTarget.x * fw : targetX;
      const finalTargetY = shotTarget ? P + shotTarget.y * fh : targetY;

      // Compute ball position
      const ballResult = computeBallPosition({
        passing: phaseStateRef.current !== 'holding',
        phaseFrame: phaseFrameRef.current,
        duration: currentPhase.duration,
        arc: currentPhase.arc,
        source: ballSourceRef.current,
        target: { x: finalTargetX, y: finalTargetY },
        frame: f,
      });
      const bx = ballResult.bx;
      const by = ballResult.by;
      ballArcLiftRef.current = ballResult.arcLift;
      ballSpinRef.current += ballResult.spinDelta;

      ballPos.current.x = bx;
      ballPos.current.y = by;

      const pendingImpact = pendingImpactSceneRef.current;
      if (
        currentPhase.kind === 'shot'
        && phaseStateRef.current === 'holding'
        && pendingImpact
        && directedShotScene?.key === pendingImpact.key
      ) {
        triggerShotImpact(pendingImpact, homeColor, awayColor);
      }

      // Ball trail (motion blur)
      if (phaseStateRef.current !== 'holding' && f % 2 === 0) {
        ballHistory.current.push({ x: bx, y: by });
        if (ballHistory.current.length > 10) ballHistory.current.shift();
      } else if (ballHistory.current.length > 0 && f % 3 === 0) {
        ballHistory.current.shift();
      }

      // ── Update player positions with tactical AI ──
      const ballHolderTeamSide: 'home' | 'away' = isAttHome ? 'home' : 'away';
      const ballHolderIdx = phaseStateRef.current === 'holding' ? currentPhase.receiverIdx : currentPhase.passerIdx;

      // Normalize ball + override to 0-1 for AI calcs
      const ballNX = (bx - P) / fw;
      const ballNY = (by - P) / fh;
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
          const eventPlayerId = directedShotScene.event.playerId;
          if (!eventPlayerId) return undefined;
          const defendingHome = directedShotScene.event.teamId === live.homeTeamId;
          const roster = defendingHome ? homeRoster : awayRoster;
          const player = roster.find(entry => entry.playerId === eventPlayerId);
          if (!player) return undefined;
          return {
            playerIndex: player.slotIndex + (defendingHome ? 0 : 11),
            target: directedShotScene.target,
          };
        })(),
      );

      // ── Draw players ──
      const visibleHome = activePitchPlayers(homeRoster, minute, maxMinute);
      const visibleAway = activePitchPlayers(awayRoster, minute, maxMinute);
      for (const player of visibleHome) {
        const hasBall = isAttHome && player.slotIndex === ballHolderIdx;
        const highlighted = eventScene?.event.playerId === player.playerId;
        drawPlayer(
          ctx, playerPosRef.current[player.slotIndex], homeColor, player.playerNumber,
          hasBall, P, fw, fh, f, highlighted, highlighted ? player.playerName : undefined,
        );
      }
      for (const player of visibleAway) {
        const hasBall = !isAttHome && player.slotIndex === ballHolderIdx;
        const highlighted = eventScene?.event.playerId === player.playerId;
        drawPlayer(
          ctx, playerPosRef.current[11 + player.slotIndex], awayColor, player.playerNumber,
          hasBall, P, fw, fh, f, highlighted, highlighted ? player.playerName : undefined,
        );
      }

      debugStateRef.current = {
        coordinateSystem: 'normalized pitch: origin top-left, x right, y down',
        minute,
        phase: phaseStateRef.current,
        attackingSide: isAttHome ? 'home' : 'away',
        event: eventScene ? { type: eventScene.event.type, outcome: eventScene.outcome } : null,
        ball: { x: ballNX, y: ballNY },
        homeOnField: visibleHome.map(player => ({ id: player.playerId, number: player.playerNumber, slot: player.slotIndex })),
        awayOnField: visibleAway.map(player => ({ id: player.playerId, number: player.playerNumber, slot: player.slotIndex })),
      };

      // ── Particles update + draw ──
      particlesRef.current = updateAndCullParticles(particlesRef.current, H);
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
        const gH = fh * 0.14;
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

      if (shotOutcomeFrameRef.current > 0) {
        drawShotOutcome(
          ctx,
          shotOutcomeFrameRef.current,
          shotOutcomeRef.current,
          shotOutcomeTargetRef.current.x,
          shotOutcomeTargetRef.current.y,
          shotOutcomeAttackingHomeRef.current,
        );
        shotOutcomeFrameRef.current--;
      }

      drawBall(ctx, bx, by, ballArcLiftRef.current, ballSpinRef.current);

      ctx.restore();

      // ── White flash on goal (drawn on top of everything, no shake) ──
      applyWhiteFlash(ctx, flashWhiteRef, W, H);

    }

    const debugWindow = window as PitchDebugWindow;
    const advanceTime = (milliseconds: number) => {
      const steps = Math.max(1, Math.round(milliseconds / FIXED_FRAME_MS));
      for (let step = 0; step < steps; step++) renderFrame();
    };
    debugWindow.advanceTime = advanceTime;

    let lastTimestamp = performance.now();
    let accumulator = FIXED_FRAME_MS;
    let raf = 0;
    function animate(timestamp: number): void {
      const elapsed = Math.min(100, Math.max(0, timestamp - lastTimestamp));
      lastTimestamp = timestamp;
      accumulator += elapsed;
      const frameStep = reducedMotion ? 250 : FIXED_FRAME_MS;
      let steps = 0;
      while (accumulator >= frameStep && steps < 6) {
        renderFrame();
        accumulator -= frameStep;
        steps++;
      }
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      if (debugWindow.advanceTime === advanceTime) delete debugWindow.advanceTime;
    };
    // Empty deps — render loop runs once for the lifetime of the component.
    // All reactive props are read via liveRef.current inside render().
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={LOGICAL_WIDTH}
      height={LOGICAL_HEIGHT}
      data-testid="pitch-canvas"
      aria-label="比赛实时战术动画"
      className="w-full aspect-[13/7] rounded-xl border border-emerald-900/30"
    />
  );
}
