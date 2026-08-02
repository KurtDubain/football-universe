// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppErrorBoundary from './AppErrorBoundary';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function BrokenRoute(): never {
  throw new Error('route chunk failed');
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('AppErrorBoundary', () => {
  it('replaces a render crash with actionable recovery controls', () => {
    const onReload = vi.fn();
    const onHome = vi.fn();

    act(() => root.render(
      <AppErrorBoundary onReload={onReload} onHome={onHome}>
        <BrokenRoute />
      </AppErrorBoundary>,
    ));

    expect(container.textContent).toContain('足球宇宙暂时无法继续');
    expect(container.textContent).toContain('route chunk failed');

    const buttons = [...container.querySelectorAll('button')];
    act(() => buttons.find(button => button.textContent === '重新加载')!.click());
    act(() => buttons.find(button => button.textContent === '返回主页')!.click());

    expect(onReload).toHaveBeenCalledOnce();
    expect(onHome).toHaveBeenCalledOnce();
  });

  it('requires confirmation before invoking destructive recovery', () => {
    const onReset = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    act(() => root.render(
      <AppErrorBoundary onReset={onReset}>
        <BrokenRoute />
      </AppErrorBoundary>,
    ));

    const reset = [...container.querySelectorAll('button')]
      .find(button => button.textContent === '清除存档并重新开始')!;
    act(() => reset.click());
    expect(onReset).not.toHaveBeenCalled();
    act(() => reset.click());

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
