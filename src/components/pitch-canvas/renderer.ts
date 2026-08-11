// Canvas drawing primitives for the pitch. Impure (touch ctx) but
// each function does ONE thing — pitch, players, ball, celebration etc.
//
// Magic timing constants (GOAL_CELEB_MAX_FRAMES, FLASH_MAX_FRAMES,
// CAMERA_SHAKE_MAX_FRAMES) live here because the renderer is what
// understands them; the orchestrator imports them when triggering effects.

import { clamp, hexToRgbStr } from './math';
import type { ShotOutcome } from './event-scene';
import type { PlayerState } from './types';
import { createPitchGeometry } from './geometry';

// Mutable {current: number} shape — matches React.MutableRefObject<number>
// without importing React, so this module stays UI-framework neutral.
type MutNum = { current: number };

export const GOAL_CELEB_MAX_FRAMES = 110;
export const FLASH_MAX_FRAMES = 8;
export const CAMERA_SHAKE_MAX_FRAMES = 18;
export const SHOT_OUTCOME_MAX_FRAMES = 72;

export interface BroadcastCameraState {
  focusX: number;
  focusY: number;
  zoom: number;
}

export interface BroadcastCameraTransform {
  offX: number;
  offY: number;
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * Grass + stripes + lines + pa/ga boxes + corner arcs + vignette.
 * Should be the first thing drawn each frame (it fills the whole canvas).
 */
export function drawPitch(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  P: number,
): void {
  const pitch = createPitchGeometry(W, H, P);
  const {
    fieldWidth: fw,
    fieldHeight: fh,
    centerX,
    centerY,
    penaltyAreaDepth,
    penaltyAreaSpan,
    goalAreaDepth,
    goalAreaSpan,
    goalMouthSpan,
    goalDepth,
    penaltySpotOffset,
    penaltyArcRadiusX,
    penaltyArcRadiusY,
    cornerRadiusX,
    cornerRadiusY,
  } = pitch;

  // Dark surround gives the nets physical depth and separates the field from
  // the modal chrome without spending pixels on decorative stadium scenery.
  ctx.fillStyle = '#091b11';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(P - 3, P - 3, fw + 6, fh + 6);

  ctx.fillStyle = '#194c2c';
  ctx.fillRect(P, P, fw, fh);
  const stripeCount = 10;
  const stripeWidth = fw / stripeCount;
  for (let index = 0; index < stripeCount; index++) {
    ctx.fillStyle = index % 2 === 0 ? '#1d5532' : '#194c2c';
    ctx.fillRect(P + index * stripeWidth, P, stripeWidth, fh);
  }

  // Fine deterministic mowing grain. This lives on the cached pitch layer,
  // so the extra material detail has no recurring animation cost.
  ctx.lineWidth = 0.35;
  for (let index = 1; index < 34; index++) {
    const y = P + index * fh / 34;
    ctx.strokeStyle = index % 2 === 0 ? 'rgba(238,255,239,0.025)' : 'rgba(0,0,0,0.025)';
    ctx.beginPath();
    ctx.moveTo(P, y);
    ctx.lineTo(P + fw, y);
    ctx.stroke();
  }

  const light = ctx.createLinearGradient(P, P, P + fw, P + fh);
  light.addColorStop(0, 'rgba(255,255,255,0.035)');
  light.addColorStop(0.52, 'rgba(255,255,255,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.09)');
  ctx.fillStyle = light;
  ctx.fillRect(P, P, fw, fh);

  const vignette = ctx.createRadialGradient(centerX, centerY, fh * 0.34, centerX, centerY, fh * 0.76);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = vignette;
  ctx.fillRect(P, P, fw, fh);

  const lineColor = 'rgba(244,248,238,0.62)';
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.25;
  ctx.strokeRect(P, P, fw, fh);
  ctx.beginPath();
  ctx.moveTo(centerX, P);
  ctx.lineTo(centerX, H - P);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, pitch.centerCircleRadiusX, pitch.centerCircleRadiusY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, 1.7, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();

  const penaltyY = centerY - penaltyAreaSpan / 2;
  const goalAreaY = centerY - goalAreaSpan / 2;
  ctx.strokeRect(P, penaltyY, penaltyAreaDepth, penaltyAreaSpan);
  ctx.strokeRect(W - P - penaltyAreaDepth, penaltyY, penaltyAreaDepth, penaltyAreaSpan);
  ctx.strokeRect(P, goalAreaY, goalAreaDepth, goalAreaSpan);
  ctx.strokeRect(W - P - goalAreaDepth, goalAreaY, goalAreaDepth, goalAreaSpan);

  const leftSpotX = P + penaltySpotOffset;
  const rightSpotX = W - P - penaltySpotOffset;
  ctx.beginPath();
  ctx.arc(leftSpotX, centerY, 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rightSpotX, centerY, 1.35, 0, Math.PI * 2);
  ctx.fill();

  const arcAngle = Math.acos((penaltyAreaDepth - penaltySpotOffset) / penaltyArcRadiusX);
  ctx.beginPath();
  ctx.ellipse(leftSpotX, centerY, penaltyArcRadiusX, penaltyArcRadiusY, 0, -arcAngle, arcAngle);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(rightSpotX, centerY, penaltyArcRadiusX, penaltyArcRadiusY, 0, Math.PI - arcAngle, Math.PI + arcAngle);
  ctx.stroke();

  const goalY = centerY - goalMouthSpan / 2;
  const drawGoal = (frontX: number, direction: -1 | 1) => {
    const backX = frontX + direction * goalDepth;
    ctx.fillStyle = 'rgba(230,238,228,0.035)';
    ctx.fillRect(Math.min(frontX, backX), goalY, goalDepth, goalMouthSpan);
    ctx.strokeStyle = 'rgba(244,248,238,0.72)';
    ctx.lineWidth = 1.65;
    ctx.strokeRect(Math.min(frontX, backX), goalY, goalDepth, goalMouthSpan);
    ctx.strokeStyle = 'rgba(244,248,238,0.16)';
    ctx.lineWidth = 0.45;
    for (let row = 1; row < 5; row++) {
      const y = goalY + row * goalMouthSpan / 5;
      ctx.beginPath(); ctx.moveTo(frontX, y); ctx.lineTo(backX, y); ctx.stroke();
    }
    for (let column = 1; column < 3; column++) {
      const x = frontX + direction * column * goalDepth / 3;
      ctx.beginPath(); ctx.moveTo(x, goalY); ctx.lineTo(x, goalY + goalMouthSpan); ctx.stroke();
    }
  };
  drawGoal(P, -1);
  drawGoal(W - P, 1);

  ctx.strokeStyle = 'rgba(244,248,238,0.5)';
  ctx.lineWidth = 0.85;
  const corners = [
    [P, P, 0, Math.PI / 2],
    [W - P, P, Math.PI / 2, Math.PI],
    [P, H - P, -Math.PI / 2, 0],
    [W - P, H - P, Math.PI, Math.PI * 1.5],
  ] as const;
  for (const [cx, cy, start, end] of corners) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, cornerRadiusX, cornerRadiusY, 0, start, end);
    ctx.stroke();
  }
}

