import { useEffect, useState } from 'react';
import type { Achievement } from '../engine/achievements';
import { Icon, IconName } from './Icon';

interface Props {
  achievement: Achievement;
  onDismiss: () => void;
}

const ACHIEVEMENT_ICON: Record<string, IconName> = {
  // Statistical
  unbeaten: 'shield',
  dominant: 'crown',
  centurion: 'star',
  goal_machine: 'ball',
  iron_wall: 'shield',
  avalanche: 'fire',
  massacre: 'burst',
  // First-time
  promotion_streak: 'rocket',
  first_promotion: 'arrow-up',
  first_relegation: 'arrow-down',
  first_league_title: 'trophy',
  first_cup: 'medal',
  first_super_cup: 'star',
  first_world_cup: 'trophy',
  // Dynasty
  back_to_back: 'crown',
  three_peat: 'crown',
  five_peat: 'building',
  cup_dynasty: 'trophy',
  // Multi-crown
  double_crown: 'trophy',
  triple_crown: 'trophy',
  quadruple: 'trophy',
  // Underdog
  underdog_promo_to_top: 'leaf',
  rookie_champion: 'bolt',
  comeback: 'fire',
  // Heartbreak
  almost_perfect: 'star',
  rock_bottom: 'arrow-down',
  no_wins: 'x',
  // Long-term
  survivor_5: 'leaf',
  collector_3: 'medal',
  legend_team: 'star-glow',
};

export default function AchievementToast({ achievement, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const fadeIn = setTimeout(() => setVisible(true), 50);
    const fadeOut = setTimeout(() => setVisible(false), 2800);
    const dismiss = setTimeout(onDismiss, 3200);
    return () => { clearTimeout(fadeIn); clearTimeout(fadeOut); clearTimeout(dismiss); };
  }, [achievement.id, onDismiss]);

  // Get icon from achievement id (extract base id like 'unbeaten' from 'unbeaten-teamId-S1')
  const baseId = achievement.id.split('-')[0];
  const iconName = ACHIEVEMENT_ICON[baseId] ?? 'trophy';

  return (
    <div
      className={`fixed top-20 left-1/2 -translate-x-1/2 z-[200] transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
      onClick={onDismiss}
    >
      <div className="bg-gradient-to-r from-amber-900/90 via-amber-800/90 to-amber-900/90 backdrop-blur-sm border border-amber-600/50 rounded-xl shadow-2xl px-5 py-3 flex items-center gap-3 cursor-pointer animate-glow-pulse">
        <span className="shrink-0 text-amber-300">
          <Icon name={iconName} size={32} accent="#fbbf24" />
        </span>
        <div>
          <div className="text-[10px] text-amber-300 font-semibold uppercase tracking-wider">成就解锁</div>
          <div className="text-sm font-bold text-white">{achievement.title}</div>
          <div className="text-xs text-amber-100/80 mt-0.5">{achievement.description}</div>
        </div>
      </div>
    </div>
  );
}
