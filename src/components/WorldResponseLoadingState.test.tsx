import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WorldResponseLoadingState from './WorldResponseLoadingState';

describe('WorldResponseLoadingState', () => {
  it('provides visible, polite status feedback while the report chunk loads', () => {
    const markup = renderToStaticMarkup(<WorldResponseLoadingState />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('正在整理赛后回应');
    expect(markup).not.toContain('aria-hidden="true">正在整理赛后回应');
  });
});
