// Particle system — pure factories for unit-testability + a single
// renderParticles that batches by blend mode.
//
// All spawn* helpers RETURN a fresh Particle[]; the caller is
// responsible for pushing them into its own particle pool. This keeps
// the helpers free of refs and React state so they can be tested in
// isolation. (Math.random() is still used internally — that's fine; it
// matches the original behaviour and tests can stub Math.random.)

import type { Particle } from './types';

const PARTICLE_CAP = 350;

export function newParticle(
  p: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'vx' | 'vy' | 'color'>,
): Particle {
  const size = p.size ?? 1.5;
  const life = p.life ?? 60;
  return {
    rotation: 0,
    angularVel: 0,
    maxLife: life,
    initialSize: size,
    gravity: 0.05,
    drag: 0.015,
    shape: 'circle',
    bounces: 0,
    bounceY: 9999,
    blend: 'normal',
    size,
    life,
    ...p,
  };
}

/**
 * Goal celebration burst — 4 waves layered for richness:
 *   1) chunky team-coloured discs (radial, normal blend)
 *   2) bright streaks (additive)
 *   3) gold glow puffs (additive, stationary-ish)
 *   4) confetti rain (rectangles dropping from above the canvas)
 */
export function spawnGoalBurst(goalX: number, goalY: number, color: string, floor: number): Particle[] {
  const out: Particle[] = [];

  // ── Wave 1: chunky team-colored disc burst (radial, normal blend) ─
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const speed = 2.5 + Math.random() * 3.5;
    out.push(newParticle({
      x: goalX, y: goalY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.2,
      color,
      size: 2 + Math.random() * 1.8,
      life: 60 + Math.random() * 30,
      gravity: 0.12,
      drag: 0.025,
      bounces: 1,
      bounceY: floor,
      shape: 'circle',
    }));
  }

  // ── Wave 2: bright streaks (additive, fast) ────────────────────────
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 4;
    out.push(newParticle({
      x: goalX + (Math.random() - 0.5) * 6,
      y: goalY + (Math.random() - 0.5) * 6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.8,
      color: '#fff8c0',
      size: 1.4 + Math.random() * 1.2,
      life: 22 + Math.random() * 14,
      gravity: 0.06,
      drag: 0.04,
      shape: 'streak',
      blend: 'add',
    }));
  }

  // ── Wave 3: glow puff (single bright additive disc that fades) ────
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    out.push(newParticle({
      x: goalX + Math.cos(angle) * 4,
      y: goalY + Math.sin(angle) * 4,
      vx: Math.cos(angle) * 0.6,
      vy: Math.sin(angle) * 0.6,
      color: '#ffe680',
      size: 6 + Math.random() * 3,
      life: 18 + Math.random() * 8,
      gravity: 0,
      drag: 0.05,
      shape: 'circle',
      blend: 'add',
    }));
  }

  // ── Wave 4: confetti rain (tumbling rectangles from ABOVE) ────────
  const confettiPalette = [color, '#fbbf24', '#f87171', '#60a5fa', '#34d399', '#ffffff'];
  for (let i = 0; i < 32; i++) {
    const startX = goalX + (Math.random() - 0.5) * 140;
    // Spawn just above the canvas; cull threshold is y < -60, so all of
    // these survive the first frame and visibly drop in.
    const startY = -5 - Math.random() * 18;
    out.push(newParticle({
      x: startX, y: startY,
      vx: (Math.random() - 0.5) * 1.8,
      vy: 1.2 + Math.random() * 1.5,
      color: confettiPalette[i % confettiPalette.length],
      size: 1.6 + Math.random() * 1.4,
      life: 130 + Math.random() * 50,
      gravity: 0.06,
      drag: 0.012,
      rotation: Math.random() * Math.PI * 2,
      angularVel: (Math.random() - 0.5) * 0.35,
      shape: 'rect',
      bounces: 1, // one soft bounce off the floor for satisfying landings
      bounceY: floor + 6,
    }));
  }

  return out;
}

/**
 * Tackle / interception sparks — streaky impact lines + tiny dust dots.
 */
export function spawnTackleSparks(cx: number, cy: number): Particle[] {
  const out: Particle[] = [];
  // Streaky impact lines
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2.5 + Math.random() * 2.5;
    out.push(newParticle({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.4,
      color: '#fff8c0',
      size: 1.2 + Math.random() * 0.6,
      life: 14 + Math.random() * 8,
      shape: 'streak',
      blend: 'add',
      gravity: 0.05,
      drag: 0.06,
    }));
  }
  // Tiny dust dots
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 1.5;
    out.push(newParticle({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.6,
      color: '#cccccc',
      size: 0.6 + Math.random() * 0.5,
      life: 18 + Math.random() * 10,
      gravity: 0.18,
      drag: 0.04,
    }));
  }
  return out;
}

/**
 * Grass kick on pass arrival / start — chunks fly opposite to ball direction.
 * (dx, dy) describes the ball's outgoing direction; chunks fan backward.
 */
