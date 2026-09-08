import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Achievement } from '../engine/achievements';
import {
  buildAchievementPresentation,
  type AchievementPresentationGroup,
  type AchievementPresentationSingle,
} from '../engine/history/achievement-presentation';
import type { TeamBase } from '../types/team';
import { getTeamName } from '../utils/format';

const DEFAULT_VISIBLE_COUNT = 6;

interface AchievementHallProps {
  achievements: readonly Achievement[];
  followedTeamIds: readonly string[];
  teamBases: Record<string, TeamBase>;
}

function AchievementCard({
  item,
  teamBases,
}: {
  item: AchievementPresentationSingle;
  teamBases: Record<string, TeamBase>;
}) {
  return (
    <article
      data-testid="achievement-card"
      data-followed={item.followed ? 'true' : 'false'}
      className={`rounded-lg border px-3 py-2 text-xs ${item.followed
        ? 'border-emerald-700/45 bg-emerald-950/25'
        : 'border-amber-700/30 bg-amber-900/20'}`}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className={item.followed ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-400'}>
          {item.achievement.title}
        </span>
        <span className="text-slate-500">S{item.seasonNumber}</span>
        {item.followed && <span className="text-[10px] text-emerald-400">关注球队</span>}
      </div>
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{item.achievement.description}</p>
      {item.teamId && (
        <Link to={`/team/${item.teamId}`} className="mt-1 inline-flex min-h-6 items-center text-[10px] text-slate-500 hover:text-emerald-300">
          {getTeamName(item.teamId, teamBases)}
        </Link>
      )}
    </article>
  );
}

function AchievementGroupCard({
  item,
  expanded,
  onToggle,
  teamBases,
}: {
  item: AchievementPresentationGroup;
  expanded: boolean;
  onToggle: () => void;
  teamBases: Record<string, TeamBase>;
}) {
  const panelId = `achievement-group-${item.seasonNumber}-${item.achievementType}`;
  const countLabel = item.teamIds.length === item.entries.length
    ? `${item.teamIds.length}支球队`
    : `${item.entries.length}项记录`;

  return (
    <article data-testid="achievement-group" className="rounded-lg border border-slate-700 bg-slate-900/35 text-xs">
      <button
        type="button"
        aria-label={`${expanded ? '收起' : '展开'}${item.title}，第${item.seasonNumber}赛季，${countLabel}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/70"
      >
        <span className="min-w-0 flex-1 font-semibold text-amber-300">{item.title}</span>
        <span className="shrink-0 text-slate-500">S{item.seasonNumber}</span>
        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{countLabel}</span>
        <span aria-hidden="true" className="text-slate-500">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div id={panelId} className="divide-y divide-slate-700/60 border-t border-slate-700 px-3">
          {item.entries.map(({ achievement, teamId }) => {
            return (
              <div key={achievement.id} data-testid="achievement-group-entry" className="py-2">
                <p className="text-[10px] leading-relaxed text-slate-400">{achievement.description}</p>
                {teamId && (
                  <Link to={`/team/${teamId}`} className="mt-1 inline-flex min-h-6 items-center text-[10px] text-slate-500 hover:text-emerald-300">
                    {getTeamName(teamId, teamBases)}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

export default function AchievementHall({ achievements, followedTeamIds, teamBases }: AchievementHallProps) {
  const [showAll, setShowAll] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const items = useMemo(
    () => buildAchievementPresentation(achievements, followedTeamIds, Object.keys(teamBases)),
    [achievements, followedTeamIds, teamBases],
  );
  const visibleItems = showAll ? items : items.slice(0, DEFAULT_VISIBLE_COUNT);

  return (
    <section data-testid="achievement-hall" className="rounded-lg border border-slate-700 bg-[var(--surface-panel)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">成就殿堂</h3>
        <span className="text-[10px] text-slate-600">{achievements.length}项历史记录</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visibleItems.map(item => item.kind === 'single' ? (
          <AchievementCard key={item.key} item={item} teamBases={teamBases} />
        ) : (
          <AchievementGroupCard
            key={item.key}
            item={item}
            teamBases={teamBases}
            expanded={expandedGroups.has(item.key)}
            onToggle={() => setExpandedGroups(current => {
              const next = new Set(current);
              if (next.has(item.key)) next.delete(item.key);
              else next.add(item.key);
              return next;
            })}
          />
        ))}
      </div>
      {items.length > DEFAULT_VISIBLE_COUNT && (
        <button
          type="button"
          data-testid="toggle-all-achievements"
          aria-label={showAll ? '收起其余成就' : `查看全部${items.length}项成就与成就组`}
          aria-expanded={showAll}
          onClick={() => setShowAll(current => !current)}
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md border border-slate-700 px-3 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:bg-slate-900/30 hover:text-white"
        >
          {showAll ? '收起' : `查看全部 · 还有${items.length - DEFAULT_VISIBLE_COUNT}项`}
        </button>
      )}
    </section>
  );
}
