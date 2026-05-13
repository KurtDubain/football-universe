import { useEffect, useRef, useMemo } from 'react';
import type { MatchEvent } from '../types/match';
import { lerp, seededRand } from './pitch-canvas/math';
import { generateSequence } from './pitch-canvas/sequence';
import {
  spawnGoalBurst, spawnTackleSparks, spawnGrassKick,
  updateAndCullParticles, renderParticles,
} from './pitch-canvas/particles';
import {
  getBaseSlot, computeBallPosition, computeOverrideTarget, resolvePhasePoints, updatePlayerPositions,
} from './pitch-canvas/physics';
import {
  drawPitch, drawHalftime, drawPlayer, drawBall,
  drawGoalCelebration, applyCameraShake, applyWhiteFlash,
  GOAL_CELEB_MAX_FRAMES, FLASH_MAX_FRAMES, CAMERA_SHAKE_MAX_FRAMES,
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
  finished: boolean;
  halftime: boolean;
}

export default function PitchCanvas(props: Props) {
  const { minute, homeColor, awayColor, homeTeamId, flashEvent, allEvents, halftime } = props;

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
  const particlesRef = useRef<Particle[]>([]);
  const lastFlashEventRef = useRef<MatchEvent | null>(null); // de-dup mount-time flashEvent

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
  const ballSourceRef = useRef({ x: 0.5, y: 0.5 });
  const ballArcLiftRef = useRef(0);
  const interceptedRef = useRef(false);
  const ballSpinRef = useRef(0);

  const attackSide = useMemo(() => {
    const ev = allEvents.find(e => Math.abs(e.minute - minute) <= 2);
    if (ev) return ev.teamId === homeTeamId ? 'home' : 'away';
    return seededRand(minute * 31) > 0.45 ? 'home' : 'away';
  }, [minute, allEvents, homeTeamId]);

  const targetShift = useMemo(() => {
    const ev = allEvents.find(e => Math.abs(e.minute - minute) <= 2);
    if (!ev) return attackSide === 'home' ? 0.04 : -0.04;
    return ev.teamId === homeTeamId ? 0.07 : -0.07;
  }, [minute, allEvents, homeTeamId, attackSide]);

  const shiftRef = useRef(0);

  // Live snapshot of props for the long-running rAF loop to read from.
  // Avoids restarting the rAF chain on every minute / flashEvent change.
  const liveRef = useRef({
    minute, homeColor, awayColor, homeTeamId, allEvents, halftime, targetShift,
  });
  useEffect(() => {
    liveRef.current = { minute, homeColor, awayColor, homeTeamId, allEvents, halftime, targetShift };
  });

  // Goal-trigger effect: fires once per new flashEvent (goal/penalty_goal).
  // Spawns particles + camera shake. Does NOT restart the rAF loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const isGoal = flashEvent && (flashEvent.type === 'goal' || flashEvent.type === 'penalty_goal');
    if (!isGoal) return;
    // Skip if we already fired for this exact event (handles strict-mode double mount + replays)
    if (lastFlashEventRef.current === flashEvent) return;
    lastFlashEventRef.current = flashEvent;
    const W = canvas.width, H = canvas.height;
    const P = 10;
    const fw = W - P * 2;
    goalCelebFrame.current = GOAL_CELEB_MAX_FRAMES;
    cameraShakeRef.current = CAMERA_SHAKE_MAX_FRAMES;
    cameraShakeMax.current = CAMERA_SHAKE_MAX_FRAMES;
    flashWhiteRef.current = FLASH_MAX_FRAMES;
    const evIsHome = flashEvent.teamId === homeTeamId;
    const goalColor = evIsHome ? homeColor : awayColor;
    goalCelebColor.current = goalColor;
    goalCelebRightSide.current = evIsHome;
    const goalX = P + (evIsHome ? 0.97 : 0.03) * fw;
    const goalY = H / 2;
    const floor = H - P; // particles bounce off pitch edge
    particlesRef.current.push(...spawnGoalBurst(goalX, goalY, goalColor, floor));
  }, [flashEvent, homeTeamId, homeColor, awayColor]);

  // Main rAF loop — starts once on mount, reads from liveRef. No restarts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const P = 10;
    const fw = W - P * 2, fh = H - P * 2;

    // Bootstrap sequence if empty
    if (sequenceRef.current.length === 0) {
      sequenceSeedRef.current = liveRef.current.minute * 137 + frameRef.current;
      const gen = generateSequence(sequenceSeedRef.current);
      sequenceRef.current = gen.phases;
      phaseIdxRef.current = 0;
      phaseFrameRef.current = 0;
      phaseStateRef.current = 'passing';
      interceptedRef.current = false;
      const { source } = resolvePhasePoints(sequenceRef.current[0], shiftRef.current, P, fw, fh);
      ballSourceRef.current = source;
      ballPos.current = { ...source };
    }

    function render() {
      frameRef.current++;
      const f = frameRef.current;
      // Read live props from ref (no closure capture → no rAF restart on prop change)
      const live = liveRef.current;
      const { minute, homeColor, awayColor, homeTeamId, allEvents, halftime, targetShift } = live;

      // Camera shake — saves ctx, translates, clears. Caller must restore() at end of frame.
      applyCameraShake(ctx, cameraShakeRef, cameraShakeMax, W, H);

      shiftRef.current = lerp(shiftRef.current, targetShift, 0.03);

      drawPitch(ctx, W, H, P, fw, fh);

      if (halftime) {
        drawHalftime(ctx, W, H);
        ctx.restore();
        raf = requestAnimationFrame(render);
        return;
      }

      // ── Sequence advancement ──
      const phase = sequenceRef.current[phaseIdxRef.current];
      if (!phase) {
        // Generate new sequence — possibly switching possession
        sequenceSeedRef.current += 1;
        const gen = generateSequence(sequenceSeedRef.current);
        sequenceRef.current = gen.phases;
        phaseIdxRef.current = 0;
        phaseFrameRef.current = 0;
        phaseStateRef.current = 'passing';
        interceptedRef.current = false;
        ballSourceRef.current = resolvePhasePoints(sequenceRef.current[0], shiftRef.current, P, fw, fh).source;
      } else {
        phaseFrameRef.current++;
        if (phaseStateRef.current === 'passing') {
          // Check for interception mid-pass
          if (phase.intercepted && phaseFrameRef.current >= phase.duration * 0.55 && !interceptedRef.current) {
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
          phaseIdxRef.current++;
          phaseFrameRef.current = 0;
          phaseStateRef.current = 'passing';
          const newPhase = sequenceRef.current[phaseIdxRef.current];
          if (newPhase) {
            const { source, dx, dy } = resolvePhasePoints(newPhase, shiftRef.current, P, fw, fh);
            ballSourceRef.current = source;
            // Grass kick on pass start
            particlesRef.current.push(...spawnGrassKick(source.x, source.y, dx, dy));
          }
        }
      }

      const currentPhase = sequenceRef.current[phaseIdxRef.current] ?? sequenceRef.current[sequenceRef.current.length - 1];
      const isAttHome = currentPhase.attackingHome;
      const receiverSlot = getBaseSlot(currentPhase.receiverIdx, isAttHome, shiftRef.current);
      const targetX = P + receiverSlot.x * fw;
      const targetY = P + receiverSlot.y * fh;

      // Special events override target (in pixel coords)
      const overrideTarget = computeOverrideTarget(allEvents, minute, homeTeamId, P, fw, fh);
      const finalTargetX = overrideTarget?.x ?? targetX;
      const finalTargetY = overrideTarget?.y ?? targetY;

      // Compute ball position
      const ballResult = computeBallPosition({
        passing: phaseStateRef.current === 'passing',
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

      // Ball trail (motion blur)
      if (phaseStateRef.current === 'passing' && f % 2 === 0) {
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
      const overrideTargetN = overrideTarget
        ? { x: (overrideTarget.x - P) / fw, y: (overrideTarget.y - P) / fh }
        : null;

      updatePlayerPositions(
        playerPosRef.current,
        ballNX, ballNY,
        ballHolderTeamSide,
        ballHolderIdx,
        currentPhase,
        phaseStateRef.current,
        overrideTargetN,
        shiftRef.current,
      );

      // ── Draw players ──
      for (let i = 0; i < 11; i++) {
        const hasBall = isAttHome && i === ballHolderIdx;
        drawPlayer(ctx, playerPosRef.current[i], homeColor, i === 0 ? 1 : i + 1, hasBall, P, fw, fh, f);
      }
      for (let i = 11; i < 22; i++) {
        const formIdx = i - 11;
        const hasBall = !isAttHome && formIdx === ballHolderIdx;
        drawPlayer(ctx, playerPosRef.current[i], awayColor, formIdx === 0 ? 1 : formIdx + 1, hasBall, P, fw, fh, f);
      }

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

      drawBall(ctx, bx, by, ballArcLiftRef.current, ballSpinRef.current);

      ctx.restore();

      // ── White flash on goal (drawn on top of everything, no shake) ──
      applyWhiteFlash(ctx, flashWhiteRef, W, H);

      raf = requestAnimationFrame(render);
    }

    let raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
    // Empty deps — render loop runs once for the lifetime of the component.
    // All reactive props are read via liveRef.current inside render().
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={280}
      className="w-full rounded-xl border border-emerald-900/30"
    />
  );
}
