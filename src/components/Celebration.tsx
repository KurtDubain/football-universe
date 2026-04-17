import { useEffect, useState, useMemo } from 'react';
import { isDerby, getDerbyName } from '../config/derbies';

interface CelebrationProps {
  active: boolean;
  type?: 'confetti' | 'fireworks' | 'trophy';
  duration?: number; // ms
}

const CONFETTI_COLORS = ['#fbbf24', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];
const CONFETTI_SHAPES = ['■', '●', '▲', '★', '◆', '♦', '✦'];

export default function Celebration({ active, type = 'confetti', duration = 4000 }: CelebrationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), duration);
      return () => clearTimeout(timer);
    }
  }, [active, duration]);

  if (!visible) return null;

  if (type === 'trophy') return <TrophyCelebration />;
  return <ConfettiCelebration count={type === 'fireworks' ? 60 : 40} />;
}

function ConfettiCelebration({ count }: { count: number }) {
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 2 + Math.random() * 3,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      shape: CONFETTI_SHAPES[Math.floor(Math.random() * CONFETTI_SHAPES.length)],
      size: 8 + Math.random() * 14,
      swing: -30 + Math.random() * 60,
    }));
  }, [count]);

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

// ── Match tag helpers ──

export type MatchTag = {
  label: string;
  color: string; // tailwind classes
  glow?: boolean;
};

/**
 * Determine special tags for a fixture based on context.
 */
export function getMatchTags(
  competitionType: string,
  roundLabel: string,
  homeTeamId: string,
  awayTeamId: string,
  standings?: { teamId: string }[] | null,
  leagueSize?: number,
): MatchTag[] {
  const tags: MatchTag[] = [];
  const rl = roundLabel.toLowerCase();

  // Derby check
  if (isDerby(homeTeamId, awayTeamId)) {
    const derbyName = getDerbyName(homeTeamId, awayTeamId);
    tags.push({ label: derbyName ?? '德比战', color: 'bg-orange-600 text-white', glow: true });
  }

  // Cup finals
  if (rl.includes('final') || rl.includes('决赛') || roundLabel === 'Final') {
    tags.push({ label: '决赛', color: 'bg-amber-500 text-white', glow: true });
  }
  // Semi-finals
  else if (rl.includes('sf') || rl.includes('四强')) {
    tags.push({ label: '四强', color: 'bg-purple-600 text-white' });
  }
  // Quarter-finals
  else if (rl.includes('qf') || rl.includes('八强')) {
    tags.push({ label: '八强', color: 'bg-blue-600 text-white' });
  }

  // Relegation playoff
  if (competitionType === 'relegation_playoff') {
    tags.push({ label: '保级战', color: 'bg-red-600 text-white', glow: true });
  }

  // League context tags
  if (competitionType === 'league' && standings && leagueSize) {
    const homePos = standings.findIndex(s => s.teamId === homeTeamId) + 1;
    const awayPos = standings.findIndex(s => s.teamId === awayTeamId) + 1;

    if (homePos > 0 && awayPos > 0) {
      // Title decider
      if (homePos <= 2 && awayPos <= 2 && standings[0] && (standings[0] as any).played > 10) {
        tags.push({ label: '冠军战', color: 'bg-amber-600 text-white', glow: true });
      }
      // Relegation six-pointer
      else if (homePos >= leagueSize - 2 && awayPos >= leagueSize - 2) {
        tags.push({ label: '保级战', color: 'bg-red-600 text-white' });
      }
      // Top vs bottom
      else if ((homePos <= 3 && awayPos >= leagueSize - 2) || (awayPos <= 3 && homePos >= leagueSize - 2)) {
        tags.push({ label: '强弱对话', color: 'bg-slate-600 text-white' });
      }
    }
  }

  // World cup / super cup group "dead rubber" or "must-win"
  if ((competitionType === 'super_cup_group' || competitionType === 'world_cup_group') && rl.includes('6')) {
    tags.push({ label: '生死战', color: 'bg-red-500 text-white' });
  }

  // League endgame — last 3 rounds (check if round number is high)
  if (competitionType === 'league' && standings && leagueSize) {
    const totalPlayed = (standings[0] as any)?.played ?? 0;
    // For top league 30 rounds: endgame at round 28+
    // For mid/low 14 rounds: endgame at round 12+
    const maxRounds = leagueSize >= 16 ? 30 : 14;
    if (totalPlayed >= maxRounds - 3 && totalPlayed > 5) {
      tags.push({ label: '收官之战', color: 'bg-emerald-700 text-white' });
    }
  }

  return tags;
}

/**
 * Should we trigger a celebration after this window's results?
 */
export function shouldCelebrate(
  windowType: string,
  roundLabel: string,
  results: { competitionType: string; roundLabel: string }[],
): 'trophy' | 'confetti' | null {
  // Cup finals completed
  const hasFinal = results.some(r =>
    r.roundLabel === 'Final' || r.roundLabel === '决赛'
  );
  if (hasFinal) return 'trophy';

  // Season end
  if (windowType === 'season_end') return 'confetti';

  // Relegation playoff
  if (windowType === 'relegation_playoff') return 'confetti';

  return null;
}
