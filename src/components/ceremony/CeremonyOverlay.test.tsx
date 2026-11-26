// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ceremonySettle, ceremonyTiming } from './ceremony-motion';
import type { CeremonyRequest } from './ceremony-types';
import CeremonyOverlay from './CeremonyOverlay';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEAM = { teamId: 'alpha', name: '大同队', shortName: '大同', color: '#3fb978' };
const SECOND = { ...TEAM, teamId: 'beta', name: '海门队', shortName: '海门' };
const THIRD = { ...TEAM, teamId: 'gamma', name: '南岭队', shortName: '南岭' };

function stamp(): CeremonyRequest {
  return {
    kind: 'cup_stamp',
    competitionName: '联赛杯',
    roundLabel: '决赛',
    champion: TEAM,
    runnerUp: SECOND,
    score: '2-1',
    finalMvp: { label: '决赛最佳球员', name: '林川', detail: '1 球 · 1 助', team: TEAM },
    topScorer: { label: '赛事金靴', name: '周野', detail: '6 球', team: SECOND },
  };
}

function closing(): CeremonyRequest {
  return {
    kind: 'season_closing',
    seasonNumber: 7,
    champion: TEAM,
    podium: [
      { team: TEAM, points: 68 },
      { team: SECOND, points: 61 },
      { team: THIRD, points: 55 },
    ],
    summary: '大同队以 68 分夺得顶级联赛冠军。',
    playerHonours: [
      { label: '金球奖', name: '林川', detail: '大同队 · 评分 112.4', team: TEAM },
      { label: '金靴奖', name: '周野', detail: '海门队 · 32球', team: SECOND },
      { label: '最佳门将', name: '赵岭', detail: '南岭队 · 仅失18球', team: THIRD },
    ],
    coachHonours: [
      { label: '冠军教头', name: '陈教', detail: '大同队 · 顶级联赛冠军', team: TEAM },
      { label: '最佳教练', name: '孙教', detail: '南岭队 第 3 名 · 超预期 6 位', team: THIRD },
    ],
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

const overlay = () => document.querySelector('[data-testid="ceremony-overlay"]');
const skip = () => document.querySelector('[data-testid="ceremony-skip"]') as HTMLButtonElement;
const folio = () => document.querySelector('[data-testid="ceremony-folio"]')?.textContent;

function render(request: CeremonyRequest, onDismiss = vi.fn(), dismissAfter: number | null = null) {
  act(() => root.render(
    <CeremonyOverlay
      request={request}
      timing={ceremonyTiming(request.kind, false)}
      dismissAfter={dismissAfter}
      onDismiss={onDismiss}
    />,
  ));
  return onDismiss;
}

describe('CeremonyOverlay', () => {
  it('prints the league page the request describes', () => {
    render(closing());

    expect(overlay()?.getAttribute('data-ceremony-kind')).toBe('season_closing');
    expect(overlay()?.getAttribute('data-ceremony-pages')).toBe('3');
    expect(overlay()?.getAttribute('data-ceremony-page')).toBe('1');
    expect(overlay()?.textContent).toContain('第 7 赛季 · 封盘');
    expect(overlay()?.textContent).toContain('大同队');
    expect(overlay()?.textContent).toContain('南岭队');
    expect(overlay()?.textContent).toContain('68 分');
    expect(folio()).toBe('1 / 3');
  });

  it('turns through the awards pages and only closes on the last one', () => {
    const onDismiss = render(closing());

    expect(skip().textContent).toBe('翻页');
    expect(overlay()?.textContent).not.toContain('金球奖');

    act(() => skip().click());
    expect(overlay()?.getAttribute('data-ceremony-page')).toBe('2');
    expect(folio()).toBe('2 / 3');
    expect(overlay()?.textContent).toContain('个人荣誉');
    expect(overlay()?.textContent).toContain('金球奖');
    expect(overlay()?.textContent).toContain('林川');
    expect(overlay()?.textContent).toContain('大同队 · 评分 112.4');
    expect(overlay()?.textContent).not.toContain('冠军教头');
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => skip().click());
    expect(overlay()?.getAttribute('data-ceremony-page')).toBe('3');
    expect(folio()).toBe('3 / 3');
    expect(overlay()?.textContent).toContain('教练席');
    expect(overlay()?.textContent).toContain('冠军教头');
    expect(overlay()?.textContent).toContain('孙教');
    expect(skip().textContent).toBe('合上');
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => skip().click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('turns the page on Escape and closes on the last one', () => {
    const onDismiss = render(closing());
    const escape = () => act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    escape();
    expect(overlay()?.getAttribute('data-ceremony-page')).toBe('2');
    expect(onDismiss).not.toHaveBeenCalled();

    escape();
    expect(overlay()?.getAttribute('data-ceremony-page')).toBe('3');
    expect(onDismiss).not.toHaveBeenCalled();

    escape();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stamps a cup with the final honours and passes on by itself', () => {
    const timing = ceremonyTiming('cup_stamp', false);
    const total = ceremonySettle(timing, 4) + (timing.autoDismiss ?? 0);
    const onDismiss = render(stamp(), vi.fn(), total);

    expect(overlay()?.getAttribute('data-ceremony-pages')).toBe('1');
    expect(document.body.textContent).toContain('冠军');
    expect(document.body.textContent).toContain('2-1');
    expect(document.body.textContent).toContain('决赛最佳球员');
    expect(document.body.textContent).toContain('林川');
    expect(document.body.textContent).toContain('1 球 · 1 助');
    expect(document.body.textContent).toContain('赛事金靴');
    expect(document.body.textContent).toContain('6 球');

    act(() => vi.advanceTimersByTime(total - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('holds a page until it is turned', () => {
    const onDismiss = render(closing());
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(skip().textContent).toBe('翻页');
  });

  it('takes the focus so a keyboard viewer lands on the page turn', () => {
    render(closing());
    expect(document.activeElement).toBe(skip());
  });
});
