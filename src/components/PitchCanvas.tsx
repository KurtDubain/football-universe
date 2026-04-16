import { useEffect, useRef, useCallback } from 'react';
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

// Formation positions (normalized 0-1 on each half)
// 4-3-3 layout
const HOME_POS = [
  [0.06, 0.5],   // GK
  [0.18, 0.15], [0.18, 0.38], [0.18, 0.62], [0.18, 0.85], // DEF
  [0.32, 0.25], [0.32, 0.5], [0.32, 0.75], // MID
  [0.44, 0.2], [0.44, 0.5], [0.44, 0.8],  // FWD
];
const AWAY_POS = HOME_POS.map(([x, y]) => [1 - x, y]); // mirror

export default function PitchCanvas({ minute, maxMinute, homeColor, awayColor, homeTeamId, flashEvent, allEvents, finished, halftime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const ballTrail = useRef<[number, number][]>([]);

  // Determine ball position based on game context
  const getBallPos = useCallback((): [number, number] => {
    // Near an event?
    const near = allEvents.find(e => Math.abs(e.minute - minute) <= 1);
    if (near) {
      const isHome = near.teamId === homeTeamId;
      if (near.type === 'goal' || near.type === 'penalty_goal') {
        // Ball at opponent's goal
        return isHome ? [0.92, 0.45 + Math.random() * 0.1] : [0.08, 0.45 + Math.random() * 0.1];
      }
      if (near.type === 'save') {
        return isHome ? [0.92, 0.5] : [0.08, 0.5];
      }
      if (near.type === 'miss') {
        return isHome ? [0.95, 0.3 + Math.random() * 0.4] : [0.05, 0.3 + Math.random() * 0.4];
      }
      // Card: midfield
      return [0.45 + Math.random() * 0.1, 0.3 + Math.random() * 0.4];
    }
    // General play
    const t = minute / maxMinute;
    const x = 0.3 + Math.sin(minute * 0.4) * 0.2 + Math.cos(minute * 0.7) * 0.15;
    const y = 0.3 + Math.sin(minute * 0.6 + 2) * 0.2;
    return [x, y];
  }, [minute, allEvents, homeTeamId, maxMinute]);

  // Get player offsets based on game state
  const getFormationShift = useCallback((): number => {
    const near = allEvents.find(e => Math.abs(e.minute - minute) <= 2);
    if (!near) return 0;
    const isHome = near.teamId === homeTeamId;
    if (near.type === 'goal' || near.type === 'penalty_goal' || near.type === 'miss') {
      return isHome ? 0.08 : -0.08; // attacking team pushes forward
    }
    return 0;
  }, [minute, allEvents, homeTeamId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pad = 8;
    const fw = W - pad * 2; // field width in pixels
    const fh = H - pad * 2;

    const isGoal = flashEvent && (flashEvent.type === 'goal' || flashEvent.type === 'penalty_goal');
    const goalSide = isGoal ? (flashEvent!.teamId === homeTeamId ? 'away' : 'home') : null;

    function drawPitch() {
      // Background
      ctx!.fillStyle = '#0d3320';
      ctx!.fillRect(0, 0, W, H);

      // Grass stripes
      const stripeW = fw / 10;
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          ctx!.fillStyle = '#0e3822';
          ctx!.fillRect(pad + i * stripeW, pad, stripeW, fh);
        }
      }

      ctx!.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx!.lineWidth = 1.2;

      // Outer border
      ctx!.strokeRect(pad, pad, fw, fh);
      // Center line
      ctx!.beginPath();
      ctx!.moveTo(W / 2, pad);
      ctx!.lineTo(W / 2, H - pad);
      ctx!.stroke();
      // Center circle
      ctx!.beginPath();
      ctx!.arc(W / 2, H / 2, fh * 0.18, 0, Math.PI * 2);
      ctx!.stroke();
      // Center dot
      ctx!.fillStyle = 'rgba(255,255,255,0.4)';
      ctx!.beginPath();
      ctx!.arc(W / 2, H / 2, 2, 0, Math.PI * 2);
      ctx!.fill();

      // Penalty areas
      const paW = fw * 0.14;
      const paH = fh * 0.55;
      const paY = (H - paH) / 2;
      ctx!.strokeRect(pad, paY, paW, paH);
      ctx!.strokeRect(W - pad - paW, paY, paW, paH);

      // Goal areas
      const gaW = fw * 0.05;
      const gaH = fh * 0.3;
      const gaY = (H - gaH) / 2;
      ctx!.strokeRect(pad, gaY, gaW, gaH);
      ctx!.strokeRect(W - pad - gaW, gaY, gaW, gaH);

      // Goals (thick lines)
      ctx!.lineWidth = 2.5;
      ctx!.strokeStyle = 'rgba(255,255,255,0.5)';
      const goalH = fh * 0.16;
      const goalY = (H - goalH) / 2;
      ctx!.strokeRect(pad - 4, goalY, 4, goalH);
      ctx!.strokeRect(W - pad, goalY, 4, goalH);
      ctx!.lineWidth = 1.2;
      ctx!.strokeStyle = 'rgba(255,255,255,0.35)';
    }

    function drawPlayers() {
      const shift = getFormationShift();

      // Home players
      for (const [px, py] of HOME_POS) {
        const x = pad + (px + shift) * fw;
        const y = pad + py * fh;
        // Player jitter
        const jx = Math.sin(minute * 0.5 + px * 10) * 3;
        const jy = Math.cos(minute * 0.4 + py * 10) * 3;

        ctx!.beginPath();
        ctx!.arc(x + jx, y + jy, 4.5, 0, Math.PI * 2);
        ctx!.fillStyle = homeColor;
        ctx!.fill();
        ctx!.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx!.lineWidth = 0.8;
        ctx!.stroke();
      }

      // Away players
      for (const [px, py] of AWAY_POS) {
        const x = pad + (px - shift) * fw;
        const y = pad + py * fh;
        const jx = Math.sin(minute * 0.5 + px * 10 + 5) * 3;
        const jy = Math.cos(minute * 0.4 + py * 10 + 5) * 3;

        ctx!.beginPath();
        ctx!.arc(x + jx, y + jy, 4.5, 0, Math.PI * 2);
        ctx!.fillStyle = awayColor;
        ctx!.fill();
        ctx!.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx!.lineWidth = 0.8;
        ctx!.stroke();
      }
    }

    function drawBall() {
      const [bx, by] = getBallPos();
      const x = pad + bx * fw;
      const y = pad + by * fh;

      // Add to trail
      ballTrail.current.push([x, y]);
      if (ballTrail.current.length > 8) ballTrail.current.shift();

      // Draw trail
      for (let i = 0; i < ballTrail.current.length - 1; i++) {
        const [tx, ty] = ballTrail.current[i];
        const alpha = (i / ballTrail.current.length) * 0.3;
        ctx!.beginPath();
        ctx!.arc(tx, ty, 2, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx!.fill();
      }

      // Ball glow on goal
      if (isGoal) {
        ctx!.beginPath();
        ctx!.arc(x, y, 12, 0, Math.PI * 2);
        const grad = ctx!.createRadialGradient(x, y, 2, x, y, 12);
        grad.addColorStop(0, 'rgba(250,204,21,0.6)');
        grad.addColorStop(1, 'rgba(250,204,21,0)');
        ctx!.fillStyle = grad;
        ctx!.fill();
      }

      // Ball
      ctx!.beginPath();
      ctx!.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx!.fillStyle = '#ffffff';
      ctx!.fill();
      ctx!.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx!.lineWidth = 0.5;
      ctx!.stroke();
    }

    function drawGoalNet() {
      if (!isGoal || !goalSide) return;
      // Shake the goal net
      const shake = Math.sin(Date.now() * 0.02) * 2;
      const goalH = fh * 0.16;
      const goalY = (H - goalH) / 2;

      ctx!.strokeStyle = 'rgba(250,204,21,0.6)';
      ctx!.lineWidth = 1.5;
      if (goalSide === 'away') {
        // Right goal shakes
        for (let i = 0; i < 4; i++) {
          ctx!.beginPath();
          ctx!.moveTo(W - pad + shake * (i % 2 ? 1 : -1), goalY + i * (goalH / 3));
          ctx!.lineTo(W - pad + 4, goalY + i * (goalH / 3));
          ctx!.stroke();
        }
      } else {
        for (let i = 0; i < 4; i++) {
          ctx!.beginPath();
          ctx!.moveTo(pad + shake * (i % 2 ? 1 : -1), goalY + i * (goalH / 3));
          ctx!.lineTo(pad - 4, goalY + i * (goalH / 3));
          ctx!.stroke();
        }
      }
    }

    function drawHalftime() {
      if (!halftime) return;
      ctx!.fillStyle = 'rgba(0,0,0,0.6)';
      ctx!.fillRect(0, 0, W, H);
      ctx!.fillStyle = '#ffffff';
      ctx!.font = 'bold 14px sans-serif';
      ctx!.textAlign = 'center';
      ctx!.fillText('中场休息', W / 2, H / 2 - 5);
      ctx!.font = '11px sans-serif';
      ctx!.fillStyle = '#94a3b8';
      ctx!.fillText('HALF TIME', W / 2, H / 2 + 12);
    }

    function render() {
      drawPitch();
      if (!halftime) {
        drawPlayers();
        drawBall();
        drawGoalNet();
      } else {
        drawHalftime();
      }
    }

    render();
    // Re-render on a short interval for smooth jitter
    const interval = setInterval(render, 100);

    return () => clearInterval(interval);
  }, [minute, flashEvent, halftime, finished, homeColor, awayColor, getBallPos, getFormationShift]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={240}
      className="w-full rounded-xl"
      style={{ imageRendering: 'auto' }}
    />
  );
}
