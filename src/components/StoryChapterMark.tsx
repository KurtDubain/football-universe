import type { StorylineType } from '../engine/season/storylines';
import darkHorseArtwork from '../assets/visual/story-dark-horse-v1.webp';
import giantCrisisArtwork from '../assets/visual/story-giant-crisis-v1.webp';
import promotedSurvivalArtwork from '../assets/visual/story-promoted-survival-v1.webp';
import { DecorativeImage } from './DecorativeImage';
import { Icon, type IconName } from './Icon';

const STORY_ARTWORK: Record<StorylineType, string> = {
  dark_horse: darkHorseArtwork,
  giant_crisis: giantCrisisArtwork,
  promoted_survival: promotedSurvivalArtwork,
};

const STORY_FALLBACK: Record<StorylineType, { icon: IconName; className: string }> = {
  dark_horse: { icon: 'trend-up', className: 'text-emerald-300' },
  giant_crisis: { icon: 'warning', className: 'text-red-300' },
  promoted_survival: { icon: 'shield', className: 'text-amber-300' },
};

export function StoryChapterMark({
  type,
  className = '',
}: {
  type: StorylineType;
  className?: string;
}) {
  const fallback = STORY_FALLBACK[type];
  return (
    <span
      className={`story-chapter-mark ${className}`}
      aria-hidden="true"
      data-story-type={type}
    >
      <span className={`absolute inset-0 grid place-items-center ${fallback.className}`}>
        <Icon name={fallback.icon} size={18} />
      </span>
      <DecorativeImage
        src={STORY_ARTWORK[type]}
        className="absolute inset-0 h-full w-full object-cover"
        testId={`story-art-${type}`}
      />
    </span>
  );
}
