// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Celebration from './Celebration';
import { celebrationDuration } from './celebration-types';

describe('Celebration', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('renders distinct streamer, fireworks and trophy layers', () => {
    const root = createRoot(host);
    act(() => root.render(<Celebration active type="streamers" seed={3} />));
    expect(document.body.querySelector('[data-testid="streamers-celebration"]')).not.toBeNull();

    act(() => root.render(<Celebration key="fireworks" active type="fireworks" seed={3} />));
    expect(document.body.querySelector('[data-testid="fireworks-celebration"]')).not.toBeNull();

    act(() => root.render(<Celebration key="trophy" active type="trophy" seed={3} />));
    expect(document.body.querySelector('[data-testid="trophy-celebration"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="fireworks-celebration"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it('removes streamers after their bounded duration', () => {
    const root = createRoot(host);
    const duration = celebrationDuration('streamers');
    act(() => root.render(<Celebration active type="streamers" />));
    act(() => vi.advanceTimersByTime(duration));
    expect(document.body.querySelector('[data-testid="streamers-celebration"]')).toBeNull();
    act(() => root.unmount());
  });
});
