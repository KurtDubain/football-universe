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
  { x: 0.07, y: 0.5, role: 'GK' },
  { x: 0.22, y: 0.13, role: 'DF' }, { x: 0.20, y: 0.37, role: 'DF' },
  { x: 0.20, y: 0.63, role: 'DF' }, { x: 0.22, y: 0.87, role: 'DF' },
  { x: 0.38, y: 0.15, role: 'MF' }, { x: 0.35, y: 0.40, role: 'MF' },
  { x: 0.35, y: 0.60, role: 'MF' }, { x: 0.38, y: 0.85, role: 'MF' },
  { x: 0.50, y: 0.35, role: 'FW' }, { x: 0.50, y: 0.65, role: 'FW' },
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function easeInOutQuad(t: number) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function seededRand(seed: number) { return ((Math.sin(seed * 9301 + 49297) % 1) + 1) % 1; }

interface PassPhase {
  passerIdx: number;
  receiverIdx: number;
  attackingHome: boolean;
  duration: number; // frames the ball spends being passed
  hold: number;     // frames the ball "rests" with receiver before next pass
  arc: number;      // height of pass arc (0 = ground pass, 1 = lobbed)
}

/**
 * Generate a realistic possession sequence: 3-6 passes ending in either
 * shot, lost possession, or recycle. Each phase has natural pacing.
 */
function generateSequence(seed: number): PassPhase[] {
  const r = (n: number) => seededRand(seed * 7 + n);
  const isHome = r(0) > 0.5;
  const playStyle = r(1);

  let route: number[];
  if (playStyle < 0.2) {
    // Build-up from back: GK → CB → MF → FW
    route = isHome ? [0, 2, 6, 9, 10] : [0, 3, 7, 10, 9];
  } else if (playStyle < 0.4) {
    // Quick counter
    route = isHome ? [3, 7, 10] : [2, 6, 9];
  } else if (playStyle < 0.6) {
    // Wing play
    route = isHome ? [1, 5, 8, 9] : [4, 8, 5, 10];
  } else if (playStyle < 0.8) {
    // Through center
    route = isHome ? [6, 7, 5, 9] : [7, 6, 8, 10];
  } else {
    // Defensive recycling
    route = isHome ? [3, 2, 6, 5, 7] : [2, 3, 7, 6, 8];
  }

  const phases: PassPhase[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const distance = Math.abs(route[i + 1] - route[i]);
    const longBall = distance >= 4 || r(i + 5) < 0.15;
    phases.push({
      passerIdx: route[i],
      receiverIdx: route[i + 1],
      attackingHome: isHome,
      duration: longBall ? 75 + r(i + 10) * 25 : 45 + r(i + 11) * 20, // 0.75-1.6s at 60fps
      hold: 30 + r(i + 12) * 40,                                       // 0.5-1.2s rest
      arc: longBall ? 0.5 + r(i + 13) * 0.4 : r(i + 13) * 0.15,
    });
  }
  return phases;
}

