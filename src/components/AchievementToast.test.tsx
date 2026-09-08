// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Achievement } from '../engine/achievements';
import AchievementToast from './AchievementToast';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function achievement(id: string, title: string): Achievement {
  return {
    id,
    title,
    description: `${title}说明`,
    seasonNumber: 1,
  };
}

describe('AchievementToast', () => {
  it('summarizes a season-end batch and dismisses it once', () => {
    const onDismiss = vi.fn();
    act(() => root.render(
      <AchievementToast
        achievements={[
          achievement('first-title-a-S1', '首次夺冠'),
          achievement('double-crown-a-S1', '双冠王'),
        ]}
        onDismiss={onDismiss}
      />,
    ));

    expect(container.textContent).toContain('本季解锁 2 项');
    expect(container.textContent).toContain('首次夺冠、双冠王');
    act(() => vi.advanceTimersByTime(3_200));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
