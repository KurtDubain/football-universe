import { useEffect, useRef, useState } from 'react';
import type { LiveCommentaryEntry } from './live-commentary';
import { Icon, type IconName } from '../Icon';

const EVENT_ICONS: Record<string, { name: IconName; accent?: string }> = {
  goal: { name: 'ball' },
  penalty_goal: { name: 'ball', accent: '#fbbf24' },
  own_goal: { name: 'ball', accent: '#ef4444' },
  yellow_card: { name: 'warning', accent: '#facc15' },
  red_card: { name: 'warning', accent: '#ef4444' },
  save: { name: 'gloves' },
  miss: { name: 'x' },
  penalty_miss: { name: 'x', accent: '#fbbf24' },
  gk_save: { name: 'gloves', accent: '#3b82f6' },
  df_block: { name: 'shield', accent: '#3b82f6' },
  assist: { name: 'sparkle', accent: '#a78bfa' },
  substitution: { name: 'refresh', accent: '#38bdf8' },
  corner: { name: 'flag', accent: '#fbbf24' },
  free_kick: { name: 'whistle', accent: '#7dd3fc' },
};

interface Props {
  currentCommentary: string;
  entries: LiveCommentaryEntry[];
  homeTeamId: string;
  homeColor?: string;
  awayColor?: string;
}

export default function LiveCommentaryFeed({
  currentCommentary,
  entries,
  homeTeamId,
  homeColor,
  awayColor,
}: Props) {
  const [followingLiveFeed, setFollowingLiveFeed] = useState(true);
  const [unseenEventCount, setUnseenEventCount] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const previousCountRef = useRef<number | null>(null);

  useEffect(() => {
    const previousCount = previousCountRef.current;
    previousCountRef.current = entries.length;
    if (previousCount === null) return;
    const added = Math.max(0, entries.length - previousCount);
    if (added === 0) return;
    if (!followingLiveFeed) {
      setUnseenEventCount(count => count + added);
      return;
    }
    const timer = window.setTimeout(() => {
      logRef.current?.scrollTo?.({ top: 0, behavior: 'auto' });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [entries.length, followingLiveFeed]);

  const followLatest = () => {
    setFollowingLiveFeed(true);
    setUnseenEventCount(0);
    logRef.current?.scrollTo?.({ top: 0, behavior: 'auto' });
  };

  return (
    <aside className="broadcast-commentary min-w-0 border-t border-slate-800/70 lg:border-l lg:border-t-0">
      <div className="min-h-16 border-b border-slate-800/70 px-4 py-3">
        <div className="mb-1 text-[9px] font-semibold text-slate-500">当前播报</div>
        <p className="text-[12px] leading-5 text-emerald-300/90 animate-slide-up" key={currentCommentary}>
          {currentCommentary}
        </p>
      </div>

      <div className="relative">
        <div className="flex h-8 items-center justify-between border-b border-slate-800/50 px-4 text-[9px] font-semibold text-slate-500">
          <span>本场完整播报</span>
          <span className="tabular-nums">{entries.length} 条</span>
        </div>
        {unseenEventCount > 0 && (
          <button
            type="button"
            data-testid="new-live-events"
            onClick={followLatest}
            className="absolute right-3 top-2 z-10 min-h-9 rounded-md border border-emerald-500/30 bg-emerald-950 px-2 text-[10px] text-emerald-300 shadow-lg"
          >{unseenEventCount} 条新战况</button>
        )}
        <div
          ref={logRef}
          data-testid="live-event-log"
          onPointerDown={() => setFollowingLiveFeed(false)}
          onTouchStart={() => setFollowingLiveFeed(false)}
          onWheel={() => setFollowingLiveFeed(false)}
          onScroll={event => {
            const atTop = event.currentTarget.scrollTop <= 8;
            setFollowingLiveFeed(atTop);
            if (atTop) setUnseenEventCount(0);
          }}
          aria-label="本场完整播报"
          className="h-36 touch-pan-y overflow-y-auto overscroll-y-contain px-4 py-2 lg:h-[348px]"
        >
          {entries.map((entry, index) => {
            const icon = entry.event ? EVENT_ICONS[entry.event.type] : undefined;
            return (
              <div
                key={entry.id}
                data-testid="live-commentary-entry"
                className={`flex min-h-8 items-start gap-2 border-b border-slate-800/30 py-1.5 text-[11px] last:border-b-0 ${index === 0 ? 'text-slate-200' : 'text-slate-500'}`}
              >
                <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-[10px]">{entry.label}</span>
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm">
                  {icon
                    ? <Icon name={icon.name} size={14} accent={icon.accent} />
                    : <span className="text-emerald-500/60">•</span>}
                </span>
                {entry.event
                  ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.event.teamId === homeTeamId ? homeColor : awayColor }} />
                  : <span className="w-2 shrink-0" />}
                <span className="min-w-0 leading-4">{entry.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
