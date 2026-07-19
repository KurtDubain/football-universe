// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './ui';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();

function Harness() {
  const [value, setValue] = useState('one');
  return (
    <SegmentedControl
      value={value}
      onChange={setValue}
      ariaLabel="测试标签"
      scrollable
      options={[
        { value: 'one', label: '第一项' },
        { value: 'two', label: '第二项' },
        { value: 'three', label: '最后一项' },
      ]}
    />
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  scrollIntoView.mockReset();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SegmentedControl scrolling', () => {
  it('scrolls the newly selected tab into view', () => {
    act(() => root.render(<Harness />));
    scrollIntoView.mockClear();

    const last = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].at(-1)!;
    act(() => last.click());

    expect(last.getAttribute('aria-selected')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  });
});
