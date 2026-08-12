import { Link } from 'react-router-dom';
import type {
  NarrativeDestination,
  NarrativeDigest as NarrativeDigestData,
  NarrativeItem,
  NarrativeSource,
} from '../engine/observation/narrative-types';
import { Icon, type IconName } from './Icon';
import { StoryChapterMark } from './StoryChapterMark';

const SOURCE_PRESENTATION: Record<NarrativeSource, { label: string; icon: IconName; tone: string }> = {
  observation_theme: { label: '观察主题', icon: 'eye', tone: 'text-emerald-300' },
  storyline: { label: '持续故事', icon: 'trend-up', tone: 'text-emerald-300' },
  focus_fixture: { label: '焦点赛程', icon: 'stadium', tone: 'text-amber-300' },
  window_signal: { label: '本轮信号', icon: 'bolt', tone: 'text-sky-300' },
  player_highlight: { label: '球员时刻', icon: 'star-glow', tone: 'text-amber-300' },
  player_story: { label: '球员近况', icon: 'star-glow', tone: 'text-amber-300' },
  coach_pressure: { label: '教练席', icon: 'tie', tone: 'text-rose-300' },
  coach_story: { label: '教练轨迹', icon: 'tie', tone: 'text-violet-300' },
  transfer_rumor: { label: '转会观察', icon: 'handshake', tone: 'text-blue-300' },
  transfer: { label: '转会落点', icon: 'handshake', tone: 'text-cyan-300' },
  competition: { label: '赛事格局', icon: 'trophy', tone: 'text-amber-300' },
  record: { label: '纪录追逐', icon: 'medal', tone: 'text-amber-200' },
  match_result: { label: '比赛结果', icon: 'ball', tone: 'text-sky-300' },
  news: { label: '世界动态', icon: 'news', tone: 'text-slate-300' },
};

function DestinationAction({
  destination,
  onFixtureClick,
}: {
  destination: NarrativeDestination;
  onFixtureClick?: (fixtureId: string) => void;
}) {
  const className = 'inline-flex min-h-11 items-center gap-1 text-[11px] font-semibold text-blue-300 hover:text-blue-200';
  if (destination.fixtureId && onFixtureClick) {
    return (
      <button
        type="button"
        onClick={() => onFixtureClick(destination.fixtureId!)}
        className={className}
      >
        {destination.label}
        <Icon name="arrow-up" size={12} className="rotate-45" />
      </button>
    );
  }
  if (destination.to) {
    return (
      <Link to={destination.to} className={className}>
        {destination.label}
        <Icon name="arrow-up" size={12} className="rotate-45" />
      </Link>
    );
  }
  return null;
}

