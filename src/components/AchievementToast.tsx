import { useEffect, useState } from 'react';
import type { Achievement } from '../engine/achievements';

interface Props {
  achievement: Achievement;
  onDismiss: () => void;
}

const ACHIEVEMENT_EMOJI: Record<string, string> = {
  // Statistical
  unbeaten: '🛡️',
  dominant: '👑',
  centurion: '💯',
  goal_machine: '⚽',
  iron_wall: '🧱',
  avalanche: '🔥',
  massacre: '💥',
  // First-time
  promotion_streak: '🚀',
  first_promotion: '⬆️',
  first_relegation: '⬇️',
  first_league_title: '🏆',
  first_cup: '🥇',
  first_super_cup: '⭐',
  first_world_cup: '🌍',
  // Dynasty
  back_to_back: '👑',
  three_peat: '👑',
  five_peat: '🏛️',
  cup_dynasty: '🏆',
  // Multi-crown
  double_crown: '🏆',
  triple_crown: '🏆',
  quadruple: '🏆',
  // Underdog
  underdog_promo_to_top: '🌱',
  rookie_champion: '⚡',
  comeback: '🔥',
  // Heartbreak
  almost_perfect: '😢',
  rock_bottom: '💔',
  no_wins: '😭',
  // Long-term
  survivor_5: '🌲',
  collector_3: '🎖️',
  legend_team: '🌟',
};

export default function AchievementToast({ achievement, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const fadeIn = setTimeout(() => setVisible(true), 50);
    const fadeOut = setTimeout(() => setVisible(false), 2800);
    const dismiss = setTimeout(onDismiss, 3200);
    return () => { clearTimeout(fadeIn); clearTimeout(fadeOut); clearTimeout(dismiss); };
  }, [achievement.id, onDismiss]);

  // Get emoji from achievement id (extract base id like 'unbeaten' from 'unbeaten-teamId-S1')
  const baseId = achievement.id.split('-')[0];
  const emoji = ACHIEVEMENT_EMOJI[baseId] ?? '🏆';

  return (
    <div
      className={`fixed top-20 left-1/2 -translate-x-1/2 z-[200] transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
      onClick={onDismiss}
    >
      <div className="bg-gradient-to-r from-amber-900/90 via-amber-800/90 to-amber-900/90 backdrop-blur-sm border border-amber-600/50 rounded-xl shadow-2xl px-5 py-3 flex items-center gap-3 cursor-pointer animate-glow-pulse">
        <span className="text-3xl shrink-0">{emoji}</span>
        <div>
          <div className="text-[10px] text-amber-300 font-semibold uppercase tracking-wider">成就解锁</div>
          <div className="text-sm font-bold text-white">{achievement.title}</div>
          <div className="text-xs text-amber-100/80 mt-0.5">{achievement.description}</div>
        </div>
      </div>
    </div>
  );
}
