import type { NewsItem } from '../engine/season/season-manager';
import stageArtwork from '../assets/visual/world-moment-stage-v1.webp';
import riseArtwork from '../assets/visual/world-moment-rise-v1.webp';
import fallArtwork from '../assets/visual/world-moment-fall-v1.webp';
import legacyArtwork from '../assets/visual/world-moment-legacy-v1.webp';
import transferArtwork from '../assets/visual/world-moment-transfer-v1.webp';
import { DecorativeImage } from './DecorativeImage';
import { Icon, type IconName } from './Icon';
import { worldMomentKindForNews, type WorldMomentKind } from './world-moment';

const PRESENTATION: Record<WorldMomentKind, {
  artwork: string;
  label: string;
  icon: IconName;
  accent: string;
}> = {
  stage: { artwork: stageArtwork, label: '赛事舞台', icon: 'trophy', accent: 'text-sky-200' },
  rise: { artwork: riseArtwork, label: '命运上升', icon: 'trend-up', accent: 'text-emerald-200' },
  fall: { artwork: fallArtwork, label: '命运转折', icon: 'warning', accent: 'text-rose-200' },
  legacy: { artwork: legacyArtwork, label: '人物时刻', icon: 'medal', accent: 'text-amber-200' },
  transfer: { artwork: transferArtwork, label: '转会之夜', icon: 'megaphone', accent: 'text-blue-200' },
};

type WorldMomentFeatureProps =
  | { news: NewsItem; kind?: never; title?: never; description?: never; seasonNumber?: never }
  | {
      news?: never;
      kind: WorldMomentKind;
      title: string;
      description: string;
      seasonNumber: number;
    };

export function WorldMomentFeature(props: WorldMomentFeatureProps) {
  const kind = props.news ? worldMomentKindForNews(props.news) : props.kind;
  if (!kind) return null;
  const presentation = PRESENTATION[kind];
  const title = props.news ? props.news.title : props.title;
  const description = props.news ? props.news.description : props.description;
  const seasonNumber = props.news ? props.news.seasonNumber : props.seasonNumber;

  return (
    <article
      data-testid="world-moment-feature"
      data-moment-kind={kind}
      className="relative min-h-[176px] overflow-hidden rounded-md border border-slate-700/80 bg-slate-950 sm:min-h-[208px]"
    >
      <DecorativeImage
        src={presentation.artwork}
        className="absolute inset-0 h-full w-full object-cover"
        testId={`world-moment-art-${kind}`}
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,7,13,0.97)_0%,rgba(3,7,13,0.82)_42%,rgba(3,7,13,0.16)_78%,rgba(3,7,13,0.28)_100%)]" />
      <div className="relative flex min-h-[176px] max-w-[78%] flex-col justify-end px-4 py-4 sm:min-h-[208px] sm:max-w-[62%] sm:px-5 sm:py-5">
        <div className={`mb-2 flex items-center gap-1.5 text-[11px] font-semibold ${presentation.accent}`}>
          <Icon name={presentation.icon} size={14} />
          <span>{presentation.label}</span>
          <span className="text-slate-500">S{seasonNumber}</span>
        </div>
        <h4 className="text-base font-bold leading-6 text-white sm:text-lg">{title}</h4>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">{description}</p>
      </div>
    </article>
  );
}
