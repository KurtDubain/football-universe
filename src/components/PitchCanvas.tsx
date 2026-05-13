import { useEffect, useRef, useMemo } from 'react';
import type { MatchEvent } from '../types/match';

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

// 4-4-2 formation positions (normalized 0-1, x is depth, y is width)
const BASE_FORMATION = [
  { x: 0.07, y: 0.5, role: 'GK' as Role },
  { x: 0.22, y: 0.13, role: 'DF' as Role }, { x: 0.20, y: 0.37, role: 'DF' as Role },
  { x: 0.20, y: 0.63, role: 'DF' as Role }, { x: 0.22, y: 0.87, role: 'DF' as Role },
  { x: 0.38, y: 0.15, role: 'MF' as Role }, { x: 0.35, y: 0.40, role: 'MF' as Role },
  { x: 0.35, y: 0.60, role: 'MF' as Role }, { x: 0.38, y: 0.85, role: 'MF' as Role },
  { x: 0.50, y: 0.35, role: 'FW' as Role }, { x: 0.50, y: 0.65, role: 'FW' as Role },
];

type Role = 'GK' | 'DF' | 'MF' | 'FW';

// ── Math helpers ──────────────────────────────────────────────
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function easeInOutQuad(t: number) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay);
}
function seededRand(seed: number) { return ((Math.sin(seed * 9301 + 49297) % 1) + 1) % 1; }

// ── Pass sequence types ──────────────────────────────────────
interface PassPhase {
  passerIdx: number;
  receiverIdx: number;
  attackingHome: boolean;
  duration: number;
  hold: number;
  arc: number;
  intercepted: boolean; // pass gets stolen halfway through
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
}

/**
 * Generate a possession sequence with realistic flow and occasional interceptions.
 */
function generateSequence(seed: number): { phases: PassPhase[]; endsInShot: boolean } {
  const r = (n: number) => seededRand(seed * 7 + n);
  const isHome = r(0) > 0.5;
  const playStyle = r(1);
  const endsInShot = r(2) < 0.30;
  const willIntercept = !endsInShot && r(3) < 0.18; // pass gets stolen

  let route: number[];
  if (playStyle < 0.18) {
    route = isHome ? [0, 2, 6, 9, 10] : [0, 3, 7, 10, 9];
  } else if (playStyle < 0.36) {
    route = isHome ? [3, 7, 10] : [2, 6, 9];
  } else if (playStyle < 0.54) {
    route = isHome ? [1, 5, 8, 9] : [4, 8, 5, 10];
  } else if (playStyle < 0.72) {
    route = isHome ? [6, 7, 5, 9] : [7, 6, 8, 10];
  } else if (playStyle < 0.88) {
    route = isHome ? [3, 2, 6, 5, 7] : [2, 3, 7, 6, 8];
  } else {
    // Long ball forward
    route = isHome ? [0, 9] : [0, 10];
  }

  const phases: PassPhase[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const distance = Math.abs(route[i + 1] - route[i]);
    const longBall = distance >= 4 || r(i + 5) < 0.15;
    const isLastPass = i === route.length - 2;
    phases.push({
      passerIdx: route[i],
      receiverIdx: route[i + 1],
      attackingHome: isHome,
      duration: longBall ? 70 + r(i + 10) * 25 : 42 + r(i + 11) * 20,
      hold: isLastPass ? 18 + r(i + 12) * 18 : 26 + r(i + 12) * 30,
      arc: longBall ? 0.55 + r(i + 13) * 0.4 : r(i + 13) * 0.18,
      intercepted: willIntercept && i === route.length - 2, // last pass gets stolen
    });
  }
  return { phases, endsInShot };
}

