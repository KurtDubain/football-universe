import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Logo from './Logo';

describe('Logo', () => {
  it('renders the flat football-annual mark without gradient artwork', () => {
    const markup = renderToStaticMarkup(<Logo size={40} />);

    expect(markup).toContain('aria-label="足球联赛宇宙标志"');
    expect(markup).toContain('viewBox="0 0 64 64"');
    expect(markup).not.toContain('linearGradient');
    expect(markup).not.toContain('url(#');
  });
});
