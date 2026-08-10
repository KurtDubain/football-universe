// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../store/game-store';
import Welcome from './Welcome';

vi.mock('../feedback/game-feedback', () => ({
  playGameFeedback: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let originalNewGame: ReturnType<typeof useGameStore.getState>['newGame'];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalNewGame = useGameStore.getState().newGame;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  act(() => root.unmount());
  useGameStore.setState({ newGame: originalNewGame });
  container.remove();
  vi.restoreAllMocks();
});

describe('Welcome initialization recovery', () => {
  it('restores the start action and explains an initialization failure', async () => {
    useGameStore.setState({
      newGame: () => {
        throw new Error('测试初始化异常');
      },
    });

    await act(async () => {
      root.render(<MemoryRouter><Welcome /></MemoryRouter>);
    });
    const start = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('开始观察'))!;

    await act(async () => {
      start.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('测试初始化异常');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('已有存档均未被清除');
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain('开始观察');
  });
});