function NarrativeMark({ item }: { item: NarrativeItem }) {
  if (item.storylineType) {
    return <StoryChapterMark type={item.storylineType} className="mt-0.5" />;
  }
  const presentation = SOURCE_PRESENTATION[item.source];
  return (
    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-slate-700/70 bg-slate-900/65 ${presentation.tone}`}>
      <Icon name={presentation.icon} size={16} />
    </span>
  );
}

function SignalRow({
  item,
  onFixtureClick,
  compact = false,
}: {
  item: NarrativeItem;
  onFixtureClick?: (fixtureId: string) => void;
  compact?: boolean;
}) {
  const presentation = SOURCE_PRESENTATION[item.source];
  const destination = item.destinations?.[0];
  return (
    <div
      data-narrative-arc={item.arcKey}
      data-narrative-source={item.source}
      data-fixture-id={item.fixtureIds?.[0]}
      className="flex min-w-0 items-start gap-2 border-t border-slate-700/40 py-2.5 first:border-t-0"
    >
      {item.storylineType ? (
        <StoryChapterMark type={item.storylineType} className="story-chapter-mark-compact mt-0.5" />
      ) : (
        <Icon name={presentation.icon} size={15} className={`mt-0.5 shrink-0 ${presentation.tone}`} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`shrink-0 text-[11px] font-semibold ${presentation.tone}`}>{presentation.label}</span>
          <span className="min-w-0 text-xs font-semibold text-slate-200">{item.title}</span>
        </div>
        <p className={`${compact ? 'line-clamp-1' : 'line-clamp-2'} mt-0.5 text-[11px] leading-4 text-slate-500`}>
          {item.summary}
        </p>
      </div>
      {destination && (
        <DestinationAction destination={destination} onFixtureClick={onFixtureClick} />
      )}
    </div>
  );
}

function FactGroup({
  label,
  facts,
}: {
  label: string;
  facts: NarrativeItem['evidence'];
}) {
  if (!facts || facts.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-500">{label}</div>
      <div className="mt-1 space-y-1">
        {facts.slice(0, 4).map(item => (
          <p key={item.key} className="text-[11px] leading-5 text-slate-400">
            <span className="font-medium text-slate-300">{item.label}</span> · {item.detail}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function NarrativeDigest({
  digest,
  windowLabel,
  onFixtureClick,
}: {
  digest: NarrativeDigestData;
  windowLabel: string;
  onFixtureClick?: (fixtureId: string) => void;
}) {
  const visibleCount = Number(Boolean(digest.feature)) + digest.signals.length + digest.more.length;
  if (visibleCount === 0) return null;
  const featurePresentation = digest.feature ? SOURCE_PRESENTATION[digest.feature.source] : null;
  const featureEvidence = digest.feature?.evidence?.filter(item => (
    !digest.feature?.summary.includes(item.detail)
  )) ?? [];
  const legacyWindowSignals = digest.more.filter(item => (
    item.source === 'window_signal' || item.source === 'coach_pressure'
  ));

  return (
    <section
      data-testid="world-pulse"
      className="border-y border-slate-700/60 bg-slate-950/20"
    >
      <div className="flex min-h-11 items-center gap-2 px-3 py-2">
        <Icon name="burst" size={16} className="shrink-0 text-emerald-300" />
        <h3 className="text-xs font-semibold text-slate-100">世界脉搏</h3>
        <span className="text-[11px] text-slate-600">精选，不改变模拟</span>
        <span className="ml-auto max-w-[42%] truncate text-right text-[11px] text-slate-500" title={windowLabel}>
          {windowLabel}
        </span>
      </div>

      <div data-testid="storyline-signals">
        {digest.feature && featurePresentation && (
          <article
            data-testid="narrative-feature"
            data-narrative-arc={digest.feature.arcKey}
            data-narrative-source={digest.feature.source}
            className="border-t border-emerald-800/45 px-3 py-3"
          >
            <div className="flex items-start gap-2.5">
              <NarrativeMark item={digest.feature} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`text-[11px] font-semibold ${featurePresentation.tone}`}>
                    {featurePresentation.label}
                  </span>
                  {digest.feature.seasonPhase && (
                    <span className="text-[11px] text-slate-600">{digest.feature.seasonPhase}</span>
                  )}
                </div>
                <h4 className="mt-0.5 text-sm font-semibold leading-5 text-slate-100">
                  {digest.feature.title}
                </h4>
                <p className="mt-1 text-xs leading-5 text-slate-400">{digest.feature.summary}</p>
                {featureEvidence.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {featureEvidence.slice(0, 2).map(item => (
                      <span key={item.key}>{item.detail}</span>
                    ))}
                  </div>
                )}
                {digest.feature.nextWatch && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-300">
                    <Icon name="target" size={14} className="mt-0.5 shrink-0 text-amber-400" />
                    <span>下一观察：{digest.feature.nextWatch}</span>
                  </p>
                )}
                {(digest.feature.destinations?.length ?? 0) > 0 && (
                  <div className="mt-1 flex flex-wrap gap-3">
                    {digest.feature.destinations?.slice(0, 2).map(destination => (
                      <DestinationAction
                        key={destination.key}
                        destination={destination}
                        onFixtureClick={onFixtureClick}
                      />
                    ))}
                  </div>
                )}
                {(digest.feature.causes?.length
                  || digest.feature.evidence?.length
                  || digest.feature.turningPoints?.length
                  || digest.feature.consequences?.length) && (
                  <details data-testid="narrative-later" className="mt-2 border-t border-slate-700/45 pt-1.5">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
                      <Icon name="clipboard" size={14} />
                      <span>展开故事脉络</span>
                      <Icon name="arrow-down" size={13} className="ml-auto details-chevron" />
                    </summary>
                    <div className="space-y-2.5 pb-1">
                      <FactGroup label="赛前背景" facts={digest.feature.causes} />
                      <FactGroup label="已有证据" facts={digest.feature.evidence} />
                      <FactGroup label="关键转折" facts={digest.feature.turningPoints} />
                      <FactGroup label="随后发生" facts={digest.feature.consequences} />
                    </div>
                  </details>
                )}
              </div>
            </div>
          </article>
        )}

        {digest.signals.length > 0 && (
          <div data-testid="narrative-signals" className="border-t border-slate-700/45 px-3">
            {digest.signals.map(item => (
              <SignalRow key={item.id} item={item} onFixtureClick={onFixtureClick} compact />
            ))}
          </div>
        )}
      </div>

      {digest.more.length > 0 && (
        <details data-testid="more-world-signals" className="border-t border-slate-700/45">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold text-slate-400 hover:text-slate-200">
            <Icon name="news" size={15} />
            <span>更多本轮线索</span>
            <span className="text-[11px] font-normal text-slate-600">{digest.more.length}条，已去重</span>
            <Icon name="arrow-down" size={14} className="ml-auto details-chevron" />
          </summary>
          <div className="px-3 pb-1">
            {digest.more.map(item => (
              <SignalRow key={item.id} item={item} onFixtureClick={onFixtureClick} />
            ))}
          </div>
          <div data-testid="secondary-match-notices" className="hidden" aria-hidden="true">
            {legacyWindowSignals.map(item => (
              <span key={item.id} data-fixture-id={item.fixtureIds?.[0]} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
