import { useEffect, useState } from 'react';
import type { Achievement } from '../engine/achievements';
import { Icon, IconName } from './Icon';

interface Props {
  achievements: Achievement[];
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

export default function AchievementToast({ achievements, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const achievement = achievements[0];
  const batchKey = achievements.map(item => item.id).join('|');

  useEffect(() => {
    const fadeIn = setTimeout(() => setVisible(true), 50);
    const fadeOut = setTimeout(() => setVisible(false), 2800);
    const dismiss = setTimeout(onDismiss, 3200);
    return () => { clearTimeout(fadeIn); clearTimeout(fadeOut); clearTimeout(dismiss); };
  }, [batchKey, onDismiss]);

  if (!achievement) return null;

  // Get icon from achievement id (extract base id like 'unbeaten' from 'unbeaten-teamId-S1')
  const baseId = achievement.id.split('-')[0];
  const iconName = achievements.length > 1 ? 'trophy' : ACHIEVEMENT_ICON[baseId] ?? 'trophy';
  const isSummary = achievements.length > 1;
  const summaryTitles = achievements.slice(0, 3).map(item => item.title).join('、');

  return (
    <div
      aria-live="polite"
      data-testid="achievement-toast"
      className={`achievement-toast-shell fixed top-[calc(env(safe-area-inset-top)+6rem)] left-3 right-3 sm:top-20 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[200] transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
      }`}
    >
      <button
        type="button"
        aria-label={isSummary
          ? `本季解锁${achievements.length}项成就，关闭提示`
          : `成就解锁：${achievement.title}，关闭提示`}
        onClick={onDismiss}
        className="w-full sm:w-[22rem] bg-slate-950/95 backdrop-blur-md border border-amber-500/60 rounded-lg shadow-2xl px-4 py-3 flex items-center gap-3 text-left cursor-pointer animate-glow-pulse hover:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        <span className="shrink-0 text-amber-300">
          <Icon name={iconName} size={32} accent="#fbbf24" />
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] text-amber-300 font-semibold uppercase tracking-wider">
            {isSummary ? '赛季成就入档' : '成就解锁'}
          </span>
          <span className="block text-sm font-bold text-white break-words">
            {isSummary ? `本季解锁 ${achievements.length} 项` : achievement.title}
          </span>
          <span className="block text-xs text-amber-100/80 mt-0.5 break-words">
            {isSummary
              ? `${summaryTitles}${achievements.length > 3 ? `等${achievements.length}项` : ''}，已全部写入成就档案。`
              : achievement.description}
          </span>
        </span>
      </button>
    </div>
  );
}
