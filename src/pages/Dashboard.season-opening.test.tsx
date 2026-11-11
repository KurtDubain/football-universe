// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCurrentWindow, initializeGameWorld } from '../engine/season/season-manager';
import { firstMatchdayWorld } from '../engine/season/test-world';
import { useGameStore } from '../store/game-store';
import type { GameWorld } from '../engine/season/season-manager';
import { shouldAutoOpenTransferMarket } from '../engine/observation/dashboard-action';
import { MatchdayTab } from './Dashboard';
// The matchday runway lazy-imports ObservationPanel. Loading it up front puts
// it in the module registry so the dynamic import resolves from cache inside
// act instead of landing after the test body.
import '../components/ObservationPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function renderMatchdayTab(world: GameWorld) {
  return act(() => {
    root.render(
      <MemoryRouter>
        <MatchdayTab
          world={world}
          currentWindow={getCurrentWindow(world)}
          lastResults={[]}
          onFixtureClick={() => undefined}
        />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useGameStore.setState({
    favoriteTeamId: null,
    favoriteTeamIds: [],
    favoritePlayerIds: [],
    starredFixtureIds: [],
    narrativeMemory: [],
    isAdvancing: false,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Dashboard season-opening window', () => {
  it('renders the opening read and its own advance control on the fixture-less window', () => {
    const world = initializeGameWorld(20260722);
    useGameStore.setState({ world });
    expect(getCurrentWindow(world)?.type).toBe('pre_season');

    renderMatchdayTab(world);

    // The empty-stage branch used to swallow this whole panel.
    expect(container.querySelector('[data-testid="season-opening"]')).not.toBeNull();
    expect(container.textContent).toContain('本赛季抽签');
    expect(container.textContent).toContain('赛前瞩目');
    expect(container.textContent).not.toContain('本阶段无比赛安排');

    // ObservationPanel renders nothing without a fixture, so the opening
    // window has to carry its own way forward.
    const advance = container.querySelector<HTMLButtonElement>('[data-testid="season-opening-advance"]');
    expect(advance).not.toBeNull();
    expect(advance?.disabled).toBe(false);
  });

  it('keeps the first-observation onboarding on the first matchday, not the opening window', async () => {
    const world = initializeGameWorld(20260722);
    useGameStore.setState({ world });
    renderMatchdayTab(world);

    // The 01/02/03 path promises a focus match; the opening window has none.
    expect(container.querySelector('[data-testid="observation-runway"][data-opening="true"]')).toBeNull();
    expect(container.textContent).toContain('开幕');

    const matchday = firstMatchdayWorld(20260722);
    useGameStore.setState({ world: matchday });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <MatchdayTab
            world={matchday}
            currentWindow={getCurrentWindow(matchday)}
            lastResults={[]}
            onFixtureClick={() => undefined}
          />
        </MemoryRouter>,
      );
      // ObservationPanel is lazy-loaded; give the dynamic import a tick to
      // resolve inside act so the advance control is part of the committed tree.
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="season-opening"]')).toBeNull();
    expect(container.querySelector('[data-testid="observation-runway"][data-opening="true"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dashboard-advance"]')).not.toBeNull();
  });
});

describe('transfer market auto-redirect', () => {
  const base = {
    transferWindowStatus: 'open',
    pathname: '/',
    hasWorldResponse: false,
  };

  it('sends the reader to the market from an ordinary window', () => {
    expect(shouldAutoOpenTransferMarket({ ...base, windowType: 'league' })).toBe(true);
  });

  it('never bounces off the season-opening window', () => {
    // Its draw and pre-season read exist in no other view, and advancing past
    // it loses them for good — a redirect here strands content permanently.
    expect(shouldAutoOpenTransferMarket({ ...base, windowType: 'pre_season' })).toBe(false);
  });

  it('keeps the existing opt-outs', () => {
    expect(shouldAutoOpenTransferMarket({
      ...base, windowType: 'league', transferWindowStatus: 'closed',
    })).toBe(false);
    expect(shouldAutoOpenTransferMarket({
      ...base, windowType: 'league', pathname: '/market',
    })).toBe(false);
    expect(shouldAutoOpenTransferMarket({
      ...base, windowType: 'league', hasWorldResponse: true,
    })).toBe(false);
    expect(shouldAutoOpenTransferMarket({ ...base, windowType: undefined })).toBe(true);
  });
});
