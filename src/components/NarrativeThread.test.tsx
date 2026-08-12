// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NarrativeThread as NarrativeThreadData } from '../engine/observation/narrative-threads';
import NarrativeThread from './NarrativeThread';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('NarrativeThread', () => {
  it('keeps the latest node visible and older canonical nodes collapsed', () => {
    const thread: NarrativeThreadData = {
      id: 'team-thread:one',
      title: '球队故事线',
      summary: '一条当前故事和两条档案事实。',
      entries: [
        { id: 'now', season: 3, order: 30, title: '当前节点', detail: '正在发生', tone: 'rise', to: '/team/one' },
        { id: 'past', season: 2, order: 20, title: '历史节点', detail: '已被归档', tone: 'stage', to: '/history', summaryOnly: true },
      ],
    };
    act(() => root.render(<MemoryRouter><NarrativeThread thread={thread} /></MemoryRouter>));

    expect(container.querySelector('[data-testid="entity-narrative-thread"]')?.getAttribute('data-thread-id')).toBe(thread.id);
    expect(container.textContent).toContain('当前节点');
    const details = container.querySelector<HTMLDetailsElement>('details');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('历史节点');
    expect(container.querySelector('a[href="/history"]')).not.toBeNull();
  });

  it('renders no placeholder for an absent thread', () => {
    act(() => root.render(<MemoryRouter><NarrativeThread thread={null} /></MemoryRouter>));
    expect(container.innerHTML).toBe('');
  });
});
