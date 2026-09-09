// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCurrentWindow, initializeGameWorld } from '../engine/season/season-manager';
import { SAVE_STORAGE_KEY } from '../store/save-schema';
import { useGameStore } from '../store/game-store';
import Dashboard, { ResultsTab } from './Dashboard';
import type { AdvanceWorldResponse } from '../engine/observation/world-response';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
  });
}

beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Dashboard results navigation', () => {
  it('returns to the current unplayed Matchday without advancing or persisting world state', () => {
    const initial = initializeGameWorld(20260908);
    const completed = executeCurrentWindow(initial);
    useGameStore.setState({
      world: completed.world,
      initialized: true,
      lastResults: completed.results,
      lastNews: completed.news,
      lastObservationSettlements: [],
      lastWorldResponse: null,
      isAdvancing: false,
      advanceTick: 1,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      favoritePlayerIds: [],
      starredFixtureIds: [],
    });
    const onObserveNext = vi.fn();

    act(() => root.render(
      <MemoryRouter>
        <ResultsTab
          world={completed.world}
          lastResults={completed.results}
          lastNews={completed.news}
          onResultClick={() => undefined}
          onLiveView={() => undefined}
          onSeasonReview={() => undefined}
          onObserveNext={onObserveNext}
        />
      </MemoryRouter>,
    ));

    const beforeWorld = structuredClone(useGameStore.getState().world);
    const beforeResults = structuredClone(useGameStore.getState().lastResults);
    const beforeTick = useGameStore.getState().advanceTick;
    const beforeSave = localStorage.getItem(SAVE_STORAGE_KEY);
    const action = container.querySelector<HTMLButtonElement>('[data-testid="results-return-to-matchday"]');

    expect(action?.getAttribute('aria-label')).toBe('返回当前未赛比赛日');
    expect(container.querySelector('[data-testid="dashboard-advance"]')).toBeNull();
    act(() => action?.click());

    expect(onObserveNext).toHaveBeenCalledOnce();
    expect(useGameStore.getState().world).toEqual(beforeWorld);
    expect(useGameStore.getState().lastResults).toEqual(beforeResults);
    expect(useGameStore.getState().advanceTick).toBe(beforeTick);
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(beforeSave);
  });

  it('preserves scroll within one report but resets when a new response is auto-shown', async () => {
    const initial = initializeGameWorld(20260908);
    const first = executeCurrentWindow(initial);
    const second = executeCurrentWindow(first.world);
    const response = (id: string): AdvanceWorldResponse => ({
      id,
      mode: 'single',
      advancedWindows: 1,
      completedMatches: first.results.length,
      totalNews: first.news.length,
      fromSeason: 1,
      fromWindow: 0,
      fromLabel: 'Round 1',
      toSeason: 1,
      toWindow: 0,
      toLabel: 'Round 1',
      nextSeason: 1,
      nextWindowLabel: 'Round 2',
      seasonChanged: false,
      featuredResults: [],
      observationSettlements: [],
      storyUpdates: [],
      keyNews: [],
      hasMajorMoment: false,
    });
    useGameStore.setState({
      world: first.world,
      initialized: true,
      lastResults: first.results,
      lastNews: first.news,
      lastObservationSettlements: [],
      lastWorldResponse: response('report-1'),
      isAdvancing: false,
      advanceTick: 1,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      favoritePlayerIds: [],
      starredFixtureIds: [],
    });

    await act(async () => {
      root.render(<MemoryRouter><Dashboard /></MemoryRouter>);
    });
    const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(button => button.textContent?.includes(label))!;

    act(() => tab('战报').click());
    const firstReportContent = container.querySelector<HTMLElement>('[data-testid="dashboard-tab-content"]')!;
    firstReportContent.scrollTop = 240;
    act(() => firstReportContent.dispatchEvent(new Event('scroll', { bubbles: true })));
    act(() => tab('比赛日').click());
    act(() => tab('战报').click());
    await flushAnimationFrame();
    expect(container.querySelector<HTMLElement>('[data-testid="dashboard-tab-content"]')?.scrollTop).toBe(240);

    act(() => tab('比赛日').click());
    await act(async () => {
      useGameStore.setState({
        world: second.world,
        lastResults: second.results,
        lastNews: second.news,
        lastWorldResponse: response('report-2'),
        advanceTick: 2,
      });
    });
    await flushAnimationFrame();

    expect(tab('战报').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector<HTMLElement>('[data-testid="dashboard-tab-content"]')?.scrollTop).toBe(0);

    const currentReportContent = container.querySelector<HTMLElement>('[data-testid="dashboard-tab-content"]')!;
    currentReportContent.scrollTop = 180;
    act(() => currentReportContent.dispatchEvent(new Event('scroll', { bubbles: true })));
    await act(async () => {
      useGameStore.setState({
        lastWorldResponse: response('report-3'),
        advanceTick: 3,
      });
    });
    expect(container.querySelector<HTMLElement>('[data-testid="dashboard-tab-content"]')?.scrollTop).toBe(0);
  });
});
