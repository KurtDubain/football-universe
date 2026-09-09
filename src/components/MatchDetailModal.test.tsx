// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../engine/season/season-manager';
import MatchDetailModal from './MatchDetailModal';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('MatchDetailModal prediction semantics', () => {
  it('labels decimal model output as expected goals rather than a predicted score', () => {
    const world = initializeGameWorld(20260709);
    const fixture = world.seasonState.calendar[0].fixtures[0];

    act(() => root.render(
      <MemoryRouter>
        <MatchDetailModal
          isOpen
          onClose={() => undefined}
          fixture={fixture}
          world={world}
        />
      </MemoryRouter>,
    ));

    expect(document.querySelector('[data-testid="expected-goals-label"]')?.textContent).toBe('预期进球');
    expect(document.body.textContent).not.toContain('预测比分');
  });
});
