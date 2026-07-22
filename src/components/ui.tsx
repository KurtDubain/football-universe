import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

type PageWidth = 'narrow' | 'standard' | 'wide' | 'full';

const pageWidthClass: Record<PageWidth, string> = {
  narrow: 'max-w-3xl',
  standard: 'max-w-5xl',
  wide: 'max-w-6xl',
  full: 'max-w-none',
};

interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  width?: PageWidth;
}

export function PageShell({ width = 'standard', className, ...props }: PageShellProps) {
  return (
    <div
      data-ui="page-shell"
      className={cx('ui-page-shell', pageWidthClass[width], className)}
      {...props}
    />
  );
}

interface PageHeaderProps {
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, icon, description, meta, actions, className }: PageHeaderProps) {
  return (
    <header data-ui="page-header" className={cx('ui-page-header', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="ui-page-icon" aria-hidden="true">{icon}</div>}
        <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="ui-page-title">{title}</h1>
          {meta && <div className="ui-page-meta tabular-nums">{meta}</div>}
        </div>
        {description && <div className="ui-page-description">{description}</div>}
        </div>
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  );
}

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, actions, className }: SectionHeaderProps) {
  return (
    <div data-ui="section-header" className={cx('ui-section-header', className)}>
      <div className="min-w-0">
        <h2 className="ui-section-title">{title}</h2>
        {description && <div className="ui-section-description">{description}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

type PanelTone = 'default' | 'subtle' | 'floating';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: PanelTone;
  padded?: boolean;
}

export function Panel({ tone = 'default', padded = true, className, ...props }: PanelProps) {
  return (
    <div
      data-ui="panel"
      data-tone={tone}
      className={cx('ui-panel', padded && 'ui-panel-padded', className)}
      {...props}
    />
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  stretch?: boolean;
  scrollable?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  stretch = false,
  scrollable = false,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ atStart: true, atEnd: true });

  const updateScrollEdges = useCallback(() => {
    const element = containerRef.current;
    if (!element || !scrollable) return;
    setScrollEdges({
      atStart: element.scrollLeft <= 2,
      atEnd: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
    });
  }, [scrollable]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !scrollable) return;

    const selected = element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    selected?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    const frame = window.requestAnimationFrame(updateScrollEdges);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollEdges);
    observer?.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [scrollable, updateScrollEdges, value]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      data-ui="segmented-control"
      data-scroll-start={scrollEdges.atStart}
      data-scroll-end={scrollEdges.atEnd}
      onScroll={updateScrollEdges}
      className={cx(
        'ui-segmented',
        stretch && 'ui-segmented-stretch',
        scrollable && 'ui-segmented-scrollable',
        className,
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className="ui-segmented-option"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type StatusTone = 'neutral' | 'action' | 'success' | 'warning' | 'danger' | 'honor';

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

export function StatusBadge({ tone = 'neutral', className, ...props }: StatusBadgeProps) {
  return (
    <span
      data-ui="status-badge"
      data-tone={tone}
      className={cx('ui-status-badge tabular-nums', className)}
      {...props}
    />
  );
}

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div data-ui="empty-state" className={cx('ui-empty-state', className)}>
      {icon && <div className="ui-empty-state-icon" aria-hidden="true">{icon}</div>}
      <div className="ui-empty-state-title">{title}</div>
      {description && <div className="ui-empty-state-description">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

interface LoadingSkeletonProps {
  fullPage?: boolean;
  className?: string;
}

export function LoadingSkeleton({ fullPage = false, className }: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="正在加载页面"
      className={cx('ui-loading-shell', fullPage && 'ui-loading-full-page', className)}
    >
      <span className="sr-only">正在加载...</span>
      <div className="ui-loading-content animate-pulse motion-reduce:animate-none" aria-hidden="true">
        <div className="ui-skeleton h-7 w-32" />
        <div className="ui-skeleton h-20" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="ui-skeleton h-36" />
          <div className="ui-skeleton h-36" />
        </div>
      </div>
    </div>
  );
}
