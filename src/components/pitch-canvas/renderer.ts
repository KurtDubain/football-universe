// Canvas drawing primitives for the pitch. Impure (touch ctx) but
// each function does ONE thing — pitch, players, ball, celebration etc.
//
// Magic timing constants (GOAL_CELEB_MAX_FRAMES, FLASH_MAX_FRAMES,
// CAMERA_SHAKE_MAX_FRAMES) live here because the renderer is what
// understands them; the orchestrator imports them when triggering effects.

import { hexToRgbStr } from './math';
import type { PlayerState } from './types';

// Mutable {current: number} shape — matches React.MutableRefObject<number>
// without importing React, so this module stays UI-framework neutral.
type MutNum = { current: number };

export const GOAL_CELEB_MAX_FRAMES = 110;
export const FLASH_MAX_FRAMES = 12;
export const CAMERA_SHAKE_MAX_FRAMES = 28;

/**
 * Grass + stripes + lines + pa/ga boxes + corner arcs + vignette.
 * Should be the first thing drawn each frame (it fills the whole canvas).
 */
export function drawPitch(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  P: number,
  fw: number, fh: number,
): void {
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
}

/**
 * Black overlay + "中场休息 / HALF TIME" centered text.
 */
export function drawHalftime(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('中场休息', W / 2, H / 2 - 4);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#94a3b8';
  ctx.fillText('HALF TIME', W / 2, H / 2 + 14);
}

/**
 * Single player: motion trail (when sprinting) → shadow → ball-holder ring → body → number.
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: PlayerState,
  color: string,
  num: number,
  hasBall: boolean,
  P: number,
  fw: number, fh: number,
  frame: number,
): void {
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
    const pulse = 1 + Math.sin(frame * 0.18) * 0.15;
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

/**
 * Ball at (bx, by): elongated arc-lift shadow + spinning panelled sphere.
 */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  bx: number, by: number,
  ballArcLift: number,
  ballSpin: number,
): void {
  const shadowOffset = ballArcLift * 0.5;
  const shadowSpread = 1 + ballArcLift * 0.05;
  ctx.beginPath();
  ctx.ellipse(bx + shadowOffset * 0.3, by + 4 + ballArcLift * 0.6, 4 / shadowSpread, 1.5 / shadowSpread, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${0.3 / shadowSpread})`; ctx.fill();
  // Ball with pentagon panel rotation
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(ballSpin * 0.15);
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
}

/**
 * Goal celebration block: expanding rings + center glow + net ripple + ball glow.
 *
 * `celebFrame` counts DOWN from GOAL_CELEB_MAX_FRAMES; caller should
 * decrement it BEFORE calling so this draws the post-decrement frame.
 * `animFrame` is the global animation frame counter (used for ball pulse).
 */
export function drawGoalCelebration(
  ctx: CanvasRenderingContext2D,
  celebFrame: number,
  ringX: number, ringY: number,
  teamColor: string,
  gY: number, gH: number,
  isRightGoal: boolean,
  W: number, P: number,
  bx: number, by: number,
  animFrame: number,
): void {
  const t = 1 - celebFrame / GOAL_CELEB_MAX_FRAMES;
  const teamRgb = hexToRgbStr(teamColor);
  const goldRgb = '250,204,21';

  // Use additive blend so rings glow brightly over the pitch
  ctx.globalCompositeOperation = 'lighter';

  // Multi-ring expanding — alternate gold + team color
  for (let k = 0; k < 3; k++) {
    const ringT = (t + k * 0.18) % 1;
    if (ringT > 0.95) continue;
    const gr = 8 + ringT * 80;
    const ga = (1 - ringT) * 0.55;
    const ringRgb = k % 2 === 0 ? goldRgb : teamRgb;
    ctx.beginPath(); ctx.arc(ringX, ringY, gr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${ringRgb},${ga})`;
    ctx.lineWidth = 2 - ringT * 1.2;
    ctx.stroke();
  }

  // Center glow — gold-to-team-color radial
  const ga = (1 - t) * 0.65;
  const gr = 16 + t * 32;
  const grad = ctx.createRadialGradient(ringX, ringY, 2, ringX, ringY, gr);
  grad.addColorStop(0, `rgba(${goldRgb},${ga})`);
  grad.addColorStop(0.6, `rgba(${teamRgb},${ga * 0.5})`);
  grad.addColorStop(1, `rgba(${teamRgb},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(ringX, ringY, gr, 0, Math.PI * 2); ctx.fill();

  ctx.globalCompositeOperation = 'source-over';

  // Net ripple — horizontal threads + vertical wires for actual net look
  const netX = isRightGoal ? W - P : P;
  const dir = isRightGoal ? 1 : -1;
  const rippleA = (1 - t) * 0.85;
  ctx.strokeStyle = `rgba(${goldRgb},${rippleA})`;
  ctx.lineWidth = 0.8;
  // Horizontal threads (wavy)
  for (let i = 0; i < 7; i++) {
    const ny = gY + i * gH / 6 + Math.sin(t * 9 + i * 0.7) * 2;
    ctx.beginPath();
    ctx.moveTo(netX, ny);
    ctx.lineTo(netX + dir * 6, ny);
    ctx.stroke();
  }
  // Vertical wires
  for (let i = 0; i < 4; i++) {
    const nxOff = (i / 3) * 6 * dir;
    ctx.beginPath();
    ctx.moveTo(netX + nxOff, gY);
    ctx.lineTo(netX + nxOff, gY + gH);
    ctx.stroke();
  }

  // Ball glow during celebration
  const ballGlowR = 12 + Math.sin(animFrame * 0.3) * 3;
  ctx.globalCompositeOperation = 'lighter';
  const ballGrad = ctx.createRadialGradient(bx, by, 2, bx, by, ballGlowR);
  ballGrad.addColorStop(0, `rgba(255,235,160,${(1 - t) * 0.6})`);
  ballGrad.addColorStop(1, 'rgba(255,235,160,0)');
  ctx.fillStyle = ballGrad;
  ctx.beginPath(); ctx.arc(bx, by, ballGlowR, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Compute the per-frame camera offset, decrement the shake ref, and apply
 * ctx.save() + translate + clearRect so subsequent drawing happens in
 * shaken coords. Caller MUST ctx.restore() at end of frame.
 */
export function applyCameraShake(
  ctx: CanvasRenderingContext2D,
  shakeRef: MutNum,
  shakeMaxRef: MutNum,
  W: number, H: number,
): { offX: number; offY: number } {
  let offX = 0, offY = 0;
  if (shakeRef.current > 0) {
    const t = 1 - shakeRef.current / shakeMaxRef.current;
    const decay = Math.exp(-t * 3); // exponential falloff
    const phase = (shakeMaxRef.current - shakeRef.current) * 0.85;
    offX = Math.sin(phase) * 5 * decay;
    offY = Math.cos(phase * 1.3) * 3.2 * decay;
    shakeRef.current--;
  }
  ctx.save();
  ctx.translate(offX, offY);
  ctx.clearRect(-offX, -offY, W, H);
  return { offX, offY };
}

/**
 * White flash overlay (post-shake-restore). Decrements the flash ref.
 */
export function applyWhiteFlash(
  ctx: CanvasRenderingContext2D,
  flashRef: MutNum,
  W: number, H: number,
): void {
  if (flashRef.current > 0) {
    const fa = flashRef.current / FLASH_MAX_FRAMES;
    ctx.fillStyle = `rgba(255,255,255,${fa * 0.45})`;
    ctx.fillRect(0, 0, W, H);
    flashRef.current--;
  }
}
