import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  EmptyState,
  LoadingSkeleton,
  PageHeader,
  PageShell,
  Panel,
  SegmentedControl,
  StatusBadge,
} from './ui';

describe('shared UI primitives', () => {
  it('renders a stable page hierarchy with semantic surfaces', () => {
    const markup = renderToStaticMarkup(
      <PageShell width="wide">
        <PageHeader title="球队中心" meta="96 队" />
        <Panel tone="subtle">内容</Panel>
      </PageShell>,
    );

    expect(markup).toContain('data-ui="page-shell"');
    expect(markup).toContain('max-w-6xl');
    expect(markup).toContain('data-ui="page-header"');
    expect(markup).toContain('data-tone="subtle"');
    expect(markup).toContain('tabular-nums');
  });

  it('exposes segmented controls as an accessible tab list', () => {
    const onChange = vi.fn();
    const markup = renderToStaticMarkup(
      <SegmentedControl
        value="table"
        onChange={onChange}
        ariaLabel="联赛视图"
        options={[
          { value: 'table', label: '积分榜' },
          { value: 'schedule', label: '赛程表' },
        ]}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="联赛视图"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('ui-segmented-option');
  });

  it('renders status, empty, and loading states without decorative emoji', () => {
    const markup = renderToStaticMarkup(
      <>
        <StatusBadge tone="honor">3 座</StatusBadge>
        <EmptyState title="暂无记录" description="完成赛季后显示" />
        <LoadingSkeleton />
      </>,
    );

    expect(markup).toContain('data-tone="honor"');
    expect(markup).toContain('data-ui="empty-state"');
    expect(markup).toContain('aria-label="正在加载页面"');
    expect(markup).toContain('motion-reduce:animate-none');
    expect(markup).not.toContain('🔄');
  });
});
