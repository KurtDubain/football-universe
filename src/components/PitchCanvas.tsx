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

// 4-4-2 formation — more spread out and realistic
const FORMATION = [
  { x: 0.07, y: 0.5 },   // GK
  { x: 0.22, y: 0.12 }, { x: 0.20, y: 0.37 }, { x: 0.20, y: 0.63 }, { x: 0.22, y: 0.88 },
  { x: 0.38, y: 0.15 }, { x: 0.35, y: 0.40 }, { x: 0.35, y: 0.60 }, { x: 0.38, y: 0.85 },
  { x: 0.48, y: 0.35 }, { x: 0.48, y: 0.65 },
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export default function PitchCanvas(props: Props) {
  const { minute, maxMinute, homeColor, awayColor, homeTeamId, flashEvent, allEvents, finished, halftime } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const ballHistory = useRef<{ x: number; y: number }[]>([]);
  const goalCelebFrame = useRef(0);

  const isGoalEvent = flashEvent && (flashEvent.type === 'goal' || flashEvent.type === 'penalty_goal');

  // Target ball position
  const ballTarget = useMemo(() => {
    const ev = allEvents.find(e => Math.abs(e.minute - minute) <= 1);
    if (ev) {
      const isHome = ev.teamId === homeTeamId;
      if (ev.type === 'goal' || ev.type === 'penalty_goal')
        return { x: isHome ? 0.93 : 0.07, y: 0.42 + Math.sin(minute) * 0.08 };
      if (ev.type === 'save')
        return { x: isHome ? 0.90 : 0.10, y: 0.5 };
      if (ev.type === 'miss')
        return { x: isHome ? 0.96 : 0.04, y: 0.3 + Math.sin(minute * 2) * 0.2 };
      return { x: 0.45 + Math.sin(minute) * 0.08, y: 0.4 + Math.cos(minute) * 0.1 };
    }
    // General play — smooth wander
    const px = 0.35 + Math.sin(minute * 0.31) * 0.18 + Math.cos(minute * 0.17) * 0.12;
    const py = 0.35 + Math.sin(minute * 0.47 + 1) * 0.15 + Math.cos(minute * 0.23) * 0.1;
    return { x: clamp(px, 0.08, 0.92), y: clamp(py, 0.1, 0.9) };
  }, [minute, allEvents, homeTeamId]);

  // Formation attack/defend shift
  const shift = useMemo(() => {
    const ev = allEvents.find(e => Math.abs(e.minute - minute) <= 2);
    if (!ev) return 0;
    return ev.teamId === homeTeamId ? 0.06 : -0.06;
  }, [minute, allEvents, homeTeamId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const P = 10; // padding

    if (isGoalEvent) goalCelebFrame.current = 40;

    let raf: number;
    function render() {
      frameRef.current++;
      const f = frameRef.current;
      ctx.clearRect(0, 0, W, H);

      // ── Background + grass ──
      ctx.fillStyle = '#1a472a';
      ctx.fillRect(0, 0, W, H);
      // Mow stripes
      const sw = (W - P * 2) / 12;
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#1d5231' : '#1a472a';
        ctx.fillRect(P + i * sw, P, sw, H - P * 2);
      }

      // ── Pitch lines ──
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      const fw = W - P * 2, fh = H - P * 2;
      ctx.strokeRect(P, P, fw, fh);
      // Center
      ctx.beginPath(); ctx.moveTo(W / 2, P); ctx.lineTo(W / 2, H - P); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, fh * 0.16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
      // Penalty areas
      const paW = fw * 0.14, paH = fh * 0.52, paY = (H - paH) / 2;
      ctx.strokeRect(P, paY, paW, paH);
      ctx.strokeRect(W - P - paW, paY, paW, paH);
      // 6-yard boxes
      const gaW = fw * 0.05, gaH = fh * 0.26, gaY = (H - gaH) / 2;
      ctx.strokeRect(P, gaY, gaW, gaH);
      ctx.strokeRect(W - P - gaW, gaY, gaW, gaH);
      // Goals
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      const gH = fh * 0.14, gY = (H - gH) / 2;
      ctx.strokeRect(P - 6, gY, 6, gH);
      ctx.strokeRect(W - P, gY, 6, gH);
      // Net pattern
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(P - 6, gY + i * gH / 4); ctx.lineTo(P, gY + i * gH / 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W - P, gY + i * gH / 4); ctx.lineTo(W - P + 6, gY + i * gH / 4); ctx.stroke();
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      // Penalty spots
      ctx.beginPath(); ctx.arc(P + fw * 0.1, H / 2, 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      ctx.beginPath(); ctx.arc(W - P - fw * 0.1, H / 2, 1.5, 0, Math.PI * 2); ctx.fill();
      // Corner arcs
      ctx.lineWidth = 1;
      for (const [cx, cy, sa, ea] of [[P, P, 0, Math.PI / 2], [W - P, P, Math.PI / 2, Math.PI], [P, H - P, -Math.PI / 2, 0], [W - P, H - P, Math.PI, Math.PI * 1.5]] as [number, number, number, number][]) {
        ctx.beginPath(); ctx.arc(cx, cy, 8, sa, ea); ctx.stroke();
      }

      if (halftime) {
        // ── Half-time overlay ──
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('中场休息', W / 2, H / 2 - 4);
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('HALF TIME', W / 2, H / 2 + 14);
        raf = requestAnimationFrame(render);
        return;
      }

      // ── Players ──
      function drawPlayer(baseX: number, baseY: number, color: string, num: number) {
        const jx = Math.sin(f * 0.08 + baseX * 50) * 2.5;
        const jy = Math.cos(f * 0.06 + baseY * 50) * 2;
        const px = P + baseX * fw + jx;
        const py = P + baseY * fh + jy;
        // Shadow
        ctx.beginPath(); ctx.ellipse(px, py + 5, 5, 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
        // Body circle
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        // Number
        ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(num), px, py + 2.5);
      }

      // Home
      FORMATION.forEach((p, i) => {
        drawPlayer(clamp(p.x + shift, 0.03, 0.48), p.y, homeColor, i === 0 ? 1 : i + 1);
      });
      // Away (mirrored)
      FORMATION.forEach((p, i) => {
        drawPlayer(clamp(1 - p.x - shift, 0.52, 0.97), p.y, awayColor, i === 0 ? 1 : i + 1);
      });

      // ── Ball ──
      // Smooth ball movement via history
      const bh = ballHistory.current;
      const tx = P + ballTarget.x * fw, ty = P + ballTarget.y * fh;
      const lastB = bh.length > 0 ? bh[bh.length - 1] : { x: tx, y: ty };
      const bx = lerp(lastB.x, tx, 0.12);
      const by = lerp(lastB.y, ty, 0.12);
      bh.push({ x: bx, y: by });
      if (bh.length > 12) bh.shift();

      // Trail
      for (let i = 0; i < bh.length - 1; i++) {
        const a = (i / bh.length) * 0.25;
        const r = 1 + (i / bh.length) * 1.5;
        ctx.beginPath(); ctx.arc(bh[i].x, bh[i].y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill();
      }

      // Goal celebration glow
      if (goalCelebFrame.current > 0) {
        goalCelebFrame.current--;
        const gr = 8 + (40 - goalCelebFrame.current) * 0.8;
        const ga = goalCelebFrame.current / 40 * 0.5;
        ctx.beginPath(); ctx.arc(bx, by, gr, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(bx, by, 2, bx, by, gr);
        grad.addColorStop(0, `rgba(250,204,21,${ga})`);
        grad.addColorStop(1, 'rgba(250,204,21,0)');
        ctx.fillStyle = grad; ctx.fill();
      }

      // Ball shadow
      ctx.beginPath(); ctx.ellipse(bx, by + 4, 4, 1.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
      // Ball
      ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 0.6; ctx.stroke();
      // Ball pattern (pentagon hint)
      ctx.beginPath(); ctx.arc(bx - 1, by - 1, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ccc'; ctx.fill();

      raf = requestAnimationFrame(render);
    }

    render();
    return () => cancelAnimationFrame(raf);
  }, [minute, flashEvent, halftime, finished, homeColor, awayColor, ballTarget, shift, isGoalEvent]);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={280}
      className="w-full rounded-xl border border-emerald-900/30"
    />
  );
}
