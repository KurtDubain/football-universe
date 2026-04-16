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

// 4-4-2 formation positions (normalized 0-1)
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

// Seeded pseudo-random for deterministic "play sequences"
function seededRand(seed: number) { return ((Math.sin(seed * 9301 + 49297) % 1) + 1) % 1; }

/**
 * Generate a sequence of "possession phases" for a given minute.
 * Each phase is a target player index that the ball moves to.
 * This creates realistic pass sequences: GK→DF→MF→FW patterns.
 */
function generatePlaySequence(minute: number, isHomeAttacking: boolean): number[] {
  const seed = minute * 137;
  const r = seededRand(seed);

  // Different play patterns
  if (r < 0.25) {
    // Build-up from back: GK → DF → MF → FW
    return isHomeAttacking ? [0, 2, 6, 9] : [0, 3, 7, 10];
  } else if (r < 0.45) {
    // Quick counter: MF → FW directly
    return isHomeAttacking ? [5, 9, 10] : [7, 10, 9];
  } else if (r < 0.65) {
    // Wing play: DF → MF(wide) → cross to FW
    return isHomeAttacking ? [1, 5, 9] : [4, 8, 10];
  } else if (r < 0.8) {
    // Central play: MF → MF → FW
    return isHomeAttacking ? [6, 7, 10] : [6, 5, 9];
  } else {
    // Defensive recycling: DF → DF → MF
    return isHomeAttacking ? [2, 3, 6] : [3, 2, 7];
  }
}

