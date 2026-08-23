import { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from './Icon';
import { celebrationDuration, type CelebrationType } from './celebration-types';

interface CelebrationProps {
  active: boolean;
  type?: CelebrationType;
  duration?: number; // ms
  seed?: number;
}

const CONFETTI_COLORS = ['#fbbf24', '#f8fafc', '#3fb978', '#7ea6d8', '#df5d62'];
const FIREWORK_COLORS = ['#fbbf24', '#f8fafc', '#43d49e', '#ef7377'];

export default function Celebration({
  active,
  type = 'confetti',
  duration = celebrationDuration(type),
  seed = 1,
}: CelebrationProps) {
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [active, duration]);

  if (!visible) return null;

  if (type === 'streamers') return <StreamersCelebration seed={seed} />;
  if (type === 'fireworks') return <FireworksCelebration seed={seed} withConfetti />;
  if (type === 'trophy') return <TrophyCelebration seed={seed} />;
  return <ConfettiCelebration count={46} seed={seed} />;
}

function ConfettiCelebration({ count, seed }: { count: number; seed: number }) {
  const [particles] = useState(() => {
    let randomSeed = (seed + count) * 2654435761;
    const random = () => {
      randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
      return randomSeed / 0x100000000;
    };
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: random() * 100,
      delay: random() * 2,
      duration: 2 + random() * 3,
      color: CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)],
      width: 3 + random() * 4,
      height: 8 + random() * 10,
      swing: -30 + random() * 60,
      drift: -40 + random() * 80,
    }));
  });

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none overflow-hidden">
      {particles.map(p => (
        <span
          key={p.id}
          className="absolute animate-confetti motion-reduce:hidden"
          style={{
            left: `${p.left}%`,
            top: '-5%',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            width: `${p.width}px`,
            height: `${p.height}px`,
            backgroundColor: p.color,
            borderRadius: '1px',
            transform: `rotate(${p.swing}deg)`,
            '--confetti-drift': `${p.drift}px`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

function StreamersCelebration({ seed }: { seed: number }) {
  const count = 18;
  const streamers = Array.from({ length: count }, (_, index) => {
    const side = index % 2 === 0 ? 'left' : 'right';
    const color = CONFETTI_COLORS[(index + seed) % CONFETTI_COLORS.length];
    const delay = ((index * 37 + seed * 11) % 220) / 1000;
    const offset = 4 + ((index * 29 + seed * 7) % 25);
    return { index, side, color, delay, offset };
  });

  return (
    <div
      data-testid="streamers-celebration"
      className="fixed inset-0 z-[100] pointer-events-none overflow-hidden motion-reduce:hidden"
      aria-hidden="true"
    >
      {streamers.map(streamer => (
        <span
          key={`${streamer.side}:${streamer.index}`}
          className={`celebration-streamer celebration-streamer-${streamer.side}`}
          style={{
            backgroundColor: streamer.color,
            animationDelay: `${streamer.delay}s`,
            [streamer.side]: `${streamer.offset}%`,
          }}
        />
      ))}
    </div>
  );
}

function FireworksCelebration({ seed, withConfetti = false }: { seed: number; withConfetti?: boolean }) {
  const bursts = [
    { left: 22, top: 25, delay: 0.05 },
    { left: 74, top: 19, delay: 0.38 },
    { left: 52, top: 34, delay: 0.72 },
  ];

  return (
    <div
      data-testid="fireworks-celebration"
      className="fixed inset-0 z-[100] pointer-events-none overflow-hidden motion-reduce:hidden"
      aria-hidden="true"
    >
      {bursts.map((burst, burstIndex) => (
        <span
          key={burstIndex}
          className="celebration-firework"
          style={{ left: `${burst.left}%`, top: `${burst.top}%`, animationDelay: `${burst.delay}s` }}
        >
          {Array.from({ length: 12 }, (_, rayIndex) => (
            <i
              key={rayIndex}
              style={{
                '--firework-angle': `${rayIndex * 30}deg`,
                '--firework-distance': `${34 + ((rayIndex + burstIndex + seed) % 4) * 6}px`,
                '--firework-color': FIREWORK_COLORS[(rayIndex + burstIndex + seed) % FIREWORK_COLORS.length],
                animationDelay: `${burst.delay}s`,
              } as CSSProperties}
            />
          ))}
        </span>
      ))}
      {withConfetti && <ConfettiCelebration count={28} seed={seed + 17} />}
    </div>
  );
}

function TrophyCelebration({ seed }: { seed: number }) {
  return (
    <div
      data-testid="trophy-celebration"
      className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center"
      aria-hidden="true"
    >
      <div className="animate-trophy-reveal flex h-24 w-24 items-center justify-center rounded-full border border-amber-300/55 bg-slate-950/90 shadow-2xl shadow-amber-500/20 motion-reduce:animate-none">
        <Icon name="trophy" size={58} accent="#fbbf24" />
      </div>
      <FireworksCelebration seed={seed} />
      <ConfettiCelebration count={54} seed={seed + 31} />
    </div>
  );
}
