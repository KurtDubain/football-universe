// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NarrativeDigest as NarrativeDigestData, NarrativeItem } from '../engine/observation/narrative-types';
import NarrativeDigest from './NarrativeDigest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function item(id: string, source: NarrativeItem['source'] = 'news'): NarrativeItem {
  return {
    id,
    arcKey: `arc:${id}`,
    eventKey: `event:${id}`,
    source,
    subjectType: 'world',
    subjectIds: [],
    fixtureIds: [`fixture:${id}`],
    seasonNumber: 1,
    title: `标题 ${id}`,
    summary: `摘要 ${id}`,
    evidence: [{ key: `fact:${id}`, label: '证据', detail: `事实 ${id}`, source }],
    nextWatch: `继续观察 ${id}`,
    destinations: [{ key: `fixture:${id}`, label: '查看比赛', fixtureId: `fixture:${id}` }],
    fingerprint: id,
    changedAt: 1,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('NarrativeDigest', () => {
  it('renders one feature, at most two signals, and keeps all remaining items collapsed', () => {
    const digest: NarrativeDigestData = {
      feature: item('feature', 'storyline'),
      signals: [item('signal-a', 'player_highlight'), item('signal-b', 'focus_fixture')],
      more: [item('more-a'), item('more-b', 'transfer_rumor')],
      observationRelationFixtureIds: [],
      candidateCount: 5,
    };
    act(() => root.render(
      <MemoryRouter>
        <NarrativeDigest digest={digest} windowLabel="第8轮" />
      </MemoryRouter>,
    ));

    expect(container.querySelectorAll('[data-testid="narrative-feature"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="narrative-signals"] > div')).toHaveLength(2);
    const more = container.querySelector<HTMLDetailsElement>('[data-testid="more-world-signals"]');
    expect(more?.open).toBe(false);
    expect(more?.textContent).toContain('2条，已去重');
    expect(more?.textContent).toContain('标题 more-a');
    expect(more?.textContent).toContain('标题 more-b');
  });

  it('opens fixture destinations through the supplied interaction', () => {
    const onFixtureClick = vi.fn();
    const digest: NarrativeDigestData = {
      feature: item('feature', 'focus_fixture'),
      signals: [],
      more: [],
      observationRelationFixtureIds: [],
      candidateCount: 1,
    };
    act(() => root.render(
      <MemoryRouter>
        <NarrativeDigest
          digest={digest}
          windowLabel="决赛"
          onFixtureClick={onFixtureClick}
        />
      </MemoryRouter>,
    ));

    const action = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('查看比赛'));
    act(() => action?.click());
    expect(onFixtureClick).toHaveBeenCalledWith('fixture:feature');
  });
});

