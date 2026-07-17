// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MobileDrawer from './MobileDrawer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开菜单</button>
      <MobileDrawer open={open} onClose={() => setOpen(false)} labelledBy="drawer-title">
        <h2 id="drawer-title">导航菜单</h2>
        <button aria-label="关闭导航菜单" onClick={() => setOpen(false)}>关闭</button>
        <a href="/teams">球队中心</a>
      </MobileDrawer>
    </>
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
  document.body.style.overflow = '';
});

function keydown(key: string, shiftKey = false) {
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })));
}

describe('MobileDrawer', () => {
  it('locks the page, exposes modal semantics, closes with Escape, and restores focus', () => {
    const trigger = container.querySelector('button')!;
    trigger.focus();
    act(() => trigger.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('drawer-title');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭导航菜单');

    keydown('Escape');

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps keyboard focus inside the drawer', () => {
    act(() => container.querySelector('button')!.click());
    const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭导航菜单"]')!;
    const link = container.querySelector<HTMLAnchorElement>('a')!;

    close.focus();
    keydown('Tab', true);
    expect(document.activeElement).toBe(link);

    keydown('Tab');
    expect(document.activeElement).toBe(close);
  });
});
