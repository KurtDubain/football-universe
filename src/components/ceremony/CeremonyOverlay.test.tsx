// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ceremonySettle, ceremonyTiming } from './ceremony-motion';
import type { CeremonyRequest } from './ceremony-types';
import CeremonyOverlay from './CeremonyOverlay';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEAM = { teamId: 'alpha', name: '大同队', shortName: '大同', color: '#3fb978' };

function stamp(): CeremonyRequest {
  return {
    kind: 'cup_stamp',
    competitionName: '联赛杯',
    roundLabel: '决赛',
    champion: TEAM,
    runnerUp: { ...TEAM, teamId: 'beta', name: '海门队', shortName: '海门' },
    score: '2-1',
  };
}

function closing(): CeremonyRequest {
  return {
    kind: 'season_closing',
    seasonNumber: 7,
    champion: TEAM,
    podium: [TEAM, { ...TEAM, teamId: 'beta', name: '海门队' }, { ...TEAM, teamId: 'gamma', name: '南岭队' }],
    summary: '大同队以 68 分夺得顶级联赛冠军。',
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  host.remove();
});

describe('CeremonyOverlay', () => {
  it('prints the page the request describes', () => {
    act(() => root.render(
      <CeremonyOverlay
        request={closing()}
        timing={ceremonyTiming('season_closing', false)}
        dismissAfter={null}
        onDismiss={vi.fn()}
      />,
    ));

    const overlay = document.querySelector('[data-testid="ceremony-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('data-ceremony-kind')).toBe('season_closing');
    expect(overlay?.textContent).toContain('第 7 赛季 · 封盘');
    expect(overlay?.textContent).toContain('大同队');
    expect(overlay?.textContent).toContain('南岭队');
  });

  it('stamps a cup and passes on by itself', () => {
    const onDismiss = vi.fn();
    const timing = ceremonyTiming('cup_stamp', false);
    const total = ceremonySettle(timing, 2) + (timing.autoDismiss ?? 0);
    act(() => root.render(
      <CeremonyOverlay request={stamp()} timing={timing} dismissAfter={total} onDismiss={onDismiss} />,
    ));
    expect(document.body.textContent).toContain('冠军');
    expect(document.body.textContent).toContain('2-1');

    act(() => vi.advanceTimersByTime(total - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('holds a page until it is turned', () => {
    const onDismiss = vi.fn();
    act(() => root.render(
      <CeremonyOverlay
        request={closing()}
        timing={ceremonyTiming('season_closing', false)}
        dismissAfter={null}
        onDismiss={onDismiss}
      />,
    ));
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="ceremony-skip"]')?.textContent).toBe('翻页');
  });

  it('turns the page on Escape and on the corner button', () => {
    const onDismiss = vi.fn();
    act(() => root.render(
      <CeremonyOverlay
        request={closing()}
        timing={ceremonyTiming('season_closing', false)}
        dismissAfter={null}
        onDismiss={onDismiss}
      />,
    ));

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const skip = document.querySelector('[data-testid="ceremony-skip"]') as HTMLButtonElement;
    act(() => skip.click());
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('takes the focus so a keyboard viewer lands on the page turn', () => {
    act(() => root.render(
      <CeremonyOverlay
        request={closing()}
        timing={ceremonyTiming('season_closing', false)}
        dismissAfter={null}
        onDismiss={vi.fn()}
      />,
    ));
    const skip = document.querySelector('[data-testid="ceremony-skip"]');
    expect(document.activeElement).toBe(skip);
  });
});