export default function PitchCanvas(props: Props) {
  const { minute, homeColor, awayColor, homeTeamId, flashEvent, allEvents, halftime } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const ballPos = useRef({ x: 0.5, y: 0.5 });
  const ballHistory = useRef<{ x: number; y: number }[]>([]);
  const goalCelebFrame = useRef(0);

  // Sequence state — persisted across renders
  const sequenceRef = useRef<PassPhase[]>([]);
  const phaseIdxRef = useRef(0);
  const phaseFrameRef = useRef(0);
  const phaseStateRef = useRef<'passing' | 'holding'>('passing');
  const sequenceSeedRef = useRef(0);
  const ballSourceRef = useRef({ x: 0.5, y: 0.5 });
  const ballArcLiftRef = useRef(0);

  const isGoalEvent = flashEvent && (flashEvent.type === 'goal' || flashEvent.type === 'penalty_goal');

  const attackSide = useMemo(() => {
    const ev = allEvents.find(e => Math.abs(e.minute - minute) <= 2);
    if (ev) return ev.teamId === homeTeamId ? 'home' : 'away';
    return seededRand(minute * 31) > 0.45 ? 'home' : 'away';
  }, [minute, allEvents, homeTeamId]);

  // Formation drifts smoothly between possession states
  const targetShift = useMemo(() => {
    const ev = allEvents.find(e => Math.abs(e.minute - minute) <= 2);
    if (!ev) return attackSide === 'home' ? 0.04 : -0.04;
    return ev.teamId === homeTeamId ? 0.07 : -0.07;
  }, [minute, allEvents, homeTeamId, attackSide]);

  const shiftRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const P = 10;
    const fw = W - P * 2, fh = H - P * 2;

    if (isGoalEvent) goalCelebFrame.current = 90;

    function getPlayerPos(formIdx: number, isHomeTeam: boolean): { x: number; y: number } {
      const base = BASE_FORMATION[formIdx];
      const s = isHomeTeam ? shiftRef.current : -shiftRef.current;
      const bx = isHomeTeam ? base.x + s : 1 - base.x - s;
      return {
        x: clamp(bx, 0.03, 0.97),
        y: base.y,
      };
    }

    // Bootstrap sequence if empty
    if (sequenceRef.current.length === 0) {
      sequenceSeedRef.current = minute * 137 + frameRef.current;
      sequenceRef.current = generateSequence(sequenceSeedRef.current);
      phaseIdxRef.current = 0;
      phaseFrameRef.current = 0;
      phaseStateRef.current = 'passing';
      const firstPhase = sequenceRef.current[0];
      const passerPos = getPlayerPos(firstPhase.passerIdx, firstPhase.attackingHome);
      ballSourceRef.current = { x: P + passerPos.x * fw, y: P + passerPos.y * fh };
      ballPos.current = { ...ballSourceRef.current };
    }

    function render() {
      frameRef.current++;
      const f = frameRef.current;
      ctx.clearRect(0, 0, W, H);

      // Smooth shift toward target (formation drift)
      shiftRef.current = lerp(shiftRef.current, targetShift, 0.03);

      // ── Grass ──
      ctx.fillStyle = '#1a472a';
      ctx.fillRect(0, 0, W, H);
      const sw = fw / 12;
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#1d5231' : '#1a472a';
        ctx.fillRect(P + i * sw, P, sw, fh);
      }

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
        raf = requestAnimationFrame(render);
        return;
      }

      // ── Sequence advancement ──
      const phase = sequenceRef.current[phaseIdxRef.current];
      if (!phase) {
        // Generate new sequence
        sequenceSeedRef.current += 1;
        sequenceRef.current = generateSequence(sequenceSeedRef.current);
        phaseIdxRef.current = 0;
        phaseFrameRef.current = 0;
        phaseStateRef.current = 'passing';
        const first = sequenceRef.current[0];
        const passerPos = getPlayerPos(first.passerIdx, first.attackingHome);
        ballSourceRef.current = { x: P + passerPos.x * fw, y: P + passerPos.y * fh };
      } else {
        phaseFrameRef.current++;
        if (phaseStateRef.current === 'passing' && phaseFrameRef.current >= phase.duration) {
          phaseStateRef.current = 'holding';
          phaseFrameRef.current = 0;
        } else if (phaseStateRef.current === 'holding' && phaseFrameRef.current >= phase.hold) {
          phaseIdxRef.current++;
          phaseFrameRef.current = 0;
          phaseStateRef.current = 'passing';
          const newPhase = sequenceRef.current[phaseIdxRef.current];
          if (newPhase) {
            const passerPos = getPlayerPos(newPhase.passerIdx, newPhase.attackingHome);
            ballSourceRef.current = { x: P + passerPos.x * fw, y: P + passerPos.y * fh };
          }
        }
      }

      // ── Compute ball position ──
      const currentPhase = sequenceRef.current[phaseIdxRef.current] ?? sequenceRef.current[sequenceRef.current.length - 1];
      const isAttHome = currentPhase.attackingHome;
      const receiverPos = getPlayerPos(currentPhase.receiverIdx, isAttHome);
      const targetX = P + receiverPos.x * fw;
      const targetY = P + receiverPos.y * fh;

      // Special events override target — ball flies into goal/save
      const nearEvent = allEvents.find(e => Math.abs(e.minute - minute) <= 1);
      let overrideTarget: { x: number; y: number } | null = null;
      if (nearEvent) {
        const evIsHome = nearEvent.teamId === homeTeamId;
        if (nearEvent.type === 'goal' || nearEvent.type === 'penalty_goal') {
          overrideTarget = {
            x: P + (evIsHome ? 0.97 : 0.03) * fw,
            y: P + (0.45 + seededRand(minute * 7) * 0.1) * fh,
          };
        } else if (nearEvent.type === 'save') {
          overrideTarget = {
            x: P + (evIsHome ? 0.95 : 0.05) * fw,
            y: P + 0.5 * fh,
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
        // Arc lift (sin curve peaks at t=0.5)
        ballArcLiftRef.current = Math.sin(t * Math.PI) * currentPhase.arc * 18;
        by -= ballArcLiftRef.current;
      } else {
        // Holding — ball gently drifts/idles near receiver
        const microJ = Math.sin(f * 0.08) * 0.3;
        bx = finalTargetX + microJ;
        by = finalTargetY + microJ;
        ballArcLiftRef.current = 0;
      }

      ballPos.current.x = bx;
      ballPos.current.y = by;

      // Ball history (less aggressive, longer trail for moving ball)
      if (phaseStateRef.current === 'passing' && f % 2 === 0) {
        ballHistory.current.push({ x: bx, y: by });
        if (ballHistory.current.length > 8) ballHistory.current.shift();
      } else if (ballHistory.current.length > 0 && f % 3 === 0) {
        ballHistory.current.shift(); // fade out trail when ball stops
      }

      // ── Draw players ──
      function drawPlayer(fx: number, fy: number, color: string, num: number, hasBall: boolean, isMoving: boolean) {
        // VERY subtle breathing motion only — not constant jitter
        const breath = Math.sin(f * 0.03 + fx * 20 + fy * 20) * 0.4;
        const px = P + fx * fw;
        const py = P + fy * fh + breath;

        // Movement blur if running toward ball
        if (isMoving) {
          const trailA = 0.15;
          const angle = Math.atan2(by - py, bx - px);
          const tx = px - Math.cos(angle) * 4;
          const ty = py - Math.sin(angle) * 4;
          ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2);
          ctx.fillStyle = color.replace(')', `, ${trailA})`).replace('rgb', 'rgba');
          ctx.fillStyle = color; ctx.globalAlpha = trailA; ctx.fill(); ctx.globalAlpha = 1;
        }

        // Shadow
        ctx.beginPath(); ctx.ellipse(px, py + 5, 5, 1.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();

        // Highlight ring if has ball
        if (hasBall) {
          ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
        }

        // Body
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();

        ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(num), px, py + 2.2);
      }

      // Determine which player "has the ball" (the receiver during hold, passer during pass)
      const ballHolderIdx = phaseStateRef.current === 'holding' ? currentPhase.receiverIdx : currentPhase.passerIdx;

      // Determine which players are "running toward play" (closest few of attacking side)
      const runningPlayers = new Set<number>();
      if (phaseStateRef.current === 'passing') {
        runningPlayers.add(currentPhase.receiverIdx);
      }

      BASE_FORMATION.forEach((_, i) => {
        const pos = getPlayerPos(i, true);
        const hasBall = isAttHome && i === ballHolderIdx;
        const isMoving = isAttHome && runningPlayers.has(i);
        drawPlayer(pos.x, pos.y, homeColor, i === 0 ? 1 : i + 1, hasBall, isMoving);
      });
      BASE_FORMATION.forEach((_, i) => {
        const pos = getPlayerPos(i, false);
        const hasBall = !isAttHome && i === ballHolderIdx;
        const isMoving = !isAttHome && runningPlayers.has(i);
        drawPlayer(pos.x, pos.y, awayColor, i === 0 ? 1 : i + 1, hasBall, isMoving);
      });

      // ── Ball trail (subtle motion blur) ──
      const bHist = ballHistory.current;
      for (let i = 0; i < bHist.length - 1; i++) {
        const a = (i / bHist.length) * 0.25;
        const r = 1 + (i / bHist.length) * 1.2;
        ctx.beginPath(); ctx.arc(bHist[i].x, bHist[i].y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill();
      }

      // ── Goal celebration ──
      if (goalCelebFrame.current > 0) {
        goalCelebFrame.current--;
        const t = 1 - goalCelebFrame.current / 90;
        const gr = 10 + t * 60;
        const ga = (1 - t) * 0.6;
        ctx.beginPath(); ctx.arc(bx, by, gr, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(bx, by, 2, bx, by, gr);
        grad.addColorStop(0, `rgba(250,204,21,${ga})`);
        grad.addColorStop(1, 'rgba(250,204,21,0)');
        ctx.fillStyle = grad; ctx.fill();

        const shakeX = Math.sin(f * 0.3) * 2 * (1 - t);
        const isRightGoal = nearEvent?.teamId === homeTeamId;
        ctx.strokeStyle = `rgba(250,204,21,${0.5 * (1 - t)})`; ctx.lineWidth = 1;
        const netX = isRightGoal ? W - P + shakeX : P + shakeX;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(netX, gY + i * gH / 3);
          ctx.lineTo(netX + (isRightGoal ? 5 : -5), gY + i * gH / 3);
          ctx.stroke();
        }
      }

      // ── Ball ──
      // Shadow scales with arc lift
      const shadowOffset = ballArcLiftRef.current * 0.5;
      const shadowSpread = 1 + ballArcLiftRef.current * 0.05;
      ctx.beginPath();
      ctx.ellipse(bx + shadowOffset * 0.3, by + 4 + ballArcLiftRef.current * 0.6, 4 / shadowSpread, 1.5 / shadowSpread, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${0.3 / shadowSpread})`; ctx.fill();
      // Ball
      ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = '#bbb'; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(bx - 0.8, by - 0.8, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = '#ddd'; ctx.fill();

      raf = requestAnimationFrame(render);
    }

    let raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute, flashEvent, halftime, homeColor, awayColor, attackSide, allEvents, homeTeamId]);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={280}
      className="w-full rounded-xl border border-emerald-900/30"
    />
  );
}
