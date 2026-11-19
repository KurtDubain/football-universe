// @vitest-environment jsdom

import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecoverableRoute } from './route-resource';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PageModule = { default: ComponentType };
type PageImporter = () => Promise<PageModule>;

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

function makePage(label: string): ComponentType {
  return function Page() {
    return <p data-testid="page">{label}</p>;
  };
}

function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" data-testid="go-a" onClick={() => navigate('/a')}>a</button>
      <button type="button" data-testid="go-b" onClick={() => navigate('/b')}>b</button>
      <button type="button" data-testid="go-c" onClick={() => navigate('/c')}>c</button>
    </>
  );
}

/**
 * The shell renders every route into the same slot, so react-router hands this
 * component the next route as a prop change rather than a remount. A `useState`
 * initializer only runs on the first mount, so a route that kept its loaded
 * component in state rendered the page the URL had already left.
 */
function renderShell(importers: { a: PageImporter; b: PageImporter; c: PageImporter }) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/a']}>
        <Nav />
        <Routes>
          <Route path="/a" element={<RecoverableRoute routeId="a" importer={importers.a} />} />
          <Route path="/b" element={<RecoverableRoute routeId="b" importer={importers.b} />} />
          <Route path="/c" element={<RecoverableRoute routeId="c" importer={importers.c} />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function pageLabel(): string | null {
  return container.querySelector('[data-testid="page"]')?.textContent ?? null;
}

async function click(testId: string) {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="' + testId + '"]');
  if (!button) throw new Error('missing ' + testId);
  await act(async () => {
    button.click();
  });
}

describe('RecoverableRoute navigation', () => {
  it('renders the route the URL names after a navigation', async () => {
    renderShell({
      a: async () => ({ default: makePage('A') }),
      b: async () => ({ default: makePage('B') }),
      c: async () => ({ default: makePage('C') }),
    });
    await act(async () => {});
    expect(pageLabel()).toBe('A');

    await click('go-b');
    expect(pageLabel()).toBe('B');

    await click('go-c');
    expect(pageLabel()).toBe('C');

    await click('go-a');
    expect(pageLabel()).toBe('A');
  });

  it('renders the next route even when the previous one was still loading', async () => {
    const gate: { release?: () => void } = {};
    const slowA: PageImporter = () => new Promise<PageModule>((resolve) => {
      gate.release = () => resolve({ default: makePage('A') });
    });
    renderShell({
      a: slowA,
      b: async () => ({ default: makePage('B') }),
      c: async () => ({ default: makePage('C') }),
    });

    await click('go-b');
    expect(pageLabel()).toBe('B');

    gate.release?.();
    await act(async () => {});
    expect(pageLabel()).toBe('B');
  });
});