export default function PitchCanvas(props: Props) {
  const { minute, homeColor, awayColor, homeTeamId, flashEvent, allEvents, halftime } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const ballPos = useRef({ x: 0.5, y: 0.5 });
  const ballHistory = useRef<{ x: number; y: number }[]>([]);
  const goalCelebFrame = useRef(0);
  const cameraShakeRef = useRef(0);
  const flashWhiteRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);

  // Per-player live positions (smoothed) — 22 players (11 home + 11 away)
  const playerPosRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; sprintT: number }>>(
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
  liveRef.current = { minute, homeColor, awayColor, homeTeamId, allEvents, halftime, targetShift };

  // Goal-trigger effect: fires once per new flashEvent (goal/penalty_goal).
  // Spawns particles + camera shake. Does NOT restart the rAF loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const isGoal = flashEvent && (flashEvent.type === 'goal' || flashEvent.type === 'penalty_goal');
    if (!isGoal) return;
    const W = canvas.width, H = canvas.height;
    const P = 10;
    const fw = W - P * 2;
    goalCelebFrame.current = 110;
    cameraShakeRef.current = 35;
    flashWhiteRef.current = 12;
    const evIsHome = flashEvent.teamId === homeTeamId;
    const goalColor = evIsHome ? homeColor : awayColor;
    const goalX = P + (evIsHome ? 0.97 : 0.03) * fw;
    const goalY = H / 2;
    // Inline particle spawn (kept here so the trigger effect is self-contained)
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 2 + Math.random() * 4;
      particlesRef.current.push({
        x: goalX, y: goalY,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1,
        life: 70 + Math.random() * 30, maxLife: 90,
        color: goalColor, size: 1.5 + Math.random() * 2, gravity: 0.08,
      });
    }
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      particlesRef.current.push({
        x: goalX, y: goalY,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5,
        life: 40 + Math.random() * 25, maxLife: 60,
        color: '#ffffff', size: 0.8 + Math.random() * 1.2, gravity: 0.1,
      });
    }
    for (let i = 0; i < 22; i++) {
      const startX = goalX + (Math.random() - 0.5) * 80;
      const startY = goalY - 30 - Math.random() * 60;
      particlesRef.current.push({
        x: startX, y: startY,
        vx: (Math.random() - 0.5) * 1.5, vy: 0.5 + Math.random() * 1.5,
        life: 100 + Math.random() * 50, maxLife: 140,
        color: Math.random() > 0.5 ? goalColor : '#fbbf24',
        size: 1.2 + Math.random() * 1.2, gravity: 0.04,
      });
    }
  }, [flashEvent, homeTeamId, homeColor, awayColor]);

  // Main rAF loop — starts once on mount, reads from liveRef. No restarts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const P = 10;
    const fw = W - P * 2, fh = H - P * 2;

    function spawnTackleSparks(cx: number, cy: number) {
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 2;
        particlesRef.current.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.5,
          life: 20 + Math.random() * 15,
          maxLife: 30,
          color: '#ffffff',
          size: 0.7 + Math.random() * 0.8,
          gravity: 0.15,
        });
      }
    }

    function spawnGrassKick(cx: number, cy: number, dx: number, dy: number) {
      // Small grass particles when ball is kicked
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      for (let i = 0; i < 5; i++) {
        const spread = (Math.random() - 0.5) * 0.6;
        particlesRef.current.push({
          x: cx, y: cy + 2,
          vx: -nx * (0.5 + Math.random()) + spread,
          vy: -ny * (0.5 + Math.random()) - 0.3,
          life: 12 + Math.random() * 8,
          maxLife: 18,
          color: '#5a7a3e',
          size: 0.6 + Math.random() * 0.5,
          gravity: 0.18,
        });
      }
    }

    function getBaseSlot(formIdx: number, isHomeTeam: boolean): { x: number; y: number; role: Role } {
      const base = BASE_FORMATION[formIdx];
      const s = isHomeTeam ? shiftRef.current : -shiftRef.current;
      const bx = isHomeTeam ? base.x + s : 1 - base.x - s;
      return { x: clamp(bx, 0.03, 0.97), y: base.y, role: base.role };
    }

    // Bootstrap sequence if empty
    if (sequenceRef.current.length === 0) {
      sequenceSeedRef.current = liveRef.current.minute * 137 + frameRef.current;
      const gen = generateSequence(sequenceSeedRef.current);
      sequenceRef.current = gen.phases;
      phaseIdxRef.current = 0;
      phaseFrameRef.current = 0;
      phaseStateRef.current = 'passing';
      interceptedRef.current = false;
      const firstPhase = sequenceRef.current[0];
      const passerSlot = getBaseSlot(firstPhase.passerIdx, firstPhase.attackingHome);
      ballSourceRef.current = { x: P + passerSlot.x * fw, y: P + passerSlot.y * fh };
      ballPos.current = { ...ballSourceRef.current };
    }

    function render() {
      frameRef.current++;
      const f = frameRef.current;
      // Read live props from ref (no closure capture → no rAF restart on prop change)
      const live = liveRef.current;
      const minute = live.minute;
      const homeColor = live.homeColor;
      const awayColor = live.awayColor;
      const homeTeamId = live.homeTeamId;
      const allEvents = live.allEvents;
      const halftime = live.halftime;
      const targetShift = live.targetShift;

      // Camera shake
      let camOffX = 0, camOffY = 0;
      if (cameraShakeRef.current > 0) {
        const shakeT = cameraShakeRef.current / 35;
        camOffX = (Math.random() - 0.5) * 4 * shakeT;
        camOffY = (Math.random() - 0.5) * 4 * shakeT;
        cameraShakeRef.current--;
      }

      ctx.save();
      ctx.translate(camOffX, camOffY);
      ctx.clearRect(-camOffX, -camOffY, W, H);

      shiftRef.current = lerp(shiftRef.current, targetShift, 0.03);

      // ── Grass with subtle gradient ──
      ctx.fillStyle = '#1a472a';
      ctx.fillRect(0, 0, W, H);
      const sw = fw / 12;
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#1d5231' : '#1a472a';
        ctx.fillRect(P + i * sw, P, sw, fh);
      }
      // Subtle vignette
      const vignette = ctx.createRadialGradient(W / 2, H / 2, fh * 0.3, W / 2, H / 2, fh * 0.9);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);

      // ── Pitch lines ──
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(P, P, fw, fh);
      ctx.beginPath(); ctx.moveTo(W / 2, P); ctx.lineTo(W / 2, H - P); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, fh * 0.16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      const paW = fw * 0.14, paH = fh * 0.52, paY = (H - paH) / 2;
      ctx.strokeRect(P, paY, paW, paH);
      ctx.strokeRect(W - P - paW, paY, paW, paH);
      const gaW = fw * 0.05, gaH = fh * 0.26, gaY = (H - gaH) / 2;
      ctx.strokeRect(P, gaY, gaW, gaH);
      ctx.strokeRect(W - P - gaW, gaY, gaW, gaH);
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      const gH = fh * 0.14, gY = (H - gH) / 2;
      ctx.strokeRect(P - 6, gY, 6, gH);
      ctx.strokeRect(W - P, gY, 6, gH);
      ctx.lineWidth = 0.4; ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 5; i++) {
        const ny = gY + i * gH / 4;
        ctx.beginPath(); ctx.moveTo(P - 6, ny); ctx.lineTo(P, ny); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W - P, ny); ctx.lineTo(W - P + 6, ny); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.arc(P + fw * 0.1, H / 2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W - P - fw * 0.1, H / 2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      for (const [cx, cy, sa, ea] of [[P, P, 0, Math.PI / 2], [W - P, P, Math.PI / 2, Math.PI], [P, H - P, -Math.PI / 2, 0], [W - P, H - P, Math.PI, Math.PI * 1.5]] as const) {
        ctx.beginPath(); ctx.arc(cx, cy, 8, sa, ea); ctx.stroke();
      }

      if (halftime) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('中场休息', W / 2, H / 2 - 4);
        ctx.font = '11px sans-serif'; ctx.fillStyle = '#94a3b8';
        ctx.fillText('HALF TIME', W / 2, H / 2 + 14);
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
        const first = sequenceRef.current[0];
        const passerSlot = getBaseSlot(first.passerIdx, first.attackingHome);
        ballSourceRef.current = { x: P + passerSlot.x * fw, y: P + passerSlot.y * fh };
      } else {
        phaseFrameRef.current++;
        if (phaseStateRef.current === 'passing') {
          // Check for interception mid-pass
          if (phase.intercepted && phaseFrameRef.current >= phase.duration * 0.55 && !interceptedRef.current) {
            interceptedRef.current = true;
            spawnTackleSparks(ballPos.current.x, ballPos.current.y);
            cameraShakeRef.current = Math.max(cameraShakeRef.current, 8);
            // Truncate sequence and trigger possession swap on next gen
            sequenceRef.current = sequenceRef.current.slice(0, phaseIdxRef.current + 1);
          }
          if (phaseFrameRef.current >= phase.duration) {
            phaseStateRef.current = 'holding';
            phaseFrameRef.current = 0;
            // Ball arrival = grass kick effect
            spawnGrassKick(ballPos.current.x, ballPos.current.y, 0, 1);
          }
        } else if (phaseStateRef.current === 'holding' && phaseFrameRef.current >= phase.hold) {
          phaseIdxRef.current++;
          phaseFrameRef.current = 0;
          phaseStateRef.current = 'passing';
          const newPhase = sequenceRef.current[phaseIdxRef.current];
          if (newPhase) {
            const passerSlot = getBaseSlot(newPhase.passerIdx, newPhase.attackingHome);
            ballSourceRef.current = { x: P + passerSlot.x * fw, y: P + passerSlot.y * fh };
            // Grass kick on pass start
            const recvSlot = getBaseSlot(newPhase.receiverIdx, newPhase.attackingHome);
            const dx = recvSlot.x - passerSlot.x, dy = recvSlot.y - passerSlot.y;
            spawnGrassKick(ballSourceRef.current.x, ballSourceRef.current.y, dx, dy);
          }
        }
      }

      const currentPhase = sequenceRef.current[phaseIdxRef.current] ?? sequenceRef.current[sequenceRef.current.length - 1];
      const isAttHome = currentPhase.attackingHome;
      const receiverSlot = getBaseSlot(currentPhase.receiverIdx, isAttHome);
      const targetX = P + receiverSlot.x * fw;
      const targetY = P + receiverSlot.y * fh;

      // Special events override target
      const nearEvent = allEvents.find(e => Math.abs(e.minute - minute) <= 1);
      let overrideTarget: { x: number; y: number } | null = null;
      if (nearEvent) {
        const evIsHome = nearEvent.teamId === homeTeamId;
        if (nearEvent.type === 'goal' || nearEvent.type === 'penalty_goal') {
          overrideTarget = {
            x: P + (evIsHome ? 0.97 : 0.03) * fw,
            y: P + (0.42 + seededRand(minute * 7) * 0.16) * fh,
          };
        } else if (nearEvent.type === 'save') {
          overrideTarget = {
            x: P + (evIsHome ? 0.94 : 0.06) * fw,
            y: P + (0.4 + seededRand(minute * 11) * 0.2) * fh,
          };
        }
      }

      const finalTargetX = overrideTarget?.x ?? targetX;
      const finalTargetY = overrideTarget?.y ?? targetY;

      let bx: number, by: number;
      if (phaseStateRef.current === 'passing') {
        const t = Math.min(1, phaseFrameRef.current / currentPhase.duration);
        const eased = easeInOutQuad(t);
        bx = lerp(ballSourceRef.current.x, finalTargetX, eased);
        by = lerp(ballSourceRef.current.y, finalTargetY, eased);
        ballArcLiftRef.current = Math.sin(t * Math.PI) * currentPhase.arc * 22;
        by -= ballArcLiftRef.current;
        // Ball spin proportional to speed
        ballSpinRef.current += 0.4 + currentPhase.arc * 0.3;
      } else {
        // Holding — ball gently drifts near holder, with foot tap micro-motion
        const microJ = Math.sin(f * 0.18) * 0.5;
        bx = finalTargetX + microJ;
        by = finalTargetY + Math.cos(f * 0.18) * 0.3;
        ballArcLiftRef.current = 0;
        ballSpinRef.current += 0.05;
      }

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

      // Normalize ball position to 0-1 for AI calcs
      const ballNX = (bx - P) / fw;
      const ballNY = (by - P) / fh;

      for (let i = 0; i < 22; i++) {
        const isHomeTeam = i < 11;
        const formIdx = i % 11;
        const isHolder = (isHomeTeam ? ballHolderTeamSide === 'home' : ballHolderTeamSide === 'away') && formIdx === ballHolderIdx;
        const isReceiver = (isHomeTeam ? ballHolderTeamSide === 'home' : ballHolderTeamSide === 'away')
          && formIdx === currentPhase.receiverIdx
          && phaseStateRef.current === 'passing';
        const teamHasBall = (isHomeTeam && isAttHome) || (!isHomeTeam && !isAttHome);

        const slot = getBaseSlot(formIdx, isHomeTeam);
        let targetX_n = slot.x;
        let targetY_n = slot.y;

        // ── Tactical adjustments ──
        if (isHolder) {
          // Ball holder moves slightly with ball
          targetX_n = ballNX;
          targetY_n = ballNY + 0.01;
        } else if (isReceiver) {
          // Receiver runs to meet incoming pass — move toward where ball will be
          const meetingT = 0.7;
          targetX_n = lerp(slot.x, ballNX, meetingT);
          targetY_n = lerp(slot.y, ballNY, meetingT);
        } else if (teamHasBall) {
          // Team in possession: shift toward attacking direction
          const attackDir = isHomeTeam ? 1 : -1;
          const advance = 0.04 + (slot.role === 'FW' ? 0.05 : slot.role === 'MF' ? 0.03 : slot.role === 'DF' ? 0.015 : 0);
          targetX_n = slot.x + advance * attackDir;
          // Wide players adjust based on ball lateral position
          if (Math.abs(slot.y - 0.5) > 0.25) {
            // Slight pinch toward middle if ball is central
            const ballSide = ballNY < 0.5 ? -1 : 1;
            const slotSide = slot.y < 0.5 ? -1 : 1;
            if (ballSide !== slotSide) {
              targetY_n = slot.y + (0.5 - slot.y) * 0.15; // pinch in
            }
          }
        } else {
          // Defending team: closest 2 defenders pressure ball, others compress toward ball side
          const defenderDist = dist(slot.x, slot.y, ballNX, ballNY);
          if (defenderDist < 0.18 && slot.role !== 'GK') {
            // Press ball — move toward holder
            const pressT = 0.55;
            targetX_n = lerp(slot.x, ballNX, pressT);
            targetY_n = lerp(slot.y, ballNY, pressT);
            playerPosRef.current[i].sprintT = 1;
          } else if (slot.role !== 'GK') {
            // Compress — drift slightly toward ball lateral position
            const lateralPull = 0.08;
            targetY_n = lerp(slot.y, ballNY, lateralPull);
            // Defensive line drops if ball is in own half
            const ownHalf = isHomeTeam ? ballNX < 0.5 : ballNX > 0.5;
            if (ownHalf) {
              const drop = isHomeTeam ? -0.025 : 0.025;
              targetX_n = slot.x + drop;
            }
          }
          // GK tracks ball laterally, narrow range
          if (slot.role === 'GK') {
            targetY_n = clamp(0.5 + (ballNY - 0.5) * 0.3, 0.42, 0.58);
          }
        }

        // Goal scoring event — attackers swarm toward goal
        if (overrideTarget && teamHasBall && slot.role === 'FW' && !isHolder) {
          targetX_n = (overrideTarget.x - P) / fw + (Math.random() - 0.5) * 0.04;
          targetY_n = (overrideTarget.y - P) / fh + (Math.random() - 0.5) * 0.06;
        }

        targetX_n = clamp(targetX_n, 0.03, 0.97);
        targetY_n = clamp(targetY_n, 0.05, 0.95);

        // Smooth approach — sprinters accelerate faster
        const p = playerPosRef.current[i];
        const sprintBoost = 1 + p.sprintT * 0.6;
        const ax = (targetX_n - p.x) * 0.06 * sprintBoost;
        const ay = (targetY_n - p.y) * 0.06 * sprintBoost;
        p.vx = p.vx * 0.7 + ax;
        p.vy = p.vy * 0.7 + ay;
        p.x += p.vx;
        p.y += p.vy;
        p.sprintT *= 0.95; // sprint decays
      }

      // ── Draw players ──
      function drawPlayer(p: { x: number; y: number; vx: number; vy: number; sprintT: number }, color: string, num: number, hasBall: boolean) {
        const px = P + p.x * fw;
        const py = P + p.y * fh;
        const speed = Math.hypot(p.vx, p.vy);
        const isMoving = speed > 0.003;

        // Motion trail when sprinting
        if (isMoving && speed > 0.006) {
          const dirX = p.vx / speed;
          const dirY = p.vy / speed;
          for (let t = 1; t <= 3; t++) {
            const tx = px - dirX * t * 5 * fw * 0.012;
            const ty = py - dirY * t * 5 * fh * 0.022;
            ctx.beginPath(); ctx.arc(tx, ty, 5 - t * 0.8, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.18 - t * 0.04;
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Soft shadow
        ctx.beginPath(); ctx.ellipse(px, py + 5, 5, 1.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();

        // Ball-holder ring
        if (hasBall) {
          const pulse = 1 + Math.sin(f * 0.18) * 0.15;
          ctx.beginPath(); ctx.arc(px, py, 9 * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.3; ctx.stroke();
        }

        // Body
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();

        ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(num), px, py + 2.2);
      }

      // Draw home team
      for (let i = 0; i < 11; i++) {
        const hasBall = isAttHome && i === ballHolderIdx;
        drawPlayer(playerPosRef.current[i], homeColor, i === 0 ? 1 : i + 1, hasBall);
      }
      // Draw away team
      for (let i = 11; i < 22; i++) {
        const formIdx = i - 11;
        const hasBall = !isAttHome && formIdx === ballHolderIdx;
        drawPlayer(playerPosRef.current[i], awayColor, formIdx === 0 ? 1 : formIdx + 1, hasBall);
      }

      // ── Particles update + draw ──
      const livePtcls: Particle[] = [];
      for (const ptcl of particlesRef.current) {
        ptcl.life--;
        if (ptcl.life <= 0) continue;
        ptcl.vy += ptcl.gravity;
        ptcl.x += ptcl.vx;
        ptcl.y += ptcl.vy;
        const a = ptcl.life / ptcl.maxLife;
        ctx.beginPath();
        ctx.arc(ptcl.x, ptcl.y, ptcl.size, 0, Math.PI * 2);
        ctx.fillStyle = ptcl.color;
        ctx.globalAlpha = Math.min(1, a * 1.2);
        ctx.fill();
        ctx.globalAlpha = 1;
        livePtcls.push(ptcl);
      }
      particlesRef.current = livePtcls;

      // ── Ball trail ──
      const bHist = ballHistory.current;
      for (let i = 0; i < bHist.length - 1; i++) {
        const a = (i / bHist.length) * 0.35;
        const r = 1 + (i / bHist.length) * 1.8;
        ctx.beginPath(); ctx.arc(bHist[i].x, bHist[i].y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill();
      }

      // ── Goal celebration ring + net ripple ──
      if (goalCelebFrame.current > 0) {
        goalCelebFrame.current--;
        const t = 1 - goalCelebFrame.current / 110;
        // Multi-ring expanding
        for (let k = 0; k < 3; k++) {
          const ringT = (t + k * 0.18) % 1;
          if (ringT > 0.95) continue;
          const gr = 8 + ringT * 70;
          const ga = (1 - ringT) * 0.5;
          ctx.beginPath(); ctx.arc(bx, by, gr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(250,204,21,${ga})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        // Center glow
        const ga = (1 - t) * 0.55;
        const gr = 14 + t * 24;
        const grad = ctx.createRadialGradient(bx, by, 2, bx, by, gr);
        grad.addColorStop(0, `rgba(250,204,21,${ga})`);
        grad.addColorStop(1, 'rgba(250,204,21,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(bx, by, gr, 0, Math.PI * 2); ctx.fill();

        // Net ripple
        const isRightGoal = nearEvent?.teamId === homeTeamId;
        const netX = isRightGoal ? W - P : P;
        const rippleA = (1 - t) * 0.7;
        ctx.strokeStyle = `rgba(250,204,21,${rippleA})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const ny = gY + i * gH / 5 + Math.sin(t * 8 + i) * 1.5;
          ctx.beginPath();
          ctx.moveTo(netX, ny);
          ctx.lineTo(netX + (isRightGoal ? 5 : -5), ny);
          ctx.stroke();
        }
      }

      // ── Ball ──
      const shadowOffset = ballArcLiftRef.current * 0.5;
      const shadowSpread = 1 + ballArcLiftRef.current * 0.05;
      ctx.beginPath();
      ctx.ellipse(bx + shadowOffset * 0.3, by + 4 + ballArcLiftRef.current * 0.6, 4 / shadowSpread, 1.5 / shadowSpread, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${0.3 / shadowSpread})`; ctx.fill();
      // Ball with pentagon panel rotation
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(ballSpinRef.current * 0.15);
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = '#bbb'; ctx.lineWidth = 0.5; ctx.stroke();
      // Pentagonal panel detail
      ctx.fillStyle = '#1f2937';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const r = 1.4;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.beginPath(); ctx.arc(-0.8, -0.8, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      ctx.restore();

      ctx.restore();

      // ── White flash on goal ──
      if (flashWhiteRef.current > 0) {
        const fa = flashWhiteRef.current / 12;
        ctx.fillStyle = `rgba(255,255,255,${fa * 0.45})`;
        ctx.fillRect(0, 0, W, H);
        flashWhiteRef.current--;
      }

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
