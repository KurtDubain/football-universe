// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingAdvanceButton from './FloatingAdvanceButton';

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

describe('FloatingAdvanceButton', () => {
  it('separates moving from the one-click advance action', () => {
    const onAdvance = vi.fn();
    act(() => root.render(
      <FloatingAdvanceButton
        stageLabel="联赛"
        accentClass="bg-emerald-600"
        isAdvancing={false}
        disabled={false}
        onAdvance={onAdvance}
      />,
    ));

    const move = container.querySelector<HTMLButtonElement>('[aria-label="移动悬浮推进按钮"]')!;
    const advance = container.querySelector<HTMLButtonElement>('[aria-label="推进到下一阶段：联赛"]')!;

    act(() => move.click());
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => advance.click());
    expect(onAdvance).toHaveBeenCalledOnce();
    expect(move.title).toContain('Home 复位');
  });

  it('supports keyboard movement and Home reset', () => {
    act(() => root.render(
      <FloatingAdvanceButton
        stageLabel="联赛"
        isAdvancing={false}
        disabled={false}
        onAdvance={() => undefined}
      />,
    ));

    const floating = container.querySelector<HTMLElement>('[data-testid="floating-advance"]')!;
    floating.getBoundingClientRect = () => ({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 212,
      bottom: 148,
      width: 112,
      height: 48,
      toJSON: () => ({}),
    });
    const move = container.querySelector<HTMLButtonElement>('[aria-label="移动悬浮推进按钮"]')!;

    act(() => move.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(floating.style.left).toBe('88px');
    expect(floating.style.top).toBe('100px');

    act(() => move.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(floating.style.left).toBe('');
    expect(floating.className).toContain('floating-advance-docked');
  });
});