/**
 * Black overlay + "中场休息 / HALF TIME" centered text.
 */
export function drawHalftime(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  label = '中场休息',
  sublabel = 'HALF TIME',
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, W / 2, H / 2 - 4);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#94a3b8';
  ctx.fillText(sublabel, W / 2, H / 2 + 14);
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
  highlighted = false,
  label?: string,
  facingTarget?: { x: number; y: number },
  action?: 'receive' | 'shot' | 'save' | 'catch' | 'block',
  actionProgress = 0,
  visualScale = 1,
): void {
  const px = P + p.x * fw;
  const py = P + p.y * fh;
  const speed = Math.hypot(p.vx, p.vy);
  const isMoving = speed > 0.003;
  const movementX = p.vx * fw;
  const movementY = p.vy * fh;
  const facingX = facingTarget ? facingTarget.x - px : movementX;
  const facingY = facingTarget ? facingTarget.y - py : movementY;
  const facingLength = Math.hypot(facingX, facingY);
  const directionX = facingLength > 0.01 ? facingX / facingLength : 0;
  const directionY = facingLength > 0.01 ? facingY / facingLength : 0;

  ctx.save();
  ctx.translate(px, py);
  ctx.scale(visualScale, visualScale);
  ctx.translate(-px, -py);

  // Restrained stride marks preserve a sense of pace without the arcade-like
  // after-images that previously followed fast players.
  if (isMoving && speed > 0.006) {
    const sideX = -directionY;
    const sideY = directionX;
    const stride = Math.sin(frame * 0.5 + num) * 1.8;
    ctx.beginPath();
    ctx.moveTo(px - directionX * 4 + sideX * stride, py - directionY * 4 + sideY * stride);
    ctx.lineTo(px - directionX * 7 + sideX * stride, py - directionY * 7 + sideY * stride);
    ctx.moveTo(px - directionX * 4 - sideX * stride, py - directionY * 4 - sideY * stride);
    ctx.lineTo(px - directionX * 7 - sideX * stride, py - directionY * 7 - sideY * stride);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 0.8;
    ctx.lineCap = 'round';
    ctx.stroke();
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

  if (highlighted) {
    const pulse = 1 + Math.sin(frame * 0.14) * 0.1;
    ctx.beginPath(); ctx.arc(px, py, 10 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.6; ctx.stroke();
    if (label) {
      ctx.font = 'bold 7px sans-serif';
      const labelY = action === 'save' || action === 'catch' || action === 'block' ? py + 15 : Math.max(8, py - 11);
      const labelWidth = ctx.measureText(label).width + 5;
      const labelX = clamp(px, P + labelWidth / 2 + 3, P + fw - labelWidth / 2 - 3);
      ctx.fillStyle = 'rgba(2,6,23,0.72)';
      ctx.fillRect(labelX - labelWidth / 2, labelY - 7, labelWidth, 9);
      ctx.fillStyle = '#fef3c7';
      ctx.textAlign = 'center';
      ctx.fillText(label, labelX, labelY);
    }
  }

  // Readable top-down body language for the decisive action. The preparation
  // appears before release; goalkeeper and block shapes only open after their
  // reaction begins, preserving the event timing.
  if (action && facingLength > 0.01) {
    const actionWave = action === 'shot' || action === 'receive'
      ? Math.sin(Math.min(1, actionProgress) * Math.PI)
      : Math.min(1, Math.max(0, (actionProgress - 0.15) / 0.55));
    if (action === 'shot') {
      const sideX = -directionY;
      const sideY = directionX;
      ctx.beginPath();
      ctx.arc(
        px - directionX * 3.8 + sideX * 2.5,
        py - directionY * 3.8 + sideY * 2.5,
        1.4 + actionWave * 0.5,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px - directionX * 2, py - directionY * 2);
      ctx.quadraticCurveTo(
        px - directionX * 7 - sideX * 3 * actionWave,
        py - directionY * 7 - sideY * 3 * actionWave,
        px + directionX * 7 * actionWave,
        py + directionY * 7 * actionWave,
      );
      ctx.strokeStyle = `rgba(255,255,255,${0.3 + actionWave * 0.55})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else if (action === 'receive' && actionWave > 0.05) {
      const sideX = -directionY;
      const sideY = directionX;
      ctx.beginPath();
      ctx.moveTo(px - directionX * 1.5, py - directionY * 1.5);
      ctx.lineTo(
        px + directionX * (5 + actionWave * 2) + sideX * 2.2,
        py + directionY * (5 + actionWave * 2) + sideY * 2.2,
      );
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else if (action === 'catch' && actionWave > 0.05) {
      const sideX = -directionY;
      const sideY = directionX;
      ctx.beginPath();
      ctx.moveTo(px + sideX * 4, py + sideY * 4);
      ctx.lineTo(px + directionX * 6 * actionWave, py + directionY * 6 * actionWave);
      ctx.moveTo(px - sideX * 4, py - sideY * 4);
      ctx.lineTo(px + directionX * 6 * actionWave, py + directionY * 6 * actionWave);
      ctx.strokeStyle = 'rgba(147,197,253,0.72)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else if (actionWave > 0.05) {
      ctx.beginPath();
      ctx.moveTo(px - directionX * 10 * actionWave, py - directionY * 10 * actionWave);
      ctx.lineTo(px + directionX * 7 * actionWave, py + directionY * 7 * actionWave);
      ctx.strokeStyle = action === 'save' ? 'rgba(147,197,253,0.7)' : 'rgba(253,230,138,0.75)';
      ctx.lineWidth = action === 'save' ? 4 : 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  // Body
  const actionWave = action === 'shot' || action === 'receive'
    ? Math.sin(Math.min(1, actionProgress) * Math.PI)
    : action
      ? Math.min(1, Math.max(0, (actionProgress - 0.15) / 0.55))
      : 0;
  ctx.save();
  ctx.translate(px, py);
  if (facingLength > 0.01) ctx.rotate(Math.atan2(directionY, directionX));
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    action === 'save' ? 5.7 + actionWave * 2.5 : action === 'receive' ? 5.7 + actionWave * 0.7 : 5.7,
    action === 'save' ? 4.8 - actionWave * 1.2 : action === 'receive' ? 4.8 - actionWave * 0.45 : 4.8,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(String(num), px, py + 2.2);

  if (facingLength > 0.01) {
    const shoulderX = -directionY;
    const shoulderY = directionX;
    ctx.beginPath();
    ctx.moveTo(px + shoulderX * 3.7, py + shoulderY * 3.7);
    ctx.lineTo(px - shoulderX * 3.7, py - shoulderY * 3.7);
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 0.75;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px + directionX * 4.4, py + directionY * 4.4, 1.15, 0, Math.PI * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();
  }

  // A small facing marker makes the tactical dots read as footballers rather
  // than pieces sliding sideways. Key actions extend the marker only briefly.
  if (facingLength > 0.01 && (hasBall || highlighted || speed > 0.006)) {
    const actionReach = action ? 2.5 * Math.sin(Math.min(1, actionProgress) * Math.PI) : 0;
    const markerStart = 4.2;
    const markerEnd = 7 + actionReach;
    ctx.beginPath();
    ctx.moveTo(px + directionX * markerStart, py + directionY * markerStart);
    ctx.lineTo(px + directionX * markerEnd, py + directionY * markerEnd);
    ctx.strokeStyle = action === 'save' || action === 'catch' ? '#93c5fd' : action === 'block' ? '#fde68a' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = action ? 1.8 : 1.1;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Ball at ground point (bx, by): fixed ground path, separated aerial lift,
 * and a spinning panelled sphere.
 */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  bx: number, by: number,
  ballArcLift: number,
  ballSpin: number,
  visualScale = 1,
): void {
  const radius = 3.5 * visualScale;
  const shadowSpread = 1 + ballArcLift * 0.05;
  ctx.beginPath();
  ctx.ellipse(
    bx,
    by + 4 * visualScale,
    4 * visualScale / shadowSpread,
    1.5 * visualScale / shadowSpread,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = `rgba(0,0,0,${0.3 / shadowSpread})`; ctx.fill();
  // Ball with pentagon panel rotation
  ctx.save();
  ctx.translate(bx, by - ballArcLift);
  ctx.rotate(ballSpin * 0.15);
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = '#bbb'; ctx.lineWidth = 0.5; ctx.stroke();
  // Pentagonal panel detail
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const r = 1.4 * visualScale;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); ctx.arc(-0.8 * visualScale, -0.8 * visualScale, 1.1 * visualScale, 0, Math.PI * 2);
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

  // Two restrained broadcast rings keep the impact readable without turning
  // the finish into an arcade explosion.
  for (let k = 0; k < 2; k++) {
    const ringT = (t + k * 0.24) % 1;
    if (ringT > 0.95) continue;
    const gr = 8 + ringT * 56;
    const ga = (1 - ringT) * 0.34;
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

/** Draw a concise, broadcast-like impact cue for non-goal shots. */
export function drawShotOutcome(
  ctx: CanvasRenderingContext2D,
  remainingFrames: number,
  outcome: Exclude<ShotOutcome, 'goal'>,
  targetX: number,
  targetY: number,
  attackingHome: boolean,
): void {
  const progress = 1 - remainingFrames / SHOT_OUTCOME_MAX_FRAMES;
  const alpha = Math.max(0, 1 - progress);
  const goalLineX = attackingHome ? targetX - 14 : targetX + 14;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';

  if (outcome === 'save') {
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(goalLineX, targetY + 6);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(targetX, targetY, 7 + progress * 7, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (outcome === 'block') {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
    const radius = 5 + progress * 4;
    ctx.beginPath();
    ctx.moveTo(targetX - radius, targetY - radius);
    ctx.lineTo(targetX + radius, targetY + radius);
    ctx.moveTo(targetX + radius, targetY - radius);
    ctx.lineTo(targetX - radius, targetY + radius);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(targetX, targetY, 6 + progress * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

/** Draw outcome copy in screen space so camera pan and zoom cannot clip it. */
export function drawShotOutcomeLabel(
  ctx: CanvasRenderingContext2D,
  remainingFrames: number,
  outcome: Exclude<ShotOutcome, 'goal'>,
  targetX: number,
  targetY: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const progress = 1 - remainingFrames / SHOT_OUTCOME_MAX_FRAMES;
  const alpha = Math.max(0, Math.min(1, (1 - progress) * 1.45));
  const label = outcome === 'save' ? '扑救' : outcome === 'block' ? '封堵' : '偏出';
  const color = outcome === 'save' ? '#bfdbfe' : outcome === 'block' ? '#fde68a' : '#e2e8f0';
  const border = outcome === 'save' ? '#60a5fa' : outcome === 'block' ? '#fbbf24' : '#94a3b8';

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '700 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(label).width + 14;
  const height = 19;
  const x = clamp(targetX, width / 2 + 8, canvasWidth - width / 2 - 8);
  const y = clamp(targetY - 22 - progress * 5, height / 2 + 7, canvasHeight - height / 2 - 7);
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, 4);
  ctx.fillStyle = 'rgba(3,10,7,0.86)';
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(label, x, y + 0.4);
  ctx.restore();
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
  camera: BroadcastCameraState = { focusX: W / 2, focusY: H / 2, zoom: 1 },
): BroadcastCameraTransform {
  let offX = 0, offY = 0;
  if (shakeRef.current > 0) {
    const t = 1 - shakeRef.current / shakeMaxRef.current;
    const decay = Math.exp(-t * 3); // exponential falloff
    const phase = (shakeMaxRef.current - shakeRef.current) * 0.85;
    offX = Math.sin(phase) * 0.9 * decay;
    offY = Math.cos(phase * 1.3) * 0.55 * decay;
    shakeRef.current--;
  }
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  const zoom = clamp(camera.zoom, 1, 1.12);
  const overscanX = Math.max(0, (zoom - 1) * W / 2 - 1);
  const overscanY = Math.max(0, (zoom - 1) * H / 2 - 1);
  const panX = clamp((W / 2 - camera.focusX) * 0.22, -overscanX, overscanX);
  const panY = clamp((H / 2 - camera.focusY) * 0.18, -overscanY, overscanY);
  ctx.translate(W / 2 + panX + offX, H / 2 + panY + offY);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);
  return { offX, offY, panX, panY, zoom };
}

export function cameraPointToScreen(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  transform: BroadcastCameraTransform,
): { x: number; y: number } {
  return {
    x: (x - canvasWidth / 2) * transform.zoom + canvasWidth / 2 + transform.panX + transform.offX,
    y: (y - canvasHeight / 2) * transform.zoom + canvasHeight / 2 + transform.panY + transform.offY,
  };
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
    ctx.fillStyle = `rgba(255,255,255,${fa * 0.18})`;
    ctx.fillRect(0, 0, W, H);
    flashRef.current--;
  }
}
