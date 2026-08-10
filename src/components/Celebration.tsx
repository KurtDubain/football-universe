import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface CelebrationProps {
  active: boolean;
  type?: 'confetti' | 'fireworks' | 'trophy';
  duration?: number; // ms
}

const CONFETTI_COLORS = ['#fbbf24', '#f8fafc', '#3fb978', '#7ea6d8', '#df5d62'];

export default function Celebration({ active, type = 'confetti', duration = 4000 }: CelebrationProps) {
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [active, duration]);

  if (!visible) return null;

  if (type === 'trophy') return <TrophyCelebration />;
  return <ConfettiCelebration count={type === 'fireworks' ? 60 : 40} />;
}

function ConfettiCelebration({ count }: { count: number }) {
  const [particles] = useState(() => {
    let seed = count * 2654435761;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
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
          }}
        />
      ))}
    </div>
  );
}

function TrophyCelebration() {
  return (
    <div
      data-testid="trophy-celebration"
      className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center"
      aria-hidden="true"
    >
      <div className="animate-trophy-reveal flex h-24 w-24 items-center justify-center rounded-full border border-amber-300/55 bg-slate-950/90 shadow-2xl shadow-amber-500/20 motion-reduce:animate-none">
        <Icon name="trophy" size={58} accent="#fbbf24" />
      </div>
      <ConfettiCelebration count={50} />
    </div>
  );
}