export function spawnGrassKick(cx: number, cy: number, dx: number, dy: number): Particle[] {
  const out: Particle[] = [];
  // Grass chunks fly opposite to ball direction in a fan
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;
  // Tangent for fan spread
  const tx = -ny, ty = nx;
  for (let i = 0; i < 5; i++) {
    const fan = (Math.random() - 0.5) * 0.8;
    const back = 0.4 + Math.random() * 0.7;
    out.push(newParticle({
      x: cx, y: cy + 1.5,
      vx: -nx * back + tx * fan,
      vy: -ny * back + ty * fan - 0.4,
      color: '#5a7a3e',
      size: 0.7 + Math.random() * 0.6,
      life: 14 + Math.random() * 8,
      gravity: 0.22,
      drag: 0.05,
    }));
  }
  // Two soft dust puffs (additive)
  for (let i = 0; i < 2; i++) {
    out.push(newParticle({
      x: cx + (Math.random() - 0.5) * 4,
      y: cy + 1,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.3 - Math.random() * 0.3,
      color: '#dcd0a8',
      size: 3 + Math.random() * 2,
      life: 14 + Math.random() * 6,
      gravity: 0,
      drag: 0.08,
      blend: 'add',
    }));
  }
  return out;
}

/**
 * Apply per-frame physics, cull dead/off-screen particles, cap at 350,
 * and sort so additive-blend particles render last (so they glow on top).
 *
 * Mutates each Particle in place (cheap, hot path); returns a fresh array
 * containing the survivors (also sorted for render-pass batching).
 */
export function updateAndCullParticles(particles: Particle[], height: number): Particle[] {
  const live: Particle[] = [];
  for (const ptcl of particles) {
    ptcl.life--;
    if (ptcl.life <= 0) continue;
    // Air drag (per-frame velocity decay)
    ptcl.vx *= (1 - ptcl.drag);
    ptcl.vy *= (1 - ptcl.drag);
    ptcl.vy += ptcl.gravity;
    ptcl.x += ptcl.vx;
    ptcl.y += ptcl.vy;
    ptcl.rotation += ptcl.angularVel;
    // Floor bounce
    if (ptcl.bounces > 0 && ptcl.y >= ptcl.bounceY && ptcl.vy > 0) {
      ptcl.y = ptcl.bounceY;
      ptcl.vy = -ptcl.vy * 0.45;
      ptcl.vx *= 0.55;
      ptcl.angularVel *= 0.6;
      ptcl.bounces--;
    }
    // Cull: off-screen far below or above (relaxed for rain-from-above confetti)
    if (ptcl.y > height + 30 || ptcl.y < -60) continue;
    live.push(ptcl);
  }
  // Bound at PARTICLE_CAP — keep youngest if exceeded
  const capped = live.length > PARTICLE_CAP ? live.slice(-PARTICLE_CAP) : live;
  // Render order: normal-blend first, then additive on top so glow stacks visibly.
  capped.sort((a, b) => (a.blend === 'add' ? 1 : 0) - (b.blend === 'add' ? 1 : 0));
  return capped;
}

/**
 * Render all particles. Impure (touches canvas) but only does drawing.
 * Batches state changes by blend mode for far fewer ctx mutations.
 */
export function renderParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  // Normal-blend particles first (so additive ones stack ON TOP and glow).
  let currentBlend: GlobalCompositeOperation = 'source-over';
  for (const ptcl of particles) {
    const a = Math.min(1, (ptcl.life / ptcl.maxLife) * 1.15);
    const wantBlend: GlobalCompositeOperation = ptcl.blend === 'add' ? 'lighter' : 'source-over';
    if (wantBlend !== currentBlend) {
      ctx.globalCompositeOperation = wantBlend;
      currentBlend = wantBlend;
    }
    // Size shrinks as it fades (more lifelike than constant size)
    const sizeMul = ptcl.shape === 'rect' ? 1 : 0.5 + a * 0.5;
    const sz = ptcl.initialSize * sizeMul;

    ctx.globalAlpha = a;
    if (ptcl.shape === 'rect') {
      // Tumbling confetti rectangle
      ctx.save();
      ctx.translate(ptcl.x, ptcl.y);
      ctx.rotate(ptcl.rotation);
      // Width changes with rotation to fake foreshortening
      const wScale = Math.abs(Math.cos(ptcl.rotation));
      ctx.fillStyle = ptcl.color;
      ctx.fillRect(-sz * 1.3 * wScale - 0.3, -sz * 0.45, sz * 2.6 * wScale + 0.6, sz * 0.9);
      ctx.restore();
    } else if (ptcl.shape === 'streak') {
      // Streak: short line trailing the velocity vector
      const speed = Math.hypot(ptcl.vx, ptcl.vy);
      if (speed > 0.001) {
        const trailLen = Math.min(14, speed * 2.2);
        const dirX = ptcl.vx / speed, dirY = ptcl.vy / speed;
        const tailX = ptcl.x - dirX * trailLen;
        const tailY = ptcl.y - dirY * trailLen;
        const grad = ctx.createLinearGradient(tailX, tailY, ptcl.x, ptcl.y);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, ptcl.color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = sz;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(ptcl.x, ptcl.y);
        ctx.stroke();
      }
      // Bright head
      ctx.beginPath();
      ctx.arc(ptcl.x, ptcl.y, sz * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = ptcl.color;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(ptcl.x, ptcl.y, sz, 0, Math.PI * 2);
      ctx.fillStyle = ptcl.color;
      ctx.fill();
    }
  }
  // Reset state
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
