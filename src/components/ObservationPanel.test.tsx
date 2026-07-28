// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeGameWorld } from '../engine/season/season-manager';
import { useGameStore } from '../store/game-store';
import ObservationPanel from './ObservationPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const world = initializeGameWorld(20260718);
  useGameStore.setState({ world });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ObservationPanel dashboard action flow', () => {
  it('keeps one advance action beside the optional collapsed judgment', () => {
    const world = useGameStore.getState().world!;
    const onAdvance = vi.fn();
    act(() => root.render(
      <ObservationPanel
        world={world}
        fixtures={world.seasonState.calendar[0].fixtures.slice(0, 2)}
        embedded
        advanceAction={{
          isAdvancing: false,
          stageLabel: '顶级联赛',
          onAdvance,
        }}
      />,
    ));

    const advance = container.querySelector<HTMLButtonElement>('[data-testid="dashboard-advance"]');
    expect(advance).not.toBeNull();
    expect(container.querySelectorAll('[aria-label="开始模拟"]')).toHaveLength(1);
    expect(container.textContent).toContain('本轮判断 · 可选');

    act(() => advance?.click());
    expect(onAdvance).toHaveBeenCalledOnce();
  });

  it('preserves the same advance action while judgment choices are expanded', () => {
    const world = useGameStore.getState().world!;
    act(() => root.render(
      <ObservationPanel
        world={world}
        fixtures={world.seasonState.calendar[0].fixtures.slice(0, 2)}
        embedded
        advanceAction={{
          isAdvancing: false,
          stageLabel: '顶级联赛',
          onAdvance: () => undefined,
        }}
      />,
    ));

    const judgment = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('本轮判断'));
    act(() => judgment?.click());

    expect(container.querySelector('[data-testid="observation-panel"]')).not.toBeNull();
    expect(container.querySelectorAll('[aria-label="开始模拟"]')).toHaveLength(1);
    expect(container.textContent).toContain('不消耗资源，也不会影响赛果');
  });
});
