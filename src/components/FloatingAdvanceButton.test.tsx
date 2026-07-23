// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingAdvanceButton from './FloatingAdvanceButton';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('FloatingAdvanceButton', () => {
  it('uses one clear tap target for the advance action', () => {
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

    const advance = container.querySelector<HTMLButtonElement>('[data-testid="floating-advance"]')!;
    expect(advance.getBoundingClientRect).toBeDefined();
    act(() => advance.click());
    expect(onAdvance).toHaveBeenCalledOnce();
    expect(advance.title).toContain('拖动可调整位置');
    expect(advance.title).toContain('Home 复位');
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

    const floating = container.querySelector<HTMLButtonElement>('[data-testid="floating-advance"]')!;
    floating.getBoundingClientRect = () => ({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 156,
      bottom: 156,
      width: 56,
      height: 56,
      toJSON: () => ({}),
    });

    act(() => floating.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(floating.style.left).toBe('88px');
    expect(floating.style.top).toBe('100px');
    expect(JSON.parse(localStorage.getItem('floating-advance-position-v2') ?? '{}')).toEqual({ x: 88, y: 100 });

    act(() => floating.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(floating.style.left).toBe('');
    expect(floating.className).toContain('floating-advance-docked');
    expect(localStorage.getItem('floating-advance-position-v2')).toBeNull();
  });
});