export default function PitchCanvas(props: Props) {
  const { minute, maxMinute, homeColor, awayColor, homeTeamId, flashEvent, allEvents, finished, halftime } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const ballPos = useRef({ x: 0.5, y: 0.5 });
  const ballHistory = useRef<{ x: number; y: number }[]>([]);
  const goalCelebFrame = useRef(0);
  const currentPassTarget = useRef(0); // index in play sequence
  const playSequence = useRef<number[]>([]);
  const passTimer = useRef(0);
  const attackingTeam = useRef<'home' | 'away'>('home');

  const isGoalEvent = flashEvent && (flashEvent.type === 'goal' || flashEvent.type === 'penalty_goal');

  // Determine which team is "attacking" this phase
  const attackSide = useMemo(() => {
    const ev = allEvents.find(e => Math.abs(e.minute - minute) <= 2);
    if (ev) return ev.teamId === homeTeamId ? 'home' : 'away';
    // Alternate based on minute for variety
    return seededRand(minute * 31) > 0.45 ? 'home' : 'away';
  }, [minute, allEvents, homeTeamId]);

  // Formation shift based on attacking
  const shift = useMemo(() => {
    const ev = allEvents.find(e => Math.abs(e.minute - minute) <= 2);
    if (!ev) return attackSide === 'home' ? 0.04 : -0.04;
    return ev.teamId === homeTeamId ? 0.07 : -0.07;
  }, [minute, allEvents, homeTeamId, attackSide]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const P = 10;
    const fw = W - P * 2, fh = H - P * 2;

    if (isGoalEvent) goalCelebFrame.current = 50;

    // Update play sequence when minute changes
    const isHome = attackSide === 'home';
    playSequence.current = generatePlaySequence(minute, isHome);
    currentPassTarget.current = 0;
    passTimer.current = 0;

    // Get actual player positions with formation shift
    function getPlayerPos(formIdx: number, isHomeTeam: boolean): { x: number; y: number } {
      const base = BASE_FORMATION[formIdx];
      const s = isHomeTeam ? shift : -shift;
      const bx = isHomeTeam ? base.x + s : 1 - base.x - s;
      return {
        x: clamp(bx, 0.03, 0.97),
        y: base.y,
      };
    }

    let raf: number;
    function render() {
      frameRef.current++;
      const f = frameRef.current;
      ctx.clearRect(0, 0, W, H);

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
      // Penalty areas
      const paW = fw * 0.14, paH = fh * 0.52, paY = (H - paH) / 2;
      ctx.strokeRect(P, paY, paW, paH);
      ctx.strokeRect(W - P - paW, paY, paW, paH);
      const gaW = fw * 0.05, gaH = fh * 0.26, gaY = (H - gaH) / 2;
      ctx.strokeRect(P, gaY, gaW, gaH);
      ctx.strokeRect(W - P - gaW, gaY, gaW, gaH);
      // Goals
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      const gH = fh * 0.14, gY = (H - gH) / 2;
      ctx.strokeRect(P - 6, gY, 6, gH);
      ctx.strokeRect(W - P, gY, 6, gH);
      // Net lines
      ctx.lineWidth = 0.4; ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 5; i++) {
        const ny = gY + i * gH / 4;
        ctx.beginPath(); ctx.moveTo(P - 6, ny); ctx.lineTo(P, ny); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W - P, ny); ctx.lineTo(W - P + 6, ny); ctx.stroke();
      }
      // Penalty spots
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.arc(P + fw * 0.1, H / 2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W - P - fw * 0.1, H / 2, 1.5, 0, Math.PI * 2); ctx.fill();
      // Corner arcs
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

      // ── Ball target: pass to next player in sequence ──
      passTimer.current++;
      if (passTimer.current > 25) { // ~0.4s per pass at 60fps
        passTimer.current = 0;
        currentPassTarget.current++;
        if (currentPassTarget.current >= playSequence.current.length) {
          currentPassTarget.current = 0;
          // Generate next play
          const nextAttacking = seededRand(f * 17) > 0.45;
          playSequence.current = generatePlaySequence(minute + Math.floor(f / 60), nextAttacking);
          attackingTeam.current = nextAttacking ? 'home' : 'away';
        }
      }

      // Get target player position
      const targetIdx = playSequence.current[currentPassTarget.current] ?? 0;
      const isAttHome = attackingTeam.current === 'home';
      const targetPlayer = getPlayerPos(targetIdx, isAttHome);

      // Special events override ball target
      let ballTargetX = targetPlayer.x;
      let ballTargetY = targetPlayer.y;
      const nearEvent = allEvents.find(e => Math.abs(e.minute - minute) <= 1);
      if (nearEvent) {
        const evIsHome = nearEvent.teamId === homeTeamId;
        if (nearEvent.type === 'goal' || nearEvent.type === 'penalty_goal') {
          // Ball flies into the goal
          ballTargetX = evIsHome ? 0.97 : 0.03;
          ballTargetY = 0.45 + seededRand(minute * 7) * 0.1;
        } else if (nearEvent.type === 'save') {
          ballTargetX = evIsHome ? 0.95 : 0.05;
          ballTargetY = 0.5;
        }
      }

      // Smooth ball movement
      const txPx = P + ballTargetX * fw;
      const tyPx = P + ballTargetY * fh;
      ballPos.current.x = lerp(ballPos.current.x, txPx, 0.08);
      ballPos.current.y = lerp(ballPos.current.y, tyPx, 0.08);
      const bx = ballPos.current.x, by = ballPos.current.y;

      // Ball history
      ballHistory.current.push({ x: bx, y: by });
      if (ballHistory.current.length > 10) ballHistory.current.shift();

      // ── Draw players ──
      function drawPlayer(fx: number, fy: number, color: string, num: number, hasBall: boolean) {
        const jx = Math.sin(f * 0.07 + fx * 40) * 2;
        const jy = Math.cos(f * 0.05 + fy * 40) * 1.5;
        const px = P + fx * fw + jx;
        const py = P + fy * fh + jy;

        // Shadow
        ctx.beginPath(); ctx.ellipse(px, py + 5, 5, 1.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();

        // Player indicator ring if has ball
        if (hasBall) {
          ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
        }

        // Body
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();

        // Number
        ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(num), px, py + 2.2);
      }

      // Determine which player "has the ball"
      const ballHolderIdx = playSequence.current[currentPassTarget.current] ?? -1;

      // Home players
      BASE_FORMATION.forEach((_, i) => {
        const pos = getPlayerPos(i, true);
        const hasBall = isAttHome && i === ballHolderIdx;
        drawPlayer(pos.x, pos.y, homeColor, i === 0 ? 1 : i + 1, hasBall);
      });
      // Away players
      BASE_FORMATION.forEach((_, i) => {
        const pos = getPlayerPos(i, false);
        const hasBall = !isAttHome && i === ballHolderIdx;
        drawPlayer(pos.x, pos.y, awayColor, i === 0 ? 1 : i + 1, hasBall);
      });

      // ── Ball trail ──
      const bHist = ballHistory.current;
      for (let i = 0; i < bHist.length - 1; i++) {
        const a = (i / bHist.length) * 0.2;
        const r = 1 + (i / bHist.length) * 1.5;
        ctx.beginPath(); ctx.arc(bHist[i].x, bHist[i].y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill();
      }

      // ── Goal celebration ──
      if (goalCelebFrame.current > 0) {
        goalCelebFrame.current--;
        const gr = 10 + (50 - goalCelebFrame.current) * 1;
        const ga = (goalCelebFrame.current / 50) * 0.5;
        ctx.beginPath(); ctx.arc(bx, by, gr, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(bx, by, 2, bx, by, gr);
        grad.addColorStop(0, `rgba(250,204,21,${ga})`);
        grad.addColorStop(1, 'rgba(250,204,21,0)');
        ctx.fillStyle = grad; ctx.fill();

        // Goal net shake
        const shakeX = Math.sin(f * 0.3) * 2 * (goalCelebFrame.current / 50);
        const isRightGoal = nearEvent?.teamId === homeTeamId;
        ctx.strokeStyle = 'rgba(250,204,21,0.4)'; ctx.lineWidth = 1;
        const netX = isRightGoal ? W - P + shakeX : P + shakeX;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(netX, gY + i * gH / 3);
          ctx.lineTo(netX + (isRightGoal ? 5 : -5), gY + i * gH / 3);
          ctx.stroke();
        }
      }

      // ── Ball ──
      // Shadow
      ctx.beginPath(); ctx.ellipse(bx, by + 4, 4, 1.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
      // Ball body
      ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = '#bbb'; ctx.lineWidth = 0.5; ctx.stroke();
      // Pentagon pattern
      ctx.beginPath(); ctx.arc(bx - 0.8, by - 0.8, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = '#ddd'; ctx.fill();

      raf = requestAnimationFrame(render);
    }

    let raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [minute, flashEvent, halftime, finished, homeColor, awayColor, shift, attackSide, allEvents, homeTeamId, isGoalEvent, maxMinute]);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={280}
      className="w-full rounded-xl border border-emerald-900/30"
    />
  );
}
