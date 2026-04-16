import { useEffect, useRef } from 'react';

/**
 * Floating football particles background — used on Welcome page.
 * Soft glowing orbs + tiny football icons drifting slowly.
 */
export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let w = 0, h = 0;

    const particles: { x: number; y: number; vx: number; vy: number; r: number; alpha: number; color: string; type: 'orb' | 'icon' }[] = [];
    const colors = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4'];
    const icons = ['⚽', '🏆', '⭐', '🥅'];

    function resize() {
      w = canvas!.parentElement?.clientWidth ?? window.innerWidth;
      h = canvas!.parentElement?.clientHeight ?? window.innerHeight;
      canvas!.width = w;
      canvas!.height = h;
    }

    function init() {
      resize();
      particles.length = 0;
      const count = Math.floor((w * h) / 15000);
      for (let i = 0; i < count; i++) {
        const isIcon = Math.random() < 0.15;
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.2 - 0.1,
          r: isIcon ? 10 : 1.5 + Math.random() * 3,
          alpha: isIcon ? 0.12 : 0.06 + Math.random() * 0.08,
          color: colors[Math.floor(Math.random() * colors.length)],
          type: isIcon ? 'icon' : 'orb',
        });
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;

        if (p.type === 'icon') {
          ctx!.globalAlpha = p.alpha;
          ctx!.font = `${p.r * 2}px serif`;
          ctx!.fillText(icons[Math.floor(p.x * 13 % icons.length)], p.x, p.y);
        } else {
          ctx!.globalAlpha = p.alpha;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx!.fillStyle = p.color;
          ctx!.fill();
        }
      }
      ctx!.globalAlpha = 1;
      animId = requestAnimationFrame(draw);
    }

    init();
    draw();
    window.addEventListener('resize', init);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', init);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}

/**
 * Energy wave effect — pulsing rings that expand from center.
 * Used during match result reveal for key matches.
 */
export function EnergyWave({ color = '#3b82f6', active = true }: { color?: string; active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.parentElement?.clientWidth ?? 300;
    const h = canvas.height = canvas.parentElement?.clientHeight ?? 80;
    const cx = w / 2, cy = h / 2;

    const rings: { r: number; alpha: number; speed: number }[] = [];
    let animId: number;

    function spawnRing() {
      rings.push({ r: 5, alpha: 0.4, speed: 1.5 + Math.random() * 2 });
    }

    let frame = 0;
    function draw() {
      ctx!.clearRect(0, 0, w, h);
      frame++;
      if (frame % 30 === 0) spawnRing();

      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.r += ring.speed;
        ring.alpha -= 0.005;
        if (ring.alpha <= 0) { rings.splice(i, 1); continue; }

        ctx!.beginPath();
        ctx!.arc(cx, cy, ring.r, 0, Math.PI * 2);
        ctx!.strokeStyle = color;
        ctx!.globalAlpha = ring.alpha;
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
      animId = requestAnimationFrame(draw);
    }

    spawnRing();
    draw();
    return () => cancelAnimationFrame(animId);
  }, [active, color]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}

/**
 * Ambient glow particles — subtle flowing dots for sidebar/header decoration.
 */
export function AmbientGlow({ height = 200 }: { height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.parentElement?.clientWidth ?? 200;
    const h = canvas.height = height;

    const dots: { x: number; y: number; vy: number; r: number; alpha: number }[] = [];
    for (let i = 0; i < 12; i++) {
      dots.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vy: -0.2 - Math.random() * 0.3,
        r: 1 + Math.random() * 2,
        alpha: 0.1 + Math.random() * 0.15,
      });
    }

    let animId: number;
    function draw() {
      ctx!.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y += d.vy;
        if (d.y < -5) { d.y = h + 5; d.x = Math.random() * w; }
        ctx!.globalAlpha = d.alpha;
        ctx!.beginPath();
        ctx!.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx!.fillStyle = '#3b82f6';
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [height]);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none opacity-60" />;
}
