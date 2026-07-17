import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteLoading } from './App';

describe('RouteLoading', () => {
  it('uses a layout-shaped skeleton without the old half-page black flash', () => {
    const markup = renderToStaticMarkup(<RouteLoading />);

    expect(markup).toContain('aria-label="正在加载页面"');
    expect(markup).toContain('motion-reduce:animate-none');
    expect(markup).not.toContain('min-h-[50vh]');
    expect(markup).not.toContain('bg-slate-950');
  });
});
