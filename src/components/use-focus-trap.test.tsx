// @vitest-environment jsdom

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFocusTrap } from './use-focus-trap';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/**
 * 比赛直播的折叠播报条里就藏着这样一个 display:none 的展开按钮，而且它排在所有
 * 可见控件之前。浏览器拒绝聚焦隐藏元素，focus() 会静默失败，焦点留在 body 上。
 */
function Harness() {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { active: true, lockScroll: false });
  return (
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-label="测试浮层">
      <button type="button" style={{ display: 'none' }}>折叠播报展开</button>
      <button type="button">第一个可见按钮</button>
      <button type="button">第二个可见按钮</button>
    </div>
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button')];
}

function keydown(key: string, shiftKey = false): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  });
}

describe('useFocusTrap', () => {
  it('skips a hidden control when placing the initial focus', () => {
    const [hidden, firstVisible] = buttons();
    expect(document.activeElement).toBe(firstVisible);
    expect(document.activeElement).not.toBe(hidden);
  });

  it('wraps Tab around the visible controls only', () => {
    const [, firstVisible, lastVisible] = buttons();
    lastVisible.focus();
    keydown('Tab');
    expect(document.activeElement).toBe(firstVisible);
  });

  it('wraps Shift+Tab from the first visible control to the last', () => {
    const [, firstVisible, lastVisible] = buttons();
    firstVisible.focus();
    keydown('Tab', true);
    expect(document.activeElement).toBe(lastVisible);
  });

  it('pulls focus back when the focused control is removed from the panel', () => {
    const [, firstVisible] = buttons();
    firstVisible.focus();
    expect(document.activeElement).toBe(firstVisible);
    // 转播开场结束时会带走当时被聚焦的按钮，浏览器把焦点丢回 body。
    act(() => { firstVisible.remove(); });
    expect(document.activeElement).toBe(document.body);
    // 陷阱必须把焦点收回浮层内，否则 Tab 会从浮层背后的页面重新开始。
    act(() => {
      document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
  });
});
