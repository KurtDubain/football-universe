import { useEffect, useState } from 'react';

interface CelebrationProps {
  active: boolean;
  type?: 'confetti' | 'fireworks' | 'trophy';
  duration?: number; // ms
}

const CONFETTI_COLORS = ['#fbbf24', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];
const CONFETTI_SHAPES = ['■', '●', '▲', '★', '◆', '♦', '✦'];

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
      shape: CONFETTI_SHAPES[Math.floor(random() * CONFETTI_SHAPES.length)],
      size: 8 + random() * 14,
      swing: -30 + random() * 60,
    }));
  });

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none overflow-hidden">
      {particles.map(p => (
        <span
          key={p.id}
          className="absolute animate-confetti"
          style={{
            left: `${p.left}%`,
            top: '-5%',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            color: p.color,
            fontSize: `${p.size}px`,
            transform: `rotate(${p.swing}deg)`,
          }}
        >
          {p.shape}
        </span>
      ))}
    </div>
  );
}

function TrophyCelebration() {
  return (
    <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center">
      <div className="animate-trophy-bounce text-center">
        <div className="text-7xl mb-2">🏆</div>
      </div>
      <ConfettiCelebration count={50} />
    </div>
  );
}
