import { Link } from 'react-router-dom';
import type { GameWorld } from '../engine/season/season-manager';
import { EmptyState, StatusBadge } from './ui';

interface WorldProgressEmptyStateProps {
  world: GameWorld;
  title: string;
  description: string;
  actionLabel: string;
  actionTo: string;
}

export default function WorldProgressEmptyState({
  world,
  title,
  description,
  actionLabel,
  actionTo,
}: WorldProgressEmptyStateProps) {
  const calendar = world.seasonState.calendar;
  const completed = calendar.filter(window => window.completed).length;
  const total = calendar.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const nextWindow = calendar.find(window => !window.completed);

  return (
    <EmptyState
      className="world-progress-empty"
      title={title}
      description={(
        <div className="mx-auto max-w-md">
          <p>{description}</p>
          <div className="mt-4 border-y border-[var(--border-subtle)] py-3 text-left">
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <StatusBadge tone="action">S{world.seasonState.seasonNumber}</StatusBadge>
              <span className="text-[var(--text-muted)]">{completed}/{total} 窗口 · {percent}%</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden bg-black/35" aria-hidden="true">
              <div className="h-full bg-[var(--action)] transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-2 truncate text-[11px] text-[var(--text-secondary)]">
              {nextWindow ? `下一节点：${nextWindow.label}` : '本赛季赛程已完成，等待赛季归档'}
            </p>
          </div>
        </div>
      )}
      action={(
        <Link
          to={actionTo}
          data-ui-feedback="selection"
          className="inline-flex min-h-11 items-center rounded-md bg-[var(--action)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--action-hover)]"
        >
          {actionLabel}
        </Link>
      )}
    />
  );
}
